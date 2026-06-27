/**
 * Praxis Status — 8D 能力雷达图 + 成长轨迹 + 学习时间线 (M6.4)
 *
 * 职责:
 *   - 从 competency_model slot 读取 8D 能力维度
 *   - 从 competency_snapshots slot 读取历史快照 (成长轨迹)
 *   - 从 learning_events / lessons 读取学习时间线
 *   - 生成文本格式的能力报告
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
}

interface GrowthSnapshot {
  timestamp: number;
  dimensions: Record<string, number>;
  overallProficiency: number;
}

interface LearningTimelineEntry {
  timestamp: number;
  type: string;
  summary: string;
}

export interface StatusReport {
  generatedAt: number;
  competency: CompetencyData | null;
  growthHistory: GrowthSnapshot[];
  learningTimeline: LearningTimelineEntry[];
}

// ══════════════════════════════════════════════════════════════════
// 8D 维度定义
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

  // 1. 加载能力模型
  const competency = await loadCompetency(deps);

  // 2. 加载成长历史快照
  const growthHistory = await loadGrowthHistory(deps);

  // 3. 加载学习时间线
  const learningTimeline = await loadLearningTimeline(deps);

  return { generatedAt: now, competency, growthHistory, learningTimeline };
}

async function loadCompetency(deps: M0Deps): Promise<CompetencyData | null> {
  try {
    const result = await deps.memory.getSlot("competency_model");
    if (!result.ok || !result.value) return null;
    const model = result.value as Record<string, unknown>;

    return {
      overallProficiency: typeof model.overallProficiency === "number" ? model.overallProficiency : 0.5,
      dimensions: (model.dimensions ?? model.domainProficiencies ?? {}) as Record<string, number>,
      strongestDomains: Array.isArray(model.strongestDomains) ? model.strongestDomains as string[] : [],
      weakestDomains: Array.isArray(model.weakestDomains) ? model.weakestDomains as string[] : [],
      currentLearningFocus: typeof model.currentLearningFocus === "string" ? model.currentLearningFocus : null,
    };
  } catch {
    return null;
  }
}

async function loadGrowthHistory(deps: M0Deps): Promise<GrowthSnapshot[]> {
  try {
    const result = await deps.memory.getSlot("competency_snapshots");
    if (!result.ok || !Array.isArray(result.value)) return [];
    return (result.value as Array<Record<string, unknown>>)
      .filter(s => typeof s.timestamp === "number")
      .map(s => ({
        timestamp: s.timestamp as number,
        dimensions: (s.dimensions ?? s.domainProficiencies ?? {}) as Record<string, number>,
        overallProficiency: typeof s.overallProficiency === "number" ? s.overallProficiency : 0.5,
      }));
  } catch {
    return [];
  }
}

async function loadLearningTimeline(deps: M0Deps): Promise<LearningTimelineEntry[]> {
  try {
    // 从 lessons 中查询最近学习事件
    const result = await deps.memory.smartSearch("lesson", "lesson");
    if (!result.ok || !Array.isArray(result.value)) return [];
    return (result.value as Array<Record<string, unknown>>)
      .filter(l => typeof l.timestamp === "number")
      .sort((a, b) => (b.timestamp as number) - (a.timestamp as number))
      .slice(0, 20)
      .map(l => ({
        timestamp: l.timestamp as number,
        type: String(l.type ?? "learning_event"),
        summary: String(l.content ?? l.detail ?? "").slice(0, 120),
      }));
  } catch {
    return [];
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

  // 8D 雷达图
  if (report.competency) {
    lines.push("### 8D 能力雷达图");
    lines.push(formatRadarChart(report.competency.dimensions));
    lines.push("");

    // 总体熟练度
    const pct = (report.competency.overallProficiency * 100).toFixed(0);
    lines.push(`**总体熟练度**: ${report.competency.overallProficiency.toFixed(2)} (${pct}%)`);
    lines.push(`**最强领域**: ${report.competency.strongestDomains.join(", ") || "N/A"}`);
    lines.push(`**最弱领域**: ${report.competency.weakestDomains.join(", ") || "N/A"}`);
    if (report.competency.currentLearningFocus) {
      lines.push(`**当前学习重点**: ${report.competency.currentLearningFocus}`);
    }
    lines.push("");
  } else {
    lines.push("### 能力模型: 数据不可用");
    lines.push("_(尚未积累足够的 session 数据来构建能力模型)_");
    lines.push("");
  }

  // 成长轨迹
  if (report.growthHistory.length >= 2) {
    lines.push("### 成长轨迹");
    lines.push(formatGrowthTrajectory(report.growthHistory));
    lines.push("");
  } else {
    lines.push("### 成长轨迹: 数据不足");
    lines.push(`_(需要 ≥2 个历史快照, 当前: ${report.growthHistory.length})_`);
    lines.push("");
  }

  // 学习时间线
  if (report.learningTimeline.length > 0) {
    lines.push(`### 学习时间线 (最近 ${report.learningTimeline.length} 条)`);
    for (const entry of report.learningTimeline) {
      const date = new Date(entry.timestamp).toLocaleDateString();
      const typeTag = LEARNING_TYPE_TAGS[entry.type] ?? entry.type;
      lines.push(`  ${date} [${typeTag}] ${entry.summary}`);
    }
    lines.push("");
  } else {
    lines.push("### 学习时间线: 无记录");
    lines.push("");
  }

  return lines.join("\n");
}

/** 生成文本 8D 雷达图 */
function formatRadarChart(dimensions: Record<string, number>): string {
  const labels = Object.keys(dimensions);
  if (labels.length === 0) return "  _(无维度数据)_";

  const BAR_MAX = 20; // 最大条形长度 (字符)
  const result: string[] = [];

  for (const key of labels) {
    const value = typeof dimensions[key] === "number" ? dimensions[key] : 0;
    const label = DIMENSION_LABELS[key] ?? key;
    const barLen = Math.round(value * BAR_MAX);
    const bar = "█".repeat(barLen) + "░".repeat(BAR_MAX - barLen);
    result.push(`  ${label.padEnd(14)} ${bar} ${(value * 100).toFixed(0)}%`);
  }

  return result.join("\n");
}

/** 生成成长轨迹文本图 */
function formatGrowthTrajectory(history: GrowthSnapshot[]): string {
  // 只显示最近 10 个快照
  const recent = history.slice(-10);
  const lines: string[] = [];
  lines.push("  ```");
  lines.push("  熟练度");
  lines.push("  1.0 ┤");

  // 简化: 显示每个快照作为点
  const maxVal = 1.0;
  const chartHeight = 8;
  for (let row = chartHeight; row >= 0; row--) {
    const threshold = (row / chartHeight) * maxVal;
    let line = `  ${threshold.toFixed(1)} ┤`;
    for (const snap of recent) {
      const y = snap.overallProficiency;
      if (y >= threshold - (maxVal / chartHeight / 2) && y < threshold + (maxVal / chartHeight / 2)) {
        line += "●";
      } else if (y >= threshold) {
        line += "│";
      } else {
        line += " ";
      }
    }
    lines.push(line);
  }
  lines.push("     └" + "─".repeat(recent.length) + "→ 时间");
  lines.push("  ```");

  // 显示首尾对比
  if (recent.length >= 2) {
    const first = recent[0].overallProficiency;
    const last = recent[recent.length - 1].overallProficiency;
    const delta = last - first;
    const arrow = delta >= 0 ? "↗" : "↘";
    lines.push(`  变化: ${first.toFixed(2)} → ${last.toFixed(2)} ${arrow} ${(delta >= 0 ? "+" : "")}${(delta * 100).toFixed(0)}%`);
  }

  return lines.join("\n");
}

const LEARNING_TYPE_TAGS: Record<string, string> = {
  correction: "纠正",
  insight: "洞察",
  preference: "偏好",
  pattern: "模式",
  success: "成功",
  failure: "失败",
  structure_used: "结构引用",
  prediction_marker: "预测",
  constraint_violation: "约束违反",
  teleological_check: "目的论",
};
