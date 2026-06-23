/**
 * @praxis/cognitive-core — Type System
 *
 * 所有认知架构的 TypeScript 接口定义。
 * Phase 1: 核心学习环路 (4 记忆类型 + 元认知 + 任务评估)
 * Phase 2: E4/E5/E6 扩展类型 (策略生命周期 + 跨领域分析 + 缺口猎取)
 * Phase 3: V13 任务调度类型 (TaskSchedule + TriggerDecision + SubagentRun + HeartbeatState)
 *
 * 通用性: 不绑定 Claude Code 或任何特定平台。
 */

import type { Result, PraxisError } from "../platform-adapter";

// Re-export for convenience — cognitive modules import from ./types
export type { Result, PraxisError };

// ══════════════════════════════════════════════════════════════════
// 四种记忆类型
// ══════════════════════════════════════════════════════════════════

/** 情景记忆 — "某次任务中发生了什么" */
export interface EpisodicMemory {
  memoryId: string;
  agentId: string;
  timestamp: number;

  context: {
    taskType: string;
    domain: string;
    taskId?: string;
  };

  observation: {
    situation: string;
    action: string;
    outcome: string;
    correction?: string;
  };

  signals: {
    wasCorrected: boolean;
    userSatisfied: boolean;
    deviationFromExpected: string;
  };
}

/** 程序记忆 — "做 X 时应该先 A 后 B" */
export interface ProceduralMemory {
  memoryId: string;
  taskType: string;
  domain: string;

  steps: ProcedureStep[];
  antiPatterns: AntiPattern[];

  confidence: number;
  observationCount: number;
  derivedFrom: string[];
}

export interface ProcedureStep {
  order: number;
  description: string;
  critical: boolean;
  commonPitfalls: string[];
}

export interface AntiPattern {
  pattern: string;
  consequence: string;
  occurrences: number;
}

/** 语义记忆 — "X 与 Y 的关系是 Z" */
export interface SemanticMemory {
  memoryId: string;
  subject: string;
  relation: string;
  object: string;

  confidence: number;
  evidence: string[];
  source: "user_taught" | "self_derived" | "observation";
}

// ══════════════════════════════════════════════════════════════════
// 元认知类型
// ══════════════════════════════════════════════════════════════════

export interface MetacognitiveProfile {
  domainProficiencies: Record<string, DomainProficiency>;
  knowledgeGaps: KnowledgeGap[];
  calibrationHistory: CalibrationEntry[];

  inferredPreferences: {
    learnsBy: "example" | "rule" | "trial_and_error" | "instruction";
    needsConfirmationFor: string[];
  };
}

export interface DomainProficiency {
  domain: string;
  selfRating: number;
  actualAccuracy: number;
  taskCount: number;
  lastCalibrated: number;
}

export interface KnowledgeGap {
  topic: string;
  detectedAt: string;
  context: string;
  resolved: boolean;
}

export interface CalibrationEntry {
  domain: string;
  selfRatingBefore: number;
  actualOutcome: "success" | "correction_needed" | "failed";
  calibrationDelta: number;
  timestamp: number;
  /** 校准 ground truth 来源 (Codex Outside Voice: 溯源审计) */
  sourceAnchor:
    | "explicit_correction"
    | "silent_diff_detected"
    | "user_confirmation"
    | "statistical_anomaly";
}

// ══════════════════════════════════════════════════════════════════
// 学习环路类型 (3 个工程阶段)
// ══════════════════════════════════════════════════════════════════

export type CognitivePhase = "task_receive" | "task_execute" | "session_end";

/** Phase 1: task_receive — 每次用户给任务时触发 */
export interface TaskAssessment {
  taskType: string;
  domain: string;

  metacognitive: {
    selfRating: number;
    gapFlags: string[];
    recommendedMode: "autonomous" | "guided" | "exploratory";
  };

  episodic: EpisodicMemory[];
  procedural: ProceduralMemory[];
  semantic: SemanticMemory[];

  /** LLM 推断分类的置信度 (Outside Voice: <0.5 → 注入提醒) */
  classificationConfidence: number;
}

/** Phase 2: task_execute — 任务执行中实时触发 */
export interface ExecutionFeedback {
  stepIndex: number;
  anomalies: string[];
  userCorrections: Correction[];
}

export interface Correction {
  what: string;
  correctedTo: string;
  likelyRootCause: string;
  /** LLM 评估: 这次修正是否教了新知识 (仅作排序信号，不驱动行为) */
  isNewKnowledge: boolean;
}

/** Phase 3: session_end — 异步处理 */
export interface LearningUpdate {
  newEpisodic: EpisodicMemory[];
  newProcedural: ProceduralMemory[];
  calibration: CalibrationEntry;
  newGaps: KnowledgeGap[];
}

// ══════════════════════════════════════════════════════════════════
// 启发式函数类型
// ══════════════════════════════════════════════════════════════════

export interface SessionContext {
  sessionId: string;
  hasExplicitRejection: boolean;
  taskType: string;
  domain: string;
}

/** Phase 2 占位 — 主动召回注入 */
export interface MemoryInjection {
  injection: string;
  rationale: string;
  priority: "high" | "medium";
  tokenCount: number;
}

// ══════════════════════════════════════════════════════════════════
// E4: 策略生命周期 (CEO Review)
// ══════════════════════════════════════════════════════════════════

export type StrategyState =
  | "PROPOSED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "ACTIVE"
  | "ROLLED_BACK"
  | "REJECTED"
  | "DORMANT";

export interface Strategy {
  id: string;
  name: string;
  description: string;
  state: StrategyState;
  domain: string;
  taskType: string;

  /** 策略配置 — 当 ACTIVE 时生效 */
  config: Record<string, unknown>;

  /** 效能追踪 */
  metrics: {
    activatedAt: number;
    rollbackCount: number;
    successRate: number;
    lastEvaluated: number;
  };

  /** 创建/变更历史 */
  auditLog: StrategyAuditEntry[];
}

export interface StrategyAuditEntry {
  timestamp: number;
  fromState: StrategyState;
  toState: StrategyState;
  reason: string;
  source: "auto_proposed" | "user_approved" | "auto_rollback" | "factory_reset";
}

export interface StrategyProposal {
  id: string;
  strategy: Omit<Strategy, "id" | "state" | "metrics" | "auditLog">;
  rationale: string;
  expectedImprovement: string;
  conflicts: string[];
}

// ══════════════════════════════════════════════════════════════════
// E5: 跨领域分析 (CEO Review)
// ══════════════════════════════════════════════════════════════════

export interface CrossDomainSuggestion {
  sourceDomain: string;
  targetDomain: string;
  similarity: number;
  pattern: string;
  applicabilityRationale: string;
  status: "pending_review" | "accepted" | "rejected" | "skipped";
  generatedAt: number;
  reviewedAt?: number;
}

export interface CrossDomainAnalysis {
  suggestions: CrossDomainSuggestion[];
  dataCount: number;
  candidatesFound: number;
  executedAt: number;
}

export interface CronHealthSlot {
  lastRunStatus: "OK" | "FAILED" | "SKIPPED";
  lastError?: string;
  lastRunAt: number;
  dataCount: number;
  candidatesFound: number;
  suggestionsGenerated: number;
}

/** E5 (Phase 2.2): 跨领域迁移追踪 — 记录已应用的自动迁移 */
export interface CrossDomainMigration {
  id: string;
  sourceDomain: string;
  targetDomain: string;
  strategyId: string;
  similarity: number;
  pattern: string;
  appliedAt: number;
  /** 应用时目标领域的 selfRating（用于回滚判断） */
  baselineRating: number;
  /** 回滚时间 (非空表示已撤回) */
  rolledBackAt?: number;
  /** 回滚原因 */
  rollbackReason?: string;
}

// ══════════════════════════════════════════════════════════════════
// E6: 缺口猎取 (CEO Review)
// ══════════════════════════════════════════════════════════════════

export type GapSeverity = "LOW" | "MEDIUM" | "HIGH" | "PERSISTENT_GAP";

export interface GapDetectionResult {
  gaps: KnowledgeGap[];
  escalatedGaps: Array<{
    gap: KnowledgeGap;
    severity: GapSeverity;
    sessionsWithNoImprovement: number;
  }>;
  contextReminders: string[];
}

// ══════════════════════════════════════════════════════════════════
// V13: 任务调度类型 (Phase 3)
// ══════════════════════════════════════════════════════════════════

/** 任务调度持久化状态 */
export interface TaskSchedule {
  task_id: string;
  pending_triggers: ScheduledTrigger[];
  last_trigger_at: number | null;
  next_trigger_at: number | null;
  active_cron_job_ids: string[];
  /** 用户确认自动触发的时间戳 (null = 未确认, >0 = 已确认) */
  confirmed_at: number | null;
}

/** 单个调度触发记录 */
export interface ScheduledTrigger {
  trigger_id: string;
  trigger_source: 'cron:scheduled' | 'heartbeat:wake';
  scheduled_at: number;
  mechanism: 'scheduleSessionTurn' | 'cron_job';
  cron_job_id?: string;
  reason: string;
  subtask_id?: string;
  status: 'pending' | 'fired' | 'cancelled';
  created_at: number;
}

/** 触发决策结果 */
export interface TriggerDecision {
  should_trigger: boolean;
  mechanism: 'scheduleSessionTurn' | 'cron_job' | 'subagent_run' | 'none';
  delay_ms?: number;
  at_time?: number;
  reason: string;
  skip_reasons: string[];
}

/** TriggerAdapter — 抽象定时触发机制 (bundled vs cron fallback) */
export interface TriggerAdapter {
  scheduleTurn(params: {
    sessionKey: string;
    message: string;
    at?: number;
    delayMs?: number;
    cron?: string;
    tag: string;
  }): Promise<{ jobId: string } | null>;
  cancelTurn(jobId: string): Promise<void>;
}

/** 子 Agent 运行记录 */
export interface SubagentRun {
  run_id: string;
  subtask_id: string;
  session_key: string;
  status: 'spawning' | 'running' | 'completed' | 'failed' | 'timeout';
  spawned_at: number;
  completed_at: number | null;
  result?: SubagentResult;
  retry_count: number;
  max_retries: number;
}

/** 子 Agent 运行结果 */
export interface SubagentResult {
  run_id: string;
  status: 'ok' | 'error' | 'timeout';
  verification_results?: Record<string, unknown>;
  artifacts?: Record<string, unknown>[];
  transcript_summary?: string;
}

/** 子 Agent 注册表 */
export interface SubagentRegistry {
  task_id: string;
  active_runs: SubagentRun[];
  completed_runs: SubagentRun[];
  max_parallel: number;
}

/** 心跳监控状态 */
export interface HeartbeatState {
  task_id: string;
  subtask_id: string;
  subtask_started_at: number;
  estimated_duration_ms: number;
  last_progress_at: number;
  stall_threshold_ms: number;
  heartbeat_count: number;
  interventions: HeartbeatIntervention[];
}

/** 心跳干预记录 */
export interface HeartbeatIntervention {
  triggered_at: number;
  type: 'nudge' | 'escalate' | 'replan';
  reason: string;
  action: 'request_heartbeat' | 'cancel_subtask' | 'notify_user';
  outcome?: string;
}

/** 主动触发治理配置 */
export interface ActiveTriggeringConfig {
  enabled: boolean;
  allow_schedule_session_turn: boolean;
  allow_subagent_spawn: boolean;
  allow_heartbeat_monitor: boolean;
  allow_background_service: boolean;
  max_parallel_subagents: number;
  min_interval_between_triggers_minutes: number;
  max_triggers_per_day: number;
  quiet_hours: string;
  quiet_hours_timezone: string;
  require_user_confirmation_for: string[];
  stall_threshold_multiplier: number;
  auto_cancel_stalled_after_hours: number;
  max_heartbeat_checks_per_hour: number;
  trigger_failure_backoff_minutes: number;
}

// ══════════════════════════════════════════════════════════════════
// Governor: 任务状态机类型 (Phase 1)
// ══════════════════════════════════════════════════════════════════

/** 外层循环: 任务级状态 */
export enum TaskState {
  TASK_NOT_STARTED = "TASK_NOT_STARTED",
  TASK_ASSESSING = "TASK_ASSESSING",
  TASK_PLAN_GENERATING = "TASK_PLAN_GENERATING",
  TASK_IN_PROGRESS = "TASK_IN_PROGRESS",
  TASK_VERIFYING = "TASK_VERIFYING",
  TASK_ITERATING = "TASK_ITERATING",
  TASK_COMPLETE = "TASK_COMPLETE",
  TASK_ABANDONED = "TASK_ABANDONED",
}

/** 内层循环: 子任务级状态 */
export enum SubtaskState {
  SUBTASK_PENDING = "SUBTASK_PENDING",
  SUBTASK_ACTIVE = "SUBTASK_ACTIVE",
  SUBTASK_COMPLETING = "SUBTASK_COMPLETING",
  SUBTASK_VERIFIED = "SUBTASK_VERIFIED",
  SUBTASK_FAILED = "SUBTASK_FAILED",
  SUBTASK_BLOCKED = "SUBTASK_BLOCKED",
}

/** 任务级事件 */
export type TaskEvent =
  | "task_start"
  | "assessment_complete"
  | "plan_ready"
  | "all_subtasks_done"
  | "verification_passed"
  | "verification_failed"
  | "user_abort"
  | "max_iterations";

/** 子任务级事件 */
export type SubtaskEvent =
  | "subtask_start"
  | "subtask_done"
  | "verification_passed"
  | "verification_failed"
  | "max_retries"
  | "user_correction_3x"
  | "tool_violation_3x";

/** Governor 对外暴露的置信度视图 (不暴露内部原始评分) */
export interface ConfidenceView {
  domain: string;
  selfRating: number;
  source: "profile" | "default";
  gapFlags: string[];
}
