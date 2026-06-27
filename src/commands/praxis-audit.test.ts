/**
 * praxis-audit.test.ts — T14: 认知健康度报告测试
 *
 * 覆盖:
 *   - 僵尸结构检测 (adoptionRate < 20% AND confidence > 0.7)
 *   - 低估结构检测 (adoptionRate > 60% AND confidence < 0.4)
 *   - 衰退警告 (60 天未更新)
 *   - 约束违反统计 (从 audit_log entries 读取)
 *   - 置信度分布直方图
 *   - 降级路径 (AgentMemory 不可用)
 */

import { describe, it, expect, vi } from "vitest";
import { generateAuditReport } from "./praxis-audit";
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

describe("generateAuditReport", () => {
  it("空结构列表 → 空报告", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockResolvedValue({ ok: true, value: [] });

    const report = await generateAuditReport(deps);
    expect(report.totalStructures).toBe(0);
    expect(report.zombies).toEqual([]);
    expect(report.underestimated).toEqual([]);
  });

  it("僵尸检测: adoptionRate < 0.2 + confidence > 0.7", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { id: "z1", tentativeName: "僵尸结构", protoType: "sequence", confidence: 0.85, adoptionRate: 0.1, lifecycle: "crystallized", updatedAt: Date.now(), createdAt: Date.now() },
      ],
    });

    const report = await generateAuditReport(deps);
    expect(report.zombies).toHaveLength(1);
    expect(report.zombies[0].id).toBe("z1");
    expect(report.zombies[0].confidence).toBe(0.85);
  });

  it("低估检测: adoptionRate > 0.6 + confidence < 0.4", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { id: "u1", tentativeName: "低估结构", protoType: "sequence", confidence: 0.3, adoptionRate: 0.75, lifecycle: "experimental", updatedAt: Date.now(), createdAt: Date.now() },
      ],
    });

    const report = await generateAuditReport(deps);
    expect(report.underestimated).toHaveLength(1);
    expect(report.underestimated[0].id).toBe("u1");
  });

  it("衰退警告: 60 天未更新 + 非 deprecated/rejected", async () => {
    const deps = makeDeps();
    const oldDate = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 days ago
    deps.memory.smartSearch = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { id: "d1", tentativeName: "旧结构", protoType: "sequence", confidence: 0.5, adoptionRate: 0.3, lifecycle: "experimental", updatedAt: oldDate, createdAt: oldDate },
      ],
    });

    const report = await generateAuditReport(deps);
    expect(report.decayWarnings.length).toBeGreaterThan(0);
    const warning = report.decayWarnings.find(w => w.structureId === "d1");
    expect(warning).toBeDefined();
    expect(warning!.daysSinceLastUse).toBeGreaterThan(60);
  });

  it("deprecated/rejected 结构不产生衰退警告", async () => {
    const deps = makeDeps();
    const oldDate = Date.now() - 90 * 24 * 60 * 60 * 1000;
    deps.memory.smartSearch = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { id: "d1", tentativeName: "已弃用", protoType: "sequence", confidence: 0.3, adoptionRate: 0.1, lifecycle: "deprecated", updatedAt: oldDate, createdAt: oldDate },
        { id: "d2", tentativeName: "已拒绝", protoType: "sequence", confidence: 0.2, adoptionRate: 0.0, lifecycle: "rejected", updatedAt: oldDate, createdAt: oldDate },
      ],
    });

    const report = await generateAuditReport(deps);
    expect(report.decayWarnings).toHaveLength(0);
  });

  it("约束违反统计: 从 audit_log entries 读取", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockResolvedValue({ ok: true, value: [] });
    deps.memory.getSlot = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          entries: [
            { timestamp: Date.now(), type: "constraint_violation", detail: { constraintId: "c1" }, source: "before_tool_call" },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, value: null }) // architecture_audit
      .mockResolvedValueOnce({ ok: true, value: null }); // category_audit

    const report = await generateAuditReport(deps);
    expect(report.violations.length).toBeGreaterThan(0);
    expect(report.violations[0].constraintId).toBe("c1");
  });

  it("置信度分布包括所有 bucket", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { id: "s1", tentativeName: "A", protoType: "sequence", confidence: 0.25, adoptionRate: 0.3, lifecycle: "experimental", updatedAt: Date.now(), createdAt: Date.now() },
      ],
    });

    const report = await generateAuditReport(deps);
    const buckets = report.confidenceDistribution;
    expect(buckets.length).toBeGreaterThan(0);
    const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);
    expect(totalCount).toBeGreaterThanOrEqual(1);
  });

  it("AgentMemory 不可用 → 返回降级报告 (不崩溃)", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockRejectedValue(new Error("AgentMemory down"));

    const report = await generateAuditReport(deps);
    expect(report.totalStructures).toBe(0);
    expect(report.zombies).toEqual([]);
  });
});
