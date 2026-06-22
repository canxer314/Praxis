/**
 * MemoryConsolidator 测试 — Phase 2.3
 *
 * 覆盖:
 *   - Episodic → Semantic: 阈值 / 去重 / 模式提取
 *   - Semantic → Procedural: 阈值 / 步骤排序 / 去重
 *   - Full pipeline: consolidate()
 *   - 空输入 / 不足阈值 / 无匹配模式
 */

import { describe, it, expect } from "vitest";
import { MemoryConsolidator } from "./memory-consolidator";
import type { EpisodicMemory, ProceduralMemory, SemanticMemory } from "./types";

// ══════════════════════════════════════════════════════════════════
// 辅助函数
// ══════════════════════════════════════════════════════════════════

function makeEpisode(
  memoryId: string,
  taskType: string,
  domain: string,
  action: string,
  outcome: string,
  overrides: Partial<EpisodicMemory> = {},
): EpisodicMemory {
  return {
    memoryId,
    agentId: "test",
    timestamp: Date.now(),
    context: { taskType, domain },
    observation: {
      situation: `Doing ${taskType}`,
      action,
      outcome,
      correction: outcome,
    },
    signals: {
      wasCorrected: true,
      userSatisfied: false,
      deviationFromExpected: "API changed",
    },
    ...overrides,
  };
}

function makeSemantic(
  overrides: Partial<SemanticMemory> = {},
): SemanticMemory {
  return {
    memoryId: "sem_001",
    subject: "old API",
    relation: "should_be_replaced_by",
    object: "new API",
    confidence: 0.8,
    evidence: ["ep_001", "ep_002"],
    source: "self_derived",
    ...overrides,
  };
}

function makeProcedural(
  overrides: Partial<ProceduralMemory> = {},
): ProceduralMemory {
  return {
    memoryId: "proc_001",
    taskType: "bug_fix",
    domain: "typescript",
    steps: [{ order: 1, description: "Check types first", critical: true, commonPitfalls: [] }],
    antiPatterns: [],
    confidence: 0.8,
    observationCount: 3,
    derivedFrom: ["sem_001", "sem_002"],
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// Episodic → Semantic
// ══════════════════════════════════════════════════════════════════

describe("MemoryConsolidator.consolidateEpisodicToSemantic()", () => {
  const consolidator = new MemoryConsolidator();

  it("3+ 条相同修正模式 → 语义记忆", () => {
    const episodes = [
      makeEpisode("e1", "bug_fix", "typescript", "used old API", "use new API"),
      makeEpisode("e2", "bug_fix", "typescript", "used old API", "use new API"),
      makeEpisode("e3", "bug_fix", "typescript", "used old API", "use new API"),
    ];

    const result = consolidator.consolidateEpisodicToSemantic(episodes, []);

    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("typescript: used old API");
    expect(result[0].relation).toBe("should_be_replaced_by");
    expect(result[0].object).toBe("use new API");
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.6);
    expect(result[0].evidence).toHaveLength(3);
  });

  it("少于 3 条情景记忆时不提炼", () => {
    const episodes = [
      makeEpisode("e1", "bug_fix", "typescript", "used X", "use Y"),
      makeEpisode("e2", "bug_fix", "typescript", "used X", "use Y"),
    ];

    const result = consolidator.consolidateEpisodicToSemantic(episodes, []);

    expect(result).toHaveLength(0);
  });

  it("不同修正模式各需 3+ 次才提炼", () => {
    const episodes = [
      // 模式 A: 3 次 → 应提炼
      makeEpisode("e1", "bug_fix", "typescript", "used A", "use A2"),
      makeEpisode("e2", "bug_fix", "typescript", "used A", "use A2"),
      makeEpisode("e3", "bug_fix", "typescript", "used A", "use A2"),
      // 模式 B: 2 次 → 不应提炼
      makeEpisode("e4", "bug_fix", "typescript", "used B", "use B2"),
      makeEpisode("e5", "bug_fix", "typescript", "used B", "use B2"),
    ];

    const result = consolidator.consolidateEpisodicToSemantic(episodes, []);

    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("typescript: used A");
  });

  it("去重：已有相同语义关系时不创建重复", () => {
    const episodes = [
      makeEpisode("e1", "bug_fix", "typescript", "used X", "use Y"),
      makeEpisode("e2", "bug_fix", "typescript", "used X", "use Y"),
      makeEpisode("e3", "bug_fix", "typescript", "used X", "use Y"),
    ];

    const existing: SemanticMemory[] = [
      makeSemantic({
        subject: "typescript: used X",
        relation: "should_be_replaced_by",
        object: "use Y",
      }),
    ];

    const result = consolidator.consolidateEpisodicToSemantic(episodes, existing);

    expect(result).toHaveLength(0);
  });

  it("不同领域分别提炼", () => {
    const episodes = [
      makeEpisode("e1", "bug_fix", "typescript", "used X", "use Y"),
      makeEpisode("e2", "bug_fix", "typescript", "used X", "use Y"),
      makeEpisode("e3", "bug_fix", "typescript", "used X", "use Y"),
      makeEpisode("e4", "refactor", "python", "used P", "use Q"),
      makeEpisode("e5", "refactor", "python", "used P", "use Q"),
      makeEpisode("e6", "refactor", "python", "used P", "use Q"),
    ];

    const result = consolidator.consolidateEpisodicToSemantic(episodes, []);

    expect(result).toHaveLength(2);
    const subjects = result.map((s) => s.subject);
    expect(subjects).toContain("typescript: used X");
    expect(subjects).toContain("python: used P");
  });
});

// ══════════════════════════════════════════════════════════════════
// Semantic → Procedural
// ══════════════════════════════════════════════════════════════════

describe("MemoryConsolidator.consolidateSemanticToProcedural()", () => {
  const consolidator = new MemoryConsolidator();

  it("3+ 条同领域语义记忆 → 程序步骤", () => {
    const semantic: SemanticMemory[] = [
      makeSemantic({ memoryId: "s1", subject: "typescript: null checks", confidence: 0.9 }),
      makeSemantic({ memoryId: "s2", subject: "typescript: type guards", confidence: 0.85 }),
      makeSemantic({ memoryId: "s3", subject: "typescript: strict mode", confidence: 0.8 }),
    ];

    const result = consolidator.consolidateSemanticToProcedural(semantic, []);

    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("typescript");
    expect(result[0].steps).toHaveLength(3);
    expect(result[0].steps[0].order).toBe(1);
    expect(result[0].steps[2].order).toBe(3);
    expect(result[0].derivedFrom).toHaveLength(3);
  });

  it("少于 3 条语义记忆时不提炼", () => {
    const semantic: SemanticMemory[] = [
      makeSemantic({ memoryId: "s1" }),
      makeSemantic({ memoryId: "s2" }),
    ];

    const result = consolidator.consolidateSemanticToProcedural(semantic, []);

    expect(result).toHaveLength(0);
  });

  it("已有同 taskType 程序记忆时去重", () => {
    const semantic: SemanticMemory[] = [
      makeSemantic({ memoryId: "s1", subject: "typescript: a" }),
      makeSemantic({ memoryId: "s2", subject: "typescript: b" }),
      makeSemantic({ memoryId: "s3", subject: "typescript: c" }),
    ];

    const existing: ProceduralMemory[] = [
      makeProcedural({ taskType: "use_typescript", domain: "typescript" }),
    ];

    const result = consolidator.consolidateSemanticToProcedural(semantic, existing);

    expect(result).toHaveLength(0);
  });

  it("低置信度语义记忆生成反模式", () => {
    const semantic: SemanticMemory[] = [
      makeSemantic({ memoryId: "s1", subject: "python: pattern A", confidence: 0.5 }),
      makeSemantic({ memoryId: "s2", subject: "python: pattern B", confidence: 0.5 }),
      makeSemantic({ memoryId: "s3", subject: "python: pattern C", confidence: 0.5 }),
    ];

    const result = consolidator.consolidateSemanticToProcedural(semantic, []);

    expect(result).toHaveLength(1);
    expect(result[0].antiPatterns.length).toBeGreaterThan(0);
    expect(result[0].confidence).toBeLessThan(0.6);
  });
});

// ══════════════════════════════════════════════════════════════════
// Full pipeline: consolidate()
// ══════════════════════════════════════════════════════════════════

describe("MemoryConsolidator.consolidate() full pipeline", () => {
  const consolidator = new MemoryConsolidator();

  it("Episodic → Semantic → Procedural 完整流程", () => {
    // 6 条情景记忆 = 3 条 typescript + 3 条 python
    const episodes = [
      makeEpisode("e1", "bug_fix", "typescript", "used old API", "use new API"),
      makeEpisode("e2", "bug_fix", "typescript", "used old API", "use new API"),
      makeEpisode("e3", "bug_fix", "typescript", "used old API", "use new API"),
      makeEpisode("e4", "refactor", "python", "used list comp", "use generator"),
      makeEpisode("e5", "refactor", "python", "used list comp", "use generator"),
      makeEpisode("e6", "refactor", "python", "used list comp", "use generator"),
    ];

    const { newSemantic, newProcedural } = consolidator.consolidate(episodes, [], []);

    // 应有 2 条语义记忆（每个领域各 1 条）
    expect(newSemantic).toHaveLength(2);

    // 语义记忆不足 3 条/领域 → 不应提炼程序记忆
    // (typescript 只有 1 条 semantic，python 只有 1 条)
    expect(newProcedural).toHaveLength(0);
  });

  it("空输入返回空结果", () => {
    const { newSemantic, newProcedural } = consolidator.consolidate([], [], []);
    expect(newSemantic).toHaveLength(0);
    expect(newProcedural).toHaveLength(0);
  });

  it("Pipeline: 足够的语义记忆 → 产生程序记忆", () => {
    // 构建情景记忆使它们产生 ≥3 条同领域语义记忆
    const episodes = [
      // typescript 领域 — 3 种不同模式(各用关键词区分)，每种 3 次(各 9 条)
      makeEpisode("e1", "bug_fix", "typescript", "used old API", "use new API"),
      makeEpisode("e2", "bug_fix", "typescript", "used old API", "use new API"),
      makeEpisode("e3", "bug_fix", "typescript", "used old API", "use new API"),
      makeEpisode("e4", "bug_fix", "typescript", "used any type", "use unknown"),
      makeEpisode("e5", "bug_fix", "typescript", "used any type", "use unknown"),
      makeEpisode("e6", "bug_fix", "typescript", "used any type", "use unknown"),
      makeEpisode("e7", "bug_fix", "typescript", "ignored null", "check null"),
      makeEpisode("e8", "bug_fix", "typescript", "ignored null", "check null"),
      makeEpisode("e9", "bug_fix", "typescript", "ignored null", "check null"),
    ];

    const { newSemantic, newProcedural } = consolidator.consolidate(episodes, [], []);

    // 3 条语义（来自 3 种不同修正模式，每种 ≥3 次，且同属 typescript）
    expect(newSemantic).toHaveLength(3);

    // 3 条同领域语义 → 1 条程序记忆
    expect(newProcedural).toHaveLength(1);
    expect(newProcedural[0].domain).toBe("typescript");
    expect(newProcedural[0].steps).toHaveLength(3);
    expect(newProcedural[0].derivedFrom).toHaveLength(3);
  });
});
