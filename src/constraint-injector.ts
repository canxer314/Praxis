/**
 * Constraint Injector — M3 Step 2
 *
 * 纯函数模块。将已结晶 ProtoConstraint 格式化为 CRITICAL CONSTRAINTS 注入段。
 * 在 session_start 时由 SessionStartHandler 调用，注入在 Tier A/B/C 之前。
 * 约束段在 Critical 压力下仍然注入（不压缩）。
 *
 * 架构参考: architech/praxis-architecture.md §7 (约束注入段), §10 (session_start)
 */

import type { ProtoConstraint } from "./cognitive/types";
import { sortBySeverity, estimateConstraintTokens } from "./proto-constraint";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface InjectConstraintsInput {
  constraints: ProtoConstraint[];
  /** 注入段最大 token 数（默认 150）。超出时按 severity 优先级截断 */
  maxTokens?: number;
}

export interface InjectConstraintsOutput {
  /** 格式化的 CRITICAL CONSTRAINTS 注入文本 */
  injectionText: string;
  /** 实际 token 估算数 */
  tokenCount: number;
  /** 注入的约束 ID 列表 */
  constraintIds: string[];
}

// ══════════════════════════════════════════════════════════════════
// 格式化
// ══════════════════════════════════════════════════════════════════

/**
 * 格式化单个约束为一行注入文本。
 *
 * 格式: "N. 名称 [置信度 X.XX, M次观察]" 或 "N. 名称 [用户明确教导]"
 */
function formatConstraintLine(constraint: ProtoConstraint, index: number): string {
  const meta =
    constraint.source === "user_taught"
      ? "用户明确教导"
      : `置信度 ${constraint.confidence.toFixed(2)}, ${constraint.observationsCount}次观察`;
  return `${index + 1}. ${constraint.tentativeName} [${meta}]`;
}

// ══════════════════════════════════════════════════════════════════
// 注入
// ══════════════════════════════════════════════════════════════════

/**
 * 将已结晶约束格式化为 CRITICAL CONSTRAINTS 注入段。
 * 架构 §7 原文格式: ⛔ 标记 + severity 排序 + 置信度/观察计数。
 *
 * 约束段在 Critical 压力下仍然注入（不压缩）。
 * 超出 maxTokens 时按 severity 优先级截断（block > confirm > warn）。
 */
export function injectConstraints(input: InjectConstraintsInput): InjectConstraintsOutput {
  const { constraints, maxTokens = 150 } = input;

  if (constraints.length === 0) {
    return { injectionText: "", tokenCount: 0, constraintIds: [] };
  }

  // 按 severity 降序排序: block → confirm → warn
  const sorted = sortBySeverity(constraints);

  // Token 预算控制: 超出时按 severity 截断 — 但 NEVER 丢弃 block 级约束
  // (T20: 安全护栏不可因 token 预算被静默丢弃; warn 先丢, 再 confirm, block 永留)。
  const estimated = estimateConstraintTokens(sorted);
  let selected = sorted;
  if (estimated > maxTokens) {
    const PER = 40; // 与 estimateConstraintTokens 估算一致
    const kept: ProtoConstraint[] = [];
    let used = 0;
    for (const c of sorted) {
      if (c.severity === "block") { kept.push(c); used += PER; } // 全部 block, 无论预算
    }
    for (const c of sorted) {
      if (c.severity === "confirm" && used + PER <= maxTokens) { kept.push(c); used += PER; }
    }
    for (const c of sorted) {
      if (c.severity === "warn" && used + PER <= maxTokens) { kept.push(c); used += PER; }
    }
    selected = kept;
  }

  // 格式化
  const lines: string[] = [];
  lines.push("⛔ CRITICAL CONSTRAINTS (不可违反):");
  for (let i = 0; i < selected.length; i++) {
    lines.push(formatConstraintLine(selected[i], i));
  }
  lines.push("");
  lines.push("[约束与流程冲突时，约束优先]");

  const injectionText = lines.join("\n");
  const tokenCount = estimateConstraintTokens(selected);

  return {
    injectionText,
    tokenCount,
    constraintIds: selected.map((c) => c.id),
  };
}
