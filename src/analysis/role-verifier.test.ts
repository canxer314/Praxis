/**
 * role-verifier.test.ts — T14: ProtoRole 行为验证测试
 *
 * 覆盖:
 *   - 非 role 类型 → neutral (confidence=0)
 *   - 自依赖检测
 *   - DAG 循环检测
 *   - 行为匹配 (behaviors vs toolCallTrace)
 *   - 无行为数据 → insufficient
 */

import { describe, it, expect } from "vitest";
import { RoleVerifier, detectDagCycles } from "./role-verifier";
import type { ProtoStructure, ProtoRole, ToolCallRecord, VerificationContext } from "../cognitive/types";

function makeRole(overrides: Partial<ProtoRole> = {}): ProtoRole {
  return {
    id: "role-1",
    protoType: "role",
    tentativeName: "测试角色",
    scenarioId: "general",
    confidence: 0.7,
    observationsCount: 5,
    adoptionRate: 0.5,
    lifecycle: "experimental",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    roleType: "executor",
    behaviors: ["read_file", "write_file", "search_code"],
    dependsOn: [],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<VerificationContext> = {}): VerificationContext {
  return {
    sessionId: "test-session",
    toolCallTrace: [],
    transcript: "",
    ...overrides,
  };
}

describe("RoleVerifier", () => {
  const verifier = new RoleVerifier();

  it("verifier name and weight are correct", () => {
    expect(verifier.name).toBe("role_verifier");
    expect(verifier.weight).toBe(0.12);
  });

  it("非 role 类型 → neutral (confidence=0)", async () => {
    const structure: ProtoStructure = {
      id: "seq-1",
      protoType: "sequence",
      tentativeName: "一个序列",
      scenarioId: "general",
      confidence: 0.7,
      observationsCount: 5,
      adoptionRate: 0.5,
      lifecycle: "experimental",
      relations: [],
      versionChain: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const result = await verifier.verify(structure, makeCtx());
    expect(result.confidence).toBe(0);
    expect(result.evidence).toContain("RoleVerifier only supports ProtoRole");
  });

  it("自依赖检测 → value 低于正常", async () => {
    const role = makeRole({ id: "self-dep", dependsOn: ["self-dep"] });
    const result = await verifier.verify(role, makeCtx());
    // Self-dependency pushes a 0 into checks, lowering the average
    expect(result.value).toBeLessThanOrEqual(0.5);
    // When checks.length <= 1, evidence is "Only self-dependency check — insufficient"
    expect(result.evidence).toContain("self-dependency");
  });

  it("行为匹配 — 全部匹配 → 高 value", async () => {
    const role = makeRole({ behaviors: ["read_file", "write_file"] });
    const ctx = makeCtx({
      toolCallTrace: [
        { toolName: "read_file", toolParams: {}, timestamp: 1, success: true },
        { toolName: "write_file", toolParams: {}, timestamp: 2, success: true },
      ],
    });
    const result = await verifier.verify(role, ctx);
    expect(result.value).toBeGreaterThan(0.5);
    expect(result.evidence).toContain("Behavior match");
  });

  it("行为匹配 — 部分匹配", async () => {
    const role = makeRole({ behaviors: ["read_file", "delete_file", "search_code"] });
    const ctx = makeCtx({
      toolCallTrace: [
        { toolName: "read_file", toolParams: {}, timestamp: 1, success: true },
      ],
    });
    const result = await verifier.verify(role, ctx);
    expect(result.value).toBeLessThan(1.0);
    expect(result.evidence).toContain("Behavior match");
  });

  it("无 toolCallTrace → 仅自依赖检测 (低 confidence)", async () => {
    const role = makeRole({ dependsOn: [] });
    const result = await verifier.verify(role, makeCtx({ toolCallTrace: [] }));
    expect(result.confidence).toBeLessThanOrEqual(0.2);
    expect(result.evidence).toContain("insufficient");
  });

  it("模糊匹配 — 单词边界 (partial match ok)", async () => {
    const role = makeRole({ behaviors: ["file operations"] });
    const ctx = makeCtx({
      toolCallTrace: [
        { toolName: "read_file", toolParams: {}, timestamp: 1, success: true },
      ],
    });
    const result = await verifier.verify(role, ctx);
    expect(result.evidence).toContain("Behavior match");
    expect(result.value).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// detectDagCycles
// ══════════════════════════════════════════════════════════════════

describe("detectDagCycles", () => {
  it("无循环 DAG → null", () => {
    const roles = new Map<string, ProtoRole>();
    roles.set("a", makeRole({ id: "a", dependsOn: ["b"] }));
    roles.set("b", makeRole({ id: "b", dependsOn: ["c"] }));
    roles.set("c", makeRole({ id: "c", dependsOn: [] }));
    expect(detectDagCycles(roles)).toBeNull();
  });

  it("简单循环 → 检测到路径", () => {
    const roles = new Map<string, ProtoRole>();
    roles.set("a", makeRole({ id: "a", dependsOn: ["b"] }));
    roles.set("b", makeRole({ id: "b", dependsOn: ["a"] }));
    const cycle = detectDagCycles(roles);
    expect(cycle).not.toBeNull();
    expect(cycle!).toContain("a");
    expect(cycle!).toContain("b");
  });

  it("间接循环 → 检测到路径", () => {
    const roles = new Map<string, ProtoRole>();
    roles.set("a", makeRole({ id: "a", dependsOn: ["b"] }));
    roles.set("b", makeRole({ id: "b", dependsOn: ["c"] }));
    roles.set("c", makeRole({ id: "c", dependsOn: ["a"] }));
    const cycle = detectDagCycles(roles);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(3);
  });

  it("空 Map → null", () => {
    expect(detectDagCycles(new Map())).toBeNull();
  });

  it("单个节点无依赖 → null", () => {
    const roles = new Map<string, ProtoRole>();
    roles.set("solo", makeRole({ id: "solo", dependsOn: [] }));
    expect(detectDagCycles(roles)).toBeNull();
  });
});
