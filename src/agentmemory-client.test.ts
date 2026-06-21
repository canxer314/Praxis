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
