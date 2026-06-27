/**
 * SessionEndHandler — M0 重构 + Phase 0 M4 运行时接线
 *
 * 职责:
 *   - 收集 session 中的所有待处理学习信号
 *   - 每个信号写入 AgentMemory lesson
 *   - AgentMemory 不可用时降级到 local-cache
 *   - 可选: LLM transcript 分析 (analyzeTranscript)
 *   - Phase 0: 7 源置信度融合 + 注意力遥测更新 + 版本链 + 持久化
 */

import type { Result } from "./platform-adapter";
import type { M0Deps } from "./m0-deps";
import type { PendingSignal, ProtoStructure, SignalSourceInput, ToolCallRecord, VerificationContext } from "./cognitive/types";
import { extractUsageMarkers, updateAttention } from "./attention-telemetry";
import { parsePredictionMarkers } from "./orchestration/prediction-protocol";
import { createVersion } from "./structure-version";
import { StatisticalVerifier } from "./analysis/statistical-verifier";
import { RoleVerifier } from "./analysis/role-verifier";
import { fullPropagation } from "./structure-graph";
import { applyProgress, type TaskContext, type InferredProgress } from "./task-context";

// ---- SessionEndHandler ----

export class SessionEndHandler {
  private readonly processed = new Set<string>();

  constructor(private readonly deps: M0Deps) {}

  /**
   * 处理 session_end 事件。
   * @param sessionId 会话 ID
   * @param transcript 完整对话记录 (可选 — 如果提供了 analyzeTranscript)
   * @param pendingSignals session 中收集的所有学习信号
   */
  async handle(
    sessionId: string,
    transcript: string | null,
    pendingSignals: PendingSignal[],
    /** Phase 0: session 中注入的结构（供融合匹配用） */
    injectedStructures?: ProtoStructure[],
    /** Phase 0: session 中注入的结构 ID 列表（供 attention injectedIds） */
    injectedStructureIds?: string[],
    /** M5.1: MidSession 信号源（来自 MidSessionLearner） */
    midSessionSources?: SignalSourceInput[],
    /** T1: session 工具调用轨迹 (供 LLM-independent 验证器, Phase 2) */
    toolCallTrace?: ToolCallRecord[],
  ): Promise<Result<{ lessonsWritten: number; lessonsFromSignals: number; lessonsFromTranscript: number; structuresExtracted: number; structureUsageCount: number; fusedCount: number; versionedCount: number }>> {
    // 幂等去重
    if (this.processed.has(sessionId)) {
      return { ok: true, value: { lessonsWritten: 0, lessonsFromSignals: 0, lessonsFromTranscript: 0, structuresExtracted: 0, structureUsageCount: 0, fusedCount: 0, versionedCount: 0 } };
    }
    this.processed.add(sessionId);

    let lessonsFromSignals = 0;
    let lessonsFromTranscript = 0;

    // 1. 处理 pendingSignals → 写入 lessons
    if (pendingSignals.length > 0) {
      lessonsFromSignals = await this.persistSignals(sessionId, pendingSignals);
    }

    // 2. LLM transcript 分析 (可选 — 需要 llm 依赖)
    if (transcript && this.deps.llm) {
      try {
        const llmEvents = await this.deps.llm.analyzeTranscript(transcript);
        for (const event of llmEvents) {
          await this.writeLesson(sessionId, {
            type: event.type,
            content: event.content,
            confidence: event.confidence,
            source: "llm_analysis",
          });
          lessonsFromTranscript++;
        }
      } catch {
        this.deps.logger?.warn("LLM transcript analysis failed", { sessionId });
      }
    }

    // 3. 注意力遥测 + 预测标记解析 (M4) + Phase 0 接线
    let structureUsageCount = 0;
    let predictionsParsed = 0;
    let fusedCount = 0;
    let versionedCount = 0;
    const llmMarkerSources: SignalSourceInput[] = [];
    if (transcript) {
      // 3a. STRUCTURE_USED 标记 → 记录 lessons + Phase 0: 实际调用 updateAttention
      const usedIds = extractUsageMarkers(transcript);
      structureUsageCount = usedIds.length;
      if (usedIds.length > 0) {
        for (const id of usedIds) {
          await this.writeLesson(sessionId, {
            type: "structure_used",
            structureId: id,
            content: `[STRUCTURE_USED: ${id}]`,
            confidence: 1.0,
            source: "attention_telemetry",
          });
        }
        // Phase 0: 更新注意力遥测记录（捕获返回值 + 使用真实 injectedIds）
        if (this.deps.attentionRecords && injectedStructureIds) {
          this.deps.attentionRecords = updateAttention(
            this.deps.attentionRecords, usedIds, injectedStructureIds);
          // M6 Fix-4: 持久化 attentionRecords 到 AgentMemory
          await this.persistAttentionRecords();
        }
      }

      // 3b. PREDICTION_* 标记 → M4.2 llm_marker 信号源数据
      const predictions = parsePredictionMarkers(transcript);
      predictionsParsed = predictions.length;
      for (const p of predictions) {
        await this.writeLesson(sessionId, {
          type: "prediction_marker",
          structureId: p.structureId,
          marker: p.marker,
          content: p.context,
          confidence: p.marker === "PREDICTION_UNCERTAIN" ? 0.5 : 0.8,
          source: "prediction_protocol",
        });
        // Phase 0: 收集 llm_marker 信号源
        llmMarkerSources.push({
          structureId: p.structureId,
          sourceName: "llm_marker",
          value: p.marker === "PREDICTION_CONFIRMED" ? 0.85 : p.marker === "PREDICTION_UNCERTAIN" ? 0.5 : 0.15,
          confidence: 0.7,
          evidence: `Prediction marker: ${p.marker} for ${p.structureId}`,
        });
      }
    }

    // 4. ProtoStructure 提取 (M1 Step 4) + Phase 0: 融合 → 版本化 → 持久化
    let extractedStructures = 0;
    if (transcript && this.deps.llm?.extractProtoStructures) {
      try {
        const candidates = await this.deps.llm.extractProtoStructures(transcript);
        for (const c of candidates) {
          const structure = await this.saveProtoStructureCandidate(sessionId, c);
          extractedStructures++;

          // Phase 0: 版本链 — 记录初始版本（在融合之前，使 diff 捕获原始值）
          const vc = (structure as Record<string, unknown>).versionChain as Array<unknown> | undefined;
          if (!vc || vc.length === 0) {
            createVersion(
              structure as unknown as ProtoStructure,
              "auto_refinement",
              [{
                type: "confidence_changed" as const,
                path: "/confidence",
                oldValue: undefined,
                newValue: c.confidence,
              }],
              `ProtoStructure extracted from session ${sessionId}`,
              [],
            );
            versionedCount++;
          }

          // Phase 0: 持久化 (先于融合，确保结构已存储)
          if (this.deps.memory.saveProtoStructure) {
            await this.deps.memory.saveProtoStructure(structure as unknown as ProtoStructure);
          }
        }
      } catch {
        this.deps.logger?.warn("ProtoStructure extraction failed", { sessionId });
      }
    }

    // Phase 0.5: 7 源置信度融合 — 对注入的结构进行融合
    // T1: 加入 LLM-independent 验证器源 (statistical/role_verifier) — 打破 LLM 自评循环 (§4)
    if (this.deps.fuser && injectedStructures && injectedStructures.length > 0) {
      const verifierSources: SignalSourceInput[] = [];
      if (toolCallTrace && toolCallTrace.length > 0) {
        const vCtx: VerificationContext = { sessionId, toolCallTrace, transcript: transcript ?? "" };
        const verifiers = [new StatisticalVerifier(), new RoleVerifier()];
        for (const structure of injectedStructures) {
          for (const v of verifiers) {
            try {
              const out = await v.verify(structure, vCtx);
              if (out.confidence > 0) { // skip neutral (非适用类型)
                verifierSources.push({
                  structureId: structure.id,
                  sourceName: v.name,
                  value: out.value,
                  confidence: out.confidence,
                  evidence: out.evidence,
                });
              }
            } catch {
              // 验证器失败隔离 — 不破坏融合
            }
          }
        }
      }
      const allSources = [...llmMarkerSources, ...(midSessionSources ?? []), ...verifierSources];
      if (allSources.length === 0) {
        // skip — no signal sources
      } else {
        // T6: 记录本轮融合的结构 (供关系图传播)
        const fusedThisRound: Array<{ id: string; oldConfidence: number; newConfidence: number }> = [];
        for (const structure of injectedStructures) {
          const sources = allSources.filter(s => s.structureId === structure.id);
          if (sources.length === 0) continue;
          const oldConfidence = structure.confidence;
          const fused = this.deps.fuser.fuse(sources);
          if (fused) {
            structure.confidence = fused.confidence;
            fusedCount++;
            createVersion(structure, "auto_refinement", [{
              type: "confidence_changed" as const,
              path: "/confidence",
              oldValue: oldConfidence,
              newValue: fused.confidence,
            }], `Fused confidence from ${sources.length} source(s)`, []);
            versionedCount++;
            if (this.deps.memory.saveProtoStructure) {
              await this.deps.memory.saveProtoStructure(structure);
            }
            fusedThisRound.push({ id: structure.id, oldConfidence, newConfidence: fused.confidence });
          }
        }

        // T6: 关系图置信度传播 (§3) — 融合后的 confidence 变化沿关系图传播到关联结构
        if (fusedThisRound.length > 0) {
          const allStructuresMap = new Map(injectedStructures.map(s => [s.id, s]));
          for (const { id: changedId, oldConfidence, newConfidence } of fusedThisRound) {
            const delta = newConfidence - oldConfidence;
            if (Math.abs(delta) < 0.001) continue;
            const propagated = fullPropagation(changedId, delta, allStructuresMap);
            for (const [affectedId, propDelta] of propagated) {
              if (affectedId === changedId) continue;
              const affected = allStructuresMap.get(affectedId);
              if (!affected) continue;
              const oldAffected = affected.confidence;
              affected.confidence = Math.max(0, Math.min(1, affected.confidence + propDelta));
              if (Math.abs(affected.confidence - oldAffected) > 0.001) {
                createVersion(affected, "auto_refinement", [{
                  type: "confidence_changed" as const,
                  path: "/confidence",
                  oldValue: oldAffected,
                  newValue: affected.confidence,
                }], `Propagation from ${changedId} (delta ${delta.toFixed(3)})`, []);
                versionedCount++;
                if (this.deps.memory.saveProtoStructure) {
                  await this.deps.memory.saveProtoStructure(affected);
                }
              }
            }
          }
        }
      }
    }

    // Phase 3 T10: applyProgress — 自动推断任务进度 (confidence < 0.7 不更新)
    if (transcript && this.deps.llm?.analyze) {
      try {
        const taskCtxResult = await this.deps.memory.getSlot("task_context");
        if (taskCtxResult.ok && taskCtxResult.value) {
          const taskCtx = taskCtxResult.value as TaskContext;
          const analysisResult = await this.deps.llm.analyze(
            `Analyze the following conversation transcript and infer task progress. ` +
            `Current task: "${taskCtx.name}" (phase: ${taskCtx.currentPhase}). ` +
            `Return ONLY valid JSON with this schema: ` +
            `{"newPhase": "<inferred phase or null>", "progressUpdate": "<summary or null>", ` +
            `"newSubtasks": ["<subtask>"], "completedSubtasks": ["<subtask>"], "confidence": <0.0-1.0>}\n\n` +
            `Transcript:\n${transcript.slice(0, 4000)}`,
          );
          if (analysisResult.ok) {
            const inferred: InferredProgress = JSON.parse(analysisResult.value);
            const { updated, applied } = applyProgress(taskCtx, inferred);
            if (applied) {
              await this.deps.memory.setSlot("task_context", updated);
            }
          }
        }
      } catch {
        // Progress inference failure is non-blocking
      }
    }

    return {
      ok: true,
      value: {
        lessonsWritten: lessonsFromSignals + lessonsFromTranscript,
        lessonsFromSignals,
        lessonsFromTranscript,
        structuresExtracted: extractedStructures,
        structureUsageCount,
        fusedCount,
        versionedCount,
      },
    };
  }

  // ---- 内部 ----

  private async saveProtoStructureCandidate(
    sessionId: string,
    candidate: { protoType: string; tentativeName: string; scenarioId: string; confidence: number; steps?: { position: number; action: string; agent?: string }[]; purpose?: string; severity?: string; definition?: string; behaviors?: string[] },
  ): Promise<Record<string, unknown>> {
    const amAvailable = await this.deps.memory.isAvailable();
    const structure: Record<string, unknown> = {
      id: `proto-${sessionId}-${Date.now()}`,
      protoType: candidate.protoType,
      tentativeName: candidate.tentativeName,
      scenarioId: candidate.scenarioId,
      confidence: candidate.confidence,
      observationsCount: 1,
      adoptionRate: 0,
      lifecycle: "hypothesized",
      relations: [],
      versionChain: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (candidate.protoType === "sequence" && candidate.steps) {
      structure.structure = { steps: candidate.steps };
      structure.function = { purpose: candidate.purpose ?? "", precondition: [], postcondition: [], failureModes: [] };
      structure.teleologicalMapping = [];
    }

    if (amAvailable) {
      await this.deps.memory.setSlot("proto_structure", structure);
    } else {
      this.deps.cache.set(`proto_structure_${structure.id}`, structure);
    }
    return structure;
  }

  private async persistSignals(sessionId: string, signals: PendingSignal[]): Promise<number> {
    const amAvailable = await this.deps.memory.isAvailable();
    let written = 0;

    for (const signal of signals) {
      const lesson: Record<string, unknown> = {
        type: signal.type,
        content: signal.detail,
        sessionId,
        timestamp: signal.timestamp,
        toolName: signal.toolName,
        // Phase 0: lesson schema 补全
        taskType: this.deps.currentTaskType ?? "unknown",
        domain: this.deps.currentDomain ?? "unknown",
      };

      if (amAvailable) {
        const result = await this.deps.memory.saveLesson(lesson);
        if (result.ok) written++;
      } else {
        // 降级: 写入 local-cache
        const cacheKey = `pending_lesson_${signal.id}`;
        this.deps.cache.set(cacheKey, lesson);
        written++;
      }
    }

    return written;
  }

  /** M6 Fix-4: 持久化 attentionRecords 到 AgentMemory slot */
  private async persistAttentionRecords(): Promise<void> {
    if (!this.deps.attentionRecords || this.deps.attentionRecords.size === 0) return;
    try {
      // 将 Map 序列化为可存储的数组格式
      const records = Array.from(this.deps.attentionRecords.entries()).map(
        ([structureId, record]) => {
          const r = record as unknown as Record<string, unknown>;
          const { structureId: _sid, ...rest } = r;
          return { structureId, ...rest };
        },
      );
      await this.deps.memory.setSlot("attention_records", {
        records,
        updatedAt: Date.now(),
      });
    } catch {
      // 持久化失败不阻塞 session_end
    }
  }

  private async writeLesson(sessionId: string, lesson: Record<string, unknown>): Promise<void> {
    const amAvailable = await this.deps.memory.isAvailable();
    const enriched = {
      ...lesson,
      sessionId,
      // Phase 0: lesson schema 补全
      taskType: lesson.taskType ?? this.deps.currentTaskType ?? "unknown",
      domain: lesson.domain ?? this.deps.currentDomain ?? "unknown",
    };
    if (amAvailable) {
      await this.deps.memory.saveLesson(enriched);
    } else {
      this.deps.cache.set(`pending_lesson_${Date.now()}`, enriched);
    }
  }
}
