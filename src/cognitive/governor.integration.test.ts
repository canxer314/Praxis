/**
 * Governor 集成测试 — Governor → delegates → InMemoryMemoryClient 端到端
 *
 * 覆盖:
 *   1. Governor + MetacognitiveEngine + InMemoryMemoryClient 完整链路
 *   2. decide() → classify → gate → decide → 验证决策正确性
 *   3. 多信号连续决策 — 决策计数递增
 *   4. isRealExperience 过滤 — 无效信号被 SKIP
 *   5. 降级恢复 — Governor 统计数据完整性
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
    sessionId: "integration_test",
    hasExplicitRejection: false,
    taskType: "bug_fix",
    domain: "typescript",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// 集成测试: Governor → MetacognitiveEngine → InMemoryMemoryClient
// ══════════════════════════════════════════════════════════════════

describe("Governor 集成 — 完整链路", () => {
  it("Governor + MetacognitiveEngine + InMemoryMemoryClient 正常初始化", () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_1", metacognitive);

    expect(governor.sessionId).toBe("int_session_1");
    expect(governor.getStats().decisionCount).toBe(0);
    expect(governor.getStats().bypassCount).toBe(0);
  });

  it("完整决策管道: mistake_correction → LEARN → execution_feedback", () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_2", metacognitive);

    const correction = makeCorrection({ isNewKnowledge: true });
    const ctx = makeCtx({ hasExplicitRejection: true });

    const result = governor.decide(correction, ctx);
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("LEARN");
    expect(d.routeTo).toBe("execution_feedback");
    expect(d.signalType).toBe("mistake_correction");
    expect(d.timing).toBe("IMMEDIATE");
    expect(d.confidence).toBeGreaterThan(0);
  });

  it("多信号连续决策 — 决策计数递增", () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_3", metacognitive);

    const correction = makeCorrection();
    const ctx = makeCtx({ hasExplicitRejection: true });

    // 3 次连续决策
    for (let i = 0; i < 3; i++) {
      const result = governor.decide(correction, ctx);
      expect(result.ok).toBe(true);
      expect(result.value!.action).toBe("LEARN");
    }

    const stats = governor.getStats();
    expect(stats.decisionCount).toBe(3);
    expect(stats.bypassCount).toBe(0);
    expect(stats.sessionId).toBe("int_session_3");
  });

  it("isRealExperience 过滤 → 无效信号被 SKIP", () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_4", metacognitive);

    // 信号没有任何修正内容 (what === correctedTo, 无 rejection)
    const same = "identical text";
    const correction = makeCorrection({ what: same, correctedTo: same });
    const ctx = makeCtx(); // 无 rejection

    const result = governor.decide(correction, ctx);
    expect(result.ok).toBe(true);

    const d = result.value!;
    expect(d.action).toBe("SKIP");
    expect(d.confidence).toBe(0);
    expect(d.routeTo).toBe("none");
  });

  it("不同信号类型的正确路由", () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_5", metacognitive);
    const ctx = makeCtx({ hasExplicitRejection: true });

    // 显式纠正 → IMMEDIATE → execution_feedback
    const r1 = governor.decide(
      makeCorrection({ isNewKnowledge: true }),
      ctx,
      "mistake_correction",
    );
    expect(r1.value!.routeTo).toBe("execution_feedback");

    // 偏好发现 → BATCH → learning_update
    const r2 = governor.decide(
      makeCorrection({ isNewKnowledge: false }),
      ctx,
      "preference_discovery",
    );
    expect(r2.value!.routeTo).toBe("learning_update");

    // 流程优化 → DEFERRED → deferred_queue
    const r3 = governor.decide(
      makeCorrection(),
      ctx,
      "procedural_optimization",
    );
    expect(r3.value!.routeTo).toBe("deferred_queue");
  });

  it("reset 后状态清零", () => {
    const memory = new InMemoryMemoryClient();
    const metacognitive = new MetacognitiveEngine(memory);
    const governor = new Governor("int_session_6", metacognitive);

    governor.decide(makeCorrection(), makeCtx({ hasExplicitRejection: true }));
    governor.decide(makeCorrection(), makeCtx({ hasExplicitRejection: true }));
    expect(governor.getStats().decisionCount).toBe(2);

    governor.reset();
    expect(governor.getStats().decisionCount).toBe(0);
    expect(governor.getStats().bypassCount).toBe(0);

    // Reset 后仍可正常决策
    const result = governor.decide(makeCorrection(), makeCtx({ hasExplicitRejection: true }));
    expect(result.ok).toBe(true);
    expect(result.value!.action).toBe("LEARN");
    expect(governor.getStats().decisionCount).toBe(1);
  });
});
