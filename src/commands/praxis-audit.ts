/**
 * Praxis Audit — 认知健康度报告 (M5.5)
 *
 * 职责:
 *   - 僵尸结构检测 (adoptionRate < 20% AND confidence > 0.7)
 *   - 低估结构检测 (adoptionRate > 60% AND confidence < 0.4)
 *   - 约束违反统计
 *   - 衰退警告
 *   - 置信度分布直方图
 *
 * 架构参考: §13 /praxis audit
 */

import type { M0Deps } from "../m0-deps";
import type { ProtoStructure } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface AuditReport {
  generatedAt: number;
  totalStructures: number;
  zombies: ZombieEntry[];
  underestimated: UnderestimatedEntry[];
  violations: ViolationEntry[];
  decayWarnings: DecayWarning[];
  confidenceDistribution: ConfidenceBucket[];
  /** M6: StructuralGap 信号 (从 audit_log entries 读取) */
  structuralGapSignals: StructuralGapSignalEntry[];
  /** M6: Meta Layer 审计数据 */
  architectureAudit: Record<string, unknown> | null;
  categoryAudit: Record<string, unknown> | null;
}

export interface StructuralGapSignalEntry {
  signalType: number;
  detectedAt: number;
  evidence: Record<string, unknown>;
}

export interface ZombieEntry {
  id: string;
  name: string;
  confidence: number;
  adoptionRate: number;
}

export interface UnderestimatedEntry {
  id: string;
  name: string;
  confidence: number;
  adoptionRate: number;
}

export interface ViolationEntry {
  constraintId: string;
  violationCount: number;
  lastViolatedAt: number | null;
}

export interface DecayWarning {
  structureId: string;
  daysSinceLastUse: number;
}

export interface ConfidenceBucket {
  range: string;
  count: number;
}

// ══════════════════════════════════════════════════════════════════
// 报告生成
// ══════════════════════════════════════════════════════════════════

export async function generateAuditReport(deps: M0Deps): Promise<AuditReport> {
  const now = Date.now();
  const structures = await loadStructures(deps);

  const zombies: ZombieEntry[] = [];
  const underestimated: UnderestimatedEntry[] = [];
  const decayWarnings: DecayWarning[] = [];
  const distribution = initBuckets();

  for (const s of structures) {
    // 置信度分布
    addToBucket(distribution, s.confidence);

    // 僵尸检测
    if (s.adoptionRate < 0.2 && s.confidence > 0.7) {
      zombies.push({ id: s.id, name: s.tentativeName, confidence: s.confidence, adoptionRate: s.adoptionRate });
    }

    // 低估检测
    if (s.adoptionRate > 0.6 && s.confidence < 0.4) {
      underestimated.push({ id: s.id, name: s.tentativeName, confidence: s.confidence, adoptionRate: s.adoptionRate });
    }

    // 衰退警告: 60 天未更新
    const daysSince = (now - (s.updatedAt ?? s.createdAt)) / (24 * 60 * 60 * 1000);
    if (daysSince > 60 && s.lifecycle !== "deprecated" && s.lifecycle !== "rejected") {
      decayWarnings.push({ structureId: s.id, daysSinceLastUse: Math.round(daysSince) });
    }
  }

  // 约束违反统计 + StructuralGap 信号 (从 audit_log slot entries 读取)
  const violations: ViolationEntry[] = [];
  const structuralGapSignals: StructuralGapSignalEntry[] = [];
  try {
    const result = await deps.memory.getSlot("audit_log");
    if (result.ok && result.value) {
      const log = result.value as Record<string, unknown>;
      const entries = Array.isArray(log.entries) ? log.entries as Array<Record<string, unknown>> : [];
      for (const e of entries) {
        if (e.type === "constraint_violation") {
          const detail = (e.detail ?? {}) as Record<string, unknown>;
          violations.push({
            constraintId: String(detail.constraintId ?? e.source ?? "unknown"),
            violationCount: 1,
            lastViolatedAt: typeof e.timestamp === "number" ? e.timestamp : null,
          });
        } else if (e.type === "structural_gap_signal") {
          structuralGapSignals.push({
            signalType: typeof (e.detail as Record<string, unknown>)?.signalType === "number"
              ? (e.detail as Record<string, unknown>).signalType as number
              : 0,
            detectedAt: typeof e.timestamp === "number" ? e.timestamp : now,
            evidence: (e.detail ?? {}) as Record<string, unknown>,
          });
        }
      }
    }
  } catch { /* audit_log 不可用 */ }

  // M6: 读取 Meta Layer 审计数据
  let architectureAudit: Record<string, unknown> | null = null;
  let categoryAudit: Record<string, unknown> | null = null;
  try {
    const archResult = await deps.memory.getSlot("architecture_audit");
    if (archResult.ok && archResult.value) architectureAudit = archResult.value as Record<string, unknown>;
  } catch { /* 降级 */ }
  try {
    const catResult = await deps.memory.getSlot("category_audit");
    if (catResult.ok && catResult.value) categoryAudit = catResult.value as Record<string, unknown>;
  } catch { /* 降级 */ }

  return {
    generatedAt: now,
    totalStructures: structures.length,
    zombies,
    underestimated,
    violations,
    decayWarnings,
    confidenceDistribution: distribution,
    structuralGapSignals,
    architectureAudit,
    categoryAudit,
  };
}

// ══════════════════════════════════════════════════════════════════
// 格式化输出
// ══════════════════════════════════════════════════════════════════

export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push("## Praxis 认知健康度审计");
  lines.push(`> 生成时间: ${new Date(report.generatedAt).toISOString()}`);
  lines.push(`> 结构总数: ${report.totalStructures}`);
  lines.push("");

  // 置信度分布
  lines.push("### 置信度分布");
  for (const b of report.confidenceDistribution) {
    if (b.count === 0) continue;
    const bar = "█".repeat(Math.min(b.count, 30));
    lines.push(`  ${b.range}: ${bar} ${b.count}`);
  }
  lines.push("");

  // 僵尸结构
  if (report.zombies.length > 0) {
    lines.push(`### 僵尸结构 (${report.zombies.length})`);
    lines.push("| ID | 名称 | 置信度 | 采纳率 |");
    lines.push("|----|------|--------|--------|");
    for (const z of report.zombies) {
      lines.push(`| ${z.id} | ${z.name} | ${z.confidence.toFixed(2)} | ${(z.adoptionRate * 100).toFixed(0)}% |`);
    }
    lines.push("");
  } else {
    lines.push("### 僵尸结构: 无");
    lines.push("");
  }

  // 低估结构
  if (report.underestimated.length > 0) {
    lines.push(`### 低估结构 (${report.underestimated.length})`);
    lines.push("| ID | 名称 | 置信度 | 采纳率 |");
    lines.push("|----|------|--------|--------|");
    for (const u of report.underestimated) {
      lines.push(`| ${u.id} | ${u.name} | ${u.confidence.toFixed(2)} | ${(u.adoptionRate * 100).toFixed(0)}% |`);
    }
    lines.push("");
  } else {
    lines.push("### 低估结构: 无");
    lines.push("");
  }

  // 衰退警告
  if (report.decayWarnings.length > 0) {
    lines.push(`### 衰退警告 (${report.decayWarnings.length})`);
    for (const d of report.decayWarnings) {
      lines.push(`  - ${d.structureId}: ${d.daysSinceLastUse} 天未更新`);
    }
    lines.push("");
  }

  // 约束违反 (按 constraintId 聚合)
  const aggViolations = aggregateViolations(report.violations);
  if (aggViolations.length > 0) {
    lines.push(`### 约束违反统计 (${aggViolations.length} 类)`);
    // 按违反次数降序排序
    const sorted = [...aggViolations].sort((a, b) => b.count - a.count);
    for (const v of sorted.slice(0, 10)) {
      lines.push(`  - ${v.constraintId}: ${v.count} 次违反`);
    }
    if (sorted.length > 10) lines.push(`  ... 共 ${sorted.length} 类`);
    lines.push("");
  } else {
    lines.push("### 约束违反: 无");
    lines.push("");
  }

  // M6: StructuralGap 信号
  if (report.structuralGapSignals && report.structuralGapSignals.length > 0) {
    const signalNames: Record<number, string> = { 1: "ProtoTask decline", 2: "Cross-scenario failure", 3: "Correction cluster", 4: "Skill stagnation", 5: "Escalation anomaly" };
    lines.push(`### StructuralGap 信号 (${report.structuralGapSignals.length})`);
    for (const s of report.structuralGapSignals) {
      const name = signalNames[s.signalType] ?? `信号 #${s.signalType}`;
      lines.push(`  - ${name} — ${new Date(s.detectedAt).toLocaleDateString()}`);
    }
    lines.push("");
  }

  // M6: Meta Layer 审计
  if (report.architectureAudit) {
    const a = report.architectureAudit;
    lines.push("### Meta Layer — 架构审计");
    lines.push(`  综合健康度: ${typeof a.overallHealth === "number" ? (a.overallHealth * 100).toFixed(0) + "%" : "N/A"}`);
    lines.push(`  僵尸结构率: ${typeof a.zombieRate === "number" ? (a.zombieRate * 100).toFixed(0) + "%" : "N/A"}`);
    lines.push(`  最弱维度: ${String(a.weakestDimension ?? "N/A")}`);
    const recs = a.recommendations as Array<Record<string, unknown>> | undefined;
    if (recs && recs.length > 0) {
      for (const r of recs.slice(0, 5)) {
        lines.push(`  - [${r.severity}] ${r.description}`);
      }
    }
    lines.push("");
  }

  if (report.categoryAudit) {
    const c = report.categoryAudit;
    const status = String(c.status ?? "ok");
    lines.push("### Meta Layer — 范畴审计");
    if (status === "insufficient_data") {
      lines.push(`  状态: 数据不足 — ${String(c.message ?? "等待积累")}`);
    } else {
      const spots = c.blindSpots as Array<Record<string, unknown>> | undefined;
      const forks = c.domainForks as Array<Record<string, unknown>> | undefined;
      if (spots && spots.length > 0) {
        lines.push(`  范畴盲区: ${spots.length} 个`);
        for (const s of spots) {
          lines.push(`    - ${s.pattern} (诊断: ${s.diagnosis})`);
        }
      } else {
        lines.push("  范畴盲区: 无");
      }
      if (forks && forks.length > 0) {
        lines.push(`  领域分叉提议: ${forks.length} 个`);
      }
      // 类型健康度
      const health = c.existingTypesHealth as Array<Record<string, unknown>> | undefined;
      if (health) {
        for (const h of health) {
          lines.push(`  ${h.protoType}: ${typeof h.health === "number" ? (h.health * 100).toFixed(0) + "%" : "N/A"}`);
        }
      }
    }
    lines.push("");
  }

  if (report.totalStructures === 0) {
    lines.push("_(无已结晶结构 — 系统处于冷启动阶段)_");
  }

  return lines.join("\n");
}

/** 聚合 ViolationEntry 按 constraintId 分组 */
function aggregateViolations(violations: Array<{ constraintId: string; violationCount: number }>): Array<{ constraintId: string; count: number }> {
  const map = new Map<string, number>();
  for (const v of violations) {
    map.set(v.constraintId, (map.get(v.constraintId) ?? 0) + v.violationCount);
  }
  return Array.from(map.entries()).map(([constraintId, count]) => ({ constraintId, count }));
}

// ══════════════════════════════════════════════════════════════════
// 内部
// ══════════════════════════════════════════════════════════════════

async function loadStructures(deps: M0Deps): Promise<ProtoStructure[]> {
  try {
    const result = await deps.memory.smartSearch("*", "proto_structure");
    if (result.ok && Array.isArray(result.value)) {
      return result.value as unknown as ProtoStructure[];
    }
  } catch { /* 降级 */ }
  return [];
}

function initBuckets(): ConfidenceBucket[] {
  return [
    { range: "0.8-1.0", count: 0 },
    { range: "0.6-0.8", count: 0 },
    { range: "0.4-0.6", count: 0 },
    { range: "0.2-0.4", count: 0 },
    { range: "< 0.2", count: 0 },
  ];
}

function addToBucket(buckets: ConfidenceBucket[], confidence: number): void {
  if (confidence >= 0.8) buckets[0].count++;
  else if (confidence >= 0.6) buckets[1].count++;
  else if (confidence >= 0.4) buckets[2].count++;
  else if (confidence >= 0.2) buckets[3].count++;
  else buckets[4].count++;
}
