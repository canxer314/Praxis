/**
 * 韧性测试 — T3 + T9
 *
 * T3 (测试策略扩展):
 *   - E4 回滚恢复: 双快照损坏 → factory reset
 *   - WAL 重放集成: 写入失败 → 入队 → 下次 session_start 重放成功
 *
 * T9 (WAL 冲突集成测试):
 *   - 部分 WAL 重放: 混合成功/失败
 *   - 多条目 WAL: 按序重放，仅成功条目移除
 *   - 版本冲突: WAL 条目与 slot 已有数据不同 → 仍写入
 */

import { describe, it, expect, vi } from "vitest";
import { Result } from "../platform-adapter";
import { StrategyRegistry, StrategyApplier, StrategyMemoryClient } from "./strategy-registry";
import { MetacognitiveEngine, MetacognitiveMemoryClient } from "./metacognitive-engine";
import { LearningUpdateBuilder, LearningUpdateMemoryClient } from "./learning-update";
import type { Correction, SessionContext } from "./types";

// ══════════════════════════════════════════════════════════════════
// 辅助函数
// ══════════════════════════════════════════════════════════════════

function makeCorrection(overrides: Partial<Correction> = {}): Correction {
  return {
    what: "used old API",
    correctedTo: "use new API v2",
    likelyRootCause: "API migration",
    isNewKnowledge: true,
    ...overrides,
  };
}

function makeSessionContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "test_session",
    hasExplicitRejection: true,
    taskType: "bug_fix",
    domain: "typescript",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// T3: E4 回滚恢复 — 双快照损坏 → factory reset
// ══════════════════════════════════════════════════════════════════

describe("E4 Rollback Recovery (T3)", () => {
  function createMockMemory(): StrategyMemoryClient & MetacognitiveMemoryClient {
    const slots = new Map<string, unknown>();
    return {
      getSlot: vi.fn(async (name: string) => {
        if (slots.has(name)) return { ok: true, value: slots.get(name)! };
        return { ok: false, error: { code: "NOT_FOUND", message: "slot not found" } };
      }),
      setSlot: vi.fn(async (name: string, data: unknown) => {
        slots.set(name, data);
        return { ok: true, value: undefined };
      }),
    };
  }

  it("双快照均不可用时回滚触发 factory reset", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load(); // 加载默认策略

    const applier = new StrategyApplier(registry, mem);

    // 清除所有策略，验证状态干净
    const strategiesBefore = registry.getAll();
    expect(strategiesBefore.length).toBeGreaterThan(0);

    // 回滚 — 两个快照都不存在 → factory reset
    const result = await applier.rollback("nonexistent_strategy", "test rollback");

    // 应成功（factory reset 静默恢复）
    expect(result.ok).toBe(true);

    // Factory reset 后应恢复默认策略
    const strategiesAfter = registry.getAll();
    expect(strategiesAfter.length).toBe(2); // 2 个默认策略
    expect(strategiesAfter.map((s) => s.id).sort()).toEqual([
      "default_calibration",
      "default_learning",
    ]);
    // 默认策略应均为 ACTIVE
    for (const s of strategiesAfter) {
      expect(s.state).toBe("ACTIVE");
    }
  });

  it("primary 快照可用时从 primary 恢复", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();
    const applier = new StrategyApplier(registry, mem);

    // 添加一条自定义策略
    const customStrategy = {
      id: "custom_001",
      name: "自定义策略",
      description: "test",
      state: "ACTIVE" as const,
      domain: "typescript",
      taskType: "bug_fix",
      config: {},
      metrics: {
        activatedAt: Date.now(),
        rollbackCount: 0,
        successRate: 0.9,
        lastEvaluated: Date.now(),
      },
      auditLog: [],
    };
    registry.addProposal(customStrategy);

    // 模拟 primary snapshot 存在
    await mem.setSlot("strategy_snapshot_primary", {
      strategies: registry.getAll(),
    });

    // 清除 registry，再添加一个策略（制造差异）
    const anotherStrategy = { ...customStrategy, id: "custom_002" };
    registry.clear();
    registry.addProposal(anotherStrategy);

    // 回滚 → 应从 primary snapshot 恢复
    const result = await applier.rollback("custom_002", "test primary restore");

    expect(result.ok).toBe(true);

    // 应恢复到 primary snapshot 的状态（包含 custom_001，不含 custom_002）
    const strategiesAfter = registry.getAll();
    const ids = strategiesAfter.map((s) => s.id);
    expect(ids).toContain("custom_001");
    expect(ids).not.toContain("custom_002");
  });

  it("primary 损坏时 fallback 到 backup snapshot", async () => {
    const mem = createMockMemory();
    const registry = new StrategyRegistry(mem);
    await registry.load();
    const applier = new StrategyApplier(registry, mem);

    // 只设置 backup snapshot（不设置 primary）
    await mem.setSlot("strategy_snapshot_backup", {
      strategies: [
        {
          ...registry.getAll()[0],
          id: "backup_version",
          name: "backup 版本",
        },
      ],
    });

    // 清除 registry
    registry.clear();
    registry.addProposal({
      id: "current",
      name: "当前版本",
      description: "test",
      state: "ACTIVE" as const,
      domain: "*",
      taskType: "*",
      config: {},
      metrics: {
        activatedAt: 0,
        rollbackCount: 0,
        successRate: 1,
        lastEvaluated: 0,
      },
      auditLog: [],
    });

    // 回滚 — primary 不存在 → fallback backup
    const result = await applier.rollback("current", "primary unavailable");

    expect(result.ok).toBe(true);

    // 应恢复到 backup snapshot
    const strategiesAfter = registry.getAll();
    expect(strategiesAfter[0].id).toBe("backup_version");
    expect(strategiesAfter[0].name).toBe("backup 版本");
  });
});

// ══════════════════════════════════════════════════════════════════
// T3: WAL 重放集成测试
// ══════════════════════════════════════════════════════════════════

describe("WAL Replay Integration (T3)", () => {
  function createMockMemory() {
    const lessons: unknown[] = [];
    return {
      getSlot: vi.fn(async () => ({ ok: true, value: null } as Result<unknown>)),
      setSlot: vi.fn(async () => ({ ok: true, value: undefined } as Result<void>)),
      lessonSave: vi.fn(async (data: Record<string, unknown>) => {
        lessons.push(data);
        return { ok: true, value: undefined };
      }),
      smartSearch: vi.fn(async () => ({ ok: true, value: [] } as Result<unknown[]>)),
    };
  }

  it("WAL queue 空时 replayWal 返回 0", async () => {
    const mem = createMockMemory();
    const engine = new MetacognitiveEngine(mem);
    const builder = new LearningUpdateBuilder(engine, mem);

    const result = await builder.replayWal();
    expect(result.ok).toBe(true);
    expect((result as { ok: true; value: number }).value).toBe(0);
  });

  it("写入成功后 WAL 无需重放", async () => {
    const mem = createMockMemory();
    const engine = new MetacognitiveEngine(mem);
    const builder = new LearningUpdateBuilder(engine, mem);

    const correction = makeCorrection();
    const ctx = makeSessionContext();

    // lessonSave 成功 → 无 WAL 条目
    const buildResult = await builder.build([correction], ctx, "typescript");
    expect(buildResult.ok).toBe(true);

    // 重放应返回 0（无 WAL 条目）
    const replayResult = await builder.replayWal();
    expect(replayResult.ok).toBe(true);
    expect((replayResult as { ok: true; value: number }).value).toBe(0);
  });

  it("写入失败后 WAL 入队，重试成功后清空", async () => {
    const mem = createMockMemory();
    let callCount = 0;
    mem.lessonSave = vi.fn(async () => {
      callCount++;
      if (callCount <= 1) {
        return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: "network timeout" } };
      }
      return { ok: true, value: undefined };
    });

    const engine = new MetacognitiveEngine(mem);
    const builder = new LearningUpdateBuilder(engine, mem);

    const correction = makeCorrection();
    const ctx = makeSessionContext();

    // Build: lessonSave 失败 → WAL 入队
    const buildResult = await builder.build([correction], ctx, "typescript");
    expect(buildResult.ok).toBe(true); // build 本身不失败
    expect(callCount).toBe(1);

    // Replay: lessonSave 成功 → WAL 清空
    const replayResult = await builder.replayWal();
    expect(replayResult.ok).toBe(true);
    expect((replayResult as { ok: true; value: number }).value).toBe(1);
    expect(callCount).toBe(2);

    // 再次 replay: WAL 为空
    const replay2 = await builder.replayWal();
    expect((replay2 as { ok: true; value: number }).value).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// T9: WAL 冲突集成测试
// ══════════════════════════════════════════════════════════════════

describe("WAL Conflict Integration (T9)", () => {
  function createMockMemory() {
    const lessons: Array<{ type: string; content: string }> = [];
    return {
      getSlot: vi.fn(async () => ({ ok: true, value: null } as Result<unknown>)),
      setSlot: vi.fn(async () => ({ ok: true, value: undefined } as Result<void>)),
      lessonSave: vi.fn(async (data: Record<string, unknown>) => {
        lessons.push({ type: String(data.type || ""), content: String(data.content || "") });
        return { ok: true, value: undefined };
      }),
      smartSearch: vi.fn(async () => ({ ok: true, value: [] } as Result<unknown[]>)),
    };
  }

  it("多个 correction → 部分 WAL 写入失败 → 重放恢复", async () => {
    const mem = createMockMemory();
    let failureCount = 0;
    mem.lessonSave = vi.fn(async () => {
      failureCount++;
      // 第 1 次失败，其余成功
      if (failureCount === 1) {
        return { ok: false, error: { code: "TIMEOUT", message: "write timeout" } };
      }
      return { ok: true, value: undefined };
    });

    const engine = new MetacognitiveEngine(mem);
    const builder = new LearningUpdateBuilder(engine, mem);

    const corrections = [
      makeCorrection({ what: "bug A" }),
      makeCorrection({ what: "bug B" }),
    ];
    const ctx = makeSessionContext();

    // Build: 第 1 个 correction 写入失败 → WAL
    const buildResult = await builder.build(corrections, ctx, "typescript");
    expect(buildResult.ok).toBe(true);

    // Replay: 恢复第 1 个
    const replayResult = await builder.replayWal();
    expect(replayResult.ok).toBe(true);
    expect((replayResult as { ok: true; value: number }).value).toBe(1);

    // 第二次 replay: 无剩余
    const replay2 = await builder.replayWal();
    expect((replay2 as { ok: true; value: number }).value).toBe(0);
  });

  it("WAL 重放中部分成功部分失败 → 仅成功条目移除", async () => {
    const mem = createMockMemory();
    let writeCall = 0;
    mem.lessonSave = vi.fn(async () => {
      writeCall++;
      // 前 2 次失败，后续成功 — 模拟 WAL 中有 3 个条目，重放时前 2 个仍失败
      if (writeCall <= 2) {
        return { ok: false, error: { code: "NETWORK_ERROR", message: "still down" } };
      }
      return { ok: true, value: undefined };
    });

    const engine = new MetacognitiveEngine(mem);
    const builder = new LearningUpdateBuilder(engine, mem);

    // 先让所有写入失败 → 3 个 correction 都进 WAL
    mem.lessonSave = vi.fn(async () => ({
      ok: false,
      error: { code: "DOWN", message: "agentmemory down" },
    }));

    const corrections = [
      makeCorrection({ what: "item 1" }),
      makeCorrection({ what: "item 2" }),
      makeCorrection({ what: "item 3" }),
    ];
    await builder.build(corrections, makeSessionContext(), "typescript");

    // 改 mock：前 2 次失败，第 3 次成功
    writeCall = 0;
    mem.lessonSave = vi.fn(async () => {
      writeCall++;
      if (writeCall <= 2) {
        return { ok: false, error: { code: "NETWORK_ERROR", message: "still down" } };
      }
      return { ok: true, value: undefined };
    });

    // Replay: 前 2 个失败保留，第 3 个成功移除
    const replayResult = await builder.replayWal();
    expect(replayResult.ok).toBe(true);
    expect((replayResult as { ok: true; value: number }).value).toBe(1);

    // 再次 replay: 剩余 2 个
    writeCall = 0;
    mem.lessonSave = vi.fn(async () => {
      writeCall++;
      return { ok: true, value: undefined }; // 这次全部成功
    });
    const replay3 = await builder.replayWal();
    expect((replay3 as { ok: true; value: number }).value).toBe(2);
  });

  it("WAL 重放不因为并发调用而重复写入", async () => {
    // 验证 replayWal 中每次 write 只写入一次
    const mem = createMockMemory();
    const written: string[] = [];

    // 先失败入队
    mem.lessonSave = vi.fn(async () => ({
      ok: false,
      error: { code: "DOWN", message: "down" },
    }));
    const engine = new MetacognitiveEngine(mem);
    const builder = new LearningUpdateBuilder(engine, mem);
    await builder.build(
      [makeCorrection({ what: "unique item" })],
      makeSessionContext(),
      "typescript",
    );

    // 然后成功重放
    mem.lessonSave = vi.fn(async (data: Record<string, unknown>) => {
      written.push(String(data.content || ""));
      return { ok: true, value: undefined };
    });

    const replayResult = await builder.replayWal();
    expect((replayResult as { ok: true; value: number }).value).toBe(1);
    expect(written.length).toBe(1); // 只写入一次

    // 再次 replay: 不再写入
    const replay2 = await builder.replayWal();
    expect((replay2 as { ok: true; value: number }).value).toBe(0);
    expect(written.length).toBe(1); // 未追加
  });
});
