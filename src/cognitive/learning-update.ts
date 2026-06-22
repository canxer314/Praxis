/**
 * LearningUpdate — Phase 3: session_end
 *
 * 职责:
 *   - 从 session 反馈中提取新情景记忆
 *   - 触发元认知校准
 *   - 写入 AgentMemory (WAL 队列保护)
 *   - 检测新知识缺口
 */

import type { Result } from "../platform-adapter";
import type {
  LearningUpdate as LearningUpdateType,
  EpisodicMemory,
  CalibrationEntry,
  KnowledgeGap,
  Correction,
  SessionContext,
} from "./types";
import type { MetacognitiveEngine } from "./metacognitive-engine";
import { isRealExperience } from "./heuristics";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 依赖接口
// ══════════════════════════════════════════════════════════════════

export interface LearningUpdateMemoryClient {
  lessonSave(data: Record<string, unknown>): Promise<Result<unknown>>;
  smartSearch(query: string, opts?: { limit?: number }): Promise<Result<unknown[]>>;
}

// ══════════════════════════════════════════════════════════════════
// 内部状态
// ══════════════════════════════════════════════════════════════════

interface PendingWrite {
  type: "episodic" | "calibration" | "knowledge_gap";
  data: Record<string, unknown>;
  timestamp: number;
}

// ══════════════════════════════════════════════════════════════════
// LearningUpdate
// ══════════════════════════════════════════════════════════════════

export class LearningUpdateBuilder {
  private readonly metacognitive: MetacognitiveEngine;
  private readonly memory: LearningUpdateMemoryClient;
  /** Write-Ahead Log — 写入失败时的本地队列 */
  private wal: PendingWrite[] = [];

  constructor(metacognitive: MetacognitiveEngine, memory: LearningUpdateMemoryClient) {
    if (!metacognitive) throw new Error("MetacognitiveEngine is required");
    if (!memory) throw new Error("LearningUpdateMemoryClient is required");
    this.metacognitive = metacognitive;
    this.memory = memory;
  }

  /**
   * 从 session 的修正记录中构建 LearningUpdate:
   *   1. 提取新情景记忆 (只保留 isRealExperience === true 的)
   *   2. 执行元认知校准
   *   3. 检测新知识缺口
   *   4. 持久化到 AgentMemory
   */
  async build(
    corrections: Correction[],
    sessionContext: SessionContext,
    domain: string,
  ): Promise<Result<LearningUpdateType>> {
    const start = Date.now();

    // 1. 提取新情景记忆
    const newEpisodic: EpisodicMemory[] = [];
    for (const correction of corrections) {
      if (!isRealExperience(correction, sessionContext)) continue;

      const memory: EpisodicMemory = {
        memoryId: `ep_${sessionContext.sessionId}_${Date.now()}_${newEpisodic.length}`,
        agentId: "praxis",
        timestamp: Date.now(),
        context: {
          taskType: sessionContext.taskType,
          domain,
        },
        observation: {
          situation: `执行 ${sessionContext.taskType} 任务时被修正`,
          action: correction.what,
          outcome: correction.correctedTo,
          correction: correction.correctedTo,
        },
        signals: {
          wasCorrected: true,
          userSatisfied: false,
          deviationFromExpected: correction.likelyRootCause,
        },
      };
      newEpisodic.push(memory);
    }

    // 2. 元认知校准 — 先读 profile 获取任务前自评
    const profileResult = await this.metacognitive.getProfile();
    const preTaskSelfRating =
      profileResult.ok
        ? (profileResult.value.domainProficiencies[domain]?.selfRating ?? 0.3)
        : 0.3;

    const actualOutcome: CalibrationEntry["actualOutcome"] =
      corrections.length > 0 ? "correction_needed" : "success";

    const calibration: CalibrationEntry = {
      domain,
      selfRatingBefore: preTaskSelfRating,
      actualOutcome,
      calibrationDelta:
        actualOutcome === "success" ? 0.05 : -0.1,
      timestamp: Date.now(),
      sourceAnchor: corrections.length > 0
        ? "explicit_correction"
        : "statistical_anomaly",
    };

    await this.metacognitive.calibrate(calibration);

    // 3. 检测新知识缺口
    const newGaps: KnowledgeGap[] = [];
    for (const correction of corrections) {
      if (correction.isNewKnowledge) {
        newGaps.push({
          topic: correction.likelyRootCause,
          detectedAt: "user_corrected",
          context: correction.correctedTo,
          resolved: false,
        });
      }
    }

    // 4. 持久化 — 写入 AgentMemory
    for (const memory of newEpisodic) {
      const writeResult = await this.writeEpisode(memory);
      if (!writeResult.ok) {
        this.enqueueToWal({ type: "episodic", data: memory as unknown as Record<string, unknown>, timestamp: Date.now() });
        logDegraded("learning-update", "build", `WAL queued: ${memory.memoryId}`);
      }
    }

    log({
      ts: new Date().toISOString(),
      module: "learning-update",
      op: "build",
      duration_ms: Date.now() - start,
      outcome: "success",
    });

    return {
      ok: true,
      value: { newEpisodic, newProcedural: [], calibration, newGaps },
    };
  }

  /** 重放 WAL — session_start 时调用 */
  async replayWal(): Promise<Result<number>> {
    if (this.wal.length === 0) return { ok: true, value: 0 };

    let replayed = 0;
    const pending = [...this.wal];

    for (const entry of pending) {
      const result = await this.writeEpisode(entry.data as unknown as EpisodicMemory);
      if (result.ok) {
        replayed++;
        this.wal = this.wal.filter((w) => w !== entry);
      }
    }

    return { ok: true, value: replayed };
  }

  // ---- 内部 ----

  private async writeEpisode(memory: EpisodicMemory): Promise<Result<unknown>> {
    return this.memory.lessonSave({
      type: "episode",
      tags: [memory.context.taskType, memory.context.domain],
      content: JSON.stringify(memory),
      agent_id: memory.agentId,
    });
  }

  private enqueueToWal(entry: PendingWrite): void {
    this.wal.push(entry);
  }
}
