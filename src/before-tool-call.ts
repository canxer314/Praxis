/**
 * BeforeToolCallHandler — M0
 *
 * 职责:
 *   - 基于 autonomy_policy 判断当前操作是否需要用户确认
 *   - 返回 proceed / inform / confirm / block
 *   - 不涉及 ProtoConstraint 验证（M3 实现）
 *
 * 纯规则匹配，< 10ms。
 */

import type { Result } from "./platform-adapter";
import type { M0Deps } from "./m0-deps";
import { assessRiskLevel, DEFAULT_AUTONOMY_POLICY } from "./m0-deps";
import type { AutonomyPolicy } from "./cognitive/types";

// ---- BeforeToolCallHandler ----

export class BeforeToolCallHandler {
  private policy: AutonomyPolicy;

  constructor(private readonly deps: M0Deps) {
    this.policy = deps.autonomyPolicy ?? DEFAULT_AUTONOMY_POLICY;
  }

  /**
   * 处理 before_tool_call 事件。返回自主性决策。
   */
  async handle(toolName: string): Promise<
    Result<{ action: "proceed" | "inform" | "confirm" | "block"; reason: string }>
  > {
    const riskLevel = assessRiskLevel(toolName, this.policy);
    const { defaultPolicy } = this.policy;

    // 尝试从操作策略中查找特定规则
    const specificRule = this.policy.operationPolicies.find(
      (op) => toolName.toLowerCase().includes(op.operation.toLowerCase()),
    );

    if (specificRule) {
      // 有特定规则: 根据 autonomy 级别决定
      if (specificRule.autonomy === "fully_autonomous") {
        return { ok: true, value: { action: "inform", reason: `操作 "${toolName}" 已授权全自主` } };
      }
      if (specificRule.autonomy === "semi_autonomous") {
        return { ok: true, value: { action: "confirm", reason: `操作 "${toolName}" 需确认（半自主）` } };
      }
      // supervised → 依赖风险判断
    }

    // 使用默认策略 + 风险级别
    switch (riskLevel) {
      case "low":
        return {
          ok: true,
          value: {
            action: defaultPolicy.lowRiskKnown === "inform" ? "inform" : "proceed",
            reason: "低风险操作",
          },
        };
      case "medium":
        return {
          ok: true,
          value: { action: "inform", reason: "中等风险操作，执行后告知用户" },
        };
      case "high":
        return {
          ok: true,
          value: { action: "confirm", reason: "高风险操作，需用户确认" },
        };
      case "critical":
        return {
          ok: true,
          value: { action: "block", reason: "关键操作，禁止自主执行" },
        };
      default:
        return {
          ok: true,
          value: { action: defaultPolicy.unknownOperation as "proceed" | "inform" | "confirm" | "block", reason: "未知操作，使用默认策略" },
        };
    }
  }

  /** 重新加载 autonomy_policy（AgentMemory 恢复时调用） */
  async reloadPolicy(): Promise<void> {
    if (this.deps.autonomyPolicy) {
      this.policy = this.deps.autonomyPolicy;
      return;
    }
    const result = await this.deps.memory.getSlot("autonomy_policy");
    if (result.ok && result.value) {
      this.policy = result.value as AutonomyPolicy;
    }
  }
}
