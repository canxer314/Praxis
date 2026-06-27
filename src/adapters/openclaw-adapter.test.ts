/**
 * OpenClaw Adapter Tests — M6.2
 * 验证 6 事件映射 + 2 决策映射的正确性
 */
import { describe, it, expect } from "vitest";
import { openclawAdapter } from "./openclaw-adapter";

describe("OpenClawAdapter — 事件映射", () => {
  it("mapToSessionStart: 映射 openclaw session.init", () => {
    const event = openclawAdapter.mapToSessionStart({
      session_id: "sess-001",
      timestamp: 1700000000000,
    });
    expect(event.type).toBe("session_start");
    expect(event.sessionId).toBe("sess-001");
    expect(event.timestamp).toBe(1700000000000);
  });

  it("mapToSessionStart: fallback sessionId", () => {
    const event = openclawAdapter.mapToSessionStart({});
    expect(event.type).toBe("session_start");
    expect(event.sessionId).toBeTruthy();
  });

  it("mapToMessageReceived: 映射用户消息", () => {
    const event = openclawAdapter.mapToMessageReceived({
      session_id: "sess-001",
      message: { role: "user", content: "hello" },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_received");
    expect(event!.message.role).toBe("user");
    expect(event!.message.content).toBe("hello");
  });

  it("mapToMessageReceived: 空消息返回 null", () => {
    const event = openclawAdapter.mapToMessageReceived({ session_id: "sess-001" });
    expect(event).toBeNull();
  });

  it("mapToMessageReceived: 使用 raw content 字段", () => {
    const event = openclawAdapter.mapToMessageReceived({
      session_id: "sess-001",
      role: "assistant",
      content: "response text",
    });
    expect(event).not.toBeNull();
    expect(event!.message.role).toBe("assistant");
    expect(event!.message.content).toBe("response text");
  });

  it("mapToBeforeToolCall: 映射 openclaw tool.pre", () => {
    const event = openclawAdapter.mapToBeforeToolCall({
      session_id: "sess-001",
      tool_name: "read_file",
      tool_input: { path: "/tmp/test.txt" },
    });
    expect(event.type).toBe("before_tool_call");
    expect(event.toolName).toBe("read_file");
    expect(event.toolParams).toEqual({ path: "/tmp/test.txt" });
  });

  it("mapToAfterToolCall: 映射成功结果", () => {
    const event = openclawAdapter.mapToAfterToolCall({
      session_id: "sess-001",
      tool_name: "read_file",
      result: { success: true, output: "file content" },
    });
    expect(event.type).toBe("after_tool_call");
    expect(event.result.success).toBe(true);
    expect(event.result.output).toBe("file content");
  });

  it("mapToAfterToolCall: 映射失败结果", () => {
    const event = openclawAdapter.mapToAfterToolCall({
      session_id: "sess-001",
      tool_name: "delete_file",
      result: { success: false, error: "permission denied" },
    });
    expect(event.type).toBe("after_tool_call");
    expect(event.result.success).toBe(false);
    expect(event.result.error).toBe("permission denied");
  });

  it("mapToAgentEnd: 映射 openclaw agent.done", () => {
    const event = openclawAdapter.mapToAgentEnd({ session_id: "sess-001" });
    expect(event.type).toBe("agent_end");
    expect(event.sessionId).toBe("sess-001");
  });

  it("mapToSessionEnd: 映射 openclaw session.close", () => {
    const event = openclawAdapter.mapToSessionEnd({
      session_id: "sess-001",
      transcript: "full transcript...",
      timestamp: 1700000000000,
    });
    expect(event.type).toBe("session_end");
    expect(event.transcript).toBe("full transcript...");
  });
});

describe("OpenClawAdapter — 决策映射", () => {
  const mockEvent = { type: "before_tool_call" as const, sessionId: "sess-001", toolName: "test", toolParams: {} };

  it("mapAutonomyDecision: proceed", () => {
    const inst = openclawAdapter.mapAutonomyDecision(mockEvent, {
      action: "proceed", reason: "safe operation",
    });
    expect(inst.type).toBe("proceed");
  });

  it("mapAutonomyDecision: inform", () => {
    const inst = openclawAdapter.mapAutonomyDecision(mockEvent, {
      action: "inform", reason: "low risk",
    });
    expect(inst.type).toBe("inform");
    expect(inst.message).toContain("low risk");
  });

  it("mapAutonomyDecision: confirm", () => {
    const inst = openclawAdapter.mapAutonomyDecision(mockEvent, {
      action: "confirm", reason: "high risk",
    });
    expect(inst.type).toBe("confirm");
    expect(inst.message).toContain("high risk");
  });

  it("mapAutonomyDecision: block", () => {
    const inst = openclawAdapter.mapAutonomyDecision(mockEvent, {
      action: "block", reason: "forbidden",
    });
    expect(inst.type).toBe("block");
    expect(inst.reason).toBe("forbidden");
  });

  it("mapConstraintViolation: block severity", () => {
    const inst = openclawAdapter.mapConstraintViolation(mockEvent, {
      constraintId: "c1", description: "must backup first", severity: "block",
    });
    expect(inst.type).toBe("block");
    expect(inst.constraintId).toBe("c1");
  });

  it("mapConstraintViolation: warn severity", () => {
    const inst = openclawAdapter.mapConstraintViolation(mockEvent, {
      constraintId: "c2", description: "consider caching", severity: "warn",
    });
    expect(inst.type).toBe("inform");
  });
});
