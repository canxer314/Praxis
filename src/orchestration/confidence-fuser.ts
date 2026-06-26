/**
 * ConfidenceFuser — 7 源加权融合引擎 (M4.2)
 *
 * 职责:
 *   - 多信号源加权融合 → 单一置信度
 *   - 缺失信号源按比例重分配权重
 *   - 输出各源贡献分解 (审计用)
 *
 * 架构参考: §4 多源置信度融合
 */

import type { FusionWeights, SignalSourceInput, FusedConfidence, SourceContribution } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 默认权重 (架构 §4)
// ══════════════════════════════════════════════════════════════════

const DEFAULT_WEIGHTS: FusionWeights = {
  statistical: 0.28,       // M4: 吸收 concept 降权 0.03
  llm_marker: 0.25,
  user_correction: 0.12,
  role_verifier: 0.12,
  concept_verifier: 0.05,  // M4: 降权反映 LLM 依赖风险
  outcome_feedback: 0.10,
  mid_session: 0.08,
};

/** 融合所需的最少活跃源数 */
const MIN_SOURCES = 2;

// ══════════════════════════════════════════════════════════════════
// ConfidenceFuser
// ══════════════════════════════════════════════════════════════════

export class ConfidenceFuser {
  private readonly weights: FusionWeights;

  constructor(weights?: Partial<FusionWeights>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * 融合多个信号源输出 → 单一置信度。
   *
   * @param sources 可用信号源的输出数组
   * @returns FusedConfidence | null (< MIN_SOURCES 时返回 null)
   */
  fuse(sources: SignalSourceInput[]): FusedConfidence | null {
    // 去重: 同一 sourceName 取最新的
    const unique = deduplicateSources(sources);

    if (unique.length < MIN_SOURCES) return null;

    // 计算可用源的权重组
    const availableNames = new Set(unique.map((s) => s.sourceName));
    const redistributed = this.redistributeWeights(availableNames);

    // 加权融合
    let totalWeight = 0;
    let weightedSum = 0;
    const contributions: SourceContribution[] = [];

    for (const source of unique) {
      const weight = redistributed[source.sourceName as keyof FusionWeights];
      if (weight === undefined || weight === 0) continue;

      const contribution = weight * source.value;
      totalWeight += weight;
      weightedSum += contribution;

      contributions.push({
        sourceName: source.sourceName,
        weight,
        value: source.value,
        contribution,
      });
    }

    if (totalWeight === 0) return null;

    return {
      confidence: clamp(weightedSum / totalWeight),
      sourceCount: unique.length,
      contributions,
    };
  }

  /**
   * 缺失信号源 → 按比例重分配权重。
   * 缺失源的权重按比例分配给剩余可用源。
   */
  redistributeWeights(availableSources: Set<string>): FusionWeights {
    const result = { ...this.weights };
    let missingWeight = 0;

    for (const [key, weight] of Object.entries(result)) {
      if (!availableSources.has(key)) {
        missingWeight += weight;
        result[key as keyof FusionWeights] = 0;
      }
    }

    if (missingWeight > 0) {
      const availableEntries = Object.entries(result).filter(
        ([, w]) => w > 0,
      );
      if (availableEntries.length > 0) {
        const bonusPerSource = missingWeight / availableEntries.length;
        for (const [key] of availableEntries) {
          result[key as keyof FusionWeights] += bonusPerSource;
        }
      }
    }

    return result;
  }

  /**
   * 分解: 返回各信号源的贡献明细 (审计用)。
   */
  decompose(fused: FusedConfidence): SourceContribution[] {
    return fused.contributions;
  }

  /** 获取当前权重配置 */
  getWeights(): FusionWeights {
    return { ...this.weights };
  }
}

// ══════════════════════════════════════════════════════════════════
// 内部
// ══════════════════════════════════════════════════════════════════

function deduplicateSources(sources: SignalSourceInput[]): SignalSourceInput[] {
  const seen = new Map<string, SignalSourceInput>();
  for (const s of sources) {
    const existing = seen.get(s.sourceName);
    if (!existing || s.confidence > existing.confidence) {
      seen.set(s.sourceName, s);
    }
  }
  return [...seen.values()];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
