/**
 * orchestration/pitfall-matcher.ts — 陷阱实时命中检测测试
 *
 * 架构参考: §5 陷阱追踪, §11 orchestration/pitfall-matcher.ts
 */

import { describe, it, expect } from "vitest";
import {
  matchPitfalls,
  findMatchingPitfall,
  type PitfallDef,
  type PitfallMatch,
} from "./pitfall-matcher";

const PITFALLS: PitfallDef[] = [
  { description: "接口变更导致集成失败", severity: "high", mitigation: "提前锁定接口版本" },
  { description: "环境变量未同步", severity: "medium", mitigation: "使用配置中心" },
  { description: "数据库迁移失败", severity: "high", mitigation: "迁移前备份" },
];

describe("matchPitfalls", () => {
  it("matches pitfalls by keyword in error message", () => {
    const matches = matchPitfalls(PITFALLS, "接口变更导致集成测试失败");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.pitfall.description).toBe("接口变更导致集成失败");
    expect(matches[0]!.matchedKeyword).toContain("接口");
  });

  it("matches multiple pitfalls", () => {
    const matches = matchPitfalls(PITFALLS, "接口变更后环境变量未同步");
    expect(matches).toHaveLength(2);
  });

  it("returns empty array when no pitfalls match", () => {
    const matches = matchPitfalls(PITFALLS, "一切正常运行");
    expect(matches).toHaveLength(0);
  });

  it("extracts keywords from pitfall descriptions", () => {
    // "数据库迁移失败" → keywords: ["数据库迁移", "迁移失败"]
    const matches = matchPitfalls(PITFALLS, "数据库迁移时发生错误");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.pitfall.description).toBe("数据库迁移失败");
  });

  it("returns confidence based on keyword match ratio", () => {
    const matches = matchPitfalls(PITFALLS, "接口变更导致集成失败，环境变量也有问题");
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.confidence).toBeGreaterThan(0);
      expect(m.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("findMatchingPitfall", () => {
  it("returns the first matching pitfall", () => {
    const match = findMatchingPitfall(PITFALLS, "接口变更了");
    expect(match).toBeTruthy();
    expect(match!.pitfall.description).toBe("接口变更导致集成失败");
  });

  it("returns undefined when no match", () => {
    expect(findMatchingPitfall(PITFALLS, "一切正常")).toBeUndefined();
  });
});
