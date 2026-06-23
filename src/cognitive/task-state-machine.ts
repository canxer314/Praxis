/**
 * TaskStateMachine — 纯函数两层嵌套状态机
 *
 * 职责:
 *   - 外层循环: 任务级状态转换 (TaskState)
 *   - 内层循环: 子任务级状态转换 (SubtaskState)
 *   - 所有转换为纯函数，不依赖外部状态
 *   - 无效转换: no-op + log 警告
 *
 * 设计来源: V12 两层嵌套 while() 循环
 */

import { TaskState, SubtaskState } from "./types";
import type { TaskEvent, SubtaskEvent } from "./types";

// ══════════════════════════════════════════════════════════════════
// 外层循环: 任务级状态转移表
// ══════════════════════════════════════════════════════════════════

const TASK_TRANSITIONS: Record<TaskState, Partial<Record<TaskEvent, TaskState>>> = {
  [TaskState.TASK_NOT_STARTED]: {
    task_start: TaskState.TASK_ASSESSING,
  },
  [TaskState.TASK_ASSESSING]: {
    assessment_complete: TaskState.TASK_PLAN_GENERATING,
  },
  [TaskState.TASK_PLAN_GENERATING]: {
    plan_ready: TaskState.TASK_IN_PROGRESS,
  },
  [TaskState.TASK_IN_PROGRESS]: {
    all_subtasks_done: TaskState.TASK_VERIFYING,
  },
  [TaskState.TASK_VERIFYING]: {
    verification_passed: TaskState.TASK_COMPLETE,
    verification_failed: TaskState.TASK_ITERATING,
  },
  [TaskState.TASK_ITERATING]: {
    plan_ready: TaskState.TASK_IN_PROGRESS,
    user_abort: TaskState.TASK_ABANDONED,
    max_iterations: TaskState.TASK_ABANDONED,
  },
  [TaskState.TASK_COMPLETE]: {},
  [TaskState.TASK_ABANDONED]: {},
};

// ══════════════════════════════════════════════════════════════════
// 内层循环: 子任务级状态转移表
// ══════════════════════════════════════════════════════════════════

const SUBTASK_TRANSITIONS: Record<SubtaskState, Partial<Record<SubtaskEvent, SubtaskState>>> = {
  [SubtaskState.SUBTASK_PENDING]: {
    subtask_start: SubtaskState.SUBTASK_ACTIVE,
  },
  [SubtaskState.SUBTASK_ACTIVE]: {
    subtask_done: SubtaskState.SUBTASK_COMPLETING,
    user_correction_3x: SubtaskState.SUBTASK_BLOCKED,
    tool_violation_3x: SubtaskState.SUBTASK_BLOCKED,
    max_retries: SubtaskState.SUBTASK_FAILED,
  },
  [SubtaskState.SUBTASK_COMPLETING]: {
    verification_passed: SubtaskState.SUBTASK_VERIFIED,
    verification_failed: SubtaskState.SUBTASK_FAILED,
  },
  [SubtaskState.SUBTASK_VERIFIED]: {},
  [SubtaskState.SUBTASK_FAILED]: {},
  [SubtaskState.SUBTASK_BLOCKED]: {},
};

// ══════════════════════════════════════════════════════════════════
// 终端状态
// ══════════════════════════════════════════════════════════════════

const TASK_TERMINAL: ReadonlySet<TaskState> = new Set([
  TaskState.TASK_COMPLETE,
  TaskState.TASK_ABANDONED,
]);

const SUBTASK_TERMINAL: ReadonlySet<SubtaskState> = new Set([
  SubtaskState.SUBTASK_VERIFIED,
  SubtaskState.SUBTASK_FAILED,
  SubtaskState.SUBTASK_BLOCKED,
]);

// ══════════════════════════════════════════════════════════════════
// 公共 API
// ══════════════════════════════════════════════════════════════════

/** 外层任务状态推进结果 */
export interface TaskTransitionResult {
  ok: boolean;
  from: TaskState;
  to: TaskState;
  event: TaskEvent;
  /** 无效转换时包含原因 */
  reason?: string;
}

/** 内层子任务状态推进结果 */
export interface SubtaskTransitionResult {
  ok: boolean;
  from: SubtaskState;
  to: SubtaskState;
  event: SubtaskEvent;
  /** 无效转换时包含原因 */
  reason?: string;
}

/**
 * 推进外层任务状态机。
 *
 * 无效转换返回 `{ ok: false, reason: "..." }`，不抛异常。
 * 终端状态 (TASK_COMPLETE, TASK_ABANDONED) 不接受任何事件。
 */
export function advanceTask(
  from: TaskState,
  event: TaskEvent,
): TaskTransitionResult {
  if (isTaskTerminal(from)) {
    return {
      ok: false,
      from,
      to: from,
      event,
      reason: `Cannot advance from terminal state "${from}"`,
    };
  }

  const next = TASK_TRANSITIONS[from]?.[event];
  if (next === undefined) {
    return {
      ok: false,
      from,
      to: from,
      event,
      reason: `Invalid transition: "${from}" + "${event}"`,
    };
  }

  return { ok: true, from, to: next, event };
}

/**
 * 推进内层子任务状态机。
 *
 * 无效转换返回 `{ ok: false, reason: "..." }`，不抛异常。
 * 终端状态 (SUBTASK_VERIFIED, SUBTASK_FAILED, SUBTASK_BLOCKED) 不接受任何事件。
 */
export function advanceSubtask(
  from: SubtaskState,
  event: SubtaskEvent,
): SubtaskTransitionResult {
  if (isSubtaskTerminal(from)) {
    return {
      ok: false,
      from,
      to: from,
      event,
      reason: `Cannot advance from terminal state "${from}"`,
    };
  }

  const next = SUBTASK_TRANSITIONS[from]?.[event];
  if (next === undefined) {
    return {
      ok: false,
      from,
      to: from,
      event,
      reason: `Invalid transition: "${from}" + "${event}"`,
    };
  }

  return { ok: true, from, to: next, event };
}

// ---- 查询 ----

/** 是否为外层任务终端状态 */
export function isTaskTerminal(state: TaskState): boolean {
  return TASK_TERMINAL.has(state);
}

/** 是否为内层子任务终端状态 */
export function isSubtaskTerminal(state: SubtaskState): boolean {
  return SUBTASK_TERMINAL.has(state);
}

/** 列出所有有效的任务级转换 (共 27 条路径含多次访问) */
export function listTaskTransitions(): Array<{ from: TaskState; event: TaskEvent; to: TaskState }> {
  const result: Array<{ from: TaskState; event: TaskEvent; to: TaskState }> = [];
  for (const from of Object.values(TaskState)) {
    const transitions = TASK_TRANSITIONS[from];
    if (!transitions) continue;
    for (const [event, to] of Object.entries(transitions)) {
      result.push({ from, event: event as TaskEvent, to: to as TaskState });
    }
  }
  return result;
}

/** 列出所有有效的子任务级转换 */
export function listSubtaskTransitions(): Array<{ from: SubtaskState; event: SubtaskEvent; to: SubtaskState }> {
  const result: Array<{ from: SubtaskState; event: SubtaskEvent; to: SubtaskState }> = [];
  for (const from of Object.values(SubtaskState)) {
    const transitions = SUBTASK_TRANSITIONS[from];
    if (!transitions) continue;
    for (const [event, to] of Object.entries(transitions)) {
      result.push({ from, event: event as SubtaskEvent, to: to as SubtaskState });
    }
  }
  return result;
}
