/**
 * TaskContext — M2 Step 4: 任务上下文管理
 *
 * 8 字段结构，支持自动进度推断（session_end 时 LLM 分析 transcript）。
 * 置信度 < 0.7 不自动更新。
 *
 * 架构参考: architech/praxis-architecture.md §7.4 (TaskContext)
 */

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

export type TaskType = "feature" | "bugfix" | "refactor" | "research" | "ops" | "unknown";

export interface TaskContext {
  taskId: string;
  name: string;
  type: TaskType;
  /** 当前所处阶段 */
  currentPhase: string;
  /** 进度摘要（≤200 chars） */
  progressSummary: string;
  /** 当前活跃的子任务 */
  activeSubtasks: string[];
  /** 该任务相关的场景 IDs */
  relevantScenarios: string[];
  /** 该任务上下文最后自动更新的时间戳 */
  lastAutoUpdated: number | null;
  /** 创建时间 */
  createdAt: number;
}

/** LLM 推断的进度变化（session_end 时生成） */
export interface InferredProgress {
  /** 推断的新阶段 */
  newPhase?: string;
  /** 进度摘要更新 */
  progressUpdate?: string;
  /** 新发现的活跃子任务 */
  newSubtasks?: string[];
  /** 已完成/可移除的子任务 */
  completedSubtasks?: string[];
  /** 推断置信度 */
  confidence: number;
}

/** 创建 TaskContext 的输入 */
export interface CreateTaskContextInput {
  taskId: string;
  name: string;
  type?: TaskType;
  relevantScenarios?: string[];
}

// ══════════════════════════════════════════════════════════════════
// 自动更新阈值
// ══════════════════════════════════════════════════════════════════

/** 置信度低于此值不自动更新 */
const AUTO_UPDATE_MIN_CONFIDENCE = 0.7;

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 创建新的 TaskContext。
 */
export function createTaskContext(input: CreateTaskContextInput): TaskContext {
  return {
    taskId: input.taskId,
    name: input.name,
    type: input.type ?? "unknown",
    currentPhase: "init",
    progressSummary: "",
    activeSubtasks: [],
    relevantScenarios: input.relevantScenarios ?? [],
    lastAutoUpdated: null,
    createdAt: Date.now(),
  };
}

/**
 * 应用 LLM 推断的进度变化到 TaskContext。
 * 仅当置信度 ≥ AUTO_UPDATE_MIN_CONFIDENCE 时才执行更新。
 *
 * @returns { updated: TaskContext; applied: boolean } — applied=false 表示置信度不足，未更新
 */
export function applyProgress(
  ctx: TaskContext,
  inferred: InferredProgress,
): { updated: TaskContext; applied: boolean } {
  if (inferred.confidence < AUTO_UPDATE_MIN_CONFIDENCE) {
    return { updated: ctx, applied: false };
  }

  const updated: TaskContext = {
    ...ctx,
    currentPhase: inferred.newPhase ?? ctx.currentPhase,
    progressSummary: inferred.progressUpdate ?? ctx.progressSummary,
    activeSubtasks: mergeSubtasks(
      ctx.activeSubtasks,
      inferred.newSubtasks ?? [],
      inferred.completedSubtasks ?? [],
    ),
    lastAutoUpdated: Date.now(),
  };

  return { updated, applied: true };
}

/**
 * 手动更新 TaskContext 字段（始终应用，不检查置信度）。
 */
export function updateTaskContext(
  ctx: TaskContext,
  updates: Partial<Pick<TaskContext, "currentPhase" | "progressSummary" | "relevantScenarios">>,
): TaskContext {
  return { ...ctx, ...updates };
}

/**
 * 检查 TaskContext 是否"过期"（超过 N 天未自动更新）。
 */
export function isStale(ctx: TaskContext, maxDays: number = 7): boolean {
  if (ctx.lastAutoUpdated === null) {
    // 从未自动更新过 — 检查创建时间
    return Date.now() - ctx.createdAt > maxDays * 24 * 60 * 60 * 1000;
  }
  return Date.now() - ctx.lastAutoUpdated > maxDays * 24 * 60 * 60 * 1000;
}

/**
 * 格式化 TaskContext 为 LLM system prompt 注入文本。
 */
export function formatTaskContext(ctx: TaskContext): string {
  const lines: string[] = [
    "## 当前任务上下文",
    `- **任务**: ${ctx.name} (${ctx.type})`,
    `- **阶段**: ${ctx.currentPhase}`,
  ];

  if (ctx.progressSummary) {
    lines.push(`- **进度**: ${ctx.progressSummary}`);
  }

  if (ctx.activeSubtasks.length > 0) {
    lines.push(`- **活跃子任务**: ${ctx.activeSubtasks.join(", ")}`);
  }

  if (ctx.relevantScenarios.length > 0) {
    lines.push(`- **相关场景**: ${ctx.relevantScenarios.join(", ")}`);
  }

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// 内部
// ══════════════════════════════════════════════════════════════════

function mergeSubtasks(
  current: string[],
  added: string[],
  completed: string[],
): string[] {
  const completedSet = new Set(completed);
  const filtered = current.filter((s) => !completedSet.has(s));
  const addedSet = new Set(filtered);
  for (const s of added) {
    if (!addedSet.has(s)) filtered.push(s);
  }
  return filtered;
}
