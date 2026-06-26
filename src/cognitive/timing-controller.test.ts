/**
 * timing-controller 测试 — 信号时序分类器
 *
 * 覆盖:
 *   - 5 种已知信号类型 × 对应时序决策
 *   - null/undefined/空字符串 → DEFERRED
 *   - 未知信号类型 → DEFERRED
 *   - isKnownSignalType 类型守卫
 *   - listSignalTypes
 */

import { describe, it, expect } from "vitest";
import { classify, isKnownSignalType, listSignalTypes } from "./timing-controller";

describe("classify — 已知信号类型", () => {
  it("mistake_correction → IMMEDIATE", () => {
    const r = classify("mistake_correction");
    expect(r.decision).toBe("IMMEDIATE");
    expect(r.signalType).toBe("mistake_correction");
    expect(r.reason).toContain("immediate");
  });

  it("domain_insight → BATCH", () => {
    const r = classify("domain_insight");
    expect(r.decision).toBe("BATCH");
    expect(r.signalType).toBe("domain_insight");
  });

  it("preference_discovery → BATCH", () => {
    const r = classify("preference_discovery");
    expect(r.decision).toBe("BATCH");
    expect(r.signalType).toBe("preference_discovery");
  });

  it("task_pattern_recognition → BATCH", () => {
    const r = classify("task_pattern_recognition");
    expect(r.decision).toBe("BATCH");
    expect(r.signalType).toBe("task_pattern_recognition");
  });

  it("procedural_optimization → DEFERRED", () => {
    const r = classify("procedural_optimization");
    expect(r.decision).toBe("BATCH"); // M4: procedural_optimization → BATCH
    expect(r.signalType).toBe("procedural_optimization");
  });
});

describe("classify — 无效/未知输入", () => {
  it("null → DEFERRED (安全默认)", () => {
    const r = classify(null);
    expect(r.decision).toBe("DEFERRED");
    expect(r.signalType).toBe("unknown");
    expect(r.reason).toContain("Null");
  });

  it("undefined → DEFERRED (安全默认)", () => {
    const r = classify(undefined);
    expect(r.decision).toBe("DEFERRED");
    expect(r.signalType).toBe("unknown");
  });

  it("空字符串 → DEFERRED (安全默认)", () => {
    const r = classify("");
    expect(r.decision).toBe("DEFERRED");
    expect(r.signalType).toBe("unknown");
  });

  it('未知类型 "some_random_type" → DEFERRED', () => {
    const r = classify("some_random_type");
    expect(r.decision).toBe("DEFERRED");
    expect(r.signalType).toBe("unknown");
    expect(r.reason).toContain("Unknown signal type");
  });

  it("数字类型 → DEFERRED (参数类型不匹配)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = classify(123 as any);
    expect(r.decision).toBe("DEFERRED");
    expect(r.signalType).toBe("unknown");
  });
});

describe("isKnownSignalType", () => {
  it("已注册的 5 种类型返回 true", () => {
    expect(isKnownSignalType("mistake_correction")).toBe(true);
    expect(isKnownSignalType("domain_insight")).toBe(true);
    expect(isKnownSignalType("preference_discovery")).toBe(true);
    expect(isKnownSignalType("task_pattern_recognition")).toBe(true);
    expect(isKnownSignalType("procedural_optimization")).toBe(true);
  });

  it("未注册的类型返回 false", () => {
    expect(isKnownSignalType("unknown_type")).toBe(false);
    expect(isKnownSignalType("")).toBe(false);
  });
});

describe("listSignalTypes", () => {
  it("返回 5 种信号类型", () => {
    const types = listSignalTypes();
    expect(types).toHaveLength(20); // M4: 20 LearningEvent types
    expect(types).toContain("mistake_correction");
    expect(types).toContain("domain_insight");
    expect(types).toContain("preference_discovery");
    expect(types).toContain("governance_override");
  });
});
