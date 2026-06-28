/**
 * cross-agent-sync.test.ts — T14: CrossAgentSync 单元测试
 *
 * 覆盖:
 *   - saveWithOptimisticLock: first-wins (committed=true)
 *   - saveWithOptimisticLock: conflict → pending_merge (committed=false)
 *   - resolvePendingMerge: 合并成功
 *   - resolvePendingMerge: merge 不存在 → null
 *   - listPendingMerges: 返回真实 merges
 *   - syncChildToParent: 统计 synced/conflicts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrossAgentSync, type PendingMerge } from "./cross-agent-sync";
import type { M0Deps } from "../m0-deps";
import type { ProtoStructure } from "../cognitive/types";
import type { Result } from "../platform-adapter";

function makeDeps(overrides: Partial<M0Deps> = {}): M0Deps {
  return {
    memory: {
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null } as Result<unknown>),
      setSlot: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      smartSearch: vi.fn().mockResolvedValue({ ok: true, value: [] } as Result<unknown[]>),
      saveLesson: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      isAvailable: vi.fn().mockResolvedValue(true),
      saveProtoStructure: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
    },
    cache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    },
    ...overrides,
  };
}

function makeStructure(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "ps-1",
    protoType: "sequence",
    tentativeName: "测试结构",
    scenarioId: "general",
    confidence: 0.7,
    observationsCount: 5,
    adoptionRate: 0.5,
    lifecycle: "experimental",
    relations: [],
    versionChain: [{ versionId: "v1", parentVersion: "root", createdAt: Date.now(), createdBy: "fusion", diff: [], rationale: "initial", evidence: [], performance: { predictionAccuracy: 0, userSatisfaction: 0, activeDurationDays: 0 } }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("CrossAgentSync — saveWithOptimisticLock", () => {
  it("first-wins: 无现有版本 → committed=true", async () => {
    const deps = makeDeps();
    // No existing version in slot (returns null)
    deps.memory.getSlot = vi.fn().mockResolvedValue({ ok: true, value: null });
    deps.memory.setSlot = vi.fn().mockResolvedValue({ ok: true });

    const sync = new CrossAgentSync(deps);
    const result = await sync.saveWithOptimisticLock(makeStructure());

    expect(result.committed).toBe(true);
    expect(deps.memory.getSlot).toHaveBeenCalledWith("proto_struct_ps-1");
    expect(deps.memory.setSlot).toHaveBeenCalled();
  });

  it("conflict: 客户端版本落后 → committed=false + pending_merge", async () => {
    const deps = makeDeps();
    // Existing version with versionChain length 5 (ahead of our 1)
    deps.memory.getSlot = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { ...makeStructure({ id: "ps-1" }), versionChain: new Array(5).fill({}) },
      })
      .mockResolvedValueOnce({ ok: true, value: [] }); // readPendingMerges

    deps.memory.setSlot = vi.fn().mockResolvedValue({ ok: true });

    const sync = new CrossAgentSync(deps);
    const result = await sync.saveWithOptimisticLock(makeStructure());

    expect(result.committed).toBe(false);
    expect(result.pendingMergeId).toBeDefined();
    expect(result.conflictVersion).toBeGreaterThan(0);
  });

  it("setSlot 失败 → refetch + 降级到 pending_merge", async () => {
    const deps = makeDeps();
    // 3 getSlot calls: initial read, refetch after CAS failure, readPendingMerges
    deps.memory.getSlot = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: null }) // 1) no existing structure
      .mockResolvedValueOnce({ // 2) refetch after CAS write failure — returns existing structure
        ok: true,
        value: { ...makeStructure({ id: "ps-1" }), versionChain: new Array(3).fill({}) },
      })
      .mockResolvedValueOnce({ ok: true, value: [] }); // 3) readPendingMerges — empty array
    deps.memory.setSlot = vi.fn()
      .mockResolvedValueOnce({ ok: false }) // CAS write fails
      .mockResolvedValueOnce({ ok: true }); // stage pending_merges succeeds

    const sync = new CrossAgentSync(deps);
    const result = await sync.saveWithOptimisticLock(makeStructure());

    expect(result.committed).toBe(false);
    expect(result.pendingMergeId).toBeDefined();
  });
});

describe("CrossAgentSync — listPendingMerges", () => {
  it("返回已暂存的 pending merges", async () => {
    const deps = makeDeps();
    const pendingMerges = [{
      id: "pm-1",
      structureId: "ps-1",
      baseVersion: 1,
      proposedUpdate: { confidence: 0.8 },
      currentValue: makeStructure(),
      createdAt: Date.now(),
      confidenceDelta: 0.1,
      needsHumanApproval: false,
    }];
    deps.memory.getSlot = vi.fn().mockResolvedValue({ ok: true, value: pendingMerges });

    const sync = new CrossAgentSync(deps);
    const result = await sync.listPendingMerges();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("pm-1");
  });

  it("空 pending_merges → 空数组", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({ ok: true, value: [] });

    const sync = new CrossAgentSync(deps);
    expect(await sync.listPendingMerges()).toEqual([]);
  });

  it("getSlot 失败 → 空数组 (不崩溃)", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockRejectedValue(new Error("network error"));

    const sync = new CrossAgentSync(deps);
    expect(await sync.listPendingMerges()).toEqual([]);
  });
});

describe("CrossAgentSync — syncChildToParent", () => {
  it("全部 first-wins → synced=N, conflicts=0", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({ ok: true, value: null });
    deps.memory.setSlot = vi.fn().mockResolvedValue({ ok: true });

    const sync = new CrossAgentSync(deps);
    const structures = [makeStructure({ id: "s1" }), makeStructure({ id: "s2" })];
    const result = await sync.syncChildToParent(structures);

    expect(result.synced).toBe(2);
    expect(result.conflicts).toBe(0);
  });
});

describe("CrossAgentSync — resolvePendingMerge", () => {
  it("merge 存在 → 合并成功", async () => {
    const deps = makeDeps();
    const pendingMerge = {
      id: "pm-1",
      structureId: "ps-1",
      baseVersion: 1,
      proposedUpdate: { confidence: 0.6, tentativeName: "新名称" },
      currentValue: makeStructure({ confidence: 0.8 }),
      createdAt: Date.now(),
      confidenceDelta: 0.2,
      needsHumanApproval: true,
    };
    deps.memory.getSlot = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [pendingMerge] }) // readPendingMerges
      .mockResolvedValueOnce({ ok: true, value: [] }); // after cleanup

    const sync = new CrossAgentSync(deps);
    const result = await sync.resolvePendingMerge("pm-1");

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.6); // Math.min(0.6, 0.8)
  });

  it("merge 不存在 → null", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({ ok: true, value: [] });

    const sync = new CrossAgentSync(deps);
    expect(await sync.resolvePendingMerge("nonexistent")).toBeNull();
  });

  it("getSlot 异常 → null (不崩溃)", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockRejectedValue(new Error("read error"));

    const sync = new CrossAgentSync(deps);
    expect(await sync.resolvePendingMerge("pm-1")).toBeNull();
  });
});
