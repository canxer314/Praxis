/**
 * CronTickHandler — M5.3 跨 Session 模式挖掘 + M6 StructuralGap + Meta Layer 调度
 *
 * 职责:
 *   - ProtoTask 累积更新 (所有已知 taskType)
 *   - 跨场景纠错模式分析
 *   - 衰退检测 (60天未引用 → deprecated/degraded)
 *   - M6 Fix-2: 历史快照累积 + 5 StructuralGap 检测器 → audit_log
 *   - M6: audit_log 保留策略清理 (条件执行)
 *   - 错误隔离: 任一步骤失败不影响其他
 *   - 守卫: 无新数据时跳过 LLM 调用
 *
 * 架构参考: §6 自主学习触发, §3 退役与亚存在, §8 元认知系统
 */

import type { M0Deps } from "../m0-deps";
import type { ProtoStructure } from "../cognitive/types";
import { shouldMarkInactive } from "../analysis/structure-lifecycle";
import { transition } from "../analysis/structure-lifecycle";
import { accumulateProtoTask } from "../analysis/proto-task-learner";
import {
  detectProtoTaskDecline,
  detectCrossScenarioFailure,
  detectCorrectionCluster,
  detectSkillStagnation,
  detectEscalationAnomaly,
} from "../analysis/structural-gap-detector";
import type { StructuralGapSignal } from "../analysis/structural-gap-detector";
import { ArchitectureAuditor } from "../analysis/architecture-auditor";
import { CategoryAuditor } from "../analysis/category-auditor";
import { bootstrapIfNeeded } from "../cognitive/praxis-bootstrap";

// ══════════════════════════════════════════════════════════════════
// 阈值
// ══════════════════════════════════════════════════════════════════

/** 衰退天数阈值 */
const DECAY_DAYS = 60;

/** 高置信豁免: 超过此值不自动降级 */
const HIGH_CONFIDENCE_EXEMPTION = 0.85;

/** M6: audit_log 清理间隔 (ms) — 每小时最多一次 */
const AUDIT_LOG_CLEANUP_INTERVAL = 60 * 60 * 1000;

/** M6: audit_log 最大条目数 */
const AUDIT_LOG_MAX_ENTRIES = 10_000;

/** M6: audit_log 保留天数 */
const AUDIT_LOG_RETENTION_DAYS = 90;

/** M6: 历史快照保留天数 */
const HISTORY_RETENTION_DAYS = 90;

/** M6.1: 结构性缺口扫描间隔 (ms) — 168h = 7天 */
const STRUCTURAL_GAP_SCAN_INTERVAL = 168 * 60 * 60 * 1000;

/** M6.1: 范畴审计间隔 (ms) — 720h = 30天 */
const CATEGORY_AUDIT_INTERVAL = 720 * 60 * 60 * 1000;

// ══════════════════════════════════════════════════════════════════
// CronTickHandler
// ══════════════════════════════════════════════════════════════════

export class CronTickHandler {
  /** 上次运行时间 (用于无新数据守卫) */
  private lastRunAt = 0;
  /** M6: 上次 audit_log 清理时间 */
  private lastAuditCleanup = 0;

  constructor(private readonly deps: M0Deps) {}

  /** Phase 1B: 首次运行时从 agentmemory raw data 合成初始 cognitive model */
  private async runBootstrapIfNeeded(): Promise<void> {
    const BOOTSTRAP_KEY = "praxis_bootstrap_attempts";
    const MAX_ATTEMPTS = 3;

    try {
      const attemptSlot = await this.deps.memory.getSlot(BOOTSTRAP_KEY);
      const attempts = (attemptSlot.ok && typeof attemptSlot.value === "number")
        ? attemptSlot.value as number
        : 0;

      if (attempts >= MAX_ATTEMPTS) return;

      const result = await bootstrapIfNeeded(this.deps);
      if (result.bootstrapped) {
        this.deps.logger?.info("cron_tick: bootstrap completed", {
          dimensions: result.dimensions,
        });
      } else if (result.error) {
        const next = attempts + 1;
        await this.deps.memory.setSlot(BOOTSTRAP_KEY, next).catch(() => {});
        this.deps.logger?.warn(
          `cron_tick: bootstrap attempt ${next}/${MAX_ATTEMPTS} failed`,
          { error: result.error },
        );
      }
    } catch (err) {
      // 失败不阻塞 cron_tick 主流程
      this.deps.logger?.warn("cron_tick: bootstrap error", { error: String(err) });
    }
  }

  async handle(): Promise<void> {
    const now = Date.now();

    // 无新数据守卫: 30 分钟内仅运行一次
    if (now - this.lastRunAt < 30 * 60 * 1000) {
      this.deps.logger?.info("cron_tick: skipped (no new data expected)");
      return;
    }
    this.lastRunAt = now;

    // Phase 1B: Bootstrap — 首次运行时合成 competency_model
    await this.runBootstrapIfNeeded();

    let protoTaskUpdated = 0;
    let structuresDecayed = 0;
    let gapSignalsDetected = 0;
    const errors: string[] = [];

    // 1. ProtoTask 累积更新
    try {
      const taskTypes = await this.discoverTaskTypes();
      for (const taskType of taskTypes) {
        if (!this.deps.llm) continue;
        const updated = await accumulateProtoTask(
          taskType, this.deps.llm, this.deps.memory);
        if (updated) {
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
          if (s.confidence > HIGH_CONFIDENCE_EXEMPTION) continue;
          if (s.lifecycle === "deprecated" || s.lifecycle === "rejected") continue;

          if (shouldMarkInactive(s, daysSince, DECAY_DAYS)) {
            const newStage = s.lifecycle === "crystallized"
              ? transition(s, "deprecate")
              : transition(s, "degrade");
            if (newStage && newStage !== s.lifecycle) {
              s.lifecycle = newStage;
              structuresDecayed++;
            }
            if (this.deps.memory.saveProtoStructure) {
              await this.deps.memory.saveProtoStructure(s);
            }
          }
        }
      }
    } catch (e) {
      errors.push(`Decay: ${String(e)}`);
    }

    // 3. M6 Fix-2: 历史快照累积 + StructuralGap 检测
    try {
      gapSignalsDetected = await this.runStructuralGapDetection(now);
    } catch (e) {
      errors.push(`StructuralGap: ${String(e)}`);
    }

    // 4. M6: audit_log 保留策略清理 (条件执行: 每小时最多一次)
    try {
      if (now - this.lastAuditCleanup >= AUDIT_LOG_CLEANUP_INTERVAL) {
        await this.cleanupAuditLog(now);
        this.lastAuditCleanup = now;
      }
    } catch (e) {
      errors.push(`AuditCleanup: ${String(e)}`);
    }

    // 5. M6.1: Meta Layer 调度检查 (轻量: 仅时间戳比较)
    try {
      await this.runMetaLayerScheduling(now);
    } catch (e) {
      errors.push(`MetaLayer: ${String(e)}`);
    }

    // 6. 写入健康状态
    try {
      await this.deps.memory.setSlot("cron_tick_health", {
        lastRunAt: now,
        protoTaskUpdated,
        structuresDecayed,
        gapSignalsDetected,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch {
      // 健康写入可降级
    }

    if (errors.length > 0) {
      this.deps.logger?.warn("cron_tick completed with errors", {
        protoTaskUpdated, structuresDecayed, gapSignalsDetected, errorCount: errors.length,
      });
    } else {
      this.deps.logger?.info("cron_tick completed", {
        protoTaskUpdated, structuresDecayed, gapSignalsDetected,
      });
    }
  }

  // ════════════════════════════════════════════════════════════════
  // M6 Fix-2: StructuralGap 检测 + 历史累积 + audit_log 管理
  // ════════════════════════════════════════════════════════════════

  /** 累积历史快照 + 运行 5 个 StructuralGap 检测器 */
  private async runStructuralGapDetection(now: number): Promise<number> {
    // 3a. 历史快照累积
    const protoTaskHistory = await this.appendSnapshot("proto_task_history", "proto_task", now);
    const competencyHistory = await this.appendSnapshot("competency_snapshots", "competency_model", now);

    // 3b. 运行 5 个检测器
    const signals: StructuralGapSignal[] = [];

    if (protoTaskHistory && protoTaskHistory.length >= 2) {
      const sig1 = detectProtoTaskDecline(protoTaskHistory as unknown as Array<{taskType: string; confidence: number; timestamp: number}>);
      if (sig1) signals.push(sig1);
    }

    // #2: 跨场景失败 — 从 audit_log 中聚合
    try {
      const auditResult = await this.deps.memory.getSlot("audit_log");
      if (auditResult.ok && auditResult.value) {
        const log = auditResult.value as Record<string, unknown>;
        const entries = Array.isArray(log.entries) ? log.entries as Array<Record<string, unknown>> : [];
        const failures = entries
          .filter(e => e.type === "constraint_violation")
          .map(e => {
            const d = (e.detail ?? {}) as Record<string, unknown>;
            return {
              toolName: (d.toolName as string) ?? "unknown",
              scenarioId: (d.sessionId as string) ?? "unknown",
              failureCount: 1,
              totalCalls: 1,
            };
          });
        if (failures.length > 0) {
          const sig2 = detectCrossScenarioFailure(failures);
          if (sig2) signals.push(sig2);
        }
      }
    } catch { /* 降级 */ }

    // #3: 纠正聚类 — 从 lessons 中查询
    try {
      const corrections = await this.queryRecentCorrections(now);
      if (corrections.length > 0) {
        // 按 type/subject 聚类计数
        const clusterMap = new Map<string, number>();
        for (const c of corrections) {
          const key = String(c.type ?? c.subject ?? "unknown");
          clusterMap.set(key, (clusterMap.get(key) ?? 0) + 1);
        }
        const correctionRecords = Array.from(clusterMap.entries()).map(([clusterId, count]) => ({
          clusterId,
          count,
          last30Days: count,
        }));
        const sig3 = detectCorrectionCluster(correctionRecords);
        if (sig3) signals.push(sig3);
      }
    } catch { /* 降级 */ }

    // #4: 技能停滞
    if (competencyHistory && competencyHistory.length >= 2) {
      const sig4 = detectSkillStagnation(competencyHistory as unknown as Array<{dimension: string; proficiency: number; timestamp: number}>);
      if (sig4) signals.push(sig4);
    }

    // #5: 升级异常
    try {
      const hbResult = await this.deps.memory.getSlot("heartbeat_state");
      if (hbResult.ok && hbResult.value) {
        const hb = hbResult.value as Record<string, unknown>;
        const sig5 = detectEscalationAnomaly([{
          count: (typeof hb.escalationCount === "number" ? hb.escalationCount : 0) as number,
          timestamp: (typeof hb.lastRunAt === "number" ? hb.lastRunAt : now) as number,
        }]);
        if (sig5) signals.push(sig5);
      }
    } catch { /* 降级 */ }

    // 3c. 将信号写入 audit_log
    if (signals.length > 0) {
      await this.appendAuditLogEntries(
        signals.map(s => ({
          timestamp: s.detectedAt,
          type: "structural_gap_signal" as const,
          severity: "warning" as const,
          source: "structural_gap_detector",
          detail: { signalType: s.signalType, evidence: s.evidence },
        })),
      );
    }

    return signals.length;
  }

  /** 追加历史快照到指定 slot */
  private async appendSnapshot(
    slotName: string,
    sourceSlot: string,
    now: number,
  ): Promise<Array<Record<string, unknown>> | null> {
    try {
      const source = await this.deps.memory.getSlot(sourceSlot);
      if (!source.ok || !source.value) return null;

      const existing = await this.deps.memory.getSlot(slotName);
      const history: Array<Record<string, unknown>> = (existing.ok && Array.isArray(existing.value))
        ? existing.value as Array<Record<string, unknown>>
        : [];

      history.push({ ...(source.value as Record<string, unknown>), timestamp: now });

      // 保留策略: 90 天窗口
      const cutoff = now - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const trimmed = history.filter(e => {
        const ts = typeof e.timestamp === "number" ? e.timestamp : 0;
        return ts > cutoff;
      });

      await this.deps.memory.setSlot(slotName, trimmed);
      return trimmed;
    } catch {
      return null;
    }
  }

  /** 追加条目到 audit_log slot */
  private async appendAuditLogEntries(
    newEntries: Array<Record<string, unknown>>,
  ): Promise<void> {
    try {
      const existing = await this.deps.memory.getSlot("audit_log");
      const log = (existing.ok && existing.value) ? existing.value as Record<string, unknown> : {};
      const entries = Array.isArray(log.entries) ? [...log.entries, ...newEntries] : [...newEntries];
      await this.deps.memory.setSlot("audit_log", { ...log, entries });
    } catch {
      // 写入失败不阻塞
    }
  }

  /** 查询近 30 天纠正记录 */
  private async queryRecentCorrections(now: number): Promise<Array<Record<string, unknown>>> {
    // 从 lessons 中查询 type=correction 的记录
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    // lesson_recall 接口可能不可用, 尝试 smartSearch
    try {
      const result = await this.deps.memory.smartSearch("correction", "lesson");
      if (result.ok && Array.isArray(result.value)) {
        return (result.value as Array<Record<string, unknown>>).filter(l => {
          const ts = typeof l.timestamp === "number" ? l.timestamp : 0;
          return ts > cutoff;
        });
      }
    } catch { /* 降级 */ }
    return [];
  }

  /** audit_log 保留策略清理 */
  private async cleanupAuditLog(now: number): Promise<void> {
    try {
      const existing = await this.deps.memory.getSlot("audit_log");
      if (!existing.ok || !existing.value) return;

      const log = existing.value as Record<string, unknown>;
      const entries = Array.isArray(log.entries) ? log.entries as Array<Record<string, unknown>> : [];
      if (entries.length === 0) return;

      const cutoff = now - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

      // 按时间窗口过滤
      let trimmed = entries.filter(e => {
        const ts = typeof e.timestamp === "number" ? e.timestamp : 0;
        return ts > cutoff;
      });

      // 容量上限裁剪
      if (trimmed.length > AUDIT_LOG_MAX_ENTRIES) {
        trimmed = trimmed.slice(-AUDIT_LOG_MAX_ENTRIES);
      }

      if (trimmed.length < entries.length) {
        await this.deps.memory.setSlot("audit_log", { ...log, entries: trimmed });
      }
    } catch {
      // 清理失败不阻塞
    }
  }

  // ════════════════════════════════════════════════════════════════
  // M6.1: Meta Layer 调度
  // ════════════════════════════════════════════════════════════════

  /** Meta Layer 间隔检查 + auditor 调度 */
  private async runMetaLayerScheduling(now: number): Promise<void> {
    // 加载调度状态
    let metaState: Record<string, unknown> = {};
    try {
      const msResult = await this.deps.memory.getSlot("meta_layer_state");
      if (msResult.ok && msResult.value) {
        metaState = msResult.value as Record<string, unknown>;
      }
    } catch { /* 降级: 首次运行 */ }

    const lastStructuralScan = typeof metaState.lastStructuralScan === "number" ? metaState.lastStructuralScan : 0;
    const lastCategoryAudit = typeof metaState.lastCategoryAudit === "number" ? metaState.lastCategoryAudit : 0;

    let updated = false;

    // 结构性缺口扫描 (每 168h)
    if (now - lastStructuralScan >= STRUCTURAL_GAP_SCAN_INTERVAL) {
      await this.runArchitectureAudit(now);
      metaState.lastStructuralScan = now;
      updated = true;
    }

    // 范畴审计 (每 720h)
    if (now - lastCategoryAudit >= CATEGORY_AUDIT_INTERVAL) {
      await this.runCategoryAudit(now);
      metaState.lastCategoryAudit = now;
      updated = true;
    }

    if (updated) {
      try {
        await this.deps.memory.setSlot("meta_layer_state", metaState);
      } catch { /* 持久化失败不阻塞 */ }
    }
  }

  private async runArchitectureAudit(now: number): Promise<void> {
    try {
      const auditor = new ArchitectureAuditor();

      // 获取 audit_log
      const auditResult = await this.deps.memory.getSlot("audit_log");
      const auditLog: Array<Record<string, unknown>> = [];
      if (auditResult.ok && auditResult.value) {
        const log = auditResult.value as Record<string, unknown>;
        auditLog.push(...(Array.isArray(log.entries) ? log.entries as Array<Record<string, unknown>> : []));
      }

      // 获取结构
      const structResult = await this.deps.memory.smartSearch("*", "proto_structure");
      const structures: ProtoStructure[] = (structResult.ok && Array.isArray(structResult.value))
        ? structResult.value as unknown as ProtoStructure[]
        : [];

      // 获取能力模型
      const compResult = await this.deps.memory.getSlot("competency_model");
      const competencyModel = (compResult.ok && compResult.value) ? compResult.value as Record<string, unknown> : null;

      const llmClient = this.deps.llm?.analyze
        ? { analyze: (p: string) => this.deps.llm!.analyze!(p) }
        : undefined;
      const report = await auditor.run(auditLog, structures, competencyModel, llmClient);
      await this.deps.memory.setSlot("architecture_audit", report as unknown as Record<string, unknown>);
    } catch {
      // 审计失败不阻塞 cron_tick
    }
  }

  private async runCategoryAudit(now: number): Promise<void> {
    try {
      const auditor = new CategoryAuditor();

      // 聚合纠正聚类
      const correctionClusters = await this.aggregateCorrectionClusters(now);

      // 获取结构
      const structResult = await this.deps.memory.smartSearch("*", "proto_structure");
      const structures: ProtoStructure[] = (structResult.ok && Array.isArray(structResult.value))
        ? structResult.value as unknown as ProtoStructure[]
        : [];

      const llmClient = this.deps.llm?.analyze
        ? { analyze: (p: string) => this.deps.llm!.analyze!(p) }
        : undefined;
      const report = await auditor.run(correctionClusters, structures, llmClient);
      await this.deps.memory.setSlot("category_audit", report as unknown as Record<string, unknown>);

      // 写入 category_blind_spot 条目到 audit_log
      for (const spot of report.blindSpots) {
        if (spot.diagnosis === "category_insufficient") {
          await this.appendAuditLogEntries([{
            timestamp: now,
            type: "category_blind_spot",
            severity: "warning",
            source: "category_auditor",
            detail: { pattern: spot.pattern, suggestedCategory: spot.suggestedCategory },
          }]);
        }
      }

      // 写入新范畴提案
      if (report.proposedNewTypes.length > 0) {
        await this.deps.memory.setSlot("category_proposals", report.proposedNewTypes as unknown as Record<string, unknown>);
      }
    } catch {
      // 审计失败不阻塞
    }
  }

  /** 从 audit_log + lessons 聚合纠正聚类 */
  private async aggregateCorrectionClusters(
    now: number,
  ): Promise<Array<{ pattern: string; count: number; last30Days: number }>> {
    const clusters: Array<{ pattern: string; count: number; last30Days: number }> = [];
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;

    try {
      // 从 audit_log 中的纠正信号聚合
      const auditResult = await this.deps.memory.getSlot("audit_log");
      if (auditResult.ok && auditResult.value) {
        const log = auditResult.value as Record<string, unknown>;
        const entries = Array.isArray(log.entries) ? log.entries as Array<Record<string, unknown>> : [];
        const corrections30d = entries.filter(e => {
          const ts = typeof e.timestamp === "number" ? e.timestamp : 0;
          return e.type === "teleological_check" && ts > cutoff;
        });
        if (corrections30d.length > 0) {
          clusters.push({
            pattern: "teleological_corrections",
            count: corrections30d.length,
            last30Days: corrections30d.length,
          });
        }
      }
    } catch { /* 降级 */ }

    return clusters;
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
