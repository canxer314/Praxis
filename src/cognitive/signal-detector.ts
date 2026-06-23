/**
 * SignalDetector — 修正信号关键词检测
 *
 * 职责:
 *   - 从用户消息内容中检测显式修正信号
 *   - 纯函数: 输入 string → 输出 Correction | null
 *   - Phase 1: 5 个中文否定关键词的 substring match
 *   - Phase 2: 升级为 LLM 语义级检测，接口不变
 *
 * Correction 构造策略:
 *   - what !== correctedTo → 满足 isRealExperience 规则 1
 *   - SessionContext.hasExplicitRejection = true → 满足规则 2
 *   - 同时满足两条 → signal 100% 通过 stage2Gate
 */

import type { Correction } from "./types";

/** 否定关键词列表 (长→短排序，避免子串误匹配) */
const NEGATION_KEYWORDS = ["重新做", "搞错了", "不对", "不是", "错了"];

/**
 * 从用户消息内容中检测修正信号。
 *
 * 匹配规则: 大小写不敏感的 substring match。
 * 匹配任意一个关键词 → 返回 Correction 占位对象。
 * 未匹配 → 返回 null。
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

  return {
    what: "assistant_response",
    correctedTo: "user_explicit_correction",
    likelyRootCause: `keyword_match:${matched}`,
    isNewKnowledge: true,
  };
}
