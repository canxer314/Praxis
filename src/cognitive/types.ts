/**
 * @praxis/cognitive-core — Type System
 *
 * 所有认知架构的 TypeScript 接口定义。
 * Phase 1: 核心学习环路 (4 记忆类型 + 元认知 + 任务评估)
 * Phase 2: E4/E5/E6 扩展类型 (策略生命周期 + 跨领域分析 + 缺口猎取)
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
