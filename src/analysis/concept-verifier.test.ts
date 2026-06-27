/**
 * concept-verifier.test.ts — T14: 对抗 prompt 概念验证测试
 *
 * 覆盖:
 *   - 非 concept 类型 → neutral
 *   - 置信度超出 [0.4, 0.7] 范围 → 跳过
 *   - LLM 返回反例 → value 下调
 *   - LLM 无反例 → value=1.0
 *   - LLM 失败 → neutral fallback
 */

import { describe, it, expect, vi } from "vitest";
import { ConceptVerifier } from "./concept-verifier";
import type { ProtoConcept, VerificationContext } from "../cognitive/types";
import type { LlmClient } from "../platform-adapter";

function makeConcept(overrides: Partial<ProtoConcept> = {}): ProtoConcept {
  return {
    id: "concept-1",
    protoType: "concept",
    tentativeName: "依赖注入",
    scenarioId: "general",
    confidence: 0.55,
    observationsCount: 3,
    adoptionRate: 0.4,
    lifecycle: "experimental",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    definition: "将对象的依赖关系从内部创建改为外部注入的设计模式",
    relatedConcepts: ["控制反转", "服务容器"],
    ...overrides,
  };
}

function makeCtx(): VerificationContext {
  return { sessionId: "test", toolCallTrace: [], transcript: "" };
}

function makeLlm(response: string): LlmClient {
  return {
    analyze: vi.fn().mockResolvedValue({ ok: true, value: response }),
    analyzeTranscript: vi.fn(),
    extractProtoStructures: vi.fn(),
  };
}

describe("ConceptVerifier", () => {
  it("verifier name and weight are correct", () => {
    const v = new ConceptVerifier(makeLlm("{}"));
    expect(v.name).toBe("concept_verifier");
    expect(v.weight).toBe(0.05);
  });

  it("非 concept 类型 → neutral (confidence=0)", async () => {
    const v = new ConceptVerifier(makeLlm("{}"));
    const result = await v.verify({
      id: "seq-1",
      protoType: "sequence",
      tentativeName: "序列",
      scenarioId: "general",
      confidence: 0.5,
      observationsCount: 3,
      adoptionRate: 0.4,
      lifecycle: "experimental",
      relations: [],
      versionChain: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, makeCtx());
    expect(result.confidence).toBe(0);
    expect(result.evidence).toContain("ConceptVerifier only supports ProtoConcept");
  });

  it("置信度 < 0.4 → 跳过验证", async () => {
    const v = new ConceptVerifier(makeLlm("{}"));
    const concept = makeConcept({ confidence: 0.3 });
    const result = await v.verify(concept, makeCtx());
    expect(result.confidence).toBe(0);
    expect(result.evidence).toContain("outside verification range");
  });

  it("置信度 > 0.7 → 跳过验证", async () => {
    const v = new ConceptVerifier(makeLlm("{}"));
    const concept = makeConcept({ confidence: 0.85 });
    const result = await v.verify(concept, makeCtx());
    expect(result.confidence).toBe(0);
  });

  it("0 个反例 → value=1.0", async () => {
    const llm = makeLlm(JSON.stringify({ counterExamples: [], summary: "no counter-examples found", severity: "none" }));
    const v = new ConceptVerifier(llm);
    const result = await v.verify(makeConcept(), makeCtx());
    expect(result.value).toBe(1.0);
    expect(result.evidence).toContain("0 counter-examples");
  });

  it("1 个反例 → value=0.7", async () => {
    const llm = makeLlm(JSON.stringify({
      counterExamples: [{ scenario: "简单对象", why: "DI 过度工程化" }],
      summary: "1 counter-example",
      severity: "low",
    }));
    const v = new ConceptVerifier(llm);
    const result = await v.verify(makeConcept({ confidence: 0.5 }), makeCtx());
    expect(result.value).toBe(0.7);
  });

  it("2 个反例 → value=0.4", async () => {
    const llm = makeLlm(JSON.stringify({
      counterExamples: [{ scenario: "A" }, { scenario: "B" }],
      summary: "2 counter-examples",
      severity: "medium",
    }));
    const v = new ConceptVerifier(llm);
    const result = await v.verify(makeConcept({ confidence: 0.5 }), makeCtx());
    expect(result.value).toBe(0.4);
  });

  it("3+ 个反例 → value=0.2", async () => {
    const llm = makeLlm(JSON.stringify({
      counterExamples: [{ scenario: "A" }, { scenario: "B" }, { scenario: "C" }, { scenario: "D" }],
      summary: "many counter-examples",
      severity: "high",
    }));
    const v = new ConceptVerifier(llm);
    const result = await v.verify(makeConcept({ confidence: 0.5 }), makeCtx());
    expect(result.value).toBe(0.2);
  });

  it("LLM analyze 失败 → neutral fallback", async () => {
    const llm: LlmClient = {
      analyze: vi.fn().mockResolvedValue({ ok: false, error: { message: "LLM down" } }),
      analyzeTranscript: vi.fn(),
      extractProtoStructures: vi.fn(),
    };
    const v = new ConceptVerifier(llm);
    const result = await v.verify(makeConcept(), makeCtx());
    expect(result.confidence).toBe(0);
    expect(result.evidence).toContain("failed");
  });

  it("LLM 返回无效 JSON → neutral fallback", async () => {
    const llm = makeLlm("not valid json at all {");
    const v = new ConceptVerifier(llm);
    const result = await v.verify(makeConcept({ confidence: 0.5 }), makeCtx());
    expect(result.confidence).toBe(0);
  });

  it("处理 markdown fences 包裹的 JSON", async () => {
    const llm = makeLlm("```json\n{\"counterExamples\": [], \"summary\": \"none\", \"severity\": \"none\"}\n```");
    const v = new ConceptVerifier(llm);
    const result = await v.verify(makeConcept({ confidence: 0.5 }), makeCtx());
    expect(result.value).toBe(1.0);
  });
});
