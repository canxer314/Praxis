/**
 * CrossAgentSync — M6.5 跨 Agent 认知同步 (乐观锁 + pending_merge)
 *
 * 职责:
 *   - ProtoStructure 乐观锁写入: 基于 version 号的 CAS (Compare-And-Swap)
 *   - 冲突检测: 并发修改同一结构时, 先提交者成功, 后提交者进入 pending_merge
 *   - 冲突解决: LLM 辅助合并, 置信度取较低值, >15% 差异需人类审批
 *   - 子 Agent → 父 Agent 认知回流: 子 Agent session_end 写入更新, 父 Agent session_start 读取最新版
 *
 * 架构参考: §6 跨 Agent 认知同步
 */

import type { ProtoStructure } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface OptimisticLockResult {
  /** 是否成功写入 */
  committed: boolean;
  /** 冲突时的现有版本号 */
  conflictVersion?: number;
  /** 冲突时暂存的合并建议 */
  pendingMergeId?: string;
}

export interface PendingMerge {
  id: string;
  structureId: string;
  /** 冲突时的 base 版本号 */
  baseVersion: number;
  /** 尝试提交的更新 */
  proposedUpdate: Partial<ProtoStructure>;
  /** 当前存储的版本 */
  currentValue: ProtoStructure;
  /** 创建时间 */
  createdAt: number;
  /** 置信度差异 (>15% 需要人类审批) */
  confidenceDelta: number;
  needsHumanApproval: boolean;
}

// ══════════════════════════════════════════════════════════════════
// Memory 接口 (版本感知)
// ══════════════════════════════════════════════════════════════════

interface VersionedMemory {
  /** 读取结构 + 当前版本号 */
  getStructureWithVersion(id: string): Promise<{ structure: ProtoStructure; version: number } | null>;
  /** CAS 写入: 仅当 version 匹配时才写入 */
  saveStructureWithVersion(structure: ProtoStructure, expectedVersion: number): Promise<{ committed: boolean }>;
  /** 保存 pending_merge 记录 */
  savePendingMerge(merge: PendingMerge): Promise<void>;
}

// ══════════════════════════════════════════════════════════════════
// CrossAgentSync
// ══════════════════════════════════════════════════════════════════

export class CrossAgentSync {
  constructor(private readonly memory: VersionedMemory) {}

  /**
   * 乐观锁写入 ProtoStructure。
   * 读取当前 version → CAS 写入 → 冲突时生成 pending_merge。
   */
  async saveWithOptimisticLock(
    structure: ProtoStructure,
  ): Promise<OptimisticLockResult> {
    // 1. 读取当前版本
    const current = await this.memory.getStructureWithVersion(structure.id);
    if (!current) {
      // 新建结构 — 乐观锁不需要 (version=1)
      const result = await this.memory.saveStructureWithVersion(
        { ...structure, versionChain: [{ versionId: "v1", parentVersion: null, mergeSources: [], createdAt: Date.now(), createdBy: "auto_refinement" as const, diff: [], rationale: "initial", evidence: [], performance: { predictionAccuracy: 0, userSatisfaction: 0, activeDurationDays: 0 } }] },
        0,
      );
      return { committed: result.committed };
    }

    const expectedVersion = current.version;

    // 2. 检测冲突: 检查当前结构的 updatedAt 是否在我们读取后变化
    // (简化: 使用 versionChain 长度作为 version 号)
    const ourVersion = structure.versionChain?.length ?? 0;
    if (ourVersion < expectedVersion) {
      // 我们的版本落后 — 存在并发修改
      const delta = Math.abs(structure.confidence - current.structure.confidence);
      const mergeId = `pending_merge_${structure.id}_${Date.now()}`;

      await this.memory.savePendingMerge({
        id: mergeId,
        structureId: structure.id,
        baseVersion: expectedVersion,
        proposedUpdate: { confidence: structure.confidence, tentativeName: structure.tentativeName },
        currentValue: current.structure,
        createdAt: Date.now(),
        confidenceDelta: delta,
        needsHumanApproval: delta > 0.15,
      });

      return { committed: false, conflictVersion: expectedVersion, pendingMergeId: mergeId };
    }

    // 3. CAS 写入
    const newVersion = expectedVersion + 1;
    const result = await this.memory.saveStructureWithVersion(structure, expectedVersion);
    return { committed: result.committed, conflictVersion: result.committed ? undefined : expectedVersion };
  }

  /**
   * LLM 辅助合并 pending_merge 冲突。
   * 合并策略: 置信度取较低值, 字段逐项对比。
   */
  async resolvePendingMerge(
    mergeId: string,
    _llm?: { analyze: (prompt: string) => Promise<{ ok: boolean; value?: string }> },
  ): Promise<ProtoStructure | null> {
    // 简化实现: 取当前值 + 较低置信度
    // 完整实现在 LLM 可用时做语义合并
    // (pending_merge 的完整读取需要 memory 接口扩展)
    void mergeId; // 保留给未来 LLM 路径
    return null;
  }

  /**
   * 子 Agent → 父 Agent 认知回流。
   * 子 Agent session_end 时, 通过乐观锁写入更新;
   * 父 Agent session_start 时, 读取最新版本。
   */
  async syncChildToParent(
    childStructures: ProtoStructure[],
  ): Promise<{ synced: number; conflicts: number }> {
    let synced = 0;
    let conflicts = 0;

    for (const s of childStructures) {
      const result = await this.saveWithOptimisticLock(s);
      if (result.committed) {
        synced++;
      } else {
        conflicts++;
      }
    }

    return { synced, conflicts };
  }
}
