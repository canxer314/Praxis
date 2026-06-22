/**
 * GapDetector — E6: 缺口猎取 (CEO Review)
 *
 * 职责:
 *   - 检测 selfRating < 0.3 且 taskCount ≥ 3 的领域
 *   - 注入上下文提醒 (告诉 LLM "这个领域你需要提升")
 *   - 3 个 session 无改善 → 升级为 PERSISTENT_GAP
 *
 * 依赖: MetacognitiveEngine 的 profile 读取能力。
 */

import type { Result } from "../platform-adapter";
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  MetacognitiveProfile,
  KnowledgeGap,
  GapDetectionResult,
} from "./types";
import type { MetacognitiveEngine } from "./metacognitive-engine";
import { log } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 阈值常量
// ══════════════════════════════════════════════════════════════════

const LOW_SELF_RATING_THRESHOLD = 0.3;
const MIN_TASK_COUNT_FOR_GAP = 3;
const SESSIONS_NO_IMPROVEMENT_FOR_ESCALATION = 3;

// ══════════════════════════════════════════════════════════════════
// GapDetector
// ══════════════════════════════════════════════════════════════════

export class GapDetector {
  private readonly metacognitive: MetacognitiveEngine;

  constructor(metacognitive: MetacognitiveEngine) {
    if (!metacognitive) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP,"MetacognitiveEngine is required");
    this.metacognitive = metacognitive;
  }

  /**
   * 扫描 MetacognitiveProfile，检测需要关注的缺口。
   *
   * 规则:
   *   - selfRating < 0.3 且 taskCount ≥ 3 → 缺口候选
   *   - 连续 3 session 无 selfRating 提升 → PERSISTENT_GAP
   */
  async detect(): Promise<Result<GapDetectionResult>> {
    const start = Date.now();

    const profileResult = await this.metacognitive.getProfile();
    if (!profileResult.ok) return profileResult;

    const profile = profileResult.value;
    const gaps: KnowledgeGap[] = [];
    const escalatedGaps: GapDetectionResult["escalatedGaps"] = [];
    const contextReminders: string[] = [];

    for (const [domain, prof] of Object.entries(profile.domainProficiencies)) {
      // 条件: selfRating < 阈值 且 taskCount 足够
      if (
        prof.selfRating < LOW_SELF_RATING_THRESHOLD &&
        prof.taskCount >= MIN_TASK_COUNT_FOR_GAP
      ) {
        const existingGap = profile.knowledgeGaps.find(
          (g) => g.context.includes(domain) && !g.resolved,
        );

        if (!existingGap) {
          // 新缺口
          const newGap: KnowledgeGap = {
            topic: `${domain} 领域能力不足`,
            detectedAt: "self_identified",
            context: domain,
            resolved: false,
          };
          gaps.push(newGap);
        }

        // 检查是否需要升级
        const calibrationEntries = profile.calibrationHistory.filter(
          (c) => c.domain === domain,
        );
        const recentEntries = calibrationEntries.slice(-SESSIONS_NO_IMPROVEMENT_FOR_ESCALATION);

        if (
          recentEntries.length >= SESSIONS_NO_IMPROVEMENT_FOR_ESCALATION &&
          recentEntries.every((e) => e.calibrationDelta <= 0)
        ) {
          const gap = existingGap ?? gaps[gaps.length - 1];
          if (gap) {
            escalatedGaps.push({
              gap,
              severity: "PERSISTENT_GAP",
              sessionsWithNoImprovement: recentEntries.length,
            });
          }
        }

        contextReminders.push(
          `${domain}: 自评 ${prof.selfRating.toFixed(2)}，已完成 ${prof.taskCount} 个任务，需要刻意练习`,
        );
      }
    }

    log({
      ts: new Date().toISOString(),
      module: "gap-detector",
      op: "detect",
      duration_ms: Date.now() - start,
      outcome: "success",
    });

    return {
      ok: true,
      value: { gaps, escalatedGaps, contextReminders },
    };
  }
}
