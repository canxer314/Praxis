/**
 * LearningLoop — 三阶段学习环路编排
 *
 * 7 步认知环路 (感知→关联→推理→行动→反馈→学习→巩固) 压缩为 3 个工程阶段:
 *   1. taskReceive  — session_start / 新任务
 *   2. taskExecute  — 工具调用 + 用户消息
 *   3. sessionEnd   — session 结束异步处理
 *
 * 每个阶段返回 Result<T>，调用方决定如何处理降级。
 */

import type { Result } from "../platform-adapter";
import type {
  TaskAssessment,
  ExecutionFeedback as ExecutionFeedbackType,
  LearningUpdate,
  Correction,
  SessionContext,
} from "./types";
import { MetacognitiveEngine } from "./metacognitive-engine";
import { TaskAssessmentBuilder } from "./task-assessment";
import { ExecutionFeedbackCollector } from "./execution-feedback";
import { LearningUpdateBuilder } from "./learning-update";
import { log } from "../logger";

// ══════════════════════════════════════════════════════════════════
// LearningLoop
// ══════════════════════════════════════════════════════════════════

export class LearningLoop {
  readonly metacognitive: MetacognitiveEngine;
  private readonly taskAssessment: TaskAssessmentBuilder;
  readonly executionFeedback: ExecutionFeedbackCollector;
  private readonly learningUpdate: LearningUpdateBuilder;

  constructor(
    metacognitive: MetacognitiveEngine,
    taskAssessment: TaskAssessmentBuilder,
    executionFeedback: ExecutionFeedbackCollector,
    learningUpdate: LearningUpdateBuilder,
  ) {
    if (!metacognitive) throw new Error("MetacognitiveEngine is required");
    if (!taskAssessment) throw new Error("TaskAssessmentBuilder is required");
    if (!executionFeedback) throw new Error("ExecutionFeedbackCollector is required");
    if (!learningUpdate) throw new Error("LearningUpdateBuilder is required");

    this.metacognitive = metacognitive;
    this.taskAssessment = taskAssessment;
    this.executionFeedback = executionFeedback;
    this.learningUpdate = learningUpdate;
  }

  // ---- Phase 1: task_receive ----

  /**
   * 任务接收阶段 — session_start 或 task 切换时调用。
   *
   * 返回 TaskAssessment 供 context injection 使用。
   * AgentMemory 不可用时不抛错 — 返回空记忆 + 降级标记。
   */
  async taskReceive(
    taskType: string,
    domain: string,
    opts?: { classificationConfidence?: number },
  ): Promise<Result<TaskAssessment>> {
    const start = Date.now();

    this.executionFeedback.reset();

    const result = await this.taskAssessment.build(taskType, domain, opts);

    log({
      ts: new Date().toISOString(),
      module: "learning-loop",
      op: "taskReceive",
      duration_ms: Date.now() - start,
      outcome: result.ok ? "success" : "error",
      error: result.ok ? undefined : result.error.message,
    });

    return result;
  }

  // ---- Phase 2: task_execute ----

  /**
   * 记录执行步骤推进。
   */
  advanceStep(): void {
    this.executionFeedback.advanceStep();
  }

  /**
   * 捕获用户修正信号。
   */
  captureCorrection(
    correction: Correction,
    sessionContext: SessionContext,
  ): Result<Correction | null> {
    return this.executionFeedback.captureCorrection(correction, sessionContext);
  }

  /**
   * 记录执行异常。
   */
  captureAnomaly(description: string): void {
    this.executionFeedback.captureAnomaly(description);
  }

  /**
   * 获取当前执行反馈快照。
   */
  getFeedbackSnapshot(): Result<ExecutionFeedbackType> {
    return this.executionFeedback.snapshot();
  }

  // ---- Phase 3: session_end ----

  /**
   * Session 结束 — 提取学习更新并持久化。
   *
   * 如果 AgentMemory 写入失败，Correction 进入 WAL 队列，
   * 下次 session_start 时自动重放。
   */
  async sessionEnd(
    sessionContext: SessionContext,
    domain: string,
  ): Promise<Result<LearningUpdate>> {
    const start = Date.now();

    const feedback = this.executionFeedback.snapshot();
    if (!feedback.ok) return feedback;

    const result = await this.learningUpdate.build(
      feedback.value.userCorrections,
      sessionContext,
      domain,
    );

    log({
      ts: new Date().toISOString(),
      module: "learning-loop",
      op: "sessionEnd",
      duration_ms: Date.now() - start,
      outcome: result.ok ? "success" : "error",
      error: result.ok ? undefined : result.error.message,
    });

    return result;
  }

  /**
   * 重放 WAL 中未写入的记忆 — session_start 时调用。
   */
  async replayPendingWrites(): Promise<Result<number>> {
    return this.learningUpdate.replayWal();
  }
}
