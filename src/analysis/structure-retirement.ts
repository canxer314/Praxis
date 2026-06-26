/**
 * StructureRetirement — 退役与亚存在管理 (M4.6)
 *
 * 被取代的结构不删除，进入"亚存在"状态。
 * 复用 structure-lifecycle.ts 的已有 TRANSITIONS (deprecate/reactivate)。
 *
 * M4.6 真正的新工作: RetiredStructure 元数据存储。
 *
 * 架构参考: §3 退役与亚存在
 */

import type { ProtoStructure, RetiredStructure, ReactivationContext, VersionSnapshot } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// StructureRetirement
// ══════════════════════════════════════════════════════════════════

export class StructureRetirement {
  /** 退役一个结构: 保存元数据, 返回 RetiredStructure */
  retire(
    structure: ProtoStructure,
    supersededBy: string[],
    lessons: string[],
  ): RetiredStructure {
    return {
      originalId: structure.id,
      supersededBy,
      retiredAt: Date.now(),
      keyLessons: lessons,
      reactivationConditions: {
        newStructureConfidenceFallsBelow: 0.3,
        oldScenarioReappears: true,
        manualReactivation: true,
      },
      originalVersionChain: [...structure.versionChain],
    };
  }

  /**
   * 检查是否应该重新激活退役结构。
   */
  checkReactivation(
    retired: RetiredStructure,
    context: ReactivationContext,
  ): { shouldReactivate: boolean; reason: string } {
    // Condition 1: superseding structure confidence fell below threshold
    if (context.supersedingConfidence < retired.reactivationConditions.newStructureConfidenceFallsBelow) {
      return {
        shouldReactivate: true,
        reason: `Superseding confidence (${context.supersedingConfidence.toFixed(2)}) fell below threshold (${retired.reactivationConditions.newStructureConfidenceFallsBelow})`,
      };
    }

    // Condition 2: manual reactivation requested
    if (context.manualRequest) {
      return { shouldReactivate: true, reason: "Manual reactivation requested" };
    }

    return { shouldReactivate: false, reason: "No reactivation conditions met" };
  }

  /**
   * 重新激活: 恢复到 experimental 状态 (调用方使用 structure-lifecycle 的 transition)。
   * 此方法返回恢复后的结构，调用方负责更新 lifecycle 状态。
   */
  reactivate(retired: RetiredStructure): Partial<ProtoStructure> {
    return {
      confidence: 0.3, // Reset confidence — needs re-verification
      lifecycle: "experimental",
      updatedAt: Date.now(),
    };
  }
}
