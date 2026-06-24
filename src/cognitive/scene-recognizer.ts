/**
 * Scene Recognizer — 1-layer LLM 场景识别 (Phase 2)
 *
 * 职责:
 *   - 接收用户上下文（首条消息 / 任务描述）
 *   - 从种子场景注册表中识别当前活跃场景
 *   - 返回 ScenarioMatch[]（按置信度降序）
 *
 * 算法 (D4 修订后): 单层 LLM 分类。
 *   Jaccard 层被移除——对 3-8 个参考点做中文 bigram Jaccard 产生的是噪声而非信号。
 *   Exact match 几乎不会触发——task_type 字符串不可能精确匹配种子场景 ID。
 *   LLM 直接做 1-vs-N 分类，零前置过滤。
 *
 * 降级:
 *   LLM 调用失败 → 返回空数组 → 会话在 Open Perception 模式下运行
 *   LLM 返回"unknown" → 返回空数组 → 同上
 */

import type { LlmClient, Result } from "../platform-adapter";
import type { ScenarioMatch } from "./types";
import { SEED_SCENARIOS } from "./scenario-registry";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 置信度常量 (D6: 集中定义，协同调整)
// ══════════════════════════════════════════════════════════════════

export const SCENE_CONFIDENCE = {
  /** LLM 明确匹配到已知场景时的基础置信度 */
  LLM_MATCH: 0.75,
  /** LLM 不确定但给出了最佳猜测 */
  LLM_UNCERTAIN: 0.35,
  /** LLM 返回 unknown / 无场景匹配 */
  NO_MATCH: 0,
  /** 场景在活跃列表中的最低置信度阈值 */
  ACTIVE_THRESHOLD: 0.3,
  /** 主场景（最高置信度）必须超过此值才被视为有效 */
  PRIMARY_MIN_THRESHOLD: 0.4,
} as const;

// ══════════════════════════════════════════════════════════════════
// Prompt 构造
// ══════════════════════════════════════════════════════════════════

function buildScenePrompt(userContext: string): string {
  const scenarioList = SEED_SCENARIOS
    .map((s) => `- ${s.scenarioId}: ${s.tentativeName} (典型工具: ${s.typicalTools.slice(0, 4).join(", ")}; 领域: ${s.typicalDomains.slice(0, 3).join(", ")})`)
    .join("\n");

  return `你是一个场景分类器。根据用户当前的任务描述，判断属于以下哪个预定义场景。

预定义场景:
${scenarioList}

分类原则:
- 选择最匹配用户**正在做什么**的场景，而非用户消息中提到的话题
- 如果用户描述中同时涉及多个场景（如"修复一个 API bug"），选择最核心的操作场景
- 如果当前描述与所有场景都不相关，返回 "unknown"
- 每个匹配项提供一句话的理由

用户当前任务描述:
---
${userContext.slice(0, 2000)}
---

返回格式: 纯 JSON 数组，不要 Markdown 代码块包裹。
每个元素: {"scenarioId": "场景ID", "confidence": 0.0-1.0, "rationale": "一句话理由"}
按置信度降序排列。只包含置信度 >= 0.3 的匹配项。
如果没有场景置信度 >= 0.3，返回 []。`;
}

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 识别当前会话的场景。
 *
 * @param llm       LLM 客户端（用于分类调用）
 * @param userContext  用户上下文文本——首条消息、任务描述或 transcript 摘要
 * @returns ScenarioMatch[] — 按置信度降序排列。空数组 = 无匹配场景（Open Perception 模式）
 */
export async function recognizeScene(
  llm: LlmClient,
  userContext: string,
): Promise<ScenarioMatch[]> {
  if (!userContext || userContext.trim().length === 0) return [];

  const startMs = Date.now();
  const prompt = buildScenePrompt(userContext);
  const result: Result<string> = await llm.analyze(prompt);

  if (!result.ok) {
    logDegraded("scene-recognizer", "recognizeScene", `LLM call failed: ${result.error?.message ?? "unknown"}`);
    return [];
  }

  const matches = parseSceneResponse(result.value);
  log({
    ts: new Date().toISOString(),
    module: "scene-recognizer",
    op: "recognizeScene",
    duration_ms: Date.now() - startMs,
    outcome: matches.length > 0 ? "success" : "degraded",
    error: `matched ${matches.length} scenarios`,
  });
  return matches;
}

/**
 * 从场景匹配列表中获取主场景 ID。
 * 主场景 = 最高置信度且超过 PRIMARY_MIN_THRESHOLD 的场景。
 *
 * @returns scenarioId 或 null
 */
export function getPrimaryScenarioId(matches: ScenarioMatch[]): string | null {
  if (matches.length === 0) return null;
  const top = matches[0];
  return top.confidence >= SCENE_CONFIDENCE.PRIMARY_MIN_THRESHOLD ? top.scenarioId : null;
}

/**
 * 获取所有置信度 >= ACTIVE_THRESHOLD 的场景 ID。
 * 用于 TranscriptAnalyzerV2 的 activeScenarioIds 参数。
 */
export function getActiveScenarioIds(matches: ScenarioMatch[]): string[] {
  return matches
    .filter((m) => m.confidence >= SCENE_CONFIDENCE.ACTIVE_THRESHOLD)
    .map((m) => m.scenarioId);
}

// ══════════════════════════════════════════════════════════════════
// 内部
// ══════════════════════════════════════════════════════════════════

interface RawSceneItem {
  scenarioId: string;
  confidence: number;
  rationale: string;
}

/**
 * 解析 LLM 返回的场景分类 JSON。
 * @returns ScenarioMatch[] 或 []（解析失败 / unknown / 空数组）
 */
function parseSceneResponse(raw: string): ScenarioMatch[] {
  try {
    const json = JSON.parse(raw.trim());
    if (!Array.isArray(json)) return [];

    const validIds = new Set(SEED_SCENARIOS.map((s) => s.scenarioId));
    const matches: ScenarioMatch[] = [];

    for (const item of json) {
      if (!item.scenarioId || typeof item.scenarioId !== "string") continue;
      if (!validIds.has(item.scenarioId)) continue; // 拒绝未注册的场景 ID
      if (typeof item.confidence !== "number" || isNaN(item.confidence)) continue;

      matches.push({
        scenarioId: item.scenarioId,
        confidence: Math.min(1, Math.max(0, item.confidence)),
        source: "llm_inference",
      });
    }

    // 按置信度降序
    matches.sort((a, b) => b.confidence - a.confidence);

    // 防御性上限: 最多 5 个活跃场景
    return matches.slice(0, 5);
  } catch {
    // JSON 解析失败 → 安全返回空
    return [];
  }
}
