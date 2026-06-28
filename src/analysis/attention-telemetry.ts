/**
 * Attention Telemetry — M2 Step 3.1: 注意力遥测
 *
 * 从 LLM 输出中解析 [STRUCTURE_USED: proto_id] 标记，追踪每个结构的采纳率。
 * 检测僵尸结构（高置信度但低采纳率）和低估结构（低置信度但高采纳率）。
 *
 * 纯函数模块 — 无 I/O，无副作用。
 *
 * 架构参考: architech/praxis-architecture.md §7.3 (注意力遥测)
 */

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** 单个结构的注意力追踪状态 */
export interface AttentionRecord {
  structureId: string;
  /** LLM 输出中被标记使用的次数 */
  useCount: number;
  /** 该结构被注入的 session 总数 */
  injectionCount: number;
  /** 采纳率 = useCount / injectionCount（injectionCount 为 0 时返回 0） */
  adoptionRate: number;
  /** 最近一次被标记使用的时间戳 */
  lastUsedAt: number | null;
}

/** 僵尸结构检测结果 */
export interface ZombieDetection {
  structureId: string;
  confidence: number;
  adoptionRate: number;
  /** 僵尸判定原因 */
  reason: string;
}

/** 低估结构检测结果 */
export interface UnderestimatedDetection {
  structureId: string;
  confidence: number;
  adoptionRate: number;
  /** 建议的新置信度（当前置信度与采纳率的加权平均） */
  suggestedConfidence: number;
}

/** 遥测报告 */
export interface TelemetryReport {
  records: AttentionRecord[];
  zombies: ZombieDetection[];
  underestimated: UnderestimatedDetection[];
  /** 遥测覆盖的结构总数 */
  totalTracked: number;
}

// ══════════════════════════════════════════════════════════════════
// 检测阈值
// ══════════════════════════════════════════════════════════════════

/** 僵尸结构: confidence > this AND adoptionRate < ZOMBIE_ADOPTION_MAX */
const ZOMBIE_CONFIDENCE_MIN = 0.7;
/** 僵尸结构: adoptionRate < this */
const ZOMBIE_ADOPTION_MAX = 0.2;

/** 低估结构: confidence < this AND adoptionRate > UNDERESTIMATED_ADOPTION_MIN */
const UNDERESTIMATED_CONFIDENCE_MAX = 0.4;
/** 低估结构: adoptionRate > this */
const UNDERESTIMATED_ADOPTION_MIN = 0.6;

/** 采纳率计算中 injectionCount 的最小值（避免小样本误判） */
const MIN_INJECTIONS_FOR_DETECTION = 3;

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 从 LLM 输出文本中提取 [STRUCTURE_USED: id] 标记。
 *
 * 标记格式: [STRUCTURE_USED: proto_id]
 * 支持一行中出现多个标记。
 *
 * @param llmOutput  LLM 的完整输出文本
 * @returns 被标记使用的结构 ID 列表（去重）
 */
export function extractUsageMarkers(llmOutput: string): string[] {
  const pattern = /\[STRUCTURE_USED:\s*([^\]]+)\]/gi;
  const ids = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(llmOutput)) !== null) {
    ids.add(match[1].trim());
  }

  return [...ids];
}

/**
 * 更新注意力记录 — 将本 session 的使用标记合并到追踪状态。
 *
 * @param prev       上一轮追踪状态（首次调用传空 Map）
 * @param usedIds    本 session 中被标记使用的结构 ID 列表
 * @param injectedIds 本 session 中被注入的结构 ID 列表
 * @param now        当前时间戳
 * @returns 更新后的 AttentionRecord Map（key = structureId）
 */
export function updateAttention(
  prev: Map<string, AttentionRecord>,
  usedIds: string[],
  injectedIds: string[],
  now: number = Date.now(),
): Map<string, AttentionRecord> {
  const next = new Map(prev);

  // 为所有被注入的结构增加 injectionCount
  for (const id of injectedIds) {
    const record = next.get(id) ?? {
      structureId: id,
      useCount: 0,
      injectionCount: 0,
      adoptionRate: 0,
      lastUsedAt: null,
    };
    record.injectionCount++;
    record.adoptionRate = record.injectionCount > 0
      ? record.useCount / record.injectionCount
      : 0;
    next.set(id, record);
  }

  // 为被标记使用的结构增加 useCount
  const usedSet = new Set(usedIds);
  for (const id of usedSet) {
    let record = next.get(id);
    if (!record) {
      // 被使用但未被注入（可能是从 Critical 模式的 recall_structure 召回的）
      record = {
        structureId: id,
        useCount: 0,
        injectionCount: 0,
        adoptionRate: 0,
        lastUsedAt: null,
      };
    }
    record.useCount++;
    record.lastUsedAt = now;
    record.adoptionRate = record.injectionCount > 0
      ? record.useCount / record.injectionCount
      : 1.0; // 未注入但被使用 → adoption = 1.0 (通过 recall 使用)
    next.set(id, record);
  }

  return next;
}

/**
 * 检测僵尸结构: 高置信度 (≥0.7) 但低采纳率 (<20%)。
 * 仅对 injectionCount ≥ MIN_INJECTIONS_FOR_DETECTION 的结构进行检测。
 */
export function detectZombies(
  records: Map<string, AttentionRecord>,
  confidences: Map<string, number>, // structureId → confidence
): ZombieDetection[] {
  const zombies: ZombieDetection[] = [];

  for (const [id, record] of records) {
    const confidence = confidences.get(id);
    if (confidence === undefined) continue;
    if (record.injectionCount < MIN_INJECTIONS_FOR_DETECTION) continue;

    if (confidence > ZOMBIE_CONFIDENCE_MIN && record.adoptionRate < ZOMBIE_ADOPTION_MAX) {
      zombies.push({
        structureId: id,
        confidence,
        adoptionRate: record.adoptionRate,
        reason: `置信度 ${(confidence * 100).toFixed(0)}% 但采纳率仅 ${(record.adoptionRate * 100).toFixed(0)}%（注入 ${record.injectionCount} 次，使用 ${record.useCount} 次）`,
      });
    }
  }

  return zombies;
}

/**
 * 检测低估结构: 低置信度 (≤0.4) 但高采纳率 (>60%)。
 */
export function detectUnderestimated(
  records: Map<string, AttentionRecord>,
  confidences: Map<string, number>,
): UnderestimatedDetection[] {
  const underestimated: UnderestimatedDetection[] = [];

  for (const [id, record] of records) {
    const confidence = confidences.get(id);
    if (confidence === undefined) continue;
    if (record.injectionCount < MIN_INJECTIONS_FOR_DETECTION) continue;

    if (confidence < UNDERESTIMATED_CONFIDENCE_MAX && record.adoptionRate > UNDERESTIMATED_ADOPTION_MIN) {
      // 建议置信度 = 当前置信度 × 0.3 + 采纳率 × 0.7（偏向实际使用数据）
      const suggestedConfidence = Math.round((confidence * 0.3 + record.adoptionRate * 0.7) * 100) / 100;
      underestimated.push({
        structureId: id,
        confidence,
        adoptionRate: record.adoptionRate,
        suggestedConfidence,
      });
    }
  }

  return underestimated;
}

/**
 * 生成完整的遥测报告。
 */
export function generateTelemetryReport(
  records: Map<string, AttentionRecord>,
  confidences: Map<string, number>,
): TelemetryReport {
  return {
    records: [...records.values()],
    zombies: detectZombies(records, confidences),
    underestimated: detectUnderestimated(records, confidences),
    totalTracked: records.size,
  };
}

/**
 * 格式化遥测报告为人类可读文本。
 */
export function formatTelemetryReport(report: TelemetryReport): string {
  const lines: string[] = [
    `## 注意力遥测报告`,
    `追踪结构: ${report.totalTracked}`,
    "",
  ];

  if (report.zombies.length > 0) {
    lines.push(`### 🧟 僵尸结构 (${report.zombies.length})`);
    lines.push("高置信度但低采纳率 — 可能需要降级或废弃:");
    lines.push("");
    for (const z of report.zombies) {
      lines.push(`- \`${z.structureId}\`: ${z.reason}`);
    }
    lines.push("");
  }

  if (report.underestimated.length > 0) {
    lines.push(`### 📈 低估结构 (${report.underestimated.length})`);
    lines.push("低置信度但高采纳率 — 建议提升置信度:");
    lines.push("");
    for (const u of report.underestimated) {
      lines.push(`- \`${u.structureId}\`: 置信度 ${(u.confidence * 100).toFixed(0)}% → 建议 ${(u.suggestedConfidence * 100).toFixed(0)}%（采纳率 ${(u.adoptionRate * 100).toFixed(0)}%）`);
    }
    lines.push("");
  }

  if (report.zombies.length === 0 && report.underestimated.length === 0) {
    lines.push("✅ 无异常检测 — 所有结构的置信度与采纳率一致");
  }

  return lines.join("\n");
}
