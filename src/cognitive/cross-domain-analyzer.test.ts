/**
 * E5 跨领域迁移测试 — Phase 2.2
 *
 * 覆盖:
 *   - selectAutoApplyCandidates: 阈值过滤 + 状态标记
 *   - Migration slot roundtrip: save → get
 *   - rollbackMigration: 回滚成功 / 未找到 / 已回滚
 *   - findDegradedMigrations: 退步检测 / 健康跳过 / 无评分跳过
 *   - CognitiveCore.applyCrossDomainMigrations: 策略创建 + 迁移追踪
 *   - E2E: analyze → selectAutoApplyCandidates → createStrategies → rollback
 */

import { describe, it, expect, vi } from "vitest";
import { Result } from "../platform-adapter";
import { CrossDomainAnalyzer, CrossDomainMemoryClient } from "./cross-domain-analyzer";
import { CognitiveCore, CognitiveCoreMemoryClient } from "./cognitive-core";
import type {
  CrossDomainAnalysis,
  CrossDomainSuggestion,
  CrossDomainMigration,
  MetacognitiveProfile,
  Strategy,
} from "./types";

// ══════════════════════════════════════════════════════════════════
// 辅助函数
// ══════════════════════════════════════════════════════════════════

function createMockMemory(
  overrides: Partial<{
    lessons: unknown[];
    slots: Record<string, unknown>;
    lessonRecallError: boolean;
  }> = {},
): CrossDomainMemoryClient & CognitiveCoreMemoryClient {
  const slots = new Map(Object.entries(overrides.slots ?? {}));
  const lessons = overrides.lessons ?? [];

  return {
    getSlot: vi.fn(async (name: string) => {
      if (slots.has(name)) return { ok: true, value: slots.get(name)! };
      return { ok: false, error: { code: "NOT_FOUND", message: "slot not found" } };
    }),
    setSlot: vi.fn(async (name: string, data: unknown) => {
      slots.set(name, data);
      return { ok: true, value: undefined };
    }),
    smartSearch: vi.fn(async () => ({ ok: true as const, value: [] })),
    lessonSave: vi.fn(async () => ({ ok: true, value: undefined })),
    lessonRecall: vi.fn(async () => {
      if (overrides.lessonRecallError) {
        return { ok: false, error: { code: "DOWN", message: "unavailable" } };
      }
      return { ok: true, value: lessons };
    }),
  };
}

function makeSuggestion(
  overrides: Partial<CrossDomainSuggestion> = {},
): CrossDomainSuggestion {
  return {
    sourceDomain: "typescript",
    targetDomain: "python",
    similarity: 0.8,
    pattern: "Use explicit type annotations",
    applicabilityRationale: "Both are typed languages",
    status: "pending_review",
    generatedAt: Date.now(),
    ...overrides,
  };
}

function makeAnalysis(
  suggestions: CrossDomainSuggestion[],
): CrossDomainAnalysis {
  return {
    suggestions,
    dataCount: 30,
    candidatesFound: suggestions.length,
    executedAt: Date.now(),
  };
}

function makeMigration(
  overrides: Partial<CrossDomainMigration> = {},
): CrossDomainMigration {
  return {
    id: "mig_test_001",
    sourceDomain: "typescript",
    targetDomain: "python",
    strategyId: "strat_e5_migrate_python_123",
    similarity: 0.85,
    pattern: "Use explicit types",
    appliedAt: Date.now() - 86400_000,
    baselineRating: 0.6,
    ...overrides,
  };
}

function makeProfile(ratings: Record<string, number>): MetacognitiveProfile {
  const domainProficiencies: MetacognitiveProfile["domainProficiencies"] = {};
  for (const [domain, selfRating] of Object.entries(ratings)) {
    domainProficiencies[domain] = {
      domain,
      selfRating,
      taskCount: 5,
      classificationConfidence: 0.6,
      autonomousThreshold: 0.3,
      exploratoryThreshold: 0.6,
      lastAssessed: Date.now(),
      taskDistribution: {},
      modeHistory: [],
    };
  }

  return {
    agentId: "test",
    domainProficiencies,
    calibrationGraduation: { count: 0, lastGraduated: 0 },
    knowledgeGaps: [],
    calibrationHistory: [],
  };
}

// ══════════════════════════════════════════════════════════════════
// selectAutoApplyCandidates
// ══════════════════════════════════════════════════════════════════

describe("CrossDomainAnalyzer.selectAutoApplyCandidates()", () => {
  it("选择相似度 >= 0.7 的 pending_review 建议", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const suggestions = [
      makeSuggestion({ similarity: 0.85, status: "pending_review" }),
      makeSuggestion({ similarity: 0.72, status: "pending_review" }),
    ];
    const analysis = makeAnalysis(suggestions);

    const candidates = analyzer.selectAutoApplyCandidates(analysis);

    expect(candidates).toHaveLength(2);
    for (const c of candidates) {
      expect(c.status).toBe("accepted");
      expect(c.similarity).toBeGreaterThanOrEqual(0.7);
    }
  });

  it("跳过相似度 < 0.7 的建议", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const suggestions = [
      makeSuggestion({ similarity: 0.69, status: "pending_review" }),
      makeSuggestion({ similarity: 0.3, status: "pending_review" }),
    ];
    const analysis = makeAnalysis(suggestions);

    const candidates = analyzer.selectAutoApplyCandidates(analysis);
    expect(candidates).toHaveLength(0);
  });

  it("跳过已非 pending_review 状态的建议", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const suggestions = [
      makeSuggestion({ similarity: 0.9, status: "accepted" }),
      makeSuggestion({ similarity: 0.8, status: "rejected" }),
    ];
    const analysis = makeAnalysis(suggestions);

    const candidates = analyzer.selectAutoApplyCandidates(analysis);
    expect(candidates).toHaveLength(0);
  });

  it("空建议列表返回空数组", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const candidates = analyzer.selectAutoApplyCandidates(makeAnalysis([]));
    expect(candidates).toHaveLength(0);
  });

  it("阈值边界值 0.70 被包含", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const suggestions = [makeSuggestion({ similarity: 0.7, status: "pending_review" })];
    const analysis = makeAnalysis(suggestions);

    const candidates = analyzer.selectAutoApplyCandidates(analysis);
    expect(candidates).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════
// Migration slot roundtrip
// ══════════════════════════════════════════════════════════════════

describe("CrossDomainAnalyzer migration persistence", () => {
  it("saveMigrations → getMigrations roundtrip", async () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const migrations = [
      makeMigration({ id: "m1" }),
      makeMigration({ id: "m2", targetDomain: "rust" }),
    ];

    await analyzer.saveMigrations(migrations);
    const result = await analyzer.getMigrations();

    expect(result.ok).toBe(true);
    expect((result as { ok: true; value: CrossDomainMigration[] }).value).toHaveLength(2);
    expect((result as { ok: true; value: CrossDomainMigration[] }).value[0].id).toBe("m1");
  });

  it("getMigrations 在 slot 不存在时返回空数组", async () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const result = await analyzer.getMigrations();

    expect(result.ok).toBe(true);
    expect((result as { ok: true; value: CrossDomainMigration[] }).value).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// rollbackMigration
// ══════════════════════════════════════════════════════════════════

describe("CrossDomainAnalyzer.rollbackMigration()", () => {
  it("成功回滚迁移记录", async () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const migration = makeMigration({ id: "mig_to_rollback" });
    await analyzer.saveMigrations([migration]);

    const result = await analyzer.rollbackMigration(
      "mig_to_rollback",
      "Target domain degraded",
      async () => true,
    );

    expect(result.ok).toBe(true);
    const rolled = (result as { ok: true; value: CrossDomainMigration }).value;
    expect(rolled.rolledBackAt).toBeGreaterThan(0);
    expect(rolled.rollbackReason).toContain("degraded");

    // 持久化已更新
    const getResult = await analyzer.getMigrations();
    const stored = (getResult as { ok: true; value: CrossDomainMigration[] }).value[0];
    expect(stored.rolledBackAt).toBeGreaterThan(0);
  });

  it("迁移不存在时返回错误", async () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const result = await analyzer.rollbackMigration(
      "nonexistent",
      "reason",
      async () => true,
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("已回滚的迁移再次回滚返回错误", async () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const migration = makeMigration({
      id: "already_rolled",
      rolledBackAt: Date.now(),
      rollbackReason: "previous rollback",
    });
    await analyzer.saveMigrations([migration]);

    const result = await analyzer.rollbackMigration(
      "already_rolled",
      "second attempt",
      async () => true,
    );

    expect(result.ok).toBe(false);
  });

  it("回滚回调失败时返回错误且不更新记录", async () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const migration = makeMigration({ id: "callback_fails" });
    await analyzer.saveMigrations([migration]);

    const result = await analyzer.rollbackMigration(
      "callback_fails",
      "should fail",
      async () => false,
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string } }).error.code).toBe("ROLLBACK_FAILED");

    // 记录未被修改
    const getResult = await analyzer.getMigrations();
    const stored = (getResult as { ok: true; value: CrossDomainMigration[] }).value[0];
    expect(stored.rolledBackAt).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// findDegradedMigrations
// ══════════════════════════════════════════════════════════════════

describe("CrossDomainAnalyzer.findDegradedMigrations()", () => {
  it("检测到退步的迁移 (delta < -0.1)", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const migrations = [
      makeMigration({
        id: "degraded_mig",
        targetDomain: "python",
        baselineRating: 0.6,
      }),
    ];

    const ratings = new Map([["python", 0.4]]); // -0.2 → degraded

    const degraded = analyzer.findDegradedMigrations(migrations, ratings);

    expect(degraded).toHaveLength(1);
    expect(degraded[0].migration.id).toBe("degraded_mig");
    expect(degraded[0].reason).toContain("0.60 → 0.40");
  });

  it("健康迁移不被标记 (delta >= -0.1)", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const migrations = [
      makeMigration({
        id: "healthy_mig",
        targetDomain: "python",
        baselineRating: 0.6,
      }),
    ];

    const ratings = new Map([["python", 0.55]]); // -0.05 → not degraded

    const degraded = analyzer.findDegradedMigrations(migrations, ratings);
    expect(degraded).toHaveLength(0);
  });

  it("评分提升的迁移不被标记", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const migrations = [
      makeMigration({
        id: "improved_mig",
        targetDomain: "python",
        baselineRating: 0.6,
      }),
    ];

    const ratings = new Map([["python", 0.75]]); // +0.15 → improved

    const degraded = analyzer.findDegradedMigrations(migrations, ratings);
    expect(degraded).toHaveLength(0);
  });

  it("已回滚的迁移被跳过", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const migrations = [
      makeMigration({
        id: "rolled_mig",
        targetDomain: "python",
        baselineRating: 0.6,
        rolledBackAt: Date.now(),
      }),
    ];

    const ratings = new Map([["python", 0.3]]); // would be degraded, but already rolled

    const degraded = analyzer.findDegradedMigrations(migrations, ratings);
    expect(degraded).toHaveLength(0);
  });

  it("目标领域无评分数据时跳过", () => {
    const mem = createMockMemory();
    const analyzer = new CrossDomainAnalyzer(mem);

    const migrations = [
      makeMigration({
        id: "no_data_mig",
        targetDomain: "rust",
        baselineRating: 0.6,
      }),
    ];

    const ratings = new Map([["python", 0.8]]); // no rust data

    const degraded = analyzer.findDegradedMigrations(migrations, ratings);
    expect(degraded).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// CognitiveCore.applyCrossDomainMigrations()
// ══════════════════════════════════════════════════════════════════

describe("CognitiveCore.applyCrossDomainMigrations()", () => {
  it("为高相似度建议创建策略并追踪迁移", async () => {
    const mem = createMockMemory({
      slots: {
        metacognitive_profile: makeProfile({ python: 0.55 }),
        strategy_registry: { strategies: [] },
      },
    });
    const core = new CognitiveCore({ memoryClient: mem });

    const suggestions = [
      makeSuggestion({
        targetDomain: "python",
        similarity: 0.85,
        pattern: "Type-driven design",
      }),
    ];
    const analysis = makeAnalysis(suggestions);

    const result = await core.applyCrossDomainMigrations(analysis);

    expect(result.ok).toBe(true);
    const migrations = (result as { ok: true; value: CrossDomainMigration[] }).value;
    expect(migrations).toHaveLength(1);
    expect(migrations[0].targetDomain).toBe("python");
    expect(migrations[0].baselineRating).toBe(0.55);

    // 策略已创建
    const strategies = core.strategyRegistry.getAll();
    const e5Strategies = strategies.filter((s) => s.id.startsWith("e5_migrate_"));
    expect(e5Strategies).toHaveLength(1);
    expect(e5Strategies[0].state).toBe("PROPOSED");
  });

  it("无高置信度候选时不创建策略", async () => {
    const mem = createMockMemory();
    const core = new CognitiveCore({ memoryClient: mem });

    const suggestions = [
      makeSuggestion({ similarity: 0.5, targetDomain: "python" }),
    ];
    const analysis = makeAnalysis(suggestions);

    const result = await core.applyCrossDomainMigrations(analysis);

    expect(result.ok).toBe(true);
    expect((result as { ok: true; value: CrossDomainMigration[] }).value).toHaveLength(0);
  });
});
