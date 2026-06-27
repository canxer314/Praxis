/**
 * OpenClawAdapter — M6.2 OpenClaw 运行时参考适配器
 *
 * 职责:
 *   - 将 OpenClaw Hook 事件映射为 Praxis 标准生命周期事件
 *   - 将 Praxis 决策映射为 OpenClaw 可执行指令
 *   - 纯函数, 无状态, 不做认知处理
 *
 * 对应架构 §1 三层运行时拓扑 — OpenClaw 是第一个参考实现。
 */

import type { PraxisLifecycleEvent } from "../orchestrator";
import type { AgentRuntimeAdapter, RuntimeInstruction } from "./adapter-interface";

// ══════════════════════════════════════════════════════════════════
// OpenClawAdapter
// ══════════════════════════════════════════════════════════════════

export const openclawAdapter: AgentRuntimeAdapter = {
  runtimeName: "openclaw",

  // ── Runtime → Praxis (事件映射) ──

  mapToSessionStart(raw: Record<string, unknown>): PraxisLifecycleEvent {
    return {
      type: "session_start",
      sessionId: String(raw.session_id ?? raw.sessionId ?? `openclaw-${Date.now()}`),
      timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
    };
  },

  mapToMessageReceived(raw: Record<string, unknown>): PraxisLifecycleEvent | null {
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
    const result = (raw.result ?? {}) as Record<string, unknown>;
    return {
      type: "after_tool_call",
      sessionId: String(raw.session_id ?? raw.sessionId ?? ""),
      toolName: String(raw.tool_name ?? raw.toolName ?? "unknown"),
      toolParams: (raw.tool_input ?? raw.toolParams ?? {}) as Record<string, unknown>,
      result: {
        success: Boolean(result.success ?? true),
        output: result.output,
        error: typeof result.error === "string" ? result.error : undefined,
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
        return { type: "block", reason: decision.reason, constraintId: "openclaw-block" };
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
          message: `[Praxis] 约束检查: ${violation.description}`,
          toolCall: {},
        };
      case "warn":
        return { type: "inform", message: `[Praxis] 约束警告: ${violation.description}` };
    }
  },
};
