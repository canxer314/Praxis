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
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  LearningUpdate as LearningUpdateType,
  EpisodicMemory,
  ProceduralMemory,
  SemanticMemory,
  CalibrationEntry,
  KnowledgeGap,
  Correction,
  SessionContext,
} from "./types";
import type { MetacognitiveEngine } from "./metacognitive-engine";
import { MemoryConsolidator } from "./memory-consolidator";
import { isRealExperience } from "./heuristics";
import { log, logDegraded } from "../logger";
import * as fs from "fs";

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
  type: "episodic" | "calibration" | "knowledge_gap" | "semantic" | "procedural";
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
  /** E10: 可选的 WAL 文件路径 — 进程重启后恢复 */
  private readonly walFilePath?: string;

  constructor(
    metacognitive: MetacognitiveEngine,
    memory: LearningUpdateMemoryClient,
    opts?: { walFilePath?: string },
  ) {
    if (!metacognitive) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "MetacognitiveEngine is required");
    if (!memory) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "LearningUpdateMemoryClient is required");
    this.metacognitive = metacognitive;
    this.memory = memory;
    this.walFilePath = opts?.walFilePath;

    // E10: 构造时从文件恢复 WAL
    if (this.walFilePath) {
      try {
        if (fs.existsSync(this.walFilePath)) {
          const raw = fs.readFileSync(this.walFilePath, "utf-8");
          const entries = JSON.parse(raw) as PendingWrite[];
          if (Array.isArray(entries) && entries.length > 0) {
            this.wal = entries;
            log({
              ts: new Date().toISOString(),
              module: "learning-update",
              op: "walRestore",
              duration_ms: 0,
              outcome: "success",
              error: `recovered ${entries.length} WAL entries from disk`,
            });
          }
        }
      } catch (e) {
          logDegraded("learning-update", "WAL", `disk read failed: ${e instanceof Error ? e.message : String(e)}`);
        logDegraded("learning-update", "walRestore", "failed to restore WAL from disk, starting fresh");
      }
    }
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

    const calResult = await this.metacognitive.calibrate(calibration);
    if (!calResult.ok) {
      logDegraded("learning-update", "build", `calibration write failed: ${calResult.error?.message}`);
      this.enqueueToWal({ type: "calibration", data: calibration as unknown as Record<string, unknown>, timestamp: Date.now() });
    }

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

    // 4. Phase 2.3: 记忆间一致性 — Episodic → Semantic → Procedural 提炼
    const consolidator = new MemoryConsolidator();

    // 检索已有语义/程序记忆（用于去重）
    let existingSemantic: SemanticMemory[] = [];
    let existingProcedural: ProceduralMemory[] = [];
    try {
      const semResult = await this.memory.smartSearch("type:semantic", { limit: 50 });
      if (semResult.ok) {
        existingSemantic = (semResult.value as unknown[])
          .filter((r): r is SemanticMemory & Record<string, unknown> =>
            typeof r === "object" && r !== null
            && (r as Record<string, unknown>).memoryId !== undefined
            && typeof (r as Record<string, unknown>).subject === "string",
          )
          .map((r) => r as unknown as SemanticMemory);
      }
      const procResult = await this.memory.smartSearch("type:procedural", { limit: 50 });
      if (procResult.ok) {
        existingProcedural = (procResult.value as unknown[])
          .filter((r): r is ProceduralMemory & Record<string, unknown> =>
            typeof r === "object" && r !== null
            && (r as Record<string, unknown>).memoryId !== undefined
            && typeof (r as Record<string, unknown>).taskType === "string",
          )
          .map((r) => r as unknown as ProceduralMemory);
      }
    } catch (e) {
      logDegraded("learning-update", "consolidation:smartSearch",
        `search failed: ${e instanceof Error ? e.message : String(e)}`);
      // 检索失败 → 用空列表降级巩固（仍可工作，只是可能产生重复）
    }

    const { newSemantic, newProcedural } = consolidator.consolidate(
      newEpisodic,
      existingSemantic,
      existingProcedural,
    );

    // 持久化新语义记忆
    for (const sem of newSemantic) {
      const saveResult = await this.memory.lessonSave({
        type: "semantic",
        tags: [sem.subject, "semantic"],
        content: JSON.stringify(sem),
      });
      if (!saveResult.ok) {
        this.enqueueToWal({ type: "semantic", data: sem as unknown as Record<string, unknown>, timestamp: Date.now() });
        logDegraded("learning-update", "build", `semantic save failed — WAL queued: ${sem.memoryId}`);
      }
    }

    // 持久化新程序记忆
    for (const proc of newProcedural) {
      const saveResult = await this.memory.lessonSave({
        type: "procedural",
        tags: [proc.domain, "procedural"],
        content: JSON.stringify(proc),
      });
      if (!saveResult.ok) {
        this.enqueueToWal({ type: "procedural", data: proc as unknown as Record<string, unknown>, timestamp: Date.now() });
        logDegraded("learning-update", "build", `procedural save failed — WAL queued: ${proc.memoryId}`);
      }
    }

    // 5. 持久化情景记忆 — 写入 AgentMemory
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
      value: { newEpisodic, newProcedural, calibration, newGaps },
    };
  }

  /** 重放 WAL — session_start 时调用 */
  async replayWal(): Promise<Result<number>> {
    if (this.wal.length === 0) return { ok: true, value: 0 };

    let replayed = 0;
    const pending = [...this.wal];

    for (const entry of pending) {
      let result: Result<unknown>;
      switch (entry.type) {
        case "episodic":
          result = await this.writeEpisode(entry.data as unknown as EpisodicMemory);
          break;
        case "calibration":
          result = await this.memory.lessonSave({
            type: "calibration",
            content: JSON.stringify(entry.data),
          });
          break;
        case "knowledge_gap":
          result = await this.memory.lessonSave({
            type: "knowledge_gap",
            content: JSON.stringify(entry.data),
          });
          break;
        case "semantic":
          result = await this.memory.lessonSave({
            type: "semantic",
            content: JSON.stringify(entry.data),
          });
          break;
        case "procedural":
          result = await this.memory.lessonSave({
            type: "procedural",
            content: JSON.stringify(entry.data),
          });
          break;
        default:
          // Unknown entry type — skip silently
          this.wal = this.wal.filter((w) => w !== entry);
          continue;
      }
      if (result.ok) {
        replayed++;
        this.wal = this.wal.filter((w) => w !== entry);
      }
    }

    // E10: 重放后持久化更新后的 WAL
    if (replayed > 0) this.persistWalToDisk();

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
    this.persistWalToDisk();
  }

  /** E10: 将 WAL 序列化到磁盘 */
  private persistWalToDisk(): void {
    if (!this.walFilePath) return;
    try {
      fs.writeFileSync(this.walFilePath, JSON.stringify(this.wal), "utf-8");
    } catch (e) {
      logDegraded("learning-update", "persistWalToDisk",
        `disk write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
