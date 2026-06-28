/**
 * analysis/degradation-checker.ts — 衰退条件检测测试
 *
 * 补充 structure-lifecycle.ts — 检测结构是否满足衰退条件。
 */

import { describe, it, expect } from "vitest";
import {
  checkDegradation,
  isStale,
  isBelowConfidence,
  isSuperseded,
  type DegradableStructure,
} from "./degradation-checker";

function makeStruct(overrides?: Partial<DegradableStructure>): DegradableStructure {
  return {
    id: "ps-001",
    protoType: "sequence",
    confidence: 0.6,
    lifecycle: "experimental",
    updatedAt: Date.now(),
    createdAt: Date.now() - 86400000 * 30,
    lastReferencedAt: Date.now() - 86400000 * 10,
    supersededById: undefined,
    ...overrides,
  };
}

describe("isStale", () => {
  it("returns true when not referenced for 60 days", () => {
    const s = makeStruct({ lastReferencedAt: Date.now() - 86400000 * 65 });
    expect(isStale(s, 60)).toBe(true);
  });

  it("returns false when recently referenced", () => {
    const s = makeStruct({ lastReferencedAt: Date.now() - 86400000 * 5 });
    expect(isStale(s, 60)).toBe(false);
  });

  it("uses createdAt when lastReferencedAt is null", () => {
    const s = makeStruct({ lastReferencedAt: undefined, createdAt: Date.now() - 86400000 * 70 });
    expect(isStale(s, 60)).toBe(true);
  });
});

describe("isBelowConfidence", () => {
  it("returns true when confidence below threshold", () => {
    expect(isBelowConfidence(makeStruct({ confidence: 0.1 }), 0.3)).toBe(true);
  });

  it("returns false when confidence above threshold", () => {
    expect(isBelowConfidence(makeStruct({ confidence: 0.5 }), 0.3)).toBe(false);
  });
});

describe("isSuperseded", () => {
  it("returns true when structure has a superseding structure", () => {
    expect(isSuperseded(makeStruct({ supersededById: "ps-002" }))).toBe(true);
  });

  it("returns false when no superseding structure", () => {
    expect(isSuperseded(makeStruct({ supersededById: undefined }))).toBe(false);
  });
});

describe("checkDegradation", () => {
  it("returns empty when no degradation conditions met", () => {
    const results = checkDegradation([makeStruct()]);
    expect(results).toHaveLength(0);
  });

  it("flags stale structures", () => {
    const s = makeStruct({ lastReferencedAt: Date.now() - 86400000 * 70 });
    const results = checkDegradation([s]);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.type).toBe("stale");
  });

  it("flags low-confidence structures", () => {
    const s = makeStruct({ confidence: 0.15 });
    const results = checkDegradation([s], { confidenceThreshold: 0.2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.type).toBe("low_confidence");
  });

  it("flags superseded structures", () => {
    const s = makeStruct({ supersededById: "ps-new" });
    const results = checkDegradation([s]);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.type).toBe("superseded");
  });

  it("returns multiple flags for a degraded structure", () => {
    const s = makeStruct({
      confidence: 0.1,
      lastReferencedAt: Date.now() - 86400000 * 70,
      supersededById: "ps-new",
    });
    const results = checkDegradation([s], { confidenceThreshold: 0.2, staleDays: 60 });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});
