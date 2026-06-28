/**
 * deriveMaturity 测试 — Phase 7
 *
 * 根据 session 计数推导认知成熟度 (§7 双轴交互):
 *   0-10 → "novice", 10-50 → "competent", 50+ → "expert"
 */

import { describe, it, expect } from "vitest";
import { deriveMaturity, type MaturityLevel } from "./maturity";

describe("deriveMaturity (Phase 7)", () => {
  it("0 session → novice", () => {
    expect(deriveMaturity(0)).toBe("novice");
  });

  it("5 sessions → novice (边界内)", () => {
    expect(deriveMaturity(5)).toBe("novice");
  });

  it("10 sessions → competent (下边界)", () => {
    expect(deriveMaturity(10)).toBe("competent");
  });

  it("30 sessions → competent (中间)", () => {
    expect(deriveMaturity(30)).toBe("competent");
  });

  it("50 sessions → expert (下边界)", () => {
    expect(deriveMaturity(50)).toBe("expert");
  });

  it("100 sessions → expert (远超阈值)", () => {
    expect(deriveMaturity(100)).toBe("expert");
  });

  it("负数 → 安全降级为 novice", () => {
    expect(deriveMaturity(-1)).toBe("novice");
  });

  it("返回类型匹配 MaturityLevel", () => {
    const result: MaturityLevel = deriveMaturity(15);
    expect(["novice", "competent", "expert"]).toContain(result);
  });
});
