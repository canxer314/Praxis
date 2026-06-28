/**
 * analysis/degradation-checker.ts — 衰退条件检测
 *
 * 补充 structure-lifecycle.ts — 检测结构是否满足衰退条件:
 *   - 60 天未引用 → stale
 *   - 置信度跌破阈值 → low confidence
 *   - 被替代结构覆盖 → superseded
 *
 * 架构参考: §3 生命周期, §11 analysis/degradation-checker.ts
 */

export interface DegradableStructure {
  id: string;
  protoType: string;
  confidence: number;
  lifecycle: string;
  updatedAt: number;
  createdAt: number;
  lastReferencedAt?: number;
  supersededById?: string;
}

export interface DegradationFlag {
  structureId: string;
  reason: string;
  type: "stale" | "low_confidence" | "superseded";
  severity: "warning" | "critical";
}

export interface DegradationOptions {
  staleDays?: number;
  confidenceThreshold?: number;
}

const DAY_MS = 86_400_000;

export function isStale(s: DegradableStructure, maxDays: number): boolean {
  const ref = s.lastReferencedAt ?? s.createdAt;
  return Date.now() - ref > maxDays * DAY_MS;
}

export function isBelowConfidence(s: DegradableStructure, threshold: number): boolean {
  return s.confidence < threshold;
}

export function isSuperseded(s: DegradableStructure): boolean {
  return s.supersededById !== undefined && s.supersededById !== null;
}

export function checkDegradation(
  structures: DegradableStructure[],
  opts?: DegradationOptions,
): DegradationFlag[] {
  const staleDays = opts?.staleDays ?? 60;
  const confidenceThreshold = opts?.confidenceThreshold ?? 0.2;
  const flags: DegradationFlag[] = [];

  for (const s of structures) {
    if (isStale(s, staleDays)) {
      flags.push({
        structureId: s.id,
        type: "stale",
        reason: `Structure "${s.id}" has not been referenced for > ${staleDays} days`,
        severity: "warning",
      });
    }
    if (isBelowConfidence(s, confidenceThreshold)) {
      flags.push({
        structureId: s.id,
        type: "low_confidence",
        reason: `Structure "${s.id}" confidence ${s.confidence.toFixed(2)} < threshold ${confidenceThreshold}`,
        severity: s.lifecycle === "crystallized" ? "critical" as const : "warning" as const,
      });
    }
    if (isSuperseded(s)) {
      flags.push({
        structureId: s.id,
        type: "superseded",
        reason: `Structure "${s.id}" superseded by "${s.supersededById}"`,
        severity: "warning",
      });
    }
  }

  return flags;
}
