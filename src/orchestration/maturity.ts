/**
 * deriveMaturity — Phase 7: 根据 session 计数推导认知成熟度
 *
 * §7 双轴交互: 成熟度决定语义粒度 (token 预算 × 信息密度)。
 *   Novice (0-10):    粗粒度概括, LLM bootstrap 通用知识
 *   Competent (10-50): 中等粒度, 基于团队历史数据
 *   Expert (50+):      细粒度, 高信息密度 — 量化数据 + 具体陷阱
 */

export type MaturityLevel = "novice" | "competent" | "expert";

/**
 * 从 session 计数推导认知成熟度。
 * 安全降级: 负值 → "novice"。
 */
export function deriveMaturity(sessionCount: number): MaturityLevel {
  if (sessionCount < 10) return "novice";
  if (sessionCount < 50) return "competent";
  return "expert";
}
