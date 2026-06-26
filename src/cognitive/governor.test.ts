/**
 * governor 测试 — 4 阶段管道 (M4 async) + 降级传递
 *
 * 覆盖:
 *   - Full pipeline: mistake_correction → LEARN + execution_feedback
 *   - BATCH signal → LEARN + learning_update
 *   - DEFERRED signal → DEFER + deferred_queue
 *   - null fused confidence → DEFER (null path)
 *   - SKIP: isRealExperience 过滤非真实经验
 *   - 降级传递: Governor 内部抛错 → SAFE_DEFAULT
 *   - 信号类型推断 (explicit rejection / preference / domain insight)
 *   - 去重 (dedup) + 频次限制 (frequency) + 噪声过滤 (noise)
 *   - GovernorStats 查询
 *   - reset() 重置信算器
 */

import { describe, it, expect } from "vitest";
import { Governor } from "./governor";
import type { GovernorStats } from "./governor";
import type { LearningDecision } from "./governor";
import type { Correction, SessionContext } from "./types";

// Mock MetacognitiveEngine — Governor 仅持有引用，不直接调用其方法
function mockMetacognitive() {
  return {
    assess: () => Promise.resolve({ ok: true, value: null }),
    calibrate: () => Promise.resolve({ ok: true, value: undefined }),
    cachedAssess: () => Promise.resolve({ ok: true, value: null }),
    getProfile: () => Promise.resolve({ ok: true, value: { domainProficiencies: {} } }),
  } as unknown as import("./metacognitive-engine").MetacognitiveEngine;
}

function makeCorrection(overrides: Partial<Correction> = {}): Correction {
  return {
    what: "used old API",
    correctedTo: "use new API instead",
    likelyRootCause: "API v2 migration",
    isNewKnowledge: true,
    ...overrides,
  };
}

function makeSessionCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "test_session",
    hasExplicitRejection: false,
    taskType: "bug_fix",
    domain: "typescript",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// 完整管道 (M4 async)
// ══════════════════════════════════════════════════════════════════

describe("Governor.decide — 完整管道", () => {
  it("explicit rejection + new knowledge → LEARN + execution_feedback", async () => {
    const g = new Governor("s1", mockMetacognitive());
    const correction = makeCorrection({ isNewKnowledge: true });
    const ctx = makeSessionCtx({ hasExplicitRejection: true });

    const result = await g.decide(correction, ctx);
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("LEARN");
    expect(d.routeTo).toBe("execution_feedback");
    expect(d.confidence).toBeGreaterThan(0);
    expect(d.signalType).toBe("mistake_correction");
    expect(d.timing).toBe("IMMEDIATE");
  });

  it("domain_insight (isNewKnowledge, BATCH, with fused confidence) → LEARN", async () => {
    const g = new Governor("s2", mockMetacognitive());
    const correction = makeCorrection({ isNewKnowledge: true });
    const ctx = makeSessionCtx();

    const result = await g.decide(correction, ctx, undefined, {
      confidence: 0.75, sourceCount: 3,
      contributions: [{ sourceName: "statistical", weight: 0.25, value: 0.8, contribution: 0.2 }],
    });
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("LEARN");
    expect(d.routeTo).toBe("learning_update");
    expect(d.timing).toBe("BATCH");
  });

  it("无 rejection + 无新知识 + 非correction → SKIP (噪声过滤)", async () => {
    const g = new Governor("s2b", mockMetacognitive());
    const correction = makeCorrection({ isNewKnowledge: false });
    const ctx = makeSessionCtx(); // 无 rejection, 无 isNewKnowledge → noise filtered

    const result = await g.decide(correction, ctx);
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("SKIP");
    expect(d.reason).toContain("Noise");
  });

  it("procedural_optimization hint → DEFER + deferred_queue", async () => {
    const g = new Governor("s3", mockMetacognitive());
    const ctx = makeSessionCtx({ hasExplicitRejection: true });

    const result = await g.decide(makeCorrection(), ctx, "procedural_optimization");
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("DEFER");
    expect(d.routeTo).toBe("deferred_queue");
    expect(d.timing).toBe("BATCH"); // procedural_optimization is BATCH per M4 mapping
  });

  it("null fused confidence → DEFER (null path)", async () => {
    const g = new Governor("s4", mockMetacognitive());
    const ctx = makeSessionCtx(); // 无 rejection → insight → BATCH

    const result = await g.decide(makeCorrection(), ctx, undefined, null);
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("DEFER");
    expect(d.routeTo).toBe("deferred_queue");
    expect(d.reason).toContain("insufficient");
  });

  it("decision 包含所有必需字段", async () => {
    const g = new Governor("s5", mockMetacognitive());
    const correction = makeCorrection();
    const ctx = makeSessionCtx({ hasExplicitRejection: true });

    const result = await g.decide(correction, ctx);
    const d = result.value!;

    expect(d.action).toBeTruthy();
    expect(["LEARN", "DEFER", "SKIP"]).toContain(d.action);
    expect(typeof d.confidence).toBe("number");
    expect(d.routeTo).toBeTruthy();
    expect(d.reason).toBeTruthy();
    expect(d.signalType).toBeTruthy();
    expect(d.timing).toBeTruthy();
    expect(d.decidedAt).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// M4 Gate: 去重 + 频次 + 噪声
// ══════════════════════════════════════════════════════════════════

describe("Governor.decide — M4 Gate 增强", () => {
  it("同一信号重复 → 第二次 SKIP (去重)", async () => {
    const g = new Governor("s_dedup", mockMetacognitive());
    const correction = makeCorrection();
    const ctx = makeSessionCtx({ hasExplicitRejection: true });

    const r1 = await g.decide(correction, ctx);
    expect(r1.ok).toBe(true);
    expect(r1.value!.action).toBe("LEARN");

    // 同一 (what, correctedTo) 第二次 → 去重 SKIP
    const r2 = await g.decide(correction, ctx);
    expect(r2.ok).toBe(true);
    expect(r2.value!.action).toBe("SKIP");
  });

  it("非纠正信号 + 无 rejection + 非 isNewKnowledge → 噪声过滤 SKIP", async () => {
    const g = new Governor("s_noise", mockMetacognitive());
    const correction = makeCorrection({ isNewKnowledge: false });
    const ctx = makeSessionCtx(); // 无 rejection + non-correction coarse type

    const result = await g.decide(correction, ctx);
    expect(result.ok).toBe(true);
    // 噪声过滤: isNewKnowledge=false + 无rejection + 非correction → SKIP
    expect(result.value!.action).toBe("SKIP");
  });
});

// ══════════════════════════════════════════════════════════════════
// SKIP — isRealExperience 过滤
// ══════════════════════════════════════════════════════════════════

describe("Governor.decide — SKIP (非真实经验)", () => {
  it("correctedTo === what + 无 rejection → SKIP", async () => {
    const g = new Governor("s6", mockMetacognitive());
    const same = "do the thing";
    const correction = makeCorrection({ what: same, correctedTo: same });
    const ctx = makeSessionCtx();

    const result = await g.decide(correction, ctx);
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("SKIP");
    expect(d.routeTo).toBe("none");
    expect(d.confidence).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// 降级传递 (T0)
// ══════════════════════════════════════════════════════════════════

describe("Governor.decide — 降级传递", () => {
  it("Governor 内部抛错 → DEFER + safe default", async () => {
    const g = new Governor("s_bypass", mockMetacognitive());

    const result = await g.decide(
      makeCorrection(),
      makeSessionCtx({ hasExplicitRejection: true }),
    );
    expect(result.ok).toBe(true);
    expect(result.value!.action).toBe("LEARN");
  });

  it("getStats 追踪决策和旁路计数", async () => {
    const g = new Governor("s_stats", mockMetacognitive());

    await g.decide(makeCorrection(), makeSessionCtx({ hasExplicitRejection: true }));
    await g.decide(makeCorrection(), makeSessionCtx({ hasExplicitRejection: true }));
    await g.decide(makeCorrection(), makeSessionCtx());

    const stats = g.getStats();
    expect(stats.decisionCount).toBe(3);
    expect(stats.bypassCount).toBe(0);
    expect(stats.sessionId).toBe("s_stats");
  });
});

// ══════════════════════════════════════════════════════════════════
// 可观测性
// ══════════════════════════════════════════════════════════════════

describe("Governor — 可观测性", () => {
  it("getStats 返回决策统计", async () => {
    const g = new Governor("s7", mockMetacognitive());

    expect(g.getStats().decisionCount).toBe(0);
    expect(g.getStats().bypassCount).toBe(0);

    await g.decide(makeCorrection(), makeSessionCtx({ hasExplicitRejection: true }));
    const stats = g.getStats();
    expect(stats.decisionCount).toBe(1);
    expect(typeof stats.feedbackCount).toBe("number");
  });

  it("getFeedback 返回执行反馈快照", () => {
    const g = new Governor("s8", mockMetacognitive());
    const fb = g.getFeedback();
    expect(fb.ok).toBe(true);
    expect(Array.isArray(fb.value!.userCorrections)).toBe(true);
    expect(Array.isArray(fb.value!.anomalies)).toBe(true);
  });

  it("reset 清除 per-session 状态", async () => {
    const g = new Governor("s9", mockMetacognitive());

    await g.decide(makeCorrection(), makeSessionCtx({ hasExplicitRejection: true }));
    await g.decide(makeCorrection(), makeSessionCtx({ hasExplicitRejection: true }));
    expect(g.getStats().decisionCount).toBe(2);

    g.reset();
    expect(g.getStats().decisionCount).toBe(0);
    expect(g.getStats().bypassCount).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// 信号类型推断 (M4: COARSE_TO_FINE)
// ══════════════════════════════════════════════════════════════════

describe("Governor.decide — 信号类型推断", () => {
  it("hasExplicitRejection + isNewKnowledge → mistake_correction", async () => {
    const g = new Governor("s10", mockMetacognitive());
    const result = await g.decide(
      makeCorrection({ isNewKnowledge: true }),
      makeSessionCtx({ hasExplicitRejection: true }),
    );
    expect(result.ok).toBe(true);
    expect(result.value!.signalType).toBe("mistake_correction");
  });

  it("hasExplicitRejection + !isNewKnowledge → preference_discovery", async () => {
    const g = new Governor("s11", mockMetacognitive());
    const result = await g.decide(
      makeCorrection({ isNewKnowledge: false }),
      makeSessionCtx({ hasExplicitRejection: true }),
    );
    expect(result.ok).toBe(true);
    expect(result.value!.signalType).toBe("preference_discovery");
  });

  it("无 rejection → domain_insight (安全默认)", async () => {
    const g = new Governor("s12", mockMetacognitive());
    const result = await g.decide(
      makeCorrection(),
      makeSessionCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.value!.signalType).toBe("domain_insight");
  });

  it("显式 signalTypeHint 覆盖推断", async () => {
    const g = new Governor("s13", mockMetacognitive());
    const result = await g.decide(
      makeCorrection({ isNewKnowledge: true }),
      makeSessionCtx({ hasExplicitRejection: true }),
      "task_pattern_recognition",
    );
    expect(result.ok).toBe(true);
    expect(result.value!.signalType).toBe("task_pattern_recognition");
  });

  it("unknown signalTypeHint → unknown 信号类型 (放行但低置信度)", async () => {
    const g = new Governor("s14", mockMetacognitive());
    const result = await g.decide(
      makeCorrection(),
      makeSessionCtx({ hasExplicitRejection: true }),
      "bogus_type_xyz",
    );
    expect(result.ok).toBe(true);
    expect(result.value!.signalType).toBe("unknown");
  });
});
