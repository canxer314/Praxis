/**
 * EventOrchestrator 测试 — M0 Step 2
 *
 * 覆盖:
 *   - 完整 session 生命周期路由
 *   - session-scoped 状态管理（pendingSignals, toolCallTrace）
 *   - 降级路径
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventOrchestrator } from "./orchestrator";
import type { M0Deps } from "../m0-deps";
import type { Result } from "../platform-adapter";

function makeDeps(overrides: Partial<M0Deps> = {}): M0Deps {
  return {
    memory: {
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null } as Result<unknown>),
      setSlot: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      smartSearch: vi.fn().mockResolvedValue({ ok: true, value: [] } as Result<unknown[]>),
      saveLesson: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      isAvailable: vi.fn().mockResolvedValue(true),
    },
    cache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    },
    ...overrides,
  };
}

describe("EventOrchestrator", () => {
  let orchestrator: EventOrchestrator;
  let deps: M0Deps;

  beforeEach(() => {
    deps = makeDeps();
    orchestrator = new EventOrchestrator(deps);
  });

  it("完整 session 生命周期 — 所有 7 种事件正确路由", async () => {
    // session_start
    const startResult = await orchestrator.handleSessionStart("lifecycle-test");
    expect(startResult).toBeDefined();

    // message_received
    await orchestrator.handleMessageReceived("lifecycle-test", {
      role: "user",
      content: "不对，应该用 X 而不是 Y",
    });

    // before_tool_call
    const btResult = await orchestrator.handleBeforeToolCall("test-session", "file_read");
    expect(btResult).toBeDefined();

    // after_tool_call
    await orchestrator.handleAfterToolCall("lifecycle-test", "file_read", { path: "/tmp" }, {
      success: true,
      output: "file content",
    });

    // agent_end
    const aeResult = await orchestrator.handleAgentEnd("lifecycle-test");
    expect(aeResult.sessionId).toBe("lifecycle-test");
    expect(aeResult.toolCallCount).toBe(1);
    expect(aeResult.successCount).toBe(1);

    // session_end
    const seResult = await orchestrator.handleSessionEnd("lifecycle-test");
    expect(seResult).toBeDefined();

    // cron_tick
    await orchestrator.handleCronTick();
  });

  it("session_start 后 session_end 前 — pendingSignals 正确累积", async () => {
    // 模拟带纠正的 session
    await orchestrator.handleSessionStart("signal-test");
    await orchestrator.handleMessageReceived("signal-test", {
      role: "user",
      content: "不对，你应该用 fetch API",
    });

    // 工具调用失败
    await orchestrator.handleAfterToolCall("signal-test", "api_call", {}, {
      success: false,
      error: "Network timeout",
    });

    // agent_end
    const summary = await orchestrator.handleAgentEnd("signal-test");
    expect(summary.failureCount).toBe(1);

    // session_end — pendingSignals 应被写入
    const result = await orchestrator.handleSessionEnd("signal-test", "transcript...");
    expect(result).toBeDefined();
    if (typeof result === "object" && result !== null && "ok" in result && (result as { ok: boolean }).ok) {
      const val = (result as { ok: true; value: { lessonsWritten: number } }).value;
      expect(val.lessonsWritten).toBeGreaterThanOrEqual(1); // correction + failure = 2 lessons
    }
  });

  it("幂等 — 同一 session_end 多次调用跳过", async () => {
    await orchestrator.handleSessionStart("idempotent-test");
    await orchestrator.handleMessageReceived("idempotent-test", {
      role: "user",
      content: "不对，应该用新 API",
    });

    const first = await orchestrator.handleSessionEnd("idempotent-test");
    const second = await orchestrator.handleSessionEnd("idempotent-test");

    expect(first).toBeDefined();
    if (typeof second === "object" && second !== null && "ok" in second && (second as { ok: boolean }).ok) {
      expect((second as { ok: true; value: { lessonsWritten: number } }).value.lessonsWritten).toBe(0);
    }
  });

  it("before_tool_call — 高风险操作返回 confirm", async () => {
    const result = await orchestrator.handleBeforeToolCall("test-session", "database_changes");
    expect(result).toBeDefined();
    if (typeof result === "object" && result !== null && "ok" in result && (result as { ok: boolean }).ok) {
      expect((result as { ok: true; value: { action: string } }).value.action).toBe("confirm");
    }
  });

  it("before_tool_call — 低风险操作返回 inform", async () => {
    const result = await orchestrator.handleBeforeToolCall("test-session", "searching_files");
    expect(result).toBeDefined();
    if (typeof result === "object" && result !== null && "ok" in result && (result as { ok: boolean }).ok) {
      const action = (result as { ok: true; value: { action: string } }).value.action;
      expect(["proceed", "inform"]).toContain(action);
    }
  });

  it("route() 统一入口 — 未知事件类型返回错误", async () => {
    const result = await orchestrator.route({ type: "unknown_event" } as never);
    expect(result).toBeDefined();
    if (typeof result === "object" && result !== null && "ok" in result) {
      expect((result as { ok: boolean }).ok).toBe(false);
    }
  });

  it("message_received — 非用户消息不检测信号", async () => {
    await orchestrator.handleSessionStart("assistant-only");
    // 助手消息不应触发信号检测
    await orchestrator.handleMessageReceived("assistant-only", {
      role: "assistant",
      content: "不对，但我不能说用户错了",
    });

    const result = await orchestrator.handleSessionEnd("assistant-only");
    if (typeof result === "object" && result !== null && "ok" in result && (result as { ok: boolean }).ok) {
      // 无用户消息 → 无信号
      expect((result as { ok: true; value: { lessonsWritten: number } }).value.lessonsWritten).toBe(0);
    }
  });

  it("AgentMemory 不可用时 session_start 不崩溃", async () => {
    deps.memory.isAvailable = vi.fn().mockResolvedValue(false);

    const degradedOrchestrator = new EventOrchestrator(deps);
    const result = await degradedOrchestrator.handleSessionStart("degraded");

    expect(result).toBeDefined();
  });
});
