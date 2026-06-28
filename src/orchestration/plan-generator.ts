/**
 * orchestration/plan-generator.ts — ProtoTask → PlanDocument
 *
 * 将 ProtoTask 模板 + TaskContext 转化为可执行的 PlanDocument，
 * 含 phases, subtasks, criteria, guidance signals, pitfalls。
 *
 * 这是将学习成果转化为执行计划的关键环节。
 *
 * 架构参考: §5 计划生成, §11 orchestration/plan-generator.ts
 */

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface PlanSubtask {
  id: string;
  name: string;
  criteria: string[];
  estimatedDuration?: string;
}

export interface PlanPhase {
  name: string;
  description: string;
  subtasks: PlanSubtask[];
  guidance: string[];
}

export interface PlanPitfall {
  description: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
  affectedPhases: string[];
}

export interface GuidanceSignal {
  signalType:
    | "phase_suggestion"
    | "pitfall_warning"
    | "structure_recommendation"
    | "contradiction_alert"
    | "confidence_advisory";
  severity: "info" | "warning" | "critical";
  summary: string;
  detail?: string;
  suggestedAction?: string;
  sourceStructures?: string[];
  confidence?: number;
}

export interface PlanDocument {
  derivedFrom: {
    protoTaskType: string;
    taskContextId: string;
  };
  /** Human-readable task name from TaskContext */
  taskName: string;
  phases: PlanPhase[];
  pitfalls: PlanPitfall[];
  guidanceSignals: GuidanceSignal[];
  generatedAt: number;
}

/** ProtoTask 模板输入 (与 proto-task-learner.ts ProtoTask 对齐) */
export interface ProtoTaskTemplate {
  taskType: string;
  confidence: number;
  source: "bootstrap" | "cumulative";
  observations: number;
  typicalPhases: ProtoTaskPhaseInput[];
  commonPitfalls: ProtoTaskPitfallInput[];
}

export interface ProtoTaskPhaseInput {
  name: string;
  description: string;
  subtasks: string[];
  criteria: string[];
}

export interface ProtoTaskPitfallInput {
  description: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
  hitCount: number;
}

/** TaskContext 输入 (精简版, 与 task-context.ts TaskContext 对齐) */
export interface TaskContextInput {
  taskId: string;
  name: string;
  type: string;
  currentPhase: string;
  relevantScenarios?: string[];
}

// ══════════════════════════════════════════════════════════════════
// 生成
// ══════════════════════════════════════════════════════════════════

let subtaskCounter = 0;

/**
 * 从 ProtoTask 模板 + TaskContext 生成 PlanDocument。
 * 纯函数 — 不调 LLM, 不访问外部存储。
 */
export function generatePlan(
  protoTask: ProtoTaskTemplate,
  taskCtx: TaskContextInput,
): PlanDocument {
  const phases: PlanPhase[] = protoTask.typicalPhases.map((pt) => ({
    name: pt.name,
    description: pt.description,
    subtasks: pt.subtasks.map((name, i) => ({
      id: `st-${++subtaskCounter}-${name.slice(0, 16).replace(/\s+/g, "_")}`,
      name,
      criteria: i === 0 ? pt.criteria : [], // only first subtask gets all criteria
    })),
    guidance: pt.criteria.map((c) => `验收: ${c}`),
  }));

  const phaseNames = phases.map((p) => p.name);

  const pitfalls: PlanPitfall[] = protoTask.commonPitfalls.map((p) => ({
    description: p.description,
    severity: p.severity,
    mitigation: p.mitigation,
    affectedPhases: [...phaseNames],
  }));

  const guidanceSignals = buildGuidanceSignals(protoTask, phases.length);

  return {
    derivedFrom: {
      protoTaskType: protoTask.taskType,
      taskContextId: taskCtx.taskId,
    },
    taskName: taskCtx.name,
    phases,
    pitfalls,
    guidanceSignals,
    generatedAt: Date.now(),
  };
}

// ══════════════════════════════════════════════════════════════════
// 格式化
// ══════════════════════════════════════════════════════════════════

/**
 * 将 PlanDocument 格式化为可注入 LLM system prompt 的 markdown 文本。
 */
export function formatPlanForInjection(plan: PlanDocument): string {
  if (plan.phases.length === 0) return "";

  const lines: string[] = ["## Task Plan", "", `**Task**: ${plan.taskName}`, ""];

  // Phases
  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i]!;
    const marker = "▶";
    lines.push(`### Phase ${i + 1}: ${phase.name} ${marker}`);
    lines.push(`> ${phase.description}`);
    for (const st of phase.subtasks) {
      const criteria = st.criteria.length > 0 ? ` (验收: ${st.criteria.join(", ")})` : "";
      lines.push(`- [ ] ${st.name}${criteria}`);
    }
    if (phase.guidance.length > 0) {
      for (const g of phase.guidance) {
        lines.push(`  - 💡 ${g}`);
      }
    }
    lines.push("");
  }

  // Pitfalls
  if (plan.pitfalls.length > 0) {
    lines.push("### ⛔ Known Pitfalls");
    for (const pf of plan.pitfalls) {
      const sevIcon = pf.severity === "high" ? "🔴" : pf.severity === "medium" ? "🟡" : "🟢";
      lines.push(`- ${sevIcon} **${pf.description}**`);
      lines.push(`  - Mitigation: ${pf.mitigation}`);
      lines.push(`  - Affects: ${pf.affectedPhases.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// Pitfall 合并
// ══════════════════════════════════════════════════════════════════

/**
 * 将新陷阱合并到 PlanDocument 中，去重（按 description）。
 * 不修改原 plan。
 */
export function mergePitfallsIntoPlan(
  plan: PlanDocument,
  newPitfalls: ProtoTaskPitfallInput[],
): PlanDocument {
  const existingDescriptions = new Set(plan.pitfalls.map((p) => p.description));
  const uniqueNew = newPitfalls.filter(
    (p) => !existingDescriptions.has(p.description),
  );

  if (uniqueNew.length === 0) return plan;

  const phaseNames = plan.phases.map((p) => p.name);
  const added: PlanPitfall[] = uniqueNew.map((p) => ({
    description: p.description,
    severity: p.severity,
    mitigation: p.mitigation,
    affectedPhases: [...phaseNames],
  }));

  return {
    ...plan,
    pitfalls: [...plan.pitfalls, ...added],
  };
}

// ══════════════════════════════════════════════════════════════════
// Internal: guidance signal building
// ══════════════════════════════════════════════════════════════════

function buildGuidanceSignals(
  pt: ProtoTaskTemplate,
  phaseCount: number,
): GuidanceSignal[] {
  const signals: GuidanceSignal[] = [];

  // Confidence advisory
  if (pt.confidence > 0) {
    const sev: "info" | "warning" | "critical" =
      pt.confidence >= 0.7 ? "info" : pt.confidence >= 0.4 ? "warning" : "critical";
    signals.push({
      signalType: "confidence_advisory",
      severity: sev,
      summary: `ProtoTask "${pt.taskType}" confidence: ${pt.confidence.toFixed(2)} (${pt.source}, ${pt.observations} observations)`,
      confidence: pt.confidence,
    });
  }

  // Pitfall warning per pitfall
  for (const pf of pt.commonPitfalls) {
    if (pf.hitCount >= 3) {
      signals.push({
        signalType: "pitfall_warning",
        severity: pf.severity === "high" ? "critical" : "warning",
        summary: `Known pitfall: ${pf.description} (${pf.hitCount} hits)`,
        detail: `Mitigation: ${pf.mitigation}`,
        suggestedAction: pf.mitigation,
      });
    }
  }

  // Phase suggestion when there are phases
  if (phaseCount > 0 && pt.observations >= 3) {
    signals.push({
      signalType: "phase_suggestion",
      severity: "info",
      summary: `${phaseCount} phases from ${pt.observations} prior ${pt.taskType} tasks`,
    });
  }

  return signals;
}
