/**
 * CronTickHandler — M5.3 跨 Session 模式挖掘
 *
 * 职责:
 *   - ProtoTask 累积更新 (所有已知 taskType)
 *   - 跨场景纠错模式分析
 *   - 衰退检测 (60天未引用 → deprecated/degraded)
 *   - 错误隔离: 任一步骤失败不影响其他
 *   - 守卫: 无新数据时跳过 LLM 调用
 *
 * 架构参考: §6 自主学习触发, §3 退役与亚存在
 */

import type { M0Deps } from "./m0-deps";
import type { ProtoStructure } from "./cognitive/types";
import { shouldMarkInactive } from "./structure-lifecycle";
import { transition } from "./structure-lifecycle";
import { accumulateProtoTask } from "./analysis/proto-task-learner";

// ══════════════════════════════════════════════════════════════════
// 阈值
// ══════════════════════════════════════════════════════════════════

/** 衰退天数阈值 */
const DECAY_DAYS = 60;

/** 高置信豁免: 超过此值不自动降级 */
const HIGH_CONFIDENCE_EXEMPTION = 0.85;

// ══════════════════════════════════════════════════════════════════
// CronTickHandler
// ══════════════════════════════════════════════════════════════════

export class CronTickHandler {
  /** 上次运行时间 (用于无新数据守卫) */
  private lastRunAt = 0;

  constructor(private readonly deps: M0Deps) {}

  async handle(): Promise<void> {
    const now = Date.now();

    // 无新数据守卫: 30 分钟内仅运行一次
    if (now - this.lastRunAt < 30 * 60 * 1000) {
      this.deps.logger?.info("cron_tick: skipped (no new data expected)");
      return;
    }
    this.lastRunAt = now;

    let protoTaskUpdated = 0;
    let structuresDecayed = 0;
    const errors: string[] = [];

    // 1. ProtoTask 累积更新
    try {
      const taskTypes = await this.discoverTaskTypes();
      for (const taskType of taskTypes) {
        if (!this.deps.llm) continue;
        const updated = await accumulateProtoTask(
          taskType, this.deps.llm, this.deps.memory);
        if (updated) {
          // 持久化到 AgentMemory proto_task slot
          await this.deps.memory.setSlot("proto_task", updated);
          protoTaskUpdated++;
        }
      }
    } catch (e) {
      errors.push(`ProtoTask: ${String(e)}`);
    }

    // 2. 衰退检测 (复用已有 shouldMarkInactive)
    try {
      const structResult = await this.deps.memory.smartSearch("*", "proto_structure");
      if (structResult.ok && Array.isArray(structResult.value)) {
        const structures = structResult.value as unknown as ProtoStructure[];
        for (const s of structures) {
          if (!s.updatedAt) continue;

          const daysSince = (now - s.updatedAt) / (24 * 60 * 60 * 1000);
          if (daysSince < DECAY_DAYS) continue;

          // 高置信豁免
          if (s.confidence > HIGH_CONFIDENCE_EXEMPTION) continue;

          // 仅对非 deprecated/rejected 结构做衰退检测
          if (s.lifecycle === "deprecated" || s.lifecycle === "rejected") continue;

          if (shouldMarkInactive(s, daysSince, DECAY_DAYS)) {
            const newStage = s.lifecycle === "crystallized"
              ? transition(s, "deprecate")
              : transition(s, "degrade");
            if (newStage && newStage !== s.lifecycle) {
              s.lifecycle = newStage;
              structuresDecayed++;
            }

            // 持久化更新后的结构
            if (this.deps.memory.saveProtoStructure) {
              await this.deps.memory.saveProtoStructure(s);
            }
          }
        }
      }
    } catch (e) {
      errors.push(`Decay: ${String(e)}`);
    }

    // 3. 写入健康状态 (独立 slot, 不与 cross-domain-analyzer 冲突)
    try {
      await this.deps.memory.setSlot("cron_tick_health", {
        lastRunAt: now,
        protoTaskUpdated,
        structuresDecayed,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch {
      // 健康写入可降级
    }

    if (errors.length > 0) {
      this.deps.logger?.warn("cron_tick completed with errors", {
        protoTaskUpdated,
        structuresDecayed,
        errorCount: errors.length,
      });
    } else {
      this.deps.logger?.info("cron_tick completed", {
        protoTaskUpdated,
        structuresDecayed,
      });
    }
  }

  /**
   * 从 AgentMemory 中扫描已知 taskType。
   * 降级: 返回空数组
   */
  private async discoverTaskTypes(): Promise<string[]> {
    try {
      const result = await this.deps.memory.getSlot("task_context");
      if (result.ok && result.value) {
        const tc = result.value as { taskType?: string };
        if (tc.taskType) return [tc.taskType];
      }
    } catch {
      // 降级
    }
    // 也尝试从 proto_task slot 读取
    try {
      const ptResult = await this.deps.memory.getSlot("proto_task");
      if (ptResult.ok && ptResult.value) {
        const pt = ptResult.value as { taskType?: string };
        if (pt.taskType) return [pt.taskType];
      }
    } catch {
      // 降级
    }
    return [];
  }
}
