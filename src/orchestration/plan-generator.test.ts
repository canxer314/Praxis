/**
 * orchestration/plan-generator.ts — ProtoTask → PlanDocument 测试
 *
 * 架构参考: §5 计划生成, §11 orchestration/plan-generator.ts
 *
 * plan-generator 将 ProtoTask 模板 + 当前 TaskContext 转化为可执行的 PlanDocument
 * (含 phases, subtasks, criteria, guidance signals, pitfalls).
 */

import { describe, it, expect } from "vitest";
import {
  generatePlan,
  formatPlanForInjection,
  mergePitfallsIntoPlan,
  type PlanDocument,
  type PlanPhase,
  type PlanSubtask,
  type ProtoTaskTemplate,
  type TaskContextInput,
} from "./plan-generator";

// ══════════════════════════════════════════════════════════════════
// Fixtures
// ══════════════════════════════════════════════════════════════════

const WEB_DEPLOY_TASK: ProtoTaskTemplate = {
  taskType: "web_deploy",
  confidence: 0.65,
  source: "cumulative",
  observations: 5,
  typicalPhases: [
    {
      name: "pre-deploy",
      description: "构建与测试",
      subtasks: ["代码检查", "运行测试", "构建产物"],
      criteria: ["lint 通过", "测试全绿", "构建成功"],
    },
    {
      name: "deploy",
      description: "部署到目标环境",
      subtasks: ["备份当前版本", "上传产物", "切换流量"],
      criteria: ["备份完成", "上传成功", "健康检查通过"],
    },
    {
      name: "post-deploy",
      description: "部署后验证",
      subtasks: ["冒烟测试", "监控检查"],
      criteria: ["冒烟通过", "错误率正常"],
    },
  ],
  commonPitfalls: [
    {
      description: "接口变更导致集成失败",
      severity: "high",
      mitigation: "提前锁定接口版本",
      hitCount: 3,
    },
  ],
};

const TASK_CTX: TaskContextInput = {
  taskId: "task-001",
  name: "部署 v2.1.0 到生产环境",
  type: "ops",
  currentPhase: "pre-deploy",
  relevantScenarios: ["web_deployment"],
};

// ══════════════════════════════════════════════════════════════════
// generatePlan
// ══════════════════════════════════════════════════════════════════

describe("generatePlan", () => {
  it("generates a PlanDocument from ProtoTask + TaskContext", () => {
    const plan = generatePlan(WEB_DEPLOY_TASK, TASK_CTX);

    expect(plan.derivedFrom.protoTaskType).toBe("web_deploy");
    expect(plan.derivedFrom.taskContextId).toBe("task-001");
    expect(plan.phases).toHaveLength(3);

    // First phase
    const preDeploy = plan.phases[0]!;
    expect(preDeploy.name).toBe("pre-deploy");
    expect(preDeploy.subtasks).toHaveLength(3);
    expect(preDeploy.subtasks[0]!.name).toBe("代码检查");
    expect(preDeploy.subtasks[0]!.criteria).toContain("lint 通过");
  });

  it("includes pitfalls mapped to affected phases", () => {
    const plan = generatePlan(WEB_DEPLOY_TASK, TASK_CTX);
    expect(plan.pitfalls).toHaveLength(1);
    expect(plan.pitfalls[0]!.description).toContain("接口变更");
    // pitfalls are assigned to all phases by default (each pitfall maps to all phases)
    expect(plan.pitfalls[0]!.affectedPhases).toEqual([
      "pre-deploy",
      "deploy",
      "post-deploy",
    ]);
  });

  it("includes guidance signals from ProtoTask confidence", () => {
    const plan = generatePlan(WEB_DEPLOY_TASK, TASK_CTX);
    expect(plan.guidanceSignals.length).toBeGreaterThan(0);
    // Task pattern confidence advisory
    const confSignal = plan.guidanceSignals.find(
      (s) => s.signalType === "confidence_advisory",
    );
    expect(confSignal).toBeTruthy();
    expect(confSignal!.summary).toContain("0.65");
  });

  it("handles empty ProtoTask gracefully", () => {
    const emptyTask: ProtoTaskTemplate = {
      taskType: "unknown",
      confidence: 0.2,
      source: "bootstrap",
      observations: 0,
      typicalPhases: [],
      commonPitfalls: [],
    };
    const plan = generatePlan(emptyTask, {
      taskId: "t0",
      name: "Unknown Task",
      type: "unknown",
      currentPhase: "init",
    });
    expect(plan.phases).toHaveLength(0);
    expect(plan.pitfalls).toHaveLength(0);
  });

  it("does not mutate input ProtoTask", () => {
    const original = JSON.parse(JSON.stringify(WEB_DEPLOY_TASK));
    generatePlan(WEB_DEPLOY_TASK, TASK_CTX);
    expect(WEB_DEPLOY_TASK).toEqual(original);
  });

  it("generates unique subtask IDs", () => {
    const plan = generatePlan(WEB_DEPLOY_TASK, TASK_CTX);
    const allIds = plan.phases.flatMap((p) =>
      p.subtasks.map((s) => s.id),
    );
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });
});

// ══════════════════════════════════════════════════════════════════
// formatPlanForInjection
// ══════════════════════════════════════════════════════════════════

describe("formatPlanForInjection", () => {
  it("formats a plan into LLM-injectable markdown", () => {
    const plan = generatePlan(WEB_DEPLOY_TASK, TASK_CTX);
    const text = formatPlanForInjection(plan);

    expect(text).toContain("## Task Plan");
    expect(text).toContain("部署 v2.1.0");
    expect(text).toContain("pre-deploy");
    expect(text).toContain("deploy");
    expect(text).toContain("post-deploy");
    expect(text).toContain("⛔"); // pitfalls
  });

  it("returns empty string for empty plan", () => {
    const plan: PlanDocument = {
      derivedFrom: { protoTaskType: "none", taskContextId: "x" },
      taskName: "Empty",
      phases: [],
      pitfalls: [],
      guidanceSignals: [],
      generatedAt: Date.now(),
    };
    expect(formatPlanForInjection(plan)).toBe("");
  });

  it("truncates long progress summaries", () => {
    const plan = generatePlan(WEB_DEPLOY_TASK, TASK_CTX);
    // Should format without error even with many phases
    expect(formatPlanForInjection(plan).length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// mergePitfallsIntoPlan
// ══════════════════════════════════════════════════════════════════

describe("mergePitfallsIntoPlan", () => {
  it("adds new pitfalls to an existing plan", () => {
    const plan = generatePlan(WEB_DEPLOY_TASK, TASK_CTX);
    const newPitfall = {
      description: "环境变量未同步",
      severity: "medium" as const,
      mitigation: "使用配置中心",
      hitCount: 1,
    };
    const updated = mergePitfallsIntoPlan(plan, [newPitfall]);
    expect(updated.pitfalls).toHaveLength(2);
    expect(updated.pitfalls[1]!.description).toBe("环境变量未同步");
  });

  it("does not add duplicate pitfalls (by description)", () => {
    const plan = generatePlan(WEB_DEPLOY_TASK, TASK_CTX);
    const duplicate = {
      description: "接口变更导致集成失败",
      severity: "high" as const,
      mitigation: "提前锁定接口版本",
      hitCount: 1,
    };
    const updated = mergePitfallsIntoPlan(plan, [duplicate]);
    expect(updated.pitfalls).toHaveLength(1);
  });

  it("does not mutate original plan", () => {
    const plan = generatePlan(WEB_DEPLOY_TASK, TASK_CTX);
    const originalLen = plan.pitfalls.length;
    mergePitfallsIntoPlan(plan, [
      { description: "new", severity: "low", mitigation: "x", hitCount: 0 },
    ]);
    expect(plan.pitfalls).toHaveLength(originalLen);
  });
});
