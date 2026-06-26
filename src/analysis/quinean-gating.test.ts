import { describe, it, expect } from "vitest";
import { QuineanGating } from "./quinean-gating";
import type { ProtoStructure } from "../cognitive/types";

function makeSequence(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "seq_test", protoType: "sequence", tentativeName: "test", scenarioId: "test",
    confidence: 0.85, observationsCount: 10, adoptionRate: 0.8,
    lifecycle: "experimental", relations: [], versionChain: [],
    createdAt: Date.now(), updatedAt: Date.now(),
    structure: { steps: [] },
    function: { purpose: "", precondition: [], postcondition: [], failureModes: [] },
    teleologicalMapping: [],
    ...overrides,
  } as ProtoStructure;
}

describe("QuineanGating", () => {
  it("全部通过 → passed=true", () => {
    const gating = new QuineanGating();
    const result = gating.check(makeSequence(), {
      sessionsWithStructure: 8, sessionsWithoutStructure: 4,
      accuracyWithStructure: 0.85, accuracyWithoutStructure: 0.65,
      alternativeStructureIds: [], alternativeAccuracies: new Map(),
    });
    expect(result.necessity).toBe(true);
    expect(result.sufficiency).toBe(true);
    expect(result.parsimony).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("样本不足 → blocked", () => {
    const gating = new QuineanGating();
    const result = gating.check(makeSequence(), {
      sessionsWithStructure: 3, sessionsWithoutStructure: 2,
      accuracyWithStructure: 0.8, accuracyWithoutStructure: 0.7,
      alternativeStructureIds: [], alternativeAccuracies: new Map(),
    });
    expect(result.passed).toBe(false);
    expect(result.blockedBy[0]).toContain("Insufficient sessions");
  });

  it("低准确率结构 → sufficiency 失败", () => {
    const gating = new QuineanGating();
    const result = gating.check(makeSequence(), {
      sessionsWithStructure: 8, sessionsWithoutStructure: 4,
      accuracyWithStructure: 0.55, accuracyWithoutStructure: 0.30, // below 65% absolute
      alternativeStructureIds: [], alternativeAccuracies: new Map(),
    });
    expect(result.sufficiency).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("非 ProtoSequence → blocked", () => {
    const gating = new QuineanGating();
    const concept = { ...makeSequence(), protoType: "concept" as const };
    const result = gating.check(concept, {
      sessionsWithStructure: 10, sessionsWithoutStructure: 5,
      accuracyWithStructure: 0.9, accuracyWithoutStructure: 0.5,
      alternativeStructureIds: [], alternativeAccuracies: new Map(),
    });
    expect(result.passed).toBe(false);
    expect(result.blockedBy[0]).toContain("ProtoSequence");
  });
});
