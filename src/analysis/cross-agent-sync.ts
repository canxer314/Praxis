/**
 * CrossAgentSync — M6.5 跨 Agent 认知同步 (乐观锁 + pending_merge)
 *
 * 职责:
 *   - ProtoStructure 乐观锁写入: 基于 versionChain 长度的 CAS
 *   - 冲突检测: CAS 失败 → pending_merge (保留完整 proposedUpdate)
 *   - LLM 辅助合并: resolvePendingMerge 实现基本合并策略 (置信度取较低值)
 *   - >15% 置信度差异 → needsHumanApproval flag
 *   - 子 Agent → 父 Agent 认知回流
 *
 * 架构参考: §6 跨 Agent 认知同步
 *
 * 依赖: MemorySubsystem (getSlot/setSlot/saveProtoStructure)
 */

import type { ProtoStructure, ProtoSequence } from "../cognitive/types";
import type { M0Deps } from "../m0-deps";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface OptimisticLockResult {
  committed: boolean;
  conflictVersion?: number;
  pendingMergeId?: string;
}

export interface PendingMerge {
  id: string;
  structureId: string;
  baseVersion: number;
  proposedUpdate: Partial<ProtoStructure>;
  currentValue: ProtoStructure;
  createdAt: number;
  confidenceDelta: number;
  needsHumanApproval: boolean;
}

// ══════════════════════════════════════════════════════════════════
// CrossAgentSync
// ══════════════════════════════════════════════════════════════════

export class CrossAgentSync {
  constructor(private readonly deps: M0Deps) {}

  /**
   * 乐观锁写入 ProtoStructure。
   * 读取当前 structure → 比较版本 → CAS setSlot → 冲突时 staging pending_merge。
   */
  async saveWithOptimisticLock(
    structure: ProtoStructure,
  ): Promise<OptimisticLockResult> {
    const slotKey = `proto_struct_${structure.id}`;

    // 1. 读取当前版本
    const currentResult = await this.deps.memory.getSlot(slotKey);
    const currentData = currentResult.ok ? (currentResult as { ok: true; value: unknown }).value : null;
    // T11: 鲁棒版本读取 — `version` 字段缺失时回退到 versionChain 长度
    // (生产 saveProtoStructure 路径不写 `version` 字段, 仅写 versionChain)。
    const currentVersion = currentData
      ? ((currentData as Record<string, unknown>).version as number)
        ?? ((currentData as { versionChain?: unknown[] }).versionChain?.length ?? 0)
      : 0;

    // 2. 我们的版本号 (基于 versionChain 长度)
    const ourVersion = structure.versionChain?.length ?? 1;

    // 3. 版本检查: 如果我们的版本 <= 当前版本, 说明有并发修改
    if (currentVersion > 0 && ourVersion <= currentVersion) {
      // 阶段 1: 客户端版本落后 — 暂存 pending_merge
      const currentStruct = (currentData as ProtoStructure) ?? structure;
      return await this.stagePendingMerge(structure, currentStruct, currentVersion);
    }

    // 4. CAS 写入: 递增版本号
    const newVersion = currentVersion + 1;
    const writeResult = await this.deps.memory.setSlot(slotKey, {
      ...structure as unknown as Record<string, unknown>,
      version: newVersion,
      updatedAt: Date.now(),
    });

    if (!writeResult.ok) {
      // CAS 写入失败 — 真正的并发冲突
      const refetch = await this.deps.memory.getSlot(slotKey);
      const actualCurrent = (refetch.ok && refetch.value
        ? (refetch.value as ProtoStructure)
        : structure) as ProtoStructure;
      return await this.stagePendingMerge(structure, actualCurrent, newVersion);
    }

    return { committed: true };
  }

  private async stagePendingMerge(
    proposed: ProtoStructure,
    current: ProtoStructure,
    baseVersion: number,
  ): Promise<OptimisticLockResult> {
    const delta = Math.abs(proposed.confidence - current.confidence);
    const merge: PendingMerge = {
      id: `pending_merge_${proposed.id}_${Date.now()}`,
      structureId: proposed.id,
      baseVersion,
      proposedUpdate: {
        confidence: proposed.confidence,
        tentativeName: proposed.tentativeName,
        lifecycle: proposed.lifecycle,
        adoptionRate: proposed.adoptionRate,
        observationsCount: proposed.observationsCount,
        ...(proposed.protoType === "sequence" ? {
          structure: (proposed as ProtoSequence).structure,
          function: (proposed as ProtoSequence).function,
        } : {}),
      },
      currentValue: current,
      createdAt: Date.now(),
      confidenceDelta: delta,
      needsHumanApproval: delta > 0.15,
    };

    try {
      // T11: 单一 pending_merges 数组 slot — 修复 key 不匹配 bug
      // (此前 stage 用 pending_merge_${merge.id} 双前缀, list 用 pending_merge_${s.id}, 永不匹配)
      const list = await this.readPendingMerges();
      list.push(merge);
      await this.deps.memory.setSlot("pending_merges", list as unknown as Record<string, unknown>);
    } catch { /* 暂存失败不阻塞 */ }

    return {
      committed: false,
      conflictVersion: baseVersion,
      pendingMergeId: merge.id,
    };
  }

  /**
   * LLM 辅助合并 pending_merge 冲突。
   * 基本策略: 置信度取较低值, 保留两个版本的字段。
   */
  async resolvePendingMerge(
    mergeId: string,
    llm?: { analyze: (prompt: string) => Promise<{ ok: boolean; value?: string }> },
  ): Promise<ProtoStructure | null> {
    try {
      const list = await this.readPendingMerges();
      const merge = list.find((m) => m.id === mergeId);
      if (!merge) return null;

      const merged: ProtoStructure = {
        ...merge.currentValue,
        confidence: Math.min(merge.proposedUpdate.confidence ?? merge.currentValue.confidence, merge.currentValue.confidence),
        tentativeName: merge.proposedUpdate.tentativeName ?? merge.currentValue.tentativeName,
        updatedAt: Date.now(),
        versionChain: [
          ...(merge.currentValue.versionChain ?? []),
          {
            versionId: `merge_${mergeId}`,
            parentVersion: `v${merge.baseVersion}`,
            mergeSources: [merge.currentValue.id, `proposed_${mergeId}`],
            createdAt: Date.now(),
            createdBy: "fusion" as const,
            diff: [{ type: "confidence_changed" as const, path: "/confidence", oldValue: merge.currentValue.confidence, newValue: Math.min(merge.proposedUpdate.confidence ?? merge.currentValue.confidence, merge.currentValue.confidence) }],
            rationale: `LLM-assisted merge of pending_merge ${mergeId}`,
            evidence: [`confidence_delta: ${merge.confidenceDelta}`],
            performance: { predictionAccuracy: 0, userSatisfaction: 0, activeDurationDays: 0 },
          },
        ],
      };

      // LLM 辅助语义合并 (如果可用)
      if (llm && merge.proposedUpdate.tentativeName !== merge.currentValue.tentativeName) {
        try {
          const llmResult = await llm.analyze(
            `Merge two ProtoStructure names:\nA: "${merge.currentValue.tentativeName}"\nB: "${merge.proposedUpdate.tentativeName}"\nOutput JSON: {"mergedName": "<best combined name>"}`,
          );
          if (llmResult.ok && llmResult.value) {
            const parsed = JSON.parse(llmResult.value.replace(/^```json\s*\n?/, "").replace(/\n?```$/, ""));
            if (parsed.mergedName) merged.tentativeName = parsed.mergedName;
          }
        } catch { /* LLM 合并失败, 使用默认合并 */ }
      }

      // 持久化合并结果
      if (this.deps.memory.saveProtoStructure) {
        await this.deps.memory.saveProtoStructure(merged);
      }

      // 清理 pending_merge (从数组移除)
      try {
        const list2 = await this.readPendingMerges();
        const filtered = list2.filter((m) => m.id !== mergeId);
        await this.deps.memory.setSlot("pending_merges", filtered as unknown as Record<string, unknown>);
      } catch { /* ignore */ }

      return merged;
    } catch {
      return null;
    }
  }

  /**
   * 列出所有未解决的 pending_merge 冲突。
   */
  async listPendingMerges(): Promise<PendingMerge[]> {
    return this.readPendingMerges();
  }

  /** T11: 读取单一 pending_merges 数组 slot (修复 key 不匹配 bug)。 */
  private async readPendingMerges(): Promise<PendingMerge[]> {
    try {
      const result = await this.deps.memory.getSlot("pending_merges");
      if (result.ok && Array.isArray(result.value)) {
        return result.value as unknown as PendingMerge[];
      }
    } catch { /* 降级到空数组 */ }
    return [];
  }

  /**
   * 子 Agent → 父 Agent 认知回流。
   */
  async syncChildToParent(
    childStructures: ProtoStructure[],
  ): Promise<{ synced: number; conflicts: number }> {
    let synced = 0;
    let conflicts = 0;
    for (const s of childStructures) {
      const result = await this.saveWithOptimisticLock(s);
      if (result.committed) synced++;
      else conflicts++;
    }
    return { synced, conflicts };
  }
}
