import { describe, it, expect } from "vitest";
import { ArchitectureAuditor } from "./architecture-auditor";
import type { ProtoStructure } from "../cognitive/types";

function makeStructure(overrides: Partial<ProtoStructure> = {}): ProtoStructure {
  return {
    id: "struct-1",
    protoType: "sequence",
    tentativeName: "Test Flow",
    scenarioId: "test-scenario",
    confidence: 0.9,
    observationsCount: 10,
    adoptionRate: 0.8,
    lifecycle: "crystallized",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as ProtoStructure;
}

describe("ArchitectureAuditor", () => {
  const auditor = new ArchitectureAuditor();

  it("calculates zombie rate correctly", async () => {
    const structures = [
      makeStructure({ id: "z1", confidence: 0.9, adoptionRate: 0.1 }),
      makeStructure({ id: "ok", confidence: 0.7, adoptionRate: 0.5 }),
    ];
    const report = await auditor.run([], structures, null);
    expect(report.zombieRate).toBe(0.5);
  });

  it("returns zero zombie rate for healthy structures", async () => {
    const structures = [
      makeStructure({ confidence: 0.6, adoptionRate: 0.5 }),
      makeStructure({ confidence: 0.8, adoptionRate: 0.3 }),
    ];
    const report = await auditor.run([], structures, null);
    expect(report.zombieRate).toBe(0);
  });

  it("finds weakest dimension", async () => {
    const model = { dimensions: { tool_proficiency: 0.8, domain_knowledge: 0.2, architecture: 0.9 } };
    const report = await auditor.run([], [makeStructure()], model);
    expect(report.weakestDimension).toBe("domain_knowledge");
  });

  it("handles empty structures gracefully", async () => {
    const report = await auditor.run([], [], null);
    expect(report.zombieRate).toBe(0);
    expect(report.decayRate).toBe(0);
    expect(report.overallHealth).toBeGreaterThan(0);
  });

  it("generates recommendations for high zombie rate", async () => {
    const structures = Array.from({ length: 5 }, (_, i) =>
      makeStructure({ id: `z${i}`, confidence: 0.9, adoptionRate: 0.1 }),
    );
    const report = await auditor.run([], structures, null);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations.some(r => r.category === "structure_health")).toBe(true);
  });

  it("skips adversarial challenge without LLM", async () => {
    const report = await auditor.run([], [makeStructure()], null);
    expect(report.adversarialResults.length).toBe(0);
  });
});
