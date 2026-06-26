/**
 * Governor — 学习决策编排器 (M4 升级)
 *
 * 职责:
 *   - 4 阶段管道: classify → gate → decide → dispatch
 *   - 统一学习决策中心 (替代 LearningLoop 的编排职责)
 *   - Per-session 实例 (每个 session 独立状态，共享 MetacognitiveEngine)
 *   - 结构化日志 per decide() 调用
 *   - 降级传递: Governor 自身抛错 → 信号旁路到 ExecutionFeedback
 *
 * M4 升级:
 *   - classify: 4 粗类 → 20 细类 (COARSE_TO_FINE + LLM fine)
 *   - gate: isRealExperience + 去重 + 频次限制 + 噪声过滤
 *   - decide: async, 置信度感知, null 分支
 *   - dispatch: 保持 no-op (Governor 只负责决策)
 *
 * 设计来源: CEO Review + Eng Review (Governor-Centric Refactor) + Codex Review M4
 */

import type { Result } from "../platform-adapter";
import type {
  Correction,
  SessionContext,
  CoarseType,
  LearningEventType,
  FusedConfidence,
} from "./types";
import type { MetacognitiveEngine } from "./metacognitive-engine";
import type { LlmClient } from "../platform-adapter";
import { ExecutionFeedbackCollector } from "./execution-feedback";
import { isRealExperience } from "./utils/signal-quality";
import { classify, isKnownSignalType } from "./timing-controller";
import type { TimingDecision, SignalType } from "./timing-controller";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 粗→细分类映射 (架构 §4)
// ══════════════════════════════════════════════════════════════════

const COARSE_TO_FINE: Record<string, LearningEventType[]> = {
  correction: [
    "mistake_correction", "action_decision_error", "action_decision_oversight",
    "role_routing_mismatch", "role_routing_ambiguity",
  ],
  insight: [
    "domain_insight", "task_pattern_recognition", "procedural_optimization",
  ],
  preference: [
    "preference_discovery", "communication_style", "communication_detail_level",
    "timing_preference", "timing_pacing",
  ],
  pattern: [
    "process_efficiency_bottleneck", "process_efficiency_redundancy",
    "structural_inadequacy_detected", "structure_constructed",
    "structure_validated", "structure_regression",
  ],
  governance: ["governance_override"],
};

/** 粗分类默认 fine 类型 (LLM 不可用时的降级) */
const COARSE_DEFAULT: Record<string, LearningEventType> = {
  correction: "mistake_correction",
  insight: "domain_insight",
  preference: "preference_discovery",
  pattern: "structural_inadequacy_detected",
  governance: "governance_override",
};

// ══════════════════════════════════════════════════════════════════
// 管道中间类型
// ══════════════════════════════════════════════════════════════════

/** Stage 1 输出: 分类后的信号 */
export interface ClassifiedSignal {
  signalType: SignalType | "unknown";
  coarseType: CoarseType | "unknown";
  timing: TimingDecision;
  correction: Correction;
  sessionContext: SessionContext;
  classifiedAt: number;
}

/** Stage 2 输出: 门控后的信号 */
export interface GatedSignal {
  signal: ClassifiedSignal;
  passed: boolean;
  gateReason: string;
}

/** Stage 3/4 输出: 学习决策 */
export interface LearningDecision {
  action: "LEARN" | "DEFER" | "SKIP";
  confidence: number;
  routeTo: "execution_feedback" | "learning_update" | "deferred_queue" | "none";
  reason: string;
  signalType: SignalType | "unknown";
  timing: TimingDecision;
  decidedAt: number;
}

// ══════════════════════════════════════════════════════════════════
// Governor
// ══════════════════════════════════════════════════════════════════

export class Governor {
  readonly sessionId: string;
  private readonly metacognitive: MetacognitiveEngine;
  private readonly executionFeedback: ExecutionFeedbackCollector;
  private readonly llm?: LlmClient;
  /** 已做出决策的计数 (用于可观测性) */
  private decisionCount = 0;
  /** 旁路计数 (降级传递) */
  private bypassCount = 0;
  /** Gate 去重: 同一 (correction.what, correction.correctedTo) 在本 session 中的计数 */
  private readonly dedupTracker = new Map<string, number>();
  /** Gate 频次: 同一 structureId 在本 session 中的更新次数 */
  private readonly frequencyTracker = new Map<string, number>();
  /** 每结构每 session 最大学习更新次数 */
  private static readonly MAX_UPDATES_PER_STRUCTURE = 3;

  constructor(
    sessionId: string,
    metacognitive: MetacognitiveEngine,
    llm?: LlmClient,
  ) {
    this.sessionId = sessionId;
    this.metacognitive = metacognitive;
    this.llm = llm;
    this.executionFeedback = new ExecutionFeedbackCollector();
  }

  // ════════════════════════════════════════════════════════════════
  // 公共 API
  // ════════════════════════════════════════════════════════════════

  /**
   * 主决策入口: 接收原始修正信号 → 4 阶段管道 → 输出决策。
   * M4: 改为 async — LLM fine 分类 + 置信度查询均为异步 I/O。
   *
   * 降级保证: 即使管道内部抛错，也返回 SAFE_DEFAULT 决策
   * (action=DEFER, confidence=0, routeTo=none)。
   */
  async decide(
    correction: Correction,
    sessionContext: SessionContext,
    signalTypeHint?: string,
    fusedConfidence?: FusedConfidence | null,
  ): Promise<Result<LearningDecision>> {
    const start = Date.now();

    try {
      // Stage 1: classify (coarse 同步 + fine LLM 异步)
      const classified = await this.stage1Classify(correction, sessionContext, signalTypeHint);

      // Stage 2: gate
      const gated = this.stage2Gate(classified);

      // Stage 3: decide
      const decision = this.stage3Decide(gated, fusedConfidence ?? null);

      // Stage 4: dispatch (no-op — Governor 只负责决策)
      this.stage4Dispatch(decision);

      this.decisionCount++;

      log({
        ts: new Date().toISOString(),
        module: "governor",
        op: "decide",
        duration_ms: Date.now() - start,
        outcome: "success",
        error: `action=${decision.action} confidence=${decision.confidence} route=${decision.routeTo} signal=${decision.signalType} timing=${decision.timing}`,
      });

      return { ok: true, value: decision };
    } catch (e) {
      this.bypassCount++;
      const reason = e instanceof Error ? e.message : String(e);

      logDegraded("governor", "decide",
        `Pipeline failed (bypass #${this.bypassCount}): ${reason}`);

      try {
        this.executionFeedback.captureCorrection(correction, sessionContext);
      } catch (bypassErr) {
        logDegraded("governor", "decide",
          `Bypass capture also failed: ${bypassErr instanceof Error ? bypassErr.message : String(bypassErr)}`);
      }

      return {
        ok: true,
        value: {
          action: "DEFER",
          confidence: 0,
          routeTo: "none",
          reason: `Governor pipeline failed — signal bypassed: ${reason}`,
          signalType: "unknown",
          timing: "DEFERRED",
          decidedAt: Date.now(),
        },
      };
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 查询
  // ════════════════════════════════════════════════════════════════

  getStats(): GovernorStats {
    return {
      sessionId: this.sessionId,
      decisionCount: this.decisionCount,
      bypassCount: this.bypassCount,
      feedbackCount: (() => {
        const snap = this.executionFeedback.snapshot();
        return snap.ok ? snap.value.userCorrections.length : 0;
      })(),
    };
  }

  getFeedback(): Result<{ userCorrections: Correction[]; anomalies: string[] }> {
    const snapshot = this.executionFeedback.snapshot();
    if (!snapshot.ok) return snapshot;
    return {
      ok: true,
      value: {
        userCorrections: snapshot.value.userCorrections,
        anomalies: snapshot.value.anomalies,
      },
    };
  }

  reset(): void {
    this.executionFeedback.reset();
    this.dedupTracker.clear();
    this.frequencyTracker.clear();
    this.decisionCount = 0;
    this.bypassCount = 0;
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 1: classify — 4 粗类 → 20 细类
  // ════════════════════════════════════════════════════════════════

  private async stage1Classify(
    correction: Correction,
    sessionContext: SessionContext,
    signalTypeHint?: string,
  ): Promise<ClassifiedSignal> {
    // Step 1: 粗分类 (纯规则, 同步)
    let coarseType: CoarseType | "unknown";
    let fineType: LearningEventType;

    // 如果 signalTypeHint 是已知的 SignalType，直接使用（调用方已做语义分类）
    if (signalTypeHint && isKnownSignalType(signalTypeHint)) {
      fineType = signalTypeHint as LearningEventType;
      coarseType = inferCoarseType(signalTypeHint);
    } else if (signalTypeHint) {
      // 非已知信号类型 → 标记为 unknown, 不尝试推断
      const timing = classify("domain_insight"); // safe default for timing
      return {
        signalType: "unknown",
        coarseType: "unknown",
        timing: timing.decision,
        correction,
        sessionContext,
        classifiedAt: Date.now(),
      };
    } else {
      coarseType = inferCoarseTypeFromCorrection(correction, sessionContext);

      // Step 2: 细分类 (LLM, 异步)
      if (this.llm && coarseType !== "unknown") {
        fineType = await this.fineClassify(correction, coarseType);
      } else if (coarseType !== "unknown") {
        fineType = COARSE_DEFAULT[coarseType] ?? "domain_insight";
      } else {
        // 无法分类 → 安全默认
        fineType = "domain_insight";
      }
    }

    const timing = classify(fineType);

    return {
      signalType: timing.signalType,
      coarseType,
      timing: timing.decision,
      correction,
      sessionContext,
      classifiedAt: Date.now(),
    };
  }

  /** LLM fine 分类: 从粗类候选集中选择最匹配的细类 */
  private async fineClassify(
    correction: Correction,
    coarseType: CoarseType,
  ): Promise<LearningEventType> {
    const candidates = COARSE_TO_FINE[coarseType];
    if (!candidates || candidates.length <= 1) {
      return candidates?.[0] ?? COARSE_DEFAULT[coarseType];
    }

    if (!this.llm) {
      return candidates[0];
    }

    try {
      const prompt = buildFineClassifyPrompt(correction, candidates);
      const result = await this.llm.analyze(prompt);
      if (!result.ok) return candidates[0];

      const parsed = JSON.parse(result.value.trim());
      return candidates.includes(parsed.type) ? parsed.type : candidates[0];
    } catch {
      return candidates[0]; // 安全默认: coarse 的第一个 fine 类型
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 2: gate — isRealExperience + 去重 + 频次 + 噪声
  // ════════════════════════════════════════════════════════════════

  private stage2Gate(signal: ClassifiedSignal): GatedSignal {
    // Gate 1: isRealExperience
    if (!isRealExperience(signal.correction, signal.sessionContext)) {
      return { signal, passed: false, gateReason: "Not a real experience" };
    }

    // Gate 2: 噪声过滤 (先运行 — 不消耗去重/频次预算)
    if (signal.correction.isNewKnowledge === false &&
        !signal.sessionContext.hasExplicitRejection &&
        signal.coarseType !== "correction") {
      return { signal, passed: false, gateReason: "Noise filter — low confidence non-correction signal" };
    }

    // Gate 3: 未知信号类型 → 放行但标记 (噪声过滤之后)
    if (signal.signalType === "unknown") {
      return { signal, passed: true, gateReason: "Unknown signal type — passed with low confidence" };
    }

    // Gate 4: 去重 — 同一 (what, correctedTo) 首次保留，后续丢弃
    const dedupKey = `${signal.correction.what}::${signal.correction.correctedTo}`;
    const dedupCount = (this.dedupTracker.get(dedupKey) ?? 0) + 1;
    this.dedupTracker.set(dedupKey, dedupCount);
    if (dedupCount > 1) {
      return { signal, passed: false, gateReason: `Duplicate signal (${dedupCount}x in this session)` };
    }

    // Gate 5: 频次限制 — 同一结构单 session 最多 MAX_UPDATES 次
    const affectedIds = this.extractAffectedIds(signal);
    for (const id of affectedIds) {
      const count = (this.frequencyTracker.get(id) ?? 0) + 1;
      this.frequencyTracker.set(id, count);
      if (count > Governor.MAX_UPDATES_PER_STRUCTURE) {
        return { signal, passed: false, gateReason: `Frequency limit exceeded for structure ${id} (${count} > ${Governor.MAX_UPDATES_PER_STRUCTURE})` };
      }
    }

    return { signal, passed: true, gateReason: "All gates passed" };
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 3: decide — 置信度感知 + null 路径
  // ════════════════════════════════════════════════════════════════

  private stage3Decide(gated: GatedSignal, fusedConfidence: FusedConfidence | null): LearningDecision {
    if (!gated.passed) {
      return {
        action: "SKIP", confidence: 0, routeTo: "none",
        reason: gated.gateReason,
        signalType: gated.signal.signalType, timing: gated.signal.timing,
        decidedAt: Date.now(),
      };
    }

    const { timing, signalType } = gated.signal;

    switch (timing) {
      case "IMMEDIATE": {
        const isCorrection = signalType === "mistake_correction" ||
          gated.signal.coarseType === "correction";
        return {
          action: "LEARN",
          confidence: isCorrection ? 0.8 : 0.6,
          routeTo: "execution_feedback",
          reason: `IMMEDIATE: ${signalType} — routed to execution feedback`,
          signalType, timing, decidedAt: Date.now(),
        };
      }

      case "BATCH": {
        // M4: 置信度感知 — 融合结果决定 LEARN vs DEFER
        if (fusedConfidence === null) {
          return {
            action: "DEFER", confidence: 0, routeTo: "deferred_queue",
            reason: `BATCH: ${signalType} — insufficient sources (< 2), deferred`,
            signalType, timing, decidedAt: Date.now(),
          };
        }
        if (fusedConfidence.confidence >= 0.5) {
          return {
            action: "LEARN", confidence: fusedConfidence.confidence,
            routeTo: "learning_update",
            reason: `BATCH: ${signalType} — fused confidence ${fusedConfidence.confidence.toFixed(2)} ≥ 0.5`,
            signalType, timing, decidedAt: Date.now(),
          };
        }
        return {
          action: "DEFER", confidence: fusedConfidence.confidence,
          routeTo: "deferred_queue",
          reason: `BATCH: ${signalType} — fused confidence ${fusedConfidence.confidence.toFixed(2)} < 0.5`,
          signalType, timing, decidedAt: Date.now(),
        };
      }

      case "DEFERRED":
        return {
          action: "DEFER", confidence: 0.3, routeTo: "deferred_queue",
          reason: `DEFERRED: ${signalType} — queued for future evaluation`,
          signalType, timing, decidedAt: Date.now(),
        };

      default: {
        const _exhaustive: never = timing;
        return {
          action: "DEFER", confidence: 0, routeTo: "none",
          reason: `Unknown timing: ${_exhaustive}`,
          signalType, timing, decidedAt: Date.now(),
        };
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 4: dispatch — 保持 no-op
  // ════════════════════════════════════════════════════════════════

  /**
   * Governor 只负责决策，不负责执行。
   * 调用方根据 decision.routeTo 执行实际操作:
   *   - execution_feedback → 写入 ExecutionFeedbackCollector
   *   - learning_update → 暂存到 session-scoped 队列, session_end 批处理
   *   - deferred_queue → 写入 AgentMemory slot
   */
  private stage4Dispatch(decision: LearningDecision): void {
    // 有意为空 — Governor 只负责决策
    void decision;
  }

  // ════════════════════════════════════════════════════════════════
  // 内部工具
  // ════════════════════════════════════════════════════════════════

  /** 从信号中提取受影响的 ProtoStructure IDs */
  private extractAffectedIds(signal: ClassifiedSignal): string[] {
    // 从 correction 中提取 — 实际结构 ID 需要外部提供
    // 当前使用 correction 的 what 字段作为 fallback key
    return [`correction:${signal.correction.what}`];
  }
}

// ══════════════════════════════════════════════════════════════════
// 查询类型
// ══════════════════════════════════════════════════════════════════

export interface GovernorStats {
  sessionId: string;
  decisionCount: number;
  bypassCount: number;
  feedbackCount: number;
}

// ══════════════════════════════════════════════════════════════════
// 内部: 粗分类推断 (纯规则)
// ══════════════════════════════════════════════════════════════════

function inferCoarseTypeFromCorrection(
  correction: Correction,
  sessionContext: SessionContext,
): CoarseType | "unknown" {
  if (sessionContext.hasExplicitRejection) {
    if (correction.isNewKnowledge) return "correction";
    return "preference";
  }
  return "insight";
}

function inferCoarseType(signalType: string): CoarseType | "unknown" {
  for (const [coarse, fines] of Object.entries(COARSE_TO_FINE)) {
    if ((fines as string[]).includes(signalType)) {
      return coarse as CoarseType;
    }
  }
  return "unknown";
}

// ══════════════════════════════════════════════════════════════════
// 内部: LLM fine 分类 prompt 构造
// ══════════════════════════════════════════════════════════════════

function buildFineClassifyPrompt(
  correction: Correction,
  candidates: LearningEventType[],
): string {
  const candidateList = candidates.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return `将以下用户修正分类为其中一种信号类型。只返回JSON，不要Markdown。

修正内容: "${correction.what} → ${correction.correctedTo}"
可能原因: "${correction.likelyRootCause}"

候选类型:
${candidateList}

返回格式: {"type": "<候选类型之一>", "reason": "<一句话理由>"}`;
}
