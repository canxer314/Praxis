/**
 * PlatformAdapter — Phase 1A 核心模块
 *
 * 职责:
 *   - 接收平台事件，路由到对应 handler
 *   - 构造注入 AgentMemory/LLM 客户端（可测试、可 mock）
 *   - 事件乱序守卫（session_start 完成前拒绝其他事件）
 *   - 幂等去重（同一 sessionId+eventType 最多处理一次）
 *   - Result 类型统一错误处理
 */

import { log, logDegraded } from "./logger";

// ---- 类型 ----

export type AutonomyAction = "proceed" | "inform" | "confirm" | "block";

export interface AutonomyDecision {
  action: AutonomyAction;
  reason: string;
  proficiency: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface ContextInjection {
  systemPromptAddition: string;
  tier: "A" | "B" | "C";
  tokenCount: number;
}

export interface LearningEvent {
  id: string;
  type: "correction" | "preference" | "pattern" | "insight" | "pitfall";
  content: string;
  confidence: number;
}

export type PraxisEvent =
  | { type: "session_start"; sessionId: string; timestamp: string }
  | { type: "message_received"; sessionId: string; message: { role: "user" | "assistant"; content: string }; timestamp: string }
  | { type: "before_tool_call"; sessionId: string; toolName: string; toolArgs: Record<string, unknown>; taskId?: string }
  | { type: "after_tool_call"; sessionId: string; toolName: string; toolResult: { success: boolean; output?: unknown; error?: string }; taskId?: string }
  | { type: "agent_end"; sessionId: string }
  | { type: "session_end"; sessionId: string; timestamp: string };

export type Result<T, E = PraxisError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface PraxisError {
  code: string;
  message: string;
}

/**
 * 可抛出的 Error 子类，满足 PraxisError 接口。
 * 用于构造函数中的依赖检查 — D4。
 *
 * 注意：Result<T, E> 的 E 参数使用 PraxisError 接口（结构类型），
 * 而 throw 使用此类（满足接口 + 保留 Error 原型链）。
 */
export class PraxisErrorThrowable extends Error implements PraxisError {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PraxisError";
    this.code = code;
  }
}

// ══════════════════════════════════════════════════════════════════
// 错误码注册表 (M7)
// ══════════════════════════════════════════════════════════════════

export const ErrorCode = {
  // 依赖注入
  MISSING_DEP: "MISSING_DEP",
  // 数据访问
  NOT_FOUND: "NOT_FOUND",
  EMPTY_SLOT: "EMPTY_SLOT",
  SLOT_READ_ERROR: "SLOT_READ_ERROR",
  SLOT_WRITE_ERROR: "SLOT_WRITE_ERROR",
  // AgentMemory
  AGENTMEMORY_ERROR: "AGENTMEMORY_ERROR",
  AGENTMEMORY_UNAVAILABLE: "AGENTMEMORY_UNAVAILABLE",
  // 会话
  SESSION_NOT_STARTED: "SESSION_NOT_STARTED",
  SESSION_ALREADY_STARTED: "SESSION_ALREADY_STARTED",
  // 校准
  CALIBRATE_NO_PROFILE: "CALIBRATE_NO_PROFILE",
  // 策略
  STRATEGY_NOT_FOUND: "STRATEGY_NOT_FOUND",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  ROLLBACK_FAILED: "ROLLBACK_FAILED",
  // 通用
  UNKNOWN_EVENT: "UNKNOWN_EVENT",
  TIMEOUT: "TIMEOUT",
} as const;

export interface EventResult {
  autonomyDecision?: AutonomyDecision;
  contextInjection?: ContextInjection;
  learningEvents?: LearningEvent[];
}

// ---- 依赖接口 ----

export interface AgentMemoryClient {
  getSlot(name: string): Promise<Result<unknown>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
  healthCheck(): Promise<boolean>;
}

export interface LlmClient {
  analyze(prompt: string): Promise<Result<string>>;
}

// ---- 内部状态 ----

interface CompetencyModel {
  skills: Array<{ id: string; name: string; proficiency: number; level: string }>;
  best_practices: string[];
  anti_patterns: string[];
}

// ---- 轻量分析器接口（避免循环依赖） ----

interface TranscriptAnalyzerLike {
  analyze(transcript: string): Promise<LearningEvent[]> | LearningEvent[];
}

// ---- PlatformAdapter ----

export class PlatformAdapter {
  private readonly am: AgentMemoryClient;
  private readonly llm: LlmClient;
  private readonly transcriptAnalyzer?: TranscriptAnalyzerLike;
  private readonly processed: Set<string> = new Set();
  private sessionStarted = false;

  constructor(am: AgentMemoryClient, llm: LlmClient, transcriptAnalyzer?: TranscriptAnalyzerLike) {
    if (!am) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "AgentMemoryClient is required");
    if (!llm) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "LlmClient is required");
    this.am = am;
    this.llm = llm;
    this.transcriptAnalyzer = transcriptAnalyzer;
  }

  async onEvent(event: PraxisEvent): Promise<Result<EventResult>> {
    const start = Date.now();

    // 幂等去重
    const dedupKey = `${event.sessionId}:${event.type}`;
    if (event.type === "session_end" && this.processed.has(dedupKey)) {
      log({ ts: new Date().toISOString(), module: "platform-adapter", op: event.type, duration_ms: Date.now() - start, outcome: "skipped", sessionId: event.sessionId });
      return { ok: true, value: { learningEvents: [] } };
    }
    if (event.type === "session_start" && this.processed.has(dedupKey)) {
      return { ok: false, error: { code: "SESSION_ALREADY_STARTED", message: `Session ${event.sessionId} already started` } };
    }

    // 乱序守卫
    if (event.type !== "session_start" && !this.sessionStarted) {
      return { ok: false, error: { code: "SESSION_NOT_STARTED", message: "session_start must be called first" } };
    }

    this.processed.add(dedupKey);

    let result: Result<EventResult>;
    switch (event.type) {
      case "session_start":
        result = await this.handleSessionStart(event);
        break;
      case "session_end":
        result = await this.handleSessionEnd(event);
        break;
      case "before_tool_call":
        result = await this.handleBeforeToolCall(event);
        break;
      case "after_tool_call":
        result = await this.handleAfterToolCall(event);
        break;
      case "message_received":
        result = await this.handleMessageReceived(event);
        break;
      case "agent_end":
        result = await this.handleAgentEnd(event);
        break;
      default:
        result = { ok: false, error: { code: "UNKNOWN_EVENT", message: `Unknown event type` } };
    }

    log({
      ts: new Date().toISOString(),
      module: "platform-adapter",
      op: event.type,
      duration_ms: Date.now() - start,
      outcome: result.ok ? "success" : "error",
      error: result.ok ? undefined : result.error.message,
      sessionId: event.sessionId,
    });

    return result;
  }

  // ---- Handler ----

  private async handleSessionStart(event: PraxisEvent & { type: "session_start" }): Promise<Result<EventResult>> {
    this.sessionStarted = true;

    const modelResult = await this.am.getSlot("competency_model");
    const isDegraded = !modelResult.ok || !modelResult.value;

    let model: CompetencyModel;
    let stale = false;

    if (modelResult.ok && modelResult.value) {
      model = modelResult.value as CompetencyModel;
      // 确保可选字段有默认值
      model.best_practices = model.best_practices ?? [];
      model.anti_patterns = model.anti_patterns ?? [];
      model.skills = model.skills ?? [];
    } else {
      // 降级：使用硬编码默认值
      model = {
        skills: [
          { id: "typescript", name: "TypeScript", proficiency: 0.6, level: "competent" },
          { id: "architecture", name: "系统架构设计", proficiency: 0.8, level: "proficient" },
        ],
        best_practices: [],
        anti_patterns: [],
      };
      stale = true;
    }

    const skills = model.skills
      .map((s) => `- ${s.name}: ${s.proficiency.toFixed(2)} (${s.level})`)
      .join("\n");

    const context: ContextInjection = {
      systemPromptAddition: [
        "## Praxis Context",
        "",
        "### 能力概况",
        skills,
        stale ? "\n⚠️ 使用缓存数据（AgentMemory 不可用）" : "",
        "",
        model.best_practices.length > 0
          ? "### 最佳实践\n" + model.best_practices.map((p) => `- ${p}`).join("\n")
          : "",
        model.anti_patterns.length > 0
          ? "### 已知陷阱\n" + model.anti_patterns.map((a) => `- ${a}`).join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      tier: isDegraded ? "C" : "A",
      tokenCount: 300,
    };

    return { ok: true, value: { contextInjection: context } };
  }

  private async handleSessionEnd(_event: PraxisEvent & { type: "session_end" }): Promise<Result<EventResult>> {
    return {
      ok: true,
      value: {
        learningEvents: [
          {
            id: `learn_${_event.sessionId}_${Date.now()}`,
            type: "pattern",
            content: "session 完成（Phase 1A v1 — 基础学习提取）",
            confidence: 0.5,
          },
        ],
      },
    };
  }

  private async handleBeforeToolCall(event: PraxisEvent & { type: "before_tool_call" }): Promise<Result<EventResult>> {
    const modelResult = await this.am.getSlot("competency_model");

    if (!modelResult.ok) {
      // 降级：无 competency 数据 → 保守决策
      return {
        ok: true,
        value: {
          autonomyDecision: {
            action: "confirm",
            reason: "AgentMemory 不可用，无法查询熟练度",
            proficiency: 0,
            riskLevel: "medium",
          },
        },
      };
    }

    const model = (modelResult.value ?? { skills: [] }) as CompetencyModel;
    const skill = (model.skills ?? []).find((s) => s.name.toLowerCase() === event.toolName.toLowerCase());

    const proficiency = skill?.proficiency ?? 0;
    const action: AutonomyAction = proficiency >= 0.8 ? "proceed" : proficiency >= 0.5 ? "inform" : "confirm";

    return {
      ok: true,
      value: {
        autonomyDecision: {
          action,
          reason: `熟练度 ${proficiency.toFixed(2)} → ${action}`,
          proficiency,
          riskLevel: proficiency < 0.3 ? "high" : "medium",
        },
      },
    };
  }

  private async handleAfterToolCall(_event: PraxisEvent & { type: "after_tool_call" }): Promise<Result<EventResult>> {
    return { ok: true, value: {} };
  }

  private async handleMessageReceived(event: PraxisEvent & { type: "message_received" }): Promise<Result<EventResult>> {
    if (!this.transcriptAnalyzer) return { ok: true, value: {} };

    const events = await this.transcriptAnalyzer.analyze(event.message.content);

    if (events.length > 0) {
      // 实时保存学习事件（不等 session_end）
      const writeResult = await this.am.setSlot("progress_log", {
        sessionId: event.sessionId,
        timestamp: new Date().toISOString(),
        events,
      });

      if (writeResult.ok) {
        return { ok: true, value: { learningEvents: events } };
      }
      // 写入失败静默继续（message_received 不能阻塞对话）
    }

    return { ok: true, value: {} };
  }

  private async handleAgentEnd(_event: PraxisEvent & { type: "agent_end" }): Promise<Result<EventResult>> {
    return { ok: true, value: {} };
  }
}
