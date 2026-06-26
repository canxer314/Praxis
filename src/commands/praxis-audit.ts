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

  // 约束违反统计 (从 audit_log slot 读取)
  const violations: ViolationEntry[] = [];
  try {
    const result = await deps.memory.getSlot("audit_log");
    if (result.ok && result.value) {
      const log = result.value as { violations?: ViolationEntry[] };
      if (log.violations) violations.push(...log.violations);
    }
  } catch { /* audit_log 不可用 */ }

  return {
    generatedAt: now,
    totalStructures: structures.length,
    zombies,
    underestimated,
    violations,
    decayWarnings,
    confidenceDistribution: distribution,
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

  // 约束违反
  if (report.violations.length > 0) {
    lines.push(`### 约束违反统计`);
    for (const v of report.violations) {
      lines.push(`  - ${v.constraintId}: ${v.violationCount} 次违反`);
    }
    lines.push("");
  } else {
    lines.push("### 约束违反: 无");
    lines.push("");
  }

  if (report.totalStructures === 0) {
    lines.push("_(无已结晶结构 — 系统处于冷启动阶段)_");
  }

  return lines.join("\n");
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
