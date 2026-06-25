/**
 * AgentEndHandler — M0
 *
 * 职责:
 *   - 汇总 session trace 中的所有工具调用
 *   - 输出摘要（count + success/failure 分布）
 *
 * M4 将增加: 统计验证器独立验证 + 任务级反思 + Curiosity Engine 触发。
 */

import type { M0Deps } from "./m0-deps";
import type { ToolCallRecord } from "./cognitive/types";

// ---- AgentEndSummary ----

export interface AgentEndSummary {
  sessionId: string;
  toolCallCount: number;
  successCount: number;
  failureCount: number;
  toolNames: string[];
  totalDurationMs: number | null;
}

// ---- AgentEndHandler ----

export class AgentEndHandler {
  constructor(
    private readonly deps: M0Deps,
    /** Session-scoped 工具调用追踪 */
    private readonly toolCallTrace: ToolCallRecord[] = [],
  ) {}

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

    this.deps.logger?.info("agent_end summary", {
      sessionId,
      toolCallCount: this.toolCallTrace.length,
      successCount,
      failureCount,
    });

    return {
      sessionId,
      toolCallCount: this.toolCallTrace.length,
      successCount,
      failureCount,
      toolNames,
      totalDurationMs,
    };
  }
}
