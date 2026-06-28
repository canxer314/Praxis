/**
 * CodexAdapter — OpenAI Codex CLI 适配器测试
 *
 * 架构参考: §1 三层运行时拓扑, §11 adapters/codex-adapter.ts
 */

import { describe, it, expect } from "vitest";
import { codexAdapter } from "./codex-adapter";

describe("CodexAdapter", () => {
  it("has runtimeName 'codex'", () => {
    expect(codexAdapter.runtimeName).toBe("codex");
  });

  it("maps session_start from Codex format", () => {
    const event = codexAdapter.mapToSessionStart({
      sessionId: "codex-session-1",
      timestamp: 1719000000000,
    });
    expect(event?.type).toBe("session_start");
    expect(event?.sessionId).toBe("codex-session-1");
  });

  it("maps message_received from Codex message format", () => {
    const event = codexAdapter.mapToMessageReceived({
      sessionId: "cs1",
      message: { role: "user", content: "Hello from Codex" },
    });
    expect(event?.type).toBe("message_received");
    expect(event?.message?.content).toBe("Hello from Codex");
  });

  it("maps before_tool_call from Codex format", () => {
    const event = codexAdapter.mapToBeforeToolCall({
      sessionId: "cs1",
      toolName: "codex_search",
      toolParams: { query: "test" },
    });
    expect(event?.type).toBe("before_tool_call");
    expect(event?.toolName).toBe("codex_search");
  });

  it("maps after_tool_call from Codex format with camelCase result", () => {
    const event = codexAdapter.mapToAfterToolCall({
      sessionId: "cs1",
      toolName: "codex_search",
      toolParams: { query: "test" },
      result: { success: true, output: "found results" },
    });
    expect(event?.type).toBe("after_tool_call");
    expect(event?.result?.success).toBe(true);
  });

  it("maps agent_end from Codex format", () => {
    const event = codexAdapter.mapToAgentEnd({
      sessionId: "cs1",
    });
    expect(event?.type).toBe("agent_end");
  });

  it("maps session_end from Codex format", () => {
    const event = codexAdapter.mapToSessionEnd({
      sessionId: "cs1",
      transcript: "codex transcript",
    });
    expect(event?.type).toBe("session_end");
    expect(event?.transcript).toBe("codex transcript");
  });

  it("maps autonomy decision to Codex instructions", () => {
    const event = codexAdapter.mapToSessionStart({ sessionId: "cs1" });
    const instruction = codexAdapter.mapAutonomyDecision(event!, {
      action: "block",
      reason: "security check required",
    });
    expect(instruction.type).toBe("block");
  });

  it("maps constraint violation to Codex instructions", () => {
    const event = codexAdapter.mapToSessionStart({ sessionId: "cs1" });
    const instruction = codexAdapter.mapConstraintViolation(event!, {
      constraintId: "c2",
      description: "must review first",
      severity: "confirm",
    });
    expect(instruction.type).toBe("confirm");
  });
});
