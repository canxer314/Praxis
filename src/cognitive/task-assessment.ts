/**
 * TaskAssessment — Phase 1: task_receive 实现
 *
 * 职责:
 *   - 调用 MetacognitiveEngine 做任务前自评
 *   - 检索相关记忆 (episodic + procedural + semantic)
 *   - 组装 TaskAssessment 结果 → 供 context injection 使用
 */

import type { Result } from "../platform-adapter";
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  TaskAssessment as TaskAssessmentType,
  EpisodicMemory,
  ProceduralMemory,
  SemanticMemory,
} from "./types";
import type { MetacognitiveEngine } from "./metacognitive-engine";
import { log } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 依赖接口
// ══════════════════════════════════════════════════════════════════

export interface TaskAssessmentMemoryClient {
  smartSearch(query: string, opts?: { limit?: number }): Promise<Result<unknown[]>>;
}

// ══════════════════════════════════════════════════════════════════
// TaskAssessment
// ══════════════════════════════════════════════════════════════════

export class TaskAssessmentBuilder {
  private readonly metacognitive: MetacognitiveEngine;
  private readonly memory: TaskAssessmentMemoryClient;

  constructor(metacognitive: MetacognitiveEngine, memory: TaskAssessmentMemoryClient) {
    if (!metacognitive) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP,"MetacognitiveEngine is required");
    if (!memory) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP,"TaskAssessmentMemoryClient is required");
    this.metacognitive = metacognitive;
    this.memory = memory;
  }

  /**
   * 构建 TaskAssessment:
   *   1. 元认知自评
   *   2. 检索相关记忆
   *   3. 组装结果
   */
  async build(
    taskType: string,
    domain: string,
    opts?: { classificationConfidence?: number },
  ): Promise<Result<TaskAssessmentType>> {
    const start = Date.now();

    // 1. 元认知自评 (优先用缓存 — T8 异步优化)
    const assessResult = await this.metacognitive.cachedAssess(domain, taskType);
    if (!assessResult.ok) {
      log({
        ts: new Date().toISOString(),
        module: "task-assessment",
        op: "build",
        duration_ms: Date.now() - start,
        outcome: "degraded",
        error: assessResult.error.message,
      });
      return assessResult;
    }

    // 2. 检索相关记忆
    const episodic: EpisodicMemory[] = [];
    const procedural: ProceduralMemory[] = [];
    const semantic: SemanticMemory[] = [];

    try {
      const searchResult = await this.memory.smartSearch(
        `task_type:${taskType} domain:${domain}`,
        { limit: 5 },
      );

      if (searchResult.ok && Array.isArray(searchResult.value)) {
        // TODO: 按 content_type 分类搜索结果
        for (const item of searchResult.value) {
          const record = item as Record<string, unknown>;
          // 根据 content_type 路由到对应记忆数组
          // 当前 stub — Phase 1 实现时完善分类逻辑
          if (record.content_type === "episode") {
            episodic.push(record as unknown as EpisodicMemory);
          }
        }
      }
    } catch {
      // 检索失败降级 — 返回空记忆，不阻塞任务
      log({
        ts: new Date().toISOString(),
        module: "task-assessment",
        op: "build",
        duration_ms: Date.now() - start,
        outcome: "degraded",
        error: "memory search failed, continuing with empty memories",
      });
    }

    // 3. 组装
    const classificationConfidence = opts?.classificationConfidence ?? 0.7;

    log({
      ts: new Date().toISOString(),
      module: "task-assessment",
      op: "build",
      duration_ms: Date.now() - start,
      outcome: "success",
    });

    return {
      ok: true,
      value: {
        taskType,
        domain,
        metacognitive: assessResult.value,
        episodic,
        procedural,
        semantic,
        classificationConfidence,
      },
    };
  }
}
