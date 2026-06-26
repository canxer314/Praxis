/**
 * @praxis/cognitive-core — Public API Surface
 *
 * Praxis 认知架构核心包。
 *
 * ## 架构概览
 *
 * Praxis 模拟"大学毕业生"的认知能力，包含 4 种记忆类型:
 *   - **EpisodicMemory** (情景) — 某次任务中发生了什么
 *   - **ProceduralMemory** (程序) — 做 X 时应该先 A 后 B
 *   - **SemanticMemory** (语义) — X 与 Y 的关系是 Z
 *   - **MetacognitiveProfile** (元认知) — 我擅长 X，不擅长 Y
 *
 * ## 快速开始
 *
 * ```ts
 * import { CognitiveCore } from "@praxis/cognitive-core";
 *
 * // 1. 创建核心实例 (传入 memoryClient)
 * const core = new CognitiveCore({ memoryClient });
 *
 * // 2. 为每个 session 创建隔离实例
 * const session = core.createSession("session_001");
 *
 * // 3. 任务前评估
 * const assessment = await session.assessTask("bug_fix", "typescript");
 *
 * // 4. 捕获用户修正
 * session.captureCorrection(
 *   { what: "used old API", correctedTo: "use new API", likelyRootCause: "API v2 migration", isNewKnowledge: true },
 *   { sessionId: "session_001", hasExplicitRejection: true, taskType: "bug_fix", domain: "typescript" }
 * );
 *
 * // 5. Session 结束时持久化学习
 * await session.finalizeLearning(
 *   { sessionId: "session_001", hasExplicitRejection: false, taskType: "bug_fix", domain: "typescript" },
 *   "typescript"
 * );
 * ```
 *
 * ## Result\<T\> 模式
 *
 * 所有异步方法返回 `Result<T>` (discriminated union):
 *   - `{ ok: true, value: T }` — 成功
 *   - `{ ok: false, error: { code: string, message: string } }` — 失败
 *
 * 调用方通过 `result.ok` 区分成功/失败，无需 try-catch。
 *
 * 通用性: 不绑定 Claude Code 或任何特定平台。
 */

// 主入口
export { CognitiveCore, SessionCognitiveCore } from "./cognitive-core";
export type { CognitiveCoreDeps, CognitiveCoreMemoryClient } from "./cognitive-core";

// 元认知引擎
export { MetacognitiveEngine } from "./metacognitive-engine";
export type { MetacognitiveMemoryClient } from "./metacognitive-engine";

// 学习环路
export { LearningLoop } from "./learning-loop";
export { TaskAssessmentBuilder } from "./task-assessment";
export { ExecutionFeedbackCollector } from "./execution-feedback";
export { LearningUpdateBuilder } from "./learning-update";

// 纯函数
export { isRealExperience } from "./utils/signal-quality";
export { detectCorrection } from "./signal-detector";
export { buildContextInjection, estimateTokens } from "./context";
export type { BuildContextInput } from "./context";

// Governor: 学习决策编排器 (Phase 1)
export { Governor } from "./governor";
export type {
  ClassifiedSignal,
  GatedSignal,
  LearningDecision,
  GovernorStats,
} from "./governor";

// Governor 子模块 (Phase 1)
export { classify, isKnownSignalType, listSignalTypes } from "./timing-controller";
export type { TimingDecision, SignalType, TimingResult } from "./timing-controller";
export {
  advanceTask,
  advanceSubtask,
  isTaskTerminal,
  isSubtaskTerminal,
  listTaskTransitions,
  listSubtaskTransitions,
} from "./task-state-machine";
export type { TaskTransitionResult, SubtaskTransitionResult } from "./task-state-machine";

// ProtoTask: 零样本任务模板 (Phase 1)
export {
  bootstrapProtoTask,
  getCachedProtoTask,
  invalidateProtoTaskCache,
  clearProtoTaskCache,
  shouldInjectProtoTask,
} from "./proto-task";
export type { ProtoTask, ProtoTaskPhase, ProtoTaskPitfall, ProtoTaskLLMClient } from "./proto-task";

// 记忆巩固 (Phase 2.3)
export { MemoryConsolidator } from "./memory-consolidator";

// 安全
export { sanitizePromptFragment } from "./sanitize";

// E4/E5/E6 扩展 (Phase 2)
export { GapDetector } from "./gap-detector";
export { StrategyRegistry, StrategyProposer, StrategyApplier } from "./strategy-registry";
export { CrossDomainAnalyzer } from "./cross-domain-analyzer";

// V13: 任务调度 (Phase 3)
export { TaskScheduler, isInQuietHours, canParallelize, countTodayTriggers, DEFAULT_TRIGGERING_CONFIG } from "./task-scheduler";
export type { TaskSchedulerMemoryClient, SchedulerTaskContext, SchedulerSubtask } from "./task-scheduler";

// V13: 子 Agent 管理 (Phase 3b)
export { SubagentManager, buildSubagentContext } from "./subagent-manager";
export type { SubagentMemoryClient, SubagentExecutionAPI, SubagentTaskInfo } from "./subagent-manager";

// V13: Active Driving — 心跳监控 (Phase 3c)
export { HeartbeatMonitor } from "./heartbeat-monitor";
export type { HeartbeatMemoryClient, HeartbeatTaskContext, HeartbeatCheckResult, StallInterventionCallback } from "./heartbeat-monitor";

// Phase 0 — Scenario-Contextual Memory
export { SEED_SCENARIOS, getSeedScenario, validateSeedScenarios } from "./scenario-registry";
export { readCache, writeCache, checkCache, clearCache } from "./scenario-cache";
export type { ScenarioCacheEntry, CacheCheckResult } from "./scenario-cache";
export { embed, isEmbeddingAvailable, getEmbeddingConfig } from "./embedding";

// Phase 2 — Scene Recognition
export { recognizeScene, getPrimaryScenarioId, getActiveScenarioIds, SCENE_CONFIDENCE } from "./scene-recognizer";

// 常量
export { SLOTS } from "./constants";

// 开发工具
export { InMemoryMemoryClient } from "./inmemory-client";

// M0: 核心运行时 (v0.8.0.0+)
export { EventOrchestrator } from "../orchestrator";
export type { PraxisLifecycleEvent } from "../orchestrator";
export { SessionStartHandler } from "../session-start";
export type { SessionStartOptions } from "../session-start";
export { SessionEndHandler } from "../session-end";
export { MessageReceivedHandler } from "../message-received";
export { BeforeToolCallHandler } from "../before-tool-call";
export { AfterToolCallHandler } from "../after-tool-call";
export { AgentEndHandler } from "../agent-end";
export type { AgentEndSummary } from "../agent-end";
export { CronTickHandler } from "../cron-tick";
export type { M0Deps, MemorySubsystem, CacheSubsystem, LLMSubsystem } from "../m0-deps";
export { DEFAULT_AUTONOMY_POLICY, assessRiskLevel } from "../m0-deps";
export { localCache } from "../memory/local-cache";
export type { CacheEntry, CacheStats } from "../memory/local-cache";

// M2: 上下文编排 (v0.9.0.0+)
export { organizeContext } from "../context-organizer";
export type {
  PressureLevel,
  MaturityLevel,
  ContextStructure,
  TierEntry,
  ContextTier,
  OrganizeContextInput,
  OrganizeContextOutput,
} from "../context-organizer";

// M2 Step 2: 压力自适应
export {
  measurePressure,
  getInjectionStrategy,
  assessPressure,
} from "../context-pressure-monitor";
export type {
  PressureReading,
  InjectionStrategy,
} from "../context-pressure-monitor";

// M2 Step 2.2: Lazy Loading
export {
  recallStructure,
  buildStructureIndex,
  formatStructureIndex,
  formatRecalledStructure,
} from "../memory/recall-structure";
export type {
  RecalledStructure,
  StructureIndexEntry,
} from "../memory/recall-structure";

// M2 Step 3: 注意力遥测
export {
  extractUsageMarkers,
  updateAttention,
  detectZombies,
  detectUnderestimated,
  generateTelemetryReport,
  formatTelemetryReport,
} from "../attention-telemetry";
export type {
  AttentionRecord,
  ZombieDetection,
  UnderestimatedDetection,
  TelemetryReport,
} from "../attention-telemetry";

// 全部类型
export type * from "./types";
