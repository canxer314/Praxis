/**
 * AgentEndHandler — M0 + Phase 0 MidSession 融合点
 *
 * 职责:
 *   - 汇总 session trace 中的所有工具调用
 *   - 输出摘要（count + success/failure 分布）
 *   - Phase 0: MidSession 信号源融合点（供 M5.1 MidSessionLearner 使用）
 */

import type { M0Deps } from "./m0-deps";
import type { ToolCallRecord, ProtoStructure, SignalSourceInput } from "./cognitive/types";

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

  /** Phase 0: 追加 MidSession 信号源（M5.1 调用） */
  addMidSessionSources(sources: SignalSourceInput[]): void {
    this.midSessionSources.push(...sources);
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

    this.deps.logger?.info("agent_end summary", {
      sessionId,
      toolCallCount: this.toolCallTrace.length,
      successCount,
      failureCount,
      fusedCount,
    });

    return {
      sessionId,
      toolCallCount: this.toolCallTrace.length,
      successCount,
      failureCount,
      toolNames,
      totalDurationMs,
      fusedCount,
    };
  }
}
