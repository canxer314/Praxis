/**
 * constraint-injector 测试 — M3 Step 2
 *
 * 覆盖:
 *   - injectConstraints: 空约束 → 空输出
 *   - Severity 排序: block > confirm > warn
 *   - 格式化: ⛔ 标记 + 编号 + 元数据
 *   - Critical 压力下仍注入
 *   - Token 预算截断
 *   - user_taught vs auto_derived 来源格式
 */

import { describe, it, expect } from "vitest";
import { injectConstraints } from "./constraint-injector";
import type { InjectConstraintsInput } from "./constraint-injector";
import type { ProtoConstraint } from "../cognitive/types";

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

// ══════════════════════════════════════════════════════════════════
// injectConstraints
// ══════════════════════════════════════════════════════════════════

describe("injectConstraints", () => {
  it("空约束列表 → 空输出", () => {
    const result = injectConstraints({ constraints: [] });
    expect(result.injectionText).toBe("");
    expect(result.tokenCount).toBe(0);
    expect(result.constraintIds).toEqual([]);
  });

  it("单个 block 约束 → 格式化包含 ⛔ 标记", () => {
    const c = makeConstraint({ tentativeName: "数据库迁移前必须备份" });
    const result = injectConstraints({ constraints: [c] });
    expect(result.injectionText).toContain("⛔ CRITICAL CONSTRAINTS");
    expect(result.injectionText).toContain("1. 数据库迁移前必须备份");
    expect(result.injectionText).toContain("[用户明确教导]");
    expect(result.injectionText).toContain("[约束与流程冲突时，约束优先]");
    expect(result.constraintIds).toEqual(["c1"]);
  });

  it("按 severity 排序: block → confirm → warn", () => {
    const constraints = [
      makeConstraint({ id: "a", tentativeName: "Warn约束", severity: "warn" }),
      makeConstraint({ id: "b", tentativeName: "Block约束", severity: "block" }),
      makeConstraint({ id: "c", tentativeName: "Confirm约束", severity: "confirm" }),
    ];
    const result = injectConstraints({ constraints });
    // Block should appear first
    const blockIdx = result.injectionText.indexOf("Block约束");
    const confirmIdx = result.injectionText.indexOf("Confirm约束");
    const warnIdx = result.injectionText.indexOf("Warn约束");
    expect(blockIdx).toBeLessThan(confirmIdx);
    expect(confirmIdx).toBeLessThan(warnIdx);
  });

  it("user_taught 来源 → 显示 [用户明确教导]", () => {
    const c = makeConstraint({ source: "user_taught", tentativeName: "用户教约束" });
    const result = injectConstraints({ constraints: [c] });
    expect(result.injectionText).toContain("[用户明确教导]");
  });

  it("auto_derived 来源 → 显示置信度和观察次数", () => {
    const c = makeConstraint({
      source: "auto_derived",
      confidence: 0.72,
      observationsCount: 15,
      tentativeName: "自动推约束",
    });
    const result = injectConstraints({ constraints: [c] });
    expect(result.injectionText).toContain("[置信度 0.72, 15次观察]");
  });

  it("Critical 压力下仍注入约束段", () => {
    const c = makeConstraint({ tentativeName: "关键约束" });
    const result = injectConstraints({ constraints: [c] });
    expect(result.injectionText).toContain("⛔ CRITICAL CONSTRAINTS");
    expect(result.injectionText).toContain("关键约束");
  });

  it("约束编号从 1 递增", () => {
    const constraints = [
      makeConstraint({ id: "a", tentativeName: "第一" }),
      makeConstraint({ id: "b", tentativeName: "第二" }),
      makeConstraint({ id: "c", tentativeName: "第三" }),
    ];
    const result = injectConstraints({ constraints });
    expect(result.injectionText).toContain("1. 第一");
    expect(result.injectionText).toContain("2. 第二");
    expect(result.injectionText).toContain("3. 第三");
  });

  it("tokenCount 正确估算", () => {
    const constraints = [
      makeConstraint({ id: "a" }),
      makeConstraint({ id: "b" }),
    ];
    const result = injectConstraints({ constraints });
    // 2 constraints * 40 = 80 tokens
    expect(result.tokenCount).toBe(80);
  });

  it("超出 maxTokens → 按 severity 截断（保留高 severity）", () => {
    const constraints = [
      makeConstraint({ id: "w1", tentativeName: "W1", severity: "warn" }),
      makeConstraint({ id: "w2", tentativeName: "W2", severity: "warn" }),
      makeConstraint({ id: "w3", tentativeName: "W3", severity: "warn" }),
      makeConstraint({ id: "b1", tentativeName: "B1", severity: "block" }),
      makeConstraint({ id: "b2", tentativeName: "B2", severity: "block" }),
    ];
    // 5 * 40 = 200 > maxTokens=80 → only keep 2 (80/40=2)
    const result = injectConstraints({ constraints, maxTokens: 80 });
    expect(result.injectionText).toContain("B1");
    expect(result.injectionText).toContain("B2");
    expect(result.injectionText).not.toContain("W1");
    expect(result.constraintIds).toHaveLength(2);
  });

  it("maxTokens=0 时至少保留 1 个约束", () => {
    const constraints = [makeConstraint({ id: "only", severity: "block" })];
    const result = injectConstraints({ constraints, maxTokens: 0 });
    expect(result.constraintIds).toHaveLength(1);
    expect(result.injectionText).toContain("1.");
  });
});
