/**
 * Constraint Validator — M3 Step 3
 *
 * 纯函数模块。在 before_tool_call 时检查 toolName 是否命中任何活跃约束的 rulePatterns。
 * 收集所有匹配，取最大 severity（block > confirm > warn）。
 *
 * 架构参考: architech/praxis-architecture.md §10 (before_tool_call), §3 (ProtoConstraint)
 */

import type { ProtoConstraint, ConstraintSeverity } from "./cognitive/types";
import { SEVERITY_RANK } from "./proto-constraint";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface ConstraintCheckResult {
  violated: boolean;
  constraintId?: string;
  severity?: ConstraintSeverity;
  matchedPattern?: string;
}

// ══════════════════════════════════════════════════════════════════
// 验证
// ══════════════════════════════════════════════════════════════════

/**
 * 检查 toolName 是否命中任何活跃约束的 rulePatterns。
 *
 * 收集所有匹配的约束，取最大 severity（block > confirm > warn）。
 * Substring 匹配，大小写不敏感。
 *
 * @returns 最严重的命中结果，或无命中时返回 { violated: false }
 */
export function checkConstraints(
  toolName: string,
  activeConstraints: ProtoConstraint[],
): ConstraintCheckResult {
  if (!toolName || activeConstraints.length === 0) {
    return { violated: false };
  }

  const lowerName = toolName.toLowerCase();
  const matches: Array<{
    constraint: ProtoConstraint;
    severity: ConstraintSeverity;
    pattern: string;
  }> = [];

  for (const constraint of activeConstraints) {
    for (const pattern of constraint.rulePatterns) {
      if (!pattern) continue; // 跳过空 pattern（匹配一切，无意义）
      if (lowerName.includes(pattern.toLowerCase())) {
        matches.push({
          constraint,
          severity: constraint.severity,
          pattern,
        });
        break; // 每个约束只取第一个命中 pattern
      }
    }
  }

  if (matches.length === 0) {
    return { violated: false };
  }

  // 取最大 severity
  const worst = matches.reduce((worstSoFar, current) => {
    const currentRank = SEVERITY_RANK[current.severity] ?? 0;
    const worstRank = SEVERITY_RANK[worstSoFar.severity] ?? 0;
    return currentRank > worstRank ? current : worstSoFar;
  });

  return {
    violated: true,
    constraintId: worst.constraint.id,
    severity: worst.severity,
    matchedPattern: worst.pattern,
  };
}
