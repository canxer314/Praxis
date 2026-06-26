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

/** 20 种信号类型 (架构 §4 LearningEvent 分类, M4) */
export type SignalType =
  // correction
  | "mistake_correction"
  | "action_decision_error"
  | "action_decision_oversight"
  | "role_routing_mismatch"
  | "role_routing_ambiguity"
  // insight
  | "domain_insight"
  | "task_pattern_recognition"
  | "procedural_optimization"
  // preference
  | "preference_discovery"
  | "communication_style"
  | "communication_detail_level"
  | "timing_preference"
  | "timing_pacing"
  // pattern
  | "process_efficiency_bottleneck"
  | "process_efficiency_redundancy"
  | "structural_inadequacy_detected"
  // structure (M5/M6 activated)
  | "structure_constructed"
  | "structure_validated"
  | "structure_regression"
  // governance
  | "governance_override";

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
  // correction → IMMEDIATE (user corrections need instant response)
  mistake_correction: "IMMEDIATE",
  action_decision_error: "IMMEDIATE",
  action_decision_oversight: "IMMEDIATE",
  role_routing_mismatch: "IMMEDIATE",
  role_routing_ambiguity: "IMMEDIATE",
  // insight → BATCH (session_end extraction)
  domain_insight: "BATCH",
  task_pattern_recognition: "BATCH",
  procedural_optimization: "BATCH",
  // preference → BATCH (needs confirmation across sessions)
  preference_discovery: "BATCH",
  communication_style: "BATCH",
  communication_detail_level: "BATCH",
  timing_preference: "BATCH",
  timing_pacing: "BATCH",
  // pattern → DEFERRED (needs multiple observations)
  process_efficiency_bottleneck: "DEFERRED",
  process_efficiency_redundancy: "DEFERRED",
  structural_inadequacy_detected: "DEFERRED",
  // structure → DEFERRED (M5/M6 activated, cross-session validation)
  structure_constructed: "DEFERRED",
  structure_validated: "DEFERRED",
  structure_regression: "DEFERRED",
  // governance → IMMEDIATE (policy overrides need instant action)
  governance_override: "IMMEDIATE",
};

const TIMING_REASONS: Record<SignalType, string> = {
  mistake_correction: "User correction — requires immediate confidence adjustment",
  action_decision_error: "Action decision error — immediate correction needed",
  action_decision_oversight: "Action oversight — immediate correction needed",
  role_routing_mismatch: "Role routing mismatch — immediate correction needed",
  role_routing_ambiguity: "Role routing ambiguity — immediate clarification needed",
  domain_insight: "Domain insight — batch at session_end for context",
  task_pattern_recognition: "Task pattern — batch at session_end, needs cross-session detection",
  procedural_optimization: "Procedural optimization — batch at session_end",
  preference_discovery: "Preference discovery — batch at session_end, needs multiple sessions to confirm",
  communication_style: "Communication style preference — batch at session_end",
  communication_detail_level: "Communication detail preference — batch at session_end",
  timing_preference: "Timing preference — batch at session_end",
  timing_pacing: "Timing pacing preference — batch at session_end",
  process_efficiency_bottleneck: "Process bottleneck — deferred, needs multiple observations",
  process_efficiency_redundancy: "Process redundancy — deferred, needs multiple observations",
  structural_inadequacy_detected: "Structural inadequacy — deferred, requires cross-session analysis",
  structure_constructed: "Structure constructed — deferred, M5/M6 cross-session validation",
  structure_validated: "Structure validated — deferred, M5/M6 cross-session validation",
  structure_regression: "Structure regression — deferred, M5/M6 cross-session validation",
  governance_override: "Governance override — immediate, policy change requires instant action",
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
  return Object.keys(TIMING_MAP) as SignalType[];
}
