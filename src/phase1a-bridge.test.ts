/**
 * phase1a-bridge 测试 — 纯函数
 *
 * 覆盖:
 *   - computeShadowStats: 正常数据 → 统计输出
 *   - computeShadowStats: 空输入 → 零计数
 *   - computeShadowStats: 损坏行 → 跳过 + 计数
 *   - computeShadowStats: 全部损坏 → 0 valid + N skipped
 */

import { describe, it, expect } from "vitest";
import { computeShadowStats } from "./phase1a-bridge";

const VALID_LINE = JSON.stringify({
  sessionId: "sess_001",
  timestamp: "2026-06-23T00:00:00.000Z",
  action: "LEARN",
  confidence: 0.7,
  routeTo: "execution_feedback",
  signalType: "mistake_correction",
  timing: "IMMEDIATE",
  isNewKnowledge: true,
  matchedKeyword: "不对",
  contentPreview: "不对，应该用POST",
});

const VALID_LINE_2 = JSON.stringify({
  sessionId: "sess_001",
  timestamp: "2026-06-23T00:01:00.000Z",
  action: "LEARN",
  confidence: 0.5,
  routeTo: "learning_update",
  signalType: "preference_discovery",
  timing: "BATCH",
  isNewKnowledge: false,
  matchedKeyword: "不是",
  contentPreview: "不是这个意思",
});

const VALID_LINE_SESS_2 = JSON.stringify({
  sessionId: "sess_002",
  timestamp: "2026-06-23T01:00:00.000Z",
  action: "DEFER",
  confidence: 0.3,
  routeTo: "deferred_queue",
  signalType: "unknown",
  timing: "DEFERRED",
  isNewKnowledge: false,
  matchedKeyword: "搞错了",
  contentPreview: "我搞错了",
});

describe("computeShadowStats", () => {
  it("正常 JSONL → 统计输出", () => {
    const stats = computeShadowStats([VALID_LINE, VALID_LINE_2, VALID_LINE_SESS_2]);

    expect(stats.totalDecisions).toBe(3);
    expect(stats.sessionCount).toBe(2); // sess_001 + sess_002
    expect(stats.skippedLines).toBe(0);

    expect(stats.byAction["LEARN"]).toBe(2);
    expect(stats.byAction["DEFER"]).toBe(1);

    expect(stats.bySignal["mistake_correction"]).toBe(1);
    expect(stats.bySignal["preference_discovery"]).toBe(1);
    expect(stats.bySignal["unknown"]).toBe(1);

    expect(stats.byIsNewKnowledge.true).toBe(1);
    expect(stats.byIsNewKnowledge.false).toBe(2);

    expect(stats.byRouteTo["execution_feedback"]).toBe(1);
    expect(stats.byRouteTo["learning_update"]).toBe(1);
    expect(stats.byRouteTo["deferred_queue"]).toBe(1);
  });

  it("空输入 → 零计数", () => {
    const stats = computeShadowStats([]);

    expect(stats.totalDecisions).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expect(stats.skippedLines).toBe(0);
    expect(Object.keys(stats.byAction).length).toBe(0);
  });

  it("损坏行 → 跳过 + 计入 skippedLines", () => {
    const lines = [
      VALID_LINE,
      "{broken json",
      VALID_LINE_2,
      "",
      "  ",
    ];

    const stats = computeShadowStats(lines);

    expect(stats.totalDecisions).toBe(2);
    expect(stats.skippedLines).toBe(1); // "{broken json" only (empty/whitespace lines skipped)
  });

  it("全部损坏 → 0 valid + N skipped", () => {
    const lines = ["not json", "{also broken", "still broken"];

    const stats = computeShadowStats(lines);

    expect(stats.totalDecisions).toBe(0);
    expect(stats.sessionCount).toBe(0);
    expect(stats.skippedLines).toBe(3);
  });
});
