/**
 * StructureLifecycle — ProtoStructure 生命周期状态机 (M1)
 *
 * 职责:
 *   - 管理 6 种生命周期状态的转换
 *   - 结晶化/退化门控逻辑
 *   - 验证器接口预留 (M4 实现)
 *
 * 架构参考: §3 生命周期与版本链
 */

import type { ProtoStructure, LifecycleStage } from "../cognitive/types";
import { QuineanGating, type GatingContext } from "./quinean-gating";

// ══════════════════════════════════════════════════════════════════
// 状态机核心
// ══════════════════════════════════════════════════════════════════

/** 生命周期事件 */
export type LifecycleEvent =
  | "advance"           // 推进到下一状态
  | "crystallize"       // 尝试结晶化
  | "degrade"           // 衰退
  | "deprecate"         // 标记废弃
  | "reject"            // 标记拒绝
  | "reactivate";       // 重新激活 (degraded → experimental)

/**
 * 状态转移表
 */
const TRANSITIONS: Record<LifecycleStage, Partial<Record<LifecycleEvent, LifecycleStage>>> = {
  hypothesized: {
    advance: "candidate",
    reject: "rejected",
  },
  candidate: {
    advance: "experimental",
    reject: "rejected",
  },
  experimental: {
    crystallize: "crystallized",
    reject: "rejected",
  },
  crystallized: {
    degrade: "experimental",  // 衰退可逆 → 回到 experimental
    deprecate: "deprecated",
  },
  deprecated: {
    reactivate: "experimental",  // 旧场景重现 → 重新激活
  },
  rejected: {
    // rejected 是不可逆终态
  },
};

/**
 * 执行生命周期状态转换。返回新的 lifecycle 状态。
 * 无效转换 → 返回原状态
 */
export function transition(
  structure: ProtoStructure,
  event: LifecycleEvent,
): LifecycleStage {
  const current = structure.lifecycle;
  const allowed = TRANSITIONS[current];
  if (!allowed || !(event in allowed)) {
    return current; // 无效转换 → noop
  }
  return allowed[event]!;
}

// ══════════════════════════════════════════════════════════════════
// 门控逻辑 (五重门控, 架构 §3)
// ══════════════════════════════════════════════════════════════════

/**
 * 检查基础结晶化条件 (M1 实现的 2/6 条件)
 * M4 补充条件 3-6
 */
export function canCrystallize(
  structure: ProtoStructure,
  opts?: { gatingContext?: GatingContext },
): {
  allowed: boolean;
  blockedBy: string[];
} {
  const blocked: string[] = [];

  // 门控 1: 置信度
  if (structure.confidence < 0.8) {
    blocked.push(`置信度不足: ${structure.confidence} < 0.80`);
  }

  // 门控 2: 观察次数
  if (structure.observationsCount < 5) {
    blocked.push(`观察次数不足: ${structure.observationsCount} < 5`);
  }

  // 门控 3-5: 奎因式门控 (necessity / sufficiency / parsimony)
  // 仅当调用方提供 gatingContext (遥测数据) 时运行 — 需要统计验证器/注意力遥测数据。
  // 无 context 时跳过 (无法评估) — 不阻塞；调用方应在积累足够数据后再结晶化。
  // 这修复了 M4.4: 此前一个高置信度但从不被使用的"僵尸结构"会通过门控 1-2 直接结晶化,
  // 违反 §3 充分性检验。现在带 context 时会被 QuineanGating 拒绝。
  if (opts?.gatingContext) {
    const gating = new QuineanGating();
    const result = gating.check(structure, opts.gatingContext);
    if (!result.passed) {
      blocked.push(...result.blockedBy);
    }
  }
  // 门控 6: 人类审批 — 外部调用

  return {
    allowed: blocked.length === 0,
    blockedBy: blocked,
  };
}

/**
 * 检查退化条件
 */
export function canDegrade(
  structure: ProtoStructure,
  contradictionCount: number,
  daysSinceLastObserved: number,
): {
  shouldDegrade: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  // 条件 1: ≥ 3 个反例
  if (contradictionCount >= 3) {
    reasons.push(`累计 ${contradictionCount} 个反例`);
  }

  // 条件 2: 置信度 < 0.2 + 60 天未观察
  if (structure.confidence < 0.2 && daysSinceLastObserved >= 60) {
    reasons.push(`置信度 ${structure.confidence} + ${daysSinceLastObserved} 天未观察`);
  }

  return {
    shouldDegrade: reasons.length > 0,
    reasons,
  };
}

/**
 * 检查是否应该标记为 inactive
 */
export function shouldMarkInactive(
  structure: ProtoStructure,
  daysSinceLastUsed: number,
  inactiveThresholdDays = 60,
): boolean {
  return (
    structure.lifecycle === "crystallized" &&
    daysSinceLastUsed >= inactiveThresholdDays
  );
}

// ══════════════════════════════════════════════════════════════════
// 验证器接口 (M4 实现)
// ══════════════════════════════════════════════════════════════════

export interface CrystallizationVerifier {
  /** 必要性: 移除结构后预测准确率是否下降？ */
  checkNecessity(structure: ProtoStructure): Promise<boolean>;
  /** 充分性: 该结构被使用的 session 预测准确率是否显著更高？ */
  checkSufficiency(structure: ProtoStructure): Promise<boolean>;
  /** 奥卡姆剃刀: 是否存在更简单的替代结构？ */
  checkParsimony(structure: ProtoStructure): Promise<boolean>;
}

// NOTE (T2/M4.4): QuineanGating is now wired directly into canCrystallize via an
// explicit `gatingContext` param, so the previous module-global `verifier` singleton
// (a process-shared mutable field that violated session isolation — see T13) has been
// removed. Callers pass telemetry context per-call instead of mutating global state.
