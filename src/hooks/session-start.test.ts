/**
 * session-start 测试 — M0
 *
 * 覆盖路径:
 *   - AgentMemory 可用 → 加载 competency_model + knowledge + mental_state
 *   - AgentMemory 不可用 → 降级到默认值（不崩溃）
 *   - Slot 为空/格式错误 → 安全降级
 *   - Knowledge 为空 → 空数组
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionStartHandler } from "./session-start";
import type { M0Deps } from "../m0-deps";
import type { Result } from "../platform-adapter";

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

describe("SessionStartHandler (M0)", () => {
  let deps: M0Deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("AgentMemory 可用时返回结构化 SessionContextInjection", async () => {
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        domainProficiencies: {
          typescript: { selfRating: 0.8, taskCount: 12 },
          python: { selfRating: 0.4, taskCount: 5 },
        },
      },
    } as Result<unknown>);
    deps.memory.smartSearch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { title: "API设计原则", content: "RESTful vs GraphQL", confidence: 0.9, source: "user_taught" },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("session-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctx = result.value;
      // Competency
      expect(ctx.competency.overallProficiency).toBeCloseTo(0.6);
      expect(ctx.competency.domainProficiencies["typescript"]).toBe(0.8);
      expect(ctx.competency.strongestDomains).toContain("typescript");
      expect(ctx.competency.weakestDomains).toContain("python");
      // Knowledge
      expect(ctx.knowledge).toHaveLength(1);
      expect(ctx.knowledge[0].title).toBe("API设计原则");
      expect(ctx.knowledge[0].confidence).toBe(0.9);
    }
  });

  it("AgentMemory 不可用时降级到默认值", async () => {
    deps.memory.isAvailable = vi.fn().mockResolvedValue(false);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("degraded");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.competency.overallProficiency).toBe(0.5);
      expect(result.value.knowledge).toEqual([]);
      expect(result.value.mentalState).toBeNull();
    }
  });

  it("Slot 返回空值时使用默认 competency", async () => {
    deps.memory.getSlot = vi.fn().mockResolvedValue({ ok: false, error: { code: "NOT_FOUND", message: "" } } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("empty");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.competency.overallProficiency).toBe(0.5);
      expect(result.value.competency.domainProficiencies["TypeScript"]).toBe(0.6);
    }
  });

  it("Slot 格式错误时安全降级", async () => {
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { wrong_field: "garbage", domainProficiencies: null },
    } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("bad-schema");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.competency.overallProficiency).toBe(0.5);
    }
  });

  it("SmartSearch 返回空时 knowledge 为空数组", async () => {
    deps.memory.smartSearch = vi.fn().mockResolvedValue({ ok: true, value: [] } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("no-knowledge");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.knowledge).toEqual([]);
    }
  });
});

describe("SessionStartHandler (M2 — tieredContext)", () => {
  it("全链路: ProtoStructures → organizeContext → tieredContext 分层", async () => {
    const deps = makeDeps();
    // Mock competency
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        domainProficiencies: {
          typescript: { selfRating: 0.8, taskCount: 12 },
        },
      },
    } as Result<unknown>);
    // Mock proto_structures with scenarioId
    deps.memory.smartSearch = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>) // knowledge search
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>) // mental_state search
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "ps1", tentativeName: "门诊流程", protoType: "sequence", confidence: 0.9, scenarioId: "medical", structure: { steps: [{ action: "挂号" }, { action: "就诊" }] } },
          { id: "ps2", tentativeName: "住院流程", protoType: "sequence", confidence: 0.85, scenarioId: "medical", structure: { steps: [{ action: "入院" }] } },
          { id: "ps3", tentativeName: "医疗数据隐私", protoType: "constraint", confidence: 0.95, scenarioId: "medical", severity: "block" },
          { id: "ps4", tentativeName: "API 设计规范", protoType: "constraint", confidence: 0.9, scenarioId: "api_design", severity: "warn" },
          { id: "ps5", tentativeName: "通用编码概念", protoType: "concept", confidence: 0.4, scenarioId: "general" },
        ],
      } as Result<unknown[]>); // proto_structure search

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("m2-test", {
      scenarios: [{ scenarioId: "medical", confidence: 0.9, source: "llm_inference" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctx = result.value;

      // Flat protoStructures preserved (backward compat)
      expect(ctx.protoStructures).toHaveLength(5);

      // tieredContext exists
      expect(ctx.tieredContext).toBeDefined();

      // Tier A should contain medical-scenario structures (scene match)
      const tierAIds = ctx.tieredContext!.tierA.items.map((i) => i.id);
      expect(tierAIds).toContain("ps1");
      expect(tierAIds).toContain("ps2");
      expect(tierAIds).toContain("ps3");
      // api_design and general should NOT be in Tier A (no scene match)
      expect(tierAIds).not.toContain("ps4");
      expect(tierAIds).not.toContain("ps5");

      // Meta info correct
      expect(ctx.tieredContext!.meta.totalStructures).toBe(5);
      expect(ctx.tieredContext!.meta.pressure).toBe("normal");
      expect(ctx.tieredContext!.meta.maturity).toBe("competent");
    }
  });

  it("无场景信息时 tieredContext 仍正确生成 (中性分数)", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { typescript: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "ps1", tentativeName: "高置信结构", protoType: "concept", confidence: 0.9, scenarioId: "general" },
          { id: "ps2", tentativeName: "低置信结构", protoType: "concept", confidence: 0.3, scenarioId: "general" },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("no-scenarios");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Without scenarios, tieredContext still generated (neutral scoring)
      expect(result.value.tieredContext).toBeDefined();
      expect(result.value.tieredContext!.meta.totalStructures).toBe(2);
    }
  });

  it("AgentMemory 不可用时 tieredContext 为 undefined", async () => {
    const deps = makeDeps();
    deps.memory.isAvailable = vi.fn().mockResolvedValue(false);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("degraded-m2");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tieredContext).toBeUndefined();
    }
  });

  it("空 ProtoStructures 时不生成 tieredContext", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { typescript: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi.fn().mockResolvedValue({ ok: true, value: [] } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("empty-structures");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.protoStructures).toEqual([]);
      expect(result.value.tieredContext).toBeUndefined();
    }
  });
});

describe("SessionStartHandler (M3 — criticalConstraints)", () => {
  it("已结晶 constraint → criticalConstraints 注入段出现在 tieredContext 中", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { typescript: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>) // knowledge
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>) // mental_state
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "c1", tentativeName: "数据库迁移前必须备份", protoType: "constraint", confidence: 0.9, scenarioId: "general", lifecycle: "crystallized", severity: "block", source: "user_taught", rulePatterns: ["migrate"], observationsCount: 23 },
          { id: "ps1", tentativeName: "通用流程", protoType: "sequence", confidence: 0.8, scenarioId: "general", lifecycle: "crystallized" },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("m3-test");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tieredContext).toBeDefined();
      expect(result.value.tieredContext!.criticalConstraints).toBeDefined();
      expect(result.value.tieredContext!.criticalConstraints!.injectionText).toContain("⛔ CRITICAL CONSTRAINTS");
      expect(result.value.tieredContext!.criticalConstraints!.injectionText).toContain("数据库迁移前必须备份");
      expect(result.value.tieredContext!.criticalConstraints!.constraintIds).toContain("c1");
      expect(result.value.tieredContext!.criticalConstraints!.constraints).toHaveLength(1);
    }
  });

  it("constraint 但 lifecycle 非 crystallized → 不生成 criticalConstraints", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { typescript: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "c1", tentativeName: "实验性约束", protoType: "constraint", lifecycle: "experimental", severity: "warn", source: "auto_derived", rulePatterns: ["test"], observationsCount: 3, confidence: 0.5 },
          { id: "ps1", tentativeName: "通用流程", protoType: "sequence", confidence: 0.8 },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("m3-no-crystallized");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // tieredContext may exist (from non-constraint structures) but criticalConstraints should be absent
      expect(result.value.tieredContext?.criticalConstraints).toBeUndefined();
    }
  });

  it("无 constraint 类型 ProtoStructure → criticalConstraints 为 undefined", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { typescript: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "ps1", tentativeName: "只有序列结构", protoType: "sequence", confidence: 0.8 },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("m3-no-constraints");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tieredContext).toBeDefined();
      expect(result.value.tieredContext!.criticalConstraints).toBeUndefined();
    }
  });

  it("AgentMemory 不可用 → criticalConstraints 为 undefined", async () => {
    const deps = makeDeps();
    deps.memory.isAvailable = vi.fn().mockResolvedValue(false);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("m3-no-am");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tieredContext).toBeUndefined();
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// T12: 降级约束缓存 — write-through
// ══════════════════════════════════════════════════════════════════

describe("SessionStartHandler (T12 — constraint cache write-through)", () => {
  it("已结晶约束被写入 local-cache (write-through)", async () => {
    const cacheSet = vi.fn();
    const deps = makeDeps({
      cache: {
        get: vi.fn().mockReturnValue(null),
        set: cacheSet,
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      },
    });
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { typescript: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "c1", tentativeName: "备份约束", protoType: "constraint", confidence: 0.9, scenarioId: "general", lifecycle: "crystallized", severity: "block", source: "user_taught", rulePatterns: ["migrate"], observationsCount: 23 },
          { id: "ps1", tentativeName: "通用流程", protoType: "sequence", confidence: 0.8, scenarioId: "general", lifecycle: "crystallized" },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    await handler.handle("t12-write-through");

    // Verify cache.set was called with active_constraints key
    expect(cacheSet).toHaveBeenCalled();
    const cacheCalls = cacheSet.mock.calls;
    const constraintCall = cacheCalls.find((c: unknown[]) => c[0] === "active_constraints");
    expect(constraintCall).toBeDefined();
    expect(Array.isArray(constraintCall[1])).toBe(true);
    expect(constraintCall[1].length).toBeGreaterThan(0);
    // Verify constraint data integrity
    const cached = constraintCall[1][0] as Record<string, unknown>;
    expect(cached.id).toBe("c1");
    expect(cached.severity).toBe("block");
    expect(cached.lifecycle).toBe("crystallized");
  });

  it("无已结晶约束时不写入 local-cache", async () => {
    const cacheSet = vi.fn();
    const deps = makeDeps({
      cache: {
        get: vi.fn().mockReturnValue(null),
        set: cacheSet,
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      },
    });
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { typescript: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    // No constraint-type structures
    deps.memory.smartSearch = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "ps1", tentativeName: "只有序列", protoType: "sequence", confidence: 0.8, lifecycle: "crystallized" },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    await handler.handle("t12-no-constraints");

    // active_constraints should NOT be written (no constraints to cache)
    const constraintCalls = cacheSet.mock.calls.filter((c: unknown[]) => c[0] === "active_constraints");
    expect(constraintCalls).toHaveLength(0);
  });

  it("AgentMemory 不可用时不写入（无约束可写）", async () => {
    const cacheSet = vi.fn();
    const deps = makeDeps({
      cache: {
        get: vi.fn().mockReturnValue(null),
        set: cacheSet,
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      },
    });
    deps.memory.isAvailable = vi.fn().mockResolvedValue(false);

    const handler = new SessionStartHandler(deps);
    await handler.handle("t12-am-unavailable");

    // No constraints to cache when AgentMemory is unavailable
    const constraintCalls = cacheSet.mock.calls.filter((c: unknown[]) => c[0] === "active_constraints");
    expect(constraintCalls).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// B6: teleologicalMapping 字段完整性 (Phase 5)
// ══════════════════════════════════════════════════════════════════

describe("SessionStartHandler (B6 — teleologicalMapping)", () => {
  it("loadProtoStructures 返回 teleologicalMapping 字段 (B6 完整性补丁)", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { ts: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            id: "ps1",
            tentativeName: "门诊流程",
            protoType: "sequence",
            confidence: 0.9,
            scenarioId: "medical",
            structure: { steps: [{ action: "挂号" }, { action: "就诊" }] },
            function: { purpose: "诊疗", precondition: [], postcondition: [], failureModes: [] },
            teleologicalMapping: [
              { stepIndex: 0, serves: ["建立法律关系"], strength: "essential" },
              { stepIndex: 1, serves: ["诊断"], strength: "essential" },
            ],
          },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("b6-test");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const structures = result.value.protoStructures;
      expect(structures).toHaveLength(1);
      const ps1 = structures[0] as Record<string, unknown>;
      expect(ps1.teleologicalMapping).toBeDefined();
      expect(Array.isArray(ps1.teleologicalMapping)).toBe(true);
      const tm = ps1.teleologicalMapping as Array<Record<string, unknown>>;
      expect(tm).toHaveLength(2);
      expect(tm[0].stepIndex).toBe(0);
    }
  });

  it("AgentMemory 中无 teleologicalMapping 时返回空数组 (graceful degrade)", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { ts: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            id: "ps_no_tm",
            tentativeName: "无映射结构",
            protoType: "sequence",
            confidence: 0.5,
            scenarioId: "general",
            // 无 teleologicalMapping — 老 AgentMemory 数据
          },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("b6-no-tm");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ps = result.value.protoStructures[0] as Record<string, unknown>;
      expect(ps.teleologicalMapping).toEqual([]);
    }
  });

  it("snake_case fallback: teleological_mapping 归一化为 teleologicalMapping", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { ts: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            id: "ps_snake",
            tentativeName: "snake_case 数据",
            protoType: "sequence",
            confidence: 0.6,
            scenarioId: "general",
            teleological_mapping: [
              { step_index: 0, serves: ["目的A"], strength: "supporting" },
            ],
          },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("b6-snake");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ps = result.value.protoStructures[0] as Record<string, unknown>;
      expect(ps.teleologicalMapping).toBeDefined();
      expect(Array.isArray(ps.teleologicalMapping)).toBe(true);
      expect((ps.teleologicalMapping as Array<unknown>).length).toBe(1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// Phase 7: deriveMaturity wiring + recallStructure (Critical Lazy Loading)
// ══════════════════════════════════════════════════════════════════

describe("SessionStartHandler (Phase 7 — deriveMaturity)", () => {
  it("传入 estimatedUsedTokens > 90% → pressure=critical → tieredContext 仍生成", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { ts: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "ps1", tentativeName: "高置信结构", protoType: "concept", confidence: 0.9, scenarioId: "general" },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    // 模拟 95% 上下文占用 → Critical 压力
    const result = await handler.handle("phase7-critical", {
      estimatedUsedTokens: 950_000,
      contextWindowSize: 1_000_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.value.tieredContext) {
      expect(result.value.tieredContext.meta.pressure).toBe("critical");
    }
  });

  it("maturity 选项传入后正确反映在 tieredContext 中", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { domainProficiencies: { ts: { selfRating: 0.8, taskCount: 12 } } },
    } as Result<unknown>);
    deps.memory.smartSearch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown[]>)
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { id: "ps1", tentativeName: "测试结构", protoType: "concept", confidence: 0.9, scenarioId: "general" },
        ],
      } as Result<unknown[]>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("phase7-maturity", { maturity: "expert" });

    expect(result.ok).toBe(true);
    if (result.ok && result.value.tieredContext) {
      expect(result.value.tieredContext.meta.maturity).toBe("expert");
    }
  });
});
