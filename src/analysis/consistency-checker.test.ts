/**
 * analysis/consistency-checker.ts — 跨结构一致性验证测试
 *
 * 检测 ProtoStructure 之间的逻辑矛盾。
 */

import { describe, it, expect } from "vitest";
import {
  checkConsistency,
  findContradictions,
  type ConsistencyCheckInput,
  type ConsistencyReport,
} from "./consistency-checker";

function makeStruct(id: string, name: string, type: string, confidence: number) {
  return { id, tentativeName: name, protoType: type, confidence, lifecycle: "experimental" as const };
}

describe("checkConsistency", () => {
  it("returns no contradictions for non-overlapping structures", () => {
    const input: ConsistencyCheckInput = {
      structures: [
        makeStruct("s1", "门诊流程", "sequence", 0.7),
        makeStruct("s2", "数据库索引策略", "concept", 0.8),
      ],
      constraints: [],
    };
    const report = checkConsistency(input);
    expect(report.contradictions).toHaveLength(0);
    expect(report.isConsistent).toBe(true);
  });

  it("detects contradicts relation as known contradiction", () => {
    const input: ConsistencyCheckInput = {
      structures: [
        makeStruct("s1", "微服务架构", "concept", 0.7),
        makeStruct("s2", "单体架构", "concept", 0.7),
      ],
      constraints: [],
      knownRelations: [
        { fromId: "s1", toId: "s2", type: "contradicts" as const, strength: 0.9 },
      ],
    };
    const report = checkConsistency(input);
    expect(report.contradictions.length).toBeGreaterThan(0);
    expect(report.contradictions[0]!.type).toBe("known_contradiction");
  });

  it("detects paradoxical constraints", () => {
    const input: ConsistencyCheckInput = {
      structures: [],
      constraints: [
        { id: "c1", description: "Always use TypeScript", severity: "block" as const },
        { id: "c2", description: "Never use static typing", severity: "block" as const },
      ],
    };
    const report = checkConsistency(input);
    // Constraints that contradict each other should be flagged
    const paradoxes = report.contradictions.filter(c => c.type === "constraint_paradox");
    expect(paradoxes.length).toBeGreaterThan(0);
  });

  it("summarizes findings in a human-readable summary", () => {
    const input: ConsistencyCheckInput = {
      structures: [
        makeStruct("s1", "微服务", "concept", 0.7),
        makeStruct("s2", "单体", "concept", 0.7),
      ],
      constraints: [],
      knownRelations: [
        { fromId: "s1", toId: "s2", type: "contradicts", strength: 1.0 },
      ],
    };
    const report = checkConsistency(input);
    expect(report.summary).toBeTruthy();
    expect(report.summary.length).toBeGreaterThan(0);
  });
});

describe("findContradictions", () => {
  it("returns empty for empty input", () => {
    expect(findContradictions([])).toHaveLength(0);
  });

  it("finds structures with same name but different types", () => {
    const structs = [
      makeStruct("a", "SameName", "sequence", 0.5),
      makeStruct("b", "SameName", "concept", 0.5),
    ];
    const contradictions = findContradictions(structs);
    // Same tentativeName but different protoTypes is suspicious
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0]!.reason).toContain("SameName");
  });
});
