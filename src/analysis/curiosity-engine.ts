/**
 * CuriosityEngine — 4 阶段主动知识缺口检测 (M4.5)
 *
 * 阶段: detect → prioritize → act → govern
 *
 * 架构参考: §4 Curiosity Engine
 */

import type { MetacognitiveProfile, KnowledgeGap, Correction, ProtoConcept } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export type CuriosityAction =
  | "SILENT_MARK"
  | "FETCH_RESOURCES"
  | "DRAFT_QUESTION"
  | "REQUEST_HELP";

export interface CuriosityResult {
  gaps: KnowledgeGap[];
  rankedGaps: RankedGap[];
  actions: CuriosityAction[];
}

export interface RankedGap {
  gap: KnowledgeGap;
  priority: number;
  action: CuriosityAction;
}

export interface QuestionGovernance {
  maxQuestionsPerDay: number;
  quietHoursStart: string;   // "22:00"
  quietHoursEnd: string;     // "07:00"
  minIntervalMinutes: number;
  batchMergeWindowMinutes: number;
  redundancyCheck: boolean;
}

// ══════════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════════

const DEFAULT_GOVERNANCE: QuestionGovernance = {
  maxQuestionsPerDay: 3,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  minIntervalMinutes: 30,
  batchMergeWindowMinutes: 5,
  redundancyCheck: true,
};

const SILENT_THRESHOLD = 0.3;
const FETCH_THRESHOLD = 0.6;
const DRAFT_THRESHOLD = 0.8;
const CORRECTION_THRESHOLD = 3;

// ══════════════════════════════════════════════════════════════════
// CuriosityEngine
// ══════════════════════════════════════════════════════════════════

export class CuriosityEngine {
  private readonly governance: QuestionGovernance;
  private questionCountToday = 0;
  private lastQuestionTime = 0;

  constructor(governance?: Partial<QuestionGovernance>) {
    this.governance = { ...DEFAULT_GOVERNANCE, ...governance };
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 1: 缺口检测
  // ════════════════════════════════════════════════════════════════

  /** 未知术语检测 */
  detectUnknownTerms(transcript: string, knownConcepts: ProtoConcept[]): KnowledgeGap[] {
    if (!transcript || knownConcepts.length === 0) return [];
    const gaps: KnowledgeGap[] = [];
    const knownNames = new Set(knownConcepts.map((c) => c.tentativeName.toLowerCase()));

    // Extract capitalized phrases as potential terms
    const terms = transcript.match(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,}){0,3}\b/g) ?? [];
    for (const term of new Set(terms)) {
      if (!knownNames.has(term.toLowerCase())) {
        gaps.push({
          topic: term,
          detectedAt: "transcript_analysis",
          context: transcript.slice(0, 200),
          resolved: false,
        });
      }
    }
    return gaps;
  }

  /** 反复纠正模式检测 */
  detectRepeatedCorrections(corrections: Correction[]): KnowledgeGap[] {
    const gaps: KnowledgeGap[] = [];
    const patternCount = new Map<string, number>();

    for (const c of corrections) {
      const key = `${c.what} → ${c.correctedTo}`;
      patternCount.set(key, (patternCount.get(key) ?? 0) + 1);
    }

    for (const [pattern, count] of patternCount) {
      if (count >= CORRECTION_THRESHOLD) {
        gaps.push({
          topic: `Repeated correction: ${pattern}`,
          detectedAt: "repeated_correction",
          context: `${count} times corrected`,
          resolved: false,
        });
      }
    }
    return gaps;
  }

  /** 长期不增长技能检测 */
  detectStagnantSkills(profile: MetacognitiveProfile): KnowledgeGap[] {
    const gaps: KnowledgeGap[] = [];
    for (const [domain, prof] of Object.entries(profile.domainProficiencies ?? {})) {
      if (prof.selfRating < 0.3 && prof.taskCount >= 5) {
        const daysSinceLast = prof.lastCalibrated
          ? (Date.now() - prof.lastCalibrated) / (1000 * 60 * 60 * 24)
          : Infinity;
        if (daysSinceLast >= 30) {
          gaps.push({
            topic: `Stagnant skill: ${domain}`,
            detectedAt: "stagnant_skill",
            context: `Rating ${prof.selfRating.toFixed(2)} after ${prof.taskCount} tasks, ${Math.round(daysSinceLast)} days`,
            resolved: false,
          });
        }
      }
    }
    return gaps;
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 2: 优先级排序
  // ════════════════════════════════════════════════════════════════

  rank(gaps: KnowledgeGap[], relevanceMap: Map<string, number>): RankedGap[] {
    return gaps
      .map((gap) => {
        const relevance = relevanceMap.get(gap.topic) ?? 0.3;
        const frequency = gap.resolved ? 0 : 0.5;
        const impact = gap.topic.includes("Stagnant") ? 0.7 : 0.4;
        const urgency = gap.topic.includes("Repeated") ? 0.8 : 0.3;

        const priority = relevance * 0.35 + frequency * 0.25 + impact * 0.25 + urgency * 0.15;

        const action: CuriosityAction =
          priority < SILENT_THRESHOLD ? "SILENT_MARK"
          : priority < FETCH_THRESHOLD ? "FETCH_RESOURCES"
          : priority < DRAFT_THRESHOLD ? "DRAFT_QUESTION"
          : "REQUEST_HELP";

        return { gap, priority, action };
      })
      .sort((a, b) => b.priority - a.priority);
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 3: 行动生成
  // ════════════════════════════════════════════════════════════════

  act(rankedGaps: RankedGap[]): CuriosityAction[] {
    return rankedGaps
      .filter((r) => r.action !== "SILENT_MARK")
      .map((r) => {
        if (!this.canAskNow()) return "SILENT_MARK" as CuriosityAction;
        return r.action;
      });
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 4: 提问治理
  // ════════════════════════════════════════════════════════════════

  canAskNow(): boolean {
    // Daily limit
    if (this.questionCountToday >= this.governance.maxQuestionsPerDay) return false;

    // Quiet hours
    const now = new Date();
    const hour = now.getHours();
    const quietStart = parseInt(this.governance.quietHoursStart.split(":")[0]);
    const quietEnd = parseInt(this.governance.quietHoursEnd.split(":")[0]);
    if (quietStart > quietEnd) {
      // Overnight quiet hours
      if (hour >= quietStart || hour < quietEnd) return false;
    } else if (hour >= quietStart && hour < quietEnd) {
      return false;
    }

    // Minimum interval
    if (this.lastQuestionTime > 0 && (Date.now() - this.lastQuestionTime) < this.governance.minIntervalMinutes * 60_000) {
      return false;
    }

    return true;
  }

  recordQuestion(): void {
    this.questionCountToday++;
    this.lastQuestionTime = Date.now();
  }

  resetDaily(): void {
    this.questionCountToday = 0;
  }
}
