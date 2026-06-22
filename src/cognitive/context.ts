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
      if (estimatedTokens + estimateTokens(line) > budget) break;
      lines.push(line);
      estimatedTokens += estimateTokens(line);
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
      if (estimatedTokens + estimateTokens(line) > budget) break;
      lines.push(line);
      estimatedTokens += estimateTokens(line);
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
      if (estimatedTokens + estimateTokens(line) > budget) break;
      lines.push(line);
      estimatedTokens += estimateTokens(line);
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

// ══════════════════════════════════════════════════════════════════
// Token 估算 (E11: CJK 修正)
// ══════════════════════════════════════════════════════════════════

/**
 * 估算一段文本的 token 数。
 *
 * 基于 cl100k_base (GPT-4/Claude) tokenizer 的大致比率：
 *   CJK 字符 (中日韩统一表意文字/平假名/片假名/谚文): ~1 token/字符
 *   其他字符 (英文/数字/符号): ~0.25 token/字符 (≈4 字符/token)
 *
 * 这是一个保守估算（上限估计），实际 token 数通常低于此估算值。
 * 精确值需要通过实际 tokenizer 获取；此函数用于上下文 token 预算控制。
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // CJK Unified Ideographs + Extensions + Compatibility
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || // CJK Unified
        (cp >= 0x3400 && cp <= 0x4DBF) || // CJK Extension A
        (cp >= 0x20000 && cp <= 0x2A6DF) || // CJK Extension B
        (cp >= 0xF900 && cp <= 0xFAFF) || // CJK Compatibility
        (cp >= 0x3040 && cp <= 0x309F) || // Hiragana
        (cp >= 0x30A0 && cp <= 0x30FF) || // Katakana
        (cp >= 0xAC00 && cp <= 0xD7AF)) { // Hangul
      tokens += 1;
    } else {
      tokens += 0.25;
    }
  }
  return Math.ceil(tokens);
}
