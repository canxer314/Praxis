/**
 * orchestration/verifier.ts — 统一验证器: 5 种验收标准
 *
 * 与 analysis/ 下的 3 个独立验证器 (statistical/role/concept) 不同——
 * verifier.ts 是任务编排层的验收层，验证"子任务是否完成"而非"ProtoStructure 质量如何"。
 *
 * 5 种验收标准:
 *   command_output — 运行命令并匹配输出模式 (白名单约束)
 *   file_existence — 检查文件是否已生成
 *   test_pass      — 运行测试框架并解析结构化结果
 *   llm            — LLM 审查代码/文档质量 (半自动)
 *   user_approval  — 部署/安全/财务类操作必须人类确认 (手动)
 *
 * 架构参考: §5 验收标准, §11 orchestration/verifier.ts
 * GovernancePolicy: verification.allowed_check_commands (白名单)
 */

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export type CriterionType =
  | "command_output"
  | "file_existence"
  | "test_pass"
  | "llm"
  | "user_approval";

export interface VerificationCriterion {
  type: CriterionType;
  /** Human-readable description */
  description?: string;

  // command_output / test_pass
  command?: string;
  // command_output
  expectedOutput?: string;
  // file_existence
  filePath?: string;
  // test_pass
  minPassRate?: number;
  // llm
  prompt?: string;
  // user_approval
  question?: string;
}

export interface CriterionResult {
  type: CriterionType;
  /** true=pass, false=fail, null=pending (llm/user_approval) */
  passed: boolean | null;
  detail: string;
}

export interface VerificationResult {
  results: CriterionResult[];
  /** true=all passed, false=≥1 failed, null=some pending and none failed */
  overallPassed: boolean | null;
  summary: string;
}

/** Parsed test output from a test framework */
export interface TestSuiteResult {
  passed: number;
  failed: number;
  skipped: number;
  total?: number;
}

// ══════════════════════════════════════════════════════════════════
// 命令白名单 (来自 GovernancePolicy)
// ══════════════════════════════════════════════════════════════════

/** 允许在 verification 中执行的命令白名单 */
export const ALLOWED_CHECK_COMMANDS: readonly string[] = [
  "npm test",
  "cargo test",
  "go test",
  "pytest",
];

// ══════════════════════════════════════════════════════════════════
// 工厂函数
// ══════════════════════════════════════════════════════════════════

const DEFAULT_DESCRIPTIONS: Record<CriterionType, string> = {
  command_output: "Run command and verify output matches expected pattern",
  file_existence: "Verify that the specified file exists",
  test_pass: "Run test suite and verify all tests pass",
  llm: "LLM review of code or documentation quality",
  user_approval: "Manual user confirmation required",
};

/**
 * 创建一个验收标准。
 */
export function createVerificationCriterion(
  type: CriterionType,
  fields: Partial<Omit<VerificationCriterion, "type">>,
): VerificationCriterion {
  return {
    type,
    description: fields.description ?? DEFAULT_DESCRIPTIONS[type],
    ...fields,
  };
}

// ══════════════════════════════════════════════════════════════════
// 评估
// ══════════════════════════════════════════════════════════════════

/**
 * 评估单个验收标准。
 *
 * @param criterion 验收标准
 * @param runCommand 执行命令的函数 (注入，便于测试)
 * @param fileExists 检查文件是否存在的函数 (注入)
 * @param parseTestOutput 解析测试输出的函数 (注入)
 */
export function evaluateCriterion(
  criterion: VerificationCriterion,
  runCommand?: (cmd: string) => string,
  fileExists?: (path: string) => boolean,
  parseTestOutput?: (raw: string) => TestSuiteResult,
): CriterionResult {
  switch (criterion.type) {
    case "command_output":
      return evaluateCommandOutput(criterion, runCommand);
    case "file_existence":
      return evaluateFileExistence(criterion, fileExists);
    case "test_pass":
      return evaluateTestPass(criterion, runCommand, parseTestOutput);
    case "llm":
      return {
        type: "llm",
        passed: null,
        detail: `LLM criterion requires external LLM review: ${criterion.prompt ?? criterion.description}`,
      };
    case "user_approval":
      return {
        type: "user_approval",
        passed: null,
        detail: `User approval criterion requires user approval: ${criterion.question ?? criterion.description}`,
      };
  }
}

/**
 * 评估所有验收标准，返回聚合结果。
 */
export function evaluateAllCriteria(
  criteria: VerificationCriterion[],
  runCommand?: (cmd: string) => string,
  fileExists?: (path: string) => boolean,
  parseTestOutput?: (raw: string) => TestSuiteResult,
): VerificationResult {
  if (criteria.length === 0) {
    return { results: [], overallPassed: true, summary: "No criteria to verify." };
  }

  const results = criteria.map((c) =>
    evaluateCriterion(c, runCommand, fileExists, parseTestOutput),
  );

  const passed = results.filter((r) => r.passed === true).length;
  const failed = results.filter((r) => r.passed === false).length;
  const pending = results.filter((r) => r.passed === null).length;

  let overallPassed: boolean | null;
  if (failed > 0) {
    overallPassed = false;
  } else if (pending > 0) {
    overallPassed = null;
  } else {
    overallPassed = true;
  }

  const statusParts: string[] = [];
  if (passed > 0) statusParts.push(`${passed} passed`);
  if (failed > 0) statusParts.push(`${failed} failed`);
  if (pending > 0) statusParts.push(`${pending} pending`);

  const summary = `${statusParts.join(", ")} — ${passed}/${criteria.length} passed`;

  return { results, overallPassed, summary };
}

// ══════════════════════════════════════════════════════════════════
// 格式化
// ══════════════════════════════════════════════════════════════════

/**
 * 将验收标准格式化为可注入 LLM 上下文的文本块。
 */
export function formatVerificationBlock(criteria: VerificationCriterion[]): string {
  if (criteria.length === 0) return "";

  const lines: string[] = ["## Verification Criteria", ""];
  for (let i = 0; i < criteria.length; i++) {
    const c = criteria[i];
    const icon = ICONS[c.type] ?? "?";
    const desc = c.description ?? c.type;
    lines.push(`${i + 1}. ${icon} **${desc}**`);
    if (c.command) lines.push(`   - Command: \`${c.command}\``);
    if (c.expectedOutput) lines.push(`   - Expected: "${c.expectedOutput}"`);
    if (c.filePath) lines.push(`   - File: \`${c.filePath}\``);
    if (c.question) lines.push(`   - Question: ${c.question}`);
    if (c.prompt) lines.push(`   - Prompt: ${c.prompt}`);
  }

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// Internal evaluators
// ══════════════════════════════════════════════════════════════════

const ICONS: Record<CriterionType, string> = {
  command_output: "💻",
  file_existence: "📄",
  test_pass: "✅",
  llm: "🤖",
  user_approval: "👤",
};

function evaluateCommandOutput(
  c: VerificationCriterion,
  runCommand?: (cmd: string) => string,
): CriterionResult {
  if (!runCommand) {
    return { type: "command_output", passed: null, detail: "No command runner available" };
  }
  const output = runCommand(c.command ?? "");
  const expected = c.expectedOutput ?? "";
  const passed = output.includes(expected);
  return {
    type: "command_output",
    passed,
    detail: passed
      ? `Command output contains "${expected}"`
      : `Command output does not contain "${expected}"`,
  };
}

function evaluateFileExistence(
  c: VerificationCriterion,
  fileExists?: (path: string) => boolean,
): CriterionResult {
  if (!fileExists) {
    return { type: "file_existence", passed: null, detail: "No file checker available" };
  }
  const exists = fileExists(c.filePath ?? "");
  return {
    type: "file_existence",
    passed: exists,
    detail: exists
      ? `File exists: ${c.filePath}`
      : `File not found: ${c.filePath}`,
  };
}

function evaluateTestPass(
  c: VerificationCriterion,
  runCommand?: (cmd: string) => string,
  parseTestOutput?: (raw: string) => TestSuiteResult,
): CriterionResult {
  if (!runCommand || !parseTestOutput) {
    return { type: "test_pass", passed: null, detail: "No test runner available" };
  }
  const output = runCommand(c.command ?? "");
  const parsed = parseTestOutput(output);
  const minRate = c.minPassRate ?? 1.0;
  const total = parsed.passed + parsed.failed + parsed.skipped;
  const passRate = total > 0 ? parsed.passed / total : 0;
  const passed = parsed.failed === 0 && passRate >= minRate;
  return {
    type: "test_pass",
    passed,
    detail: passed
      ? `Tests passed: ${parsed.passed}/${total}`
      : `Tests failed: ${parsed.failed} failed, ${parsed.passed} passed (min rate: ${minRate})`,
  };
}
