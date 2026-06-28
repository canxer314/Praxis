/**
 * LlmClient 适配器测试 — Phase 6
 *
 * 将 M0Deps.LLMSubsystem 适配为 ConceptVerifier 需要的 LlmClient。
 * LLMSubsystem.analyze 与 LlmClient.analyze 签名完全兼容。
 */

import { describe, it, expect, vi } from "vitest";
import { adaptLlmClient } from "./llm-adapter";
import type { LLMSubsystem } from "../m0-deps";

describe("adaptLlmClient (Phase 6)", () => {
  it("LLMSubsystem.analyze 可用时返回 LlmClient", () => {
    const llm: LLMSubsystem = {
      analyzeTranscript: vi.fn().mockResolvedValue([]),
      extractProtoStructures: vi.fn().mockResolvedValue([]),
      analyze: vi.fn().mockResolvedValue({ ok: true, value: "result" }),
    };

    const client = adaptLlmClient(llm);
    expect(client).toBeDefined();
    expect(typeof client!.analyze).toBe("function");
  });

  it("返回的 LlmClient.analyze 委托给 LLMSubsystem.analyze", async () => {
    const analyzeSpy = vi.fn().mockResolvedValue({ ok: true, value: "test" });
    const llm: LLMSubsystem = {
      analyzeTranscript: vi.fn().mockResolvedValue([]),
      extractProtoStructures: vi.fn().mockResolvedValue([]),
      analyze: analyzeSpy,
    };

    const client = adaptLlmClient(llm);
    const result = await client!.analyze("test prompt");

    expect(analyzeSpy).toHaveBeenCalledWith("test prompt");
    expect(result.ok).toBe(true);
    expect(result.value).toBe("test");
  });

  it("LLMSubsystem.analyze 不存在时返回 null", () => {
    const llm: LLMSubsystem = {
      analyzeTranscript: vi.fn().mockResolvedValue([]),
      extractProtoStructures: vi.fn().mockResolvedValue([]),
      // analyze not provided
    };

    const client = adaptLlmClient(llm);
    expect(client).toBeNull();
  });

  it("LLMSubsystem 为 undefined 时返回 null", () => {
    const client = adaptLlmClient(undefined);
    expect(client).toBeNull();
  });

  it("analyze 失败时错误正常传播", async () => {
    const llm: LLMSubsystem = {
      analyzeTranscript: vi.fn().mockResolvedValue([]),
      extractProtoStructures: vi.fn().mockResolvedValue([]),
      analyze: vi.fn().mockResolvedValue({ ok: false, error: { code: "LLM_ERROR", message: "timeout" } }),
    };

    const client = adaptLlmClient(llm);
    const result = await client!.analyze("test");

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("LLM_ERROR");
  });
});
