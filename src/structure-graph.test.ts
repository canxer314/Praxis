import { describe, it, expect } from "vitest";
import {
  addRelation,
  removeRelation,
  findRelations,
  propagateConfidence,
  propagateContradiction,
  fullPropagation,
  findCycles,
} from "./structure-graph";
import type { ProtoStructure, RelationType } from "./cognitive/types";

function makePS(id: string, confidence = 0.8, protoType = "sequence" as const): ProtoStructure {
  return {
    id, protoType, tentativeName: `Test ${id}`, scenarioId: "test",
    confidence, observationsCount: 5, adoptionRate: 0.5,
    lifecycle: "experimental", relations: [], versionChain: [],
    createdAt: Date.now(), updatedAt: Date.now(),
    // ProtoSequence fields
    structure: { steps: [] },
    function: { purpose: "", precondition: [], postcondition: [], failureModes: [] },
    teleologicalMapping: [],
  } as ProtoStructure;
}

describe("addRelation", () => {
  it("建立 depends_on 关系", () => {
    const a = makePS("a");
    const b = makePS("b");
    addRelation(a, b, "depends_on", 0.8);
    expect(a.relations).toHaveLength(1);
    expect(a.relations[0].targetId).toBe("b");
    expect(a.relations[0].type).toBe("depends_on");
    expect(a.relations[0].strength).toBe(0.8);
  });

  it("同类型重复建立 → 更新 strength", () => {
    const a = makePS("a");
    const b = makePS("b");
    addRelation(a, b, "depends_on", 0.5);
    addRelation(a, b, "depends_on", 0.9);
    expect(a.relations).toHaveLength(1);
    expect(a.relations[0].strength).toBe(0.9);
  });

  it("不同类型 → 新增独立边", () => {
    const a = makePS("a");
    const b = makePS("b");
    addRelation(a, b, "depends_on", 0.5);
    addRelation(a, b, "contradicts", 0.3);
    expect(a.relations).toHaveLength(2);
  });
});

describe("propagateConfidence", () => {
  it("A depends_on B → B 下降 → A 同降", () => {
    const a = makePS("a", 0.9);
    const b = makePS("b", 0.9);
    addRelation(a, b, "depends_on", 0.8);
    const map = new Map([[a.id, a], [b.id, b]]);
    const affected = propagateConfidence("b", -0.4, map);
    expect(affected.get("a")).toBeCloseTo(-0.32); // -0.4 × 0.8
  });

  it("传播深度 > 3 跳截断", () => {
    const a = makePS("a"); // depends_on b
    const b = makePS("b"); // depends_on c
    const c = makePS("c"); // depends_on d
    const d = makePS("d"); // depends_on e
    const e = makePS("e");
    addRelation(a, b, "depends_on", 1.0);
    addRelation(b, c, "depends_on", 1.0);
    addRelation(c, d, "depends_on", 1.0);
    addRelation(d, e, "depends_on", 1.0);
    const map = new Map([[a.id, a], [b.id, b], [c.id, c], [d.id, d], [e.id, e]]);
    const affected = propagateConfidence("e", -0.5, map, 3);
    // Only 3 hops: d, c, b affected. a is at hop 4, excluded.
    expect(affected.has("d")).toBe(true);
    expect(affected.has("c")).toBe(true);
    expect(affected.has("b")).toBe(true);
    expect(affected.has("a")).toBe(false); // >3 hops
  });
});

describe("propagateContradiction", () => {
  it("A contradicts B → A 上升 → B 下降", () => {
    const a = makePS("a", 0.5);
    const b = makePS("b", 0.8);
    addRelation(a, b, "contradicts", 0.6);
    const map = new Map([[a.id, a], [b.id, b]]);
    const affected = propagateContradiction("a", 0.3, map);
    expect(affected.get("b")).toBeCloseTo(-0.18); // -0.3 * 0.6
  });
});

describe("fullPropagation", () => {
  it("合并所有关系类型的影响", () => {
    const a = makePS("a", 0.7);
    const b = makePS("b", 0.8);
    const c = makePS("c", 0.6);
    addRelation(a, b, "contradicts", 0.5);  // a↑ → b↓
    addRelation(c, a, "depends_on", 1.0);    // a↑ → c↑ (c depends on a, a more reliable → c also more reliable)
    const map = new Map([[a.id, a], [b.id, b], [c.id, c]]);
    // a 置信度上升 0.2 → contradicts b (b↓0.1) + depends_on c (c↑0.2)
    const affected = fullPropagation("a", 0.2, map);
    expect(affected.get("b")).toBeCloseTo(-0.1);
    expect(affected.get("c")).toBeCloseTo(0.2);
  });
});

describe("findCycles", () => {
  it("无循环 → null", () => {
    const a = makePS("a");
    const b = makePS("b");
    addRelation(a, b, "depends_on", 1.0);
    const map = new Map([[a.id, a], [b.id, b]]);
    expect(findCycles("a", map)).toBeNull();
  });

  it("A→B→C→A 循环 → 返回环路径", () => {
    const a = makePS("a");
    const b = makePS("b");
    const c = makePS("c");
    addRelation(a, b, "depends_on", 1.0);
    addRelation(b, c, "depends_on", 1.0);
    addRelation(c, a, "depends_on", 1.0);
    const map = new Map([[a.id, a], [b.id, b], [c.id, c]]);
    const cycle = findCycles("a", map);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("a");
    expect(cycle).toContain("b");
    expect(cycle).toContain("c");
  });
});
