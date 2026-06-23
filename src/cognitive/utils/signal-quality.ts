/**
 * Signal Quality — 纯函数信号质量检测
 *
 * isRealExperience 用于判断一次交互是否产生了"真实经验"。
 * 纯函数，不依赖外部状态，可直接单元测试。
 *
 * 从 heuristics.ts 提取 (Phase 1 Governor refactor: 删除 heuristics.ts,
 * 删除 dead code editDistance)。
 */

import type { Correction, SessionContext } from "../types";

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
