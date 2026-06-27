/**
 * ClaudeCode Adapter Tests — M6.3
 * 验证 6 事件映射 + Notification 过滤 + 2 决策映射
 */
import { describe, it, expect } from "vitest";
import { claudeCodeAdapter } from "./claude-code-adapter";

describe("ClaudeCodeAdapter — 事件映射", () => {
  it("mapToSessionStart: 映射 session start", () => {
    const event = claudeCodeAdapter.mapToSessionStart({
      session_id: "claude-sess-001",
      timestamp: 1700000000000,
    });
    expect(event.type).toBe("session_start");
    expect(event.sessionId).toBe("claude-sess-001");
  });

  it("mapToMessageReceived: 映射 user_message notification", () => {
    const event = claudeCodeAdapter.mapToMessageReceived({
      session_id: "sess-001",
      notification_type: "user_message",
      message: { role: "user", content: "hello" },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_received");
    expect(event!.message.content).toBe("hello");
  });

  it("mapToMessageReceived: 过滤非 user_message notification", () => {
    const event = claudeCodeAdapter.mapToMessageReceived({
      session_id: "sess-001",
      notification_type: "permission_request",
      message: { role: "system", content: "allow tool?" },
    });
    expect(event).toBeNull();
  });

  it("mapToMessageReceived: 无 notification_type 默认映射", () => {
    const event = claudeCodeAdapter.mapToMessageReceived({
      session_id: "sess-001",
      message: { role: "user", content: "hi" },
    });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message_received");
  });

  it("mapToBeforeToolCall: 映射 PreToolUse", () => {
    const event = claudeCodeAdapter.mapToBeforeToolCall({
      session_id: "sess-001",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    expect(event.type).toBe("before_tool_call");
    expect(event.toolName).toBe("Bash");
  });

  it("mapToAfterToolCall: 映射 PostToolUse 成功", () => {
    const event = claudeCodeAdapter.mapToAfterToolCall({
      session_id: "sess-001",
      tool_name: "Read",
      result: { success: true, output: "file contents" },
    });
    expect(event.type).toBe("after_tool_call");
    expect(event.result.success).toBe(true);
  });

  it("mapToAfterToolCall: 使用 tool_result 字段", () => {
    const event = claudeCodeAdapter.mapToAfterToolCall({
      session_id: "sess-001",
      tool_name: "Write",
      tool_result: { success: false, error: "disk full" },
    });
    expect(event.result.error).toBe("disk full");
  });

  it("mapToAgentEnd: 映射 Stop", () => {
    const event = claudeCodeAdapter.mapToAgentEnd({ session_id: "sess-001" });
    expect(event.type).toBe("agent_end");
  });

  it("mapToSessionEnd: 映射 SessionEnd", () => {
    const event = claudeCodeAdapter.mapToSessionEnd({
      session_id: "sess-001",
      transcript: "full history...",
    });
    expect(event.type).toBe("session_end");
    expect(event.transcript).toBe("full history...");
  });
});

describe("ClaudeCodeAdapter — 决策映射", () => {
  const mockEvent = { type: "before_tool_call" as const, sessionId: "s", toolName: "t", toolParams: {} };

  it("mapAutonomyDecision: 四种 action", () => {
    expect(claudeCodeAdapter.mapAutonomyDecision(mockEvent, { action: "proceed", reason: "ok" }).type).toBe("proceed");
    expect(claudeCodeAdapter.mapAutonomyDecision(mockEvent, { action: "inform", reason: "fyi" }).type).toBe("inform");
    expect(claudeCodeAdapter.mapAutonomyDecision(mockEvent, { action: "confirm", reason: "check" }).type).toBe("confirm");
    expect(claudeCodeAdapter.mapAutonomyDecision(mockEvent, { action: "block", reason: "no" }).type).toBe("block");
  });

  it("mapConstraintViolation: 三种 severity", () => {
    const block = claudeCodeAdapter.mapConstraintViolation(mockEvent, {
      constraintId: "c1", description: "backup first", severity: "block",
    });
    expect(block.type).toBe("block");

    const confirm = claudeCodeAdapter.mapConstraintViolation(mockEvent, {
      constraintId: "c2", description: "check config", severity: "confirm",
    });
    expect(confirm.type).toBe("confirm");

    const warn = claudeCodeAdapter.mapConstraintViolation(mockEvent, {
      constraintId: "c3", description: "consider linting", severity: "warn",
    });
    expect(warn.type).toBe("inform");
  });
});
