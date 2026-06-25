/**
 * EventOrchestrator — M0 纯函数事件路由器
 *
 * 职责:
 *   - 将 7 种标准生命周期事件路由到对应的处理器
 *   - 管理 session-scoped 状态（pendingSignals、toolCallTrace）
 *   - 不包含业务逻辑 — 所有决策委托给具体处理器
 *
 * 与 CognitiveCore 的关系: orchestrator 是新的入口点，CognitiveCore 保留
 * 作为兼容层。新代码应使用 orchestrator。
 */

import type { Result } from "./platform-adapter";
import type { M0Deps } from "./m0-deps";
import type { PendingSignal, ToolCallRecord } from "./cognitive/types";
import { SessionStartHandler } from "./session-start";
import { SessionEndHandler } from "./session-end";
import { MessageReceivedHandler } from "./message-received";
import { BeforeToolCallHandler } from "./before-tool-call";
import { AfterToolCallHandler } from "./after-tool-call";
import { AgentEndHandler, type AgentEndSummary } from "./agent-end";
import { CronTickHandler } from "./cron-tick";

// ══════════════════════════════════════════════════════════════════
// 事件类型
// ══════════════════════════════════════════════════════════════════

export type PraxisLifecycleEvent =
  | { type: "session_start"; sessionId: string; timestamp: number }
  | { type: "message_received"; sessionId: string; message: { role: "user" | "assistant"; content: string }; timestamp: number }
  | { type: "before_tool_call"; sessionId: string; toolName: string; toolParams: Record<string, unknown> }
  | { type: "after_tool_call"; sessionId: string; toolName: string; toolParams: Record<string, unknown>; result: { success: boolean; output?: unknown; error?: string } }
  | { type: "agent_end"; sessionId: string }
  | { type: "session_end"; sessionId: string; transcript?: string; timestamp: number }
  | { type: "cron_tick"; timestamp: number };

// ══════════════════════════════════════════════════════════════════
// Session 状态
// ══════════════════════════════════════════════════════════════════

interface SessionState {
  pendingSignals: PendingSignal[];
  toolCallTrace: ToolCallRecord[];
}

// ══════════════════════════════════════════════════════════════════
// Orchestrator
// ══════════════════════════════════════════════════════════════════

export class EventOrchestrator {
  private readonly deps: M0Deps;
  private readonly sessionStart: SessionStartHandler;
  private readonly sessionEnd: SessionEndHandler;
  private readonly beforeToolCall: BeforeToolCallHandler;
  private readonly cronTick: CronTickHandler;

  /** 活跃 session 的状态 (sessionId → state) */
  private readonly sessions = new Map<string, SessionState>();

  constructor(deps: M0Deps) {
    this.deps = deps;
    this.sessionStart = new SessionStartHandler(deps);
    this.sessionEnd = new SessionEndHandler(deps);
    this.beforeToolCall = new BeforeToolCallHandler(deps);
    this.cronTick = new CronTickHandler(deps);
  }

  // ════════════════════════════════════════════════════════════════
  // 公开 API — 每个事件类型一个方法
  // ════════════════════════════════════════════════════════════════

  async handleSessionStart(sessionId: string) {
    // 初始化 session 状态
    this.sessions.set(sessionId, { pendingSignals: [], toolCallTrace: [] });
    return this.sessionStart.handle(sessionId);
  }

  async handleMessageReceived(sessionId: string, message: { role: "user" | "assistant"; content: string }) {
    const state = this.getOrCreateState(sessionId);
    const handler = new MessageReceivedHandler(this.deps, state.pendingSignals);
    await handler.handle(sessionId, message);
  }

  async handleBeforeToolCall(toolName: string) {
    return this.beforeToolCall.handle(toolName);
  }

  async handleAfterToolCall(
    sessionId: string,
    toolName: string,
    toolParams: Record<string, unknown>,
    result: { success: boolean; output?: unknown; error?: string },
  ) {
    const state = this.getOrCreateState(sessionId);
    const handler = new AfterToolCallHandler(this.deps, state.toolCallTrace, state.pendingSignals);
    await handler.handle(sessionId, toolName, toolParams, result);
  }

  async handleAgentEnd(sessionId: string): Promise<AgentEndSummary> {
    const state = this.getOrCreateState(sessionId);
    const handler = new AgentEndHandler(this.deps, state.toolCallTrace);
    return handler.handle(sessionId);
  }

  async handleSessionEnd(sessionId: string, transcript?: string) {
    const state = this.getOrCreateState(sessionId);
    const result = await this.sessionEnd.handle(sessionId, transcript ?? null, state.pendingSignals);
    // 清理 session 状态
    this.sessions.delete(sessionId);
    return result;
  }

  async handleCronTick() {
    await this.cronTick.handle();
  }

  // ════════════════════════════════════════════════════════════════
  // 统一路由 — 根据事件类型分发
  // ════════════════════════════════════════════════════════════════

  async route(event: PraxisLifecycleEvent): Promise<unknown> {
    switch (event.type) {
      case "session_start":
        return this.handleSessionStart(event.sessionId);
      case "message_received":
        return this.handleMessageReceived(event.sessionId, event.message);
      case "before_tool_call":
        return this.handleBeforeToolCall(event.toolName);
      case "after_tool_call":
        return this.handleAfterToolCall(event.sessionId, event.toolName, event.toolParams, event.result);
      case "agent_end":
        return this.handleAgentEnd(event.sessionId);
      case "session_end":
        return this.handleSessionEnd(event.sessionId, event.transcript);
      case "cron_tick":
        return this.handleCronTick();
      default:
        return { ok: false, error: { code: "UNKNOWN_EVENT", message: `Unknown event type: ${(event as PraxisLifecycleEvent).type}` } };
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 内部
  // ════════════════════════════════════════════════════════════════

  private getOrCreateState(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { pendingSignals: [], toolCallTrace: [] };
      this.sessions.set(sessionId, state);
    }
    return state;
  }
}
