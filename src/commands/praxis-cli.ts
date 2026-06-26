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

export type PraxisCommand = "ontology" | "audit" | "status" | "task";

/**
 * 从用户消息中解析 /praxis 命令。
 * 返回命令类型或 null。
 */
export function parsePraxisCommand(message: string): PraxisCommand | null {
  const match = message.trim().match(/^\/praxis\s+(\w+)/i);
  if (!match) return null;

  const sub = match[1].toLowerCase() as PraxisCommand;
  if (["ontology", "audit", "status", "task"].includes(sub)) {
    return sub;
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
      return "⚠️ /praxis ontology 尚未实现 (计划 M3.5)";
    case "status":
      return "⚠️ /praxis status 尚未实现 (计划 M6.4)";
    case "task":
      return "⚠️ /praxis task 尚未实现 (计划 M6)";
    default:
      return `未知命令: /praxis ${cmd}`;
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
