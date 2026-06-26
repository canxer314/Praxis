/**
 * StatisticalVerifier — 独立统计验证 (M4.3.1)
 *
 * 原理: ProtoSequence 预测的工具序列 vs 实际工具调用序列做模糊匹配。
 * 完全独立于 LLM——纯规则匹配。
 *
 * 架构参考: §4 statistical-verifier
 */

import type { ProtoStructure, ProtoSequence, ToolCallRecord, StepMatch } from "../cognitive/types";
import type { Verifier, VerificationContext, VerifierOutput } from "./types";

// ══════════════════════════════════════════════════════════════════
// 工具名称模糊匹配
// ══════════════════════════════════════════════════════════════════

/** 工具类别映射 — 同类别工具之间的语义匹配分数 */
const TOOL_CATEGORIES: Record<string, string[]> = {
  read: ["read_file", "Read", "Glob", "Grep", "cat", "Get-Content", "open_file", "view_file"],
  write: ["write_file", "Write", "Edit", "create_file", "save_file", "New-Item"],
  search: ["grep", "Grep", "search_content", "rg", "Select-String", "find"],
  execute: ["bash", "PowerShell", "execute_command", "run", "npm", "node", "terminal"],
  test: ["npm test", "cargo test", "go test", "pytest", "vitest", "jest"],
  build: ["npm run build", "tsc", "cargo build", "go build", "make"],
};

function toolSemanticScore(expected: string, actual: string): number {
  const el = expected.toLowerCase();
  const al = actual.toLowerCase();

  // 精确匹配
  if (el === al) return 1.0;

  // 包含匹配
  if (el.includes(al) || al.includes(el)) return 0.85;

  // 同类别匹配
  for (const [, tools] of Object.entries(TOOL_CATEGORIES)) {
    const inExpected = tools.some((t) => el.includes(t.toLowerCase()));
    const inActual = tools.some((t) => al.includes(t.toLowerCase()));
    if (inExpected && inActual) return 0.6;
  }

  return 0.0;
}

// ══════════════════════════════════════════════════════════════════
// StatisticalVerifier
// ══════════════════════════════════════════════════════════════════

export class StatisticalVerifier implements Verifier {
  readonly name = "statistical";
  readonly weight = 0.28;

  /**
   * 验证 ProtoSequence 的工具序列是否匹配实际工具调用记录。
   * 仅对 ProtoSequence 类型运行。
   */
  async verify(
    structure: ProtoStructure,
    context: VerificationContext,
  ): Promise<VerifierOutput> {
    if (structure.protoType !== "sequence") {
      return {
        value: 0.5, confidence: 0,
        evidence: "StatisticalVerifier only supports ProtoSequence",
        timestamp: Date.now(),
      };
    }

    const sequence = structure as ProtoSequence;
    const steps = sequence.structure.steps;
    if (!steps || steps.length === 0) {
      return {
        value: 0.5, confidence: 0,
        evidence: "ProtoSequence has no steps — cannot verify",
        timestamp: Date.now(),
      };
    }

    const toolCalls = context.toolCallTrace;
    const matchDetails: StepMatch[] = [];
    let totalScore = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      // Positional window: only match against tool calls near the expected position
      const startIdx = Math.max(0, i - 1);
      const endIdx = Math.min(toolCalls.length, i + 2); // ±1 window

      let bestScore = 0;
      let bestToolName: string | null = null;

      for (let j = startIdx; j < endIdx; j++) {
        const call = toolCalls[j];
        const score = toolSemanticScore(step.action, call.toolName);
        if (score > bestScore) {
          bestScore = score;
          bestToolName = call.toolName;
        }
      }

      matchDetails.push({
        stepPosition: step.position,
        expectedAction: step.action,
        matchedToolName: bestToolName,
        matchScore: bestScore,
      });

      totalScore += bestScore;
    }

    const avgScore = steps.length > 0 ? totalScore / steps.length : 0.5;

    return {
      value: avgScore,
      confidence: Math.min(1, steps.length / 5), // 步骤越多置信度越高
      evidence: `${steps.length} steps matched against ${toolCalls.length} tool calls — avg score ${avgScore.toFixed(2)}`,
      timestamp: Date.now(),
      matchDetails,
    };
  }
}
