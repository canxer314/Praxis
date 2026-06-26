import { describe, it, expect } from "vitest";
import { StatisticalVerifier } from "./statistical-verifier";
import type { ProtoSequence, ToolCallRecord } from "../cognitive/types";

function makeSequence(steps: { position: number; action: string }[]): ProtoSequence {
  return {
    id: "seq_test", protoType: "sequence", tentativeName: "test", scenarioId: "test",
    confidence: 0.5, observationsCount: 3, adoptionRate: 0.5, lifecycle: "experimental",
    relations: [], versionChain: [], createdAt: Date.now(), updatedAt: Date.now(),
    structure: { steps: steps.map((s) => ({ ...s, agent: "test" })) },
    function: { purpose: "", precondition: [], postcondition: [], failureModes: [] },
    teleologicalMapping: [],
  };
}

function makeToolCalls(names: string[]): ToolCallRecord[] {
  return names.map((n, i) => ({
    toolName: n, toolParams: {}, result: { success: true }, timestamp: Date.now() + i,
  }));
}

describe("StatisticalVerifier", () => {
  it("完全匹配 → high score", async () => {
    const v = new StatisticalVerifier();
    const seq = makeSequence([{ position: 1, action: "npm test" }, { position: 2, action: "tsc" }]);
    const ctx = { sessionId: "s1", toolCallTrace: makeToolCalls(["npm test", "tsc"]), transcript: "" };

    const result = await v.verify(seq, ctx);
    expect(result.value).toBeGreaterThan(0.8);
    expect(result.matchDetails).toHaveLength(2);
  });

  it("完全不匹配 → low score", async () => {
    const v = new StatisticalVerifier();
    const seq = makeSequence([{ position: 1, action: "docker_deploy" }]);
    const ctx = { sessionId: "s2", toolCallTrace: makeToolCalls(["npm test", "tsc"]), transcript: "" };

    const result = await v.verify(seq, ctx);
    expect(result.value).toBeLessThan(0.5);
  });

  it("非 ProtoSequence → 返回默认 0.5", async () => {
    const v = new StatisticalVerifier();
    const concept = { id: "c1", protoType: "concept" as const, tentativeName: "x", scenarioId: "x",
      confidence: 0.5, observationsCount: 1, adoptionRate: 0, lifecycle: "experimental" as const,
      relations: [], versionChain: [], createdAt: 0, updatedAt: 0,
      definition: "test", relatedConcepts: [] };

    const result = await v.verify(concept, { sessionId: "s3", toolCallTrace: [], transcript: "" });
    expect(result.value).toBe(0.5);
    expect(result.confidence).toBe(0);
  });
});
