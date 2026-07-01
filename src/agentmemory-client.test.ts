/**
 * AgentMemory REST API 客户端测试
 *
 * 测试 saveLessonDeduped 的去重逻辑（通过 mock fetch），
 * 不依赖真实的 AgentMemory 服务。
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { agentmemory } from "./agentmemory-client";

describe("agentmemory.saveLessonDeduped", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("已有相似 lesson (score > 0.7) 时调用 strengthen", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ lessons: [{ id: "lsn_existing", score: 0.85 }] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true }),
      });

    const result = await agentmemory.saveLessonDeduped("test content", ["test"], 0.8);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("strengthened");
      expect(result.value.id).toBe("lsn_existing");
    }
  });

  it("无匹配 lesson 时创建新 lesson", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ lessons: [] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true, lesson: { id: "lsn_new" } }),
      });

    const result = await agentmemory.saveLessonDeduped("new content", ["test"], 0.8);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("created");
      expect(result.value.id).toBe("lsn_new");
    }
  });

  it("score <= 0.7 时不走 strengthen，走创建", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ lessons: [{ id: "lsn_low", score: 0.5 }] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true, lesson: { id: "lsn_new_2" } }),
      });

    const result = await agentmemory.saveLessonDeduped("low match", ["test"], 0.8);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("created");
    }
  });

  it("strengthen API 失败时返回错误", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ lessons: [{ id: "lsn_existing", score: 0.85 }] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: false, error: "strengthen failed" }),
      });

    const result = await agentmemory.saveLessonDeduped("test content", ["test"], 0.8);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("strengthen failed");
    }
  });

  it("create API 失败时返回错误", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ lessons: [] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: false, error: "create failed" }),
      });

    const result = await agentmemory.saveLessonDeduped("new content", ["test"], 0.8);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("create failed");
    }
  });

  it("网络错误时返回错误", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await agentmemory.saveLessonDeduped("fail", [], 0.8);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("network error");
    }
  });

  it("搜索 API 返回空 lessons 字段时走创建", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({}), // 没有 lessons 字段
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true, lesson: { id: "lsn_new_3" } }),
      });

    const result = await agentmemory.saveLessonDeduped("edge case", [], 0.8);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("created");
    }
  });
});

describe("agentmemory.searchLessons", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("正常返回 lessons 列表", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        lessons: [
          { id: "l1", content: "lesson one", confidence: 0.9, tags: ["praxis"], source: "manual" },
          { id: "l2", content: "lesson two", confidence: 0.3, tags: [], source: "auto" },
        ],
      }),
    });

    const result = await agentmemory.searchLessons("*", 50, 0.5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(1); // only confidence >= 0.5
      expect(result.value[0].content).toBe("lesson one");
    }
  });

  it("minConfidence 过滤低分 lessons", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        lessons: [
          { id: "l1", content: "high", confidence: 0.95, tags: [], source: "" },
          { id: "l2", content: "low", confidence: 0.2, tags: [], source: "" },
          { id: "l3", content: "mid", confidence: 0.6, tags: [], source: "" },
        ],
      }),
    });

    const result = await agentmemory.searchLessons("*", 50, 0.5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(2); // 0.95 and 0.6 pass
    }
  });

  it("网络错误时返回 error Result", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await agentmemory.searchLessons("*", 10, 0.5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENTMEMORY_ERROR");
    }
  });

  it("limit 参数控制返回数量", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `l${i}`, content: `lesson ${i}`, confidence: 0.8, tags: [], source: "",
    }));
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ lessons: items }),
    });

    const result = await agentmemory.searchLessons("*", 5, 0.5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(5);
    }
  });

  it("API 返回空数组时返回 ok+空数组", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ lessons: [] }),
    });

    const result = await agentmemory.searchLessons("nonexistent", 50, 0.5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });
});
