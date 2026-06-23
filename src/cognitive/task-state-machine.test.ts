/**
 * task-state-machine 测试 — 两层嵌套状态机
 *
 * 覆盖:
 *   - 所有有效任务级转换 (9 条边)
 *   - 所有有效子任务级转换 (7 条边)
 *   - 无效转换 (事件与状态不匹配)
 *   - 终端状态拒绝所有事件
 *   - 查询函数 (isTaskTerminal, isSubtaskTerminal, listTransitions)
 */

import { describe, it, expect } from "vitest";
import {
  advanceTask,
  advanceSubtask,
  isTaskTerminal,
  isSubtaskTerminal,
  listTaskTransitions,
  listSubtaskTransitions,
} from "./task-state-machine";
import { TaskState, SubtaskState } from "./types";

// ══════════════════════════════════════════════════════════════════
// 外层: 任务级状态机
// ══════════════════════════════════════════════════════════════════

describe("advanceTask — 有效转换", () => {
  it("TASK_NOT_STARTED → task_start → TASK_ASSESSING", () => {
    const r = advanceTask(TaskState.TASK_NOT_STARTED, "task_start");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(TaskState.TASK_ASSESSING);
  });

  it("TASK_ASSESSING → assessment_complete → TASK_PLAN_GENERATING", () => {
    const r = advanceTask(TaskState.TASK_ASSESSING, "assessment_complete");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(TaskState.TASK_PLAN_GENERATING);
  });

  it("TASK_PLAN_GENERATING → plan_ready → TASK_IN_PROGRESS", () => {
    const r = advanceTask(TaskState.TASK_PLAN_GENERATING, "plan_ready");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(TaskState.TASK_IN_PROGRESS);
  });

  it("TASK_IN_PROGRESS → all_subtasks_done → TASK_VERIFYING", () => {
    const r = advanceTask(TaskState.TASK_IN_PROGRESS, "all_subtasks_done");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(TaskState.TASK_VERIFYING);
  });

  it("TASK_VERIFYING → verification_passed → TASK_COMPLETE", () => {
    const r = advanceTask(TaskState.TASK_VERIFYING, "verification_passed");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(TaskState.TASK_COMPLETE);
  });

  it("TASK_VERIFYING → verification_failed → TASK_ITERATING", () => {
    const r = advanceTask(TaskState.TASK_VERIFYING, "verification_failed");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(TaskState.TASK_ITERATING);
  });

  it("TASK_ITERATING → plan_ready → TASK_IN_PROGRESS (重新进入)", () => {
    const r = advanceTask(TaskState.TASK_ITERATING, "plan_ready");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(TaskState.TASK_IN_PROGRESS);
  });

  it("TASK_ITERATING → user_abort → TASK_ABANDONED", () => {
    const r = advanceTask(TaskState.TASK_ITERATING, "user_abort");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(TaskState.TASK_ABANDONED);
  });

  it("TASK_ITERATING → max_iterations → TASK_ABANDONED", () => {
    const r = advanceTask(TaskState.TASK_ITERATING, "max_iterations");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(TaskState.TASK_ABANDONED);
  });
});

describe("advanceTask — 无效转换", () => {
  it("TASK_NOT_STARTED + assessment_complete → 无效", () => {
    const r = advanceTask(TaskState.TASK_NOT_STARTED, "assessment_complete");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Invalid transition");
  });

  it("TASK_IN_PROGRESS + task_start → 无效", () => {
    const r = advanceTask(TaskState.TASK_IN_PROGRESS, "task_start");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Invalid transition");
  });
});

describe("advanceTask — 终端状态", () => {
  it("TASK_COMPLETE 不接受任何事件", () => {
    const r = advanceTask(TaskState.TASK_COMPLETE, "task_start");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("terminal state");
    expect(r.to).toBe(TaskState.TASK_COMPLETE);
  });

  it("TASK_ABANDONED 不接受任何事件", () => {
    const r = advanceTask(TaskState.TASK_ABANDONED, "verification_passed");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("terminal state");
    expect(r.to).toBe(TaskState.TASK_ABANDONED);
  });
});

// ══════════════════════════════════════════════════════════════════
// 内层: 子任务级状态机
// ══════════════════════════════════════════════════════════════════

describe("advanceSubtask — 有效转换", () => {
  it("SUBTASK_PENDING → subtask_start → SUBTASK_ACTIVE", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_PENDING, "subtask_start");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(SubtaskState.SUBTASK_ACTIVE);
  });

  it("SUBTASK_ACTIVE → subtask_done → SUBTASK_COMPLETING", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_ACTIVE, "subtask_done");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(SubtaskState.SUBTASK_COMPLETING);
  });

  it("SUBTASK_ACTIVE → user_correction_3x → SUBTASK_BLOCKED", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_ACTIVE, "user_correction_3x");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(SubtaskState.SUBTASK_BLOCKED);
  });

  it("SUBTASK_ACTIVE → tool_violation_3x → SUBTASK_BLOCKED", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_ACTIVE, "tool_violation_3x");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(SubtaskState.SUBTASK_BLOCKED);
  });

  it("SUBTASK_ACTIVE → max_retries → SUBTASK_FAILED", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_ACTIVE, "max_retries");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(SubtaskState.SUBTASK_FAILED);
  });

  it("SUBTASK_COMPLETING → verification_passed → SUBTASK_VERIFIED", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_COMPLETING, "verification_passed");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(SubtaskState.SUBTASK_VERIFIED);
  });

  it("SUBTASK_COMPLETING → verification_failed → SUBTASK_FAILED", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_COMPLETING, "verification_failed");
    expect(r.ok).toBe(true);
    expect(r.to).toBe(SubtaskState.SUBTASK_FAILED);
  });
});

describe("advanceSubtask — 无效转换", () => {
  it("SUBTASK_PENDING + subtask_done → 无效", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_PENDING, "subtask_done");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Invalid transition");
  });

  it("SUBTASK_COMPLETING + subtask_start → 无效", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_COMPLETING, "subtask_start");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Invalid transition");
  });
});

describe("advanceSubtask — 终端状态", () => {
  it("SUBTASK_VERIFIED 不接受任何事件", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_VERIFIED, "subtask_start");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("terminal state");
    expect(r.to).toBe(SubtaskState.SUBTASK_VERIFIED);
  });

  it("SUBTASK_FAILED 不接受任何事件", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_FAILED, "verification_passed");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("terminal state");
    expect(r.to).toBe(SubtaskState.SUBTASK_FAILED);
  });

  it("SUBTASK_BLOCKED 不接受任何事件", () => {
    const r = advanceSubtask(SubtaskState.SUBTASK_BLOCKED, "subtask_done");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("terminal state");
    expect(r.to).toBe(SubtaskState.SUBTASK_BLOCKED);
  });
});

// ══════════════════════════════════════════════════════════════════
// 查询函数
// ══════════════════════════════════════════════════════════════════

describe("终端状态查询", () => {
  it("TASK_COMPLETE 是终端状态", () => {
    expect(isTaskTerminal(TaskState.TASK_COMPLETE)).toBe(true);
  });

  it("TASK_ABANDONED 是终端状态", () => {
    expect(isTaskTerminal(TaskState.TASK_ABANDONED)).toBe(true);
  });

  it("TASK_IN_PROGRESS 不是终端状态", () => {
    expect(isTaskTerminal(TaskState.TASK_IN_PROGRESS)).toBe(false);
  });

  it("SUBTASK_VERIFIED 是终端状态", () => {
    expect(isSubtaskTerminal(SubtaskState.SUBTASK_VERIFIED)).toBe(true);
  });

  it("SUBTASK_FAILED 是终端状态", () => {
    expect(isSubtaskTerminal(SubtaskState.SUBTASK_FAILED)).toBe(true);
  });

  it("SUBTASK_BLOCKED 是终端状态", () => {
    expect(isSubtaskTerminal(SubtaskState.SUBTASK_BLOCKED)).toBe(true);
  });

  it("SUBTASK_ACTIVE 不是终端状态", () => {
    expect(isSubtaskTerminal(SubtaskState.SUBTASK_ACTIVE)).toBe(false);
  });
});

describe("转换列表", () => {
  it("listTaskTransitions 返回所有 9 条边", () => {
    const transitions = listTaskTransitions();
    expect(transitions).toHaveLength(9);
  });

  it("listSubtaskTransitions 返回所有 7 条边", () => {
    const transitions = listSubtaskTransitions();
    expect(transitions).toHaveLength(7);
  });
});
