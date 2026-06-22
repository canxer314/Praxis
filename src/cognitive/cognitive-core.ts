/**
 * CognitiveCore — @praxis/cognitive-core 主入口
 *
 * 职责:
 *   - 接收外部依赖 (memoryClient, llmClient) — 构造注入
 *   - 内部编排: MetacognitiveEngine + LearningLoop
 *   - 对外暴露统一的认知 API
 *   - Session 隔离: createSession() 为每个 session 创建独立实例
 *
 * 通用性: 不绑定 Claude Code 或任何特定平台。
 * 任何提供 session lifecycle events 的 LLM 应用都可接入。
 *
 * @example
 * ```ts
 * import { CognitiveCore, InMemoryMemoryClient } from "@praxis/cognitive-core";
 *
 * const core = new CognitiveCore({ memoryClient: new InMemoryMemoryClient() });
 *
 * // Session start — create a scoped instance
 * const session = core.createSession("session_001");
 * const assessment = await session.assessTask("bug_fix", "typescript");
 * // => { ok: true, value: { metacognitive: { selfRating: 0.3, ... }, episodic: [...] } }
 *
 * // During task execution
 * session.captureCorrection(
 *   { what: "used X", correctedTo: "use Y instead", likelyRootCause: "API changed", isNewKnowledge: true },
 *   { sessionId: "session_001", hasExplicitRejection: true, taskType: "bug_fix", domain: "typescript" }
 * );
 *
 * // Session end
 * const update = await session.finalizeLearning(
 *   { sessionId: "session_001", hasExplicitRejection: false, taskType: "bug_fix", domain: "typescript" },
 *   "typescript"
 * );
 * ```
 */

import type { Result } from "../platform-adapter";
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  TaskAssessment,
  ExecutionFeedback as ExecutionFeedbackType,
  LearningUpdate,
  Correction,
  SessionContext,
  MetacognitiveProfile,
  CalibrationEntry,
} from "./types";
import { MetacognitiveEngine, MetacognitiveMemoryClient } from "./metacognitive-engine";
import { TaskAssessmentBuilder, TaskAssessmentMemoryClient } from "./task-assessment";
import { ExecutionFeedbackCollector } from "./execution-feedback";
import { LearningUpdateBuilder, LearningUpdateMemoryClient } from "./learning-update";
import { LearningLoop } from "./learning-loop";
import { GapDetector } from "./gap-detector";
import { StrategyRegistry } from "./strategy-registry";
import { log } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 组合依赖接口 — 使用者无需翻 3 个文件
// ══════════════════════════════════════════════════════════════════

export interface CognitiveCoreMemoryClient
  extends MetacognitiveMemoryClient,
    TaskAssessmentMemoryClient,
    LearningUpdateMemoryClient {}

export interface CognitiveCoreDeps {
  memoryClient: CognitiveCoreMemoryClient;
  /** E10: 可选 WAL 文件路径 — 进程重启后从磁盘恢复未写入的记忆 */
  walFilePath?: string;
}

// ══════════════════════════════════════════════════════════════════
// CognitiveCore
// ══════════════════════════════════════════════════════════════════

export class CognitiveCore {
  readonly metacognitive: MetacognitiveEngine;
  readonly strategyRegistry: StrategyRegistry;
  readonly gapDetector: GapDetector;
  private readonly memoryClient: CognitiveCoreMemoryClient;
  private readonly walFilePath?: string;

  constructor(deps: CognitiveCoreDeps) {
    if (!deps.memoryClient) {
      throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "memoryClient is required");
    }
    this.memoryClient = deps.memoryClient;
    this.walFilePath = deps.walFilePath;

    this.metacognitive = new MetacognitiveEngine(deps.memoryClient);
    this.strategyRegistry = new StrategyRegistry(deps.memoryClient);
    this.gapDetector = new GapDetector(this.metacognitive);
  }

  // ---- Session 隔离 (T2) ----

  /**
   * 为指定 session 创建隔离的认知实例。
   *
   * 每个 SessionCognitiveCore 有独立的 ExecutionFeedbackCollector
   * 和 LearningUpdateBuilder，防止并发 session 间状态污染。
   * MetacognitiveEngine 是跨 session 共享的（profile 是全局状态）。
   *
   * @param sessionId 唯一 session 标识
   */
  createSession(sessionId: string): SessionCognitiveCore {
    return new SessionCognitiveCore(
      sessionId,
      this.metacognitive,
      this.memoryClient,
      this.walFilePath,
      this.gapDetector,
      this.strategyRegistry,
    );
  }

  // ---- 跨 session 操作 ----

  /** 获取完整元认知画像 (跨 session 共享) */
  async getProfile(): Promise<Result<MetacognitiveProfile>> {
    return this.metacognitive.getProfile();
  }

  /** 手动触发校准 */
  async calibrate(entry: CalibrationEntry): Promise<Result<void>> {
    return this.metacognitive.calibrate(entry);
  }

  /** 重放上次 session 未持久化的记忆 */
  async replayPendingWrites(): Promise<Result<number>> {
    // 跨 session 的 WAL 重放 — 使用临时 LearningUpdateBuilder
    const lu = new LearningUpdateBuilder(this.metacognitive, this.memoryClient, { walFilePath: this.walFilePath });
    return lu.replayWal();
  }

  /**
   * 关闭认知核心。
   * 尝试最后一次 WAL 重放 + 清理缓存。
   */
  async shutdown(): Promise<void> {
    try {
      await this.replayPendingWrites();
    } catch {
      // 静默 — shutdown 不能抛错阻塞进程退出
    }

    log({
      ts: new Date().toISOString(),
      module: "cognitive-core",
      op: "shutdown",
      duration_ms: 0,
      outcome: "success",
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// SessionCognitiveCore — 会话隔离实例
// ══════════════════════════════════════════════════════════════════

export class SessionCognitiveCore {
  readonly sessionId: string;
  readonly metacognitive: MetacognitiveEngine;
  private readonly loop: LearningLoop;
  private readonly gapDetector: GapDetector;
  private readonly strategyRegistry: StrategyRegistry;

  constructor(
    sessionId: string,
    metacognitive: MetacognitiveEngine,
    memoryClient: CognitiveCoreMemoryClient,
    walFilePath?: string,
    gapDetector?: GapDetector,
    strategyRegistry?: StrategyRegistry,
  ) {
    if (!sessionId || typeof sessionId !== "string" || sessionId.length > 128) {
      throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "sessionId must be a non-empty string ≤ 128 chars");
    }
    this.sessionId = sessionId;
    this.metacognitive = metacognitive;
    this.gapDetector = gapDetector ?? new GapDetector(metacognitive);
    this.strategyRegistry = strategyRegistry ?? new StrategyRegistry(memoryClient);

    const taskAssessment = new TaskAssessmentBuilder(metacognitive, memoryClient);
    const executionFeedback = new ExecutionFeedbackCollector();
    const learningUpdate = new LearningUpdateBuilder(metacognitive, memoryClient, { walFilePath });

    this.loop = new LearningLoop(metacognitive, taskAssessment, executionFeedback, learningUpdate);
  }

  // ---- 任务生命周期 ----

  /** Phase 1: 任务接收 — 评估 + 检索记忆 */
  async assessTask(
    taskType: string,
    domain: string,
    opts?: { classificationConfidence?: number },
  ): Promise<Result<TaskAssessment>> {
    _validateInput("taskType", taskType);
    _validateInput("domain", domain);
    return this.loop.taskReceive(taskType, domain, opts);
  }

  /** Phase 2: 捕获用户修正 */
  captureCorrection(
    correction: Correction,
    sessionContext: SessionContext,
  ): Result<Correction | null> {
    return this.loop.captureCorrection(correction, sessionContext);
  }

  /** Phase 2: 记录执行异常 */
  captureAnomaly(description: string): void {
    this.loop.captureAnomaly(description);
  }

  /** Phase 2: 执行步骤推进 */
  advanceStep(): void {
    this.loop.advanceStep();
  }

  /** Phase 2: 获取当前反馈快照 */
  getFeedback(): Result<ExecutionFeedbackType> {
    return this.loop.getFeedbackSnapshot();
  }

  /** Phase 3: Session 结束 — 学习 + 持久化 + E4 缺口→策略重新激活 */
  async finalizeLearning(
    sessionContext: SessionContext,
    domain: string,
  ): Promise<Result<LearningUpdate>> {
    _validateInput("domain", domain);
    const result = await this.loop.sessionEnd(sessionContext, domain);

    // E4 (Phase 2.1): 缺口猎取 → DORMANT 策略重新激活
    // 学习持久化后检查该领域是否有 PERSISTENT_GAP，
    // 若有则将匹配的 DORMANT 策略转回 PROPOSED。
    try {
      const gapResult = await this.gapDetector.detect();
      if (gapResult.ok && gapResult.value.escalatedGaps.length > 0) {
        const escalatedDomains = new Set(
          gapResult.value.escalatedGaps.map((g) => g.gap.context),
        );
        for (const escalatedDomain of escalatedDomains) {
          await this.strategyRegistry.reactivateDormant(
            escalatedDomain,
            `PERSISTENT_GAP detected — ${gapResult.value.escalatedGaps.length} escalated gap(s)`,
          );
        }
      }
    } catch {
      // E4 reactivation is best-effort — failure must not break the learning loop
    }

    return result;
  }

  /** 重放本 session 的 WAL */
  async replayPendingWrites(): Promise<Result<number>> {
    return this.loop.replayPendingWrites();
  }
}

// ══════════════════════════════════════════════════════════════════
// Input validation (MED-4)
// ══════════════════════════════════════════════════════════════════

function _validateInput(name: string, value: string): void {
  if (!value || typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, `${name} must be a non-empty string ≤ 128 chars`);
  }
}
