/**
 * ExecutionFeedback — Phase 2: task_execute
 *
 * 职责:
 *   - 收集任务执行中的异常信号 (anomalies)
 *   - 捕获用户修正 (Correction)
 *   - 调用 isRealExperience() 判断经验有效性
 *
 * 当前阶段仅追踪 after_tool_call + message_received 中的显式修正信号。
 */

import type { Result } from "../platform-adapter";
import type {
  ExecutionFeedback as ExecutionFeedbackType,
  Correction,
  SessionContext,
} from "./types";
import { isRealExperience } from "./utils/signal-quality";
import { log } from "../logger";

// ══════════════════════════════════════════════════════════════════
// ExecutionFeedback
// ══════════════════════════════════════════════════════════════════

export class ExecutionFeedbackCollector {
  private corrections: Correction[] = [];
  private anomalies: string[] = [];
  private stepIndex = 0;

  /** 重置状态 (每个 task 开始时调用) */
  reset(): void {
    this.corrections = [];
    this.anomalies = [];
    this.stepIndex = 0;
  }

  /** 记录一个执行步骤 */
  advanceStep(): void {
    this.stepIndex++;
  }

  /**
   * 捕获用户修正。
   * 通过 isRealExperience() 过滤 — 只有真实经验才保留。
   */
  captureCorrection(
    correction: Correction,
    sessionContext: SessionContext,
  ): Result<Correction | null> {
    if (!isRealExperience(correction, sessionContext)) {
      log({
        ts: new Date().toISOString(),
        module: "execution-feedback",
        op: "captureCorrection",
        duration_ms: 0,
        outcome: "skipped",
        error: "Not a real experience — filtered",
      });
      return { ok: true, value: null };
    }

    this.corrections.push(correction);
    return { ok: true, value: correction };
  }

  /** 记录执行异常 */
  captureAnomaly(description: string): void {
    this.anomalies.push(description);
  }

  /** 导出当前收集的反馈 */
  snapshot(): Result<ExecutionFeedbackType> {
    return {
      ok: true,
      value: {
        stepIndex: this.stepIndex,
        anomalies: [...this.anomalies],
        userCorrections: [...this.corrections],
      },
    };
  }
}
