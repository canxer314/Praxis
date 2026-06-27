/**
 * proto-task-learner.test.ts — T14: ProtoTask 累积更新测试
 *
 * 覆盖:
 *   - growConfidence: 对数成长公式验证
 *   - extractTaskType: lesson 字段提取
 *   - accumulateProtoTask: 数据不足守卫 (< 3 observations)
 *   - accumulateProtoTask: 负数 observations 守卫
 */

import { describe, it, expect, vi } from "vitest";
import { growConfidence, extractTaskType, accumulateProtoTask, type ProtoTask } from "./proto-task-learner";
import type { MemorySubsystem, LLMSubsystem } from "../m0-deps";

describe("growConfidence — 对数成长公式", () => {
  it("N=0 → confidence=0.20", () => {
    expect(growConfidence(0)).toBeCloseTo(0.20, 2);
  });

  it("N=1 → confidence≈0.35", () => {
    expect(growConfidence(1)).toBeCloseTo(0.35, 2);
  });

  it("N=3 → confidence≈0.50", () => {
    expect(growConfidence(3)).toBeCloseTo(0.50, 2);
  });

  it("N=5 → confidence≈0.59", () => {
    expect(growConfidence(5)).toBeCloseTo(0.59, 2);
  });

  it("N=10 → confidence≈0.72", () => {
    expect(growConfidence(10)).toBeCloseTo(0.72, 2);
  });

  it("N=15 → confidence≈0.80", () => {
    expect(growConfidence(15)).toBeCloseTo(0.80, 2);
  });

  it("N=31 → confidence≈0.95 (上限)", () => {
    expect(growConfidence(31)).toBeCloseTo(0.95, 2);
  });

  it("大 N → 不超过 0.95", () => {
    expect(growConfidence(1000)).toBeLessThanOrEqual(0.95);
  });

  it("confidence 永不低于 0.2", () => {
    expect(growConfidence(-5)).toBe(0.2);
  });

  it("单调递增", () => {
    const values = [0, 1, 2, 3, 4, 5, 10, 20].map(growConfidence);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] - 0.001); // float tolerance
    }
  });
});

describe("extractTaskType", () => {
  it("从 taskType 字段提取", () => {
    expect(extractTaskType({ taskType: "code_review" })).toBe("code_review");
  });

  it("fallback 到 type 字段", () => {
    expect(extractTaskType({ type: "correction" })).toBe("correction");
  });

  it("无匹配字段 → 'unknown'", () => {
    expect(extractTaskType({ content: "something" })).toBe("unknown");
  });
});

describe("accumulateProtoTask — 数据不足守卫", () => {
  function makeMemory(sessions: number): MemorySubsystem {
    const items = Array.from({ length: sessions }, (_, i) => ({
      taskType: "code_review",
      sessionId: `session-${i}`,
      phaseDurations: { review: 15 },
      pitfallHits: {},
      userSatisfaction: 0.8,
    }));
    return {
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null }),
      setSlot: vi.fn().mockResolvedValue({ ok: true }),
      smartSearch: vi.fn().mockResolvedValue({ ok: true, value: items }),
      saveLesson: vi.fn().mockResolvedValue({ ok: true }),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
  }

  function makeLlm(): LLMSubsystem {
    return {
      analyze: vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify({
        typicalPhases: [],
        commonPitfalls: [],
        confidenceAdjustment: 0.05,
        structuralChanges: [],
      }) }),
      analyzeTranscript: vi.fn(),
      extractProtoStructures: vi.fn(),
    };
  }

  it("< 3 observations → 仅统计更新，不调 LLM", async () => {
    const memory = makeMemory(2);
    const llm = makeLlm();
    const current: ProtoTask = {
      taskType: "code_review",
      confidence: 0.3,
      source: "bootstrap",
      typicalPhases: [],
      commonPitfalls: [],
      observations: 1,
      generatedAt: Date.now(),
    };

    const result = await accumulateProtoTask("code_review", llm, memory, current);
    expect(result).not.toBeNull();
    expect(result!.observations).toBe(2);
    expect(result!.confidence).toBeCloseTo(growConfidence(2), 2);
    // LLM analyze should NOT have been called (< 3 observations)
    expect(llm.analyze).not.toHaveBeenCalled();
  });

  it("< 3 observations 且无 currentTask → null", async () => {
    const memory = makeMemory(1);
    const llm = makeLlm();
    const result = await accumulateProtoTask("code_review", llm, memory);
    expect(result).toBeNull();
  });

  it("空 taskType → null", async () => {
    const result = await accumulateProtoTask("", makeLlm(), makeMemory(0));
    expect(result).toBeNull();
  });

  it("无 llm → null", async () => {
    const result = await accumulateProtoTask("test", null as unknown as LLMSubsystem, makeMemory(0));
    expect(result).toBeNull();
  });

  it("smartSearch 失败 → null (不崩溃)", async () => {
    const memory = makeMemory(0);
    memory.smartSearch = vi.fn().mockRejectedValue(new Error("connection lost"));
    const result = await accumulateProtoTask("test", makeLlm(), memory);
    expect(result).toBeNull();
  });
});
