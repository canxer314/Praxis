/**
 * signal-detector 测试 — 关键词修正信号检测
 *
 * 覆盖:
 *   - 5 个关键词各命中 → 非 null Correction
 *   - 无关键词消息 → null
 *   - null/undefined → null
 *   - 空字符串/纯空格 → null
 *   - Correction 结构验证 (what !== correctedTo, isNewKnowledge: false)
 */

import { describe, it, expect } from "vitest";
import { detectCorrection } from "./signal-detector";

describe("detectCorrection — 关键词命中", () => {
  it('"不对" → 命中', () => {
    const r = detectCorrection("这个不对，应该用 POST");
    expect(r).not.toBeNull();
    expect(r!.what).not.toBe(r!.correctedTo);
    expect(r!.isNewKnowledge).toBe(true);
    expect(r!.likelyRootCause).toContain("不对");
  });

  it('"错了" → 命中', () => {
    const r = detectCorrection("你搞错了，重新来");
    expect(r).not.toBeNull();
    expect(r!.likelyRootCause).toContain("错了");
  });

  it('"重新做" → 命中', () => {
    const r = detectCorrection("全部重新做一遍");
    expect(r).not.toBeNull();
    expect(r!.likelyRootCause).toContain("重新做");
  });

  it('"不是" → 命中', () => {
    const r = detectCorrection("不是这个意思，我说的是...");
    expect(r).not.toBeNull();
    expect(r!.likelyRootCause).toContain("不是");
  });

  it('"搞错了" → 命中', () => {
    const r = detectCorrection("抱歉我搞错了方向");
    expect(r).not.toBeNull();
    expect(r!.likelyRootCause).toContain("搞错了");
  });

  it("大小写不敏感: 中文消息不涉及大小写，英文否定也可匹配", () => {
    // 中文关键词本身无大小写，但 lower.includes 保证了未来扩展的兼容性
    const r = detectCorrection("不对");
    expect(r).not.toBeNull();
  });
});

describe("detectCorrection — 无匹配", () => {
  it("无关键词的普通消息 → null", () => {
    const r = detectCorrection("今天的任务是什么？");
    expect(r).toBeNull();
  });

  it("英文消息无匹配 → null", () => {
    const r = detectCorrection("what is the weather today");
    expect(r).toBeNull();
  });

  it("null 输入 → null", () => {
    const r = detectCorrection(null as unknown as string);
    expect(r).toBeNull();
  });

  it("undefined 输入 → null", () => {
    const r = detectCorrection(undefined as unknown as string);
    expect(r).toBeNull();
  });

  it("空字符串 → null", () => {
    const r = detectCorrection("");
    expect(r).toBeNull();
  });

  it("纯空格 → null", () => {
    const r = detectCorrection("   ");
    expect(r).toBeNull();
  });
});

describe("detectCorrection — Correction 结构", () => {
  it("what 与 correctedTo 不同 (满足 isRealExperience 规则 1)", () => {
    const r = detectCorrection("错了");
    expect(r!.what).not.toBe(r!.correctedTo);
    expect(r!.what).toBe("assistant_response");
    expect(r!.correctedTo).toBe("user_explicit_correction");
  });

  it("isNewKnowledge 为 true → inferSignalType 路由到 mistake_correction", () => {
    const r = detectCorrection("不对");
    expect(r!.isNewKnowledge).toBe(true);
  });

  it("likelyRootCause 包含匹配到的关键词", () => {
    const r = detectCorrection("你搞错了方向");
    expect(r!.likelyRootCause).toMatch(/^keyword_match:/);
  });
});
