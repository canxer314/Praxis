/**
 * constraint-validator 测试 — M3 Step 3
 *
 * 覆盖:
 *   - checkConstraints: 无约束/无匹配 → { violated: false }
 *   - 精确/部分/大小写不敏感 substring 匹配
 *   - 多 pattern/多 constraint → 取最大 severity
 *   - 空 toolName → 无匹配
 *   - 每个约束只取第一个命中 pattern
 */

import { describe, it, expect } from "vitest";
import { checkConstraints } from "./constraint-validator";
import type { ProtoConstraint } from "../cognitive/types";

function makeConstraint(overrides: Partial<ProtoConstraint> = {}): ProtoConstraint {
  return {
    id: "c1",
    protoType: "constraint",
    tentativeName: "测试约束",
    scenarioId: "general",
    confidence: 0.85,
    observationsCount: 7,
    adoptionRate: 0.5,
    lifecycle: "crystallized",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    severity: "block",
    source: "user_taught",
    rulePatterns: ["migrate", "backup"],
    ...overrides,
  };
}

describe("checkConstraints", () => {
  it("空约束列表 → { violated: false }", () => {
    expect(checkConstraints("migrate", [])).toEqual({ violated: false });
  });

  it("空 toolName → { violated: false }", () => {
    const c = makeConstraint();
    expect(checkConstraints("", [c])).toEqual({ violated: false });
  });

  it("无匹配 → { violated: false }", () => {
    const c = makeConstraint({ rulePatterns: ["migrate"] });
    expect(checkConstraints("deploy", [c])).toEqual({ violated: false });
  });

  it("精确 substring 匹配", () => {
    const c = makeConstraint({ rulePatterns: ["migrate"] });
    const result = checkConstraints("mcp__db__migrate", [c]);
    expect(result.violated).toBe(true);
    expect(result.constraintId).toBe("c1");
    expect(result.severity).toBe("block");
    expect(result.matchedPattern).toBe("migrate");
  });

  it("部分 substring 匹配", () => {
    const c = makeConstraint({ rulePatterns: ["backup"] });
    const result = checkConstraints("db_backup", [c]);
    expect(result.violated).toBe(true);
  });

  it("大小写不敏感匹配", () => {
    const c = makeConstraint({ rulePatterns: ["Migrate"] });
    const result = checkConstraints("MCP__MIGRATE", [c]);
    expect(result.violated).toBe(true);
    expect(result.matchedPattern).toBe("Migrate");
  });

  it("多 pattern — 第一个命中即返回该 pattern", () => {
    const c = makeConstraint({ rulePatterns: ["migrate", "deploy"] });
    // "deploy_prod" includes "deploy" — the second pattern, but since
    // patterns are checked in order and deploy matches, it's the first hit
    const result = checkConstraints("deploy_prod", [c]);
    expect(result.violated).toBe(true);
    // "deploy_prod".includes("migrate") = false, so first hit is "deploy"
    expect(result.matchedPattern).toBe("deploy");
  });

  it("多约束 — 取最大 severity (block > confirm > warn)", () => {
    const warnC = makeConstraint({ id: "w1", severity: "warn", rulePatterns: ["delete"] });
    const confirmC = makeConstraint({ id: "c1", severity: "confirm", rulePatterns: ["delete"] });
    const blockC = makeConstraint({ id: "b1", severity: "block", rulePatterns: ["delete"] });
    // Put them in wrong order to verify max-severity wins
    const result = checkConstraints("delete_user", [warnC, confirmC, blockC]);
    expect(result.violated).toBe(true);
    expect(result.severity).toBe("block");
    expect(result.constraintId).toBe("b1");
  });

  it("warn + confirm → confirm wins", () => {
    const warnC = makeConstraint({ id: "w1", severity: "warn", rulePatterns: ["rm"] });
    const confirmC = makeConstraint({ id: "c1", severity: "confirm", rulePatterns: ["rm"] });
    const result = checkConstraints("rm_file", [warnC, confirmC]);
    expect(result.severity).toBe("confirm");
  });

  it("每个约束只取第一个命中 pattern", () => {
    const c = makeConstraint({
      rulePatterns: ["migrate", "backup"],
    });
    // "migrate_backup" includes both "migrate" and "backup"
    // but should only record the first match for this constraint
    const result = checkConstraints("migrate_backup", [c]);
    expect(result.violated).toBe(true);
    expect(result.matchedPattern).toBe("migrate"); // first pattern matched
  });

  it("仅 block severity — 返回 block", () => {
    const c = makeConstraint({ severity: "block", rulePatterns: ["destroy"] });
    const result = checkConstraints("destroy_all", [c]);
    expect(result.severity).toBe("block");
  });

  it("仅 warn severity — 返回 warn", () => {
    const c = makeConstraint({ severity: "warn", rulePatterns: ["clean"] });
    const result = checkConstraints("clean_temp", [c]);
    expect(result.severity).toBe("warn");
  });
});
