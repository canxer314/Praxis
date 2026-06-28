/**
 * analysis/pitfall-learner.ts — 陷阱反馈学习
 *
 * 职责:
 *   - 陷阱命中 → hitCount 递增
 *   - 误报率控制: > 30% 自动降 severity (从 GovernancePolicy.pitfall_tracking.auto_downgrade_misrate)
 *   - PitfallStats 计算
 *
 * 架构参考: §5 ProtoTask.commonPitfalls, §6 自主学习触发, §11 analysis/pitfall-learner.ts
 * GovernancePolicy ref: pitfall_tracking.auto_downgrade_misrate (default 0.3)
 */

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export type PitfallSeverity = "low" | "medium" | "high";

export interface ProtoTaskPitfall {
  description: string;
  severity: PitfallSeverity;
  mitigation: string;
  hitCount: number;
}

/** Per-pitfall statistics for false-positive tracking */
export interface PitfallStats {
  /** Total true-positive hits */
  hits: number;
  /** User/verifier-marked false positives */
  falsePositives: number;
}

// ══════════════════════════════════════════════════════════════════
// 默认阈值 (来自 GovernancePolicy)
// ══════════════════════════════════════════════════════════════════

/** 误报率超过此值自动降 severity */
const DEFAULT_AUTO_DOWNGRADE_MISRATE = 0.3;
/** 最少需要多少次观察才触发自动降级 */
const MIN_OBSERVATIONS_FOR_DOWNGRADE = 3;

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 记录陷阱命中 — 递增 hitCount，返回新的 pitfall 对象 (不修改原对象)。
 */
export function recordPitfallHit(pitfall: ProtoTaskPitfall): ProtoTaskPitfall {
  return { ...pitfall, hitCount: pitfall.hitCount + 1 };
}

/**
 * 标记一次误报，返回更新后的 stats (不修改原对象)。
 */
export function markPitfallFalsePositive(stats: PitfallStats): PitfallStats {
  return { ...stats, falsePositives: stats.falsePositives + 1 };
}

/**
 * 判断是否应该降低 severity。
 *
 * 误报率 = falsePositives / (hits + falsePositives)
 * 返回 true 当误报率 > threshold。
 *
 * @param stats 陷阱统计
 * @param threshold 误报率阈值 (default: 0.3)
 */
export function shouldDowngradeSeverity(
  stats: PitfallStats,
  threshold: number = DEFAULT_AUTO_DOWNGRADE_MISRATE,
): boolean {
  const total = stats.hits + stats.falsePositives;
  // Require minimum observations before making a decision
  if (total < MIN_OBSERVATIONS_FOR_DOWNGRADE) return false;
  const misrate = stats.falsePositives / total;
  return misrate > threshold;
}

/**
 * 降低 severity 一级: high→medium, medium→low, low stays low.
 */
export function downgradeSeverity(current: PitfallSeverity): PitfallSeverity {
  if (current === "high") return "medium";
  if (current === "medium") return "low";
  return "low";
}

/**
 * 从 pitfall + 已知误报次数计算 PitfallStats。
 */
export function getPitfallStats(
  pitfall: ProtoTaskPitfall,
  knownFalsePositives: number,
): PitfallStats {
  return {
    hits: pitfall.hitCount,
    falsePositives: knownFalsePositives,
  };
}
