import { describe, it, expect, vi } from "vitest";
import { generateOntologyReport, formatOntologyReport } from "./praxis-ontology";
import type { M0Deps } from "../m0-deps";
import type { Result } from "../platform-adapter";

function makeDeps(structures: unknown[]): M0Deps {
  return {
    memory: {
      isAvailable: async () => true,
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null } as Result<unknown>),
      setSlot: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      smartSearch: vi.fn(async (_q: string, type?: string) => {
        if (type === "proto_structure") return { ok: true as const, value: structures };
        return { ok: true as const, value: [] };
      }),
      saveLesson: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
    },
    cache: { get: () => null, set: () => {}, list: () => [], delete: () => {} },
  } as unknown as M0Deps;
}

describe("/praxis ontology (M3.5)", () => {
  it("按生命周期分类 + 构建置信度直方图", async () => {
    const deps = makeDeps([
      { id: "ps1", protoType: "sequence", tentativeName: "门诊流程", confidence: 0.87, observationsCount: 23, adoptionRate: 0.78, lifecycle: "crystallized", versionChain: [{}, {}] },
      { id: "ps2", protoType: "concept", tentativeName: "分诊", confidence: 0.45, observationsCount: 5, lifecycle: "experimental" },
      { id: "ps3", protoType: "constraint", tentativeName: "旧约束", confidence: 0.1, observationsCount: 2, lifecycle: "deprecated" },
    ]);
    const report = await generateOntologyReport(deps);

    expect(report.crystallized).toHaveLength(1);
    expect(report.crystallized[0].tentativeName).toBe("门诊流程");
    expect(report.crystallized[0].version).toBe("v2");
    expect(report.proto).toHaveLength(1);
    expect(report.subsistent).toHaveLength(1);
    expect(report.subsistent[0].note).toBe("deprecated");
    expect(report.activeCategories).toContain("sequence");
    expect(report.activeCategories).toContain("concept");
    expect(report.confidenceBuckets.high).toBe(1); // 0.87
    expect(report.confidenceBuckets.low).toBe(1); // 0.45 → 0.2-0.5
    expect(report.confidenceBuckets.subsistent).toBe(1); // deprecated
    expect(report.confidenceBuckets.medium).toBe(0);
  });

  it("空结构集 → 不崩溃, 全 0", async () => {
    const deps = makeDeps([]);
    const report = await generateOntologyReport(deps);
    expect(report.totalStructures).toBe(0);
    expect(report.crystallized).toHaveLength(0);
  });

  it("formatOntologyReport 输出 §13 五段", () => {
    const report = {
      totalStructures: 1,
      crystallized: [{ id: "ps1", tentativeName: "X", confidence: 0.87, observationsCount: 5, adoptionRate: 0.5, version: "v1" }],
      proto: [],
      subsistent: [],
      activeCategories: ["sequence"],
      pendingProposals: 0,
      confidenceBuckets: { high: 1, medium: 0, low: 0, subsistent: 0 },
    };
    const text = formatOntologyReport(report);
    expect(text).toContain("已结晶结构");
    expect(text).toContain("原型结构");
    expect(text).toContain("亚存在结构");
    expect(text).toContain("范畴系统");
    expect(text).toContain("置信度分布");
    expect(text).toContain("0.8-1.0");
    expect(text).toContain("采纳率 50%"); // adoptionRate 0.5 → 50%
  });
});
