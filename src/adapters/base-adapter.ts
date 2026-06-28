/**
 * BaseAdapter — T18 DRY: 共享适配器工厂
 *
 * 两个适配器 (OpenClaw + Claude Code) ~90% 映射逻辑重复。
 * 此工厂提供完整的默认实现，各平台仅覆盖差异部分。
 *
 * 职责:
 *   - 提供 6 事件映射 + 2 决策映射的默认实现
 *   - 允许通过 overrides 替换任一个函数
 *   - 纯函数，无状态
 */

import type { PraxisLifecycleEvent } from "../orchestrator";
import type { AgentRuntimeAdapter, RuntimeInstruction } from "./adapter-interface";

// ══════════════════════════════════════════════════════════════════
// 默认实现
// ══════════════════════════════════════════════════════════════════

function defaultMapToSessionStart(
  runtimeName: string,
  raw: Record<string, unknown>,
): PraxisLifecycleEvent {
  return {
    type: "session_start",
    sessionId: String(raw.session_id ?? raw.sessionId ?? `${runtimeName}-${Date.now()}`),
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
  };
}

function defaultMapToMessageReceived(
  raw: Record<string, unknown>,
): PraxisLifecycleEvent | null {
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
}

function defaultMapToBeforeToolCall(
  raw: Record<string, unknown>,
): PraxisLifecycleEvent {
  return {
    type: "before_tool_call",
    sessionId: String(raw.session_id ?? raw.sessionId ?? ""),
    toolName: String(raw.tool_name ?? raw.toolName ?? "unknown"),
    toolParams: (raw.tool_input ?? raw.toolParams ?? {}) as Record<string, unknown>,
  };
}

function defaultMapToAfterToolCall(
  raw: Record<string, unknown>,
): PraxisLifecycleEvent {
  // extraResultFields: additional fallback field names for result (e.g. "tool_result")
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
}

function defaultMapToAgentEnd(
  raw: Record<string, unknown>,
): PraxisLifecycleEvent {
  return {
    type: "agent_end",
    sessionId: String(raw.session_id ?? raw.sessionId ?? ""),
  };
}

function defaultMapToSessionEnd(
  raw: Record<string, unknown>,
): PraxisLifecycleEvent {
  return {
    type: "session_end",
    sessionId: String(raw.session_id ?? raw.sessionId ?? ""),
    transcript: typeof raw.transcript === "string" ? raw.transcript : undefined,
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
  };
}

function defaultMapAutonomyDecision(
  _event: PraxisLifecycleEvent,
  decision: { action: "proceed" | "inform" | "confirm" | "block"; reason: string },
  runtimeName: string,
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
      return { type: "block", reason: decision.reason, constraintId: `${runtimeName}-block` };
  }
}

function defaultMapConstraintViolation(
  _event: PraxisLifecycleEvent,
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
}

// ══════════════════════════════════════════════════════════════════
// 工厂函数
// ══════════════════════════════════════════════════════════════════

/**
 * 创建共享基础适配器。
 *
 * @param runtimeName — 运行时标识 (如 "openclaw", "claude-code")
 * @param overrides — 可选的部分覆盖，替换任一个映射函数
 * @returns 完整的 AgentRuntimeAdapter
 */
export function createBaseAdapter(
  runtimeName: string,
  overrides?: Partial<AgentRuntimeAdapter>,
): AgentRuntimeAdapter {
  return {
    runtimeName: overrides?.runtimeName ?? runtimeName,

    // Runtime → Praxis (事件映射)
    mapToSessionStart: overrides?.mapToSessionStart
      ?? ((raw: Record<string, unknown>) => defaultMapToSessionStart(runtimeName, raw)),

    mapToMessageReceived: overrides?.mapToMessageReceived
      ?? ((raw: Record<string, unknown>) => defaultMapToMessageReceived(raw)),

    mapToBeforeToolCall: overrides?.mapToBeforeToolCall
      ?? ((raw: Record<string, unknown>) => defaultMapToBeforeToolCall(raw)),

    mapToAfterToolCall: overrides?.mapToAfterToolCall
      ?? ((raw: Record<string, unknown>) => defaultMapToAfterToolCall(raw)),

    mapToAgentEnd: overrides?.mapToAgentEnd
      ?? ((raw: Record<string, unknown>) => defaultMapToAgentEnd(raw)),

    mapToSessionEnd: overrides?.mapToSessionEnd
      ?? ((raw: Record<string, unknown>) => defaultMapToSessionEnd(raw)),

    // Praxis → Runtime (决策映射)
    mapAutonomyDecision: overrides?.mapAutonomyDecision
      ?? ((event, decision) => defaultMapAutonomyDecision(event, decision, runtimeName)),

    mapConstraintViolation: overrides?.mapConstraintViolation
      ?? ((event, violation) => defaultMapConstraintViolation(event, violation)),
  };
}
