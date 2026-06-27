import { describe, it, expect } from "vitest";
import { CategoryAuditor } from "./category-auditor";
import type { ProtoStructure } from "../cognitive/types";

function makeStructure(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "struct-1",
    protoType: "sequence",
    tentativeName: "Test Flow",
    scenarioId: "test-scenario",
    confidence: 0.5,
    observationsCount: 10,
    adoptionRate: 0.5,
    lifecycle: "experimental",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as ProtoStructure;
}

describe("CategoryAuditor", () => {
  const auditor = new CategoryAuditor();

  it("returns insufficient_data for empty inputs", async () => {
    const report = await auditor.run([], []);
    expect(report.status).toBe("insufficient_data");
    expect(report.blindSpots.length).toBe(0);
    expect(report.domainForks.length).toBe(0);
  });

  it("reports data_insufficient for low-count clusters", async () => {
    const report = await auditor.run(
      [{ pattern: "minor pattern", count: 2, last30Days: 1 }],
      [makeStructure({ observationsCount: 2 })],
    );
    expect(report.status).toBe("ok");
    expect(report.blindSpots.length).toBeGreaterThan(0);
    expect(report.blindSpots[0].diagnosis).toBe("data_insufficient");
  });

  it("reports category_insufficient for high-count clusters without LLM", async () => {
    const report = await auditor.run(
      [{ pattern: "complex correction pattern", count: 5, last30Days: 5 }],
      [makeStructure({ observationsCount: 10 })],
    );
    expect(report.status).toBe("ok");
    const categoryBlind = report.blindSpots.find(b => b.diagnosis === "category_insufficient");
    expect(categoryBlind).toBeDefined();
  });

  it("skips domain homogeneity check with <10 structures", async () => {
    const structures = Array.from({ length: 5 }, (_, i) =>
      makeStructure({ id: `s${i}`, scenarioId: `scen-${i % 2}` }),
    );
    const report = await auditor.run(
      [{ pattern: "test", count: 5, last30Days: 5 }],
      structures,
    );
    expect(report.domainForks.length).toBe(0);
    expect(report.message).toBeTruthy();
  });

  it("runs domain homogeneity with sufficient structures", async () => {
    const structures = Array.from({ length: 12 }, (_, i) =>
      makeStructure({ id: `s${i}`, scenarioId: `scen-${i % 3}`, protoType: i < 6 ? "sequence" : "constraint" }),
    );
    const report = await auditor.run([], structures);
    expect(report.status).toBe("ok");
    expect(report.existingTypesHealth.length).toBe(5);
  });

  it("reports existing types health", async () => {
    const structures = [
      makeStructure({ protoType: "sequence", confidence: 0.8 }),
      makeStructure({ protoType: "sequence", confidence: 0.6 }),
      makeStructure({ protoType: "role", confidence: 0.9 }),
    ];
    const report = await auditor.run(
      [{ pattern: "test", count: 5, last30Days: 5 }],
      structures,
    );
    const seqHealth = report.existingTypesHealth.find(t => t.protoType === "ProtoSequence");
    expect(seqHealth?.health).toBeGreaterThan(0);
  });
});
