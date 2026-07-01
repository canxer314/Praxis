/**
 * EventOrchestrator — M0 纯函数事件路由器 + Phase 0 M4 接线
 *
 * 职责:
 *   - 将 7 种标准生命周期事件路由到对应的处理器
 *   - 管理 session-scoped 状态（pendingSignals、toolCallTrace、structures、agentEnd）
 *   - 不包含业务逻辑 — 所有决策委托给具体处理器
 *   - Phase 0: 线程 sessionId 到 before_tool_call，暴露 session structures 给 message handler
 *
 * 与 CognitiveCore 的关系: orchestrator 是新的入口点，CognitiveCore 保留
 * 作为兼容层。新代码应使用 orchestrator。
 */

import type { Result } from "../platform-adapter";
import type { M0Deps } from "../m0-deps";
import type { PendingSignal, ToolCallRecord, ProtoStructure, SignalSourceInput } from "../cognitive/types";
import { SessionStartHandler } from "../hooks/session-start";
import { SessionEndHandler } from "../hooks/session-end";
import { MessageReceivedHandler } from "../hooks/message-received";
import { BeforeToolCallHandler } from "../hooks/before-tool-call";
import { AfterToolCallHandler } from "../hooks/after-tool-call";
import { AgentEndHandler, type AgentEndSummary } from "../hooks/agent-end";
import { CronTickHandler } from "../hooks/cron-tick";
import { MidSessionLearner } from "../analysis/mid-session-learner";
import { SessionStateStore, type SessionStateSnapshot } from "./session-state-store";
import { quickCheck, deepCheck, isProtoSequence } from "../analysis/teleological-judge";
import { deriveMaturity } from "./maturity";
import { disambiguateText } from "../analysis/semantic-disambiguator";
import { applyProgress } from "./task-context";
import type { ProtoSequence } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 事件类型
// ══════════════════════════════════════════════════════════════════

export type PraxisLifecycleEvent =
  | { type: "session_start"; sessionId: string; timestamp: number }
  | { type: "message_received"; sessionId: string; message: { role: "user" | "assistant"; content: string }; timestamp: number }
  | { type: "before_tool_call"; sessionId: string; toolName: string; toolParams: Record<string, unknown> }
  | { type: "after_tool_call"; sessionId: string; toolName: string; toolParams: Record<string, unknown>; result: { success: boolean; output?: unknown; error?: string } }
  | { type: "agent_end"; sessionId: string }
  | { type: "session_end"; sessionId: string; transcript?: string; timestamp: number }
  | { type: "cron_tick"; timestamp: number };

// ══════════════════════════════════════════════════════════════════
// Session 状态
// ══════════════════════════════════════════════════════════════════

interface SessionState {
  pendingSignals: PendingSignal[];
  toolCallTrace: ToolCallRecord[];
  /** Phase 0: session 中注入的 ProtoStructure 摘要（供 M5.1 + session-end 融合用） */
  structures: ProtoStructure[];
  /** Phase 0: session 中注入的结构 ID 列表（供 attention telemetry injectedIds） */
  injectedStructureIds: string[];
  /** Phase 0: MidSession 信号源（M5.1 MidSessionLearner 追加，agent_end 消费） */
  midSessionSources: SignalSourceInput[];
  /** Phase 0: 当前任务类型（session-scoped，非 M0Deps 共享） */
  currentTaskType: string;
  /** Phase 0: 当前领域（session-scoped） */
  currentDomain: string;
  /** M5.1: 会话中实时学习器 */
  midSessionLearner: MidSessionLearner;
  /** M6 Fix-1: session 中收集的 (ProtoSequence, correctionText) 对, agent_end 时消费 */
  corrections: Array<{ sequenceId: string; correctionText: string; timestamp: number }>;
}

// ══════════════════════════════════════════════════════════════════
// Orchestrator
// ══════════════════════════════════════════════════════════════════

export class EventOrchestrator {
  private readonly deps: M0Deps;
  private readonly sessionStart: SessionStartHandler;
  private readonly sessionEnd: SessionEndHandler;
  private readonly beforeToolCall: BeforeToolCallHandler;
  private readonly cronTick: CronTickHandler;
  /** Phase 0: per-session 状态持久化 (跨 hook 进程) */
  private readonly stateStore: SessionStateStore;

  /** 活跃 session 的状态 (sessionId → state) — 进程内缓存, 跨进程由 stateStore 持久化 */
  private readonly sessions = new Map<string, SessionState>();

  constructor(deps: M0Deps) {
    this.deps = deps;
    this.sessionStart = new SessionStartHandler(deps);
    // Phase 8: CrossAgentSync 与新的 lesson 存储不兼容，传入 undefined 走直写
    this.sessionEnd = new SessionEndHandler(deps, undefined);
    this.beforeToolCall = new BeforeToolCallHandler(deps);
    this.cronTick = new CronTickHandler(deps);
    this.stateStore = new SessionStateStore(deps);
  }

  // ════════════════════════════════════════════════════════════════
  // 公开 API — 每个事件类型一个方法
  // ════════════════════════════════════════════════════════════════

  async handleSessionStart(
    sessionId: string,
    /** T3: caller-provided context-pressure inputs (LLM usage feedback or conservative
     *  estimate). Without these, pressure defaults to "normal" (M2.2 adaptive compression
     *  never triggers). The bridge can pass an estimate from env/heuristic. */
    opts?: { estimatedUsedTokens?: number; contextWindowSize?: number },
  ) {
    // 初始化 session 状态 (Phase 0: + M5.1 MidSessionLearner)
    this.sessions.set(sessionId, {
      pendingSignals: [],
      toolCallTrace: [],
      structures: [],
      injectedStructureIds: [],
      midSessionSources: [],
      currentTaskType: this.deps.currentTaskType ?? "unknown",
      currentDomain: this.deps.currentDomain ?? "unknown",
      midSessionLearner: new MidSessionLearner(),
      corrections: [],
    });

    // Phase 7: deriveMaturity — 从 session 计数推导认知成熟度, 传入 session_start
    let sessionCount = 0;
    try {
      const countResult = await this.deps.memory.getSlot("session_count");
      if (countResult.ok && typeof countResult.value === "number") {
        sessionCount = countResult.value;
      }
    } catch { /* slot 不可用 → 默认 0 */ }
    const maturity = deriveMaturity(sessionCount);

    const result = await this.sessionStart.handle(sessionId, {
      ...opts,
      maturity,
    });

    // Phase 7: 递增 session 计数并持久化
    try {
      await this.deps.memory.setSlot("session_count", sessionCount + 1);
    } catch { /* 写入失败不阻塞 session_start */ }
    // M3: 加载已结晶约束到 before_tool_call 处理器
    if (result.ok && result.value.tieredContext?.criticalConstraints) {
      this.beforeToolCall.loadConstraints(
        result.value.tieredContext.criticalConstraints.constraints,
      );
    } else {
      // T12: 降级约束缓存 — AgentMemory 不可用时从 local-cache 加载
      if (!this.beforeToolCall.loadConstraintsFromCache()) {
        this.beforeToolCall.loadConstraints([]); // 缓存也为空 → 清除
      }
    }
    // Phase 0: 缓存注入的结构摘要 + ID 列表 + attention 更新
    if (result.ok && result.value.protoStructures) {
      const state = this.sessions.get(sessionId);
      if (state) {
        state.structures = result.value.protoStructures as unknown as ProtoStructure[];
        state.injectedStructureIds = result.value.protoStructures.map(s => s.id);
      }
    }

    // M6 Fix-4: 从 AgentMemory 加载 attentionRecords（重启恢复）
    await this.loadAttentionRecords();

    // Phase 0: 持久化 session 状态 (跨 hook 进程可达)
    await this.saveState(sessionId);

    return result;
  }

  async handleMessageReceived(sessionId: string, message: { role: "user" | "assistant"; content: string }) {
    const state = await this.getOrCreateState(sessionId);

    // Phase 7: 跨场景语义消歧 — 对用户消息进行同形异义词消歧
    if (message.role === "user" && message.content.length > 0) {
      try {
        const scenarios = state.structures
          .filter(s => s.scenarioId)
          .map(s => ({ scenarioId: s.scenarioId!, confidence: s.confidence, source: "llm_inference" as const }));
        const results = disambiguateText(message.content, scenarios);
        if (results.length > 0) {
          this.deps.logger?.info("Semantic disambiguation applied", {
            sessionId,
            termsDisambiguated: results.length,
          });
        }
      } catch { /* 消歧失败不阻塞消息处理 */ }
    }

    const handler = new MessageReceivedHandler(this.deps, state.pendingSignals);
    const cmdResult = await handler.handle(sessionId, message);
    // M5.5: /praxis command → return response to caller
    if (typeof cmdResult === "string") return cmdResult;
    // M5.1 + M5.2: 用户纠正 → 双重性质判断 → 实时下调
    if (message.role === "user" && state.structures.length > 0) {
      // M5.2: 对 ProtoSequence 做 quickCheck — 替代实现豁免惩罚
      const filtered = state.structures.filter(s => {
        if (s.protoType !== "sequence") return true;
        const seq = s as ProtoSequence;
        if (!seq.function?.postcondition || seq.function.postcondition.length === 0) {
          return true; // summary 结构 → 跳过 quickCheck
        }
        const qc = quickCheck(seq, message.content);
        return !qc.isAltImpl;
      });
      if (filtered.length > 0) {
        // M6 Fix-1: 收集非替代实现的纠正对 → agent_end 时 deepCheck 使用
        const allSequences = state.structures.filter(s => s.protoType === "sequence");
        for (const s of filtered) {
          if (s.protoType === "sequence" && allSequences.includes(s)) {
            state.corrections.push({
              sequenceId: s.id,
              correctionText: message.content,
              timestamp: Date.now(),
            });
          }
        }

        const sources = state.midSessionLearner.handleCorrection(
          message.content, filtered, this.deps.logger);
        if (sources.length > 0) {
          state.midSessionSources.push(...sources);
        }
      }
    }
    // Phase 0: 持久化 session 状态 (midSessionSources/corrections 跨 hook 可达)
    await this.saveState(sessionId);
  }

  /** Phase 0: sessionId 线程 — before_tool_call 携带 sessionId + M5.1 约束违规计数 */
  async handleBeforeToolCall(sessionId: string, toolName: string, toolParams?: Record<string, unknown>) {
    const result = await this.beforeToolCall.handle(sessionId, toolName, toolParams);
    // M5.1: 约束违规 → MidSessionLearner 计数
    if (result.ok && result.value.constraintId) {
      const state = await this.getOrCreateState(sessionId);
      const sources = state.midSessionLearner.handleConstraintViolation(
        result.value.constraintId);
      if (sources.length > 0) {
        state.midSessionSources.push(...sources);
      }
      // Phase 0: 持久化违规计数 (跨 hook 可达)
      await this.saveState(sessionId);
    }
    return result;
  }

  async handleAfterToolCall(
    sessionId: string,
    toolName: string,
    toolParams: Record<string, unknown>,
    result: { success: boolean; output?: unknown; error?: string },
  ) {
    const state = await this.getOrCreateState(sessionId);
    const handler = new AfterToolCallHandler(this.deps, state.toolCallTrace, state.pendingSignals);
    await handler.handle(sessionId, toolName, toolParams, result);
    // Phase 0: 持久化 toolCallTrace/pendingSignals
    await this.saveState(sessionId);
  }

  async handleAgentEnd(sessionId: string): Promise<AgentEndSummary> {
    const state = await this.getOrCreateState(sessionId);
    // Phase 0: 创建 AgentEndHandler + 注入 MidSession 信号源
    const handler = new AgentEndHandler(this.deps, [...state.toolCallTrace]);
    if (state.midSessionSources.length > 0) {
      // Copy to AgentEndHandler for its initial-pass fusion (logged, not persisted).
      // Do NOT clear state.midSessionSources here: session_end is the unified
      // fusion+persist point (session-end.ts: "实际结构更新在 session-end 的统一融合中完成")
      // and must still see these sources. Clearing here starved session_end of
      // mid_session sources, leaving fusion with only llm_marker (< MIN_SOURCES),
      // so no structure was ever fused/persisted.
      handler.addMidSessionSources([...state.midSessionSources]);
    }

    // M6 Fix-1: 传递 corrections 给 handler → 异步 deepCheck
    if (state.corrections.length > 0 && this.deps.llm) {
      const protoSequences = state.structures.filter(
        s => s.protoType === "sequence",
      ) as ProtoSequence[];
      if (protoSequences.length > 0) {
        handler.setCorrections([...state.corrections], protoSequences, this.deps.llm);
        state.corrections = []; // 消费后清空
      }
    }

    // Phase 0: 持久化 (corrections 已消费清空)
    await this.saveState(sessionId);
    return handler.handle(sessionId);
  }

  /** M6 Fix-4: 从 AgentMemory 加载 attentionRecords（重启恢复） */
  private async loadAttentionRecords(): Promise<void> {
    if (!this.deps.attentionRecords) return;
    try {
      const result = await this.deps.memory.getSlot("attention_records");
      if (result.ok && result.value) {
        const data = result.value as { records?: Array<{ structureId: string;[key: string]: unknown }> };
        if (data.records) {
          for (const r of data.records) {
            if (r.structureId) {
              const { structureId, ...rest } = r;
              this.deps.attentionRecords!.set(structureId, rest as unknown as import("../analysis/attention-telemetry").AttentionRecord);
            }
          }
        }
      }
    } catch {
      // 加载失败降级: 从空 Map 开始
    }
  }

  /** Phase 0: 追加 MidSession 信号源（供 M5.1 MidSessionLearner 调用） */
  addMidSessionSources(sessionId: string, sources: SignalSourceInput[]): void {
    const state = this.sessions.get(sessionId);
    if (state) state.midSessionSources.push(...sources);
  }

  async handleSessionEnd(sessionId: string, transcript?: string) {
    const state = await this.getOrCreateState(sessionId);

    // Phase 7: TaskContext 自动进度推断 — 加载 → LLM 推断 → applyProgress → 持久化
    try {
      const tcResult = await this.deps.memory.getSlot("task_context");
      if (tcResult.ok && tcResult.value) {
        const taskCtx = tcResult.value as Record<string, unknown>;
        // 尝试 LLM 推断进度 (confidence < 0.7 不自动更新已在 applyProgress 内处理)
        const llm = this.deps.llm;
        if (llm?.analyze && transcript && typeof taskCtx.task_id === "string") {
          try {
            const progressResult = await llm.analyze(
              `Based on this session transcript, infer task progress for "${taskCtx.task_name ?? taskCtx.task_id}". Return JSON: {"phase":"...","progress_summary":"...","confidence":0.X}`,
            );
            if (progressResult.ok && progressResult.value) {
              const inferred = JSON.parse(progressResult.value);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { updated } = applyProgress(taskCtx as any, inferred);
              await this.deps.memory.setSlot("task_context", updated);
            }
          } catch { /* LLM 推断失败不阻塞 session_end */ }
        }
      }
    } catch { /* TaskContext 不可用不阻塞 */ }

    // Drain midSessionSources before passing to session-end
    const midSources = [...state.midSessionSources];
    // Phase 0: 传入注入的结构 + MidSession 信号源
    const result = await this.sessionEnd.handle(
      sessionId,
      transcript ?? null,
      state.pendingSignals,
      state.structures.length > 0 ? state.structures : undefined,
      state.injectedStructureIds.length > 0 ? state.injectedStructureIds : undefined,
      midSources.length > 0 ? midSources : undefined,
      state.toolCallTrace.length > 0 ? state.toolCallTrace : undefined,
    );
    // M5.1: 清理 MidSessionLearner
    state.midSessionLearner.reset();
    // Phase 0: 清理持久化 session 状态 (session 已结束)
    await this.stateStore.delete(sessionId);
    // 清理进程内缓存
    this.sessions.delete(sessionId);
    return result;
  }

  async handleCronTick() {
    await this.cronTick.handle();
  }

  // ════════════════════════════════════════════════════════════════
  // 统一路由 — 根据事件类型分发
  // ════════════════════════════════════════════════════════════════

  async route(event: PraxisLifecycleEvent): Promise<unknown> {
    switch (event.type) {
      case "session_start":
        return this.handleSessionStart(event.sessionId);
      case "message_received":
        return this.handleMessageReceived(event.sessionId, event.message);
      case "before_tool_call":
        return this.handleBeforeToolCall(event.sessionId, event.toolName, event.toolParams);
      case "after_tool_call":
        return this.handleAfterToolCall(event.sessionId, event.toolName, event.toolParams, event.result);
      case "agent_end":
        return this.handleAgentEnd(event.sessionId);
      case "session_end":
        return this.handleSessionEnd(event.sessionId, event.transcript);
      case "cron_tick":
        return this.handleCronTick();
      default:
        return { ok: false, error: { code: "UNKNOWN_EVENT", message: `Unknown event type: ${(event as PraxisLifecycleEvent).type}` } };
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 内部
  // ════════════════════════════════════════════════════════════════

  private async getOrCreateState(sessionId: string): Promise<SessionState> {
    let state = this.sessions.get(sessionId);
    if (state) return state;
    // Phase 0: 跨进程 (per-hook) — 从持久化 slot 加载
    const snap = await this.stateStore.load(sessionId);
    if (snap) {
      state = {
        pendingSignals: snap.pendingSignals,
        toolCallTrace: snap.toolCallTrace,
        structures: snap.structures,
        injectedStructureIds: snap.injectedStructureIds,
        midSessionSources: snap.midSessionSources,
        currentTaskType: snap.currentTaskType,
        currentDomain: snap.currentDomain,
        midSessionLearner: MidSessionLearner.fromState(snap.midSessionLearnerState),
        corrections: snap.corrections,
      };
    } else {
      state = {
        pendingSignals: [],
        toolCallTrace: [],
        structures: [],
        injectedStructureIds: [],
        midSessionSources: [],
        currentTaskType: this.deps.currentTaskType ?? "unknown",
        currentDomain: this.deps.currentDomain ?? "unknown",
        midSessionLearner: new MidSessionLearner(),
        corrections: [],
      };
    }
    this.sessions.set(sessionId, state);
    return state;
  }

  /** Phase 0: 持久化 session 状态到 per-session slot (跨 hook 进程可达)。 */
  private async saveState(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    const snap: SessionStateSnapshot = {
      schemaVersion: 1,
      pendingSignals: state.pendingSignals,
      toolCallTrace: state.toolCallTrace,
      structures: state.structures,
      injectedStructureIds: state.injectedStructureIds,
      midSessionSources: state.midSessionSources,
      currentTaskType: state.currentTaskType,
      currentDomain: state.currentDomain,
      midSessionLearnerState: state.midSessionLearner.toState(),
      corrections: state.corrections,
    };
    await this.stateStore.save(sessionId, snap);
  }
}
