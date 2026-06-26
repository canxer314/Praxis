/**
 * TeleologicalJudge — 双重性质判断 (M5.2)
 *
 * 职责:
 *   - 判断用户纠正 ProtoSequence 步骤时是"替代实现"还是"真错误"
 *   - quickCheck: 实时路径 — postcondition 关键词在纠正文本中覆盖率 ≥ 70% → 替代实现
 *   - deepCheck: 异步路径 (agent_end) — LLM 完整 teleological 分析
 *   - 替代实现: 更新 teleologicalMapping, 不下调置信度
 *   - 真错误: 允许 MidSessionLearner 按常规惩罚路径下调
 *
 * 架构参考: §3 双重性质 (teleological_mapping), §4 MidSessionLearner
 */

import type { ProtoSequence, ProtoStructure, TeleologicalMapping } from "../cognitive/types";
import type { LLMSubsystem } from "../m0-deps";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface TeleologicalJudgment {
  /** true = 替代实现（不下调置信度），false = 真错误 */
  isAlternativeImpl: boolean;
  /** 被保留的目的 */
  preservedPurposes: string[];
  /** 丢失的目的 */
  lostPurposes: string[];
  /** 新增的目的 */
  newPurposes: string[];
  /** quickCheck: 0-1 置信度; deepCheck: LLM 自评 */
  confidence: number;
}

// ══════════════════════════════════════════════════════════════════
// quickCheck — 实时纯规则路径 (< 1ms)
// ══════════════════════════════════════════════════════════════════

const ALT_IMPL_COVERAGE_THRESHOLD = 0.7;

/**
 * 快速判断：postcondition 关键词在纠正文本中的覆盖率。
 * 覆盖率 ≥ 70% → 替代实现；否则 → 待 deepCheck。
 *
 * @param sequence — 被纠正的 ProtoSequence
 * @param correctionText — 用户纠正的原始文本（非结构化步骤）
 */
export function quickCheck(
  sequence: ProtoSequence,
  correctionText: string,
): { isAltImpl: boolean; confidence: number } {
  if (!sequence.function?.postcondition || sequence.function.postcondition.length === 0) {
    return { isAltImpl: false, confidence: 0.3 }; // 无 postcondition → 无法判断，默认真错误
  }

  const lowerText = correctionText.toLowerCase();
  const postconditions = sequence.function.postcondition;
  let coveredCount = 0;

  for (const pc of postconditions) {
    // 提取 postcondition 中的关键词（中文双字+，英文词）
    const keywords = extractPostconditionKeywords(pc);
    if (keywords.length === 0) continue;

    const hitCount = keywords.filter(kw => lowerText.includes(kw.toLowerCase())).length;
    const coverage = hitCount / keywords.length;
    if (coverage >= 0.5) coveredCount++; // 单条 postcondition 半数关键词命中即覆盖
  }

  const overallCoverage = postconditions.length > 0
    ? coveredCount / postconditions.length
    : 0;

  return {
    isAltImpl: overallCoverage >= ALT_IMPL_COVERAGE_THRESHOLD,
    confidence: overallCoverage,
  };
}

function extractPostconditionKeywords(pc: string): string[] {
  // 中文双字及以上词组 + 英文单词
  const cn = pc.match(/[一-鿿]{2,}/g) ?? [];
  const en = pc.match(/\b[a-zA-Z]{2,}\b/g) ?? [];
  return [...cn, ...en];
}

// ══════════════════════════════════════════════════════════════════
// deepCheck — LLM 异步路径
// ══════════════════════════════════════════════════════════════════

const DEEP_CHECK_PROMPT = `You are a teleological analyzer. Given a ProtoSequence (a pattern of steps with explicit purposes) and a user correction, determine whether the correction is an "alternative implementation" (same purposes served differently) or a "real error" (purposes not met).

Input:
- Original sequence steps: {{steps}}
- Original purposes (postconditions): {{postconditions}}
- User correction text: "{{correctionText}}"

Analyze:
1. Which original purposes are still served by the proposed change?
2. Which original purposes are lost?
3. Are there new purposes introduced?

Output JSON only:
{
  "isAlternativeImpl": true/false,
  "preservedPurposes": ["..."],
  "lostPurposes": ["..."],
  "newPurposes": ["..."],
  "confidence": 0.0-1.0
}

Rules:
- If ALL critical postconditions are preserved → isAlternativeImpl: true
- If ANY critical postcondition is lost AND not replaced → isAlternativeImpl: false
- Confidence should reflect how certain you are (0.7-0.9 for clear cases, 0.4-0.6 for ambiguous)`;

/**
 * LLM 深度 teleological 分析。
 * 在 agent_end 中异步调用，不阻塞实时消息处理。
 */
export async function deepCheck(
  sequence: ProtoSequence,
  correctionText: string,
  llm: LLMSubsystem,
): Promise<TeleologicalJudgment> {
  if (!llm.analyze) return fallbackJudgment(sequence);

  const steps = sequence.structure?.steps
    ?.map(s => `${s.position}. ${s.action} (by ${s.agent})`)
    .join("\n") ?? "(no steps)";
  const postconditions = sequence.function?.postcondition?.join("\n") ?? "(no postconditions)";

  const prompt = DEEP_CHECK_PROMPT
    .replace("{{steps}}", steps)
    .replace("{{postconditions}}", postconditions)
    .replace("{{correctionText}}", correctionText);

  try {
    const result = await llm.analyze(prompt);
    if (!result.ok) {
      return fallbackJudgment(sequence);
    }
    let json = result.value.trim();
    // 处理 markdown 代码块包裹
    const fenceMatch = json.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n\s*```\s*$/);
    if (fenceMatch) json = fenceMatch[1];

    const parsed = JSON.parse(json);
    return {
      isAlternativeImpl: Boolean(parsed.isAlternativeImpl),
      preservedPurposes: Array.isArray(parsed.preservedPurposes) ? parsed.preservedPurposes : [],
      lostPurposes: Array.isArray(parsed.lostPurposes) ? parsed.lostPurposes : [],
      newPurposes: Array.isArray(parsed.newPurposes) ? parsed.newPurposes : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return fallbackJudgment(sequence);
  }
}

function fallbackJudgment(sequence: ProtoSequence): TeleologicalJudgment {
  return {
    isAlternativeImpl: false,
    preservedPurposes: [],
    lostPurposes: sequence.function?.postcondition ?? [],
    newPurposes: [],
    confidence: 0.3,
  };
}

// ══════════════════════════════════════════════════════════════════
// TeleologicalMapping 更新
// ══════════════════════════════════════════════════════════════════

/**
 * 当判断为替代实现时，更新 teleologicalMapping。
 * 保留原有映射中仍在服务的条目，标记丢失的条目。
 */
export function updateTeleologicalMapping(
  sequence: ProtoSequence,
  judgment: TeleologicalJudgment,
): ProtoSequence {
  const updated = { ...sequence };
  const existingMapping = [...(sequence.teleologicalMapping ?? [])];

  // 移除丢失目的的映射
  const filtered = existingMapping.filter(
    m => !judgment.lostPurposes.includes(m.contributesTo),
  );

  // 添加新目的的映射（标记为 supporting，待 LLM 或用户确认 criticality）
  for (const newPurpose of judgment.newPurposes) {
    filtered.push({
      stepIndex: -1, // 新目的暂不关联具体步骤
      contributesTo: newPurpose,
      criticality: "supporting",
    });
  }

  updated.teleologicalMapping = filtered;
  return updated;
}

// ══════════════════════════════════════════════════════════════════
// 辅助: 判断 ProtoStructure 是否为 ProtoSequence
// ══════════════════════════════════════════════════════════════════

export function isProtoSequence(s: ProtoStructure): s is ProtoSequence {
  return s.protoType === "sequence";
}
