/**
 * Praxis CLI — 命令解析和路由 (M5.5 + M3.5 + M6.4)
 *
 * 职责:
 *   - 解析 "/praxis <subcommand>" 模式
 *   - 路由到对应 handler
 *   - 供 message_received 集成
 */

import type { M0Deps } from "../m0-deps";
import { generateAuditReport, formatAuditReport } from "./praxis-audit";
import { generateStatusReport, formatStatusReport } from "./praxis-status";
import { generateOntologyReport, formatOntologyReport } from "./praxis-ontology";

export type PraxisCommand =
  | "ontology"
  | "audit"
  | "status"
  | "task"
  | "shadow-stats"
  | "show"
  | "scene-stats"
  | "learn"
  | "scene-log";

const ALL_COMMANDS: readonly string[] = [
  "ontology",
  "audit",
  "status",
  "task",
  "shadow-stats",
  "show",
  "scene-stats",
  "learn",
  "scene-log",
];

/**
 * 从用户消息中解析 /praxis 命令。
 * 返回命令类型或 null。
 */
export function parsePraxisCommand(message: string): PraxisCommand | null {
  const trimmed = message.trim();

  // /praxis learn <content> — extract just the command, not the content
  const learnMatch = trimmed.match(/^\/praxis\s+learn\b/i);
  if (learnMatch) return "learn";

  const match = trimmed.match(/^\/praxis\s+([\w-]+)/i);
  if (!match) return null;

  const sub = match[1].toLowerCase();
  if (ALL_COMMANDS.includes(sub)) {
    return sub as PraxisCommand;
  }
  return null;
}

/**
 * 处理 /praxis 命令，返回格式化的输出文本。
 */
export async function handlePraxisCommand(
  cmd: PraxisCommand,
  deps: M0Deps,
): Promise<string> {
  switch (cmd) {
    case "audit":
      return handleAudit(deps);
    case "ontology":
      return handleOntology(deps);
    case "status":
      return handleStatus(deps);
    case "task":
      return "⚠️ /praxis task 尚未实现 (计划 M6)";
    case "show":
      return handleShow(deps);
    case "shadow-stats":
      return handleShadowStats(deps);
    case "scene-stats":
      return handleSceneStats(deps);
    case "learn":
      return handleLearn(deps);
    case "scene-log":
      return handleSceneLog(deps);
    default:
      return `未知命令: /praxis ${cmd}`;
  }
}

async function handleOntology(deps: M0Deps): Promise<string> {
  try {
    const report = await generateOntologyReport(deps);
    return formatOntologyReport(report);
  } catch (e) {
    return `❌ 本体论报告生成失败: ${String(e)}`;
  }
}

async function handleStatus(deps: M0Deps): Promise<string> {
  try {
    const report = await generateStatusReport(deps);
    return formatStatusReport(report);
  } catch (e) {
    return `❌ 状态报告生成失败: ${String(e)}`;
  }
}

async function handleAudit(deps: M0Deps): Promise<string> {
  try {
    const report = await generateAuditReport(deps);
    return formatAuditReport(report);
  } catch (e) {
    return `❌ 审计报告生成失败: ${String(e)}`;
  }
}

// ══════════════════════════════════════════════════════════════════
// Phase 1: Bridge command migration (from phase1a-bridge.ts)
// ══════════════════════════════════════════════════════════════════

async function handleShow(deps: M0Deps): Promise<string> {
  try {
    const result = await deps.memory.getSlot("praxis_learnings");
    const stored: Array<Record<string, unknown>> =
      result.ok && Array.isArray(result.value) ? result.value : [];

    const lines: string[] = [];
    lines.push("=== Praxis 学习状态 ===");
    lines.push(`累计学习: ${stored.length} 条`);

    const sessions = new Set(
      stored.map((s) => s.session).filter(Boolean),
    );
    lines.push(`涉及 session: ${sessions.size} 个`);

    const byType: Record<string, number> = {};
    for (const s of stored) {
      const t = String(s.type ?? "unknown");
      byType[t] = (byType[t] || 0) + 1;
    }
    lines.push(
      `按类型: ${Object.entries(byType)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ")}`,
    );

    lines.push("\n最近 5 条:");
    for (const s of stored.slice(-5)) {
      const content = String(s.content ?? "").slice(0, 80);
      lines.push(
        `  [S${s.session}] [${s.type}] [${s.source}] ${content}`,
      );
    }

    return lines.join("\n");
  } catch (e) {
    return `❌ 学习状态读取失败: ${String(e)}`;
  }
}

async function handleShadowStats(deps: M0Deps): Promise<string> {
  try {
    const result = await deps.memory.getSlot("audit_log");
    const entries: Array<Record<string, unknown>> =
      result.ok && Array.isArray(result.value) ? result.value : [];

    // Filter shadow decision entries (governor decisions)
    const shadowDecisions = entries.filter(
      (e) => e.type === "governor_decision" || e.action,
    );

    const lines: string[] = [];
    lines.push("=== Governor 影子决策统计 ===");
    lines.push(`总审计日志: ${entries.length} 条`);
    lines.push(`影子决策:   ${shadowDecisions.length} 条`);

    if (shadowDecisions.length === 0) {
      lines.push("");
      lines.push(
        '发送包含纠正关键词（"不对"/"错了"/"不是"等）的消息以产生影子决策。',
      );
      return lines.join("\n");
    }

    const sessions = new Set(
      shadowDecisions.map((d) => d.sessionId).filter(Boolean),
    );
    lines.push(`Session 数:  ${sessions.size}`);

    const byAction: Record<string, number> = {};
    const bySignal: Record<string, number> = {};
    for (const d of shadowDecisions) {
      const a = String(d.action ?? "unknown");
      byAction[a] = (byAction[a] || 0) + 1;
      const s = String(d.signalType ?? d.type ?? "unknown");
      bySignal[s] = (bySignal[s] || 0) + 1;
    }

    lines.push("");
    lines.push("--- 决策分布 (action) ---");
    for (const [action, count] of Object.entries(byAction)) {
      lines.push(`  ${action}: ${count}`);
    }
    lines.push("");
    lines.push("--- 信号类型分布 ---");
    for (const [signal, count] of Object.entries(bySignal)) {
      lines.push(`  ${signal}: ${count}`);
    }

    return lines.join("\n");
  } catch (e) {
    return `❌ 影子统计读取失败: ${String(e)}`;
  }
}

async function handleSceneStats(deps: M0Deps): Promise<string> {
  try {
    const result = await deps.memory.getSlot("scene_classifications");
    const records: Array<Record<string, unknown>> =
      result.ok && Array.isArray(result.value) ? result.value : [];

    const lines: string[] = [];
    lines.push(`=== 场景分类统计 (${records.length} 条记录) ===`);
    lines.push("");

    if (records.length === 0) {
      lines.push("暂无分类数据。");
      lines.push("场景分类由 message hook 和 end hook 自动记录。");
      return lines.join("\n");
    }

    const byScenario: Record<string, number> = {};
    const sessions = new Set<string>();
    let noMatchCount = 0;

    for (const r of records) {
      const sid = String(r.sessionId ?? "");
      if (sid) sessions.add(sid);
      const scenario = r.primaryScenarioId as string | undefined;
      if (scenario) {
        byScenario[scenario] = (byScenario[scenario] || 0) + 1;
      } else {
        noMatchCount++;
      }
    }

    lines.push(`Session 数: ${sessions.size}`);
    lines.push(`无匹配:    ${noMatchCount}`);
    lines.push("");
    lines.push("--- 场景分布 ---");
    for (const [scenario, count] of Object.entries(byScenario).sort(
      ([, a], [, b]) => b - a,
    )) {
      lines.push(`  ${scenario}: ${count}`);
    }

    return lines.join("\n");
  } catch (e) {
    return `❌ 场景统计读取失败: ${String(e)}`;
  }
}

function handleLearn(_deps: M0Deps): string {
  return (
    "📝 /praxis learn <内容> — 手动保存学习\n" +
    "用法: 在消息中附带学习内容，例如:\n" +
    '  /praxis learn 用户在门诊场景中倾向于先挂号再分诊'
  );
}

function handleSceneLog(_deps: M0Deps): string {
  return (
    "🔍 /praxis scene-log — 场景识别\n" +
    "用法: 在消息中包含要识别的文本:\n" +
    "  /praxis scene-log 我想优化门诊流程\n" +
    "\n" +
    "场景识别会分析文本并匹配已知场景。"
  );
}
