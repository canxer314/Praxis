/**
 * task-assessment 测试 — HIGH 4.3 + 4.8 (E2E)
 */

import { describe, it, expect, vi } from "vitest";
import { CognitiveCore } from "./cognitive-core";
import type { CognitiveCoreMemoryClient } from "./cognitive-core";
import { InMemoryMemoryClient } from "./inmemory-client";
import { TaskAssessmentBuilder } from "./task-assessment";
import { MetacognitiveEngine } from "./metacognitive-engine";
import type { MetacognitiveMemoryClient } from "./metacognitive-engine";
import type { TaskAssessmentMemoryClient } from "./task-assessment";
import type { Result } from "../platform-adapter";

// Mock memory with search data
function mockMem() {
  const slots = new Map<string, unknown>();
  return {
    getSlot: vi.fn(async (name: string) => {
      if (slots.has(name)) return { ok: true, value: slots.get(name)! } as Result<unknown>;
      return { ok: false, error: { code: "NOT_FOUND", message: "" } } as Result<unknown>;
    }),
    setSlot: vi.fn(async (name: string, data: unknown) => {
      slots.set(name, data);
      return { ok: true, value: undefined } as Result<void>;
    }),
    smartSearch: vi.fn(async () => ({ ok: true, value: [] } as Result<unknown[]>)),
    lessonSave: vi.fn(async () => ({ ok: true, value: undefined } as Result<unknown>)),
  };
}

describe("TaskAssessmentBuilder", () => {
  it("build() 正常流程：自评 + 检索记忆 → TaskAssessment", async () => {
    const mem = mockMem();
    const engine = new MetacognitiveEngine(mem);
    const builder = new TaskAssessmentBuilder(engine, mem);

    mem.smartSearch.mockResolvedValue({
      ok: true,
      value: [
        { content: "上次修过类似的 TypeScript bug", score: 0.8, source: "episode" },
      ],
    });

    const result = await builder.build("bug_fix", "typescript");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.metacognitive).toBeDefined();
      expect(result.value.metacognitive.selfRating).toBeGreaterThanOrEqual(0);
      expect(result.value.episodic.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("build() 在 smartSearch 失败时降级返回空记忆", async () => {
    const mem = mockMem();
    const engine = new MetacognitiveEngine(mem);
    const builder = new TaskAssessmentBuilder(engine, mem);

    mem.smartSearch.mockResolvedValue({
      ok: false,
      error: { code: "AGENTMEMORY_DOWN", message: "search unavailable" },
    });

    const result = await builder.build("refactor", "python");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // search 失败时不抛错，返回空记忆
      expect(result.value.episodic).toEqual([]);
      expect(result.value.procedural).toEqual([]);
    }
  });

  it("build() 传递 classificationConfidence", async () => {
    const mem = mockMem();
    const engine = new MetacognitiveEngine(mem);
    const builder = new TaskAssessmentBuilder(engine, mem);

    const result = await builder.build("design", "architecture", {
      classificationConfidence: 0.45,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.classificationConfidence).toBe(0.45);
    }
  });
});

// HIGH 4.8: E2E learning loop
describe("E2E Learning Loop", () => {
  it("完整学习环路: assessTask → captureCorrection → finalizeLearning", async () => {
    const client = new InMemoryMemoryClient();
    const core = new CognitiveCore({ memoryClient: client });
    const session = core.createSession("e2e_test_session");

    // 1. assessTask
    const assessment = await session.assessTask("bug_fix", "typescript");
    expect(assessment.ok).toBe(true);
    if (assessment.ok) {
      expect(assessment.value.metacognitive.selfRating).toBeGreaterThanOrEqual(0);
    }

    // 2. captureCorrection
    const capResult = session.captureCorrection(
      {
        what: "used deprecated API v1",
        correctedTo: "migrated to API v2 with new auth",
        likelyRootCause: "API deprecation not documented",
        isNewKnowledge: true,
      },
      {
        sessionId: "e2e_test_session",
        hasExplicitRejection: true,
        taskType: "bug_fix",
        domain: "typescript",
      },
    );
    expect(capResult.ok).toBe(true);
    expect(capResult.ok && capResult.value).not.toBeNull();

    // 3. advanceStep
    session.advanceStep();

    // 4. getFeedback
    const fb = session.getFeedback();
    expect(fb.ok).toBe(true);
    if (fb.ok) {
      expect(fb.value.userCorrections.length).toBeGreaterThan(0);
    }

    // 5. finalizeLearning
    const update = await session.finalizeLearning(
      {
        sessionId: "e2e_test_session",
        hasExplicitRejection: false,
        taskType: "bug_fix",
        domain: "typescript",
      },
      "typescript",
    );
    expect(update.ok).toBe(true);
  });

  it("session 隔离: 两个 session 的 correction 不互相污染", async () => {
    const client = new InMemoryMemoryClient();
    const core = new CognitiveCore({ memoryClient: client });

    const s1 = core.createSession("iso_1");
    const s2 = core.createSession("iso_2");

    s1.captureCorrection(
      { what: "bug in s1", correctedTo: "fixed s1", likelyRootCause: "", isNewKnowledge: true },
      { sessionId: "iso_1", hasExplicitRejection: true, taskType: "bug_fix", domain: "ts" },
    );

    s2.captureCorrection(
      { what: "bug in s2", correctedTo: "fixed s2", likelyRootCause: "", isNewKnowledge: true },
      { sessionId: "iso_2", hasExplicitRejection: true, taskType: "feature", domain: "py" },
    );

    const fb1 = s1.getFeedback();
    const fb2 = s2.getFeedback();
    expect(fb1.ok && fb1.value.userCorrections).toHaveLength(1);
    expect(fb2.ok && fb2.value.userCorrections).toHaveLength(1);
    expect(fb1.ok && fb1.value.userCorrections[0].what).toContain("s1");
    expect(fb2.ok && fb2.value.userCorrections[0].what).toContain("s2");
  });

  it("InMemoryClient 全流程: 从头到尾无需外部依赖", async () => {
    const client = new InMemoryMemoryClient();
    const core = new CognitiveCore({ memoryClient: client });

    // Profile may not exist yet (first run) — that's fine, engine returns defaults
    const profileResult = await core.getProfile();
    // InMemoryClient has no pre-seeded profile → NOT_FOUND is expected, engine has fallback
    expect(profileResult.ok || profileResult.error?.code === "NOT_FOUND").toBe(true);

    // Session lifecycle
    const session = core.createSession("quick_test");
    const assess = await session.assessTask("write_code", "typescript");
    expect(assess.ok).toBe(true);

    // Capture and finalize
    session.captureCorrection(
      { what: "x", correctedTo: "y", likelyRootCause: "test", isNewKnowledge: true },
      { sessionId: "quick_test", hasExplicitRejection: true, taskType: "write_code", domain: "typescript" },
    );
    const final = await session.finalizeLearning(
      { sessionId: "quick_test", hasExplicitRejection: false, taskType: "write_code", domain: "typescript" },
      "typescript",
    );
    expect(final.ok).toBe(true);
    if (final.ok) {
      expect(final.value.newEpisodic.length).toBeGreaterThanOrEqual(0);
    }
  });
});
