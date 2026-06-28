/**
 * structure-retirement.test.ts — T14: 退役与亚存在管理测试
 *
 * 覆盖:
 *   - retire: 正确生成 RetiredStructure 元数据
 *   - checkReactivation: superseding 信心度跌破阈值 → 应重新激活
 *   - checkReactivation: 手动请求 → 应重新激活
 *   - checkReactivation: 条件未满足 → 不重新激活
 *   - reactivate: 返回实验性状态
 */

import { describe, it, expect } from "vitest";
import { StructureRetirement } from "./structure-retirement";
import type { ProtoStructure } from "../cognitive/types";

function makeStructure(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "ps-1",
    protoType: "sequence",
    tentativeName: "测试结构",
    scenarioId: "general",
    confidence: 0.8,
    observationsCount: 10,
    adoptionRate: 0.6,
    lifecycle: "crystallized",
    relations: [],
    versionChain: [{
      versionId: "v1", parentVersion: "root",
      createdAt: Date.now(), createdBy: "fusion",
      diff: [], rationale: "initial", evidence: [],
      performance: { predictionAccuracy: 0, userSatisfaction: 0, activeDurationDays: 0 },
    }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("StructureRetirement", () => {
  const manager = new StructureRetirement();

  describe("retire", () => {
    it("生成 RetiredStructure 元数据", () => {
      const structure = makeStructure();
      const result = manager.retire(structure, ["new-ps-1"], ["学会了更好的方法"]);

      expect(result.originalId).toBe("ps-1");
      expect(result.supersededBy).toEqual(["new-ps-1"]);
      expect(result.keyLessons).toEqual(["学会了更好的方法"]);
      expect(result.retiredAt).toBeGreaterThan(0);
      expect(result.originalVersionChain).toHaveLength(1);
    });

    it("reactivation conditions 包含默认阈值", () => {
      const result = manager.retire(makeStructure(), [], []);
      expect(result.reactivationConditions.newStructureConfidenceFallsBelow).toBe(0.3);
      expect(result.reactivationConditions.oldScenarioReappears).toBe(true);
      expect(result.reactivationConditions.manualReactivation).toBe(true);
    });
  });

  describe("checkReactivation", () => {
    it("superseding 信心度低于阈值 → 应重新激活", () => {
      const retired = manager.retire(makeStructure(), ["new-ps"], []);
      const result = manager.checkReactivation(retired, {
        supersedingConfidence: 0.2,
      });

      expect(result.shouldReactivate).toBe(true);
      expect(result.reason).toContain("fell below threshold");
    });

    it("手动请求 → 应重新激活", () => {
      const retired = manager.retire(makeStructure(), [], []);
      const result = manager.checkReactivation(retired, {
        supersedingConfidence: 0.5,
        manualRequest: true,
      });

      expect(result.shouldReactivate).toBe(true);
      expect(result.reason).toContain("Manual reactivation");
    });

    it("条件未满足 → 不重新激活", () => {
      const retired = manager.retire(makeStructure(), [], []);
      const result = manager.checkReactivation(retired, {
        supersedingConfidence: 0.5,
      });

      expect(result.shouldReactivate).toBe(false);
    });

    it("superseding 信心度刚好等于阈值 → 不重新激活", () => {
      const retired = manager.retire(makeStructure(), [], []);
      const result = manager.checkReactivation(retired, {
        supersedingConfidence: 0.3,
      });

      expect(result.shouldReactivate).toBe(false);
    });
  });

  describe("reactivate", () => {
    it("返回实验性状态，信心度重置", () => {
      const retired = manager.retire(makeStructure({ confidence: 0.8, lifecycle: "crystallized" }), [], []);
      const restored = manager.reactivate(retired);

      expect(restored.confidence).toBe(0.3);
      expect(restored.lifecycle).toBe("experimental");
      expect(restored.updatedAt).toBeGreaterThan(0);
    });
  });
});
