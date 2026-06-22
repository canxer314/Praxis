/**
 * context + gap-detector 测试 — MED-5 + MED-6
 */

import { describe, it, expect, vi } from "vitest";
import { buildContextInjection } from "./context";
import type { BuildContextInput } from "./context";
import { GapDetector } from "./gap-detector";
import { MetacognitiveEngine } from "./metacognitive-engine";
import { InMemoryMemoryClient } from "./inmemory-client";
import type { EpisodicMemory, KnowledgeGap, MetacognitiveProfile } from "./types";
import type { Result } from "../platform-adapter";

describe("buildContextInjection", () => {
  function makeEpisodic(overrides: Partial<EpisodicMemory> = {}): EpisodicMemory {
    return {
      memoryId: "ep_001",
      agentId: "praxis",
      timestamp: Date.now(),
      context: { taskType: "bug_fix", domain: "typescript" },
      observation: {
        situation: "修 bug 时用了旧 API",
        action: "使用了 deprecated method",
        outcome: "用户修正为 new API v2",
        correction: "use new API v2",
      },
      signals: { wasCorrected: true, userSatisfied: false },
      ...overrides,
    };
  }

  it("memoryAvailable=false → 返回降级注入 (tier C)", () => {
    const result = buildContextInjection({
      episodic: [makeEpisodic()],
      memoryAvailable: false,
    });
    expect(result.tier).toBe("C");
    expect(result.systemPromptAddition).toContain("记忆离线");
  });

  it("总结果 < 2 → 返回空注入", () => {
    const result = buildContextInjection({
      episodic: [makeEpisodic()],
      memoryAvailable: true,
    });
    expect(result.systemPromptAddition).toBe("");
    expect(result.tier).toBe("C");
  });

  it("有 frequentPitfalls → tier A, 优先输出", () => {
    const result = buildContextInjection({
      episodic: [makeEpisodic(), makeEpisodic()],
      frequentPitfalls: ["别用 any 类型", "避免深层嵌套"],
      memoryAvailable: true,
    });
    expect(result.tier).toBe("A");
    expect(result.systemPromptAddition).toContain("已知陷阱");
    expect(result.systemPromptAddition).toContain("别用 any 类型");
  });

  it("有 knowledgeGaps → 输出缺口区块", () => {
    const gaps: KnowledgeGap[] = [
      { topic: "async generators", context: "内存溢出", resolved: false, detectedAt: "user_reported" },
    ];
    const result = buildContextInjection({
      episodic: [makeEpisodic(), makeEpisodic()],
      openGaps: gaps,
      memoryAvailable: true,
    });
    expect(result.systemPromptAddition).toContain("知识缺口");
    expect(result.systemPromptAddition).toContain("async generators");
  });

  it("token budget 限制输出不超预算", () => {
    const manyEpisodic = Array.from({ length: 10 }, (_, i) =>
      makeEpisodic({ memoryId: `ep_${i}` })
    );
    const result = buildContextInjection({
      episodic: manyEpisodic,
      tokenBudget: 100,
      memoryAvailable: true,
    });
    // Estimated tokens should be ≤ 100
    expect(result.tokenCount).toBeLessThanOrEqual(100);
  });

  it("CJK 文本 token 估算正确", () => {
    const result = buildContextInjection({
      episodic: [makeEpisodic(), makeEpisodic()],
      frequentPitfalls: ["这是中文陷阱描述"],
      memoryAvailable: true,
      tokenBudget: 2000,
    });
    expect(result.tier).toBe("A");
    // CJK text should survive token budget (not prematurely truncated)
    expect(result.systemPromptAddition).toContain("这是中文陷阱描述");
  });
});

describe("GapDetector", () => {
  function makeProfile(overrides: Partial<MetacognitiveProfile> = {}): MetacognitiveProfile {
    return {
      domainProficiencies: {},
      knowledgeGaps: [],
      calibrationHistory: [],
      inferredPreferences: { learnsBy: "instruction", needsConfirmationFor: [] },
      ...overrides,
    };
  }

  it("selfRating < 0.3 且 taskCount ≥ 3 → gap detected", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        typescript: { selfRating: 0.25, actualAccuracy: 0.2, taskCount: 5, lastCalibrated: Date.now() },
      },
    });
    const client = new InMemoryMemoryClient();
    await client.setSlot("metacognitive_profile", profile);
    const engine = new MetacognitiveEngine(client);
    const detector = new GapDetector(engine);

    const result = await detector.detect();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const allGaps = [...result.value.gaps, ...result.value.escalatedGaps.map(e => e.gap)];
      expect(allGaps.length).toBeGreaterThan(0);
      const tsGaps = allGaps.filter(g => g.context?.includes("typescript"));
      expect(tsGaps.length).toBeGreaterThan(0);
    }
  });

  it("selfRating ≥ 0.3 → no gap detected", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        python: { selfRating: 0.5, actualAccuracy: 0.45, taskCount: 10, lastCalibrated: Date.now() },
      },
    });
    const client = new InMemoryMemoryClient();
    await client.setSlot("metacognitive_profile", profile);
    const engine = new MetacognitiveEngine(client);
    const detector = new GapDetector(engine);

    const result = await detector.detect();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.gaps).toEqual([]);
    }
  });

  it("taskCount < 3 → gap not escalated", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        new_domain: { selfRating: 0.2, actualAccuracy: 0.1, taskCount: 2, lastCalibrated: 0 },
      },
    });
    const client = new InMemoryMemoryClient();
    await client.setSlot("metacognitive_profile", profile);
    const engine = new MetacognitiveEngine(client);
    const detector = new GapDetector(engine);

    const result = await detector.detect();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // taskCount < 3, so not yet escalated
      expect(result.value.escalatedGaps).toEqual([]);
    }
  });
});
