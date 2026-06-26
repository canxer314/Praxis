/**
 * ConceptVerifier — 对抗 prompt 概念验证 (M4.3.3)
 *
 * 原理: 对抗 prompt——"尝试为这个概念的反例辩护"。
 * 如果 LLM 能构建合理反例 → 概念置信度下调。
 *
 * 设计要点:
 *   - 仅在置信度 0.4-0.7 的结构上运行
 *   - 对抗方向 ≠ 建设方向 — 提供真正对立视角
 *   - 降权 0.05 反映 LLM 依赖风险
 *
 * 架构参考: §4 concept-verifier
 */

import type { LlmClient } from "../platform-adapter";
import type { ProtoStructure, ProtoConcept } from "../cognitive/types";
import type { Verifier, VerificationContext, VerifierOutput } from "./types";

// ══════════════════════════════════════════════════════════════════
// ConceptVerifier
// ══════════════════════════════════════════════════════════════════

export class ConceptVerifier implements Verifier {
  readonly name = "concept_verifier";
  readonly weight = 0.05; // M4: 降权反映 LLM 依赖风险

  constructor(private readonly llm: LlmClient) {}

  async verify(
    structure: ProtoStructure,
    context: VerificationContext,
  ): Promise<VerifierOutput> {
    if (structure.protoType !== "concept") {
      return {
        value: 0.5, confidence: 0,
        evidence: "ConceptVerifier only supports ProtoConcept",
        timestamp: Date.now(),
      };
    }

    // 仅在置信度 0.4-0.7 时运行
    if (structure.confidence < 0.4 || structure.confidence > 0.7) {
      return {
        value: 0.5, confidence: 0,
        evidence: `Structure confidence ${structure.confidence} outside verification range [0.4, 0.7]`,
        timestamp: Date.now(),
      };
    }

    const concept = structure as ProtoConcept;

    try {
      const prompt = buildAdversarialPrompt(concept);
      const result = await this.llm.analyze(prompt);

      if (!result.ok) {
        return {
          value: 0.5, confidence: 0,
          evidence: `LLM adversarial analysis failed: ${result.error?.message ?? "unknown"}`,
          timestamp: Date.now(),
        };
      }

      const parsed = JSON.parse(result.value.trim());
      const counterExampleCount = parsed.counterExamples?.length ?? 0;

      // 反例越多 → 概念越不可靠 → value 越低
      const value = counterExampleCount === 0 ? 1.0
        : counterExampleCount === 1 ? 0.7
        : counterExampleCount === 2 ? 0.4
        : 0.2;

      return {
        value,
        confidence: 0.6, // LLM-based, moderate confidence
        evidence: `${counterExampleCount} counter-examples found: ${parsed.summary ?? "none"}`,
        timestamp: Date.now(),
      };
    } catch {
      return {
        value: 0.5, confidence: 0,
        evidence: "Adversarial prompt failed — LLM unavailable or parse error",
        timestamp: Date.now(),
      };
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// Prompt 构造
// ══════════════════════════════════════════════════════════════════

function buildAdversarialPrompt(concept: ProtoConcept): string {
  return `You are an adversarial verifier. Your task: try to find counter-examples for the following concept definition. Be skeptical and thorough.

CONCEPT: "${concept.tentativeName}"
DEFINITION: "${concept.definition}"
RELATED CONCEPTS: ${concept.relatedConcepts.join(", ") || "none"}

QUESTION: In what scenarios might this concept definition be incorrect, incomplete, or inapplicable? Try to construct 2-3 realistic counter-examples.

Return JSON only: {"counterExamples": [{"scenario": "...", "why": "..."}], "summary": "one sentence", "severity": "low|medium|high"}

If you cannot find any valid counter-examples, return: {"counterExamples": [], "summary": "no counter-examples found", "severity": "none"}`;
}
