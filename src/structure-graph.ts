/**
 * StructureGraph — ProtoStructure 关系图 (M1)
 *
 * 职责:
 *   - 管理 ProtoStructure 之间的关系边
 *   - 确定性置信度传播 (不调 LLM)
 *   - 循环依赖检测
 *
 * 架构参考: §3 关系图
 */

import type { ProtoStructure, Relation, RelationType } from "./cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 关系管理
// ══════════════════════════════════════════════════════════════════

/**
 * 在两个结构之间建立关系边。如果同类型关系已存在，更新 strength。
 */
export function addRelation(
  from: ProtoStructure,
  to: ProtoStructure,
  type: RelationType,
  strength: number,
  evidence: string[] = [],
): void {
  // 去重: 同 target+type → 更新
  const existing = from.relations.find((r) => r.targetId === to.id && r.type === type);
  if (existing) {
    existing.strength = clamp(strength);
    existing.evidence = [...new Set([...existing.evidence, ...evidence])];
    existing.lastValidatedAt = Date.now();
    return;
  }

  from.relations.push({
    targetId: to.id,
    type,
    strength: clamp(strength),
    evidence,
    establishedAt: Date.now(),
    lastValidatedAt: Date.now(),
  });
}

/** 移除关系边 */
export function removeRelation(from: ProtoStructure, targetId: string, type: RelationType): void {
  from.relations = from.relations.filter((r) => !(r.targetId === targetId && r.type === type));
}

/** 查找从 from 出发且类型为 type 的所有关系 */
export function findRelations(from: ProtoStructure, type: RelationType): Relation[] {
  return from.relations.filter((r) => r.type === type);
}

// ══════════════════════════════════════════════════════════════════
// 置信度传播 (确定性逻辑)
// ══════════════════════════════════════════════════════════════════

/**
 * 当 structureId 的置信度变化 delta 时，沿 depends_on 边传播到依赖方。
 * 传播深度 ≤ maxHops (默认 3)。
 *
 * 返回所有被修改的结构 ID 及其变化量。
 */
export function propagateConfidence(
  changedId: string,
  delta: number,
  allStructures: Map<string, ProtoStructure>,
  maxHops = 3,
): Map<string, number> {
  const affected = new Map<string, number>(); // structureId → delta
  const visited = new Set<string>([changedId]);

  // BFS: 找到所有 depends_on 边指向 changedId 的结构
  let frontier = new Set<string>([changedId]);

  for (let hop = 1; hop <= maxHops; hop++) {
    const nextFrontier = new Set<string>();

    for (const [id, structure] of allStructures) {
      if (visited.has(id)) continue;

      // 该结构是否有 depends_on 边指向 frontier 中的某个结构？
      for (const rel of structure.relations) {
        if (rel.type !== "depends_on") continue;
        if (!frontier.has(rel.targetId)) continue;

        const propagatedDelta = delta * rel.strength * (1 / hop); // 逐跳衰减
        const currentDelta = affected.get(id) ?? 0;
        affected.set(id, currentDelta + propagatedDelta);

        nextFrontier.add(id);
        visited.add(id);
      }
    }

    if (nextFrontier.size === 0) break;
    frontier = nextFrontier;
  }

  return affected;
}

/**
 * 处理矛盾关系: A 上升 → 矛盾方 B 下降
 */
export function propagateContradiction(
  changedId: string,
  delta: number,
  allStructures: Map<string, ProtoStructure>,
): Map<string, number> {
  const affected = new Map<string, number>();
  const structure = allStructures.get(changedId);
  if (!structure) return affected;

  for (const rel of structure.relations) {
    if (rel.type !== "contradicts") continue;
    affected.set(rel.targetId, -delta * rel.strength);
  }

  return affected;
}

/**
 * 处理特化关系: 父结构 B 变化 → 子结构 A 同向变化
 */
export function propagateSpecialization(
  changedId: string,
  delta: number,
  allStructures: Map<string, ProtoStructure>,
): Map<string, number> {
  const affected = new Map<string, number>();

  for (const [id, s] of allStructures) {
    for (const rel of s.relations) {
      if (rel.type !== "specializes") continue;
      if (rel.targetId !== changedId) continue;
      const currentDelta = affected.get(id) ?? 0;
      affected.set(id, currentDelta + delta * rel.strength);
    }
  }

  return affected;
}

/**
 * 完整传播: 考虑所有关系类型，合并所有受影响结构的最终 delta。
 */
export function fullPropagation(
  changedId: string,
  delta: number,
  allStructures: Map<string, ProtoStructure>,
): Map<string, number> {
  const merged = new Map<string, number>();

  const addTo = (source: Map<string, number>) => {
    for (const [id, d] of source) {
      merged.set(id, (merged.get(id) ?? 0) + d);
    }
  };

  addTo(propagateConfidence(changedId, delta, allStructures));
  addTo(propagateContradiction(changedId, delta, allStructures));
  addTo(propagateSpecialization(changedId, delta, allStructures));

  return merged;
}

// ══════════════════════════════════════════════════════════════════
// 循环检测
// ══════════════════════════════════════════════════════════════════

/**
 * 检测从 startId 出发是否存在循环依赖 (depends_on 边)
 */
export function findCycles(
  startId: string,
  allStructures: Map<string, ProtoStructure>,
): string[] | null {
  const visiting = new Set<string>();
  const path: string[] = [];

  let cycleFound: string[] | null = null;

  function dfs(currentId: string): boolean {
    if (visiting.has(currentId)) {
      // 找到循环 — 从 currentId 在 path 中的位置提取环
      const idx = path.indexOf(currentId);
      if (idx >= 0) {
        cycleFound = [...path.slice(idx), currentId];
        return true;
      }
      return false;
    }

    visiting.add(currentId);
    path.push(currentId);

    const structure = allStructures.get(currentId);
    if (structure) {
      for (const rel of structure.relations) {
        if (rel.type !== "depends_on") continue;
        if (dfs(rel.targetId)) return true;
      }
    }

    path.pop();
    visiting.delete(currentId);
    return false;
  }

  if (dfs(startId)) {
    return cycleFound;
  }

  return null; // 无循环
}

// ══════════════════════════════════════════════════════════════════
// 工具
// ══════════════════════════════════════════════════════════════════

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
