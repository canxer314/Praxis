/**
 * Constraint Validator — M3 Step 3
 *
 * 纯函数模块。在 before_tool_call 时检查 toolName 是否命中任何活跃约束的 rulePatterns。
 * 收集所有匹配，取最大 severity（block > confirm > warn）。
 *
 * 架构参考: architech/praxis-architecture.md §10 (before_tool_call), §3 (ProtoConstraint)
 */

import type { ProtoConstraint, ConstraintSeverity } from "../cognitive/types";
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
/**
 * T4: 锚定 token 匹配 — 避免 substring 假阳 (如 pattern "rm" 命中 "confirm"/"form")。
 * 匹配规则: 精确 / token (按 _ - . / : 空格 分隔) / 多词 pattern 全部 token 命中 / toolParams 字符串值包含。
 * 注意: 仍无法表达"先 backup 后 migrate"这类状态前置条件 (需调用方维护工具调用历史 — 后续 follow-up)。
 */
function matchesPattern(
  pattern: string,
  toolName: string,
  toolParams?: Record<string, unknown>,
): boolean {
  const p = pattern.toLowerCase();
  if (!p) return false;
  const lowerName = toolName.toLowerCase();
  if (lowerName === p) return true;
  const tokens = lowerName.split(/[_\-.:/\s]+/).filter(Boolean);
  if (tokens.includes(p)) return true;
  const pWords = p.split(/[_\-.:/\s]+/).filter(Boolean);
  if (pWords.length > 1 && pWords.every((w) => tokens.includes(w))) return true;
  if (toolParams) {
    for (const v of Object.values(toolParams)) {
      if (typeof v === "string" && v.toLowerCase().includes(p)) return true;
    }
  }
  return false;
}

export function checkConstraints(
  toolName: string,
  activeConstraints: ProtoConstraint[],
  toolParams?: Record<string, unknown>,
): ConstraintCheckResult {
  if (!toolName || activeConstraints.length === 0) {
    return { violated: false };
  }

  const matches: Array<{
    constraint: ProtoConstraint;
    severity: ConstraintSeverity;
    pattern: string;
  }> = [];

  for (const constraint of activeConstraints) {
    for (const pattern of constraint.rulePatterns) {
      if (!pattern) continue; // 跳过空 pattern（匹配一切，无意义）
      if (matchesPattern(pattern, toolName, toolParams)) {
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
