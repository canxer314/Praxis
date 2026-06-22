/**
 * metacognitive-engine 测试 — assess + calibrate + cachedAssess (HIGH 4.2)
 */

import { describe, it, expect, vi } from "vitest";
import { MetacognitiveEngine, MetacognitiveMemoryClient } from "./metacognitive-engine";
import type { MetacognitiveProfile, CalibrationEntry } from "./types";
import { Result } from "../platform-adapter";

function makeProfile(overrides: Partial<MetacognitiveProfile> = {}): MetacognitiveProfile {
  return {
    domainProficiencies: {},
    knowledgeGaps: [],
    calibrationHistory: [],
    inferredPreferences: { learnsBy: "instruction", needsConfirmationFor: [] },
    ...overrides,
  };
}

function makeMockMem(profile: MetacognitiveProfile | null = null) {
  const slots = new Map<string, unknown>();
  if (profile) slots.set("metacognitive_profile", profile);
  return {
    getSlot: vi.fn(async (name: string) => {
      if (slots.has(name)) return { ok: true, value: slots.get(name)! } as Result<unknown>;
      return { ok: false, error: { code: "NOT_FOUND", message: "not found" } } as Result<unknown>;
    }),
    setSlot: vi.fn(async (name: string, data: unknown) => {
      slots.set(name, data);
      return { ok: true, value: undefined } as Result<void>;
    }),
  };
}

describe("MetacognitiveEngine.assess", () => {
  it("新领域 (taskCount < 3) → selfRating=0.3, mode=guided", async () => {
    const profile = makeProfile();
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);

    const result = await engine.assess("new_domain");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selfRating).toBe(0.3);
      expect(result.value.recommendedMode).toBe("guided");
    }
  });

  it("领域不存在 → selfRating=0.3, mode=guided", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        python: { selfRating: 0.8, actualAccuracy: 0.75, taskCount: 10, lastCalibrated: Date.now() },
      },
    });
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);

    const result = await engine.assess("typescript");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selfRating).toBe(0.3);
      expect(result.value.recommendedMode).toBe("guided");
    }
  });

  it("熟悉领域 (taskCount ≥ 3) → 使用校准后的 selfRating", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        typescript: { selfRating: 0.75, actualAccuracy: 0.8, taskCount: 12, lastCalibrated: Date.now() },
      },
    });
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);

    const result = await engine.assess("typescript");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selfRating).toBe(0.75);
    }
  });

  it("selfRating ≥ 0.8 → mode=autonomous", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        expert_domain: { selfRating: 0.85, actualAccuracy: 0.9, taskCount: 20, lastCalibrated: Date.now() },
      },
    });
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);

    const result = await engine.assess("expert_domain");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.recommendedMode).toBe("autonomous");
  });

  it("selfRating < 0.5 → mode=exploratory", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        weak_domain: { selfRating: 0.3, actualAccuracy: 0.2, taskCount: 5, lastCalibrated: Date.now() },
      },
    });
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);

    const result = await engine.assess("weak_domain");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.recommendedMode).toBe("exploratory");
  });

  it("profile slot 不可用 → 返回默认值 (降级)", async () => {
    const mem = makeMockMem(); // 无 profile
    const engine = new MetacognitiveEngine(mem);

    const result = await engine.assess("any_domain");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selfRating).toBe(0.3);
      expect(result.value.recommendedMode).toBe("guided");
      expect(result.value.gapFlags).toEqual([]);
    }
  });
});

describe("MetacognitiveEngine.calibrate", () => {
  it("taskCount < 5 → calibration skipped", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        typescript: { selfRating: 0.5, actualAccuracy: 0.5, taskCount: 3, lastCalibrated: 0 },
      },
    });
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);

    const entry: CalibrationEntry = {
      domain: "typescript",
      selfRatingBefore: 0.5,
      actualOutcome: "success",
      calibrationDelta: 0.05,
      timestamp: Date.now(),
      sourceAnchor: "user_confirmation",
    };

    const result = await engine.calibrate(entry);
    expect(result.ok).toBe(true);
    // setSlot should not have been called (calibration skipped)
    expect(mem.setSlot).not.toHaveBeenCalled();
  });

  it("taskCount ≥ 5 → calibration executes", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        typescript: { selfRating: 0.7, actualAccuracy: 0.5, taskCount: 10, lastCalibrated: 0 },
      },
      calibrationHistory: [],
    });
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);

    const entry: CalibrationEntry = {
      domain: "typescript",
      selfRatingBefore: 0.7,
      actualOutcome: "correction_needed",
      calibrationDelta: -0.1,
      timestamp: Date.now(),
      sourceAnchor: "explicit_correction",
    };

    const result = await engine.calibrate(entry);
    expect(result.ok).toBe(true);
    // Profile should have been written
    expect(mem.setSlot).toHaveBeenCalled();
  });

  it("selfRating 高估 (> actualAccuracy + 0.15) → 下调", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        ts: { selfRating: 0.9, actualAccuracy: 0.5, taskCount: 20, lastCalibrated: 0 },
      },
      calibrationHistory: Array(8).fill(null).map(() => ({
        domain: "ts",
        selfRatingBefore: 0.9,
        actualOutcome: "failure" as const,
        calibrationDelta: -0.1,
        timestamp: Date.now(),
        sourceAnchor: "explicit_correction" as const,
      })),
    });
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);

    const entry: CalibrationEntry = {
      domain: "ts",
      selfRatingBefore: 0.9,
      actualOutcome: "correction_needed",
      calibrationDelta: -0.1,
      timestamp: Date.now(),
      sourceAnchor: "explicit_correction",
    };

    const result = await engine.calibrate(entry);
    expect(result.ok).toBe(true);
    expect(mem.setSlot).toHaveBeenCalled();
    // The profile should have been written with a reduced selfRating
    const writeCall = mem.setSlot.mock.calls[0];
    const writtenProfile = writeCall[1] as MetacognitiveProfile;
    const writtenSelfRating = writtenProfile.domainProficiencies["ts"]?.selfRating;
    expect(writtenSelfRating).toBeDefined();
    if (writtenSelfRating !== undefined) {
      // Overestimated: delta = selfRating - actualAccuracy = 0.9 - low ≈ large positive
      // Adjustment: selfRating - delta * 0.3 → significant reduction
      expect(writtenSelfRating).toBeLessThan(0.9);
    }
  });

  it("profile 读取失败 → 优雅跳过 (ok: true)", async () => {
    const mem = {
      getSlot: vi.fn(async () => ({ ok: false, error: { code: "DOWN", message: "unavailable" } } as Result<unknown>)),
      setSlot: vi.fn(),
    };
    const engine = new MetacognitiveEngine(mem);

    const entry: CalibrationEntry = {
      domain: "ts",
      selfRatingBefore: 0.5,
      actualOutcome: "success",
      calibrationDelta: 0.05,
      timestamp: Date.now(),
      sourceAnchor: "user_confirmation",
    };

    const result = await engine.calibrate(entry);
    expect(result.ok).toBe(true);
  });
});

describe("MetacognitiveEngine.cachedAssess", () => {
  it("有缓存 profile → 立即返回 stale:true + 后台刷新", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        ts: { selfRating: 0.7, actualAccuracy: 0.65, taskCount: 10, lastCalibrated: Date.now() },
      },
    });
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);

    // 先调用一次 getProfile 建立缓存
    await engine.getProfile();

    // cachedAssess 应该立即返回 (stale)
    const result = await engine.cachedAssess("ts", "bug_fix");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stale).toBe(true);
      expect(result.value.selfRating).toBe(0.7);
    }
  });

  it("无缓存 profile → 同步 assess (stale: false)", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        ts: { selfRating: 0.6, actualAccuracy: 0.55, taskCount: 8, lastCalibrated: Date.now() },
      },
    });
    const mem = makeMockMem(profile);
    const engine = new MetacognitiveEngine(mem);
    // 不先 warm cache

    const result = await engine.cachedAssess("ts", "bug_fix");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stale).toBe(false);
      expect(result.value.selfRating).toBe(0.6);
    }
  });
});
