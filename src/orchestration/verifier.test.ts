/**
 * orchestration/verifier.ts — 统一验证器测试
 *
 * 架构参考: §5 验收标准, §11 orchestration/verifier.ts
 *
 * 5 种验收标准:
 *   command_output — 运行命令并匹配输出模式
 *   file_existence — 检查文件是否已生成
 *   test_pass      — 运行测试框架并解析结构化结果
 *   llm            — LLM 审查代码/文档质量
 *   user_approval  — 部署/安全/财务类操作必须人类确认
 */

import { describe, it, expect } from "vitest";
import {
  createVerificationCriterion,
  evaluateCriterion,
  evaluateAllCriteria,
  formatVerificationBlock,
  ALLOWED_CHECK_COMMANDS,
  type VerificationCriterion,
  type CriterionType,
  type CriterionResult,
} from "./verifier";

// ══════════════════════════════════════════════════════════════════
// createVerificationCriterion
// ══════════════════════════════════════════════════════════════════

describe("createVerificationCriterion", () => {
  it("creates a command_output criterion", () => {
    const c = createVerificationCriterion("command_output", {
      command: "npm test",
      expectedOutput: "0 failures",
    });
    expect(c.type).toBe("command_output");
    expect(c.command).toBe("npm test");
    expect(c.expectedOutput).toBe("0 failures");
    expect(c.description).toBeTruthy();
  });

  it("creates a file_existence criterion", () => {
    const c = createVerificationCriterion("file_existence", {
      filePath: "dist/bundle.js",
    });
    expect(c.type).toBe("file_existence");
    expect(c.filePath).toBe("dist/bundle.js");
  });

  it("creates a test_pass criterion", () => {
    const c = createVerificationCriterion("test_pass", {
      command: "npx vitest run",
      minPassRate: 1.0,
    });
    expect(c.type).toBe("test_pass");
    expect(c.command).toBe("npx vitest run");
    expect(c.minPassRate).toBe(1.0);
  });

  it("creates an llm criterion", () => {
    const c = createVerificationCriterion("llm", {
      prompt: "Review this code for security issues",
    });
    expect(c.type).toBe("llm");
    expect(c.prompt).toBe("Review this code for security issues");
  });

  it("creates a user_approval criterion", () => {
    const c = createVerificationCriterion("user_approval", {
      question: "Deploy to production?",
    });
    expect(c.type).toBe("user_approval");
    expect(c.question).toBe("Deploy to production?");
  });

  it("provides default description for each type", () => {
    const types: CriterionType[] = [
      "command_output",
      "file_existence",
      "test_pass",
      "llm",
      "user_approval",
    ];
    for (const t of types) {
      const c = createVerificationCriterion(t, {});
      expect(c.description).toBeTruthy();
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// evaluateCriterion
// ══════════════════════════════════════════════════════════════════

describe("evaluateCriterion", () => {
  it("evaluates command_output: pass when output matches pattern", () => {
    const c: VerificationCriterion = {
      type: "command_output",
      command: "echo hello",
      expectedOutput: "hello",
    };
    const result = evaluateCriterion(c, (cmd) =>
      cmd === "echo hello" ? "hello world" : "",
    );
    expect(result.passed).toBe(true);
    expect(result.type).toBe("command_output");
    expect(result.detail).toContain("hello");
  });

  it("evaluates command_output: fail when output does not match", () => {
    const c: VerificationCriterion = {
      type: "command_output",
      command: "echo hello",
      expectedOutput: "goodbye",
    };
    const result = evaluateCriterion(c, () => "hello world");
    expect(result.passed).toBe(false);
  });

  it("evaluates file_existence: pass when file exists", () => {
    const c: VerificationCriterion = {
      type: "file_existence",
      filePath: "package.json",
    };
    const result = evaluateCriterion(c, undefined, (path) =>
      path === "package.json",
    );
    expect(result.passed).toBe(true);
  });

  it("evaluates file_existence: fail when file missing", () => {
    const c: VerificationCriterion = {
      type: "file_existence",
      filePath: "nonexistent.txt",
    };
    const result = evaluateCriterion(c, undefined, () => false);
    expect(result.passed).toBe(false);
  });

  it("evaluates test_pass: pass when all tests pass", () => {
    const c: VerificationCriterion = {
      type: "test_pass",
      command: "npx vitest run",
    };
    const parsed = { passed: 10, failed: 0, skipped: 0 };
    const result = evaluateCriterion(c, () => "output", undefined, () => parsed);
    expect(result.passed).toBe(true);
  });

  it("evaluates test_pass: fail when any test fails", () => {
    const c: VerificationCriterion = {
      type: "test_pass",
      command: "npx vitest run",
      minPassRate: 0.9,
    };
    const parsed = { passed: 5, failed: 5, skipped: 0 };
    const result = evaluateCriterion(c, () => "output", undefined, () => parsed);
    expect(result.passed).toBe(false);
  });

  it("evaluates llm: always requires external review", () => {
    const c: VerificationCriterion = {
      type: "llm",
      prompt: "Is this code correct?",
    };
    const result = evaluateCriterion(c);
    expect(result.passed).toBeNull(); // LLM review is async/external
    expect(result.detail).toContain("requires external LLM review");
  });

  it("evaluates user_approval: always requires manual confirmation", () => {
    const c: VerificationCriterion = {
      type: "user_approval",
      question: "Proceed with deploy?",
    };
    const result = evaluateCriterion(c);
    expect(result.passed).toBeNull(); // user_approval is manual
    expect(result.detail).toContain("requires user approval");
  });
});

// ══════════════════════════════════════════════════════════════════
// evaluateAllCriteria
// ══════════════════════════════════════════════════════════════════

describe("evaluateAllCriteria", () => {
  const passingCriterion: VerificationCriterion = {
    type: "file_existence",
    filePath: "exists.txt",
  };

  it("returns overall passed=true when all criteria pass", () => {
    const results = evaluateAllCriteria([passingCriterion], undefined, () => true);
    expect(results.overallPassed).toBe(true);
    expect(results.results).toHaveLength(1);
  });

  it("returns overall passed=false when any criterion fails", () => {
    const failCriterion: VerificationCriterion = {
      type: "file_existence",
      filePath: "missing.txt",
    };
    const results = evaluateAllCriteria(
      [passingCriterion, failCriterion],
      undefined,
      (path) => path === "exists.txt",
    );
    expect(results.overallPassed).toBe(false);
  });

  it("returns overall passed=null when pending (llm/user_approval)", () => {
    const pendingCriterion: VerificationCriterion = {
      type: "user_approval",
      question: "OK?",
    };
    const results = evaluateAllCriteria([pendingCriterion]);
    expect(results.overallPassed).toBeNull();
  });

  it("provides summary text", () => {
    const results = evaluateAllCriteria([passingCriterion], undefined, () => true);
    expect(results.summary).toBeTruthy();
    expect(results.summary).toContain("1/1 passed");
  });
});

// ══════════════════════════════════════════════════════════════════
// ALLOWED_CHECK_COMMANDS
// ══════════════════════════════════════════════════════════════════

describe("ALLOWED_CHECK_COMMANDS", () => {
  it("includes standard test runners", () => {
    expect(ALLOWED_CHECK_COMMANDS).toContain("npm test");
    expect(ALLOWED_CHECK_COMMANDS).toContain("cargo test");
    expect(ALLOWED_CHECK_COMMANDS).toContain("go test");
    expect(ALLOWED_CHECK_COMMANDS).toContain("pytest");
  });
});

// ══════════════════════════════════════════════════════════════════
// formatVerificationBlock
// ══════════════════════════════════════════════════════════════════

describe("formatVerificationBlock", () => {
  it("formats criteria into a readable block", () => {
    const criteria: VerificationCriterion[] = [
      { type: "test_pass", command: "npm test", description: "All tests pass" },
      { type: "file_existence", filePath: "dist/app.js", description: "Build output exists" },
    ];
    const block = formatVerificationBlock(criteria);
    expect(block).toContain("Verification Criteria");
    expect(block).toContain("npm test");
    expect(block).toContain("dist/app.js");
  });

  it("returns empty string for empty criteria", () => {
    expect(formatVerificationBlock([])).toBe("");
  });
});
