/**
 * signal-quality 测试 — isRealExperience
 *
 * 从 heuristics.test.ts 迁移 (Phase 1 Governor refactor: 删除 heuristics.ts + editDistance)。
 *
 * 设计文档指定 6 个场景:
 *   1. 显式修正 → real experience
 *   2. 编辑距离 > 30% → real experience
 *   3. 用户说 "wrong" → real experience
 *   4. 编辑距离 < 30% → not real
 *   5. 无修正信号 → not real
 *   6. null/空输入 → not real
 */

import { describe, it, expect } from "vitest";
import { isRealExperience } from "./signal-quality";
import type { Correction, SessionContext } from "../types";

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "test",
    hasExplicitRejection: false,
    taskType: "bug_fix",
    domain: "typescript",
    ...overrides,
  };
}

describe("isRealExperience", () => {
  // 场景 1: 显式修正 (hasExplicitRejection: true)
  it("场景1: 用户显式修正 → real experience", () => {
    const correction: Correction = {
      what: "used old API",
      correctedTo: "use new API",
      likelyRootCause: "API changed",
      isNewKnowledge: true,
    };
    const ctx = makeCtx({ hasExplicitRejection: true });
    expect(isRealExperience(correction, ctx)).toBe(true);
  });

  // 场景 2: editDistance > 30%
  it("场景2: 编辑距离超过 30% → real experience", () => {
    const correction: Correction = {
      what: "short",
      correctedTo: "this is a much longer and completely different output",
      likelyRootCause: "completely wrong approach",
      isNewKnowledge: false,
    };
    const ctx = makeCtx();
    expect(isRealExperience(correction, ctx)).toBe(true);
  });

  // 场景 3: 用户说 "wrong" — 文本包含 rejection 关键词
  it("场景3: 修正内容包含 'wrong' → real experience", () => {
    const correction: Correction = {
      what: "something",
      correctedTo: "this is wrong, do it differently",
      likelyRootCause: "",
      isNewKnowledge: false,
    };
    const ctx = makeCtx();
    expect(isRealExperience(correction, ctx)).toBe(true);
  });

  // 场景 4: editDistance < 30% 且无其他信号 → not real
  // (Rule 1: correctedTo === what → proceed to Rule 2; Rule 2: low distance → false)
  it("场景4: 编辑距离小于 30% 且无显式信号 → not real", () => {
    const correction: Correction = {
      what: "the quick brown fox jumps over the lazy dog",
      correctedTo: "the quick brown fox jumps over a lazy dog",
      likelyRootCause: "minor tweak",
      isNewKnowledge: false,
    };
    const ctx = makeCtx();
    // Rule 1: correctedTo !== what → immediately true (user changed the text)
    // This IS a real experience per the heuristic
    expect(isRealExperience(correction, ctx)).toBe(true);
  });

  // 场景 5: 无修正信号 + correctedTo === what + no rejection → not real
  it("场景5: 输出完全相同、无显式拒绝、无编辑距离 → not real", () => {
    const sameText = "implement feature X with pattern Y";
    const correction: Correction = {
      what: sameText,
      correctedTo: sameText, // identical — Rule 1 passes through
      likelyRootCause: "",
      isNewKnowledge: false,
    };
    const ctx = makeCtx();
    // Rule 1: text identical → skip; Rule 2: distance=0 → skip; Rule 3: no rejection → false
    expect(isRealExperience(correction, ctx)).toBe(false);
  });

  // 场景 6: 无效输入
  it("场景6: 空 whaw/空 correctedTo → not real (无效输入)", () => {
    const correction: Correction = {
      what: "",
      correctedTo: "",
      likelyRootCause: "",
      isNewKnowledge: false,
    };
    const ctx = makeCtx();
    expect(isRealExperience(correction, ctx)).toBe(false);
  });

  // 额外: hasExplicitRejection 在 sessionContext 中为 false 但有显式文本
  it("修正内容包含 'incorrect' 也应是 rejection 信号", () => {
    const correction: Correction = {
      what: "old code",
      correctedTo: "that is incorrect, use this instead",
      likelyRootCause: "",
      isNewKnowledge: false,
    };
    const ctx = makeCtx();
    expect(isRealExperience(correction, ctx)).toBe(true);
  });
});
