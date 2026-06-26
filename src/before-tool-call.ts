/**
 * BeforeToolCallHandler — M0 + M3
 *
 * 职责:
 *   - 基于 autonomy_policy 判断当前操作是否需要用户确认
 *   - M3: 基于已结晶 ProtoConstraint 进行约束验证
 *   - 返回 proceed / inform / confirm / block
 *
 * 纯规则匹配，< 1ms（M3 约束验证为纯内存 Map + substring）。
 */

import type { Result } from "./platform-adapter";
import type { M0Deps } from "./m0-deps";
import { assessRiskLevel, DEFAULT_AUTONOMY_POLICY } from "./m0-deps";
import type { AutonomyPolicy, ProtoConstraint } from "./cognitive/types";
import { checkConstraints } from "./constraint-validator";

// ---- BeforeToolCallHandler ----

export class BeforeToolCallHandler {
  private policy: AutonomyPolicy;
  /** M3: 活跃已结晶约束列表（在 session_start 时由 orchestrator 注入） */
  private activeConstraints: ProtoConstraint[] = [];

  constructor(private readonly deps: M0Deps) {
    this.policy = deps.autonomyPolicy ?? DEFAULT_AUTONOMY_POLICY;
  }

  /** M3: 加载活跃约束（orchestrator 在 session_start 后调用） */
  loadConstraints(constraints: ProtoConstraint[]): void {
    this.activeConstraints = [...constraints]; // 防御性拷贝
  }

  /**
   * 处理 before_tool_call 事件。返回自主性决策 + M3 约束验证的合并结果。
   * 合并优先级: constraint block ≥ autonomy block > constraint confirm
   *   ≥ autonomy confirm > autonomy inform > autonomy proceed > constraint warn
   */
  async handle(toolName: string): Promise<
    Result<{ action: "proceed" | "inform" | "confirm" | "block"; reason: string }>
  > {
    // 1. M0 自主性决策
    const autonomyResult = this.getAutonomyDecision(toolName);

    // 2. M3 约束验证
    const constraintResult = checkConstraints(toolName, this.activeConstraints);

    // 3. 合并: 取最严格结果
    return this.mergeResults(autonomyResult, constraintResult);
  }

  /** M0: 自主性决策逻辑 */
  private getAutonomyDecision(toolName: string): {
    action: "proceed" | "inform" | "confirm" | "block";
    reason: string;
  } {
    const riskLevel = assessRiskLevel(toolName, this.policy);
    const { defaultPolicy } = this.policy;

    // 尝试从操作策略中查找特定规则
    const specificRule = this.policy.operationPolicies.find(
      (op) => toolName.toLowerCase().includes(op.operation.toLowerCase()),
    );

    if (specificRule) {
      if (specificRule.autonomy === "fully_autonomous") {
        return { action: "inform", reason: `操作 "${toolName}" 已授权全自主` };
      }
      if (specificRule.autonomy === "semi_autonomous") {
        return { action: "confirm", reason: `操作 "${toolName}" 需确认（半自主）` };
      }
    }

    switch (riskLevel) {
      case "low":
        return {
          action: defaultPolicy.lowRiskKnown === "inform" ? "inform" : "proceed",
          reason: "低风险操作",
        };
      case "medium":
        return { action: "inform", reason: "中等风险操作，执行后告知用户" };
      case "high":
        return { action: "confirm", reason: "高风险操作，需用户确认" };
      case "critical":
        return { action: "block", reason: "关键操作，禁止自主执行" };
    }
  }

  /** M3: 合并自主性决策和约束验证结果 */
  private mergeResults(
    autonomy: { action: "proceed" | "inform" | "confirm" | "block"; reason: string },
    constraint: { violated: boolean; constraintId?: string; severity?: string },
  ): Result<{ action: "proceed" | "inform" | "confirm" | "block"; reason: string }> {
    if (!constraint.violated || !constraint.severity) {
      return { ok: true, value: autonomy };
    }

    // 合并优先级表: constraint severity > autonomy action
    const ACTION_RANK: Record<string, number> = {
      block: 4,
      confirm: 3,
      inform: 2,
      proceed: 1,
    };

    const autonomyRank = ACTION_RANK[autonomy.action] ?? 0;

    // Warn 不改变 autonomy 决策
    if (constraint.severity === "warn") {
      return { ok: true, value: autonomy };
    }

    // block/confirm: severity 必须在有效范围内
    if (constraint.severity !== "block" && constraint.severity !== "confirm") {
      return { ok: true, value: autonomy }; // 未知 severity → 不干预
    }
    const constraintRank = ACTION_RANK[constraint.severity] ?? 0;

    if (constraintRank >= autonomyRank) {
      return {
        ok: true,
        value: {
          action: constraint.severity, // validated to be "block" | "confirm" above
          reason: `约束 "${constraint.constraintId}" 拦截: ${autonomy.reason}`,
        },
      };
    }

    // constraint severity ≤ autonomy → autonomy wins
    return { ok: true, value: autonomy };
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
