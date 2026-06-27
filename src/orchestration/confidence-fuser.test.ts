/**
 * ConfidenceFuser 测试 — 7 源加权融合
 */

import { describe, it, expect } from "vitest";
import { ConfidenceFuser } from "./confidence-fuser";
import type { SignalSourceInput } from "../cognitive/types";

function makeSource(name: string, value: number, confidence = 0.8): SignalSourceInput {
  return { structureId: "test_struct", sourceName: name, value, confidence, evidence: "test" };
}

describe("ConfidenceFuser.fuse", () => {
  it("7 源全部可用 → 融合结果落于 [0, 1]", () => {
    const fuser = new ConfidenceFuser();
    const sources: SignalSourceInput[] = [
      makeSource("statistical", 0.8),
      makeSource("llm_marker", 0.7),
      makeSource("user_correction", 0.9),
      makeSource("role_verifier", 0.6),
      makeSource("concept_verifier", 0.75),
      makeSource("outcome_feedback", 0.5),
      makeSource("mid_session", 0.65),
    ];

    const result = fuser.fuse(sources);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThan(0);
    expect(result!.confidence).toBeLessThanOrEqual(1);
    expect(result!.sourceCount).toBe(7);
    expect(result!.contributions).toHaveLength(7);
  });

  it("仅 1 个源 → 返回 null", () => {
    const fuser = new ConfidenceFuser();
    const sources = [makeSource("statistical", 0.8)];

    const result = fuser.fuse(sources);
    expect(result).toBeNull();
  });

  it("4 个源 → 权重按比例重分配", () => {
    const fuser = new ConfidenceFuser();
    const sources: SignalSourceInput[] = [
      makeSource("statistical", 0.8),
      makeSource("user_correction", 0.9),
      makeSource("role_verifier", 0.6),
      makeSource("concept_verifier", 0.75),
    ];

    // Available: statistical(0.25) + user_correction(0.12) + role_verifier(0.12) + concept_verifier(0.08) = 0.57
    // Missing: llm_marker(0.25) + outcome_feedback(0.10) + mid_session(0.08) = 0.43
    // Proportional: statistical = 0.25 + 0.43 * (0.25/0.57) ≈ 0.439
    const redist = fuser.redistributeWeights(new Set(["statistical", "user_correction", "role_verifier", "concept_verifier"]));
    expect(redist.statistical).toBeCloseTo(0.25 + 0.43 * (0.25 / 0.57), 2);
    expect(redist.user_correction).toBeCloseTo(0.12 + 0.43 * (0.12 / 0.57), 2);
    expect(redist.llm_marker).toBe(0);
    expect(redist.outcome_feedback).toBe(0);
    expect(redist.mid_session).toBe(0);
  });

  it("user_correction 源输出 1.0 → 融合结果偏高", () => {
    const fuser = new ConfidenceFuser();
    const withCorrection = fuser.fuse([
      makeSource("statistical", 0.5),
      makeSource("llm_marker", 0.5),
      makeSource("user_correction", 1.0),
    ]);
    const withoutCorrection = fuser.fuse([
      makeSource("statistical", 0.5),
      makeSource("llm_marker", 0.5),
    ]);

    expect(withCorrection).not.toBeNull();
    expect(withoutCorrection).not.toBeNull();
    expect(withCorrection!.confidence).toBeGreaterThan(withoutCorrection!.confidence);
  });

  it("多次融合 → decompose 显示各源贡献", () => {
    const fuser = new ConfidenceFuser();
    const sources: SignalSourceInput[] = [
      makeSource("statistical", 0.8),
      makeSource("llm_marker", 0.7),
      makeSource("user_correction", 0.9),
    ];

    const result = fuser.fuse(sources);
    expect(result).not.toBeNull();
    const decomposed = fuser.decompose(result!);
    expect(decomposed).toHaveLength(3);
    expect(decomposed.find((d) => d.sourceName === "statistical")).toBeTruthy();
    expect(decomposed.find((d) => d.sourceName === "llm_marker")).toBeTruthy();
  });

  it("同源去重 — 取最新 (confidence 最高的), 保留其他不同源", () => {
    const fuser = new ConfidenceFuser();
    const sources: SignalSourceInput[] = [
      { ...makeSource("statistical", 0.3), confidence: 0.5 },  // old
      { ...makeSource("statistical", 0.8), confidence: 0.9 },  // newer — replaces old
      makeSource("llm_marker", 0.7),                           // different source
    ];

    const result = fuser.fuse(sources);
    expect(result).not.toBeNull();
    expect(result!.sourceCount).toBe(2); // statistical (deduped) + llm_marker
    const stat = result!.contributions.find((c) => c.sourceName === "statistical");
    expect(stat!.value).toBe(0.8); // kept the newer one
  });

  it("全零权重 → 返回 null", () => {
    const fuser = new ConfidenceFuser();
    const sources = [makeSource("unknown_source", 0.5)];
    const result = fuser.fuse(sources);
    // "unknown_source" not in weights → weight=0 → totalWeight=0 → null
    expect(result).toBeNull();
  });
});

describe("ConfidenceFuser.getWeights", () => {
  it("返回默认权重", () => {
    const fuser = new ConfidenceFuser();
    const w = fuser.getWeights();
    expect(w.statistical).toBe(0.25);
    expect(w.llm_marker).toBe(0.25);
    expect(w.concept_verifier).toBe(0.08);
  });

  it("支持自定义权重", () => {
    const fuser = new ConfidenceFuser({ statistical: 0.5, llm_marker: 0.1 });
    const w = fuser.getWeights();
    expect(w.statistical).toBe(0.5);
    expect(w.llm_marker).toBe(0.1);
    expect(w.concept_verifier).toBe(0.08); // unchanged
  });
});
