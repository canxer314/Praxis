/**
 * SignalDetector — 修正信号检测
 *
 * 职责:
 *   - 从用户消息内容中检测显式修正信号
 *   - detectCorrection: 关键词快速路径（保留用于降级和独立测试）
 *   - detectCorrectionLLM: LLM 语义级检测（活跃路径，Phase 2）
 *
 * Correction 构造策略:
 *   - what !== correctedTo → 满足 isRealExperience 规则 1
 *   - SessionContext.hasExplicitRejection = true → 满足规则 2
 *   - 同时满足两条 → signal 100% 通过 stage2Gate
 */

import type { Correction } from "./types";
import type { LlmClient } from "../platform-adapter";

/** 否定关键词列表 (长→短排序，避免子串误匹配) */
const NEGATION_KEYWORDS = ["重新做", "搞错了", "不对", "不是", "错了"];

/**
 * 从用户消息内容中检测修正信号（关键词匹配，Phase 1 保留）。
 *
 * 匹配规则: 大小写不敏感的 substring match。
 * 匹配任意一个关键词 → 返回 Correction 占位对象。
 * 未匹配 → 返回 null。
 *
 * 注意: 此方法精度低——"不是"是中文高频词，反问句/引用文本均会误触发。
 * 活跃路径请使用 detectCorrectionLLM。
 *
 * @param content 用户消息原文
 * @returns Correction 对象 (用于 Governor.decide 管道), 或 null
 */
export function detectCorrection(content: string): Correction | null {
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return null;
  }

  const lower = content.toLowerCase();
  const matched = NEGATION_KEYWORDS.find((kw) => lower.includes(kw.toLowerCase()));
  if (!matched) return null;

  // Derive isNewKnowledge from message context: if the user provides
  // concrete correction content ("不对，应该用POST"), the message
  // contains new knowledge.  Pure negation without alternatives
  // ("不是这个意思", bare "错了") does not.
  // Heuristic: the message contains correction-indicating words
  // (应该/用/改成/需要/试试/可以) that signal the user is teaching,
  // not just rejecting.
  const CORRECTION_SIGNALS = /(?:应该|该用|要用|改成|换成|需要|试试|正确的|不该|不要用|用|改)/;
  const hasCorrectionSignal = CORRECTION_SIGNALS.test(content);

  return {
    what: "assistant_response",
    correctedTo: "user_explicit_correction",
    likelyRootCause: `keyword_match:${matched}`,
    isNewKnowledge: hasCorrectionSignal,
  };
}

// ══════════════════════════════════════════════════════════════════
// LLM-based detection (Phase 2 — 活跃路径)
// ══════════════════════════════════════════════════════════════════

function buildCorrectionPrompt(content: string): string {
  return `判断以下用户消息是否在纠正AI助手的错误。只返回JSON，不要Markdown包裹，不要额外解释。

是纠正（用户指出AI做错了某事）：
- "不对，应该用POST"、"你搞错了，需要先认证"、"不是这样，改成异步调用"

不是纠正：
- 反问句（"我不是刚做了吗"、"这不是很明显吗"）
- 引用或讨论规则文本（即使包含"不是""不对"等词）
- 表达观点或评价（"这个方案不是最优的"）
- 陈述事实（"今天不是周五"）
- 用户纠正自己的错误（"抱歉我搞错了方向"）

无纠正返回: {"isCorrection":false}
有纠正返回: {"isCorrection":true,"what":"被纠正的内容","correctedTo":"正确做法","isNewKnowledge":true/false,"summary":"一句话总结"}

isNewKnowledge: 用户是否教了替代方案/正确做法（true），还是单纯否定没说怎么做（false）。

消息:
---
${content.slice(0, 1500)}
---`;
}

/**
 * 使用 LLM 检测用户消息中的修正信号（Phase 2 活跃路径）。
 *
 * 与 detectCorrection 的区别:
 *   - 关键词 substring match → LLM 语义理解
 *   - 无法区分反问/引用/观点 → 可区分 5 类非纠正场景
 *   - 硬编码 isNewKnowledge 启发式 → LLM 自行判断
 *
 * 降级: LLM 调用失败或返回格式错误时返回 null（安全默认: 不触发学习）。
 *
 * @param llm  LLM 客户端（DeepSeek V4 Flash）
 * @param content 用户消息原文
 * @returns Correction 对象, 或 null（无纠正信号 / LLM 降级）
 */
export async function detectCorrectionLLM(
  llm: LlmClient,
  content: string,
): Promise<Correction | null> {
  if (!content || content.trim().length === 0) return null;

  const prompt = buildCorrectionPrompt(content);
  const result = await llm.analyze(prompt);

  if (!result.ok) return null;

  try {
    const parsed = JSON.parse(result.value.trim());
    if (!parsed.isCorrection) return null;

    return {
      what: typeof parsed.what === "string" ? parsed.what : "assistant_response",
      correctedTo: typeof parsed.correctedTo === "string" ? parsed.correctedTo : "user_explicit_correction",
      likelyRootCause: `llm_detected:${typeof parsed.summary === "string" ? parsed.summary.slice(0, 80) : "correction"}`,
      isNewKnowledge: parsed.isNewKnowledge === true,
    };
  } catch {
    return null;
  }
}
