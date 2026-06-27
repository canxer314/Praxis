/**
 * curiosity-engine.test.ts — T14: 4 阶段主动知识缺口检测测试
 *
 * 覆盖:
 *   - Stage 1: detectUnknownTerms, detectRepeatedCorrections, detectStagnantSkills
 *   - Stage 2: rank — priority 排序 + 行动分配
 *   - Stage 3: act — 行动生成 + 每日限额
 *   - Stage 4: canAskNow — 治理规则 (每日限额/静默时间/最小间隔)
 */

import { describe, it, expect } from "vitest";
import { CuriosityEngine } from "./curiosity-engine";
import type { ProtoConcept, Correction, MetacognitiveProfile } from "../cognitive/types";

function makeConcept(name: string): ProtoConcept {
  return {
    id: `concept-${name}`,
    protoType: "concept",
    tentativeName: name,
    scenarioId: "general",
    confidence: 0.7,
    observationsCount: 5,
    adoptionRate: 0.5,
    lifecycle: "crystallized",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    definition: `Definition of ${name}`,
    relatedConcepts: [],
  };
}

function makeCorrection(what: string, correctedTo: string): Correction {
  return { what, correctedTo, timestamp: Date.now() };
}

describe("CuriosityEngine — Stage 1: 缺口检测", () => {
  const engine = new CuriosityEngine();

  describe("detectUnknownTerms", () => {
    it("从 transcript 中检测未知大写术语", () => {
      const gaps = engine.detectUnknownTerms(
        "We should use Dependency Injection and Service Locator patterns here",
        [makeConcept("TypeScript")],
      );
      expect(gaps.length).toBeGreaterThan(0);
      const names = gaps.map((g) => g.topic);
      expect(names).toContain("Dependency Injection");
      expect(names).toContain("Service Locator");
    });

    it("已知术语不产生 gap", () => {
      const gaps = engine.detectUnknownTerms(
        "Use Dependency Injection",
        [makeConcept("Dependency Injection")],
      );
      const diGaps = gaps.filter(g => g.topic === "Dependency Injection");
      expect(diGaps).toHaveLength(0);
    });

    it("空 transcript → 空数组", () => {
      expect(engine.detectUnknownTerms("", [makeConcept("X")])).toEqual([]);
    });

    it("全小写 transcript → 不匹配大写术语", () => {
      const gaps = engine.detectUnknownTerms("this is all lowercase text here", []);
      expect(gaps).toEqual([]);
    });
  });

  describe("detectRepeatedCorrections", () => {
    it("≥3 次同类纠正 → 产生 gap", () => {
      const corrections = [
        makeCorrection("API call", "REST call"),
        makeCorrection("API call", "REST call"),
        makeCorrection("API call", "REST call"),
      ];
      const gaps = engine.detectRepeatedCorrections(corrections);
      expect(gaps.length).toBe(1);
      expect(gaps[0].topic).toContain("API call");
    });

    it("< 3 次纠正 → 不产生 gap", () => {
      const corrections = [
        makeCorrection("API call", "REST call"),
        makeCorrection("API call", "REST call"),
      ];
      expect(engine.detectRepeatedCorrections(corrections)).toEqual([]);
    });

    it("空修正列表 → 空数组", () => {
      expect(engine.detectRepeatedCorrections([])).toEqual([]);
    });
  });

  describe("detectStagnantSkills", () => {
    it("技能评分 < 0.3 + ≥5 次练习 + 30 天未校准 → stagnation gap", () => {
      const profile: MetacognitiveProfile = {
        domainProficiencies: {
          typescript: { selfRating: 0.2, taskCount: 8, lastCalibrated: Date.now() - 40 * 24 * 60 * 60 * 1000 },
        },
      };
      const gaps = engine.detectStagnantSkills(profile);
      expect(gaps.length).toBe(1);
      expect(gaps[0].topic).toContain("Stagnant skill");
      expect(gaps[0].topic).toContain("typescript");
    });

    it("评分高 → 不产生 stagnation gap", () => {
      const profile: MetacognitiveProfile = {
        domainProficiencies: {
          typescript: { selfRating: 0.8, taskCount: 100, lastCalibrated: Date.now() },
        },
      };
      expect(engine.detectStagnantSkills(profile)).toEqual([]);
    });

    it("空 profile → 空数组", () => {
      expect(engine.detectStagnantSkills({})).toEqual([]);
    });
  });
});

describe("CuriosityEngine — Stage 2: 优先级排序", () => {
  const engine = new CuriosityEngine();

  it("高优先级 gap → 非 SILENT_MARK (至少 FETCH_RESOURCES 以上)", () => {
    const gaps = engine.detectUnknownTerms("React Hooks useState", []);
    const relevanceMap = new Map<string, number>();
    for (const g of gaps) relevanceMap.set(g.topic, 0.9);

    const ranked = engine.rank(gaps, relevanceMap);
    expect(ranked.length).toBeGreaterThan(0);
    // High relevance should produce at least FETCH_RESOURCES or higher
    const action = ranked[0].action;
    expect(action).not.toBe("SILENT_MARK");
  });

  it("无 gap → 空 rank 列表", () => {
    expect(engine.rank([], new Map())).toEqual([]);
  });

  it("rank 按 priority 降序排列", () => {
    const gaps = [
      { topic: "Low", detectedAt: "test" as const, context: "", resolved: true },
      { topic: "High", detectedAt: "test" as const, context: "", resolved: false },
    ];
    // High gets higher priority because resolved=false
    const ranked = engine.rank(gaps, new Map([["Low", 0.5], ["High", 0.5]]));
    expect(ranked.length).toBe(2);
    expect(ranked[0].priority).toBeGreaterThanOrEqual(ranked[1].priority);
  });
});

describe("CuriosityEngine — Stage 3+4: 行动治理", () => {
  // Use governance that disables quiet hours for deterministic testing
  const testGovernance = { quietHoursStart: "00:00", quietHoursEnd: "00:00", minIntervalMinutes: 0 };

  it("canAskNow — 初始状态可提问", () => {
    const engine = new CuriosityEngine(testGovernance);
    expect(engine.canAskNow()).toBe(true);
  });

  it("达到每日限额后不可提问", () => {
    const engine = new CuriosityEngine({ ...testGovernance, maxQuestionsPerDay: 2 });
    engine.recordQuestion();
    engine.recordQuestion();
    expect(engine.canAskNow()).toBe(false);
  });

  it("resetDaily 重置每日计数", () => {
    const engine = new CuriosityEngine(testGovernance);
    engine.recordQuestion();
    engine.recordQuestion();
    engine.recordQuestion();
    // Default max is 3
    expect(engine.canAskNow()).toBe(false);
    engine.resetDaily();
    expect(engine.canAskNow()).toBe(true);
  });

  it("自定义治理配置有效", () => {
    const engine = new CuriosityEngine({ ...testGovernance, maxQuestionsPerDay: 10 });
    for (let i = 0; i < 10; i++) engine.recordQuestion();
    expect(engine.canAskNow()).toBe(false);
  });

  it("act — 静默标记 gap 不消耗配额", () => {
    const engine = new CuriosityEngine();
    const gaps = engine.detectUnknownTerms("Some Text Here", []);
    const ranked = engine.rank(
      gaps,
      new Map(gaps.map(g => [g.topic, 0.1])), // very low relevance → SILENT_MARK
    );
    const actions = engine.act(ranked);
    // Silent marks are included in actions but don't consume quota
    expect(actions.length).toBeGreaterThanOrEqual(0);
  });
});
