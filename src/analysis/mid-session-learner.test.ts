/**
 * MidSessionLearner 测试 — M5.1
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MidSessionLearner,
  extractKeywords,
  matchStructures,
  computePenalty,
} from "./mid-session-learner";
import type { ProtoStructure, ProtoSequence } from "../cognitive/types";

function makeStructure(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "struct-1",
    protoType: "sequence",
    tentativeName: "API Request Flow",
    scenarioId: "api_design",
    confidence: 0.8,
    observationsCount: 5,
    adoptionRate: 0.5,
    lifecycle: "experimental",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as ProtoStructure;
}

function makeSequence(overrides: Partial<ProtoSequence> = {}): ProtoSequence {
  return {
    ...makeStructure({ protoType: "sequence", ...overrides }),
    protoType: "sequence",
    structure: { steps: [{ position: 1, action: "Send GET request", agent: "client" }] },
    function: {
      purpose: "Retrieve data",
      precondition: ["endpoint exists"],
      postcondition: ["data returned", "response 200"],
      failureModes: ["timeout", "404"],
    },
    teleologicalMapping: [],
  } as ProtoSequence;
}

describe("extractKeywords", () => {
  it("提取中文双字及以上词组", () => {
    const kw = extractKeywords("不对，应该用POST而不是GET请求");
    expect(kw).toContain("不对");
    expect(kw).toContain("请求");
  });

  it("提取英文大写标识符", () => {
    const kw = extractKeywords("use POST not GET for API calls");
    expect(kw).toContain("POST");
    expect(kw).toContain("GET");
    expect(kw).toContain("API");
  });

  it("空字符串返回空数组", () => {
    expect(extractKeywords("")).toEqual([]);
  });
});

describe("matchStructures", () => {
  it("匹配 tentativeName 中的关键词", () => {
    const s = makeStructure({ tentativeName: "API Request Flow" });
    const results = matchStructures(["API", "Request"], [s]);
    expect(results).toHaveLength(1);
    expect(results[0].structure.id).toBe("struct-1");
    expect(results[0].matchedKeywords).toContain("API");
  });

  it("无匹配时返回空数组", () => {
    const s = makeStructure({ tentativeName: "Database Migration" });
    const results = matchStructures(["API", "Request"], [s]);
    expect(results).toHaveLength(0);
  });

  it("返回匹配的关键词子集", () => {
    const s = makeStructure({ tentativeName: "API Request" });
    const results = matchStructures(["API", "Database", "Request"], [s]);
    expect(results[0].matchedKeywords).toEqual(["API", "Request"]);
    expect(results[0].matchedKeywords).not.toContain("Database");
    expect(results[0].relevance).toBe(2 / 3);
  });
});

describe("computePenalty", () => {
  it("中等否定 × 高相关性 → 约0.04", () => {
    const s = makeStructure();
    const penalty = computePenalty("不对，应该用POST", s, ["POST", "API"]);
    // base=0.05, cf=0.8 (中等否定), relevance=matchedKw/allKw
    // allKeywords extracted from text: ~2-3, matched=2 → relevance ~0.67-1.0
    expect(penalty).toBeGreaterThan(0.02);
    expect(penalty).toBeLessThan(0.06);
  });

  it("强否定 × 高相关性 → 较高惩罚", () => {
    const s = makeStructure();
    const strong = computePenalty("完全错了，重新做", s, ["完全错了", "重新做"]);
    const medium = computePenalty("不对，应该是这样", s, ["应该是"]);
    expect(strong).toBeGreaterThan(medium);
  });
});

describe("MidSessionLearner", () => {
  let learner: MidSessionLearner;
  let structures: ProtoStructure[];

  beforeEach(() => {
    learner = new MidSessionLearner();
    // 使用与纠正关键词匹配的结构名
    structures = [makeStructure({ tentativeName: "API POST Request Handler" })];
  });

  it("单次纠正 → 产出 mid_session 信号源", () => {
    const sources = learner.handleCorrection("不对，应该用POST", structures);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].sourceName).toBe("mid_session");
    expect(sources[0].value).toBeLessThan(1.0);
    expect(sources[0].value).toBeGreaterThan(0.9);
  });

  it("同一结构多次纠正 → 不重复惩罚 (affectedStructures 去重)", () => {
    learner.handleCorrection("不对，应该用POST", structures);
    const sources2 = learner.handleCorrection("又错了，应该用PUT", structures);
    expect(sources2).toHaveLength(0); // 已被标记，不重复惩罚
  });

  it("多次不同结构纠正 → 累计惩罚 < 0.2", () => {
    const s2 = makeStructure({ id: "struct-2", tentativeName: "Database Migration" });
    for (let i = 0; i < 10; i++) {
      // 使用会匹配的关键词
      learner.handleCorrection(`不对，API POST Request 错了`, [structures[0]]);
      learner.handleCorrection(`不对，Database Migration 错了`, [s2]);
    }
    expect(learner.getSessionTotalPenalty()).toBeLessThanOrEqual(0.2);
  });

  it("约束违反 1-2 次 → 不触发惩罚", () => {
    const s1 = learner.handleConstraintViolation("c1");
    expect(s1).toHaveLength(0);
    const s2 = learner.handleConstraintViolation("c1");
    expect(s2).toHaveLength(0);
  });

  it("约束违反 3+ 次 → 触发惩罚", () => {
    learner.handleConstraintViolation("c1");
    learner.handleConstraintViolation("c1");
    const sources = learner.handleConstraintViolation("c1");
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].sourceName).toBe("mid_session");
  });

  it("惩罚达到 0.2 上限 → 不再产出信号源", () => {
    // 用会匹配的结构耗尽 budget
    for (let i = 0; i < 20; i++) {
      const s = makeStructure({ id: `s-${i}`, tentativeName: `API POST Request ${i}` });
      learner.handleCorrection(`不对，API POST Request 错了`, [s]);
    }
    const s = makeStructure({ id: "final", tentativeName: "Final API Test" });
    const sources = learner.handleCorrection("不对，API 错了最后一次", [s]);
    expect(sources).toHaveLength(0);
  });

  it("reset() 清空所有状态", () => {
    learner.handleCorrection("不对，应该用POST", structures);
    learner.handleConstraintViolation("c1");
    learner.handleConstraintViolation("c1");
    learner.handleConstraintViolation("c1");
    learner.reset();
    expect(learner.getSessionTotalPenalty()).toBe(0);
    expect(learner.getRecords()).toHaveLength(0);
  });

  it("候选集 > 5 时不处理", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      makeStructure({ id: `s-${i}`, tentativeName: `Test ${i}` }));
    const sources = learner.handleCorrection("不对", many);
    expect(sources).toHaveLength(0);
  });
});
