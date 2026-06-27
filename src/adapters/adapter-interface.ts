/**
 * AdapterInterface — M6.2 标准适配器类型
 *
 * 职责:
 *   - 定义 Agent 运行时适配器的纯函数集合
 *   - 适配器只做协议转换，不做认知处理
 *   - 每个函数输入 raw runtime event → 输出 PraxisLifecycleEvent 或 RuntimeInstruction
 *   - 无状态, 无副作用, 不调 LLM
 *
 * 对应架构 §1 三层运行时拓扑 + §10 生命周期事件。
 * cron_tick 由 Praxis 内部定时器触发，不在适配器映射范围内。
 */

import type { PraxisLifecycleEvent } from "../orchestrator";

// ══════════════════════════════════════════════════════════════════
// Praxis → Runtime 决策指令
// ══════════════════════════════════════════════════════════════════

export type RuntimeInstruction =
  | { type: "proceed"; toolCall: Record<string, unknown> }
  | { type: "inform"; message: string }
  | { type: "confirm"; message: string; toolCall: Record<string, unknown> }
  | { type: "block"; reason: string; constraintId: string }
  | { type: "inject"; systemPromptAddition: string };

// ══════════════════════════════════════════════════════════════════
// 标准适配器类型
// ══════════════════════════════════════════════════════════════════

/**
 * 标准适配器类型 — 一组纯函数的命名空间。
 * 每个运行时 (OpenClaw, Claude Code 等) 导出一个符合此类型的对象。
 * 所有函数为纯函数: 输入 raw event → 输出 PraxisLifecycleEvent 或 RuntimeInstruction。
 * 不持有状态，不调 LLM，不做认知处理。
 */
export type AgentRuntimeAdapter = {

  /** 适配器标识 (例如 "openclaw", "claude-code") */
  readonly runtimeName: string;

  // ── Runtime → Praxis (6 个生命周期事件) ──

  /** 映射运行时 session 启动事件 */
  mapToSessionStart(raw: Record<string, unknown>): PraxisLifecycleEvent;

  /** 映射运行时消息接收事件 */
  mapToMessageReceived(raw: Record<string, unknown>): PraxisLifecycleEvent | null;

  /** 映射运行时工具调用前事件 */
  mapToBeforeToolCall(raw: Record<string, unknown>): PraxisLifecycleEvent;

  /** 映射运行时工具调用后事件 */
  mapToAfterToolCall(raw: Record<string, unknown>): PraxisLifecycleEvent;

  /** 映射运行时 agent 结束事件 */
  mapToAgentEnd(raw: Record<string, unknown>): PraxisLifecycleEvent;

  /** 映射运行时 session 结束事件 */
  mapToSessionEnd(raw: Record<string, unknown>): PraxisLifecycleEvent;

  // ── Praxis → Runtime (决策映射) ──

  /** 将 Praxis 的自主性决策映射为运行时指令 */
  mapAutonomyDecision(
    event: PraxisLifecycleEvent,
    decision: { action: "proceed" | "inform" | "confirm" | "block"; reason: string },
  ): RuntimeInstruction;

  /** 将 Praxis 的约束违反映射为运行时指令 */
  mapConstraintViolation(
    event: PraxisLifecycleEvent,
    violation: { constraintId: string; description: string; severity: "block" | "confirm" | "warn" },
  ): RuntimeInstruction;
};
