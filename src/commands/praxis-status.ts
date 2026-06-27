/**
 * Praxis Status — M6.4 能力报告 (8D 维度 + 成长轨迹 + 学习时间线)
 *
 * 数据来源:
 *   - 8D 维度: competency_model slot + competency_snapshots 历史快照 (由 cron_tick 写入)
 *   - 学习时间线: audit_log slot 最近条目 (由 before_tool_call, agent_end, cron_tick 写入)
 *   - 降级: 所有数据源不可用时显示有用提示
 *
 * 架构参考: §13 /praxis status
 */

import type { M0Deps } from "../m0-deps";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

interface CompetencyData {
  overallProficiency: number;
  dimensions: Record<string, number>;
  strongestDomains: string[];
  weakestDomains: string[];
  currentLearningFocus: string | null;
  source: "slot" | "derived" | "none";
}

interface GrowthSnapshot {
  timestamp: number;
  overallProficiency: number;
}

interface TimelineEntry {
  timestamp: number;
  type: string;
  summary: string;
}

export interface StatusReport {
  generatedAt: number;
  competency: CompetencyData | null;
  growthHistory: GrowthSnapshot[];
  learningTimeline: TimelineEntry[];
}

// ══════════════════════════════════════════════════════════════════
// 8D 维度标签 (与 CompetencyModel 8D 维度键名对齐)
// ══════════════════════════════════════════════════════════════════

const DIMENSION_LABELS: Record<string, string> = {
  tool_skills: "工具熟练度",
  domain_familiarity: "领域熟悉度",
  task_type_proficiency: "任务熟练度",
  user_model_confidence: "用户模型",
  process_management: "流程管理",
  action_reliability: "行动可靠性",
  proto_cognition: "原型认知",
  learning_velocity: "学习速度",
};

// ══════════════════════════════════════════════════════════════════
// 数据加载
// ══════════════════════════════════════════════════════════════════

export async function generateStatusReport(deps: M0Deps): Promise<StatusReport> {
  const now = Date.now();
  const competency = await loadCompetency(deps);
  const growthHistory = await loadGrowthHistory(deps);
  const learningTimeline = await loadLearningTimeline(deps);
  return { generatedAt: now, competency, growthHistory, learningTimeline };
}

async function loadCompetency(deps: M0Deps): Promise<CompetencyData | null> {
  // 尝试从 competency_model slot 读取 (由 AgentMemory 预置或 M6 cron_tick 写入)
  const result = await deps.memory.getSlot("competency_model");
  if (result.ok && result.value) {
    const model = result.value as Record<string, unknown>;
    const dims = (model.dimensions ?? model.domainProficiencies ?? {}) as Record<string, number>;
    return {
      overallProficiency: typeof model.overallProficiency === "number" ? model.overallProficiency : avgProficiency(dims),
      dimensions: dims,
      strongestDomains: Array.isArray(model.strongestDomains) ? model.strongestDomains as string[] : topN(dims, 3),
      weakestDomains: Array.isArray(model.weakestDomains) ? model.weakestDomains as string[] : bottomN(dims, 3),
      currentLearningFocus: typeof model.currentLearningFocus === "string" ? model.currentLearningFocus : null,
      source: "slot",
    };
  }

  // 降级: 从 competency_snapshots 推导最新 8D
  const snapshots = await loadGrowthHistory(deps);
  if (snapshots.length > 0) {
    const latest = snapshots[snapshots.length - 1];
    return {
      overallProficiency: latest.overallProficiency,
      dimensions: {},
      strongestDomains: [],
      weakestDomains: [],
      currentLearningFocus: null,
      source: "derived",
    };
  }

  return null;
}

async function loadGrowthHistory(deps: M0Deps): Promise<GrowthSnapshot[]> {
  try {
    const result = await deps.memory.getSlot("competency_snapshots");
    if (!result.ok || !Array.isArray(result.value)) return [];
    return (result.value as Array<Record<string, unknown>>)
      .filter(s => typeof s.timestamp === "number")
      .map(s => ({
        timestamp: s.timestamp as number,
        overallProficiency: typeof s.overallProficiency === "number" ? s.overallProficiency : 0.5,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

async function loadLearningTimeline(deps: M0Deps): Promise<TimelineEntry[]> {
  // 从 audit_log 读取最近条目 (由 before_tool_call, agent_end, cron_tick 写入)
  try {
    const result = await deps.memory.getSlot("audit_log");
    if (!result.ok || !result.value) return [];

    const log = result.value as Record<string, unknown>;
    const entries = Array.isArray(log.entries) ? log.entries as Array<Record<string, unknown>> : [];
    return entries
      .filter(e => typeof e.timestamp === "number")
      .sort((a, b) => (b.timestamp as number) - (a.timestamp as number))
      .slice(0, 20)
      .map(e => ({
        timestamp: e.timestamp as number,
        type: String(e.type ?? "event"),
        summary: formatTimelineSummary(e),
      }));
  } catch {
    return [];
  }
}

function formatTimelineSummary(entry: Record<string, unknown>): string {
  const detail = (entry.detail ?? {}) as Record<string, unknown>;
  switch (entry.type) {
    case "constraint_violation":
      return `约束违反: ${String(detail.constraintId ?? detail.toolName ?? "unknown")}`;
    case "teleological_check":
      return `目的论分析: ${typeof detail.isAlternativeImpl === "boolean" ? (detail.isAlternativeImpl ? "替代实现" : "真错误") : "分析完成"}`;
    case "structural_gap_signal": {
      const sigType = detail.signalType;
      const sigNames: Record<number, string> = { 1: "ProtoTask衰退", 2: "跨场景失败", 3: "纠正聚类", 4: "技能停滞", 5: "升级异常" };
      return `结构缺口信号: ${sigNames[Number(sigType)] ?? `#${sigType}`}`;
    }
    default:
      return String(entry.source ?? entry.type ?? "event");
  }
}

// ══════════════════════════════════════════════════════════════════
// 格式化输出
// ══════════════════════════════════════════════════════════════════

export function formatStatusReport(report: StatusReport): string {
  const lines: string[] = [];
  lines.push("## Praxis 认知状态");
  lines.push(`> 生成时间: ${new Date(report.generatedAt).toISOString()}`);
  lines.push("");

  // 8D 能力
  if (report.competency && report.competency.source !== "none") {
    const dims = report.competency.dimensions;
    const hasDims = Object.keys(dims).length > 0;

    lines.push("### 8D 能力维度");
    if (hasDims) {
      lines.push(formatDimensionBars(dims));
    } else if (report.competency.source === "derived") {
      lines.push(`  总体熟练度: ${(report.competency.overallProficiency * 100).toFixed(0)}% (从快照推导)`);
    }
    lines.push("");

    lines.push(`**总体熟练度**: ${(report.competency.overallProficiency * 100).toFixed(0)}%`);
    if (report.competency.strongestDomains.length > 0) {
      lines.push(`**最强领域**: ${report.competency.strongestDomains.join(", ")}`);
    }
    if (report.competency.weakestDomains.length > 0) {
      lines.push(`**最弱领域**: ${report.competency.weakestDomains.join(", ")}`);
    }
    if (report.competency.currentLearningFocus) {
      lines.push(`**当前学习重点**: ${report.competency.currentLearningFocus}`);
    }
    if (report.competency.source === "derived") {
      lines.push("_(数据来源: competency_snapshots 推导。写入 competency_model slot 以获得完整 8D 视图)_");
    }
    lines.push("");
  } else {
    lines.push("### 能力模型: 数据不可用");
    lines.push("_(competency_model slot 未写入且无历史快照。需要至少 1 次 cron_tick 运行来累积 competency_snapshots)_");
    lines.push("");
  }

  // 成长轨迹
  if (report.growthHistory.length >= 2) {
    lines.push("### 成长轨迹");
    lines.push(formatGrowthChart(report.growthHistory));
    lines.push("");
  } else {
    lines.push("### 成长轨迹: 数据不足");
    lines.push(`_(需要 ≥2 个 cron_tick 快照, 当前: ${report.growthHistory.length})_`);
    lines.push("");
  }

  // 学习时间线
  if (report.learningTimeline.length > 0) {
    lines.push(`### 学习时间线 (最近 ${report.learningTimeline.length} 条, 来源: audit_log)`);
    for (const entry of report.learningTimeline) {
      const date = new Date(entry.timestamp).toLocaleDateString();
      const typeTag = TIMELINE_TAGS[entry.type] ?? entry.type;
      lines.push(`  ${date} [${typeTag}] ${entry.summary}`);
    }
    lines.push("");
  } else {
    lines.push("### 学习时间线: 无记录");
    lines.push("_(audit_log 无条目。数据将在约束违反、agent_end 分析、cron_tick 检测后出现)_");
    lines.push("");
  }

  return lines.join("\n");
}

function formatDimensionBars(dimensions: Record<string, number>): string {
  const BAR_MAX = 20;
  return Object.entries(dimensions)
    .map(([key, value]) => {
      const label = DIMENSION_LABELS[key] ?? key;
      const barLen = Math.round((typeof value === "number" ? value : 0) * BAR_MAX);
      const bar = "█".repeat(barLen) + "░".repeat(BAR_MAX - barLen);
      return `  ${label.padEnd(14)} ${bar} ${(value * 100).toFixed(0)}%`;
    })
    .join("\n");
}

function formatGrowthChart(history: GrowthSnapshot[]): string {
  const recent = history.slice(-10);
  const lines: string[] = ["  ```", "  熟练度", "  1.0 ┤"];
  const chartHeight = 8;
  for (let row = chartHeight; row >= 0; row--) {
    const threshold = row / chartHeight;
    let line = `  ${threshold.toFixed(1)} ┤`;
    for (const snap of recent) {
      if (Math.abs(snap.overallProficiency - threshold) < 0.06) line += "●";
      else if (snap.overallProficiency >= threshold) line += "│";
      else line += " ";
    }
    lines.push(line);
  }
  lines.push(`     └${"─".repeat(recent.length)}→ 时间`);
  lines.push("  ```");
  if (recent.length >= 2) {
    const first = recent[0].overallProficiency;
    const last = recent[recent.length - 1].overallProficiency;
    const delta = last - first;
    lines.push(`  变化: ${first.toFixed(2)} → ${last.toFixed(2)} ${delta >= 0 ? "↗" : "↘"} ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)}%`);
  }
  return lines.join("\n");
}

const TIMELINE_TAGS: Record<string, string> = {
  constraint_violation: "约束违反",
  teleological_check: "目的论",
  structural_gap_signal: "结构缺口",
  category_blind_spot: "范畴盲区",
};

// ══════════════════════════════════════════════════════════════════
// 工具
// ══════════════════════════════════════════════════════════════════

function avgProficiency(dims: Record<string, number>): number {
  const values = Object.values(dims).filter(v => typeof v === "number");
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0.5;
}

function topN(dims: Record<string, number>, n: number): string[] {
  return Object.entries(dims)
    .sort(([, a], [, b]) => (typeof b === "number" ? b : 0) - (typeof a === "number" ? a : 0))
    .slice(0, n)
    .map(([k]) => DIMENSION_LABELS[k] ?? k);
}

function bottomN(dims: Record<string, number>, n: number): string[] {
  return Object.entries(dims)
    .sort(([, a], [, b]) => (typeof a === "number" ? a : 0) - (typeof b === "number" ? b : 0))
    .slice(0, n)
    .map(([k]) => DIMENSION_LABELS[k] ?? k);
}
