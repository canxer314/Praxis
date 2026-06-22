/**
 * Heuristics — 纯函数集合
 *
 * 真实经验检测 + 编辑距离 + 其他无副作用的启发式规则。
 * 所有函数为纯函数，不依赖外部状态，可直接单元测试。
 */

import type { Correction, SessionContext } from "./types";

// ══════════════════════════════════════════════════════════════════
// isRealExperience — P3 工程实现
// ══════════════════════════════════════════════════════════════════

/**
 * 判断一次交互是否产生了"真实经验"。
 *
 * 规则:
 *   1. 用户显式修正过 (correctedTo !== what)
 *   2. 用户明确拒绝信号 (hasExplicitRejection)
 *
 * 第一阶段仅追踪 after_tool_call + message_received 中的显式信号。
 * 不做语义级"隐含不满"检测 — 误报率过高。
 */
export function isRealExperience(
  correction: Correction,
  sessionContext: SessionContext,
): boolean {
  if (!correction || !sessionContext) return false;

  // 规则 1: 用户显式修正过
  if (correction.correctedTo !== correction.what) return true;

  // 规则 2: 用户明确说"不对"/"错了"/"重新做"
  if (sessionContext.hasExplicitRejection) return true;

  return false;
}

// ══════════════════════════════════════════════════════════════════
// editDistance — 归一化 Levenshtein 距离
// ══════════════════════════════════════════════════════════════════

/**
 * 计算两个字符串的归一化编辑距离 (0.0–1.0)。
 * 返回值 = Levenshtein 距离 / max(len(a), len(b))。
 * 空字符串输入: 两者都为空返回 0; 仅一个为空返回 1。
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a && !b) return 0;
  if (!a || !b) return 1;

  const lenA = a.length;
  const lenB = b.length;

  // Levenshtein distance — O(n*m) with O(min(n,m)) space
  if (lenA < lenB) return editDistance(b, a);

  let prev = Array.from({ length: lenB + 1 }, (_, i) => i);
  let curr = new Array(lenB + 1);

  for (let i = 1; i <= lenA; i++) {
    curr[0] = i;
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,         // deletion
        curr[j - 1] + 1,     // insertion
        prev[j - 1] + cost,  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[lenB] / Math.max(lenA, lenB);
}
