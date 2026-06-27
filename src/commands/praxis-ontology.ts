/**
 * /praxis ontology — 本体论承诺清单 (M3.5, §13)
 *
 * 输出 Praxis 当前相信什么、以多大置信度:
 *   - 已结晶结构 (crystallized)
 *   - 原型结构 (hypothesized/candidate/experimental)
 *   - 亚存在结构 (deprecated/rejected)
 *   - 范畴系统 (5 类型 + 待审查提案)
 *   - 置信度分布直方图
 *
 * 数据源: AgentMemory proto_structure typed memory + category_proposals slot。
 */

import type { M0Deps } from "../m0-deps";

export interface OntologyEntry {
  id: string;
  tentativeName: string;
  confidence: number;
  observationsCount: number;
  adoptionRate?: number;
  version?: string;
}

export interface SubsistentEntry {
  id: string;
  tentativeName: string;
  note: string;
}

export interface OntologyReport {
  totalStructures: number;
  crystallized: OntologyEntry[];
  proto: OntologyEntry[];
  subsistent: SubsistentEntry[];
  activeCategories: string[];
  pendingProposals: number;
  confidenceBuckets: { high: number; medium: number; low: number; subsistent: number };
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export async function generateOntologyReport(deps: M0Deps): Promise<OntologyReport> {
  const result = await deps.memory.smartSearch("*", "proto_structure");
  const structures: Record<string, unknown>[] =
    result.ok && Array.isArray(result.value)
      ? (result.value as Record<string, unknown>[])
      : [];

  const crystallized: OntologyEntry[] = [];
  const proto: OntologyEntry[] = [];
  const subsistent: SubsistentEntry[] = [];
  const categories = new Set<string>();
  const buckets = { high: 0, medium: 0, low: 0, subsistent: 0 };

  for (const s of structures) {
    const lifecycle = str(s.lifecycle, "hypothesized");
    const protoType = str(s.protoType ?? s.proto_type, "unknown");
    const confidence = num(s.confidence, 0);
    const id = str(s.id);
    const name = str(s.tentativeName ?? s.tentative_name);
    const obs = num(s.observationsCount ?? s.observations_count, 0);
    categories.add(protoType);

    if (lifecycle === "crystallized") {
      const vc = Array.isArray(s.versionChain) ? (s.versionChain as unknown[]) : [];
      crystallized.push({
        id, tentativeName: name, confidence, observationsCount: obs,
        adoptionRate: num(s.adoptionRate ?? s.adoption_rate, 0),
        version: `v${vc.length || 1}`,
      });
    } else if (lifecycle === "deprecated" || lifecycle === "rejected") {
      subsistent.push({ id, tentativeName: name, note: lifecycle });
    } else {
      proto.push({ id, tentativeName: name, confidence, observationsCount: obs });
    }

    if (lifecycle === "deprecated" || lifecycle === "rejected") {
      buckets.subsistent++;
    } else if (confidence >= 0.8) buckets.high++;
    else if (confidence >= 0.5) buckets.medium++;
    else if (confidence >= 0.2) buckets.low++;
    else buckets.subsistent++;
  }

  let pendingProposals = 0;
  try {
    const propRes = await deps.memory.getSlot("category_proposals");
    if (propRes.ok && Array.isArray(propRes.value)) {
      pendingProposals = (propRes.value as unknown[]).length;
    }
  } catch {
    // category_proposals slot absent — 0 proposals.
  }

  return {
    totalStructures: structures.length,
    crystallized,
    proto,
    subsistent,
    activeCategories: [...categories],
    pendingProposals,
    confidenceBuckets: buckets,
  };
}

function bar(n: number): string {
  return "█".repeat(Math.min(40, Math.max(0, n)));
}

export function formatOntologyReport(r: OntologyReport): string {
  const lines: string[] = [];
  lines.push(`Praxis 当前本体论承诺 (${r.totalStructures} structures):`);
  lines.push("");
  lines.push(`已结晶结构 (${r.crystallized.length}):`);
  for (const c of r.crystallized.slice(0, 50)) {
    lines.push(
      `  - ${c.tentativeName} ${c.version} (置信度 ${c.confidence.toFixed(2)}, ${c.observationsCount} 次观察, 采纳率 ${((c.adoptionRate ?? 0) * 100).toFixed(0)}%)`,
    );
  }
  lines.push("");
  lines.push(`原型结构 (${r.proto.length}):`);
  for (const p of r.proto.slice(0, 50)) {
    lines.push(`  - ${p.tentativeName} (置信度 ${p.confidence.toFixed(2)}, ${p.observationsCount} 次观察)`);
  }
  lines.push("");
  lines.push(`亚存在结构 (${r.subsistent.length}):`);
  for (const s of r.subsistent.slice(0, 50)) {
    lines.push(`  - ${s.note}: ${s.tentativeName}`);
  }
  lines.push("");
  lines.push("范畴系统:");
  lines.push(`  活跃范畴: ${r.activeCategories.join(", ") || "无"} (${r.activeCategories.length} 种)`);
  lines.push(`  待审查提案: ${r.pendingProposals}`);
  lines.push("");
  lines.push("置信度分布:");
  lines.push(`  0.8-1.0: ${bar(r.confidenceBuckets.high)} ${r.confidenceBuckets.high} (高可信)`);
  lines.push(`  0.5-0.8: ${bar(r.confidenceBuckets.medium)} ${r.confidenceBuckets.medium} (中等)`);
  lines.push(`  0.2-0.5: ${bar(r.confidenceBuckets.low)} ${r.confidenceBuckets.low} (低可信)`);
  lines.push(`  < 0.2:   ${bar(r.confidenceBuckets.subsistent)} ${r.confidenceBuckets.subsistent} (亚存在)`);
  return lines.join("\n");
}
