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
    /** 场景 ID — 从 LearningEvent.proto_structure_ids 派生，查询便利字段 */
    scenarioId?: string;
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

// ══════════════════════════════════════════════════════════════════
// M4: LearningEvent 类型系统 (架构 §4)
// ══════════════════════════════════════════════════════════════════

/** 20 种 LearningEvent 细分类 — 架构 §4 classify 映射 */
export type LearningEventType =
  // correction 粗类 → 细类 (5)
  | "mistake_correction"
  | "action_decision_error"
  | "action_decision_oversight"
  | "role_routing_mismatch"
  | "role_routing_ambiguity"
  // insight 粗类 → 细类 (3)
  | "domain_insight"
  | "task_pattern_recognition"
  | "procedural_optimization"
  // preference 粗类 → 细类 (5)
  | "preference_discovery"
  | "communication_style"
  | "communication_detail_level"
  | "timing_preference"
  | "timing_pacing"
  // pattern 粗类 → 细类 (3)
  | "process_efficiency_bottleneck"
  | "process_efficiency_redundancy"
  | "structural_inadequacy_detected"
  // structure 粗类 → 细类 (3, M5/M6 激活)
  | "structure_constructed"
  | "structure_validated"
  | "structure_regression"
  // governance (1)
  | "governance_override";

/** 粗分类 — Governor classify stage 输出 */
export type CoarseType = "correction" | "insight" | "preference" | "pattern" | "governance";

/** LearningEvent — 从 PendingSignal 升级的结构化学习事件 */
export interface LearningEvent {
  id: string;
  type: LearningEventType;
  coarseType: CoarseType;
  sessionId: string;
  timestamp: number;
  source: "message_received" | "before_tool_call" | "after_tool_call" | "agent_end" | "session_end";
  detail: string;
  affectedStructureIds: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
}

/** M4: 7 源融合权重配置 */
export interface FusionWeights {
  statistical: number;
  llm_marker: number;
  user_correction: number;
  role_verifier: number;
  concept_verifier: number;
  outcome_feedback: number;
  mid_session: number;
}

/** M4: 单个信号源输出 */
export interface SignalSourceInput {
  structureId: string;
  sourceName: string;
  value: number;        // 0.0-1.0
  confidence: number;   // 信号源自身对输出的置信度 (0.0-1.0)
  evidence: string;     // 可读的证据描述
}

/** M4: 信号源贡献分解 (审计用) */
export interface SourceContribution {
  sourceName: string;
  weight: number;
  value: number;
  contribution: number;  // weight × value
}

/** M4: 融合输出 */
export interface FusedConfidence {
  confidence: number;
  sourceCount: number;
  contributions: SourceContribution[];
}

/** M4: StatisticalVerifier 单步匹配详情 */
export interface StepMatch {
  stepPosition: number;
  expectedAction: string;
  matchedToolName: string | null;
  matchScore: number;  // 0.0-1.0
}

/** M4: Verifier 统一接口 */
export interface VerifierOutput {
  value: number;
  confidence: number;
  evidence: string;
  timestamp: number;
  /** statistical-verifier: per-step 匹配详情 (M3.4 也需要) */
  matchDetails?: StepMatch[];
}

/** M4: 验证上下文 */
export interface VerificationContext {
  sessionId: string;
  toolCallTrace: ToolCallRecord[];
  transcript: string;
  /** M4.3.2 role-verifier: role map for multi-role DAG cycle detection */
  roleMap?: Map<string, ProtoRole>;
}

/** M4: 退役结构元数据 */
export interface RetiredStructure {
  originalId: string;
  supersededBy: string[];
  retiredAt: number;
  keyLessons: string[];
  reactivationConditions: {
    newStructureConfidenceFallsBelow: number;
    oldScenarioReappears: boolean;
    manualReactivation: boolean;
  };
  originalVersionChain: VersionSnapshot[];
}

/** M4: 重新激活上下文 */
export interface ReactivationContext {
  supersedingConfidence: number;
  currentScenarioId: string;
  manualRequest: boolean;
}

// ══════════════════════════════════════════════════════════════════
// M1: ProtoStructure 认知结构系统 (架构 §3 + §9)
// ══════════════════════════════════════════════════════════════════

// ---- ProtoStructure 基础类型 ----

export type ProtoType = "sequence" | "role" | "concept" | "purpose" | "constraint";

export type LifecycleStage =
  | "hypothesized"
  | "candidate"
  | "experimental"
  | "crystallized"
  | "deprecated"
  | "rejected";

export type RelationType =
  | "depends_on"
  | "contradicts"
  | "specializes"
  | "precedes"
  | "constrains"
  | "alternative_to";

export type ConstraintSeverity = "block" | "confirm" | "warn";

export type ConstraintSource = "user_taught" | "auto_derived";

/** 关系边 — 连接两个 ProtoStructure */
export interface Relation {
  targetId: string;
  type: RelationType;
  strength: number; // 0.0-1.0
  evidence: string[];
  establishedAt: number;
  lastValidatedAt: number;
}

/** 版本快照 — 每次修改产生一个新版本 */
export interface VersionSnapshot {
  versionId: string;
  parentVersion: string | null;
  mergeSources?: string[];
  createdAt: number;
  createdBy: "user_correction" | "auto_refinement" | "crystallization" | "degradation" | "fusion";
  diff: {
    type: "step_added" | "step_removed" | "step_reordered" | "confidence_changed" | "purpose_refined" | "relation_changed";
    path: string;
    oldValue: unknown;
    newValue: unknown;
  }[];
  rationale: string;
  evidence: string[];
  performance: {
    predictionAccuracy: number;
    userSatisfaction: number;
    activeDurationDays: number;
  };
}

/** ProtoStructure 基础接口 — 所有子类型的公共字段 */
export interface ProtoStructure {
  id: string;
  protoType: ProtoType;
  tentativeName: string;
  scenarioId: string;
  confidence: number;       // 0.0-1.0 (7 源融合后)
  observationsCount: number;
  adoptionRate: number;     // 注意力遥测
  lifecycle: LifecycleStage;
  relations: Relation[];
  versionChain: VersionSnapshot[];
  createdAt: number;
  updatedAt: number;
}

// ---- 五种子类型 ----

/** ProtoSequence — 行为序列模式 */
export interface ProtoSequenceStep {
  position: number;
  action: string;
  agent: string;
  observedDuration?: string;
}

export interface TeleologicalMapping {
  stepIndex: number;
  contributesTo: string;
  criticality: "essential" | "supporting" | "optional";
}

export interface ProtoSequence extends ProtoStructure {
  protoType: "sequence";
  /** 结构面: 可观察的行为步骤 */
  structure: {
    steps: ProtoSequenceStep[];
    observedTiming?: string;
  };
  /** 功能面: 为什么每一步存在 */
  function: {
    purpose: string;
    precondition: string[];
    postcondition: string[];
    failureModes: string[];
  };
  /** 结构→功能映射 */
  teleologicalMapping: TeleologicalMapping[];
}

/** ProtoRole — 角色关系 */
export interface ProtoRole extends ProtoStructure {
  protoType: "role";
  behaviors: string[];
  dependsOn: string[];        // 依赖的角色 IDs
  communicationPreferences?: {
    channel?: string;
    style?: string;
  };
}

/** ProtoConcept — 概念定义 */
export interface ProtoConcept extends ProtoStructure {
  protoType: "concept";
  definition: string;
  relatedConcepts: string[];
}

/** ProtoPurpose — 目标意图 */
export interface ProtoPurpose extends ProtoStructure {
  protoType: "purpose";
  goal: string;
  successCriteria: string[];
}

/** ProtoConstraint — 约束公理 */
export interface ProtoConstraint extends ProtoStructure {
  protoType: "constraint";
  severity: ConstraintSeverity;
  source: ConstraintSource;
  /** 约束的英文描述 (用于 before_tool_call 规则匹配) */
  rulePatterns: string[];
}

// ---- Phase 0 兼容类型 ----

/** 场景匹配结果 — scene-recognizer 输出 */
export interface ScenarioMatch {
  scenarioId: string;
  confidence: number;
  source: "task_context_exact" | "task_context_fuzzy" | "llm_inference";
}

/** 种子场景定义 — Phase 0 手动定义的初始场景注册表条目 */
export interface ProtoStructureSeed {
  scenarioId: string;
  tentativeName: string;
  protoType: ProtoType;
  typicalTools: string[];
  typicalDomains: string[];
}

// ══════════════════════════════════════════════════════════════════
// M0: 标准生命周期事件类型 (对应架构 §10)
// ══════════════════════════════════════════════════════════════════

/** session_start — 会话开始时触发 */
export interface SessionStartEvent {
  sessionId: string;
  projectScope?: string;
  timestamp: number;
}

/** message_received — 收到用户/助手消息时触发 */
export interface MessageReceivedEvent {
  sessionId: string;
  message: {
    role: "user" | "assistant";
    content: string;
  };
  timestamp: number;
}

/** before_tool_call — LLM 准备调用工具时触发 */
export interface ToolCallRequest {
  toolName: string;
  toolParams: Record<string, unknown>;
}

export interface BeforeToolCallEvent {
  sessionId: string;
  toolCall: ToolCallRequest;
}

/** after_tool_call — 工具调用完成后触发 */
export interface ToolCallResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface AfterToolCallEvent {
  sessionId: string;
  toolName: string;
  toolParams: Record<string, unknown>;
  result: ToolCallResult;
}

/** agent_end — Agent 执行单元结束时触发 */
export interface ToolCallRecord {
  toolName: string;
  toolParams: Record<string, unknown>;
  result: ToolCallResult;
  timestamp: number;
}

export interface AgentEndEvent {
  sessionId: string;
  toolCalls: ToolCallRecord[];
}

/** session_end — 会话结束时触发 */
export interface SessionEndEvent {
  sessionId: string;
  /** 完整对话记录 (用户消息 + 助手响应 + 工具输出) */
  transcript: string;
  timestamp: number;
}

/** cron_tick — 定时触发 */
export interface CronTickEvent {
  timestamp: number;
}

// ══════════════════════════════════════════════════════════════════
// M0: 上下文注入类型
// ══════════════════════════════════════════════════════════════════

/** 会话开始时注入 system prompt 的结构化上下文 */
export interface SessionContextInjection {
  /** 能力概况 */
  competency: {
    overallProficiency: number;
    domainProficiencies: Record<string, number>;
    strongestDomains: string[];
    weakestDomains: string[];
    currentLearningFocus: string | null;
  };
  /** 从 AgentMemory 检索的相关知识条目 */
  knowledge: {
    title: string;
    content: string;
    confidence: number;
    source: string;
  }[];
  /** 上次会话的思维状态 */
  mentalState: string | null;
  /** M1: 从 AgentMemory 检索的 ProtoStructures（扁平列表，向后兼容） */
  protoStructures: {
    id: string;
    tentativeName: string;
    protoType: string;
    confidence: number;
    scenarioId: string;
    summary: string;
  }[];
  /** M2: Tier A/B/C 分层上下文（context-organizer 输出） */
  tieredContext?: {
    tierA: { items: { id: string; tentativeName: string; protoType: string; confidence: number; scenarioId: string; description: string }[]; totalTokens: number };
    tierB: { items: { id: string; tentativeName: string; protoType: string; confidence: number; scenarioId: string; description: string }[]; totalTokens: number };
    tierC: { items: { id: string; tentativeName: string; protoType: string; confidence: number; scenarioId: string; description: string }[]; totalTokens: number };
    meta: { pressure: string; maturity: string; totalStructures: number };
    /** M3: 已结晶 ProtoConstraint 注入段（注入在 Tier A/B/C 之前） */
    criticalConstraints?: {
      injectionText: string;
      tokenCount: number;
      constraintIds: string[];
      /** M3 Step 3: 实际约束对象列表 — 供 orchestrator 传递给 before_tool_call 处理器 */
      constraints: ProtoConstraint[];
    };
  };
}

// ══════════════════════════════════════════════════════════════════
// M0: 学习信号类型
// ══════════════════════════════════════════════════════════════════

/** M0.4 信号捕获 — 会话中检测到的待处理学习信号 */
export interface PendingSignal {
  id: string;
  type: "correction" | "success" | "failure";
  sessionId: string;
  timestamp: number;
  detail: string;
  /** 关联的工具名 (after_tool_call 检测到时填充) */
  toolName?: string;
  /** 用户纠正的具体内容 (message_received 检测到时填充) */
  correction?: {
    what: string;
    correctedTo: string;
    likelyRootCause: string;
  };
}

// ══════════════════════════════════════════════════════════════════
// M0: 自主性策略类型
// ══════════════════════════════════════════════════════════════════

export type AutonomyLevel = "novice" | "advanced_beginner" | "competent" | "proficient" | "expert";

export interface AutonomyPolicy {
  defaultPolicy: {
    unknownOperation: "confirm";
    lowRiskKnown: "inform";
    highRiskKnown: "confirm";
    afterError: "downgrade_one";
  };
  operationPolicies: {
    operation: string;
    requiredProficiency: number;
    autonomy: "supervised" | "semi_autonomous" | "fully_autonomous";
    exceptions: string[];
  }[];
  riskLevels: {
    low: string[];
    medium: string[];
    high: string[];
    critical: string[];
  };
}

// ══════════════════════════════════════════════════════════════════
// Phase 10: 重新导出 — types/ 文件提供按领域组织的入口点
//
// 以下类型同时存在于 cognitive/types（向后兼容）和 types/（新入口点）。
// 新代码建议直接从 types/memory, types/scene, types/hooks 导入。
// ══════════════════════════════════════════════════════════════════
