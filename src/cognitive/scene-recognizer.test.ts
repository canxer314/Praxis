/**
 * scene-recognizer 测试 — 1-layer LLM 场景识别
 *
 * 覆盖:
 *   - LLM 明确匹配 → 返回 ScenarioMatch[]
 *   - LLM 返回 unknown → 返回 []
 *   - LLM 调用失败 → 返回 []
 *   - 空输入 → 返回 []
 *   - 非法场景 ID 被过滤
 *   - 置信度边界值处理
 *   - getPrimaryScenarioId / getActiveScenarioIds 辅助函数
 *   - LLM 返回多个场景 → 按置信度降序排列
 */

import { describe, it, expect } from "vitest";
import {
  recognizeScene,
  getPrimaryScenarioId,
  getActiveScenarioIds,
  SCENE_CONFIDENCE,
} from "./scene-recognizer";
import type { LlmClient, Result } from "../platform-adapter";

// ---- Mock LLM Client ----

function mockLlm(response: string): LlmClient {
  return {
    analyze: async (): Promise<Result<string>> => ({ ok: true, value: response }),
  };
}

function mockLlmError(): LlmClient {
  return {
    analyze: async (): Promise<Result<string>> => ({
      ok: false,
      error: { code: "LLM_ERROR", message: "mock error" },
    }),
  };
}

// ══════════════════════════════════════════════════════════════════
// recognizeScene — 正常匹配
// ══════════════════════════════════════════════════════════════════

describe("recognizeScene — 正常匹配", () => {
  it("LLM 明确匹配 backend_api_development → 返回 ScenarioMatch", async () => {
    const llm = mockLlm(JSON.stringify([
      { scenarioId: "backend_api_development", confidence: 0.85, rationale: "用户正在开发 REST API 端点" },
    ]));
    const matches = await recognizeScene(llm, "帮我写一个用户注册的 POST 接口");
    expect(matches).toHaveLength(1);
    expect(matches[0].scenarioId).toBe("backend_api_development");
    expect(matches[0].confidence).toBe(0.85);
    expect(matches[0].source).toBe("llm_inference");
  });

  it("LLM 匹配 bug_investigation → 返回正确场景", async () => {
    const llm = mockLlm(JSON.stringify([
      { scenarioId: "bug_investigation", confidence: 0.9, rationale: "用户正在排查错误" },
    ]));
    const matches = await recognizeScene(llm, "这个报错是哪里来的？帮我查一下");
    expect(matches).toHaveLength(1);
    expect(matches[0].scenarioId).toBe("bug_investigation");
  });

  it("LLM 返回多个场景 → 按置信度降序排列", async () => {
    const llm = mockLlm(JSON.stringify([
      { scenarioId: "ai_agent_development", confidence: 0.8, rationale: "Praxis 开发" },
      { scenarioId: "architecture_design", confidence: 0.55, rationale: "涉及架构决策" },
    ]));
    const matches = await recognizeScene(llm, "给 Praxis 加一个 scene-recognizer 模块");
    expect(matches).toHaveLength(2);
    expect(matches[0].scenarioId).toBe("ai_agent_development");
    expect(matches[1].scenarioId).toBe("architecture_design");
    expect(matches[0].confidence).toBeGreaterThan(matches[1].confidence);
  });
});

// ══════════════════════════════════════════════════════════════════
// recognizeScene — 无匹配 / 降级
// ══════════════════════════════════════════════════════════════════

describe("recognizeScene — 无匹配 / 降级", () => {
  it("LLM 返回空数组 → 返回 []（Open Perception 模式）", async () => {
    const llm = mockLlm("[]");
    const matches = await recognizeScene(llm, "今天天气怎么样？");
    expect(matches).toHaveLength(0);
  });

  it("LLM 返回 unknown（非注册场景 ID）→ 被过滤 → 返回 []", async () => {
    // LLM 返回的场景 ID 不在 SEED_SCENARIOS 中
    const llm = mockLlm(JSON.stringify([
      { scenarioId: "unknown", confidence: 0.1, rationale: "no match" },
    ]));
    const matches = await recognizeScene(llm, "随便聊聊");
    expect(matches).toHaveLength(0); // unknown 被 validIds 过滤
  });

  it("LLM 返回部分有效 + 部分无效 → 只保留有效场景", async () => {
    const llm = mockLlm(JSON.stringify([
      { scenarioId: "bug_investigation", confidence: 0.6, rationale: "debug" },
      { scenarioId: "fake_scenario_not_in_registry", confidence: 0.9, rationale: "fake" },
    ]));
    const matches = await recognizeScene(llm, "排查 bug");
    expect(matches).toHaveLength(1);
    expect(matches[0].scenarioId).toBe("bug_investigation");
  });

  it("LLM 调用失败 → 返回 []", async () => {
    const matches = await recognizeScene(mockLlmError(), "帮我写接口");
    expect(matches).toHaveLength(0);
  });

  it("LLM 返回非 JSON → 返回 []", async () => {
    const llm = mockLlm("这不是 JSON，只是随便说说");
    const matches = await recognizeScene(llm, "帮我写接口");
    expect(matches).toHaveLength(0);
  });

  it("LLM 返回非数组 → 返回 []", async () => {
    const llm = mockLlm(JSON.stringify({ scenarioId: "bug" }));
    const matches = await recognizeScene(llm, "bug");
    expect(matches).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// recognizeScene — 边界值 / 健壮性
// ══════════════════════════════════════════════════════════════════

describe("recognizeScene — 边界值 / 健壮性", () => {
  it("空字符串输入 → 返回 []", async () => {
    const llm = mockLlm("[]");
    const matches = await recognizeScene(llm, "");
    expect(matches).toHaveLength(0);
  });

  it("纯空格输入 → 返回 []", async () => {
    const llm = mockLlm("[]");
    const matches = await recognizeScene(llm, "   ");
    expect(matches).toHaveLength(0);
  });

  it("confidence > 1 → clamp 到 1", async () => {
    const llm = mockLlm(JSON.stringify([
      { scenarioId: "backend_api_development", confidence: 1.5, rationale: "overconfident" },
    ]));
    const matches = await recognizeScene(llm, "API");
    expect(matches[0].confidence).toBe(1);
  });

  it("confidence < 0 → clamp 到 0", async () => {
    const llm = mockLlm(JSON.stringify([
      { scenarioId: "backend_api_development", confidence: -0.5, rationale: "anti-confident" },
    ]));
    const matches = await recognizeScene(llm, "API");
    expect(matches[0].confidence).toBe(0);
  });

  it("缺少 confidence 字段 → 过滤掉（防御性类型校验）", async () => {
    const llm = mockLlm(JSON.stringify([
      { scenarioId: "backend_api_development", rationale: "no confidence field" },
    ]));
    const matches = await recognizeScene(llm, "API");
    expect(matches).toHaveLength(0);
  });

  it("缺少 scenarioId 字段 → 过滤掉", async () => {
    const llm = mockLlm(JSON.stringify([
      { confidence: 0.8, rationale: "no scenarioId" },
    ]));
    const matches = await recognizeScene(llm, "API");
    expect(matches).toHaveLength(0);
  });

  it("confidence 为 NaN → 过滤掉", async () => {
    const llm = mockLlm(JSON.stringify([
      { scenarioId: "backend_api_development", confidence: "not a number", rationale: "bad confidence" },
    ]));
    const matches = await recognizeScene(llm, "API");
    expect(matches).toHaveLength(0);
  });

  it("6+ 匹配项 → 截断到 5（防御性上限）", async () => {
    const sixScenarios = [
      { scenarioId: "backend_api_development", confidence: 0.9, rationale: "1" },
      { scenarioId: "bug_investigation", confidence: 0.8, rationale: "2" },
      { scenarioId: "architecture_design", confidence: 0.7, rationale: "3" },
      { scenarioId: "ai_agent_development", confidence: 0.6, rationale: "4" },
      { scenarioId: "document_writing", confidence: 0.5, rationale: "5" },
      { scenarioId: "backend_api_development", confidence: 0.4, rationale: "6" }, // 重复 ID 仍计数为独立条目
    ];
    const llm = mockLlm(JSON.stringify(sixScenarios));
    const matches = await recognizeScene(llm, "everything");
    expect(matches.length).toBeLessThanOrEqual(5);
  });
});

// ══════════════════════════════════════════════════════════════════
// getPrimaryScenarioId
// ══════════════════════════════════════════════════════════════════

describe("getPrimaryScenarioId", () => {
  it("高置信度匹配 → 返回主场景 ID", () => {
    const matches = [
      { scenarioId: "bug_investigation", confidence: 0.85, source: "llm_inference" as const },
    ];
    expect(getPrimaryScenarioId(matches)).toBe("bug_investigation");
  });

  it("置信度低于 PRIMARY_MIN_THRESHOLD → 返回 null", () => {
    const matches = [
      { scenarioId: "architecture_design", confidence: 0.35, source: "llm_inference" as const },
    ];
    expect(getPrimaryScenarioId(matches)).toBeNull();
  });

  it("空数组 → 返回 null", () => {
    expect(getPrimaryScenarioId([])).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// getActiveScenarioIds
// ══════════════════════════════════════════════════════════════════

describe("getActiveScenarioIds", () => {
  it("多场景 → 过滤出 >= ACTIVE_THRESHOLD 的 ID", () => {
    const matches = [
      { scenarioId: "bug_investigation", confidence: 0.85, source: "llm_inference" as const },
      { scenarioId: "backend_api_development", confidence: 0.45, source: "llm_inference" as const },
      { scenarioId: "architecture_design", confidence: 0.25, source: "llm_inference" as const }, // < 0.3
    ];
    const ids = getActiveScenarioIds(matches);
    expect(ids).toEqual(["bug_investigation", "backend_api_development"]);
  });

  it("所有场景低于阈值 → 返回 []", () => {
    const matches = [
      { scenarioId: "document_writing", confidence: 0.25, source: "llm_inference" as const },
    ];
    expect(getActiveScenarioIds(matches)).toEqual([]);
  });

  it("空数组 → 返回 []", () => {
    expect(getActiveScenarioIds([])).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
// SCENE_CONFIDENCE 常量
// ══════════════════════════════════════════════════════════════════

describe("SCENE_CONFIDENCE 常量", () => {
  it("所有常量在合理范围内", () => {
    expect(SCENE_CONFIDENCE.LLM_MATCH).toBeGreaterThan(0.5);
    expect(SCENE_CONFIDENCE.LLM_MATCH).toBeLessThanOrEqual(1);
    expect(SCENE_CONFIDENCE.ACTIVE_THRESHOLD).toBeLessThan(SCENE_CONFIDENCE.PRIMARY_MIN_THRESHOLD);
    expect(SCENE_CONFIDENCE.PRIMARY_MIN_THRESHOLD).toBeLessThan(SCENE_CONFIDENCE.LLM_MATCH);
  });
});
