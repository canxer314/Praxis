/**
 * orchestration/progress-tracker.ts — 进度事件收集 + 摘要生成
 *
 * 从 after_tool_call + agent_end 收集进度事件，生成进度摘要。
 * 纯数据收集层 — 不做决策，决策由 TaskContext + plan-generator 负责。
 *
 * 架构参考: §5 验收, §11 orchestration/progress-tracker.ts
 */

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface ProgressTracker {
  taskId: string;
  currentPhase: string;
  events: ProgressEvent[];
  startedAt: number;
  lastEventAt: number;
}

export interface ProgressEvent {
  type: "subtask_completed" | "tool_call" | "phase_transition" | "error" | "checkpoint";
  phase: string;
  timestamp?: number;
  subtask?: string;
  tool?: string;
  success?: boolean;
  fromPhase?: string;
  toPhase?: string;
  detail?: string;
}

export interface ProgressSummary {
  totalEvents: number;
  completedSubtasks: string[];
  successfulTools: number;
  failedTools: number;
  errors: number;
  phasesVisited: string[];
  summary: string;
  timestamp: number;
}

// ══════════════════════════════════════════════════════════════════
// 工厂
// ══════════════════════════════════════════════════════════════════

export function createProgressTracker(
  taskId: string,
  currentPhase: string,
): ProgressTracker {
  return {
    taskId,
    currentPhase,
    events: [],
    startedAt: Date.now(),
    lastEventAt: Date.now(),
  };
}

// ══════════════════════════════════════════════════════════════════
// 事件记录
// ══════════════════════════════════════════════════════════════════

/**
 * 记录进度事件，返回新的 tracker (不修改原对象)。
 */
export function recordProgressEvent(
  tracker: ProgressTracker,
  event: Omit<ProgressEvent, "timestamp">,
): ProgressTracker {
  const eventWithTs: ProgressEvent = {
    ...event,
    timestamp: Date.now(),
  };

  let currentPhase = tracker.currentPhase;
  if (event.type === "phase_transition" && event.toPhase) {
    currentPhase = event.toPhase;
  }

  return {
    ...tracker,
    currentPhase,
    events: [...tracker.events, eventWithTs],
    lastEventAt: Date.now(),
  };
}

// ══════════════════════════════════════════════════════════════════
// 摘要
// ══════════════════════════════════════════════════════════════════

export function generateProgressSummary(tracker: ProgressTracker): ProgressSummary {
  const completedSubtasks: string[] = [];
  let successfulTools = 0;
  let failedTools = 0;
  let errors = 0;
  const phasesVisited = new Set<string>();
  phasesVisited.add(tracker.currentPhase);

  for (const e of tracker.events) {
    phasesVisited.add(e.phase);
    if (e.type === "subtask_completed" && e.subtask) {
      completedSubtasks.push(e.subtask);
    }
    if (e.type === "tool_call") {
      if (e.success) successfulTools++;
      else failedTools++;
    }
    if (e.type === "error") {
      errors++;
    }
    if (e.type === "phase_transition") {
      if (e.fromPhase) phasesVisited.add(e.fromPhase);
      if (e.toPhase) phasesVisited.add(e.toPhase);
    }
  }

  const parts: string[] = [];
  if (completedSubtasks.length > 0) {
    parts.push(`${completedSubtasks.length} subtasks completed`);
  }
  if (successfulTools > 0 || failedTools > 0) {
    parts.push(`${successfulTools}/${successfulTools + failedTools} tools succeeded`);
  }
  if (errors > 0) {
    parts.push(`${errors} errors`);
  }

  return {
    totalEvents: tracker.events.length,
    completedSubtasks,
    successfulTools,
    failedTools,
    errors,
    phasesVisited: [...phasesVisited],
    summary: parts.length > 0 ? parts.join("; ") : "No progress recorded.",
    timestamp: Date.now(),
  };
}

// ══════════════════════════════════════════════════════════════════
// 查询
// ══════════════════════════════════════════════════════════════════

export function getPhaseProgress(
  tracker: ProgressTracker,
  phase: string,
): ProgressEvent[] {
  return tracker.events.filter((e) => e.phase === phase);
}
