/**
 * types/hooks.ts — Hook 上下文类型定义
 *
 * 重新导出 7 个标准生命周期事件相关的类型。
 * 定义源在 cognitive/types.ts。
 *
 * 架构参考: §10 生命周期事件, §11 types/hooks.ts
 */

export type {
  SessionStartEvent,
  MessageReceivedEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  AgentEndEvent,
  SessionEndEvent,
  CronTickEvent,
  ToolCallRequest,
  ToolCallResult,
  ToolCallRecord,
  SessionContextInjection,
  PendingSignal,
} from "../cognitive/types";
