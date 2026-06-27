/**
 * ClaudeCodeAdapter — M6.3 Claude Code 运行时适配器
 *
 * 职责:
 *   - 将 Claude Code Hook 事件映射为 Praxis 标准生命周期事件
 *   - 将 Praxis 决策映射为 Claude Code 可执行指令
 *   - Notification 过滤: 仅 user_message 映射到 message_received
 *   - 纯函数, 无状态, 不做认知处理
 *
 * Claude Code Hook 参考:
 *   SessionStart → session_start
 *   PreToolUse  → before_tool_call
 *   PostToolUse → after_tool_call
 *   Notification → message_received (仅 user_message)
 *   Stop        → agent_end
 *   SessionEnd / PreCompact → session_end (partial)
 */

import type { PraxisLifecycleEvent } from "../orchestrator";
import type { AgentRuntimeAdapter, RuntimeInstruction } from "./adapter-interface";

// ══════════════════════════════════════════════════════════════════
// ClaudeCodeAdapter
// ══════════════════════════════════════════════════════════════════

export const claudeCodeAdapter: AgentRuntimeAdapter = {
  runtimeName: "claude-code",

  // ── Runtime → Praxis (事件映射) ──

  mapToSessionStart(raw: Record<string, unknown>): PraxisLifecycleEvent {
    return {
      type: "session_start",
      sessionId: String(raw.session_id ?? raw.sessionId ?? `claude-${Date.now()}`),
      timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
    };
  },

  mapToMessageReceived(raw: Record<string, unknown>): PraxisLifecycleEvent | null {
    // Claude Code Notification 过滤: 仅 user_message 映射
    const notificationType = String(raw.notification_type ?? raw.type ?? "");
    if (notificationType && notificationType !== "user_message") {
      return null; // 权限请求、空闲、系统通知 → 不产生 Praxis 事件
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

  mapToBeforeToolCall(raw: Record<string, unknown>): PraxisLifecycleEvent {
    return {
      type: "before_tool_call",
      sessionId: String(raw.session_id ?? raw.sessionId ?? ""),
      toolName: String(raw.tool_name ?? raw.toolName ?? "unknown"),
      toolParams: (raw.tool_input ?? raw.toolParams ?? {}) as Record<string, unknown>,
    };
  },

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

  mapToAgentEnd(raw: Record<string, unknown>): PraxisLifecycleEvent {
    return {
      type: "agent_end",
      sessionId: String(raw.session_id ?? raw.sessionId ?? ""),
    };
  },

  mapToSessionEnd(raw: Record<string, unknown>): PraxisLifecycleEvent {
    return {
      type: "session_end",
      sessionId: String(raw.session_id ?? raw.sessionId ?? ""),
      transcript: typeof raw.transcript === "string" ? raw.transcript : undefined,
      timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
    };
  },

  // ── Praxis → Runtime (决策映射) ──

  mapAutonomyDecision(
    event: PraxisLifecycleEvent,
    decision: { action: "proceed" | "inform" | "confirm" | "block"; reason: string },
  ): RuntimeInstruction {
    switch (decision.action) {
      case "proceed":
        return { type: "proceed", toolCall: {} };
      case "inform":
        return { type: "inform", message: `[Praxis] ${decision.reason}` };
      case "confirm":
        return {
          type: "confirm",
          message: `[Praxis] 需要确认: ${decision.reason}`,
          toolCall: {},
        };
      case "block":
        return { type: "block", reason: decision.reason, constraintId: "claude-code-block" };
    }
  },

  mapConstraintViolation(
    event: PraxisLifecycleEvent,
    violation: { constraintId: string; description: string; severity: "block" | "confirm" | "warn" },
  ): RuntimeInstruction {
    switch (violation.severity) {
      case "block":
        return { type: "block", reason: violation.description, constraintId: violation.constraintId };
      case "confirm":
        return {
          type: "confirm",
          message: `[Praxis] 约束: ${violation.description}`,
          toolCall: {},
        };
      case "warn":
        return { type: "inform", message: `[Praxis] 约束提醒: ${violation.description}` };
    }
  },
};
