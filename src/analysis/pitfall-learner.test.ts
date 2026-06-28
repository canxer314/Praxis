/**
 * analysis/pitfall-learner.ts — 陷阱反馈学习测试
 *
 * 架构参考: §5 ProtoTask, §6 自主学习触发, §11 analysis/pitfall-learner.ts
 *
 * 职责:
 *   - 陷阱命中 → ProtoTask 置信度更新
 *   - 误报率控制 (>30% 自动降 severity)
 *   - ProtoTask.commonPitfalls 增强
 */

import { describe, it, expect } from "vitest";
import {
  recordPitfallHit,
  markPitfallFalsePositive,
  shouldDowngradeSeverity,
  getPitfallStats,
  type PitfallStats,
  type ProtoTaskPitfall,
} from "./pitfall-learner";

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

function makePitfall(overrides?: Partial<ProtoTaskPitfall>): ProtoTaskPitfall {
  return {
    description: "接口变更导致集成失败",
    severity: "medium",
    mitigation: "提前锁定接口版本",
    hitCount: 0,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// recordPitfallHit
// ══════════════════════════════════════════════════════════════════

describe("recordPitfallHit", () => {
  it("increments hitCount on the matched pitfall", () => {
    const pitfall = makePitfall();
    const result = recordPitfallHit(pitfall);
    expect(result.hitCount).toBe(1);
    expect(result.description).toBe(pitfall.description);
    expect(result.severity).toBe(pitfall.severity);
  });

  it("does not mutate the original pitfall", () => {
    const pitfall = makePitfall();
    const result = recordPitfallHit(pitfall);
    expect(pitfall.hitCount).toBe(0);
    expect(result).not.toBe(pitfall);
  });

  it("accumulates hits across multiple calls", () => {
    let pf = makePitfall();
    pf = recordPitfallHit(pf);
    pf = recordPitfallHit(pf);
    pf = recordPitfallHit(pf);
    expect(pf.hitCount).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════
// markPitfallFalsePositive
// ══════════════════════════════════════════════════════════════════

describe("markPitfallFalsePositive", () => {
  it("tracks false positive count in stats", () => {
    const stats: PitfallStats = { hits: 5, falsePositives: 0 };
    const updated = markPitfallFalsePositive(stats);
    expect(updated.falsePositives).toBe(1);
    expect(updated.hits).toBe(5);
  });

  it("does not mutate original stats", () => {
    const stats: PitfallStats = { hits: 5, falsePositives: 1 };
    const updated = markPitfallFalsePositive(stats);
    expect(stats.falsePositives).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════
// shouldDowngradeSeverity
// ══════════════════════════════════════════════════════════════════

describe("shouldDowngradeSeverity", () => {
  it("returns false when false positive rate is 0%", () => {
    const stats: PitfallStats = { hits: 10, falsePositives: 0 };
    expect(shouldDowngradeSeverity(stats)).toBe(false);
  });

  it("returns false when rate is exactly 30%", () => {
    const stats: PitfallStats = { hits: 10, falsePositives: 3 };
    expect(shouldDowngradeSeverity(stats)).toBe(false);
  });

  it("returns true when rate exceeds 30%", () => {
    // 5/15 = 33.3% > 30%
    const stats: PitfallStats = { hits: 10, falsePositives: 5 };
    expect(shouldDowngradeSeverity(stats)).toBe(true);
  });

  it("returns false when rate equals 30% exactly", () => {
    // 3/10 = 30% — NOT > 30%
    const stats: PitfallStats = { hits: 7, falsePositives: 3 };
    expect(shouldDowngradeSeverity(stats)).toBe(false);
  });

  it("returns false when too few observations (min 3 total)", () => {
    const stats: PitfallStats = { hits: 0, falsePositives: 1 };
    expect(shouldDowngradeSeverity(stats)).toBe(false);
  });

  it("returns true for custom threshold", () => {
    const stats: PitfallStats = { hits: 5, falsePositives: 1 };
    // 1/5 = 20% > 15% threshold
    expect(shouldDowngradeSeverity(stats, 0.15)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// downgradeSeverity
// ══════════════════════════════════════════════════════════════════

describe("downgradeSeverity", () => {
  it("downgrades high→medium, medium→low, low stays low", async () => {
    // Dynamic import since downgradeSeverity is exported
    const { downgradeSeverity } = await import("./pitfall-learner");

    expect(downgradeSeverity("high")).toBe("medium");
    expect(downgradeSeverity("medium")).toBe("low");
    expect(downgradeSeverity("low")).toBe("low");
  });
});

// ══════════════════════════════════════════════════════════════════
// getPitfallStats
// ══════════════════════════════════════════════════════════════════

describe("getPitfallStats", () => {
  it("computes stats from a pitfall", () => {
    const pf = makePitfall({ hitCount: 5 });
    const stats = getPitfallStats(pf, 2);
    expect(stats.hits).toBe(5);
    expect(stats.falsePositives).toBe(2);
  });

  it("computes false positive rate correctly", () => {
    const pf = makePitfall({ hitCount: 10 });
    const stats = getPitfallStats(pf, 3);
    // rate = 3/(10+3) ≈ 0.23
    const rate = stats.falsePositives / (stats.hits + stats.falsePositives);
    expect(rate).toBeCloseTo(0.2307, 3);
  });
});
