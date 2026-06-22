/**
 * Context — 记忆 → Prompt 注入
 *
 * 将检索到的记忆、反模式和知识缺口组装为 LLM 上下文注入片段。
 * 优先级: 反模式 > 未解决缺口 > 相关情景记忆。
 */

import type { ContextInjection } from "../platform-adapter";
import type {
  EpisodicMemory,
  ProceduralMemory,
  KnowledgeGap,
} from "./types";
import { sanitizePromptFragment } from "./sanitize";

// ══════════════════════════════════════════════════════════════════
// buildContextInjection
// ══════════════════════════════════════════════════════════════════

export interface BuildContextInput {
  episodic: EpisodicMemory[];
  procedural?: ProceduralMemory[];
  frequentPitfalls?: string[];
  openGaps?: KnowledgeGap[];
  /** 注入片段 token 预算上限 (默认 1500，设计文档 T4 修正) */
  tokenBudget?: number;
  /** AgentMemory 是否可用 */
  memoryAvailable: boolean;
}

/**
 * 将记忆检索结果组装为 LLM 上下文注入。
 *
 * 排序规则:
 *   1. 已知反模式 (最高优先级 — 防止重复犯错)
 *   2. 未解决的知识缺口
 *   3. 相关情景记忆 (最近优先)
 *
 * 如果 retrieval 返回 < 2 条结果，返回空注入 (低信息量的噪声 > 无信息)。
 */
export function buildContextInjection(input: BuildContextInput): ContextInjection {
  const budget = input.tokenBudget ?? 1500;
  const lines: string[] = [];
  let estimatedTokens = 0;
  let tier: ContextInjection["tier"] = "C";

  if (!input.memoryAvailable) {
    return {
      systemPromptAddition: "\n## Praxis Context\n⚠️ 记忆离线 — 无法检索相关经验。\n",
      tier: "C",
      tokenCount: 20,
    };
  }

  // 检索结果太少的快速返回
  const totalResults =
    input.episodic.length +
    (input.procedural?.length ?? 0) +
    (input.frequentPitfalls?.length ?? 0) +
    (input.openGaps?.length ?? 0);

  if (totalResults < 2) return emptyInjection();

  // 1. 反模式 (最高优先级)
  if (input.frequentPitfalls && input.frequentPitfalls.length > 0) {
    lines.push("### ⚠️ 已知陷阱");
    for (const pitfall of input.frequentPitfalls) {
      const safe = sanitizePromptFragment(pitfall);
      const line = `- ${safe}`;
      if (estimatedTokens + line.length / 4 > budget) break;
      lines.push(line);
      estimatedTokens += line.length / 4;
    }
    lines.push("");
    tier = "A";
  }

  // 2. 未解决的知识缺口
  if (input.openGaps && input.openGaps.length > 0 && estimatedTokens < budget) {
    lines.push("### 知识缺口");
    for (const gap of input.openGaps) {
      const safe = sanitizePromptFragment(`${gap.topic}: ${gap.context}`);
      const line = `- ${safe}`;
      if (estimatedTokens + line.length / 4 > budget) break;
      lines.push(line);
      estimatedTokens += line.length / 4;
    }
    lines.push("");
    if (tier !== "A") tier = "B";
  }

  // 3. 相关情景记忆 (最近 3 条)
  if (input.episodic.length > 0 && estimatedTokens < budget) {
    lines.push("### 相关经验");
    const recent = input.episodic.slice(-3);
    for (const mem of recent) {
      const safe = sanitizePromptFragment(`${mem.observation.situation}: ${mem.observation.outcome}`);
      const line = `- ${safe}`;
      if (estimatedTokens + line.length / 4 > budget) break;
      lines.push(line);
      estimatedTokens += line.length / 4;
    }
    lines.push("");
  }

  if (lines.length === 0) return emptyInjection();

  return {
    systemPromptAddition: `\n## Praxis Context\n${lines.join("\n")}`,
    tier,
    tokenCount: Math.ceil(estimatedTokens),
  };
}

function emptyInjection(): ContextInjection {
  return {
    systemPromptAddition: "",
    tier: "C",
    tokenCount: 0,
  };
}
