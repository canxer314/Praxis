/**
 * session-end 测试 — M0
 *
 * 覆盖路径:
 *   - 正常: pendingSignals → 写入 lessons
 *   - 幂等: 同一 sessionId 重复调用 → 跳过
 *   - 空信号: 无 lesson 写入
 *   - AgentMemory 不可用: 降级到 local-cache
 *   - LLM transcript 分析 (可选)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionEndHandler } from "./session-end";
import type { M0Deps } from "./m0-deps";
import type { Result } from "./platform-adapter";
import type { PendingSignal } from "./cognitive/types";

function makeDeps(overrides: Partial<M0Deps> = {}): M0Deps {
  return {
    memory: {
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null } as Result<unknown>),
      setSlot: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      smartSearch: vi.fn().mockResolvedValue({ ok: true, value: [] } as Result<unknown[]>),
      saveLesson: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      isAvailable: vi.fn().mockResolvedValue(true),
    },
    cache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    },
    ...overrides,
  };
}

function makeSignal(overrides: Partial<PendingSignal> = {}): PendingSignal {
  return {
    id: "sig-1",
    type: "correction",
    sessionId: "session-1",
    timestamp: Date.now(),
    detail: "用户纠正了 API 调用方式",
    ...overrides,
  };
}

describe("SessionEndHandler (M0)", () => {
  let deps: M0Deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("处理 pendingSignals 并写入 lessons", async () => {
    const handler = new SessionEndHandler(deps);
    const signals = [makeSignal(), makeSignal({ id: "sig-2", type: "failure", detail: "工具调用失败" })];
    const result = await handler.handle("session-1", null, signals);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsWritten).toBe(2);
      expect(result.value.lessonsFromSignals).toBe(2);
      expect(result.value.lessonsFromTranscript).toBe(0);
    }
  });

  it("幂等去重 — 同一 sessionId 重复调用跳过", async () => {
    const handler = new SessionEndHandler(deps);
    const signals = [makeSignal()];
    await handler.handle("session-1", null, signals);
    const result = await handler.handle("session-1", null, signals);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsWritten).toBe(0);
    }
  });

  it("空信号返回 0 lessons", async () => {
    const handler = new SessionEndHandler(deps);
    const result = await handler.handle("empty", null, []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsWritten).toBe(0);
    }
  });

  it("AgentMemory 不可用时降级到 local-cache", async () => {
    deps.memory.isAvailable = vi.fn().mockResolvedValue(false);
    const cacheSet = vi.fn();
    deps.cache.set = cacheSet;

    const handler = new SessionEndHandler(deps);
    const signals = [makeSignal(), makeSignal({ id: "sig-2" })];
    const result = await handler.handle("degraded", null, signals);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsWritten).toBe(2);
    }
    expect(cacheSet).toHaveBeenCalledTimes(2);
  });

  it("LLM transcript 分析可附加额外 lessons", async () => {
    deps.llm = {
      analyzeTranscript: vi.fn().mockResolvedValue([
        { id: "e1", type: "insight", content: "LLM 发现的模式", confidence: 0.7 },
      ]),
    };
    deps.memory.saveLesson = vi.fn().mockResolvedValue({ ok: true } as Result<void>);

    const handler = new SessionEndHandler(deps);
    const signals = [makeSignal()];
    const result = await handler.handle("with-transcript", "完整对话记录...", signals);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lessonsFromSignals).toBe(1);
      expect(result.value.lessonsFromTranscript).toBe(1);
      expect(result.value.lessonsWritten).toBe(2);
    }
  });
});
