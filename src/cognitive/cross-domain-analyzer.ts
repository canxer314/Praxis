/**
 * CrossDomainAnalyzer — E5: 跨领域迁移分析 (CEO Review)
 *
 * 职责:
 *   - 扫描所有领域的 lessons，识别可迁移的模式
 *   - 基于 string similarity + memory_smart_search 做跨领域类比
 *   - 生成 CrossDomainSuggestion 报告
 *   - Cron 执行后写入健康检查 slot
 *
 * 约束:
 *   - < 20 lessons → 跳过 (数据不足)，写入 SKIPPED
 *   - 建议 7 天未审核 → 自动标记 SKIP
 *   - Token 预算: ~50k/week (cron 批量执行)
 */

import type { Result } from "../platform-adapter";
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  CrossDomainAnalysis,
  CrossDomainSuggestion,
  CrossDomainMigration,
  CronHealthSlot,
} from "./types";
import { log, logDegraded } from "../logger";
import { SLOTS } from "./constants";

// ══════════════════════════════════════════════════════════════════
// 依赖接口
// ══════════════════════════════════════════════════════════════════

export interface CrossDomainMemoryClient {
  lessonRecall(query: Record<string, unknown>): Promise<Result<unknown[]>>;
  smartSearch(query: string, opts?: { limit?: number }): Promise<Result<unknown[]>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
  getSlot(name: string): Promise<Result<unknown>>;
}

// ══════════════════════════════════════════════════════════════════
// 阈值常量
// ══════════════════════════════════════════════════════════════════

const MIN_LESSONS_FOR_ANALYSIS = 20;
const AUTO_SKIP_TIMEOUT_DAYS = 7;
const AUTO_MIGRATE_SIMILARITY_THRESHOLD = 0.7;
const MIGRATION_DEGRADATION_THRESHOLD = -0.1;
const CRON_HEALTH_SLOT = SLOTS.CRON_HEALTH;
const MIGRATIONS_SLOT = SLOTS.CROSS_DOMAIN_MIGRATIONS;

// ══════════════════════════════════════════════════════════════════
// CrossDomainAnalyzer
// ══════════════════════════════════════════════════════════════════

export class CrossDomainAnalyzer {
  private readonly memory: CrossDomainMemoryClient;

  constructor(memory: CrossDomainMemoryClient) {
    if (!memory) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP,"CrossDomainMemoryClient is required");
    this.memory = memory;
  }

  /**
   * 执行跨领域分析 (cron 触发)。
   *
   * 流程:
   *   1. 检索所有 lessons，按 domain 分组
   *   2. < 20 lessons → SKIPPED
   *   3. 计算 domain 间相似度
   *   4. 生成 CrossDomainSuggestion
   *   5. 写入 cron_health slot
   */
  async analyze(): Promise<Result<CrossDomainAnalysis>> {
    const start = Date.now();

    // 1. 检索所有 lessons
    const lessonsResult = await this.memory.lessonRecall({});
    if (!lessonsResult.ok) {
      await this.writeHealthSlot("FAILED", lessonsResult.error?.message);
      return lessonsResult;
    }

    const lessons = lessonsResult.value ?? [];
    const dataCount = lessons.length;

    if (dataCount < MIN_LESSONS_FOR_ANALYSIS) {
      log({
        ts: new Date().toISOString(),
        module: "cross-domain-analyzer",
        op: "analyze",
        duration_ms: Date.now() - start,
        outcome: "skipped",
        error: `Insufficient data: ${dataCount} < ${MIN_LESSONS_FOR_ANALYSIS}`,
      });

      await this.writeHealthSlot("SKIPPED", `Insufficient data: ${dataCount} lessons`);
      return {
        ok: true,
        value: {
          suggestions: [],
          dataCount,
          candidatesFound: 0,
          executedAt: Date.now(),
        },
      };
    }

    // 2. 按 domain 分组
    const byDomain = new Map<string, unknown[]>();
    for (const lesson of lessons) {
      const record = lesson as Record<string, unknown>;
      const domain = (record.domain as string) ?? "unknown";
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain)!.push(lesson);
    }

    const domains = [...byDomain.keys()];

    // 3. 跨领域相似度计算 (string similarity + LLM prompt)
    const suggestions: CrossDomainSuggestion[] = [];

    // TODO: Phase 1 — 简化实现: 对 domain 对做 string similarity
    // Phase 2 — 引入 LLM 做深度语义类比
    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        const sourceDomain = domains[i];
        const targetDomain = domains[j];

        // Stub: string similarity placeholder
        const similarity = this.stringSimilarity(sourceDomain, targetDomain);

        if (similarity > 0.3) {
          suggestions.push({
            sourceDomain,
            targetDomain,
            similarity,
            pattern: `从 ${sourceDomain} 迁移模式到 ${targetDomain}`,
            applicabilityRationale: `领域名称相似度 ${similarity.toFixed(2)}`,
            status: "pending_review",
            generatedAt: Date.now(),
          });
        }
      }
    }

    // 4. 清理过期建议
    const cleanedSuggestions = await this.cleanupStaleSuggestions(suggestions);

    // 5. 写入 cron health
    await this.writeHealthSlot("OK");

    const analysis: CrossDomainAnalysis = {
      suggestions: cleanedSuggestions,
      dataCount,
      candidatesFound: suggestions.length,
      executedAt: Date.now(),
    };

    log({
      ts: new Date().toISOString(),
      module: "cross-domain-analyzer",
      op: "analyze",
      duration_ms: Date.now() - start,
      outcome: "success",
    });

    return { ok: true, value: analysis };
  }

  // ══════════════════════════════════════════════════════════════
  // E5 Phase 2.2: 自动迁移
  // ══════════════════════════════════════════════════════════════

  /**
   * 从分析结果中筛选高置信度建议并标记为 accepted。
   *
   * 不直接创建策略——由调用方（CognitiveCore coordinator）负责策略创建，
   * 以保持 CrossDomainAnalyzer 与 StrategyRegistry 解耦。
   *
   * @returns 标记为 accepted 的建议列表（可能为空）
   */
  selectAutoApplyCandidates(analysis: CrossDomainAnalysis): CrossDomainSuggestion[] {
    if (!analysis || !Array.isArray(analysis.suggestions)) return [];
    return analysis.suggestions
      .filter(
        (s) =>
          s.status === "pending_review" &&
          s.similarity >= AUTO_MIGRATE_SIMILARITY_THRESHOLD,
      )
      .map((s) => ({ ...s, status: "accepted" as const, reviewedAt: Date.now() }));
  }

  /**
   * 读取所有已应用的跨领域迁移记录。
   */
  async getMigrations(): Promise<Result<CrossDomainMigration[]>> {
    const result = await this.memory.getSlot(MIGRATIONS_SLOT);
    if (!result.ok) return { ok: true, value: [] };
    const stored = result.value;
    if (Array.isArray(stored)) return { ok: true, value: stored as CrossDomainMigration[] };
    return { ok: true, value: [] };
  }

  /**
   * 持久化迁移记录。
   */
  async saveMigrations(migrations: CrossDomainMigration[]): Promise<Result<void>> {
    return this.memory.setSlot(MIGRATIONS_SLOT, migrations);
  }

  /**
   * 回滚一次跨领域迁移。
   *
   * 标记迁移记录为已回滚，实际策略回滚由调用方通过 callback 完成。
   *
   * @param migrationId 迁移记录 ID
   * @param reason 回滚原因
   * @param rollbackFn 执行策略回滚的回调（返回 true 表示回滚成功）
   */
  async rollbackMigration(
    migrationId: string,
    reason: string,
    rollbackFn: () => Promise<boolean>,
  ): Promise<Result<CrossDomainMigration | null>> {
    const migrationsResult = await this.getMigrations();
    if (!migrationsResult.ok) return migrationsResult;

    const migrations = migrationsResult.value;
    const idx = migrations.findIndex(
      (m) => m.id === migrationId && !m.rolledBackAt,
    );
    if (idx === -1) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Migration ${migrationId} not found or already rolled back`,
        },
      };
    }

    const success = await rollbackFn();
    if (!success) {
      return {
        ok: false,
        error: {
          code: "ROLLBACK_FAILED",
          message: `Strategy rollback for migration ${migrationId} failed`,
        },
      };
    }

    migrations[idx] = {
      ...migrations[idx],
      rolledBackAt: Date.now(),
      rollbackReason: reason,
    };

    const saveResult = await this.saveMigrations(migrations);
    if (!saveResult.ok) return saveResult;

    log({
      ts: new Date().toISOString(),
      module: "cross-domain-analyzer",
      op: "rollbackMigration",
      duration_ms: 0,
      outcome: "success",
      error: `Rolled back migration ${migrationId}: ${reason}`,
    });

    return { ok: true, value: migrations[idx] };
  }

  /**
   * 检测迁移是否导致目标领域退步。
   *
   * 比较当前 selfRating 与迁移时的 baselineRating，
   * 降幅超过阈值 → 建议回滚。
   *
   * @returns 需要回滚的迁移记录 ID 列表
   */
  findDegradedMigrations(
    migrations: CrossDomainMigration[],
    domainRatings: Map<string, number>,
  ): Array<{ migration: CrossDomainMigration; reason: string }> {
    const degraded: Array<{ migration: CrossDomainMigration; reason: string }> = [];

    for (const m of migrations) {
      if (m.rolledBackAt) continue;

      const currentRating = domainRatings.get(m.targetDomain);
      if (currentRating === undefined) continue;

      const delta = currentRating - m.baselineRating;
      if (delta < MIGRATION_DEGRADATION_THRESHOLD) {
        degraded.push({
          migration: m,
          reason: `Target domain ${m.targetDomain} degraded: ${m.baselineRating.toFixed(2)} → ${currentRating.toFixed(2)} (Δ${delta.toFixed(2)})`,
        });
      }
    }

    return degraded;
  }

  /**
   * 检查上次 cron 执行状态 — session_start 时调用。
   */
  async checkHealth(): Promise<Result<CronHealthSlot | null>> {
    const result = await this.memory.getSlot(CRON_HEALTH_SLOT);
    if (!result.ok) return { ok: true, value: null };
    return { ok: true, value: result.value as CronHealthSlot };
  }

  // ---- 内部 ----

  private async writeHealthSlot(
    status: CronHealthSlot["lastRunStatus"],
    error?: string,
  ): Promise<void> {
    const health: CronHealthSlot = {
      lastRunStatus: status,
      lastError: error,
      lastRunAt: Date.now(),
      dataCount: 0,
      candidatesFound: 0,
      suggestionsGenerated: 0,
    };

    const result = await this.memory.setSlot(CRON_HEALTH_SLOT, health);
    if (!result.ok) {
      logDegraded("cross-domain-analyzer", "writeHealthSlot", "failed to write health slot");
    }
  }

  /** 简单的 string similarity (Jaccard on bigrams) */
  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const bigramsA = new Set<string>();
    const bigramsB = new Set<string>();

    for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.substring(i, i + 2));
    for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.substring(i, i + 2));

    const intersection = new Set([...bigramsA].filter((x) => bigramsB.has(x)));
    const union = new Set([...bigramsA, ...bigramsB]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * 自动跳过 7 天未审核的建议。
   *
   * 使用 reviewedAt（最近一次审核时间）或 generatedAt（生成时间）中较晚者
   * 判断是否过期。未审核的建议 reviewedAt 为 undefined — 用 generatedAt 兜底。
   */
  private async cleanupStaleSuggestions(
    suggestions: CrossDomainSuggestion[],
  ): Promise<CrossDomainSuggestion[]> {
    const now = Date.now();
    const timeout = AUTO_SKIP_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

    return suggestions.map((s) => {
      const lastActivity = s.reviewedAt ?? s.generatedAt;
      if (
        s.status === "pending_review" &&
        now - lastActivity > timeout
      ) {
        return { ...s, status: "skipped" as const };
      }
      return s;
    });
  }
}
