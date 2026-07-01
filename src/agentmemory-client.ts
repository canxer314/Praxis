/**
 * AgentMemory REST API 客户端
 *
 * 直接 HTTP 调用 AgentMemory REST API（http://localhost:3111），
 * 不通过 MCP spawn — 零启动开销，单次调用 < 50ms。
 *
 * 端点：
 *   GET  /agentmemory/slot?label=xxx     — 读取 slot
 *   POST /agentmemory/slot               — 创建 slot
 *   POST /agentmemory/slot/replace       — 覆盖 slot
 *   POST /agentmemory/smart-search       — 语义搜索（观察 + lessons）
 *   POST /agentmemory/lessons            — 保存 lesson
 *   POST /agentmemory/lessons/search     — 语义搜索 lessons
 *   GET  /agentmemory/livez              — 健康检查
 */

import { Result } from "./platform-adapter";

const BASE = process.env.AGENTMEMORY_URL || "http://localhost:3111";

// ---- HTTP helpers (E13: 5s timeout guards) ----

const FETCH_TIMEOUT_MS = 5000;

async function restGet(path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function restPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

// ---- 健康检查缓存 ----

let _available: boolean | null = null;
let _lastCheck = 0;

// ---- 公开 API ----

export const agentmemory = {
  /** 读取 slot */
  async getSlot(name: string): Promise<Result<unknown>> {
    try {
      const data = await restGet(`/agentmemory/slot?label=${encodeURIComponent(name)}`);
      if (!data.success) {
        return { ok: false, error: { code: "NOT_FOUND", message: String(data.error || "slot not found") } };
      }
      const slot = data.slot as { content?: string } | undefined;
      const raw = slot?.content || "";
      if (!raw) return { ok: false, error: { code: "EMPTY", message: "slot content is empty" } };
      try { return { ok: true, value: JSON.parse(raw) }; }
      catch { return { ok: true, value: raw }; }
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  /** 写入 slot（自动 create-or-replace） */
  async setSlot(name: string, content: unknown): Promise<Result<void>> {
    const contentStr = typeof content === "string" ? content : JSON.stringify(content);
    try {
      // 先尝试 replace
      let data = await restPost("/agentmemory/slot/replace", { label: name, content: contentStr });
      if (!data.success && String(data.error || "").includes("not found")) {
        // slot 不存在 → 创建
        data = await restPost("/agentmemory/slot", { label: name, content: contentStr });
      }
      if (!data.success) {
        return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(data.error || "unknown error") } };
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  /**
   * Phase 1B: 语义搜索 lessons（独立端点，返回 lessons 而非 observations）
   * 用于 bootstrap 从已有 lessons 合成 competency_model
   */
  async searchLessons(
    query = "*",
    limit = 50,
    minConfidence = 0.5,
  ): Promise<Result<Array<{ content: string; confidence: number; tags: string[]; source: string }>>> {
    try {
      const data = await restPost("/agentmemory/lessons/search", {
        query,
        limit,
      });
      const lessons = (data.lessons as Array<Record<string, unknown>>) || [];
      const filtered = lessons
        .filter(l => (typeof l.confidence === "number" ? l.confidence : 0) >= minConfidence)
        .map(l => ({
          content: String(l.content || ""),
          confidence: Number(l.confidence ?? 0.5),
          tags: Array.isArray(l.tags) ? l.tags.map(String) : [],
          source: String(l.source || "agentmemory"),
        }))
        .slice(0, limit);
      return { ok: true, value: filtered };
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  /** 语义搜索（观察 + lessons） */
  async smartSearch(
    query: string,
    limit = 5,
  ): Promise<Array<{ content: string; score: number; source: "observation" | "lesson" }>> {
    try {
      const data = await restPost("/agentmemory/smart-search", {
        query,
        limit,
        includeLessons: "true",
      });
      const results: Array<{ content: string; score: number; source: "observation" | "lesson" }> = [];

      for (const r of (data.results as Array<Record<string, unknown>>) || []) {
        results.push({
          content: String(r.title || r.content || ""),
          score: Number(r.score || 0),
          source: "observation" as const,
        });
      }
      for (const l of (data.lessons as Array<Record<string, unknown>>) || []) {
        results.push({
          content: String(l.content || ""),
          score: Number(l.score || 0),
          source: "lesson" as const,
        });
      }
      return results.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch {
      return [];
    }
  },

  /** 保存单条 lesson（跨会话语义可检索） */
  async saveLesson(content: string, tags: string[] = [], confidence = 0.8): Promise<Result<void>> {
    try {
      const data = await restPost("/agentmemory/lessons", {
        content,
        tags: ["praxis", ...tags],
        confidence,
        source: "praxis-phase1a",
      });
      if (!data.success) {
        return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(data.error || "unknown error") } };
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  /**
   * 去重保存 lesson — 先语义搜索已有 lessons，
   * 若最佳匹配 score > 0.7 则调用 strengthen 强化，否则创建新 lesson。
   * 返回 { created | strengthened, id? }
   */
  async saveLessonDeduped(
    content: string,
    tags: string[] = [],
    confidence = 0.8,
  ): Promise<Result<{ action: "created" | "strengthened"; id?: string }>> {
    try {
      // 搜索已有 lessons，用 content 自身作为查询
      const searchData = await restPost("/agentmemory/lessons/search", {
        query: content,
        limit: 1,
      });
      const existing = (searchData.lessons as Array<{ id: string; score: number }>) || [];
      if (existing.length > 0 && existing[0].score > 0.7) {
        // 去重：强化已有 lesson
        const strengthenData = await restPost("/agentmemory/lessons/strengthen", {
          lessonId: existing[0].id,
          confidence,
          source: "praxis-phase1a",
        });
        if (!strengthenData.success) {
          return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(strengthenData.error || "strengthen failed") } };
        }
        return { ok: true, value: { action: "strengthened", id: existing[0].id } };
      }

      // 没有匹配 → 创建新 lesson
      const data = await restPost("/agentmemory/lessons", {
        content,
        tags: ["praxis", ...tags],
        confidence,
        source: "praxis-phase1a",
      });
      if (!data.success) {
        return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(data.error || "create failed") } };
      }
      const lesson = data.lesson as { id?: string } | undefined;
      return { ok: true, value: { action: "created", id: lesson?.id } };
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  /** 健康检查（带 30s 缓存） */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (_available !== null && now - _lastCheck < 30_000) return _available;
    try {
      const data = await restGet("/agentmemory/livez");
      _available = data.status === "ok";
    } catch {
      _available = false;
    }
    _lastCheck = now;
    return _available;
  },

  /** 保存 ProtoStructure (architecture §9: memory_save type="proto_structure") */
  async saveProtoStructure(structure: Record<string, unknown>): Promise<Result<void>> {
    try {
      const data = await restPost("/agentmemory/memory", {
        type: "proto_structure",
        content: JSON.stringify(structure),
        tags: ["praxis", "proto_structure", String(structure.protoType || "")],
      });
      if (!data.success) {
        return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(data.error || "unknown") } };
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  /** 搜索 ProtoStructures (architecture §9: memory_smart_search) */
  async searchProtoStructures(query: string, scenarioId?: string, limit = 20): Promise<Result<Record<string, unknown>[]>> {
    try {
      const body: Record<string, unknown> = {
        query: query || "*",
        types: ["proto_structure"],
        limit,
      };
      if (scenarioId) body.scenarioId = scenarioId;

      const data = await restPost("/agentmemory/smart-search", body);
      if (!data.success) {
        return { ok: false, error: { code: "SEARCH_ERROR", message: String(data.error || "unknown") } };
      }
      const results = (data.results as Array<Record<string, unknown>>) || [];
      return {
        ok: true,
        value: results.map((r) => {
          try { return typeof r.content === "string" ? JSON.parse(r.content) : r; }
          catch { return r; }
        }),
      };
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },
};
