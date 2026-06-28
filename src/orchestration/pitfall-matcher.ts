/**
 * orchestration/pitfall-matcher.ts — 陷阱实时命中检测
 *
 * 职责:
 *   - 子任务失败/错误时，关键词匹配 ProtoTask.commonPitfalls
 *   - 返回命中陷阱及其匹配置信度
 *   - 用于 before_tool_call context injection (陷阱预警)
 *
 * 架构参考: §5 陷阱追踪, §11 orchestration/pitfall-matcher.ts
 */

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface PitfallDef {
  description: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
}

export interface PitfallMatch {
  pitfall: PitfallDef;
  /** Which keyword(s) triggered the match */
  matchedKeyword: string;
  /** Match confidence: ratio of matched keywords to total keywords (0-1) */
  confidence: number;
}

// ══════════════════════════════════════════════════════════════════
// 匹配
// ══════════════════════════════════════════════════════════════════

/**
 * 从错误/失败文本中匹配已知陷阱。
 * 提取陷阱描述中的关键词（2-gram 中文、英文单词），在目标文本中搜索。
 *
 * @param pitfalls 已知陷阱列表
 * @param errorText 错误消息/失败描述
 * @returns 匹配到的陷阱列表（按匹配置信度降序）
 */
export function matchPitfalls(
  pitfalls: PitfallDef[],
  errorText: string,
): PitfallMatch[] {
  const matches: PitfallMatch[] = [];

  for (const pitfall of pitfalls) {
    const keywords = extractKeywords(pitfall.description);
    if (keywords.length === 0) continue;

    let matchedCount = 0;
    const matched: string[] = [];

    for (const kw of keywords) {
      if (errorText.includes(kw)) {
        matchedCount++;
        matched.push(kw);
      }
    }

    // Require at least 2 keyword matches to avoid false positives from common CJK 2-grams
    if (matchedCount >= 2) {
      matches.push({
        pitfall,
        matchedKeyword: matched.join(", "),
        confidence: matchedCount / keywords.length,
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * 查找第一个匹配的陷阱（最高优先级），未匹配返回 undefined。
 */
export function findMatchingPitfall(
  pitfalls: PitfallDef[],
  errorText: string,
): PitfallMatch | undefined {
  const matches = matchPitfalls(pitfalls, errorText);
  return matches.length > 0 ? matches[0] : undefined;
}

// ══════════════════════════════════════════════════════════════════
// Internal: keyword extraction
// ══════════════════════════════════════════════════════════════════

/**
 * 从中文字符串中提取连续 2-gram 作为关键词，同时也保留英文单词。
 * "接口变更导致集成失败" → ["接口变更", "变更导致", "导致集成", "集成失败", "接口变更"]
 */
function extractKeywords(text: string): string[] {
  const keywords: string[] = [];

  // Extract CJK 2-grams
  const cjkOnly = text.replace(/[^一-鿿]/g, "");
  for (let i = 0; i < cjkOnly.length - 1; i++) {
    keywords.push(cjkOnly.slice(i, i + 2));
  }

  // Also add the full text (for exact matching)
  if (text.length >= 2 && !keywords.includes(text)) {
    keywords.push(text);
  }

  // Extract alphabetic words (2+ chars)
  const words = text.match(/[a-zA-Z]{2,}/g);
  if (words) {
    for (const w of words) {
      if (!keywords.includes(w)) keywords.push(w);
    }
  }

  return [...new Set(keywords)];
}
