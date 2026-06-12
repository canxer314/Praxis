/**
 * session-end 测试 — Phase 1A, TDD
 *
 * 覆盖路径:
 *   - 正常: 分析 transcript → 提取 LearningEvent[] → 写入 slot
 *   - 幂等: 同一 sessionId 重复调用 → 跳过
 *   - 空 transcript: 无事件返回
 *   - 写入失败: AgentMemory setSlot 失败 → 降级处理
 *   - 多条事件: 一次 session 产生多条学习
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionEndHandler, SessionEndDeps } from "./session-end";
import { Result, LearningEvent } from "./platform-adapter";

describe("SessionEndHandler", () => {
  let deps: SessionEndDeps;
  let setSlot: ReturnType<typeof vi.fn>;
  let analyzeTranscript: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setSlot = vi.fn().mockResolvedValue({ ok: true, value: undefined } as Result<void>);
    analyzeTranscript = vi.fn().mockResolvedValue([] as LearningEvent[]);
    deps = { setSlot, analyzeTranscript };
  });

  // ---- 正常路径 ----

  it("分析 transcript 并提取学习事件", async () => {
    const events: LearningEvent[] = [
      { id: "e1", type: "pattern", content: "使用 Result 类型", confidence: 0.9 },
      { id: "e2", type: "pitfall", content: "避免 any 类型", confidence: 0.85 },
    ];
    analyzeTranscript.mockResolvedValue(events);

    const handler = new SessionEndHandler(deps);
    const result = await handler.handle("session-1", "用户说：别用 any...");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.learningEvents).toHaveLength(2);
      expect(result.value.learningEvents![0].type).toBe("pattern");
      expect(result.value.learningEvents![1].type).toBe("pitfall");
    }
    // 验证 setSlot 被调用
    expect(setSlot).toHaveBeenCalled();
  });

  it("提取到的事件写入 AgentMemory", async () => {
    analyzeTranscript.mockResolvedValue([
      { id: "e1", type: "insight", content: "架构洞察", confidence: 0.7 },
    ]);

    const handler = new SessionEndHandler(deps);
    await handler.handle("s1", "transcript");

    expect(setSlot).toHaveBeenCalledWith(
      "progress_log",
      expect.objectContaining({ sessionId: "s1" }),
    );
  });

  // ---- 空 transcript ----

  it("空 transcript 返回空事件列表", async () => {
    analyzeTranscript.mockResolvedValue([]);

    const handler = new SessionEndHandler(deps);
    const result = await handler.handle("empty", "");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.learningEvents).toHaveLength(0);
    }
  });

  it("analyzeTranscript 返回空数组时不写入 AgentMemory", async () => {
    analyzeTranscript.mockResolvedValue([]);

    const handler = new SessionEndHandler(deps);
    await handler.handle("empty", "nothing to learn");

    // 无学习事件时不调用 setSlot（避免无效写入）
    expect(setSlot).not.toHaveBeenCalled();
  });

  // ---- 幂等性 ----

  it("同一 sessionId 第二次调用返回空事件（幂等）", async () => {
    analyzeTranscript.mockResolvedValue([
      { id: "e1", type: "pattern", content: "test", confidence: 0.8 },
    ]);

    const handler = new SessionEndHandler(deps);

    // 第一次
    const r1 = await handler.handle("dup", "transcript");
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value.learningEvents).toHaveLength(1);

    // 第二次——幂等跳过
    const r2 = await handler.handle("dup", "transcript");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.learningEvents).toHaveLength(0);

    // analyzeTranscript 只被调用一次
    expect(analyzeTranscript).toHaveBeenCalledTimes(1);
  });

  // ---- 写入失败 ----

  it("AgentMemory setSlot 失败时返回错误", async () => {
    analyzeTranscript.mockResolvedValue([
      { id: "e1", type: "pattern", content: "test", confidence: 0.8 },
    ]);
    setSlot.mockResolvedValue({
      ok: false,
      error: { code: "AGENTMEMORY_UNAVAILABLE", message: "写入超时" },
    } as Result<void>);

    const handler = new SessionEndHandler(deps);
    const result = await handler.handle("write-fail", "transcript");

    // 学习事件提取成功，但持久化失败
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENTMEMORY_UNAVAILABLE");
    }
  });
});
