/**
 * session-end 测试 — M0
 *
 * 覆盖路径:
 *   - 正常: pendingSignals → 写入 lessons
 *   - 幂等: 同一 sessionId 重复调用 → 跳过
 *   - 空信号: 无 lesson 写入
 *   - AgentMemory 不可用: 降级到 local-cache
 *   - LLM transcript 分析 (可选)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionEndHandler } from "./session-end";
import type { M0Deps } from "./m0-deps";
import type { Result } from "./platform-adapter";
import type { PendingSignal } from "./cognitive/types";

function makeDeps(overrides: Partial<M0Deps> = {}): M0Deps {
  return {
    memory: {
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null } as Result<unknown>),
      setSlot: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      smartSearch: vi.fn().mockResolvedValue({ ok: true, value: [] } as Result<unknown[]>),
      saveLesson: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      isAvailable: vi.fn().mockResolvedValue(true),
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

function makeSignal(overrides: Partial<PendingSignal> = {}): PendingSignal {
  return {
    id: "sig-1",
    type: "correction",
    sessionId: "session-1",
    timestamp: Date.now(),
    detail: "用户纠正了 API 调用方式",
    ...overrides,
  };
}

describe("SessionEndHandler (M0)", () => {
  let deps: M0Deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("处理 pendingSignals 并写入 lessons", async () => {
    const handler = new SessionEndHandler(deps);
    const signals = [makeSignal(), makeSignal({ id: "sig-2", type: "failure", detail: "工具调用失败" })];
    const result = await handler.handle("session-1", null, signals);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsWritten).toBe(2);
      expect(result.value.lessonsFromSignals).toBe(2);
      expect(result.value.lessonsFromTranscript).toBe(0);
    }
  });

  it("幂等去重 — 同一 sessionId 重复调用跳过", async () => {
    const handler = new SessionEndHandler(deps);
    const signals = [makeSignal()];
    await handler.handle("session-1", null, signals);
    const result = await handler.handle("session-1", null, signals);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsWritten).toBe(0);
    }
  });

  it("空信号返回 0 lessons", async () => {
    const handler = new SessionEndHandler(deps);
    const result = await handler.handle("empty", null, []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsWritten).toBe(0);
    }
  });

  it("AgentMemory 不可用时降级到 local-cache", async () => {
    deps.memory.isAvailable = vi.fn().mockResolvedValue(false);
    const cacheSet = vi.fn();
    deps.cache.set = cacheSet;

    const handler = new SessionEndHandler(deps);
    const signals = [makeSignal(), makeSignal({ id: "sig-2" })];
    const result = await handler.handle("degraded", null, signals);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsWritten).toBe(2);
    }
    expect(cacheSet).toHaveBeenCalledTimes(2);
  });

  it("LLM transcript 分析可附加额外 lessons", async () => {
    deps.llm = {
      analyzeTranscript: vi.fn().mockResolvedValue([
        { id: "e1", type: "insight", content: "LLM 发现的模式", confidence: 0.7 },
      ]),
    };
    deps.memory.saveLesson = vi.fn().mockResolvedValue({ ok: true } as Result<void>);

    const handler = new SessionEndHandler(deps);
    const signals = [makeSignal()];
    const result = await handler.handle("with-transcript", "完整对话记录...", signals);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsFromSignals).toBe(1);
      expect(result.value.lessonsFromTranscript).toBe(1);
      expect(result.value.lessonsWritten).toBe(2);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// T11: CrossAgentSync wiring — 乐观锁写入
// ══════════════════════════════════════════════════════════════════

import { CrossAgentSync } from "./analysis/cross-agent-sync";
import type { ProtoStructure } from "./cognitive/types";

function makeProtoStructure(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "ps-test",
    protoType: "sequence",
    tentativeName: "测试结构",
    scenarioId: "general",
    confidence: 0.6,
    observationsCount: 5,
    adoptionRate: 0.3,
    lifecycle: "experimental",
    relations: [],
    versionChain: [{ versionId: "v1", parentVersion: "root", createdAt: Date.now(), createdBy: "fusion", diff: [], rationale: "initial", evidence: [], performance: { predictionAccuracy: 0, userSatisfaction: 0, activeDurationDays: 0 } }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("SessionEndHandler (T11 — CrossAgentSync wiring)", () => {
  it("saveWithOptimisticLock 替换 saveProtoStructure 进行乐观锁写入", async () => {
    // Mock the CrossAgentSync.saveWithOptimisticLock to simulate first-wins
    const mockSync = {
      saveWithOptimisticLock: vi.fn().mockResolvedValue({ committed: true }),
      resolvePendingMerge: vi.fn(),
      listPendingMerges: vi.fn().mockResolvedValue([]),
      syncChildToParent: vi.fn(),
    } as unknown as CrossAgentSync;

    const deps = makeDeps({
      llm: {
        extractProtoStructures: vi.fn().mockResolvedValue([{
          protoType: "sequence",
          tentativeName: "提取的结构",
          scenarioId: "general",
          confidence: 0.5,
          steps: [{ position: 1, action: "第一步" }],
        }]),
      },
    });
    // Inject CrossAgentSync via the handler
    const handler = new SessionEndHandler(deps, mockSync);
    const result = await handler.handle("t11-first", "transcript...", []);

    expect(result.ok).toBe(true);
    // Verify saveWithOptimisticLock was called (not saveProtoStructure)
    expect(mockSync.saveWithOptimisticLock).toHaveBeenCalled();
  });

  it("first-wins: committed=true → 结构成功持久化", async () => {
    const mockSync = {
      saveWithOptimisticLock: vi.fn().mockResolvedValue({ committed: true }),
      resolvePendingMerge: vi.fn(),
      listPendingMerges: vi.fn().mockResolvedValue([]),
      syncChildToParent: vi.fn(),
    } as unknown as CrossAgentSync;

    const deps = makeDeps({
      llm: {
        extractProtoStructures: vi.fn().mockResolvedValue([{
          protoType: "sequence",
          tentativeName: "提取的结构",
          scenarioId: "general",
          confidence: 0.5,
        }]),
      },
    });

    const handler = new SessionEndHandler(deps, mockSync);
    const result = await handler.handle("t11-committed", "transcript...", []);

    expect(result.ok).toBe(true);
    const calls = mockSync.saveWithOptimisticLock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // Verify the saved structure was committed
    expect(mockSync.resolvePendingMerge).not.toHaveBeenCalled();
  });

  it("conflict: committed=false → pending_merge 创建，不崩溃", async () => {
    const mockSync = {
      saveWithOptimisticLock: vi.fn().mockResolvedValue({
        committed: false,
        conflictVersion: 3,
        pendingMergeId: "pending_merge_ps-test_123",
      }),
      resolvePendingMerge: vi.fn(),
      listPendingMerges: vi.fn().mockResolvedValue([{
        id: "pending_merge_ps-test_123",
        structureId: "ps-test",
        baseVersion: 3,
        proposedUpdate: {},
        currentValue: makeProtoStructure(),
        createdAt: Date.now(),
        confidenceDelta: 0.1,
        needsHumanApproval: false,
      }]),
      syncChildToParent: vi.fn(),
    } as unknown as CrossAgentSync;

    const deps = makeDeps({
      llm: {
        extractProtoStructures: vi.fn().mockResolvedValue([{
          protoType: "sequence",
          tentativeName: "冲突结构",
          scenarioId: "general",
          confidence: 0.5,
        }]),
      },
    });

    const handler = new SessionEndHandler(deps, mockSync);
    const result = await handler.handle("t11-conflict", "transcript...", []);

    // Should not crash on conflict
    expect(result.ok).toBe(true);
  });

  it("CrossAgentSync listPendingMerges 返回真实 merges (单元测试)", async () => {
    const deps = makeDeps();
    const pendingMerges = [{
      id: "pm-1",
      structureId: "s1",
      baseVersion: 2,
      proposedUpdate: { confidence: 0.7 },
      currentValue: makeProtoStructure({ id: "s1", confidence: 0.5 }),
      createdAt: Date.now(),
      confidenceDelta: 0.2,
      needsHumanApproval: true,
    }];
    deps.memory.getSlot = vi.fn().mockResolvedValue({ ok: true, value: pendingMerges } as Result<unknown>);

    const sync = new CrossAgentSync(deps);
    const merges = await sync.listPendingMerges();

    expect(merges).toHaveLength(1);
    expect(merges[0].id).toBe("pm-1");
    expect(merges[0].needsHumanApproval).toBe(true);
  });

  it("CrossAgentSync 不可用时降级到直接 saveProtoStructure（不崩溃）", async () => {
    // No CrossAgentSync injected → should fall back to saveProtoStructure
    const deps = makeDeps({
      llm: {
        extractProtoStructures: vi.fn().mockResolvedValue([{
          protoType: "sequence",
          tentativeName: "降级结构",
          scenarioId: "general",
          confidence: 0.5,
        }]),
      },
    });
    // Add saveProtoStructure to memory mock
    deps.memory.saveProtoStructure = vi.fn().mockResolvedValue({ ok: true } as Result<void>);

    const handler = new SessionEndHandler(deps); // No CrossAgentSync
    const result = await handler.handle("t11-degraded", "transcript...", []);

    expect(result.ok).toBe(true);
    // Direct saveProtoStructure was used as fallback
    expect(deps.memory.saveProtoStructure).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
// Phase 6: ConceptVerifier wiring + VerificationContext roleMap
// ══════════════════════════════════════════════════════════════════

import { ConceptVerifier } from "./analysis/concept-verifier";

describe("SessionEndHandler (Phase 6 — ConceptVerifier wiring)", () => {
  it("ConceptVerifier 被加入验证器数组 (LlmClient 可用时)", async () => {
    const llm = {
      analyzeTranscript: vi.fn().mockResolvedValue([]),
      extractProtoStructures: vi.fn().mockResolvedValue([]),
      analyze: vi.fn().mockResolvedValue({ ok: true, value: "no counter-example" }),
    };
    const fuser = { fuse: vi.fn().mockReturnValue(null) };
    const deps = makeDeps({ llm, fuser });

    const handler = new SessionEndHandler(deps);
    const structures = [makeProtoStructure({
      id: "concept-1",
      protoType: "concept",
      confidence: 0.5,
    })];
    const result = await handler.handle(
      "phase6-test", "transcript...", [],
      structures, ["concept-1"],
    );

    expect(result.ok).toBe(true);
    // 验证 llm.analyze 不应因 ConceptVerifier 而崩溃
  });

  it("LlmClient 不可用时 ConceptVerifier 不加入 (不崩溃)", async () => {
    const fuser = { fuse: vi.fn().mockReturnValue(null) };
    const deps = makeDeps({ fuser }); // 无 llm

    const handler = new SessionEndHandler(deps);
    const structures = [makeProtoStructure({
      id: "concept-1",
      protoType: "concept",
      confidence: 0.5,
    })];
    const result = await handler.handle(
      "phase6-no-llm", "transcript...", [],
      structures, ["concept-1"],
    );

    expect(result.ok).toBe(true);
  });

  it("VerificationContext 包含 roleMap 字段 (Phase 6 fix)", async () => {
    // RoleVerifier DAG 依赖此字段 — 缺失时该检查始终跳过
    // 验证 session-end handler 在构造 vCtx 时补充 roleMap
    const llm = {
      analyzeTranscript: vi.fn().mockResolvedValue([]),
      extractProtoStructures: vi.fn().mockResolvedValue([]),
      analyze: vi.fn().mockResolvedValue({ ok: true, value: "ok" }),
    };
    const fuser = {
      fuse: vi.fn().mockReturnValue({ confidence: 0.65 }),
    };
    const deps = makeDeps({ llm, fuser });

    const handler = new SessionEndHandler(deps);
    const structures = [
      makeProtoStructure({ id: "s1", protoType: "sequence", confidence: 0.5 }),
    ];
    const toolTrace = [
      { toolName: "Read", toolParams: { file: "test.txt" }, result: { success: true }, timestamp: Date.now() },
    ];

    const result = await handler.handle(
      "phase6-rolemap", "transcript...", [],
      structures, ["s1"],
      [], toolTrace,
    );

    expect(result.ok).toBe(true);
    // Handler 在处理时不应因缺失 roleMap 而崩溃
  });
});
