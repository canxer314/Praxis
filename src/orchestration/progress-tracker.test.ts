/**
 * orchestration/progress-tracker.ts — 进度事件收集 + 摘要测试
 *
 * 架构参考: §5 验收, §11 orchestration/progress-tracker.ts
 *
 * 从 after_tool_call + agent_end 收集进度事件，生成进度摘要。
 */

import { describe, it, expect } from "vitest";
import {
  createProgressTracker,
  recordProgressEvent,
  generateProgressSummary,
  getPhaseProgress,
  type ProgressTracker,
  type ProgressEvent,
} from "./progress-tracker";

describe("createProgressTracker", () => {
  it("creates an empty tracker for a task", () => {
    const tracker = createProgressTracker("task-001", "deploy");
    expect(tracker.taskId).toBe("task-001");
    expect(tracker.currentPhase).toBe("deploy");
    expect(tracker.events).toHaveLength(0);
    expect(tracker.startedAt).toBeGreaterThan(0);
  });
});

describe("recordProgressEvent", () => {
  it("records a subtask completion event", () => {
    let tracker = createProgressTracker("t1", "build");
    tracker = recordProgressEvent(tracker, {
      type: "subtask_completed",
      phase: "build",
      subtask: "代码检查",
      detail: "ESLint 通过",
    });
    expect(tracker.events).toHaveLength(1);
    expect(tracker.events[0]!.type).toBe("subtask_completed");
    expect(tracker.events[0]!.subtask).toBe("代码检查");
  });

  it("records a tool call event", () => {
    let tracker = createProgressTracker("t1", "test");
    tracker = recordProgressEvent(tracker, {
      type: "tool_call",
      phase: "test",
      tool: "vitest",
      success: true,
    });
    expect(tracker.events[0]!.tool).toBe("vitest");
    expect(tracker.events[0]!.success).toBe(true);
  });

  it("records a phase transition event", () => {
    let tracker = createProgressTracker("t1", "build");
    tracker = recordProgressEvent(tracker, {
      type: "phase_transition",
      fromPhase: "build",
      toPhase: "deploy",
    });
    expect(tracker.events[0]!.type).toBe("phase_transition");
  });

  it("records an error event", () => {
    let tracker = createProgressTracker("t1", "deploy");
    tracker = recordProgressEvent(tracker, {
      type: "error",
      phase: "deploy",
      detail: "健康检查超时",
    });
    expect(tracker.events[0]!.type).toBe("error");
  });

  it("does not mutate original tracker", () => {
    const tracker = createProgressTracker("t1", "build");
    recordProgressEvent(tracker, {
      type: "subtask_completed",
      phase: "build",
      subtask: "lint",
    });
    expect(tracker.events).toHaveLength(0);
  });
});

describe("generateProgressSummary", () => {
  it("generates summary from recorded events", () => {
    let tracker = createProgressTracker("t1", "build");
    tracker = recordProgressEvent(tracker, {
      type: "subtask_completed",
      phase: "build",
      subtask: "lint",
    });
    tracker = recordProgressEvent(tracker, {
      type: "subtask_completed",
      phase: "build",
      subtask: "test",
    });
    tracker = recordProgressEvent(tracker, {
      type: "tool_call",
      phase: "build",
      tool: "npm test",
      success: true,
    });

    const summary = generateProgressSummary(tracker);
    expect(summary.totalEvents).toBe(3);
    expect(summary.completedSubtasks).toContain("lint");
    expect(summary.completedSubtasks).toContain("test");
    expect(summary.successfulTools).toBe(1);
    expect(summary.summary).toBeTruthy();
  });

  it("counts errors separately", () => {
    let tracker = createProgressTracker("t1", "deploy");
    tracker = recordProgressEvent(tracker, {
      type: "error",
      phase: "deploy",
      detail: "timeout",
    });
    tracker = recordProgressEvent(tracker, {
      type: "error",
      phase: "deploy",
      detail: "crash",
    });

    const summary = generateProgressSummary(tracker);
    expect(summary.errors).toBe(2);
  });

  it("returns empty summary for empty tracker", () => {
    const tracker = createProgressTracker("t1", "init");
    const summary = generateProgressSummary(tracker);
    expect(summary.totalEvents).toBe(0);
    expect(summary.completedSubtasks).toHaveLength(0);
  });
});

describe("getPhaseProgress", () => {
  it("returns events filtered by phase", () => {
    let tracker = createProgressTracker("t1", "multi");
    tracker = recordProgressEvent(tracker, {
      type: "subtask_completed",
      phase: "build",
      subtask: "lint",
    });
    tracker = recordProgressEvent(tracker, {
      type: "subtask_completed",
      phase: "deploy",
      subtask: "upload",
    });

    const buildEvents = getPhaseProgress(tracker, "build");
    expect(buildEvents).toHaveLength(1);
    expect(buildEvents[0]!.subtask).toBe("lint");

    const deployEvents = getPhaseProgress(tracker, "deploy");
    expect(deployEvents).toHaveLength(1);
  });

  it("returns empty array for phase with no events", () => {
    const tracker = createProgressTracker("t1", "build");
    expect(getPhaseProgress(tracker, "nonexistent")).toHaveLength(0);
  });
});
