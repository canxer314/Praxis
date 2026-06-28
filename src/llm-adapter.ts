/**
 * LlmClient 适配器 — Phase 6
 *
 * 将 M0Deps.LLMSubsystem 适配为 ConceptVerifier 需要的 LlmClient。
 * LLMSubsystem.analyze 与 LlmClient.analyze 签名完全兼容 — 仅做 null 检查。
 *
 * 架构参考: §4 (7 源融合), §12 原则 2 (LLM 不可靠 → 需独立信号)
 */

import type { LlmClient } from "./platform-adapter";
import type { LLMSubsystem } from "./m0-deps";

/**
 * 将 LLMSubsystem 适配为 LlmClient。
 * LLMSubsystem.analyze 和 LlmClient.analyze 签名相同:
 *   analyze(prompt: string): Promise<Result<string>>
 *
 * @returns LlmClient 或 null (analyze 方法不存在时)
 */
export function adaptLlmClient(llm: LLMSubsystem | undefined): LlmClient | null {
  if (!llm?.analyze) return null;
  return {
    analyze: (prompt: string) => llm.analyze!(prompt),
  };
}
