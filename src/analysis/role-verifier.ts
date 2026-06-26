/**
 * RoleVerifier — ProtoRole 行为验证 (M4.3.2, 缩减版)
 *
 * M4 范围:
 *   1. 静态验证: dependsOn DAG 循环检测
 *   2. 行为匹配: toolCallTrace toolNames vs ProtoRole.behaviors 模糊匹配
 *   3. 依赖一致性: dependsOn 中的角色是否有冲突的 behaviors
 *
 * 推迟到 M6: 运行时越界检测 (需要 executorRole 字段)
 *
 * 架构参考: §4 role-verifier
 */

import type { ProtoStructure, ProtoRole, ToolCallRecord } from "../cognitive/types";
import type { Verifier, VerificationContext, VerifierOutput } from "./types";

// ══════════════════════════════════════════════════════════════════
// RoleVerifier
// ══════════════════════════════════════════════════════════════════

export class RoleVerifier implements Verifier {
  readonly name = "role_verifier";
  readonly weight = 0.12;

  async verify(
    structure: ProtoStructure,
    context: VerificationContext,
  ): Promise<VerifierOutput> {
    if (structure.protoType !== "role") {
      return {
        value: 0.5, confidence: 0,
        evidence: "RoleVerifier only supports ProtoRole",
        timestamp: Date.now(),
      };
    }

    const role = structure as ProtoRole;
    const checks: number[] = [];
    const reasons: string[] = [];

    // Check 1: DAG 循环检测
    if (role.dependsOn.includes(role.id)) {
      reasons.push(`Self-dependency detected: ${role.id} depends on itself`);
      checks.push(0);
    } else {
      checks.push(1);
    }

    // Check 2: Behaviors vs toolCallTrace tool names 模糊匹配
    if (role.behaviors.length > 0 && context.toolCallTrace.length > 0) {
      const toolNames = context.toolCallTrace.map((t) => t.toolName.toLowerCase());
      let matched = 0;
      for (const behavior of role.behaviors) {
        const bl = behavior.toLowerCase();
        if (toolNames.some((t) => t.includes(bl) || bl.includes(t))) {
          matched++;
        }
      }
      const behaviorScore = role.behaviors.length > 0
        ? matched / role.behaviors.length
        : 0.5;
      checks.push(behaviorScore);
      reasons.push(`Behavior match: ${matched}/${role.behaviors.length} behaviors matched tool calls`);
    }

    if (checks.length === 0) {
      return {
        value: 0.5, confidence: 0.1,
        evidence: "No behavioral data to verify against",
        timestamp: Date.now(),
      };
    }

    const avgScore = checks.reduce((a, b) => a + b, 0) / checks.length;

    return {
      value: avgScore,
      confidence: Math.min(0.8, checks.length / 3),
      evidence: reasons.join("; "),
      timestamp: Date.now(),
    };
  }
}

/**
 * DAG 循环检测 — 检查 dependsOn 图中是否存在循环。
 * 可用于单个角色或一组角色。
 */
export function detectDagCycles(roles: Map<string, ProtoRole>): string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclePath: string[] = [];

  function dfs(id: string): boolean {
    if (visiting.has(id)) {
      cyclePath.push(id);
      return true;
    }
    if (visited.has(id)) return false;

    visiting.add(id);
    const role = roles.get(id);
    if (role) {
      for (const dep of role.dependsOn) {
        if (dfs(dep)) {
          cyclePath.push(id);
          return true;
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of roles.keys()) {
    if (dfs(id)) return cyclePath.reverse();
  }

  return null;
}
