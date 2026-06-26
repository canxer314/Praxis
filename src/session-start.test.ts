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
import type { M0Deps } from "./m0-deps";
import type { Result } from "./platform-adapter";

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
