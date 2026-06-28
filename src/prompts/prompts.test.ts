/**
 * prompts/ — Prompt 模板完整性测试
 *
 * 验证所有 13 个 prompt .md 文件存在、可加载、包含必要结构。
 * 架构参考: §11 prompts/
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PROMPT_DIR = resolve(__dirname);

const PROMPT_FILES = [
  // system/ (5 files)
  "system/memory-context.md",
  "system/plan-injection.md",
  "system/constraint-injection.md",
  "system/prediction-markers.md",
  "system/critical-mode.md",
  // analysis/ (6 files)
  "analysis/extract-and-update.md",
  "analysis/construct-proto-task.md",
  "analysis/generate-plan.md",
  "analysis/verify-progress.md",
  "analysis/consistency-scan.md",
  "analysis/audit-architecture.md",
  // user/ (2 files)
  "user/perception-summary.md",
  "user/crystallization-proposal.md",
];

function loadPrompt(relPath: string): string {
  return readFileSync(resolve(PROMPT_DIR, relPath), "utf-8");
}

// ══════════════════════════════════════════════════════════════════
// 文件存在性
// ══════════════════════════════════════════════════════════════════

describe("Prompt file existence", () => {
  for (const path of PROMPT_FILES) {
    it(`exists: ${path}`, () => {
      const content = loadPrompt(path);
      expect(content).toBeTruthy();
      expect(content.length).toBeGreaterThan(50);
    });
  }
});

// ══════════════════════════════════════════════════════════════════
// 结构验证
// ══════════════════════════════════════════════════════════════════

describe("System prompts", () => {
  it("memory-context.md has expected structure", () => {
    const content = loadPrompt("system/memory-context.md");
    expect(content).toContain("Praxis");
    expect(content).toContain("##");
  });

  it("plan-injection.md covers task plan + guidance", () => {
    const content = loadPrompt("system/plan-injection.md");
    expect(content).toContain("##");
  });

  it("constraint-injection.md covers CRITICAL CONSTRAINTS", () => {
    const content = loadPrompt("system/constraint-injection.md");
    expect(content).toContain("CRITICAL CONSTRAINTS");
  });

  it("prediction-markers.md covers prediction protocol", () => {
    const content = loadPrompt("system/prediction-markers.md");
    expect(content).toContain("PREDICTION");
  });

  it("critical-mode.md covers minimal format", () => {
    const content = loadPrompt("system/critical-mode.md");
    expect(content).toContain("Critical");
  });
});

describe("Analysis prompts", () => {
  it("extract-and-update.md covers transcript analysis", () => {
    const content = loadPrompt("analysis/extract-and-update.md");
    expect(content).toContain("transcript");
  });

  it("construct-proto-task.md covers task history", () => {
    const content = loadPrompt("analysis/construct-proto-task.md");
    expect(content).toContain("ProtoTask");
  });

  it("generate-plan.md covers plan generation", () => {
    const content = loadPrompt("analysis/generate-plan.md");
    expect(content).toContain("PlanDocument");
  });

  it("verify-progress.md covers progress inference", () => {
    const content = loadPrompt("analysis/verify-progress.md");
    expect(content).toContain("progress");
  });

  it("consistency-scan.md covers structure check", () => {
    const content = loadPrompt("analysis/consistency-scan.md");
    expect(content).toContain("consistency");
  });

  it("audit-architecture.md covers adversarial audit", () => {
    const content = loadPrompt("analysis/audit-architecture.md");
    expect(content).toContain("audit");
  });
});

describe("User prompts", () => {
  it("perception-summary.md covers session awareness", () => {
    const content = loadPrompt("user/perception-summary.md");
    expect(content).toContain("session");
  });

  it("crystallization-proposal.md covers approval", () => {
    const content = loadPrompt("user/crystallization-proposal.md");
    expect(content).toContain("crystalliz");
  });
});
