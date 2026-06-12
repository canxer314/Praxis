/**
 * SessionEndHandler — Phase 1A
 *
 * 职责:
 *   - 分析 session transcript → 提取 LearningEvent[]
 *   - 幂等去重：同一 sessionId 只处理一次
 *   - 持久化学习事件到 AgentMemory（progress_log slot）
 *   - 写入失败时降级处理
 */

import { Result, LearningEvent } from "./platform-adapter";

// ---- 依赖注入 ----

export interface SessionEndDeps {
  setSlot: (name: string, data: unknown) => Promise<Result<void>>;
  analyzeTranscript: (transcript: string) => Promise<LearningEvent[]>;
}

// ---- SessionEndHandler ----

export class SessionEndHandler {
  private readonly setSlot: SessionEndDeps["setSlot"];
  private readonly analyzeTranscript: SessionEndDeps["analyzeTranscript"];
  private readonly processed = new Set<string>();

  constructor(deps: SessionEndDeps) {
    this.setSlot = deps.setSlot;
    this.analyzeTranscript = deps.analyzeTranscript;
  }

  async handle(
    sessionId: string,
    transcript: string,
  ): Promise<Result<{ learningEvents: LearningEvent[] }>> {
    // 幂等去重
    if (this.processed.has(sessionId)) {
      return { ok: true, value: { learningEvents: [] } };
    }
    this.processed.add(sessionId);

    // 提取学习事件
    const events = await this.analyzeTranscript(transcript);

    // 无事件 → 不写入
    if (events.length === 0) {
      return { ok: true, value: { learningEvents: [] } };
    }

    // 持久化
    const writeResult = await this.setSlot("progress_log", {
      sessionId,
      timestamp: new Date().toISOString(),
      events,
    });

    if (!writeResult.ok) {
      return {
        ok: false,
        error: {
          code: writeResult.error.code,
          message: `写入学习事件失败: ${writeResult.error.message}`,
        },
      };
    }

    return { ok: true, value: { learningEvents: events } };
  }
}
