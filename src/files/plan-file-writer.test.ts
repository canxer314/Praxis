/**
 * files/plan-file-writer.ts — task_plan.md / progress.md / findings.md 测试
 */

import { describe, it, expect } from "vitest";
import {
  formatTaskPlanMarkdown,
  formatProgressMarkdown,
  formatFindingsMarkdown,
  type PlanDocumentInput,
  type ProgressSummaryInput,
  type FindingInput,
} from "./plan-file-writer";

describe("formatTaskPlanMarkdown", () => {
  it("formats a plan into task_plan.md content", () => {
    const plan: PlanDocumentInput = {
      taskName: "部署 v2.1.0",
      phases: [
        { name: "pre-deploy", subtasks: [{ name: "代码检查", criteria: ["lint通过"] }] },
        { name: "deploy", subtasks: [{ name: "上传产物", criteria: ["上传成功"] }] },
      ],
      pitfalls: [{ description: "接口变更", severity: "high", mitigation: "锁定版本", affectedPhases: ["deploy"] }],
    };
    const md = formatTaskPlanMarkdown(plan);
    expect(md).toContain("# Task Plan: 部署 v2.1.0");
    expect(md).toContain("pre-deploy");
    expect(md).toContain("deploy");
    expect(md).toContain("接口变更");
    expect(md).toContain("## Pitfalls");
  });

  it("returns minimal output for empty plan", () => {
    const md = formatTaskPlanMarkdown({ taskName: "Empty", phases: [], pitfalls: [] });
    expect(md).toContain("# Task Plan");
  });
});

describe("formatProgressMarkdown", () => {
  it("formats progress into progress.md content", () => {
    const progress: ProgressSummaryInput = {
      taskName: "部署 v2.1.0",
      currentPhase: "deploy",
      completedSubtasks: ["代码检查", "运行测试"],
      errors: 1,
      lastUpdated: Date.now(),
    };
    const md = formatProgressMarkdown(progress);
    expect(md).toContain("# Progress: 部署 v2.1.0");
    expect(md).toContain("deploy");
    expect(md).toContain("代码检查");
    expect(md).toContain("运行测试");
  });
});

describe("formatFindingsMarkdown", () => {
  it("formats findings into findings.md content", () => {
    const findings: FindingInput[] = [
      { type: "issue", description: "健康检查超时", severity: "high" },
      { type: "insight", description: "接口版本锁定有效", severity: "info" },
      { type: "decision", description: "使用蓝绿部署", severity: "info" },
    ];
    const md = formatFindingsMarkdown(findings);
    expect(md).toContain("# Findings");
    expect(md).toContain("健康检查超时");
    expect(md).toContain("接口版本锁定有效");
    expect(md).toContain("蓝绿部署");
  });

  it("returns empty string for empty findings", () => {
    expect(formatFindingsMarkdown([])).toBe("");
  });
});
