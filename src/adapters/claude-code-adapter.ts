/**
 * ClaudeCodeAdapter — M6.3 Claude Code 运行时适配器
 *
 * 职责:
 *   - 将 Claude Code Hook 事件映射为 Praxis 标准生命周期事件
 *   - 将 Praxis 决策映射为 Claude Code 可执行指令
 *   - Notification 过滤: 仅 user_message 映射到 message_received
 *   - 纯函数, 无状态, 不做认知处理
 *
 * T18: 使用共享 base-adapter 工厂，仅覆盖平台差异:
 *   - mapToMessageReceived: Notification 过滤
 *   - mapToAfterToolCall: 额外 tool_result / root-level success/error fallback
 *
 * Claude Code Hook 参考:
 *   SessionStart → session_start
 *   PreToolUse  → before_tool_call
 *   PostToolUse → after_tool_call
 *   Notification → message_received (仅 user_message)
 *   Stop        → agent_end
 *   SessionEnd / PreCompact → session_end (partial)
 */

import type { PraxisLifecycleEvent } from "../orchestration/orchestrator";
import type { AgentRuntimeAdapter } from "./adapter-interface";
import { createBaseAdapter } from "./base-adapter";

// ══════════════════════════════════════════════════════════════════
// ClaudeCodeAdapter
// ══════════════════════════════════════════════════════════════════

export const claudeCodeAdapter: AgentRuntimeAdapter = createBaseAdapter("claude-code", {
  /** Claude Code Notification 过滤: 仅 user_message 映射 */
  mapToMessageReceived(raw: Record<string, unknown>): PraxisLifecycleEvent | null {
    const notificationType = String(raw.notification_type ?? raw.type ?? "");
    if (notificationType && notificationType !== "user_message") {
      return null;
    }

    const msg = (raw.message ?? raw.content ?? {}) as Record<string, unknown>;
    const role = String(msg.role ?? raw.role ?? "user");
    const content = String(msg.content ?? raw.content ?? "");
    if (!content) return null;

    return {
      type: "message_received",
      sessionId: String(raw.session_id ?? raw.sessionId ?? ""),
      message: { role: role as "user" | "assistant", content },
      timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
    };
  },

  /** Claude Code PostToolUse 额外字段: tool_result + root-level success/error */
  mapToAfterToolCall(raw: Record<string, unknown>): PraxisLifecycleEvent {
    const result = (raw.result ?? raw.tool_result ?? {}) as Record<string, unknown>;
    return {
      type: "after_tool_call",
      sessionId: String(raw.session_id ?? raw.sessionId ?? ""),
      toolName: String(raw.tool_name ?? raw.toolName ?? "unknown"),
      toolParams: (raw.tool_input ?? raw.toolParams ?? {}) as Record<string, unknown>,
      result: {
        success: Boolean(result.success ?? raw.success ?? true),
        output: result.output ?? raw.output,
        error: typeof result.error === "string"
          ? result.error
          : typeof raw.error === "string" ? raw.error : undefined,
      },
    };
  },
});
