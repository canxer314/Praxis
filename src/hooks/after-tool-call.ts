/**
 * AfterToolCallHandler — M0
 *
 * 职责:
 *   - 记录工具调用结果到 session trace
 *   - 成功/失败信号暂存到 pendingSignals
 *
 * M4 将升级为完整的反馈信号匹配（success/failure/quality signals）。
 */

import type { M0Deps } from "../m0-deps";
import type { PendingSignal, ToolCallRecord } from "../cognitive/types";

// ---- AfterToolCallHandler ----

export class AfterToolCallHandler {
  constructor(
    private readonly deps: M0Deps,
    /** Session-scoped 工具调用追踪 */
    private readonly toolCallTrace: ToolCallRecord[] = [],
    /** 共享的 pendingSignals（与 MessageReceivedHandler 共用） */
    private readonly pendingSignals: PendingSignal[] = [],
  ) {}

  /**
   * 处理 after_tool_call 事件。记录工具调用到 trace。
   */
  async handle(
    sessionId: string,
    toolName: string,
    toolParams: Record<string, unknown>,
    result: { success: boolean; output?: unknown; error?: string },
  ): Promise<void> {
    const record: ToolCallRecord = {
      toolName,
      toolParams,
      result,
      timestamp: Date.now(),
    };

    this.toolCallTrace.push(record);

    // 失败信号暂存
    if (!result.success) {
      this.pendingSignals.push({
        id: `sig-${sessionId}-${Date.now()}`,
        type: "failure",
        sessionId,
        timestamp: Date.now(),
        detail: `工具 "${toolName}" 调用失败: ${result.error ?? "unknown error"}`,
        toolName,
      });
    }

    this.deps.logger?.info("after_tool_call recorded", {
      sessionId,
      toolName,
      success: result.success,
      traceLength: this.toolCallTrace.length,
    });
  }

  /** 获取当前 session 的工具调用 trace */
  getTrace(): ToolCallRecord[] {
    return this.toolCallTrace;
  }
}
