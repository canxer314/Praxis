/**
 * Governor 集成测试 — M4 async + MetacognitiveEngine + InMemoryMemoryClient
 */

import { describe, it, expect } from "vitest";
import { Governor } from "./governor";
import { MetacognitiveEngine } from "./metacognitive-engine";
import { InMemoryMemoryClient } from "./inmemory-client";
import type { Correction, SessionContext } from "./types";

function makeCorrection(overrides: Partial<Correction> = {}): Correction {
  return {
    what: "used old API",
    correctedTo: "use new API instead",
    likelyRootCause: "API v2 migration",
    isNewKnowledge: true,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "int_test_session",
    hasExplicitRejection: false,
    taskType: "bug_fix",
    domain: "typescript",
    ...overrides,
  };
}

describe("Governor 集成 — 完整链路", () => {
  it("Governor + MetacognitiveEngine + InMemoryMemoryClient 正常初始化", () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_1", metacognitive);

    expect(governor.sessionId).toBe("int_session_1");
    expect(governor.getStats().decisionCount).toBe(0);
    expect(governor.getStats().bypassCount).toBe(0);
  });

  it("完整决策管道: mistake_correction → LEARN → execution_feedback", async () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_2", metacognitive);

    const correction = makeCorrection({ isNewKnowledge: true });
    const ctx = makeCtx({ hasExplicitRejection: true });

    const result = await governor.decide(correction, ctx);
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("LEARN");
    expect(d.routeTo).toBe("execution_feedback");
    expect(d.signalType).toBe("mistake_correction");
    expect(d.timing).toBe("IMMEDIATE");
    expect(d.confidence).toBeGreaterThan(0);
  });

  it("多信号连续决策 — 决策计数递增", async () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_3", metacognitive);

    const ctx = makeCtx({ hasExplicitRejection: true });

    for (let i = 0; i < 3; i++) {
      const result = await governor.decide(makeCorrection(), ctx);
      expect(result.ok).toBe(true);
      // 第一次 LEARN, 后续 SKIP (去重)
      if (i === 0) {
        expect(result.value!.action).toBe("LEARN");
      }
    }

    const stats = governor.getStats();
    expect(stats.decisionCount).toBe(3);
    expect(stats.bypassCount).toBe(0);
    expect(stats.sessionId).toBe("int_session_3");
  });

  it("isRealExperience 过滤 → 无效信号被 SKIP", async () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_4", metacognitive);

    const same = "identical text";
    const correction = makeCorrection({ what: same, correctedTo: same });
    const ctx = makeCtx();

    const result = await governor.decide(correction, ctx);
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("SKIP");
    expect(d.confidence).toBe(0);
    expect(d.routeTo).toBe("none");
  });

  it("不同信号类型的正确路由", async () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_5", metacognitive);
    const ctx = makeCtx({ hasExplicitRejection: true });

    // 注意: 每个 decide() 使用不同的 (what, correctedTo) 避免去重 SKIP
    const r1 = await governor.decide(
      makeCorrection({ what: "api v1", correctedTo: "api v2", isNewKnowledge: true }),
      ctx, "mistake_correction",
    );
    expect(r1.ok).toBe(true);
    expect(r1.value!.routeTo).toBe("execution_feedback");

    // preference_discovery → BATCH + null fused → deferred_queue
    const r2 = await governor.decide(
      makeCorrection({ what: "style old", correctedTo: "style new", isNewKnowledge: false }),
      ctx, "preference_discovery",
    );
    expect(r2.ok).toBe(true);
    // Without fused confidence, BATCH → DEFER, deferred_queue
    expect(r2.value!.routeTo).toBe("deferred_queue");

    const r3 = await governor.decide(
      makeCorrection({ what: "proc old", correctedTo: "proc new" }),
      ctx, "procedural_optimization",
    );
    expect(r3.ok).toBe(true);
    expect(r3.value!.routeTo).toBe("deferred_queue");
  });

  it("reset 后状态清零", async () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_6", metacognitive);

    await governor.decide(makeCorrection(), makeCtx({ hasExplicitRejection: true }));
    await governor.decide(makeCorrection(), makeCtx({ hasExplicitRejection: true }));
    expect(governor.getStats().decisionCount).toBe(2);

    governor.reset();
    expect(governor.getStats().decisionCount).toBe(0);
    expect(governor.getStats().bypassCount).toBe(0);
  });
});
