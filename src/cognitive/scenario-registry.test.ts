/**
 * scenario-registry 测试 — 种子场景注册表
 *
 * 覆盖:
 *   - 所有种子场景结构完整
 *   - scenarioId 唯一
 *   - getSeedScenario 查找
 *   - validateSeedScenarios 健康检查
 */

import { describe, it, expect } from "vitest";
import { SEED_SCENARIOS, getSeedScenario, validateSeedScenarios } from "./scenario-registry";

describe("SEED_SCENARIOS — 结构完整性", () => {
  it("至少定义了 3 个种子场景", () => {
    expect(SEED_SCENARIOS.length).toBeGreaterThanOrEqual(3);
  });

  it("所有 scenarioId 唯一", () => {
    const ids = SEED_SCENARIOS.map((s) => s.scenarioId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个场景有 scenarioId、tentativeName、protoType", () => {
    for (const s of SEED_SCENARIOS) {
      expect(s.scenarioId).toBeTruthy();
      expect(typeof s.scenarioId).toBe("string");
      expect(s.tentativeName).toBeTruthy();
      expect(["sequence", "role", "concept", "purpose"]).toContain(s.protoType);
    }
  });

  it("每个场景有非空的 typicalTools 和 typicalDomains", () => {
    for (const s of SEED_SCENARIOS) {
      expect(Array.isArray(s.typicalTools)).toBe(true);
      expect(s.typicalTools.length).toBeGreaterThan(0);
      expect(Array.isArray(s.typicalDomains)).toBe(true);
      expect(s.typicalDomains.length).toBeGreaterThan(0);
    }
  });
});

describe("getSeedScenario", () => {
  it("返回匹配的场景", () => {
    const s = getSeedScenario(SEED_SCENARIOS[0].scenarioId);
    expect(s).toBeDefined();
    expect(s!.scenarioId).toBe(SEED_SCENARIOS[0].scenarioId);
  });

  it("未知 scenarioId 返回 undefined", () => {
    expect(getSeedScenario("nonexistent")).toBeUndefined();
  });
});

describe("validateSeedScenarios", () => {
  it("当前种子场景验证通过", () => {
    const result = validateSeedScenarios();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
