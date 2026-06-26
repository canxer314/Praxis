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
import type { PendingSignal, ProtoStructure, SignalSourceInput } from "./cognitive/types";
import { extractUsageMarkers, updateAttention } from "./attention-telemetry";
import { parsePredictionMarkers } from "./orchestration/prediction-protocol";
import { createVersion } from "./structure-version";

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
    // 合并 llm_marker + mid_session 两类信号源
    if (this.deps.fuser && injectedStructures && injectedStructures.length > 0) {
      const allSources = [...llmMarkerSources, ...(midSessionSources ?? [])];
      if (allSources.length === 0) {
        // skip — no signal sources
      } else {
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
          }
        }
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
