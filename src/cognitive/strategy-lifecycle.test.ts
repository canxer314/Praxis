/**
 * E4 策略生命周期测试 — Phase 2.1
 *
 * 覆盖:
 *   - DORMANT → PROPOSED 重新激活 (reactivateDormant)
 *   - 领域匹配 / 通配符 / 不匹配
 *   - 审计日志记录
 *   - 持久化验证
 *   - 完整生命周期: PROPOSED → ... → DORMANT → PROPOSED (循环)
 *   - GapDetector → StrategyRegistry 协调链
 *   - finalizeLearning() 中 E4 不破坏主学习环路
 */

import { describe, it, expect, vi } from "vitest";
import { Result } from "../platform-adapter";
import {
  StrategyRegistry,
  StrategyApplier,
  StrategyMemoryClient,
} from "./strategy-registry";
import { MetacognitiveEngine, MetacognitiveMemoryClient } from "./metacognitive-engine";
import { GapDetector } from "./gap-detector";
import type { MetacognitiveProfile, KnowledgeGap, Strategy, StrategyState } from "./types";

// ══════════════════════════════════════════════════════════════════
// 辅助函数
// ══════════════════════════════════════════════════════════════════

function createMockMemory(
  slots: Record<string, unknown> = {},
): StrategyMemoryClient & MetacognitiveMemoryClient {
  const map = new Map(Object.entries(slots));
  return {
    getSlot: vi.fn(async (name: string) => {
      if (map.has(name)) return { ok: true, value: map.get(name)! };
      return { ok: false, error: { code: "NOT_FOUND", message: "slot not found" } };
    }),
    setSlot: vi.fn(async (name: string, data: unknown) => {
      map.set(name, data);
      return { ok: true, value: undefined };
    }),
    smartSearch: vi.fn(async () => ({ ok: true as const, value: [] })),
    lessonSave: vi.fn(async () => ({ ok: true, value: undefined })),
  };
}

function makeDormantStrategy(
  id: string,
  domain: string,
  overrides: Partial<Strategy> = {},
): Strategy {
  return {
    id,
    name: `Dormant strategy ${id}`,
    description: `Test strategy for ${domain}`,
    state: "DORMANT",
    domain,
    taskType: "*",
    config: { threshold: 0.5 },
    metrics: {
      activatedAt: Date.now() - 86400_000,
      rollbackCount: 1,
      successRate: 0.3,
      lastEvaluated: Date.now() - 3600_000,
    },
    auditLog: [
      {
        timestamp: Date.now() - 86400_000,
        fromState: "ACTIVE",
        toState: "DORMANT",
        reason: "Low success rate",
        source: "auto_rollback",
      },
    ],
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// StrategyRegistry.reactivateDormant()
// ══════════════════════════════════════════════════════════════════

describe("StrategyRegistry.reactivateDormant()", () => {
  it("将匹配领域的 DORMANT 策略转回 PROPOSED", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();

    // 添加一个 DORMANT 策略
    const dormant = makeDormantStrategy("d1", "typescript");
    registry.addProposal(dormant);

    const result = await registry.reactivateDormant(
      "typescript",
      "Gap detected in typescript",
    );

    expect(result.ok).toBe(true);
    expect((result as { ok: true; value: Strategy[] }).value).toHaveLength(1);

    const reactivated = (result as { ok: true; value: Strategy[] }).value[0];
    expect(reactivated.state).toBe("PROPOSED");
    expect(reactivated.id).toBe("d1");

    // 审计日志包含重新激活原因
    const lastEntry = reactivated.auditLog[reactivated.auditLog.length - 1];
    expect(lastEntry.fromState).toBe("DORMANT");
    expect(lastEntry.toState).toBe("PROPOSED");
    expect(lastEntry.reason).toContain("Gap detected");
  });

  it("跳过其他领域的 DORMANT 策略", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();

    registry.addProposal(makeDormantStrategy("d1", "typescript"));
    registry.addProposal(makeDormantStrategy("d2", "python"));

    const result = await registry.reactivateDormant("typescript", "reason");

    expect((result as { ok: true; value: Strategy[] }).value).toHaveLength(1);

    // python 策略仍为 DORMANT
    const d2 = registry.getAll().find((s) => s.id === "d2")!;
    expect(d2.state).toBe("DORMANT");
  });

  it("匹配 domain='*' 的通配符策略", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();

    registry.addProposal(makeDormantStrategy("d1", "*"));
    registry.addProposal(makeDormantStrategy("d2", "typescript"));

    // 以任意 domain 调用都应匹配通配符策略
    const result = await registry.reactivateDormant("python", "reason");

    const reactivated = (result as { ok: true; value: Strategy[] }).value;
    expect(reactivated.map((s) => s.id).sort()).toEqual(["d1"]);

    // typescript 策略未被匹配
    const d2 = registry.getAll().find((s) => s.id === "d2")!;
    expect(d2.state).toBe("DORMANT");
  });

  it("没有 DORMANT 策略时返回空数组", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();

    // 只有默认 ACTIVE 策略，无 DORMANT
    const result = await registry.reactivateDormant("typescript", "reason");

    expect(result.ok).toBe(true);
    expect((result as { ok: true; value: Strategy[] }).value).toHaveLength(0);
  });

  it("无匹配领域的 DORMANT 策略时返回空数组", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();

    registry.addProposal(makeDormantStrategy("d1", "python"));

    const result = await registry.reactivateDormant("typescript", "reason");

    expect(result.ok).toBe(true);
    expect((result as { ok: true; value: Strategy[] }).value).toHaveLength(0);

    // python 策略未被改动
    expect(registry.getAll().find((s) => s.id === "d1")!.state).toBe("DORMANT");
  });

  it("多个匹配策略全部重新激活", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();

    registry.addProposal(makeDormantStrategy("d1", "typescript"));
    registry.addProposal(makeDormantStrategy("d2", "typescript"));
    registry.addProposal(makeDormantStrategy("d3", "typescript"));

    const result = await registry.reactivateDormant("typescript", "reason");

    expect((result as { ok: true; value: Strategy[] }).value).toHaveLength(3);
    for (const s of (result as { ok: true; value: Strategy[] }).value) {
      expect(s.state).toBe("PROPOSED");
    }
  });

  it("重新激活后持久化", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();

    registry.addProposal(makeDormantStrategy("d1", "typescript"));

    await registry.reactivateDormant("typescript", "reason");

    // setSlot 应被调用以持久化
    expect(mem.setSlot).toHaveBeenCalled();
  });

  it("无匹配时不触发持久化", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();

    // 重置 mock 调用计数
    vi.clearAllMocks();

    await registry.reactivateDormant("typescript", "reason");

    // 无 DORMANT → 不调用 setSlot
    const setSlotCalls = (mem.setSlot as ReturnType<typeof vi.fn>).mock.calls;
    expect(setSlotCalls.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// 完整策略生命周期循环
// ══════════════════════════════════════════════════════════════════

describe("E4 full lifecycle — DORMANT → PROPOSED cycle", () => {
  async function buildRegistryWithStrategy(
    initialState: StrategyState = "PROPOSED",
  ): Promise<{ registry: StrategyRegistry; mem: StrategyMemoryClient; strategyId: string }> {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();

    const strategyId = "lifecycle_test";
    registry.addProposal({
      id: strategyId,
      name: "Lifecycle test strategy",
      description: "Testing full lifecycle",
      state: initialState,
      domain: "typescript",
      taskType: "*",
      config: {},
      metrics: {
        activatedAt: Date.now(),
        rollbackCount: 0,
        successRate: 1.0,
        lastEvaluated: Date.now(),
      },
      auditLog: [],
    });

    return { registry, mem, strategyId };
  }

  it("PROPOSED → DORMANT → reactivateDormant → PROPOSED (完整循环)", async () => {
    const { registry, strategyId } = await buildRegistryWithStrategy("PROPOSED");

    // 1. PROPOSED → PENDING_REVIEW
    let r = await registry.transition(strategyId, "PENDING_REVIEW", "Review started");
    expect(r.ok).toBe(true);

    // 2. PENDING_REVIEW → APPROVED
    r = await registry.transition(strategyId, "APPROVED", "Approved");
    expect(r.ok).toBe(true);

    // 3. APPROVED → ACTIVE
    r = await registry.transition(strategyId, "ACTIVE", "Activated");
    expect(r.ok).toBe(true);

    // 4. ACTIVE → DORMANT
    r = await registry.transition(strategyId, "DORMANT", "Low effectiveness");
    expect(r.ok).toBe(true);
    expect((r as { ok: true; value: Strategy }).value.state).toBe("DORMANT");

    // 5. DORMANT → PROPOSED (via reactivateDormant)
    const reactResult = await registry.reactivateDormant(
      "typescript",
      "Gap re-detected",
    );
    expect(reactResult.ok).toBe(true);
    expect((reactResult as { ok: true; value: Strategy[] }).value).toHaveLength(1);

    const final = (reactResult as { ok: true; value: Strategy[] }).value[0];
    expect(final.state).toBe("PROPOSED");

    // 完整审计链路: 6 条记录 (4 transitions + 1 dormant entry + 1 reactivation)
    expect(final.auditLog.length).toBe(5);
    expect(final.auditLog[final.auditLog.length - 1].fromState).toBe("DORMANT");
    expect(final.auditLog[final.auditLog.length - 1].toState).toBe("PROPOSED");
  });

  it("非 DORMANT 策略不被 reactivateDormant 影响", async () => {
    const { registry } = await buildRegistryWithStrategy("ACTIVE");

    const result = await registry.reactivateDormant("typescript", "reason");

    expect((result as { ok: true; value: Strategy[] }).value).toHaveLength(0);
    expect(registry.getAll().find((s) => s.id === "lifecycle_test")!.state).toBe("ACTIVE");
  });

  it("无效转换被拒绝", async () => {
    const { registry, strategyId } = await buildRegistryWithStrategy("PROPOSED");

    // PROPOSED → ACTIVE 无效 (必须经过 PENDING_REVIEW + APPROVED)
    const result = await registry.transition(strategyId, "ACTIVE", "skip steps");

    expect(result.ok).toBe(false);
    expect((result as { ok: false }).error!.code).toBe("INVALID_TRANSITION");
  });
});

// ══════════════════════════════════════════════════════════════════
// GapDetector → StrategyRegistry 协调链
// ══════════════════════════════════════════════════════════════════

describe("GapDetector → StrategyRegistry coordinator chain", () => {
  function createProfileWithGap(
    overrides: Partial<MetacognitiveProfile> = {},
  ): MetacognitiveProfile {
    return {
      agentId: "test_agent",
      domainProficiencies: {
        typescript: {
          domain: "typescript",
          selfRating: 0.2,
          taskCount: 5,
          classificationConfidence: 0.5,
          autonomousThreshold: 0.3,
          exploratoryThreshold: 0.6,
          lastAssessed: Date.now(),
          taskDistribution: {},
          modeHistory: [],
        },
      },
      calibrationGraduation: { count: 0, lastGraduated: 0 },
      knowledgeGaps: [],
      calibrationHistory: [
        {
          domain: "typescript",
          timestamp: Date.now() - 86_400_000,
          calibrationDelta: 0,
          previous: { selfRating: 0.2 },
          current: { selfRating: 0.2 },
          reason: "calibration 1",
        },
        {
          domain: "typescript",
          timestamp: Date.now() - 172_800_000,
          calibrationDelta: 0,
          previous: { selfRating: 0.2 },
          current: { selfRating: 0.2 },
          reason: "calibration 2",
        },
        {
          domain: "typescript",
          timestamp: Date.now() - 259_200_000,
          calibrationDelta: -0.05,
          previous: { selfRating: 0.25 },
          current: { selfRating: 0.2 },
          reason: "calibration 3",
        },
      ],
      ...overrides,
    };
  }

  it("GapDetector 检测到 PERSISTENT_GAP 后 reactivateDormant 被调用", async () => {
    const mem = createMockMemory();
    const engine = new MetacognitiveEngine(mem);

    // 注入低评分 profile — 3 次无改善 → PERSISTENT_GAP
    const profile = createProfileWithGap();
    await engine.saveProfile(profile);

    const registry = new StrategyRegistry(mem);
    await registry.load();

    // 添加一个 DORMANT 策略
    registry.addProposal(makeDormantStrategy("d1", "typescript"));

    // 运行 gap detection
    const gapDetector = new GapDetector(engine);
    const gapResult = await gapDetector.detect();

    expect(gapResult.ok).toBe(true);
    const escalated = (gapResult as { ok: true; value: { escalatedGaps: unknown[] } }).value
      .escalatedGaps;
    expect(escalated.length).toBeGreaterThan(0);

    // 模拟协调器: 有 escalated gap → reactivate
    if (escalated.length > 0) {
      const domains = new Set(
        escalated.map((g: KnowledgeGap & { gap?: { context: string } }) => {
          const context = "gap" in g ? (g as { gap: { context: string } }).gap.context : "";
          return context;
        }),
      );
      for (const domain of domains) {
        await registry.reactivateDormant(
          domain,
          `PERSISTENT_GAP — ${escalated.length} gap(s)`,
        );
      }
    }

    // DORMANT 策略已被重新激活
    const d1 = registry.getAll().find((s) => s.id === "d1")!;
    expect(d1.state).toBe("PROPOSED");
  });

  it("无 escalated gaps 时不触发 reactivateDormant", async () => {
    const mem = createMockMemory();
    const engine = new MetacognitiveEngine(mem);

    // 高评分 profile — 无缺口
    const profile: MetacognitiveProfile = {
      agentId: "test_agent",
      domainProficiencies: {
        typescript: {
          domain: "typescript",
          selfRating: 0.8,
          taskCount: 10,
          classificationConfidence: 0.7,
          autonomousThreshold: 0.3,
          exploratoryThreshold: 0.6,
          lastAssessed: Date.now(),
          taskDistribution: {},
          modeHistory: [],
        },
      },
      calibrationGraduation: { count: 0, lastGraduated: 0 },
      knowledgeGaps: [],
      calibrationHistory: [],
    };
    await engine.saveProfile(profile);

    const gapDetector = new GapDetector(engine);
    const gapResult = await gapDetector.detect();

    expect(gapResult.ok).toBe(true);
    expect(
      (gapResult as { ok: true; value: { escalatedGaps: unknown[] } }).value.escalatedGaps,
    ).toHaveLength(0);
  });

  it("GapDetector 失败不抛异常 — 协调器安全处理", async () => {
    // 模拟 getProfile 失败
    const mem = createMockMemory();
    // Override getSlot to always fail
    mem.getSlot = vi.fn(async () => ({
      ok: false,
      error: { code: "DOWN", message: "memory unavailable" },
    }));

    const engine = new MetacognitiveEngine(mem);
    const gapDetector = new GapDetector(engine);

    const result = await gapDetector.detect();
    // 应返回 error，不抛异常
    expect(result.ok).toBe(false);
  });
});

describe("StrategyApplier", () => {
  it("activate() writes dual snapshots + transitions to ACTIVE", async () => {
    const mem = createMockMemory({
      strategy_registry: {
        strategies: [{ id: "s1", name: "test", description: "", state: "APPROVED" as StrategyState, domain: "typescript", taskType: "*", config: {}, metrics: { activatedAt: 0, rollbackCount: 0, successRate: 1.0, lastEvaluated: 0 }, auditLog: [] }],
      },
    });
    const registry = new StrategyRegistry(mem);
    await registry.load();
    const applier = new StrategyApplier(registry, mem);

    const result = await applier.activate("s1");
    expect(result.ok).toBe(true);

    // Verify primary snapshot was written
    expect(mem.setSlot).toHaveBeenCalledWith(
      "strategy_snapshot_primary",
      expect.objectContaining({ strategies: expect.any(Array) }),
    );
    // Verify backup snapshot was written
    expect(mem.setSlot).toHaveBeenCalledWith(
      "strategy_snapshot_backup",
      expect.objectContaining({ strategies: expect.any(Array) }),
    );
    // Verify strategy state
    const strategy = registry.getAll().find(s => s.id === "s1");
    expect(strategy?.state).toBe("ACTIVE");
  });

  it("rollback() restores from primary snapshot", async () => {
    // Pre-populate primary snapshot
    const snapshot = {
      strategies: [{ id: "s1", name: "test", description: "", state: "ACTIVE" as StrategyState, domain: "typescript", taskType: "*", config: {}, metrics: { activatedAt: 0, rollbackCount: 0, successRate: 1.0, lastEvaluated: 0 }, auditLog: [] }],
    };
    const mem = createMockMemory({
      strategy_registry: {
        strategies: [{ id: "s1", name: "test", description: "", state: "ACTIVE" as StrategyState, domain: "typescript", taskType: "*", config: {}, metrics: { activatedAt: Date.now(), rollbackCount: 0, successRate: 1.0, lastEvaluated: 0 }, auditLog: [] }],
      },
      strategy_snapshot_primary: snapshot,
      strategy_snapshot_backup: snapshot,
    });
    const registry = new StrategyRegistry(mem);
    await registry.load();
    const applier = new StrategyApplier(registry, mem);

    const result = await applier.rollback("s1", "test rollback");
    expect(result.ok).toBe(true);

    const strategy = registry.getAll().find(s => s.id === "s1");
    expect(strategy?.state).toBe("ROLLED_BACK");
    expect(strategy?.auditLog.some(e => e.toState === "ROLLED_BACK")).toBe(true);
  });

  it("rollback() falls back to backup when primary unavailable", async () => {
    const snapshot = {
      strategies: [{ id: "s1", name: "test", description: "", state: "ACTIVE" as StrategyState, domain: "typescript", taskType: "*", config: {}, metrics: { activatedAt: 0, rollbackCount: 0, successRate: 1.0, lastEvaluated: 0 }, auditLog: [] }],
    };
    const mem = createMockMemory({
      strategy_registry: {
        strategies: [{ id: "s1", name: "test", description: "", state: "ACTIVE" as StrategyState, domain: "typescript", taskType: "*", config: {}, metrics: { activatedAt: 0, rollbackCount: 0, successRate: 1.0, lastEvaluated: 0 }, auditLog: [] }],
      },
      strategy_snapshot_backup: snapshot,
    });
    // Primary will fail because it's not in the mock slots

    const registry = new StrategyRegistry(mem);
    await registry.load();
    const applier = new StrategyApplier(registry, mem);

    const result = await applier.rollback("s1", "backup fallback test");
    expect(result.ok).toBe(true);
  });

  it("rollback() returns error when both snapshots unavailable", async () => {
    const mem = createMockMemory({
      strategy_registry: {
        strategies: [{ id: "s1", name: "test", description: "", state: "ACTIVE" as StrategyState, domain: "typescript", taskType: "*", config: {}, metrics: { activatedAt: 0, rollbackCount: 0, successRate: 1.0, lastEvaluated: 0 }, auditLog: [] }],
      },
    });
    const registry = new StrategyRegistry(mem);
    await registry.load();
    const applier = new StrategyApplier(registry, mem);

    const result = await applier.rollback("s1", "should fail");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string } }).error.code).toBe("SLOT_READ_ERROR");
  });
});
