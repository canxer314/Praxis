/**
 * MessageReceivedHandler — M0 + M5.5 /praxis command routing
 *
 * 职责:
 *   - 检测用户纠正信号（"不对，应该是..."）
 *   - 将检测到的信号暂存到 session-scoped 数组
 *   - 纯规则匹配，< 10ms，不调 LLM
 *   - M5.5: /praxis 命令路由
 *
 * M4 将升级为 Governor 管道的完整语义意图分析。
 */

import type { M0Deps } from "../m0-deps";
import type { PendingSignal } from "../cognitive/types";
import { parsePraxisCommand, handlePraxisCommand } from "../commands/praxis-cli";

// ---- 纠正检测模式 ----

const CORRECTION_PATTERNS = [
  /不对[，,]\s*应该[是]?/,
  /不是[这那]样[的]?[，,]\s*应该/,
  /错了[，,]\s*正确[的是]?/,
  /改成?[，,\s]*不要/,
  /换[一成][个种]/,
  /no[,!\s].*should/i,
  /wrong[,!\s].*correct/i,
  /don'?t\s+do\s+that/i,
];

/**
 * 检测消息中是否包含纠正信号。
 */
export function detectCorrection(content: string): boolean {
  for (const pattern of CORRECTION_PATTERNS) {
    if (pattern.test(content)) return true;
  }
  return false;
}

// ---- MessageReceivedHandler ----

export class MessageReceivedHandler {
  constructor(
    private readonly deps: M0Deps,
    /** Session-scoped 暂存区 — 收集本 session 的所有学习信号 */
    private readonly pendingSignals: PendingSignal[] = [],
  ) {}

  /**
   * 处理 message_received 事件。
   * 如果检测到用户纠正，将信号追加到 pendingSignals。
   */
  async handle(
    sessionId: string,
    message: { role: "user" | "assistant"; content: string },
  ): Promise<string | void> {
    // 只分析用户消息
    if (message.role !== "user") return;

    // M5.5: /praxis 命令路由
    const cmd = parsePraxisCommand(message.content);
    if (cmd) {
      return handlePraxisCommand(cmd, this.deps);
    }

    // 检测纠正信号
    if (detectCorrection(message.content)) {
      this.pendingSignals.push({
        id: `sig-${sessionId}-${Date.now()}`,
        type: "correction",
        sessionId,
        timestamp: Date.now(),
        detail: message.content.slice(0, 500), // Truncate long messages
      });
    }

    this.deps.logger?.info("message_received processed", {
      sessionId,
      role: message.role,
      signalDetected: detectCorrection(message.content),
    });
  }
}
