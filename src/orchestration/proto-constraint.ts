/**
 * ProtoConstraint 管理模块 — M3 Step 1
 *
 * 纯函数模块（除 deprecateConstraint 外——该函数原地修改约束以支持链式调用）。
 * 不调用外部服务，不做 I/O。
 *
 * 架构参考: architech/praxis-architecture.md §3 (ProtoConstraint 类型), §7 (约束注入), §10 (before_tool_call)
 */

import type { ProtoConstraint, ProtoStructure, ConstraintSeverity } from "../cognitive/types";
import { transition } from "../analysis/structure-lifecycle";

// ══════════════════════════════════════════════════════════════════
// 约束过滤
// ══════════════════════════════════════════════════════════════════

/** Severity 排序权重 — 用于 sortBySeverity 和 checkConstraints 的 max-severity 比较 */
const SEVERITY_RANK: Readonly<Record<ConstraintSeverity, number>> = Object.freeze({
  block: 3,
  confirm: 2,
  warn: 1,
});

/**
 * 从 ProtoStructure 列表中提取活跃约束。
 * 活跃 = protoType === "constraint" AND lifecycle === "crystallized"。
 */
export function getActiveConstraints(structures: ProtoStructure[]): ProtoConstraint[] {
  return structures.filter(
    (s): s is ProtoConstraint =>
      s.protoType === "constraint" && s.lifecycle === "crystallized",
  );
}

// ══════════════════════════════════════════════════════════════════
// 排序
// ══════════════════════════════════════════════════════════════════

/**
 * 按 severity 降序排序: block → confirm → warn。
 * 相同 severity 保持原有相对顺序（稳定排序）。
 */
export function sortBySeverity(constraints: ProtoConstraint[]): ProtoConstraint[] {
  return [...constraints].sort((a, b) => {
    const rankA = SEVERITY_RANK[a.severity] ?? 0;
    const rankB = SEVERITY_RANK[b.severity] ?? 0;
    return rankB - rankA; // 降序
  });
}

// ══════════════════════════════════════════════════════════════════
// 废弃
// ══════════════════════════════════════════════════════════════════

/**
 * 废弃一个已结晶约束。推进生命周期到 deprecated。
 * 返回修改后的约束（原地修改 + 返回引用，方便链式调用）。
 *
 * 注：废弃操作受架构 §8 铁律保护——需人类审批。此函数仅执行状态转换。
 */
export function deprecateConstraint(
  constraint: ProtoConstraint,
  reason: string,
): ProtoConstraint {
  const originalLifecycle = constraint.lifecycle;
  const newLifecycle = transition(constraint, "deprecate");
  // 仅当转换有效（lifecycle 确实改变）时才应用副作用
  if (newLifecycle === originalLifecycle) {
    return constraint; // 无效转换 — 不修改任何状态
  }
  constraint.lifecycle = newLifecycle;
  constraint.updatedAt = Date.now();
  // 废弃理由写入 tentativeName 后缀供日志追踪和 /praxis ontology 展示
  // (M4+ 升级时改为写入 versionChain 作为结构化审计记录)
  constraint.tentativeName = `${constraint.tentativeName} [废弃: ${reason}]`;
  return constraint;
}

// ══════════════════════════════════════════════════════════════════
// Token 估算
// ══════════════════════════════════════════════════════════════════

/**
 * 估算约束列表注入到 prompt 后占用的 token 数。
 * 粗略估算：每个约束 ~40 tokens（名称 + severity + pattern + 格式化开销）。
 * 用于 Critical 压力下的预算控制——约束段永远不压缩，但需告知实际消耗。
 */
export function estimateConstraintTokens(constraints: ProtoConstraint[]): number {
  if (constraints.length === 0) return 0;
  // 每个约束 ~40 tokens（含格式化前缀）
  return constraints.length * 40;
}

// Re-export severity rank for constraint-validator (M3 Step 3)
export { SEVERITY_RANK };
