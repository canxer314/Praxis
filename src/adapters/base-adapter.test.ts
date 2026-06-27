/**
 * base-adapter.test.ts — T18: 共享适配器基础逻辑测试
 *
 * 验证 extractBaseAdapter 工厂函数的映射逻辑:
 *   - 6 个生命周期事件映射
 *   - 2 个决策映射
 *   - 平台特定覆盖 (overrides)
 *   - 消息过滤钩子
 */

import { describe, it, expect } from "vitest";
import { createBaseAdapter } from "./base-adapter";
import type { PraxisLifecycleEvent } from "../orchestrator";
import type { RuntimeInstruction, AgentRuntimeAdapter } from "./adapter-interface";

// ── helpers ──

function makeAdapter(overrides?: Partial<AgentRuntimeAdapter>): AgentRuntimeAdapter {
  return createBaseAdapter("test-runtime", overrides);
}

// ── T18.1: session_start mapping ──

describe("createBaseAdapter — mapToSessionStart", () => {
  it("maps session_id and timestamp", () => {
    const a = makeAdapter();
    const e = a.mapToSessionStart({ session_id: "s1", timestamp: 1000 });
    expect(e.type).toBe("session_start");
    expect(e.sessionId).toBe("s1");
    expect(e.timestamp).toBe(1000);
  });

  it("falls back to sessionId camelCase", () => {
    const a = makeAdapter();
    const e = a.mapToSessionStart({ sessionId: "s2", timestamp: 2000 });
    expect(e.sessionId).toBe("s2");
  });

  it("generates sessionId when neither field present", () => {
    const a = makeAdapter();
    const e = a.mapToSessionStart({});
    expect(e.sessionId).toContain("test-runtime-");
    expect(e.timestamp).toBeGreaterThan(0);
  });
});

// ── T18.2: message_received mapping ──

describe("createBaseAdapter — mapToMessageReceived", () => {
  it("maps message content from raw.message", () => {
    const a = makeAdapter();
    const e = a.mapToMessageReceived({
      session_id: "s1",
      message: { role: "user", content: "hello" },
    });
    expect(e).not.toBeNull();
    expect(e!.type).toBe("message_received");
    expect(e!.message).toEqual({ role: "user", content: "hello" });
  });

  it("maps message from raw.content fallback", () => {
    const a = makeAdapter();
    const e = a.mapToMessageReceived({
      session_id: "s1",
      content: { role: "assistant", content: "hi" },
    });
    expect(e).not.toBeNull();
    expect(e!.message.role).toBe("assistant");
  });

  it("maps role/content from raw root level", () => {
    const a = makeAdapter();
    const e = a.mapToMessageReceived({
      session_id: "s1",
      role: "user",
      content: "root level message",
    });
    expect(e).not.toBeNull();
    expect(e!.message.content).toBe("root level message");
  });

  it("returns null when content is empty", () => {
    const a = makeAdapter();
    const e = a.mapToMessageReceived({ session_id: "s1", message: { role: "user", content: "" } });
    expect(e).toBeNull();
  });

  it("respects filterMessage override returning null", () => {
    const a = makeAdapter({
      mapToMessageReceived(raw: Record<string, unknown>): PraxisLifecycleEvent | null {
        // Override filters out non-user_message notifications
        const nt = String(raw.notification_type ?? "");
        if (nt && nt !== "user_message") return null;
        // Fall through to base logic via raw manipulation
        return null as unknown as PraxisLifecycleEvent; // placeholder
      },
    });
    // With full override, the adapter uses the override directly
    // This test verifies the override mechanism works
    const e = a.mapToMessageReceived({
      notification_type: "idle",
      session_id: "s1",
      message: { role: "user", content: "test" },
    });
    expect(e).toBeNull();
  });

  it("passes through non-null results from override", () => {
    const a = createBaseAdapter("test-runtime", {
      mapToMessageReceived(raw: Record<string, unknown>): PraxisLifecycleEvent {
        return {
          type: "message_received",
          sessionId: String(raw.sid ?? ""),
          message: { role: "user", content: String(raw.msg ?? "") },
          timestamp: Date.now(),
        };
      },
    });
    const e = a.mapToMessageReceived({ sid: "custom", msg: "custom msg" });
    expect(e).not.toBeNull();
    expect(e!.sessionId).toBe("custom");
    expect(e!.message.content).toBe("custom msg");
  });
});

// ── T18.3: before_tool_call mapping ──

describe("createBaseAdapter — mapToBeforeToolCall", () => {
  it("maps tool_name and tool_input", () => {
    const a = makeAdapter();
    const e = a.mapToBeforeToolCall({
      session_id: "s1",
      tool_name: "read_file",
      tool_input: { path: "/tmp/x" },
    });
    expect(e.type).toBe("before_tool_call");
    expect(e.toolName).toBe("read_file");
    expect(e.toolParams).toEqual({ path: "/tmp/x" });
  });

  it("falls back to camelCase toolName/toolParams", () => {
    const a = makeAdapter();
    const e = a.mapToBeforeToolCall({
      session_id: "s1",
      toolName: "write_file",
      toolParams: { path: "/tmp/y" },
    });
    expect(e.toolName).toBe("write_file");
    expect(e.toolParams).toEqual({ path: "/tmp/y" });
  });
});

// ── T18.4: after_tool_call mapping ──

describe("createBaseAdapter — mapToAfterToolCall", () => {
  it("maps result with success flag", () => {
    const a = makeAdapter();
    const e = a.mapToAfterToolCall({
      session_id: "s1",
      tool_name: "read_file",
      tool_input: { path: "/tmp/x" },
      result: { success: true, output: "file contents" },
    });
    expect(e.type).toBe("after_tool_call");
    expect(e.result.success).toBe(true);
    expect(e.result.output).toBe("file contents");
  });

  it("maps error from result.error string", () => {
    const a = makeAdapter();
    const e = a.mapToAfterToolCall({
      session_id: "s1",
      tool_name: "rm",
      result: { success: false, error: "permission denied" },
    });
    expect(e.result.success).toBe(false);
    expect(e.result.error).toBe("permission denied");
  });

  it("defaults success to true when missing", () => {
    const a = makeAdapter();
    const e = a.mapToAfterToolCall({
      session_id: "s1",
      tool_name: "ls",
      result: {},
    });
    expect(e.result.success).toBe(true);
  });
});

// ── T18.5: agent_end mapping ──

describe("createBaseAdapter — mapToAgentEnd", () => {
  it("maps session_id to agent_end event", () => {
    const a = makeAdapter();
    const e = a.mapToAgentEnd({ session_id: "s1" });
    expect(e.type).toBe("agent_end");
    expect(e.sessionId).toBe("s1");
  });
});

// ── T18.6: session_end mapping ──

describe("createBaseAdapter — mapToSessionEnd", () => {
  it("maps transcript and timestamp", () => {
    const a = makeAdapter();
    const e = a.mapToSessionEnd({
      session_id: "s1",
      transcript: "full transcript...",
      timestamp: 5000,
    });
    expect(e.type).toBe("session_end");
    expect(e.sessionId).toBe("s1");
    expect(e.transcript).toBe("full transcript...");
    expect(e.timestamp).toBe(5000);
  });

  it("handles missing transcript", () => {
    const a = makeAdapter();
    const e = a.mapToSessionEnd({ session_id: "s1" });
    expect(e.transcript).toBeUndefined();
  });
});

// ── T18.7: decision mappings ──

describe("createBaseAdapter — mapAutonomyDecision", () => {
  const event: PraxisLifecycleEvent = {
    type: "before_tool_call",
    sessionId: "s1",
    toolName: "test",
    toolParams: {},
  };

  it("maps proceed → proceed instruction", () => {
    const a = makeAdapter();
    const r = a.mapAutonomyDecision(event, { action: "proceed", reason: "ok" });
    expect(r.type).toBe("proceed");
  });

  it("maps inform → inform instruction with reason", () => {
    const a = makeAdapter();
    const r = a.mapAutonomyDecision(event, { action: "inform", reason: "low risk" });
    expect(r.type).toBe("inform");
    expect((r as { message: string }).message).toContain("low risk");
  });

  it("maps confirm → confirm instruction", () => {
    const a = makeAdapter();
    const r = a.mapAutonomyDecision(event, { action: "confirm", reason: "needs check" });
    expect(r.type).toBe("confirm");
  });

  it("maps block → block instruction with constraintId", () => {
    const a = makeAdapter();
    const r = a.mapAutonomyDecision(event, { action: "block", reason: "dangerous" });
    expect(r.type).toBe("block");
    expect((r as { constraintId: string }).constraintId).toBeDefined();
  });
});

// ── T18.8: constraint violation mapping ──

describe("createBaseAdapter — mapConstraintViolation", () => {
  const event: PraxisLifecycleEvent = {
    type: "before_tool_call",
    sessionId: "s1",
    toolName: "test",
    toolParams: {},
  };

  it("maps block severity → block instruction", () => {
    const a = makeAdapter();
    const r = a.mapConstraintViolation(event, {
      constraintId: "c1", description: "must backup first", severity: "block",
    });
    expect(r.type).toBe("block");
    expect((r as { constraintId: string }).constraintId).toBe("c1");
  });

  it("maps confirm severity → confirm instruction", () => {
    const a = makeAdapter();
    const r = a.mapConstraintViolation(event, {
      constraintId: "c2", description: "check", severity: "confirm",
    });
    expect(r.type).toBe("confirm");
  });

  it("maps warn severity → inform instruction", () => {
    const a = makeAdapter();
    const r = a.mapConstraintViolation(event, {
      constraintId: "c3", description: "note", severity: "warn",
    });
    expect(r.type).toBe("inform");
  });
});

// ── T18.9: runtimeName ──

describe("createBaseAdapter — runtimeName", () => {
  it("reflects the runtime name passed to factory", () => {
    const a = createBaseAdapter("my-platform");
    expect(a.runtimeName).toBe("my-platform");
  });
});

// ── T18.10: partial overrides work ──

describe("createBaseAdapter — partial overrides", () => {
  it("uses override for mapToAgentEnd while keeping base for others", () => {
    const a = createBaseAdapter("test-runtime", {
      mapToAgentEnd(raw: Record<string, unknown>): PraxisLifecycleEvent {
        return {
          type: "agent_end",
          sessionId: `overridden-${raw.session_id}`,
        };
      },
    });
    // Overridden path
    const agentEnd = a.mapToAgentEnd({ session_id: "s1" });
    expect(agentEnd.sessionId).toBe("overridden-s1");

    // Non-overridden path still works
    const sessionStart = a.mapToSessionStart({ session_id: "s1", timestamp: 1 });
    expect(sessionStart.sessionId).toBe("s1");
  });
});
