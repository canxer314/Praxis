/**
 * analysis/config-adapter.ts — 配置自适应
 *
 * 根据 GovernancePolicy + session_count 运行时调整模块行为:
 *   - auto-update threshold: expert 用户可降低
 *   - curiosity mode: expert → proactive
 *   - max subagents: expert → 更高并发
 *
 * 架构参考: §9 GovernancePolicy, §11 analysis/config-adapter.ts
 */

export interface GovernancePolicy {
  autonomy: {
    defaultPolicy: {
      unknownOperation: string;
      lowRiskKnown: string;
      highRiskKnown: string;
      afterError: string;
    };
  };
  contextPressure: {
    normalThresholdK: number;
    elevatedThresholdK: number;
    highThresholdK: number;
    criticalThresholdK: number;
  };
  taskContext: {
    autoUpdateConfidenceThreshold: number;
  };
  curiosity: {
    mode: string;
    threshold?: number;
  };
  pitfallTracking: {
    autoDowngradeMisrate: number;
  };
  maxSubagents: number;
}

/**
 * 根据 session count 自适应调整阈值。
 * 专家用户 (≥ expertThreshold sessions) 降低阈值 (更快自动更新)。
 */
export function adaptThreshold(
  defaultValue: number,
  sessionCount: number,
  expertThreshold: number = 50,
): number {
  if (sessionCount < expertThreshold) return defaultValue;
  // Expert: reduce threshold by up to 0.2, floor at 0.1
  const reduction = Math.min(0.2, (sessionCount - expertThreshold) / 100 * 0.1);
  return Math.max(0.1, defaultValue - reduction);
}

/**
 * 根据 session count 自适应 Curiosity 模式。
 */
export function adaptCuriosityMode(
  policy: GovernancePolicy,
  sessionCount: number,
): string {
  if (sessionCount >= 50) return "proactive";
  if (sessionCount >= 20) return "ask_when_confident";
  return policy.curiosity.mode;
}

/**
 * 根据 session count 自适应最大子 Agent 并发数。
 */
export function adaptMaxSubagents(
  policy: GovernancePolicy,
  sessionCount: number,
): number {
  if (sessionCount >= 50) return Math.min(policy.maxSubagents + 2, 8);
  if (sessionCount >= 20) return Math.min(policy.maxSubagents + 1, 6);
  return policy.maxSubagents;
}
