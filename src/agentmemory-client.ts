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

// ---- HTTP helpers ----

async function restGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`);
  return (await res.json()) as Record<string, unknown>;
}

async function restPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
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
};
