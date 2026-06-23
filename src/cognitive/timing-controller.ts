/**
 * TimingController — 信号时序分类器
 *
 * 职责:
 *   - 根据信号类型决定处理时机: IMMEDIATE | BATCH | DEFERRED
 *   - IMMEDIATE: 用户显式纠正 → 即时处理
 *   - BATCH: 模式/偏好/洞察 → session_end 批处理
 *   - DEFERRED: 无法判断 → 放入延迟队列，等待更多证据
 *   - 无效信号 (null/unknown) → DEFERRED (安全默认)
 *
 * 纯函数，不依赖外部状态。
 */

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** 时序决策 */
export type TimingDecision = "IMMEDIATE" | "BATCH" | "DEFERRED";

/** 5 种信号类型 (V3 学习事件分类) */
export type SignalType =
  | "mistake_correction"
  | "domain_insight"
  | "preference_discovery"
  | "task_pattern_recognition"
  | "procedural_optimization";

/** 分类结果 */
export interface TimingResult {
  decision: TimingDecision;
  signalType: SignalType | "unknown";
  reason: string;
}

// ══════════════════════════════════════════════════════════════════
// 分类策略表
// ══════════════════════════════════════════════════════════════════

const TIMING_MAP: Record<SignalType, TimingDecision> = {
  mistake_correction: "IMMEDIATE",
  domain_insight: "BATCH",
  preference_discovery: "BATCH",
  task_pattern_recognition: "BATCH",
  procedural_optimization: "DEFERRED",
};

const TIMING_REASONS: Record<SignalType, string> = {
  mistake_correction:
    "User correction — requires immediate confidence adjustment",
  domain_insight:
    "Domain insight — batch with other insights at session_end for context",
  preference_discovery:
    "Preference discovery — batch at session_end, needs multiple sessions to confirm",
  task_pattern_recognition:
    "Task pattern — batch at session_end, needs cross-session pattern detection",
  procedural_optimization:
    "Procedural optimization — deferred, requires multiple observations to validate",
};

// ══════════════════════════════════════════════════════════════════
// 公共 API
// ══════════════════════════════════════════════════════════════════

/**
 * 分类信号的时序决策。
 *
 * @param signalType 信号类型 (5 种已知 + 任意字符串)
 * @returns 时序决策结果。未知类型返回 DEFERRED (安全默认)。
 */
export function classify(signalType: string | null | undefined): TimingResult {
  // 安全默认: 无效输入 → DEFERRED
  if (!signalType || typeof signalType !== "string") {
    return {
      decision: "DEFERRED",
      signalType: "unknown",
      reason: "Null or invalid signal — deferred for safety",
    };
  }

  // 已知信号类型
  if (isKnownSignalType(signalType)) {
    return {
      decision: TIMING_MAP[signalType],
      signalType,
      reason: TIMING_REASONS[signalType],
    };
  }

  // 未知信号类型 — DEFERRED (安全默认)
  return {
    decision: "DEFERRED",
    signalType: "unknown",
    reason: `Unknown signal type "${signalType}" — deferred for safety`,
  };
}

/**
 * 类型守卫: 是否为已知的 5 种信号类型
 */
export function isKnownSignalType(value: string): value is SignalType {
  return Object.hasOwn(TIMING_MAP, value);
}

/**
 * 获取所有已知信号类型的列表
 */
export function listSignalTypes(): SignalType[] {
  return [
    "mistake_correction",
    "domain_insight",
    "preference_discovery",
    "task_pattern_recognition",
    "procedural_optimization",
  ];
}
