import { describe, it, expect } from "vitest";
import { transition, canCrystallize, canDegrade, shouldMarkInactive } from "./structure-lifecycle";
import type { ProtoStructure } from "./cognitive/types";

function makePS(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "test-1",
    protoType: "sequence",
    tentativeName: "Test",
    scenarioId: "test",
    confidence: 0.5,
    observationsCount: 3,
    adoptionRate: 0.5,
    lifecycle: "hypothesized",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    structure: { steps: [] },
    function: { purpose: "", precondition: [], postcondition: [], failureModes: [] },
    teleologicalMapping: [],
    ...overrides,
  } as ProtoStructure;
}

describe("transition", () => {
  it("hypothesized → candidate", () => {
    const s = makePS({ lifecycle: "hypothesized" });
    expect(transition(s, "advance")).toBe("candidate");
  });

  it("candidate → experimental", () => {
    const s = makePS({ lifecycle: "candidate" });
    expect(transition(s, "advance")).toBe("experimental");
  });

  it("experimental → crystallized", () => {
    const s = makePS({ lifecycle: "experimental" });
    expect(transition(s, "crystallize")).toBe("crystallized");
  });

  it("crystallized → degraded (back to experimental)", () => {
    const s = makePS({ lifecycle: "crystallized" });
    expect(transition(s, "degrade")).toBe("experimental");
  });

  it("crystallized → deprecated", () => {
    const s = makePS({ lifecycle: "crystallized" });
    expect(transition(s, "deprecate")).toBe("deprecated");
  });

  it("deprecated → reactivated → experimental", () => {
    const s = makePS({ lifecycle: "deprecated" });
    expect(transition(s, "reactivate")).toBe("experimental");
  });

  it("rejected 不接受任何事件", () => {
    const s = makePS({ lifecycle: "rejected" });
    expect(transition(s, "advance")).toBe("rejected");
    expect(transition(s, "reactivate")).toBe("rejected");
  });

  it("无效事件 → 返回原状态", () => {
    const s = makePS({ lifecycle: "hypothesized" });
    expect(transition(s, "crystallize")).toBe("hypothesized");
  });
});

describe("canCrystallize", () => {
  it("置信度和观察次数都满足", () => {
    const s = makePS({ confidence: 0.85, observationsCount: 10, lifecycle: "experimental" });
    expect(canCrystallize(s).allowed).toBe(true);
  });

  it("置信度不足", () => {
    const s = makePS({ confidence: 0.5, observationsCount: 10, lifecycle: "experimental" });
    const result = canCrystallize(s);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy.some((r) => r.includes("置信度"))).toBe(true);
  });

  it("观察次数不足", () => {
    const s = makePS({ confidence: 0.85, observationsCount: 2, lifecycle: "experimental" });
    const result = canCrystallize(s);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy.some((r) => r.includes("观察次数"))).toBe(true);
  });
});

describe("canDegrade", () => {
  it("≥3 反例 → 应退化", () => {
    const s = makePS({ confidence: 0.85, lifecycle: "crystallized" });
    const result = canDegrade(s, 5, 30);
    expect(result.shouldDegrade).toBe(true);
    expect(result.reasons.some((r) => r.includes("反例"))).toBe(true);
  });

  it("低置信度 + 60 天 → 应退化", () => {
    const s = makePS({ confidence: 0.15, lifecycle: "crystallized" });
    const result = canDegrade(s, 1, 65);
    expect(result.shouldDegrade).toBe(true);
  });

  it("正常条件 → 不应退化", () => {
    const s = makePS({ confidence: 0.85, lifecycle: "crystallized" });
    const result = canDegrade(s, 1, 30);
    expect(result.shouldDegrade).toBe(false);
  });
});

describe("shouldMarkInactive", () => {
  it("crystallized + 60 天未使用 → inactive", () => {
    const s = makePS({ lifecycle: "crystallized" });
    expect(shouldMarkInactive(s, 65)).toBe(true);
  });

  it("crystallized + 30 天 → not inactive", () => {
    const s = makePS({ lifecycle: "crystallized" });
    expect(shouldMarkInactive(s, 30)).toBe(false);
  });

  it("experimental + 60 天 → 不标记 (仅 crystallized)", () => {
    const s = makePS({ lifecycle: "experimental" });
    expect(shouldMarkInactive(s, 65)).toBe(false);
  });
});
