/**
 * session-start 测试 — Phase 1A + T8
 *
 * 覆盖路径:
 *   Phase 1A (原路径):
 *     - 正常: AgentMemory 可用 → 加载 competency_model → 构建 ContextInjection
 *     - 降级: AgentMemory 不可用 → 使用默认 competency model → stale 标记
 *     - 空模型: competency_model 为空 → 返回最小上下文
 *     - Schema 不匹配: slot 返回格式错误 → 降级到默认值
 *     - 多 skills / best_practices / anti_patterns
 *   T8 (CognitiveCore 路径):
 *     - 正常: CognitiveCore 可用 → 缓存 profile 快速注入
 *     - 空 profile: domainProficiencies 为空 → 回退默认 skills
 *     - getProfile 失败: → 降级到默认模型
 *     - 知识缺口 + 校准历史: 全部输出
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionStartHandler, SessionStartDeps } from "./session-start";
import { Result } from "./platform-adapter";
import type { CognitiveCore } from "./cognitive/cognitive-core";
import type { MetacognitiveProfile } from "./cognitive/types";

describe("SessionStartHandler", () => {
  let deps: SessionStartDeps;
  let getSlot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getSlot = vi.fn();
    deps = { getSlot };
  });

  // ---- 正常路径 ----

  it("AgentMemory 可用时加载 competency_model 并构建 ContextInjection", async () => {
    getSlot.mockResolvedValue({
      ok: true,
      value: {
        skills: [
          { id: "ts", name: "TypeScript", proficiency: 0.8, level: "proficient" },
          { id: "arch", name: "架构设计", proficiency: 0.9, level: "expert" },
        ],
        best_practices: ["使用 Result 类型统一错误处理"],
        anti_patterns: ["避免 any 类型"],
      },
    } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("session-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctx = result.value;
      expect(ctx.tier).toBe("A");
      expect(ctx.systemPromptAddition).toContain("TypeScript");
      expect(ctx.systemPromptAddition).toContain("0.80");
      expect(ctx.systemPromptAddition).toContain("架构设计");
      expect(ctx.systemPromptAddition).toContain("Result 类型");
      expect(ctx.systemPromptAddition).toContain("避免 any 类型");
      expect(ctx.tokenCount).toBeGreaterThan(0);
    }
  });

  it("正确格式化技能熟练度（proficient/expert 等不同级别）", async () => {
    getSlot.mockResolvedValue({
      ok: true,
      value: {
        skills: [
          { id: "a", name: "SkillA", proficiency: 0.3, level: "advanced_beginner" },
          { id: "b", name: "SkillB", proficiency: 0.95, level: "expert" },
        ],
        best_practices: [],
        anti_patterns: [],
      },
    } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("s1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.systemPromptAddition).toContain("0.30");
      expect(result.value.systemPromptAddition).toContain("advanced_beginner");
      expect(result.value.systemPromptAddition).toContain("0.95");
      expect(result.value.systemPromptAddition).toContain("expert");
    }
  });

  it("best_practices 为空时不输出最佳实践区块", async () => {
    getSlot.mockResolvedValue({
      ok: true,
      value: { skills: [], best_practices: [], anti_patterns: [] },
    } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("s1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.systemPromptAddition).not.toContain("最佳实践");
    }
  });

  // ---- 降级路径 ----

  it("AgentMemory 不可用时使用默认 competency model", async () => {
    getSlot.mockResolvedValue({
      ok: false,
      error: { code: "AGENTMEMORY_UNAVAILABLE", message: "MCP 超时" },
    } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("degraded-1");

    expect(result.ok).toBe(true); // 降级不是错误
    if (result.ok) {
      expect(result.value.tier).toBe("C"); // 降级 → Tier C
      expect(result.value.systemPromptAddition).toContain("缓存数据");
      expect(result.value.systemPromptAddition).toContain("TypeScript"); // 默认 skill
    }
  });

  it("AgentMemory 返回 null value 时使用默认模型", async () => {
    getSlot.mockResolvedValue({ ok: true, value: null } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("null-val");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tier).toBe("C");
      expect(result.value.systemPromptAddition).toContain("缓存数据");
    }
  });

  // ---- 空模型 ----

  it("competency_model skills 为空数组时返回最小上下文", async () => {
    getSlot.mockResolvedValue({
      ok: true,
      value: { skills: [], best_practices: [], anti_patterns: [] },
    } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("empty");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tier).toBe("A");
      expect(result.value.tokenCount).toBeGreaterThan(0);
    }
  });

  // ---- Schema 不匹配 ----

  it("competency_model 返回格式错误的对象时使用空模型", async () => {
    getSlot.mockResolvedValue({
      ok: true,
      value: { wrong_field: "not a competency model" },
    } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("bad-schema");

    // 宽松处理：无法识别的字段被忽略，使用空模型
    // AgentMemory 可用（ok:true），所以 tier 不是 C
    expect(result.ok).toBe(true);
    if (result.ok) {
      // skills/best_practices/anti_patterns 均为空，无内容输出
      expect(result.value.systemPromptAddition).toContain("无技能数据");
    }
  });

  // ---- 多 best_practices / anti_patterns ----

  it("多条 best_practices 全部格式化输出", async () => {
    getSlot.mockResolvedValue({
      ok: true,
      value: {
        skills: [],
        best_practices: ["规则1", "规则2", "规则3"],
        anti_patterns: ["陷阱A"],
      },
    } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("many");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.systemPromptAddition).toContain("规则1");
      expect(result.value.systemPromptAddition).toContain("规则2");
      expect(result.value.systemPromptAddition).toContain("规则3");
      expect(result.value.systemPromptAddition).toContain("陷阱A");
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // T8: CognitiveCore 路径
  // ══════════════════════════════════════════════════════════════════

  function makeProfile(overrides: Partial<MetacognitiveProfile> = {}): MetacognitiveProfile {
    return {
      domainProficiencies: {},
      knowledgeGaps: [],
      calibrationHistory: [],
      inferredPreferences: { learnsBy: "instruction", needsConfirmationFor: [] },
      ...overrides,
    };
  }

  function makeMockCognitiveCore(
    profileResult: Result<MetacognitiveProfile>,
  ): CognitiveCore {
    return {
      getProfile: vi.fn().mockResolvedValue(profileResult),
    } as unknown as CognitiveCore;
  }

  it("T8: CognitiveCore 可用时使用 profile 数据注入", async () => {
    const profile = makeProfile({
      domainProficiencies: {
        typescript: {
          selfRating: 0.75,
          actualAccuracy: 0.8,
          taskCount: 12,
          lastCalibrated: Date.now(),
        },
        python: {
          selfRating: 0.4,
          actualAccuracy: 0.35,
          taskCount: 5,
          lastCalibrated: Date.now(),
        },
      },
      knowledgeGaps: [
        { topic: "async generators", context: "迭代大量数据时内存溢出", resolved: false },
        { topic: "decorator patterns", context: "想用但不确定最佳实践", resolved: true },
      ],
      calibrationHistory: [
        { domain: "typescript", selfRating: 0.7, actualOutcome: "success" },
        { domain: "typescript", selfRating: 0.7, actualOutcome: "failure" },
        { domain: "typescript", selfRating: 0.75, actualOutcome: "success" },
      ],
    });

    const depsWithCore: SessionStartDeps = {
      getSlot,
      cognitiveCore: makeMockCognitiveCore({ ok: true, value: profile }),
    };

    const handler = new SessionStartHandler(depsWithCore);
    const result = await handler.handle("t8-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctx = result.value;
      expect(ctx.tier).toBe("A");
      expect(ctx.systemPromptAddition).toContain("typescript: 0.75");
      expect(ctx.systemPromptAddition).toContain("competent");
      expect(ctx.systemPromptAddition).toContain("12 次任务");
      expect(ctx.systemPromptAddition).toContain("python: 0.40");
      expect(ctx.systemPromptAddition).toContain("beginner");
      // 按 selfRating 降序排列 → typescript 在 python 前面
      const tsIdx = ctx.systemPromptAddition.indexOf("typescript");
      const pyIdx = ctx.systemPromptAddition.indexOf("python");
      expect(tsIdx).toBeLessThan(pyIdx);
      // 未解决的缺口
      expect(ctx.systemPromptAddition).toContain("async generators");
      expect(ctx.systemPromptAddition).toContain("内存溢出");
      // 已解决的缺口不应出现
      expect(ctx.systemPromptAddition).not.toContain("decorator patterns");
      // 校准状态
      expect(ctx.systemPromptAddition).toContain("67%");
    }
  });

  it("T8: profile domainProficiencies 为空时回退默认 skills", async () => {
    const profile = makeProfile(); // 空的 domainProficiencies

    const depsWithCore: SessionStartDeps = {
      getSlot,
      cognitiveCore: makeMockCognitiveCore({ ok: true, value: profile }),
    };

    const handler = new SessionStartHandler(depsWithCore);
    const result = await handler.handle("t8-empty");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.systemPromptAddition).toContain("TypeScript");
      expect(result.value.systemPromptAddition).toContain("系统架构设计");
      expect(result.value.systemPromptAddition).toContain("AI Agent 系统");
    }
  });

  it("T8: getProfile 失败时降级到默认模型", async () => {
    const depsWithCore: SessionStartDeps = {
      getSlot,
      cognitiveCore: makeMockCognitiveCore({
        ok: false,
        error: { code: "SLOT_READ_ERROR", message: "network timeout" },
      }),
    };

    const handler = new SessionStartHandler(depsWithCore);
    const result = await handler.handle("t8-degraded");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tier).toBe("C");
      expect(result.value.systemPromptAddition).toContain("缓存数据");
    }
  });

  it("T8: 无 cognitiveCore 时保持原 slot 路径行为", async () => {
    // 确保原路径不退化
    getSlot.mockResolvedValue({
      ok: true,
      value: {
        skills: [{ id: "rust", name: "Rust", proficiency: 0.5, level: "competent" }],
        best_practices: [],
        anti_patterns: [],
      },
    } as Result<unknown>);

    const handler = new SessionStartHandler(deps);
    const result = await handler.handle("no-core");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tier).toBe("A");
      expect(result.value.systemPromptAddition).toContain("Rust");
      // 不应该包含 T8 特有区块
      expect(result.value.systemPromptAddition).not.toContain("待解决的知识缺口");
      expect(result.value.systemPromptAddition).not.toContain("校准状态");
    }
  });
});
