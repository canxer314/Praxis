/**
 * HermesAdapter — Hermes Agent 运行时适配器测试
 *
 * 架构参考: §1 三层运行时拓扑, §11 adapters/hermes-adapter.ts
 */

import { describe, it, expect } from "vitest";
import { hermesAdapter } from "./hermes-adapter";

describe("HermesAdapter", () => {
  it("has runtimeName 'hermes'", () => {
    expect(hermesAdapter.runtimeName).toBe("hermes");
  });

  it("maps session_start from Hermes format", () => {
    const event = hermesAdapter.mapToSessionStart({
      session_id: "hermes-session-1",
      timestamp: 1719000000000,
    });
    expect(event?.type).toBe("session_start");
    expect(event?.sessionId).toBe("hermes-session-1");
  });

  it("maps message_received from Hermes message format", () => {
    const event = hermesAdapter.mapToMessageReceived({
      session_id: "hs1",
      message: { role: "user", content: "Hello from Hermes" },
    });
    expect(event?.type).toBe("message_received");
    expect(event?.message?.content).toBe("Hello from Hermes");
  });

  it("maps before_tool_call from Hermes format", () => {
    const event = hermesAdapter.mapToBeforeToolCall({
      session_id: "hs1",
      tool_name: "hermes_search",
      tool_input: { query: "test" },
    });
    expect(event?.type).toBe("before_tool_call");
    expect(event?.toolName).toBe("hermes_search");
  });

  it("maps after_tool_call from Hermes format", () => {
    const event = hermesAdapter.mapToAfterToolCall({
      session_id: "hs1",
      tool_name: "hermes_search",
      tool_input: { query: "test" },
      result: { success: true, output: "results" },
    });
    expect(event?.type).toBe("after_tool_call");
    expect(event?.result?.success).toBe(true);
  });

  it("maps agent_end from Hermes format", () => {
    const event = hermesAdapter.mapToAgentEnd({
      session_id: "hs1",
    });
    expect(event?.type).toBe("agent_end");
  });

  it("maps session_end from Hermes format", () => {
    const event = hermesAdapter.mapToSessionEnd({
      session_id: "hs1",
      transcript: "full transcript",
    });
    expect(event?.type).toBe("session_end");
    expect(event?.transcript).toBe("full transcript");
  });

  it("maps autonomy decision to Hermes instructions", () => {
    const event = hermesAdapter.mapToSessionStart({ session_id: "hs1" });
    const instruction = hermesAdapter.mapAutonomyDecision(event!, {
      action: "confirm",
      reason: "requires approval",
    });
    expect(instruction.type).toBe("confirm");
    expect(instruction.message).toContain("requires approval");
  });

  it("maps constraint violation to Hermes instructions", () => {
    const event = hermesAdapter.mapToSessionStart({ session_id: "hs1" });
    const instruction = hermesAdapter.mapConstraintViolation(event!, {
      constraintId: "c1",
      description: "must backup first",
      severity: "block",
    });
    expect(instruction.type).toBe("block");
    expect(instruction.reason).toContain("backup");
  });
});
