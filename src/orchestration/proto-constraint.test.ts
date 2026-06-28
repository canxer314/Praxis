/**
 * proto-constraint 测试 — M3 Step 1
 *
 * 覆盖:
 *   - getActiveConstraints: 按 protoType + lifecycle 过滤
 *   - sortBySeverity: block > confirm > warn 排序
 *   - deprecateConstraint: 生命周期推进 + 废弃理由
 *   - estimateConstraintTokens: 粗略 token 估算
 */

import { describe, it, expect } from "vitest";
import {
  getActiveConstraints,
  sortBySeverity,
  deprecateConstraint,
  estimateConstraintTokens,
  SEVERITY_RANK,
} from "./proto-constraint";
import type { ProtoConstraint, ProtoStructure } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

function makeConstraint(overrides: Partial<ProtoConstraint> = {}): ProtoConstraint {
  return {
    id: "c1",
    protoType: "constraint",
    tentativeName: "测试约束",
    scenarioId: "general",
    confidence: 0.85,
    observationsCount: 7,
    adoptionRate: 0.5,
    lifecycle: "crystallized",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    severity: "block",
    source: "user_taught",
    rulePatterns: ["migrate", "backup"],
    ...overrides,
  };
}

function makeSequence(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "ps1",
    protoType: "sequence",
    tentativeName: "序列结构",
    scenarioId: "general",
    confidence: 0.8,
    observationsCount: 10,
    adoptionRate: 0.7,
    lifecycle: "crystallized",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// getActiveConstraints
// ══════════════════════════════════════════════════════════════════

describe("getActiveConstraints", () => {
  it("空结构列表返回空数组", () => {
    expect(getActiveConstraints([])).toEqual([]);
  });

  it("无 constraint 类型时返回空数组", () => {
    const structures = [makeSequence(), makeSequence({ id: "ps2" })];
    expect(getActiveConstraints(structures)).toEqual([]);
  });

  it("constraint 但 lifecycle 非 crystallized → 被过滤", () => {
    const c = makeConstraint({ lifecycle: "experimental" });
    expect(getActiveConstraints([c])).toEqual([]);
  });

  it("candidate 生命周期的 constraint → 被过滤", () => {
    const c = makeConstraint({ lifecycle: "candidate" });
    expect(getActiveConstraints([c])).toEqual([]);
  });

  it("hypothesized 生命周期的 constraint → 被过滤", () => {
    const c = makeConstraint({ lifecycle: "hypothesized" });
    expect(getActiveConstraints([c])).toEqual([]);
  });

  it("已结晶 constraint → 被包含", () => {
    const c = makeConstraint({ lifecycle: "crystallized" });
    const result = getActiveConstraints([c]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("混合类型和生命周期 → 仅返回已结晶 constraint", () => {
    const structures: ProtoStructure[] = [
      makeSequence(),
      makeConstraint({ id: "c1", lifecycle: "crystallized" }),
      makeConstraint({ id: "c2", lifecycle: "experimental" }),
      makeSequence({ id: "ps2" }),
      makeConstraint({ id: "c3", lifecycle: "crystallized" }),
    ];
    const result = getActiveConstraints(structures);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["c1", "c3"]);
  });

  it("deprecated 约束 → 被过滤", () => {
    const c = makeConstraint({ lifecycle: "deprecated" });
    expect(getActiveConstraints([c])).toEqual([]);
  });

  it("rejected 约束 → 被过滤", () => {
    const c = makeConstraint({ lifecycle: "rejected" });
    expect(getActiveConstraints([c])).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
// sortBySeverity
// ══════════════════════════════════════════════════════════════════

describe("sortBySeverity", () => {
  it("空列表返回空数组", () => {
    expect(sortBySeverity([])).toEqual([]);
  });

  it("单元素返回相同", () => {
    const constraints = [makeConstraint({ severity: "confirm" })];
    const result = sortBySeverity(constraints);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("confirm");
  });

  it("block > confirm > warn 排序", () => {
    const constraints = [
      makeConstraint({ id: "a", severity: "warn" }),
      makeConstraint({ id: "b", severity: "block" }),
      makeConstraint({ id: "c", severity: "confirm" }),
    ];
    const result = sortBySeverity(constraints);
    expect(result.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("相同 severity 保持原有顺序（稳定排序）", () => {
    const constraints = [
      makeConstraint({ id: "first", severity: "confirm" }),
      makeConstraint({ id: "second", severity: "confirm" }),
      makeConstraint({ id: "third", severity: "confirm" }),
    ];
    const result = sortBySeverity(constraints);
    expect(result.map((r) => r.id)).toEqual(["first", "second", "third"]);
  });

  it("不修改原数组", () => {
    const constraints = [
      makeConstraint({ id: "a", severity: "warn" }),
      makeConstraint({ id: "b", severity: "block" }),
    ];
    const original = [...constraints];
    sortBySeverity(constraints);
    expect(constraints).toEqual(original);
  });

  it("block 和 confirm 混合", () => {
    const constraints = [
      makeConstraint({ id: "c1", severity: "block" }),
      makeConstraint({ id: "c2", severity: "confirm" }),
      makeConstraint({ id: "c3", severity: "block" }),
    ];
    const result = sortBySeverity(constraints);
    expect(result.map((r) => r.id)).toEqual(["c1", "c3", "c2"]);
  });
});

// ══════════════════════════════════════════════════════════════════
// deprecateConstraint
// ══════════════════════════════════════════════════════════════════

describe("deprecateConstraint", () => {
  it("已结晶约束 → lifecycle 推进到 deprecated", () => {
    const c = makeConstraint({ lifecycle: "crystallized", tentativeName: "我的约束" });
    const result = deprecateConstraint(c, "不再适用");
    expect(result.lifecycle).toBe("deprecated");
    expect(result.tentativeName).toBe("我的约束 [废弃: 不再适用]");
  });

  it("返回同一个对象引用", () => {
    const c = makeConstraint();
    const result = deprecateConstraint(c, "测试");
    expect(result).toBe(c);
  });

  it("updatedAt 被更新", () => {
    const oldTime = Date.now() - 10000;
    const c = makeConstraint({ updatedAt: oldTime, lifecycle: "crystallized" });
    const result = deprecateConstraint(c, "过时规则");
    expect(result.updatedAt).toBeGreaterThan(oldTime);
  });

  it("对已 deprecated 的约束调用 → 保持 deprecated 且不修改名称", () => {
    const c = makeConstraint({ lifecycle: "deprecated", tentativeName: "原名称" });
    const oldUpdatedAt = c.updatedAt;
    const result = deprecateConstraint(c, "再次废弃");
    // deprecated → no valid transition from lifecycle state machine → stays unchanged
    expect(result.lifecycle).toBe("deprecated");
    expect(result.tentativeName).toBe("原名称"); // 不被污染
    expect(result.updatedAt).toBe(oldUpdatedAt); // 不被更新
  });

  it("对 rejected 的约束调用 → 保持 rejected 且不修改名称", () => {
    const c = makeConstraint({ lifecycle: "rejected", tentativeName: "原名称" });
    const oldUpdatedAt = c.updatedAt;
    const result = deprecateConstraint(c, "废弃已拒绝的约束");
    expect(result.lifecycle).toBe("rejected");
    expect(result.tentativeName).toBe("原名称"); // 不被污染
    expect(result.updatedAt).toBe(oldUpdatedAt); // 不被更新
  });

  it("对 candidate 约束调用 → 保持 candidate 且不修改名称", () => {
    const c = makeConstraint({ lifecycle: "candidate", tentativeName: "候选约束" });
    const oldUpdatedAt = c.updatedAt;
    const result = deprecateConstraint(c, "不应生效");
    expect(result.lifecycle).toBe("candidate");
    expect(result.tentativeName).toBe("候选约束"); // 无效转换，不修改
    expect(result.updatedAt).toBe(oldUpdatedAt);
  });

  it("对 experimental 约束调用 → 保持 experimental 且不修改名称", () => {
    const c = makeConstraint({ lifecycle: "experimental", tentativeName: "实验约束" });
    const oldUpdatedAt = c.updatedAt;
    const result = deprecateConstraint(c, "不应生效");
    expect(result.lifecycle).toBe("experimental");
    expect(result.tentativeName).toBe("实验约束");
    expect(result.updatedAt).toBe(oldUpdatedAt);
  });
});

// ══════════════════════════════════════════════════════════════════
// estimateConstraintTokens
// ══════════════════════════════════════════════════════════════════

describe("estimateConstraintTokens", () => {
  it("空列表 → 0", () => {
    expect(estimateConstraintTokens([])).toBe(0);
  });

  it("1 个约束 ≈ 40 tokens", () => {
    expect(estimateConstraintTokens([makeConstraint()])).toBe(40);
  });

  it("3 个约束 ≈ 120 tokens", () => {
    const constraints = [
      makeConstraint({ id: "a" }),
      makeConstraint({ id: "b" }),
      makeConstraint({ id: "c" }),
    ];
    expect(estimateConstraintTokens(constraints)).toBe(120);
  });
});

// ══════════════════════════════════════════════════════════════════
// SEVERITY_RANK
// ══════════════════════════════════════════════════════════════════

describe("SEVERITY_RANK", () => {
  it("block > confirm > warn", () => {
    expect(SEVERITY_RANK.block).toBeGreaterThan(SEVERITY_RANK.confirm);
    expect(SEVERITY_RANK.confirm).toBeGreaterThan(SEVERITY_RANK.warn);
  });
});
