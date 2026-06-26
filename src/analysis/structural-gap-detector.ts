/**
 * StructuralGapDetector — M5.4 StructuralGap 基础检测
 *
 * 职责:
 *   - 5 种 StructuralGap 检测信号的数据采集
 *   - 纯函数检测器: 每种信号独立、可测试
 *   - 不做完整分析 — 只做检测 + 结构化日志
 *   - 供 M6 Meta Layer 消费
 *
 * 信号:
 *   #1 ProtoTask 置信度连续下降
 *   #2 同一操作跨场景反复出错
 *   #3 用户反复纠正同一类问题
 *   #4 技能熟练度长期不增长 (复用 gap-detector.ts)
 *   #5 escalation 频率异常
 *
 * 架构参考: §8 元认知系统
 */

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface StructuralGapSignal {
  signalType: 1 | 2 | 3 | 4 | 5;
  detectedAt: number;
  evidence: {
    taskType?: string;
    scenarioIds?: string[];
    affectedStructures?: string[];
    metricSnapshot: Record<string, number>;
  };
  severity: "low" | "medium" | "high";
}

interface ProtoTaskHistoryEntry {
  taskType: string;
  confidence: number;
  timestamp: number;
}

interface ToolFailureRecord {
  toolName: string;
  scenarioId: string;
  failureCount: number;
  totalCalls: number;
}

interface CorrectionRecord {
  clusterId: string;
  count: number;
  last30Days: number;
}

interface CompetencySnapshot {
  dimension: string;
  proficiency: number;
  timestamp: number;
}

interface EscalationRecord {
  count: number;
  timestamp: number;
}

// ══════════════════════════════════════════════════════════════════
// Signal #1: ProtoTask 置信度连续下降
// ══════════════════════════════════════════════════════════════════

/**
 * 检测 ProtoTask 在同类任务中连续 3+ 次下降。
 */
export function detectProtoTaskDecline(
  history: ProtoTaskHistoryEntry[],
): StructuralGapSignal | null {
  if (history.length < 4) return null; // 至少需要 4 次记录才可能连续 3 次下降

  // 取最近 4 次，检查是否连续 3 次下降
  const recent = history.slice(-4);
  let declineCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].confidence < recent[i - 1].confidence) {
      declineCount++;
    } else {
      declineCount = 0; // 重置 — 要求连续下降
    }
  }

  if (declineCount >= 3) {
    const taskType = recent[0].taskType;
    return {
      signalType: 1,
      detectedAt: Date.now(),
      evidence: {
        taskType,
        metricSnapshot: {
          startConfidence: recent[0].confidence,
          endConfidence: recent[recent.length - 1].confidence,
          declineCount,
        },
      },
      severity: declineCount >= 5 ? "high" : "medium",
    };
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// Signal #2: 同一操作跨场景反复出错
// ══════════════════════════════════════════════════════════════════

/**
 * 检测同一 toolName 在 ≥ 2 个不同 scenario 中频繁失败 (失败率 > 50%)。
 */
export function detectCrossScenarioFailure(
  failures: ToolFailureRecord[],
): StructuralGapSignal | null {
  // 按 toolName 分组，统计跨场景失败
  const byTool = new Map<string, { scenarios: Set<string>; failures: number; total: number }>();
  for (const f of failures) {
    let rec = byTool.get(f.toolName);
    if (!rec) {
      rec = { scenarios: new Set(), failures: 0, total: 0 };
      byTool.set(f.toolName, rec);
    }
    rec.scenarios.add(f.scenarioId);
    rec.failures += f.failureCount;
    rec.total += f.totalCalls;
  }

  for (const [toolName, rec] of byTool) {
    if (rec.scenarios.size < 2) continue;
    const failureRate = rec.total > 0 ? rec.failures / rec.total : 0;
    if (failureRate > 0.5) {
      return {
        signalType: 2,
        detectedAt: Date.now(),
        evidence: {
          scenarioIds: [...rec.scenarios],
          metricSnapshot: {
            failureRate,
            scenariosAffected: rec.scenarios.size,
            totalCalls: rec.total,
          },
        },
        severity: failureRate > 0.8 ? "high" : "medium",
      };
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// Signal #3: 用户反复纠正同一类问题
// ══════════════════════════════════════════════════════════════════

/**
 * 检测同一类纠正出现 ≥ 5 次 / 30 天。
 */
export function detectCorrectionCluster(
  corrections: CorrectionRecord[],
): StructuralGapSignal | null {
  for (const c of corrections) {
    if (c.last30Days >= 5) {
      return {
        signalType: 3,
        detectedAt: Date.now(),
        evidence: {
          metricSnapshot: {
            clusterCount: c.last30Days,
            totalCount: c.count,
          },
        },
        severity: c.last30Days >= 10 ? "high" : "medium",
      };
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// Signal #4: 技能熟练度长期不增长
// ══════════════════════════════════════════════════════════════════

/**
 * 检测任一 8D 维度连续 30 天无变化 + 该维度 ≥ 5 个 session。
 * 注: 此检测器复用 gap-detector.ts 的 PERSISTENT_GAP 逻辑。
 * 此为独立纯函数版本，供 cron_tick 调用。
 */
export function detectSkillStagnation(
  history: CompetencySnapshot[],
  stagnantDays = 30,
  minSessions = 5,
): StructuralGapSignal | null {
  if (history.length < 2) return null;

  // 按维度分组
  const byDim = new Map<string, CompetencySnapshot[]>();
  for (const h of history) {
    let list = byDim.get(h.dimension);
    if (!list) { list = []; byDim.set(h.dimension, list); }
    list.push(h);
  }

  for (const [dimension, snapshots] of byDim) {
    if (snapshots.length < minSessions) continue;

    // 按时间排序
    snapshots.sort((a, b) => a.timestamp - b.timestamp);
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const daysSpan = (last.timestamp - first.timestamp) / (24 * 60 * 60 * 1000);

    if (daysSpan >= stagnantDays && Math.abs(last.proficiency - first.proficiency) < 0.05) {
      return {
        signalType: 4,
        detectedAt: Date.now(),
        evidence: {
          metricSnapshot: {
            dimension: dimension as unknown as number,
            daysStagnant: Math.round(daysSpan),
            sessionCount: snapshots.length,
            proficiencyDelta: last.proficiency - first.proficiency,
          },
        },
        severity: daysSpan >= 90 ? "high" : "medium",
      };
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// Signal #5: escalation 频率异常
// ══════════════════════════════════════════════════════════════════

/**
 * 检测 7 天内 escalation 次数超过历史均值 + 2σ。
 */
export function detectEscalationAnomaly(
  history: EscalationRecord[],
): StructuralGapSignal | null {
  if (history.length < 5) return null; // 不足计算统计显著性

  // 计算最近 7 天的 escalation 次数
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentCount = history.filter(e => e.timestamp >= sevenDaysAgo).length;

  // 计算历史均值和标准差 (排除最近 7 天)
  const historical = history.filter(e => e.timestamp < sevenDaysAgo);
  if (historical.length < 5) return null;

  const counts = historical.map(e => e.count);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length;
  const stddev = Math.sqrt(variance);

  const threshold = mean + 2 * stddev;
  if (recentCount > threshold && threshold > 0) {
    return {
      signalType: 5,
      detectedAt: now,
      evidence: {
        metricSnapshot: {
          recentCount,
          historicalMean: Math.round(mean * 100) / 100,
          threshold: Math.round(threshold * 100) / 100,
          stddev: Math.round(stddev * 100) / 100,
        },
      },
      severity: recentCount > mean + 3 * stddev ? "high" : "medium",
    };
  }

  return null;
}
