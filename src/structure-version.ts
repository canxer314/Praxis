/**
 * StructureVersion — ProtoStructure 版本链 (M1 Step 2)
 *
 * 职责:
 *   - 每次 ProtoStructure 修改产生新版本快照
 *   - 支持回滚到任意历史版本
 *   - 支持两个版本的结构化 diff
 *
 * 架构参考: §3 版本链
 */

import type { ProtoStructure, VersionSnapshot } from "./cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 版本创建
// ══════════════════════════════════════════════════════════════════

/**
 * 为 ProtoStructure 创建新版本快照并追加到 versionChain。
 * 返回新创建的版本 ID。
 */
export function createVersion(
  structure: ProtoStructure,
  createdBy: VersionSnapshot["createdBy"],
  diffs: VersionSnapshot["diff"],
  rationale: string,
  evidence: string[] = [],
): string {
  const versionId = `v${structure.versionChain.length + 1}`;
  const parentVersion =
    structure.versionChain.length > 0
      ? structure.versionChain[structure.versionChain.length - 1].versionId
      : null;

  const snapshot: VersionSnapshot = {
    versionId,
    parentVersion,
    mergeSources: undefined,
    createdAt: Date.now(),
    createdBy,
    diff: diffs,
    rationale,
    evidence,
    performance: {
      predictionAccuracy: 0,
      userSatisfaction: 0,
      activeDurationDays: 0,
    },
  };

  structure.versionChain.push(snapshot);
  structure.updatedAt = Date.now();
  return versionId;
}

// ══════════════════════════════════════════════════════════════════
// 回滚
// ══════════════════════════════════════════════════════════════════

/**
 * 将 ProtoStructure 回滚到指定版本。
 * 注意: 此操作会清空 targetVersionId 之后的所有版本。
 * 返回被移除的版本 ID 列表。
 */
export function rollback(
  structure: ProtoStructure,
  targetVersionId: string,
): { removedVersions: string[]; restoredVersion: string } {
  const idx = structure.versionChain.findIndex((v) => v.versionId === targetVersionId);
  if (idx === -1) {
    throw new Error(`Version ${targetVersionId} not found in version chain`);
  }

  // 移除目标版本之后的所有版本
  const removed = structure.versionChain.slice(idx + 1).map((v) => v.versionId);
  structure.versionChain = structure.versionChain.slice(0, idx + 1);

  // 更新 updatedAt
  structure.updatedAt = Date.now();

  return {
    removedVersions: removed,
    restoredVersion: targetVersionId,
  };
}

/**
 * 获取某个版本的状态（浅拷贝基础字段）。
 * 版本链中版本只存储 diff，完整状态需要从 version 0 开始累积应用 diff。
 * 本函数返回基础字段在当前时间的值——不通过 diff 重建完整状态。
 */
export function getVersion(
  structure: ProtoStructure,
  versionId: string,
): VersionSnapshot | null {
  return structure.versionChain.find((v) => v.versionId === versionId) ?? null;
}

// ══════════════════════════════════════════════════════════════════
// Diff
// ══════════════════════════════════════════════════════════════════

/**
 * 比较两个版本，返回它们之间的差异。
 * 比较的是版本快照中的 diff 字段（应用级 diff），而非重新计算。
 */
export function diffVersions(
  v1: VersionSnapshot,
  v2: VersionSnapshot,
): {
  onlyInV1: VersionSnapshot["diff"];
  onlyInV2: VersionSnapshot["diff"];
  changed: VersionSnapshot["diff"];
} {
  const v1Keys = new Set(v1.diff.map((d) => `${d.path}:${d.type}`));
  const v2Keys = new Set(v2.diff.map((d) => `${d.path}:${d.type}`));

  const onlyInV1 = v1.diff.filter((d) => !v2Keys.has(`${d.path}:${d.type}`));
  const onlyInV2 = v2.diff.filter((d) => !v1Keys.has(`${d.path}:${d.type}`));
  const changed = v1.diff.filter((d) => {
    const match = v2.diff.find(
      (d2) => d2.path === d.path && d2.type === d.type && d2.newValue !== d.newValue,
    );
    return match !== undefined;
  });

  return { onlyInV1, onlyInV2, changed };
}

// ══════════════════════════════════════════════════════════════════
// 版本历史查询
// ══════════════════════════════════════════════════════════════════

/**
 * 获取版本链的摘要信息。
 */
export function versionSummary(structure: ProtoStructure): {
  versionCount: number;
  currentVersion: string | null;
  firstCreatedAt: number | null;
  lastModifiedAt: number;
  createdByBreakdown: Record<string, number>;
} {
  const chains = structure.versionChain;
  const breakdown: Record<string, number> = {};

  for (const v of chains) {
    breakdown[v.createdBy] = (breakdown[v.createdBy] ?? 0) + 1;
  }

  return {
    versionCount: chains.length,
    currentVersion: chains.length > 0 ? chains[chains.length - 1].versionId : null,
    firstCreatedAt: chains.length > 0 ? chains[0].createdAt : null,
    lastModifiedAt: structure.updatedAt,
    createdByBreakdown: breakdown,
  };
}
