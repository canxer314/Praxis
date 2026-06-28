/**
 * InMemoryMemoryClient — 纯内存实现 (M9)
 *
 * 用于无 AgentMemory 环境的开发和测试。
 * 所有数据存储在进程内存中，进程重启后清空。
 *
 * @example
 * ```ts
 * import { CognitiveCore, InMemoryMemoryClient } from "@praxis/cognitive-core";
 *
 * const core = new CognitiveCore({ memoryClient: new InMemoryMemoryClient() });
 * const session = core.createSession("dev_session");
 * ```
 */

import type { Result } from "../platform-adapter";

/** Phase 11: Inlined from deleted cognitive-core.ts */
export interface CognitiveCoreMemoryClient {
  getSlot(name: string): Promise<Result<unknown>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
  smartSearch(query: string, opts?: { limit?: number }): Promise<Result<unknown[]>>;
  lessonSave(data: Record<string, unknown>): Promise<Result<unknown>>;
  lessonRecall(query: Record<string, unknown>): Promise<Result<unknown[]>>;
}

// ══════════════════════════════════════════════════════════════════
// InMemoryMemoryClient
// ══════════════════════════════════════════════════════════════════

export class InMemoryMemoryClient implements CognitiveCoreMemoryClient {
  private readonly slots = new Map<string, unknown>();
  private readonly lessons: Array<{
    type: string;
    tags: string[];
    content: string;
    timestamp: number;
  }> = [];

  // ---- MetacognitiveMemoryClient ----

  async getSlot(name: string): Promise<Result<unknown>> {
    if (!this.slots.has(name)) {
      return { ok: false, error: { code: "NOT_FOUND", message: `slot ${name} not found` } };
    }
    return { ok: true, value: this.slots.get(name) };
  }

  async setSlot(name: string, data: unknown): Promise<Result<void>> {
    this.slots.set(name, data);
    return { ok: true, value: undefined };
  }

  // ---- TaskAssessmentMemoryClient / LearningUpdateMemoryClient ----

  async smartSearch(
    query: string,
    opts?: { limit?: number },
  ): Promise<Result<unknown[]>> {
    const limit = opts?.limit ?? 5;
    const q = query.toLowerCase();

    const scored = this.lessons
      .map((l) => {
        const contentLower = l.content.toLowerCase();
        // 简单子串匹配评分
        let score = 0;
        if (contentLower.includes(q)) score = 0.9;
        else {
          // 分词匹配
          const qWords = q.split(/\s+/);
          const hits = qWords.filter((w) => contentLower.includes(w)).length;
          if (hits > 0) score = (hits / qWords.length) * 0.5;
        }
        return { content: l.content, score, source: "lesson" as const };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { ok: true, value: scored as unknown[] };
  }

  async lessonSave(data: Record<string, unknown>): Promise<Result<unknown>> {
    this.lessons.push({
      type: String(data.type || "episode"),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      content: String(data.content || ""),
      timestamp: Date.now(),
    });
    return { ok: true, value: undefined };
  }

  // ---- E5: CrossDomainMemoryClient ----

  async lessonRecall(_query: Record<string, unknown>): Promise<Result<unknown[]>> {
    // 返回所有 lessons（简化实现：忽略 query 过滤）
    const results = this.lessons.map((l) => ({
      content: l.content,
      type: l.type,
      tags: l.tags,
      timestamp: l.timestamp,
    }));
    return { ok: true, value: results as unknown[] };
  }
}
