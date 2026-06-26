/**
 * MidSessionLearner — 会话中实时修正 (M5.1)
 *
 * 职责:
 *   - message_received 中检测用户纠正 → 记录 mid_session 信号源
 *   - before_tool_call 中检测约束违反 3+ 次 → 记录 mid_session 信号源
 *   - 不直接修改 confidence — 产出 SignalSourceInput 供 agent_end/session_end 融合
 *   - 单会话下调总量 ≤ 0.2（纠正+违规共享上限）
 *   - 纯规则匹配, < 10ms, 不调 LLM
 *
 * 架构参考: §4 MidSessionLearner
 */

import type { ProtoStructure, SignalSourceInput } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface DowngradeRecord {
  structureId: string;
  penalty: number;
  reason: "correction" | "constraint_violation";
  timestamp: number;
}

// ══════════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════════

/** 单会话累计惩罚硬上限 */
const MAX_SESSION_PENALTY = 0.2;

/** 每次修正基础下调幅度 */
const BASE_PENALTY = 0.05;

/** 约束违反触发下调的阈值次数 */
const VIOLATION_TRIGGER_COUNT = 3;

/** 约束违反每次下调幅度 */
const VIOLATION_PENALTY_PER = 0.03;

/** 约束违反最大下调 */
const VIOLATION_MAX_PENALTY = 0.10;

// ══════════════════════════════════════════════════════════════════
// 用户语言强度
// ══════════════════════════════════════════════════════════════════

const STRONG_NEGATION = /完全错了|重新做|全错|彻底|根本不对|completely wrong|redo/i;
const MEDIUM_NEGATION = /不对|应该是|不是这样|错了|wrong|should|correct/i;
const WEAK_NEGATION = /换成|改成|试试|不要|换一种|instead|maybe|perhaps/i;

function correctionConfidenceFactor(content: string): number {
  if (STRONG_NEGATION.test(content)) return 1.0;
  if (MEDIUM_NEGATION.test(content)) return 0.8;
  if (WEAK_NEGATION.test(content)) return 0.5;
  return 0.8; // 默认中等
}

// ══════════════════════════════════════════════════════════════════
// 关键词提取
// ══════════════════════════════════════════════════════════════════

/** 从纠正文本中提取候选关键词 */
export function extractKeywords(content: string): string[] {
  // 中文: 提取双字及以上词组
  const cnWords = content.match(/[一-鿿]{2,}/g) ?? [];
  // 英文: 提取驼峰/下划线/大写词
  const enWords = content.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g) ?? [];
  const enUpper = content.match(/\b[A-Z_]+\b/g) ?? [];
  return [...new Set([...cnWords, ...enWords, ...enUpper])];
}

// ══════════════════════════════════════════════════════════════════
// 结构匹配
// ══════════════════════════════════════════════════════════════════

/**
 * 用关键词匹配 ProtoStructure。
 * 返回匹配的结构及其匹配到的关键词子集。
 */
export function matchStructures(
  keywords: string[],
  structures: ProtoStructure[],
): Array<{ structure: ProtoStructure; matchedKeywords: string[]; relevance: number }> {
  if (keywords.length === 0 || structures.length === 0) return [];

  const lowerKeywords = keywords.map(k => k.toLowerCase());
  const scored = structures.map(s => {
    const searchText = buildSearchText(s).toLowerCase();
    const matched: string[] = [];
    for (let i = 0; i < keywords.length; i++) {
      if (searchText.includes(lowerKeywords[i])) {
        matched.push(keywords[i]); // 保留原始大小写
      }
    }
    const relevance = matched.length / Math.max(1, keywords.length);
    return { structure: s, matchedKeywords: matched, relevance };
  });

  return scored
    .filter(s => s.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);
}

function buildSearchText(s: ProtoStructure): string {
  const parts = [s.tentativeName];
  if (s.protoType === "sequence" && "structure" in s) {
    const seq = s as { structure?: { steps?: Array<{ action: string }> } };
    seq.structure?.steps?.forEach(st => parts.push(st.action));
  }
  if (s.protoType === "concept" && "definition" in s) {
    parts.push((s as { definition?: string }).definition ?? "");
  }
  if (s.protoType === "role" && "behaviors" in s) {
    const role = s as { behaviors?: string[] };
    role.behaviors?.forEach(b => parts.push(b));
  }
  return parts.join(" ");
}

// ══════════════════════════════════════════════════════════════════
// 惩罚计算
// ══════════════════════════════════════════════════════════════════

/**
 * 计算纠正惩罚值:
 *   penalty = base_penalty × correction_confidence × structure_relevance
 */
export function computePenalty(
  correctionText: string,
  structure: ProtoStructure,
  matchedKeywords: string[],
): number {
  const cf = correctionConfidenceFactor(correctionText);
  const keywords = extractKeywords(correctionText);
  const relevance = keywords.length > 0
    ? matchedKeywords.length / keywords.length
    : 0.3; // 无关键词时给低相关性默认值
  return BASE_PENALTY * cf * Math.max(0.1, relevance);
}

// ══════════════════════════════════════════════════════════════════
// MidSessionLearner
// ══════════════════════════════════════════════════════════════════

export class MidSessionLearner {
  /** 本会话累计惩罚 (纠正 + 违规共享) */
  private totalPenalty = 0;

  /** 本会话纠正次数 */
  private correctionCount = 0;

  /** 约束违反计数器: constraintId → count */
  private readonly violationCounters = new Map<string, number>();

  /** 已被惩罚的结构 ID 集合 (防止重复惩罚) */
  private readonly affectedStructures = new Set<string>();

  /** 已记录的降级记录（审计用） */
  private readonly records: DowngradeRecord[] = [];

  /**
   * 处理用户纠正。
   * @returns 本次产生的 mid_session 信号源（供 agent_end/session_end 融合）
   */
  handleCorrection(
    correctionText: string,
    structures: ProtoStructure[],
    logger?: { warn(msg: string, data?: Record<string, unknown>): void },
  ): SignalSourceInput[] {
    const sources: SignalSourceInput[] = [];
    if (!correctionText || structures.length === 0) return sources;

    const keywords = extractKeywords(correctionText);
    const matched = matchStructures(keywords, structures);
    // 候选集 > 5 时降级 — 标记为待 session_end LLM 处理
    if (matched.length > 5) {
      logger?.warn("MidSessionLearner: too many structure candidates, deferring to session_end", {
        candidateCount: matched.length,
        correctionPreview: correctionText.slice(0, 80),
      });
      return sources;
    }

    for (const { structure, matchedKeywords } of matched) {
      if (this.affectedStructures.has(structure.id)) continue;

      const penalty = computePenalty(correctionText, structure, matchedKeywords);
      const cappedPenalty = Math.min(penalty, MAX_SESSION_PENALTY - this.totalPenalty);
      if (cappedPenalty <= 0) continue; // 已达上限

      this.totalPenalty += cappedPenalty;
      this.correctionCount++;
      this.affectedStructures.add(structure.id);
      this.records.push({
        structureId: structure.id,
        penalty: cappedPenalty,
        reason: "correction",
        timestamp: Date.now(),
      });

      // 产生 mid_session 信号源：per-structure penalty, NOT totalPenalty
      // Fix: 使用 cappedPenalty 而非 totalPenalty — 避免跨结构污染
      const sourceValue = Math.max(0, 1.0 - cappedPenalty);
      sources.push({
        structureId: structure.id,
        sourceName: "mid_session",
        value: sourceValue,
        confidence: 0.7,
        evidence: `User correction #${this.correctionCount}: "${correctionText.slice(0, 100)}"`,
      });
    }

    return sources;
  }

  /**
   * 处理约束违反（在 before_tool_call 中调用）。
   * 1-2 次仅计数；3+ 次触发惩罚。
   */
  handleConstraintViolation(constraintId: string): SignalSourceInput[] {
    const sources: SignalSourceInput[] = [];
    if (!constraintId) return sources;

    const count = (this.violationCounters.get(constraintId) ?? 0) + 1;
    this.violationCounters.set(constraintId, count);

    if (count < VIOLATION_TRIGGER_COUNT) return sources;

    // 3+ 次 → 触发惩罚
    const penalty = Math.min(
      VIOLATION_PENALTY_PER * (count - VIOLATION_TRIGGER_COUNT + 1),
      VIOLATION_MAX_PENALTY,
    );
    const cappedPenalty = Math.min(penalty, MAX_SESSION_PENALTY - this.totalPenalty);
    if (cappedPenalty <= 0) return sources;

    this.totalPenalty += cappedPenalty;
    this.records.push({
      structureId: constraintId,
      penalty: cappedPenalty,
      reason: "constraint_violation",
      timestamp: Date.now(),
    });

    // per-violation penalty, not totalPenalty — 避免跨约束污染
    const sourceValue = Math.max(0, 1.0 - cappedPenalty);
    sources.push({
      structureId: constraintId,
      sourceName: "mid_session",
      value: sourceValue,
      confidence: 0.6, // 约束违反信号精度略低于直接纠正
      evidence: `Constraint "${constraintId}" violated ${count} times`,
    });

    return sources;
  }

  /** 获取并清空本会话所有 mid_session 信号源 */
  getMidSessionSources(): SignalSourceInput[] {
    return []; // 信号源已由 handleCorrection/handleConstraintViolation 实时产出
    // 调用方负责在 agent_end/session_end 时消费这些累积的信号源
  }

  /** 获取本会话累计惩罚 */
  getSessionTotalPenalty(): number {
    return this.totalPenalty;
  }

  /** 获取降级记录（审计用） */
  getRecords(): readonly DowngradeRecord[] {
    return this.records;
  }

  /** session_end 时重置 */
  reset(): void {
    this.totalPenalty = 0;
    this.correctionCount = 0;
    this.violationCounters.clear();
    this.affectedStructures.clear();
    this.records.length = 0;
  }
}
