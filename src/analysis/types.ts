/**
 * Analysis 层 — Verifier 统一接口 (M4.3)
 *
 * 架构参考: §4 独立验证器, §11 analysis/
 */

import type { ProtoStructure } from "../cognitive/types";
import type { VerificationContext, VerifierOutput } from "../cognitive/types";

// Re-export types used by verifiers
export type { VerificationContext, VerifierOutput };

/** Verifier 统一接口 */
export interface Verifier {
  readonly name: string;
  readonly weight: number;
  /** 验证一个 ProtoStructure，返回 0-1 置信度信号 */
  verify(structure: ProtoStructure, context: VerificationContext): Promise<VerifierOutput>;
}
