import { describe, it, expect } from "vitest";
import { createVersion, rollback, getVersion, diffVersions, versionSummary } from "./structure-version";
import type { ProtoStructure, VersionSnapshot } from "./cognitive/types";

function makePS(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "test-1", protoType: "sequence", tentativeName: "Test", scenarioId: "test",
    confidence: 0.5, observationsCount: 3, adoptionRate: 0.5,
    lifecycle: "experimental", relations: [], versionChain: [],
    createdAt: Date.now(), updatedAt: Date.now(),
    structure: { steps: [] },
    function: { purpose: "", precondition: [], postcondition: [], failureModes: [] },
    teleologicalMapping: [],
    ...overrides,
  } as ProtoStructure;
}

function makeDiff(path: string, type: VersionSnapshot["diff"][0]["type"] = "step_added"): VersionSnapshot["diff"][0] {
  return { type, path, oldValue: null, newValue: "new" };
}

describe("createVersion", () => {
  it("创建第一个版本", () => {
    const s = makePS();
    const vid = createVersion(s, "auto_refinement", [makeDiff("structure.steps[0]")], "init");
    expect(vid).toBe("v1");
    expect(s.versionChain).toHaveLength(1);
    expect(s.versionChain[0].parentVersion).toBeNull();
  });

  it("创建第二个版本 — parent 指向 v1", () => {
    const s = makePS();
    createVersion(s, "auto_refinement", [], "first");
    const vid = createVersion(s, "user_correction", [], "second");
    expect(vid).toBe("v2");
    expect(s.versionChain).toHaveLength(2);
    expect(s.versionChain[1].parentVersion).toBe("v1");
  });
});

describe("rollback", () => {
  it("回滚到 v1 — 移除 v2 v3", () => {
    const s = makePS();
    createVersion(s, "auto_refinement", [], "v1");
    createVersion(s, "user_correction", [], "v2");
    createVersion(s, "crystallization", [], "v3");

    const result = rollback(s, "v1");
    expect(result.removedVersions).toEqual(["v2", "v3"]);
    expect(s.versionChain).toHaveLength(1);
    expect(s.versionChain[0].versionId).toBe("v1");
  });

  it("回滚到不存在的版本 → throw", () => {
    const s = makePS();
    createVersion(s, "auto_refinement", [], "v1");
    expect(() => rollback(s, "v99")).toThrow("v99 not found");
  });

  it("回滚恢复字段值到目标版本状态 (T8/M1.4)", () => {
    const s = makePS({ confidence: 0.5 });
    // v1: confidence 0.5 → 0.8
    createVersion(s, "auto_refinement", [{ type: "confidence_changed", path: "/confidence", oldValue: 0.5, newValue: 0.8 }], "bump to 0.8");
    s.confidence = 0.8;
    // v2: confidence 0.8 → 0.9
    createVersion(s, "auto_refinement", [{ type: "confidence_changed", path: "/confidence", oldValue: 0.8, newValue: 0.9 }], "bump to 0.9");
    s.confidence = 0.9;
    expect(s.confidence).toBe(0.9);

    // rollback to v1 → confidence restored to v1's state (0.8), not left at 0.9
    rollback(s, "v1");
    expect(s.confidence).toBe(0.8);
    expect(s.versionChain).toHaveLength(1);
  });
});

describe("getVersion", () => {
  it("找到存在的版本", () => {
    const s = makePS();
    createVersion(s, "auto_refinement", [], "first");
    const v = getVersion(s, "v1");
    expect(v).not.toBeNull();
    expect(v!.versionId).toBe("v1");
  });

  it("不存在的版本 → null", () => {
    const s = makePS();
    expect(getVersion(s, "v99")).toBeNull();
  });
});

describe("diffVersions", () => {
  it("v1 vs v2 — 正确识别差异", () => {
    const v1: VersionSnapshot = {
      versionId: "v1", parentVersion: null, createdAt: 1,
      createdBy: "auto_refinement",
      diff: [makeDiff("steps[0]", "step_added")],
      rationale: "", evidence: [],
      performance: { predictionAccuracy: 0, userSatisfaction: 0, activeDurationDays: 0 },
    };
    const v2: VersionSnapshot = {
      versionId: "v2", parentVersion: "v1", createdAt: 2,
      createdBy: "user_correction",
      diff: [
        { type: "step_added", path: "steps[1]", oldValue: null, newValue: "check" },
        { type: "confidence_changed", path: "confidence", oldValue: 0.5, newValue: 0.6 },
      ],
      rationale: "", evidence: [],
      performance: { predictionAccuracy: 0, userSatisfaction: 0, activeDurationDays: 0 },
    };

    const result = diffVersions(v1, v2);
    expect(result.onlyInV1).toHaveLength(1); // steps[0]
    expect(result.onlyInV2).toHaveLength(2); // steps[1] + confidence
    expect(result.changed).toHaveLength(0);
  });
});

describe("versionSummary", () => {
  it("正确统计版本信息", () => {
    const s = makePS();
    createVersion(s, "auto_refinement", [], "first");
    createVersion(s, "user_correction", [], "second");
    createVersion(s, "crystallization", [], "third");

    const summary = versionSummary(s);
    expect(summary.versionCount).toBe(3);
    expect(summary.currentVersion).toBe("v3");
    expect(summary.createdByBreakdown["auto_refinement"]).toBe(1);
    expect(summary.createdByBreakdown["user_correction"]).toBe(1);
    expect(summary.createdByBreakdown["crystallization"]).toBe(1);
  });
});
