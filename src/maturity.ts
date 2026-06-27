/**
 * Maturity — Phase 3 T10: 认知成熟度推导 + session 计数追踪
 *
 * deriveMaturity 将累计 session 数映射为三档成熟度 (§7 双轴交互):
 *   Novice (0-9), Competent (10-49), Expert (50+)
 *
 * session_count 持久化到 AgentMemory slot，session_start 时读取并递增。
 *
 * 架构参考: architech/praxis-architecture.md §7 (认知成熟度驱动的语义粒度)
 */

import type { M0Deps } from "./m0-deps";
import type { MaturityLevel } from "./context-pressure-monitor";

// ══════════════════════════════════════════════════════════════════
// 阈值常量
// ══════════════════════════════════════════════════════════════════

/** 达到 Competent 所需的最小 session 数 */
const COMPETENT_MIN = 10;
/** 达到 Expert 所需的最小 session 数 */
const EXPERT_MIN = 50;

const SESSION_COUNT_SLOT = "session_count";

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 将累计 session 数映射为认知成熟度。
 *
 * 纯函数 — 无副作用，无 I/O。
 *
 * @param sessionCount 累计 session 数（非负整数，防御性处理负数）
 * @returns MaturityLevel — "novice" | "competent" | "expert"
 */
export function deriveMaturity(sessionCount: number): MaturityLevel {
  const count = Math.max(0, Math.floor(sessionCount));
  if (count >= EXPERT_MIN) return "expert";
  if (count >= COMPETENT_MIN) return "competent";
  return "novice";
}

/**
 * 从 AgentMemory slot 读取累计 session 数。
 *
 * @param deps M0Deps（需要 memory 子系统）
 * @returns 累计 session 数（slot 不存在或读取失败时返回 0）
 */
export async function getSessionCount(deps: M0Deps): Promise<number> {
  try {
    const result = await deps.memory.getSlot(SESSION_COUNT_SLOT);
    if (!result.ok || !result.value) return 0;
    const data = result.value as { count?: number };
    return typeof data.count === "number" ? data.count : 0;
  } catch {
    return 0;
  }
}

/**
 * 递增并持久化累计 session 数。
 *
 * 读取当前值 → +1 → 写回 slot。
 * 读取失败时从 0 开始（防御性）。
 * 若调用方已知当前值，可通过 currentCount 参数传入，避免冗余 slot 读取。
 *
 * @param deps M0Deps（需要 memory 子系统）
 * @param currentCount 已知的当前计数（可选，避免冗余读取）
 * @returns 递增后的新计数
 */
export async function incrementSessionCount(
  deps: M0Deps,
  currentCount?: number,
): Promise<number> {
  const current = typeof currentCount === "number" ? currentCount : await getSessionCount(deps);
  const next = current + 1;
  try {
    await deps.memory.setSlot(SESSION_COUNT_SLOT, { count: next });
  } catch {
    // 持久化失败不阻塞 — 下次 session 从旧值继续
  }
  return next;
}
