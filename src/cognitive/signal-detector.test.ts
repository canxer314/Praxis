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
import { detectCorrection, detectCorrectionLLM } from "./signal-detector";
import type { LlmClient, Result } from "../platform-adapter";

// ---- Mock LLM Client ----

function mockLlm(response: string): LlmClient {
  return {
    analyze: async (): Promise<Result<string>> => ({ ok: true, value: response }),
  };
}

function mockLlmError(): LlmClient {
  return {
    analyze: async (): Promise<Result<string>> => ({
      ok: false,
      error: { code: "LLM_ERROR", message: "mock error" },
    }),
  };
}

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

  it("likelyRootCause 包含匹配到的关键词", () => {
    const r = detectCorrection("你搞错了方向");
    expect(r!.likelyRootCause).toMatch(/^keyword_match:/);
  });
});

describe("detectCorrection — isNewKnowledge 多样性", () => {
  it('包含 "应该" → 提供了新知识 → true', () => {
    const r = detectCorrection("不对，应该用 POST 请求");
    expect(r).not.toBeNull();
    expect(r!.isNewKnowledge).toBe(true);
  });

  it('包含 "改成" → 提供了新知识 → true', () => {
    const r = detectCorrection("不是这样，改成异步调用");
    expect(r).not.toBeNull();
    expect(r!.isNewKnowledge).toBe(true);
  });

  it('包含 "需要" → 提供了新知识 → true', () => {
    const r = detectCorrection("搞错了，需要先检查权限");
    expect(r).not.toBeNull();
    expect(r!.isNewKnowledge).toBe(true);
  });

  it('包含 "用" → 提供了新知识 → true', () => {
    const r = detectCorrection("错了，用 POST 方法");
    expect(r).not.toBeNull();
    expect(r!.isNewKnowledge).toBe(true);
  });

  it('包含 "改" → 提供了新知识 → true', () => {
    const r = detectCorrection("不是那样，直接改返回值");
    expect(r).not.toBeNull();
    expect(r!.isNewKnowledge).toBe(true);
  });

  it("纯否定无纠正内容 → false", () => {
    const r = detectCorrection("不是这个意思");
    expect(r).not.toBeNull();
    expect(r!.isNewKnowledge).toBe(false);
  });

  it("裸关键词无下文 → false", () => {
    const r = detectCorrection("错了");
    expect(r).not.toBeNull();
    expect(r!.isNewKnowledge).toBe(false);
  });

  it("自我纠正无替代方案 → false", () => {
    const r = detectCorrection("抱歉我搞错了方向");
    expect(r).not.toBeNull();
    expect(r!.isNewKnowledge).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// detectCorrectionLLM — LLM 语义检测
// ══════════════════════════════════════════════════════════════════

describe("detectCorrectionLLM — 真实纠正", () => {
  it("明确纠正+替代方案 → 返回 Correction", async () => {
    const llm = mockLlm(JSON.stringify({
      isCorrection: true,
      what: "使用了GET方法",
      correctedTo: "应该使用POST方法",
      isNewKnowledge: true,
      summary: "用户纠正HTTP方法选择",
    }));
    const r = await detectCorrectionLLM(llm, "不对，应该用POST");
    expect(r).not.toBeNull();
    expect(r!.what).toBe("使用了GET方法");
    expect(r!.correctedTo).toBe("应该使用POST方法");
    expect(r!.isNewKnowledge).toBe(true);
    expect(r!.likelyRootCause).toContain("llm_detected:");
  });

  it("单纯否定无替代方案 → isNewKnowledge: false", async () => {
    const llm = mockLlm(JSON.stringify({
      isCorrection: true,
      what: "assistant_response",
      correctedTo: "user_explicit_correction",
      isNewKnowledge: false,
      summary: "用户否定了回答但没有给出正确做法",
    }));
    const r = await detectCorrectionLLM(llm, "不是这个意思");
    expect(r).not.toBeNull();
    expect(r!.isNewKnowledge).toBe(false);
  });
});

describe("detectCorrectionLLM — 非纠正（关键词误触发场景）", () => {
  it("反问句 '我不是刚做了吗' → null", async () => {
    const llm = mockLlm(JSON.stringify({ isCorrection: false }));
    const r = await detectCorrectionLLM(llm, "我不是刚把ThinkFlywheel接入了最新的Praxis？");
    expect(r).toBeNull();
  });

  it("规则文本含 '不是' → null", async () => {
    const llm = mockLlm(JSON.stringify({ isCorrection: false }));
    const r = await detectCorrectionLLM(llm, "# First Principles Rules\n禁止用行业惯例作为论据——大家都是这么做的不是理由");
    expect(r).toBeNull();
  });

  it("表达观点 '这个方案不是最优的' → null", async () => {
    const llm = mockLlm(JSON.stringify({ isCorrection: false }));
    const r = await detectCorrectionLLM(llm, "这个方案不是最优的，我们可以再想想");
    expect(r).toBeNull();
  });

  it("陈述事实 '今天不是周五' → null", async () => {
    const llm = mockLlm(JSON.stringify({ isCorrection: false }));
    const r = await detectCorrectionLLM(llm, "今天不是周五，是周六");
    expect(r).toBeNull();
  });

  it("用户自我纠正 '抱歉我搞错了' → null", async () => {
    const llm = mockLlm(JSON.stringify({ isCorrection: false }));
    const r = await detectCorrectionLLM(llm, "抱歉我搞错了方向，让我重新说");
    expect(r).toBeNull();
  });
});

describe("detectCorrectionLLM — 降级与健壮性", () => {
  it("LLM 调用失败 → null（安全默认）", async () => {
    const r = await detectCorrectionLLM(mockLlmError(), "不对，应该用POST");
    expect(r).toBeNull();
  });

  it("LLM 返回非 JSON → null", async () => {
    const llm = mockLlm("这不是JSON，只是随便说说");
    const r = await detectCorrectionLLM(llm, "不对");
    expect(r).toBeNull();
  });

  it("LLM 返回 isCorrection: true 但缺少字段 → 填充默认值", async () => {
    const llm = mockLlm(JSON.stringify({ isCorrection: true }));
    const r = await detectCorrectionLLM(llm, "不对");
    expect(r).not.toBeNull();
    expect(r!.what).toBe("assistant_response");
    expect(r!.correctedTo).toBe("user_explicit_correction");
    expect(r!.isNewKnowledge).toBe(false);
  });

  it("null 输入 → null", async () => {
    const llm = mockLlm(JSON.stringify({ isCorrection: true }));
    const r = await detectCorrectionLLM(llm, null as unknown as string);
    expect(r).toBeNull();
  });

  it("空字符串 → null", async () => {
    const llm = mockLlm(JSON.stringify({ isCorrection: true }));
    const r = await detectCorrectionLLM(llm, "");
    expect(r).toBeNull();
  });
});
