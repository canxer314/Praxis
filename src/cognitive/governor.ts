/**
 * Governor — 学习决策编排器
 *
 * 职责:
 *   - 4 阶段管道: classify → gate → decide → dispatch
 *   - 统一学习决策中心 (替代 LearningLoop 的编排职责)
 *   - Per-session 实例 (每个 session 独立状态，共享 MetacognitiveEngine)
 *   - 结构化日志 per decide() 调用
 *   - 降级传递: Governor 自身抛错 → 信号旁路到 ExecutionFeedback
 *
 * 设计来源: CEO Review + Eng Review (Governor-Centric Refactor)
 */

import type { Result } from "../platform-adapter";
import type {
  Correction,
  SessionContext,
} from "./types";
import type { MetacognitiveEngine } from "./metacognitive-engine";
import { ExecutionFeedbackCollector } from "./execution-feedback";
import { isRealExperience } from "./utils/signal-quality";
import { classify } from "./timing-controller";
import type { TimingDecision, SignalType } from "./timing-controller";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 管道中间类型
// ══════════════════════════════════════════════════════════════════

/** Stage 1 输出: 分类后的信号 */
export interface ClassifiedSignal {
  signalType: SignalType | "unknown";
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
  /** 已做出决策的计数 (用于可观测性) */
  private decisionCount = 0;
  /** 旁路计数 (降级传递) */
  private bypassCount = 0;

  constructor(
    sessionId: string,
    metacognitive: MetacognitiveEngine,
  ) {
    this.sessionId = sessionId;
    this.metacognitive = metacognitive;
    this.executionFeedback = new ExecutionFeedbackCollector();
  }

  // ════════════════════════════════════════════════════════════════
  // 公共 API
  // ════════════════════════════════════════════════════════════════

  /**
   * 主决策入口: 接收原始修正信号 → 4 阶段管道 → 输出决策。
   *
   * 降级保证: 即使管道内部抛错，也返回 SAFE_DEFAULT 决策
   * (action=DEFER, confidence=0, routeTo=none)。
   *
   * @param correction 用户修正
   * @param sessionContext 会话上下文
   * @param signalTypeHint 外部提示的信号类型 (可选 — 来自 SignalDetector)
   */
  decide(
    correction: Correction,
    sessionContext: SessionContext,
    signalTypeHint?: string,
  ): Result<LearningDecision> {
    const start = Date.now();

    try {
      // Stage 1: classify
      const classified = this.stage1Classify(correction, sessionContext, signalTypeHint);

      // Stage 2: gate
      const gated = this.stage2Gate(classified);

      // Stage 3: decide
      const decision = this.stage3Decide(gated);

      // Stage 4: dispatch
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
      // 降级传递: Governor 自身抛错 → 旁路到 ExecutionFeedback
      this.bypassCount++;
      const reason = e instanceof Error ? e.message : String(e);

      logDegraded("governor", "decide",
        `Pipeline failed (bypass #${this.bypassCount}): ${reason}`);

      // 尝试将信号旁路到 ExecutionFeedback (best-effort)
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

  /** 获取决策统计 */
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

  /** 获取执行反馈收集器 (供外部读取) */
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

  /** 重置 per-session 状态 */
  reset(): void {
    this.executionFeedback.reset();
    this.decisionCount = 0;
    this.bypassCount = 0;
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 1: classify
  // ════════════════════════════════════════════════════════════════

  private stage1Classify(
    correction: Correction,
    sessionContext: SessionContext,
    signalTypeHint?: string,
  ): ClassifiedSignal {
    // 如果调用方提供了 signalType，直接使用；否则根据 sessionContext 推断
    const signalType = signalTypeHint ?? inferSignalType(correction, sessionContext);
    const timing = classify(signalType);

    return {
      signalType: timing.signalType,
      timing: timing.decision,
      correction,
      sessionContext,
      classifiedAt: Date.now(),
    };
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 2: gate
  // ════════════════════════════════════════════════════════════════

  private stage2Gate(signal: ClassifiedSignal): GatedSignal {
    // Quality gate: isRealExperience
    if (!isRealExperience(signal.correction, signal.sessionContext)) {
      return {
        signal,
        passed: false,
        gateReason: "Not a real experience — filtered by isRealExperience",
      };
    }

    // 信号类型未知 → 放行但标记 (不阻塞，避免丢掉潜在有价值信号)
    if (signal.signalType === "unknown") {
      return {
        signal,
        passed: true,
        gateReason: "Unknown signal type — passed with low confidence",
      };
    }

    return {
      signal,
      passed: true,
      gateReason: "All gates passed",
    };
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 3: decide
  // ════════════════════════════════════════════════════════════════

  private stage3Decide(gated: GatedSignal): LearningDecision {
    // 门控未通过 → SKIP
    if (!gated.passed) {
      return {
        action: "SKIP",
        confidence: 0,
        routeTo: "none",
        reason: gated.gateReason,
        signalType: gated.signal.signalType,
        timing: gated.signal.timing,
        decidedAt: Date.now(),
      };
    }

    const { timing, signalType } = gated.signal;

    // 时序路由决策
    switch (timing) {
      case "IMMEDIATE":
        return {
          action: "LEARN",
          confidence: 0.7, // 显式纠正信号 — 中等偏高置信度
          routeTo: "execution_feedback",
          reason: `IMMEDIATE: ${signalType} — routed to execution feedback`,
          signalType,
          timing,
          decidedAt: Date.now(),
        };

      case "BATCH":
        return {
          action: "LEARN",
          confidence: 0.5, // 批处理信号 — 中等置信度
          routeTo: "learning_update",
          reason: `BATCH: ${signalType} — routed to learning update (session_end)`,
          signalType,
          timing,
          decidedAt: Date.now(),
        };

      case "DEFERRED":
        return {
          action: "DEFER",
          confidence: 0.3, // 延迟信号 — 低置信度
          routeTo: "deferred_queue",
          reason: `DEFERRED: ${signalType} — queued for future evaluation`,
          signalType,
          timing,
          decidedAt: Date.now(),
        };

      default: {
        // 穷尽性守卫 — 不应到达
        const _exhaustive: never = timing;
        return {
          action: "DEFER",
          confidence: 0,
          routeTo: "none",
          reason: `Unknown timing decision: ${_exhaustive}`,
          signalType,
          timing,
          decidedAt: Date.now(),
        };
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Stage 4: dispatch
  // ════════════════════════════════════════════════════════════════

  private stage4Dispatch(decision: LearningDecision): void {
    if (decision.action === "SKIP" || decision.routeTo === "none") {
      return;
    }

    // execution_feedback 路由: 直接捕获到 ExecutionFeedbackCollector
    // (learning_update 和 deferred_queue 由调用方在 session_end 时处理)
    if (decision.routeTo === "execution_feedback") {
      // 注: 此时 correction 已在上层 decide() 的闭包中丢失;
      // dispatch 本身不做实际写入 — 调用方在拿到 decision 后自行处理。
      // Governor 只负责决策，不负责执行。
    }
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
// 内部: 信号类型推断
// ══════════════════════════════════════════════════════════════════

/**
 * 从 Correction + SessionContext 推断信号类型。
 *
 * 当前为轻量启发式 (Phase 1):
 *   - hasExplicitRejection + isNewKnowledge → mistake_correction
 *   - hasExplicitRejection + !isNewKnowledge → preference_discovery
 *   - default → domain_insight (安全默认 — 批处理)
 */
function inferSignalType(
  correction: Correction,
  sessionContext: SessionContext,
): string {
  if (sessionContext.hasExplicitRejection) {
    if (correction.isNewKnowledge) {
      return "mistake_correction";
    }
    return "preference_discovery";
  }
  return "domain_insight";
}
