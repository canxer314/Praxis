/**
 * files/plan-file-writer.ts — task_plan.md / progress.md / findings.md
 *
 * 将 Praxis 内部数据结构格式化为 planning-with-files 兼容的 markdown 文件。
 * 纯格式化层 — 不执行文件 I/O (文件写入由 Agent 运行时负责)。
 *
 * 架构参考: §11 files/plan-file-writer.ts
 */

export interface PlanDocumentInput {
  taskName: string;
  phases: PlanPhaseInput[];
  pitfalls: PitfallInput[];
}

export interface PlanPhaseInput {
  name: string;
  subtasks: { name: string; criteria: string[] }[];
}

export interface PitfallInput {
  description: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
  affectedPhases: string[];
}

export interface ProgressSummaryInput {
  taskName: string;
  currentPhase: string;
  completedSubtasks: string[];
  errors: number;
  lastUpdated: number;
}

export interface FindingInput {
  type: "issue" | "insight" | "decision";
  description: string;
  severity: "info" | "warning" | "critical" | "high";
}

export function formatTaskPlanMarkdown(plan: PlanDocumentInput): string {
  const lines: string[] = [
    `# Task Plan: ${plan.taskName}`,
    "",
    `> Generated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "## Phases",
    "",
  ];

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i]!;
    lines.push(`### Phase ${i + 1}: ${phase.name}`);
    for (const st of phase.subtasks) {
      const check = st.criteria.length > 0 ? ` (验收: ${st.criteria.join(", ")})` : "";
      lines.push(`- [ ] ${st.name}${check}`);
    }
    lines.push("");
  }

  if (plan.pitfalls.length > 0) {
    lines.push("## Pitfalls");
    lines.push("");
    for (const p of plan.pitfalls) {
      const sev = p.severity === "high" ? "🔴" : p.severity === "medium" ? "🟡" : "🟢";
      lines.push(`- ${sev} **${p.description}**`);
      lines.push(`  - Mitigation: ${p.mitigation}`);
      lines.push(`  - Affects: ${p.affectedPhases.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatProgressMarkdown(progress: ProgressSummaryInput): string {
  const lines: string[] = [
    `# Progress: ${progress.taskName}`,
    "",
    `- **Current Phase**: ${progress.currentPhase}`,
    `- **Last Updated**: ${new Date(progress.lastUpdated).toISOString().slice(0, 16)}`,
    "",
  ];

  if (progress.completedSubtasks.length > 0) {
    lines.push("## Completed");
    for (const st of progress.completedSubtasks) {
      lines.push(`- [x] ${st}`);
    }
    lines.push("");
  }

  if (progress.errors > 0) {
    lines.push(`## ⚠️ ${progress.errors} error(s) encountered`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatFindingsMarkdown(findings: FindingInput[]): string {
  if (findings.length === 0) return "";

  const lines: string[] = ["# Findings", ""];

  for (const f of findings) {
    const icon = f.type === "issue" ? "🐛" : f.type === "insight" ? "💡" : "📋";
    const sev = f.severity === "critical" || f.severity === "high" ? "⚠️ " : "";
    lines.push(`- ${icon} ${sev}**${f.description}** (${f.type})`);
  }

  lines.push("");
  return lines.join("\n");
}
