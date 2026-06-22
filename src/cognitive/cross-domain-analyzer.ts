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
import type {
  CrossDomainAnalysis,
  CrossDomainSuggestion,
  CronHealthSlot,
} from "./types";
import { log, logDegraded } from "../logger";

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
const CRON_HEALTH_SLOT = "cron_health";

// ══════════════════════════════════════════════════════════════════
// CrossDomainAnalyzer
// ══════════════════════════════════════════════════════════════════

export class CrossDomainAnalyzer {
  private readonly memory: CrossDomainMemoryClient;

  constructor(memory: CrossDomainMemoryClient) {
    if (!memory) throw new Error("CrossDomainMemoryClient is required");
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

  /** 自动跳过 7 天未审核的建议 */
  private async cleanupStaleSuggestions(
    suggestions: CrossDomainSuggestion[],
  ): Promise<CrossDomainSuggestion[]> {
    const now = Date.now();
    const timeout = AUTO_SKIP_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

    return suggestions.map((s) => {
      if (
        s.status === "pending_review" &&
        s.reviewedAt &&
        now - s.reviewedAt > timeout
      ) {
        return { ...s, status: "skipped" as const };
      }
      return s;
    });
  }
}
