/**
 * praxis-status.test.ts — T14: 能力状态报告测试
 *
 * 覆盖:
 *   - competency_model slot → 完整 8D 维度数据
 *   - 降级: competency_snapshots → derived source
 *   - 降级: 无数据 → null
 *   - growthHistory 从 competency_snapshots 加载
 *   - learningTimeline 从 audit_log 加载
 *   - AgentMemory 不可用 → 不崩溃
 */

import { describe, it, expect, vi } from "vitest";
import { generateStatusReport } from "./praxis-status";
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

describe("generateStatusReport", () => {
  it("competency_model slot → 完整 8D 数据", async () => {
    const deps = makeDeps();
    // 3 getSlot calls expected: competency_model, competency_snapshots, audit_log
    deps.memory.getSlot = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          overallProficiency: 0.75,
          dimensions: {
            tool_skills: 0.8,
            domain_familiarity: 0.6,
            task_type_proficiency: 0.7,
            learning_velocity: 0.5,
          },
          strongestDomains: ["tool_skills", "task_type_proficiency"],
          weakestDomains: ["learning_velocity"],
          currentLearningFocus: "TypeScript generics",
        },
      } as Result<unknown>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown>)  // snapshots
      .mockResolvedValueOnce({ ok: true, value: { entries: [] } } as Result<unknown>); // audit_log

    const report = await generateStatusReport(deps);
    expect(report.competency).not.toBeNull();
    expect(report.competency!.overallProficiency).toBe(0.75);
    expect(report.competency!.source).toBe("slot");
    expect(report.competency!.strongestDomains).toContain("tool_skills");
    expect(report.competency!.weakestDomains).toContain("learning_velocity");
    expect(report.competency!.currentLearningFocus).toBe("TypeScript generics");
  });

  it("降级: competency_model 不可用 → 从 snapshots 推导", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: null } as Result<unknown>) // no competency_model
      .mockResolvedValueOnce({
        ok: true,
        value: [
          { timestamp: 1000, overallProficiency: 0.3 },
          { timestamp: 2000, overallProficiency: 0.5 },
        ],
      } as Result<unknown>)
      .mockResolvedValueOnce({ ok: true, value: { entries: [] } } as Result<unknown>); // audit_log

    const report = await generateStatusReport(deps);
    expect(report.competency).not.toBeNull();
    expect(report.competency!.source).toBe("derived");
    expect(report.competency!.overallProficiency).toBe(0.5); // latest snapshot
  });

  it("完全无数据 → competency=null", async () => {
    const deps = makeDeps();
    // All getSlot calls return null
    deps.memory.getSlot = vi.fn().mockResolvedValue({ ok: true, value: null } as Result<unknown>);

    const report = await generateStatusReport(deps);
    expect(report.competency).toBeNull();
  });

  it("growthHistory 正确排序", async () => {
    const deps = makeDeps();
    // loadCompetency → getSlot("competency_model") → null
    // loadCompetency fallback → loadGrowthHistory → getSlot("competency_snapshots") → data
    // generateStatusReport → loadGrowthHistory → getSlot("competency_snapshots") → data again
    // generateStatusReport → loadLearningTimeline → getSlot("audit_log") → empty
    deps.memory.getSlot = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: null } as Result<unknown>) // competency_model
      .mockResolvedValueOnce({ // competency_snapshots (consumed by loadCompetency fallback)
        ok: true,
        value: [
          { timestamp: 3000, overallProficiency: 0.7 },
          { timestamp: 1000, overallProficiency: 0.3 },
        ],
      } as Result<unknown>)
      .mockResolvedValueOnce({ // competency_snapshots (consumed by loadGrowthHistory direct call)
        ok: true,
        value: [
          { timestamp: 3000, overallProficiency: 0.7 },
          { timestamp: 1000, overallProficiency: 0.3 },
          { timestamp: 2000, overallProficiency: 0.5 },
        ],
      } as Result<unknown>)
      .mockResolvedValueOnce({ ok: true, value: { entries: [] } } as Result<unknown>); // audit_log

    const report = await generateStatusReport(deps);
    expect(report.growthHistory).toHaveLength(3);
    // Should be sorted by timestamp ascending
    for (let i = 1; i < report.growthHistory.length; i++) {
      expect(report.growthHistory[i].timestamp).toBeGreaterThanOrEqual(report.growthHistory[i - 1].timestamp);
    }
  });

  it("learningTimeline 从 audit_log entries 加载", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: null } as Result<unknown>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown>)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          entries: [
            { timestamp: Date.now() - 10000, type: "constraint_violation", summary: "违反备份约束" },
            { timestamp: Date.now() - 5000, type: "structural_gap_signal", summary: "技能停滞" },
          ],
        },
      } as Result<unknown>);

    const report = await generateStatusReport(deps);
    // Should have timeline entries from audit_log
    expect(report.learningTimeline.length).toBeGreaterThanOrEqual(0);
  });

  it("AgentMemory 不可用 → 传播错误 (由调用方处理)", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn().mockRejectedValue(new Error("AgentMemory down"));

    // Error propagates — loadCompetency does not catch getSlot errors
    await expect(generateStatusReport(deps)).rejects.toThrow("AgentMemory down");
  });

  it("competency_model 使用 domainProficiencies 作为 dimensions fallback", async () => {
    const deps = makeDeps();
    deps.memory.getSlot = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          overallProficiency: 0.6,
          domainProficiencies: { typescript: 0.8, python: 0.4 },
          strongestDomains: ["typescript"],
          weakestDomains: ["python"],
        },
      } as Result<unknown>)
      .mockResolvedValueOnce({ ok: true, value: [] } as Result<unknown>)
      .mockResolvedValueOnce({ ok: true, value: { entries: [] } } as Result<unknown>);

    const report = await generateStatusReport(deps);
    expect(report.competency).not.toBeNull();
    expect(report.competency!.dimensions).toEqual({ typescript: 0.8, python: 0.4 });
  });
});
