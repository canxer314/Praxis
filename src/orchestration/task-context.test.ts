/**
 * task-context 测试
 *
 * 覆盖: 创建、自动推断、手动更新、过期检测、格式化
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTaskContext,
  applyProgress,
  updateTaskContext,
  isStale,
  formatTaskContext,
} from "./task-context";
import type { TaskContext, InferredProgress } from "./task-context";

// ══════════════════════════════════════════════════════════════════
// createTaskContext
// ══════════════════════════════════════════════════════════════════

describe("createTaskContext", () => {
  it("创建带必填字段的 TaskContext", () => {
    const ctx = createTaskContext({ taskId: "task-1", name: "实现用户登录" });

    expect(ctx.taskId).toBe("task-1");
    expect(ctx.name).toBe("实现用户登录");
    expect(ctx.type).toBe("unknown");
    expect(ctx.currentPhase).toBe("init");
    expect(ctx.progressSummary).toBe("");
    expect(ctx.activeSubtasks).toEqual([]);
    expect(ctx.relevantScenarios).toEqual([]);
    expect(ctx.lastAutoUpdated).toBeNull();
    expect(ctx.createdAt).toBeGreaterThan(0);
  });

  it("创建带可选字段的 TaskContext", () => {
    const ctx = createTaskContext({
      taskId: "task-2",
      name: "API 重构",
      type: "refactor",
      relevantScenarios: ["api_design", "code_review"],
    });

    expect(ctx.type).toBe("refactor");
    expect(ctx.relevantScenarios).toEqual(["api_design", "code_review"]);
  });
});

// ══════════════════════════════════════════════════════════════════
// applyProgress
// ══════════════════════════════════════════════════════════════════

describe("applyProgress", () => {
  let ctx: TaskContext;

  beforeEach(() => {
    ctx = createTaskContext({ taskId: "t1", name: "测试任务" });
  });

  it("高置信度 → 自动应用进度", () => {
    const inferred: InferredProgress = {
      newPhase: "implementation",
      progressUpdate: "已完成 API 层，正在实现数据库层",
      confidence: 0.85,
    };

    const { updated, applied } = applyProgress(ctx, inferred);

    expect(applied).toBe(true);
    expect(updated.currentPhase).toBe("implementation");
    expect(updated.progressSummary).toBe("已完成 API 层，正在实现数据库层");
    expect(updated.lastAutoUpdated).toBeGreaterThan(0);
  });

  it("低置信度 (< 0.7) → 不应用", () => {
    const inferred: InferredProgress = {
      newPhase: "implementation",
      confidence: 0.5,
    };

    const { updated, applied } = applyProgress(ctx, inferred);

    expect(applied).toBe(false);
    expect(updated.currentPhase).toBe("init"); // unchanged
  });

  it("边界: 恰好 0.7 → 应用", () => {
    const inferred: InferredProgress = {
      newPhase: "testing",
      confidence: 0.7,
    };

    const { applied } = applyProgress(ctx, inferred);
    expect(applied).toBe(true);
  });

  it("子任务合并: 添加新 + 移除已完成", () => {
    ctx.activeSubtasks = ["sub-1", "sub-2", "sub-3"];
    const inferred: InferredProgress = {
      newSubtasks: ["sub-4"],
      completedSubtasks: ["sub-1"],
      confidence: 0.8,
    };

    const { updated } = applyProgress(ctx, inferred);

    expect(updated.activeSubtasks).toContain("sub-2");
    expect(updated.activeSubtasks).toContain("sub-3");
    expect(updated.activeSubtasks).toContain("sub-4");
    expect(updated.activeSubtasks).not.toContain("sub-1");
  });

  it("仅部分字段更新（不覆盖未推断字段）", () => {
    ctx.progressSummary = "旧摘要";
    const inferred: InferredProgress = {
      newPhase: "done",
      confidence: 0.9,
    };

    const { updated } = applyProgress(ctx, inferred);

    expect(updated.currentPhase).toBe("done");
    expect(updated.progressSummary).toBe("旧摘要"); // 未被覆盖
  });
});

// ══════════════════════════════════════════════════════════════════
// updateTaskContext
// ══════════════════════════════════════════════════════════════════

describe("updateTaskContext", () => {
  it("手动更新始终应用", () => {
    const ctx = createTaskContext({ taskId: "t1", name: "test" });
    const updated = updateTaskContext(ctx, { currentPhase: "review" });

    expect(updated.currentPhase).toBe("review");
  });
});

// ══════════════════════════════════════════════════════════════════
// isStale
// ══════════════════════════════════════════════════════════════════

describe("isStale", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("刚创建 → 非过期", () => {
    const ctx = createTaskContext({ taskId: "t1", name: "test" });
    expect(isStale(ctx)).toBe(false);
  });

  it("8 天未更新 → 过期", () => {
    const ctx = createTaskContext({ taskId: "t1", name: "test" });
    // 前进 8 天
    vi.setSystemTime(new Date("2026-07-04T00:00:00Z"));
    expect(isStale(ctx)).toBe(true);
  });

  it("最近自动更新过 → 非过期", () => {
    const ctx = createTaskContext({ taskId: "t1", name: "test" });
    const { updated } = applyProgress(ctx, { newPhase: "done", confidence: 0.8 });
    // lastAutoUpdated 在 fake time "now" = 2026-06-26
    vi.setSystemTime(new Date("2026-07-02T00:00:00Z")); // 6 天后
    expect(isStale(updated)).toBe(false);
  });

  it("自定义 maxDays", () => {
    const ctx = createTaskContext({ taskId: "t1", name: "test" });
    vi.setSystemTime(new Date("2026-06-28T00:00:00Z")); // 2 天后
    expect(isStale(ctx, 1)).toBe(true); // 超过 1 天
    expect(isStale(ctx, 7)).toBe(false); // 未超 7 天
  });
});

// ══════════════════════════════════════════════════════════════════
// formatTaskContext
// ══════════════════════════════════════════════════════════════════

describe("formatTaskContext", () => {
  it("格式化完整 TaskContext 为注入文本", () => {
    const ctx = createTaskContext({
      taskId: "t1",
      name: "实现用户认证",
      type: "feature",
      relevantScenarios: ["api_design", "security"],
    });
    const { updated } = applyProgress(ctx, {
      newPhase: "implementation",
      progressUpdate: "JWT 签发已完成，正在实现刷新令牌",
      newSubtasks: ["refresh-token", "password-reset"],
      confidence: 0.9,
    });

    const text = formatTaskContext(updated);

    expect(text).toContain("当前任务上下文");
    expect(text).toContain("实现用户认证");
    expect(text).toContain("feature");
    expect(text).toContain("implementation");
    expect(text).toContain("JWT 签发已完成");
    expect(text).toContain("refresh-token");
    expect(text).toContain("api_design");
  });

  it("最小 TaskContext", () => {
    const ctx = createTaskContext({ taskId: "min", name: "最小任务" });
    const text = formatTaskContext(ctx);

    expect(text).toContain("最小任务");
    expect(text).toContain("init");
    expect(text).not.toContain("活跃子任务");
    expect(text).not.toContain("相关场景");
  });
});
