/**
 * SessionEndHandler — M0 重构
 *
 * 职责:
 *   - 收集 session 中的所有待处理学习信号
 *   - 每个信号写入 AgentMemory lesson
 *   - AgentMemory 不可用时降级到 local-cache
 *   - 可选: LLM transcript 分析 (analyzeTranscript)
 *
 * M4 将增加: TaskScheduler 决策 + 置信度融合 + ProtoStructure 提取。
 */

import type { Result } from "./platform-adapter";
import type { M0Deps } from "./m0-deps";
import type { PendingSignal } from "./cognitive/types";

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
  ): Promise<Result<{ lessonsWritten: number; lessonsFromSignals: number; lessonsFromTranscript: number; structuresExtracted: number }>> {
    // 幂等去重
    if (this.processed.has(sessionId)) {
      return { ok: true, value: { lessonsWritten: 0, lessonsFromSignals: 0, lessonsFromTranscript: 0, structuresExtracted: 0 } };
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

    // 3. ProtoStructure 提取 (M1 Step 4)
    let extractedStructures = 0;
    if (transcript && this.deps.llm?.extractProtoStructures) {
      try {
        const candidates = await this.deps.llm.extractProtoStructures(transcript);
        for (const c of candidates) {
          await this.saveProtoStructureCandidate(sessionId, c);
          extractedStructures++;
        }
      } catch {
        this.deps.logger?.warn("ProtoStructure extraction failed", { sessionId });
      }
    }

    return {
      ok: true,
      value: {
        lessonsWritten: lessonsFromSignals + lessonsFromTranscript,
        lessonsFromSignals,
        lessonsFromTranscript,
        structuresExtracted: extractedStructures,
      },
    };
  }

  // ---- 内部 ----

  private async saveProtoStructureCandidate(
    sessionId: string,
    candidate: { protoType: string; tentativeName: string; scenarioId: string; confidence: number; steps?: { position: number; action: string; agent?: string }[]; purpose?: string; severity?: string; definition?: string; behaviors?: string[] },
  ): Promise<void> {
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
  }

  private async persistSignals(sessionId: string, signals: PendingSignal[]): Promise<number> {
    const amAvailable = await this.deps.memory.isAvailable();
    let written = 0;

    for (const signal of signals) {
      const lesson = {
        type: signal.type,
        content: signal.detail,
        sessionId,
        timestamp: signal.timestamp,
        toolName: signal.toolName,
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
    if (amAvailable) {
      await this.deps.memory.saveLesson({ ...lesson, sessionId });
    } else {
      this.deps.cache.set(`pending_lesson_${Date.now()}`, { ...lesson, sessionId });
    }
  }
}
