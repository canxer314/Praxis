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
export { isRealExperience, editDistance } from "./heuristics";
export { buildContextInjection } from "./context";
export type { BuildContextInput } from "./context";

// 记忆巩固 (Phase 2.3)
export { MemoryConsolidator } from "./memory-consolidator";

// 安全
export { sanitizePromptFragment } from "./sanitize";

// E4/E5/E6 扩展 (Phase 2)
export { GapDetector } from "./gap-detector";
export { StrategyRegistry, StrategyProposer, StrategyApplier } from "./strategy-registry";
export { CrossDomainAnalyzer } from "./cross-domain-analyzer";

// 常量
export { SLOTS } from "./constants";

// 开发工具
export { InMemoryMemoryClient } from "./inmemory-client";

// 全部类型
export type * from "./types";
