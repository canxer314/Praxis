/**
 * AgentEndHandler — M0 + Phase 0 MidSession 融合点 + M6 deepCheck
 *
 * 职责:
 *   - 汇总 session trace 中的所有工具调用
 *   - 输出摘要（count + success/failure 分布）
 *   - Phase 0: MidSession 信号源融合点（供 M5.1 MidSessionLearner 使用）
 *   - M6 Fix-1: deepCheck teleological 分析 (LLM 异步, 结果写入 audit_log)
 */

import type { M0Deps } from "./m0-deps";
import type { LLMSubsystem } from "./m0-deps";
import type { ToolCallRecord, ProtoStructure, SignalSourceInput, ProtoSequence } from "./cognitive/types";
import { deepCheck } from "./analysis/teleological-judge";
import type { TeleologicalJudgment } from "./analysis/teleological-judge";

// ---- AgentEndSummary ----

export interface AgentEndSummary {
  sessionId: string;
  toolCallCount: number;
  successCount: number;
  failureCount: number;
  toolNames: string[];
  totalDurationMs: number | null;
  /** Phase 0: 融合后的结构置信度更新计数 */
  fusedCount: number;
  /** M6: deepCheck teleological 分析结果计数 */
  teleologicalChecks: number;
}

// ---- AgentEndHandler ----

export class AgentEndHandler {
  constructor(
    private readonly deps: M0Deps,
    /** Session-scoped 工具调用追踪 */
    private readonly toolCallTrace: ToolCallRecord[] = [],
  ) {}

  /**
   * Phase 0: MidSession 信号源收集点。
   * M5.1 MidSessionLearner 在 handleCorrection/handleConstraintViolation 时
   * 将 mid_session signal sources 追加到此数组。agent_end 时由 fuser 消费。
   */
  private midSessionSources: SignalSourceInput[] = [];

  /** M6: deepCheck 的纠正数据 */
  private correctionPairs: Array<{ sequenceId: string; correctionText: string }> = [];
  private protoSequences: ProtoSequence[] = [];
  private llmForDeepCheck: LLMSubsystem | null = null;

  /** Phase 0: 追加 MidSession 信号源（M5.1 调用） */
  addMidSessionSources(sources: SignalSourceInput[]): void {
    this.midSessionSources.push(...sources);
  }

  /** M6 Fix-1: 设置 deepCheck 数据（orchestrator 在 agent_end 时调用） */
  setCorrections(
    corrections: Array<{ sequenceId: string; correctionText: string; timestamp: number }>,
    sequences: ProtoSequence[],
    llm: LLMSubsystem,
  ): void {
    this.correctionPairs = corrections.map(c => ({ sequenceId: c.sequenceId, correctionText: c.correctionText }));
    this.protoSequences = sequences;
    this.llmForDeepCheck = llm;
  }

  /** Phase 0: 获取并清空 MidSession 信号源 */
  private drainMidSessionSources(): SignalSourceInput[] {
    const drained = [...this.midSessionSources];
    this.midSessionSources = [];
    return drained;
  }

  /**
   * 处理 agent_end 事件。返回工具调用摘要。
   */
  async handle(sessionId: string): Promise<AgentEndSummary> {
    const successCount = this.toolCallTrace.filter((t) => t.result.success).length;
    const failureCount = this.toolCallTrace.length - successCount;

    const toolNames = [...new Set(this.toolCallTrace.map((t) => t.toolName))];

    let totalDurationMs: number | null = null;
    if (this.toolCallTrace.length > 0) {
      const timestamps = this.toolCallTrace
        .map((t) => t.timestamp)
        .filter((t): t is number => typeof t === "number");
      if (timestamps.length >= 2) {
        totalDurationMs = Math.max(...timestamps) - Math.min(...timestamps);
      }
    }

    // Phase 0: MidSession 融合点 — 消费 mid_session 信号源
    let fusedCount = 0;
    const midSources = this.drainMidSessionSources();
    if (this.deps.fuser && midSources.length > 0) {
      const fused = this.deps.fuser.fuse([...midSources]);  // mid_session sources only for initial pass
      if (fused) {
        this.deps.logger?.info("agent_end MidSession fusion", {
          sessionId,
          sourceCount: midSources.length,
          fusedConfidence: fused.confidence,
        });
        fusedCount = 1;  // 记录融合发生（实际结构更新在 session-end 的统一融合中完成）
      }
    }

    // M6 Fix-1: deepCheck teleological 分析 (异步, 不阻塞)
    let teleologicalChecks = 0;
    if (this.correctionPairs.length > 0 && this.llmForDeepCheck) {
      const sequenceMap = new Map(this.protoSequences.map(s => [s.id, s]));
      for (const pair of this.correctionPairs) {
        const sequence = sequenceMap.get(pair.sequenceId);
        if (!sequence) continue;
        try {
          const judgment = await deepCheck(sequence, pair.correctionText, this.llmForDeepCheck);
          await this.writeTeleologicalAuditLog(pair.sequenceId, pair.correctionText, judgment);
          teleologicalChecks++;
        } catch {
          // deepCheck 失败不阻塞 agent_end
        }
      }
    }

    this.deps.logger?.info("agent_end summary", {
      sessionId,
      toolCallCount: this.toolCallTrace.length,
      successCount,
      failureCount,
      fusedCount,
      teleologicalChecks,
    });

    return {
      sessionId,
      toolCallCount: this.toolCallTrace.length,
      successCount,
      failureCount,
      toolNames,
      totalDurationMs,
      fusedCount,
      teleologicalChecks,
    };
  }

  /** M6 Fix-1: 写入 teleological_check 条目到 audit_log */
  private async writeTeleologicalAuditLog(
    sequenceId: string,
    correctionText: string,
    judgment: TeleologicalJudgment,
  ): Promise<void> {
    try {
      const entry: Record<string, unknown> = {
        timestamp: Date.now(),
        type: "teleological_check",
        severity: judgment.isAlternativeImpl ? "info" : "warning",
        source: "deep_check",
        detail: {
          sequenceId,
          correctionText: correctionText.slice(0, 500),
          isAlternativeImpl: judgment.isAlternativeImpl,
          preservedPurposes: judgment.preservedPurposes,
          lostPurposes: judgment.lostPurposes,
          confidence: judgment.confidence,
        },
      };

      const existing = await this.deps.memory.getSlot("audit_log");
      const log = (existing.ok && existing.value) ? existing.value as Record<string, unknown> : {};
      const entries = Array.isArray(log.entries) ? [...log.entries, entry] : [entry];
      await this.deps.memory.setSlot("audit_log", { ...log, entries });
    } catch {
      // audit_log 写入失败不阻塞
    }
  }
}
