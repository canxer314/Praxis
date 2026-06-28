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

// Phase 11: CognitiveCore 已删除 — bridge 退役, 使用 EventOrchestrator (src/orchestration/orchestrator.ts)

// 纯函数
export { isRealExperience } from "./utils/signal-quality";
export { detectCorrection } from "./signal-detector";
export { buildContextInjection, estimateTokens } from "./context";
export type { BuildContextInput } from "./context";

// 安全
export { sanitizePromptFragment } from "./sanitize";

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
export { EventOrchestrator } from "../orchestration/orchestrator";
export type { PraxisLifecycleEvent } from "../orchestration/orchestrator";
export { SessionStartHandler } from "../hooks/session-start";
export type { SessionStartOptions } from "../hooks/session-start";
export { SessionEndHandler } from "../hooks/session-end";
export { MessageReceivedHandler } from "../hooks/message-received";
export { BeforeToolCallHandler } from "../hooks/before-tool-call";
export { AfterToolCallHandler } from "../hooks/after-tool-call";
export { AgentEndHandler } from "../hooks/agent-end";
export type { AgentEndSummary } from "../hooks/agent-end";
export { CronTickHandler } from "../hooks/cron-tick";
export type { M0Deps, MemorySubsystem, CacheSubsystem, LLMSubsystem } from "../m0-deps";
export { DEFAULT_AUTONOMY_POLICY, assessRiskLevel } from "../m0-deps";
export { localCache } from "../memory/local-cache";
export type { CacheEntry, CacheStats } from "../memory/local-cache";

// M2: 上下文编排 (v0.9.0.0+)
export { organizeContext } from "../orchestration/context-organizer";
export type {
  PressureLevel,
  MaturityLevel,
  ContextStructure,
  TierEntry,
  ContextTier,
  OrganizeContextInput,
  OrganizeContextOutput,
} from "../orchestration/context-organizer";

// M2 Step 2: 压力自适应
export {
  measurePressure,
  getInjectionStrategy,
  assessPressure,
} from "../orchestration/context-pressure-monitor";
export type {
  PressureReading,
  InjectionStrategy,
} from "../orchestration/context-pressure-monitor";

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
} from "../analysis/attention-telemetry";
export type {
  AttentionRecord,
  ZombieDetection,
  UnderestimatedDetection,
  TelemetryReport,
} from "../analysis/attention-telemetry";

// M2 Step 4: TaskContext
export {
  createTaskContext,
  applyProgress,
  updateTaskContext,
  isStale,
  formatTaskContext,
} from "../orchestration/task-context";
export type {
  TaskContext,
  TaskType,
  InferredProgress,
  CreateTaskContextInput,
} from "../orchestration/task-context";

// M2 Step 5: 语义消歧
export {
  disambiguate,
  disambiguateText,
  registerHomographs,
  formatDisambiguationHint,
} from "../analysis/semantic-disambiguator";
export type {
  HomographEntry,
  DisambiguationResult,
} from "../analysis/semantic-disambiguator";

// M3: 约束系统 (v0.9.1.0+)
export {
  getActiveConstraints,
  sortBySeverity,
  deprecateConstraint,
  estimateConstraintTokens,
  SEVERITY_RANK,
} from "../orchestration/proto-constraint";

// M3 Step 2: 约束注入
export { injectConstraints } from "../orchestration/constraint-injector";
export type {
  InjectConstraintsInput,
  InjectConstraintsOutput,
} from "../orchestration/constraint-injector";

// M3 Step 3: 约束验证
export { checkConstraints } from "../orchestration/constraint-validator";
export type { ConstraintCheckResult } from "../orchestration/constraint-validator";

// 全部类型
export type * from "./types";
