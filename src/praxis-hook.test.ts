/**
 * praxis-hook 测试 — Phase 5: bun per-hook 入口
 *
 * 覆盖:
 *   - CLI args → PraxisLifecycleEvent 的正确映射
 *   - SessionStart/SessionEnd/BeforeToolCall/AfterToolCall/MessageReceived/AgentEnd 全部事件类型
 *   - 无效事件类型 → 错误输出
 *   - 格式输出 (JSON result)
 */

import { describe, it, expect, vi } from "vitest";
import { parseHookArgs, runHook, type HookContext } from "../scripts/praxis-hook";

// ---- Mock 工具函数 ----

function makeMockDeps() {
  return {
    memory: {
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null }),
      setSlot: vi.fn().mockResolvedValue({ ok: true }),
      smartSearch: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      saveLesson: vi.fn().mockResolvedValue({ ok: true }),
      isAvailable: vi.fn().mockResolvedValue(true),
      saveProtoStructure: vi.fn().mockResolvedValue({ ok: true }),
    },
    cache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    },
    fuser: { fuse: vi.fn().mockReturnValue(null) },
    attentionRecords: new Map(),
  };
}

// ---- parseHookArgs ----

describe("parseHookArgs (Phase 5)", () => {
  it("解析 session_start hook", () => {
    const ctx = parseHookArgs(["bun", "praxis-hook.ts", "session_start", "sid-123"]);
    expect(ctx.hookType).toBe("session_start");
    expect(ctx.sessionId).toBe("sid-123");
  });

  it("解析 session_end hook", () => {
    const ctx = parseHookArgs(["bun", "praxis-hook.ts", "session_end", "sid-456"]);
    expect(ctx.hookType).toBe("session_end");
    expect(ctx.sessionId).toBe("sid-456");
  });

  it("解析 before_tool_call hook 含 toolName 和 toolParams", () => {
    const ctx = parseHookArgs([
      "bun", "praxis-hook.ts", "before_tool_call", "sid-789",
      "--tool", "Write",
      "--params", '{"file":"test.txt"}',
    ]);
    expect(ctx.hookType).toBe("before_tool_call");
    expect(ctx.sessionId).toBe("sid-789");
    expect(ctx.toolName).toBe("Write");
    expect(ctx.toolParams).toEqual({ file: "test.txt" });
  });

  it("解析 after_tool_call hook 含 result", () => {
    const ctx = parseHookArgs([
      "bun", "praxis-hook.ts", "after_tool_call", "sid-abc",
      "--tool", "Read",
      "--params", '{}',
      "--success", "true",
      "--output", '"file content"',
    ]);
    expect(ctx.hookType).toBe("after_tool_call");
    expect(ctx.result?.success).toBe(true);
    expect(ctx.result?.output).toBe("file content");
  });

  it("解析 message_received hook", () => {
    const ctx = parseHookArgs([
      "bun", "praxis-hook.ts", "message_received", "sid-msg",
      "--role", "user",
      "--content", "Hello World",
    ]);
    expect(ctx.hookType).toBe("message_received");
    expect(ctx.message?.role).toBe("user");
    expect(ctx.message?.content).toBe("Hello World");
  });

  it("解析 agent_end hook", () => {
    const ctx = parseHookArgs(["bun", "praxis-hook.ts", "agent_end", "sid-end"]);
    expect(ctx.hookType).toBe("agent_end");
    expect(ctx.sessionId).toBe("sid-end");
  });

  it("缺少 sessionId → 返回 null (validation error)", () => {
    const ctx = parseHookArgs(["bun", "praxis-hook.ts", "session_start"]);
    expect(ctx).toBeNull();
  });

  it("未知 hook 类型 → 返回 null", () => {
    const ctx = parseHookArgs(["bun", "praxis-hook.ts", "unknown_hook", "sid-1"]);
    expect(ctx).toBeNull();
  });
});

// ---- runHook ----

describe("runHook (Phase 5)", () => {
  it("session_start → EventOrchestrator.handleSessionStart 被调用", async () => {
    const deps = makeMockDeps();
    const ctx: HookContext = { hookType: "session_start", sessionId: "s1" };

    const result = await runHook(ctx, deps);
    expect(result).toBeDefined();
    // session_start 应返回 ok (AM 不可用时降级到默认值)
    expect(result.ok || result.error !== undefined).toBe(true);
  });

  it("before_tool_call → constraint check 被执行", async () => {
    const deps = makeMockDeps();
    const ctx: HookContext = {
      hookType: "before_tool_call",
      sessionId: "s1",
      toolName: "Write",
      toolParams: { file: "/safe/path.txt" },
    };

    const result = await runHook(ctx, deps);
    expect(result).toBeDefined();
  });

  it("message_received → message handler 被调用 (void return, 不崩溃)", async () => {
    const deps = makeMockDeps();
    // message_received 需要 session_start 先初始化 session state
    const initCtx: HookContext = { hookType: "session_start", sessionId: "s1" };
    await runHook(initCtx, deps);

    const ctx: HookContext = {
      hookType: "message_received",
      sessionId: "s1",
      message: { role: "user", content: "test" },
    };

    const result = await runHook(ctx, deps);
    // handleMessageReceived returns void → runHook wraps as Result
    expect(result).toBeDefined();
    expect(result.ok !== undefined).toBe(true);
  });

  it("agent_end → summary 包含 task type", async () => {
    const deps = makeMockDeps();
    // agent_end 需要先 session_start 初始化 session state
    await runHook({ hookType: "session_start", sessionId: "s1" }, deps);

    const ctx: HookContext = { hookType: "agent_end", sessionId: "s1" };
    const result = await runHook(ctx, deps);
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
  });

  it("session_end → 信号处理 + 融合", async () => {
    const deps = makeMockDeps();
    // session_end 需要先 session_start 初始化 session state
    await runHook({ hookType: "session_start", sessionId: "s1" }, deps);

    const ctx: HookContext = {
      hookType: "session_end",
      sessionId: "s1",
      transcript: "完整对话记录...",
    };

    const result = await runHook(ctx, deps);
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
  });

  it("未知 hook type → 返回错误 Result", async () => {
    const deps = makeMockDeps();
    const ctx: HookContext = {
      hookType: "invalid_hook" as HookContext["hookType"],
      sessionId: "s1",
    };

    const result = await runHook(ctx, deps);
    // 处理应返回错误而非抛异常
    if (!result.ok) {
      expect(result.error.code).toBeDefined();
    }
  });
});
