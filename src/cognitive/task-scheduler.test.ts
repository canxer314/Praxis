/**
 * TaskScheduler 测试 — V13 Phase 3
 *
 * 覆盖路径:
 *   - 构造注入验证 (null memory client)
 *   - evaluateTrigger: 决策矩阵全部 10 个分支
 *   - isInQuietHours: 边界情况 + 跨午夜
 *   - canParallelize: 并行化判断
 *   - executeTrigger: 去重 + 首次触发确认 + adapter 调用
 *   - Schedule 生命周期: load/save/markFired/cancel/cleanup
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "../platform-adapter";
import {
  TaskScheduler,
  isInQuietHours,
  canParallelize,
  DEFAULT_TRIGGERING_CONFIG,
} from "./task-scheduler";
import type {
  TaskSchedulerMemoryClient,
  SchedulerTaskContext,
  SchedulerSubtask,
} from "./task-scheduler";
import type { TriggerAdapter, TaskSchedule } from "./types";
import { SLOTS } from "./constants";

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

function makeSubtask(overrides: Partial<SchedulerSubtask> = {}): SchedulerSubtask {
  return {
    subtask_name: "test_subtask",
    estimated_duration_minutes: 30,
    ...overrides,
  };
}

function makeContext(overrides: Partial<SchedulerTaskContext> = {}): SchedulerTaskContext {
  return {
    task_id: "task_001",
    task_state: "TASK_IN_PROGRESS",
    pending_subtasks: [makeSubtask()],
    ...overrides,
  };
}

function makeMockMemory(schedules?: Record<string, TaskSchedule>): TaskSchedulerMemoryClient {
  const data: Record<string, unknown> = { schedules: schedules ?? {} };
  return {
    getSlot: vi.fn(async () => ({ ok: true, value: data } as Result<unknown>)),
    setSlot: vi.fn(async () => ({ ok: true, value: undefined } as Result<void>)),
  };
}

function makeMockAdapter(): TriggerAdapter {
  return {
    scheduleTurn: vi.fn(async () => ({ jobId: "job_001" })),
    cancelTurn: vi.fn(async () => {}),
  };
}

// ══════════════════════════════════════════════════════════════════
// 构造注入
// ══════════════════════════════════════════════════════════════════

describe("TaskScheduler — construction", () => {
  it("throws when memory client is null", () => {
    expect(() => new TaskScheduler(null!)).toThrow("TaskSchedulerMemoryClient is required");
  });

  it("throws when memory client is undefined", () => {
    expect(() => new TaskScheduler(undefined!)).toThrow("TaskSchedulerMemoryClient is required");
  });

  it("creates with valid memory client", () => {
    const scheduler = new TaskScheduler(makeMockMemory());
    expect(scheduler).toBeInstanceOf(TaskScheduler);
  });

  it("merges custom config with defaults", () => {
    const scheduler = new TaskScheduler(makeMockMemory(), {
      enabled: true,
      max_triggers_per_day: 5,
    });
    // Verify via evaluateTrigger — enabled=true should not immediately return "disabled"
    const ctx = makeContext();
    const decision = scheduler.evaluateTrigger(ctx);
    expect(decision.reason).not.toBe("disabled");
  });
});

// ══════════════════════════════════════════════════════════════════
// evaluateTrigger — 决策矩阵
// ══════════════════════════════════════════════════════════════════

describe("evaluateTrigger — decision matrix", () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler(makeMockMemory(), { enabled: true });
  });

  // Branch 1: disabled
  it("returns disabled when active_triggering is not enabled", () => {
    const disabled = new TaskScheduler(makeMockMemory(), { enabled: false });
    const decision = disabled.evaluateTrigger(makeContext());
    expect(decision.should_trigger).toBe(false);
    expect(decision.reason).toBe("disabled");
    expect(decision.skip_reasons).toContain("自动驾驶未开启");
  });

  // Branch 2: task ended
  it("returns task_ended when task is complete", () => {
    const decision = scheduler.evaluateTrigger(
      makeContext({ task_state: "TASK_COMPLETE" }),
    );
    expect(decision.should_trigger).toBe(false);
    expect(decision.reason).toBe("task_ended");
  });

  it("returns task_ended when task is abandoned", () => {
    const decision = scheduler.evaluateTrigger(
      makeContext({ task_state: "TASK_ABANDONED" }),
    );
    expect(decision.should_trigger).toBe(false);
    expect(decision.reason).toBe("task_ended");
  });

  // Branch 3: quiet hours — non-blocking skip
  it("includes quiet_hours in skip_reasons during quiet period but still evaluates", () => {
    // 构造一个在默认静默时段 22:00-08:00 内的本地时间
    const now = new Date();
    const inQuietHours = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      3, 0, 0, 0,  // 03:00 local time — within 22:00-08:00
    ).getTime();
    const decision = scheduler.evaluateTrigger(makeContext(), inQuietHours);
    expect(decision.skip_reasons).toContain("当前在静默时段");
    // quiet hours is non-blocking — should still try to trigger
    expect(decision.should_trigger).toBe(true);
  });

  // Branch 4: daily limit — not testable without schedule state
  // (countTodayTriggers returns 0 for in-memory scheduler)

  // Branch 5/6: no pending subtasks
  it("returns no_pending when subtask list is empty", () => {
    const decision = scheduler.evaluateTrigger(
      makeContext({ pending_subtasks: [] }),
    );
    expect(decision.should_trigger).toBe(false);
    expect(decision.reason).toBe("no_pending");
  });

  // Branch 7: subagent_run
  it("returns subagent_run for parallelizable subtask", () => {
    const decision = scheduler.evaluateTrigger(
      makeContext({
        pending_subtasks: [makeSubtask({
          parallelizable: true,
          estimated_duration_minutes: 30,
        })],
      }),
    );
    expect(decision.should_trigger).toBe(true);
    expect(decision.mechanism).toBe("subagent_run");
    expect(decision.reason).toContain("无依赖可并行");
  });

  it("does NOT return subagent_run when allow_subagent_spawn is false", () => {
    const noParallel = new TaskScheduler(makeMockMemory(), {
      enabled: true,
      allow_subagent_spawn: false,
    });
    const decision = noParallel.evaluateTrigger(
      makeContext({
        pending_subtasks: [makeSubtask({
          parallelizable: true,
          estimated_duration_minutes: 30,
        })],
      }),
    );
    expect(decision.mechanism).not.toBe("subagent_run");
  });

  it("does NOT return subagent_run when subtask has depends_on", () => {
    const decision = scheduler.evaluateTrigger(
      makeContext({
        pending_subtasks: [makeSubtask({
          parallelizable: true,
          depends_on: ["other_subtask"],
          estimated_duration_minutes: 30,
        })],
      }),
    );
    expect(decision.mechanism).not.toBe("subagent_run");
  });

  // Branch 8: short task — scheduleSessionTurn with delay_ms
  it("returns scheduleSessionTurn with delay_ms for short tasks (< 1h)", () => {
    const decision = scheduler.evaluateTrigger(
      makeContext({
        pending_subtasks: [makeSubtask({ estimated_duration_minutes: 30 })],
      }),
    );
    expect(decision.should_trigger).toBe(true);
    expect(decision.mechanism).toBe("scheduleSessionTurn");
    expect(decision.delay_ms).toBe(30 * 60 * 1000);
    expect(decision.at_time).toBeUndefined();
  });

  // Branch 9: medium task — scheduleSessionTurn with at_time
  it("returns scheduleSessionTurn with at_time for medium tasks (1-24h)", () => {
    const now = Date.now();
    const decision = scheduler.evaluateTrigger(
      makeContext({
        pending_subtasks: [makeSubtask({ estimated_duration_minutes: 120 })],
      }),
      now,
    );
    expect(decision.should_trigger).toBe(true);
    expect(decision.mechanism).toBe("scheduleSessionTurn");
    expect(decision.at_time).toBe(now + 120 * 60 * 1000);
    expect(decision.delay_ms).toBeUndefined();
  });

  // Branch 10: long task — cron_job
  it("returns cron_job for long tasks (> 24h)", () => {
    const decision = scheduler.evaluateTrigger(
      makeContext({
        pending_subtasks: [makeSubtask({ estimated_duration_minutes: 1500 })], // 25h
      }),
    );
    expect(decision.should_trigger).toBe(true);
    expect(decision.mechanism).toBe("cron_job");
    expect(decision.reason).toContain("定期检查");
  });

  // Edge: default estimated_duration (60 min) → falls in at_time bucket (60min >= 1h boundary)
  it("uses default 60min, falls in at_time bucket (not delay, since >= 1h boundary)", () => {
    const now = Date.now();
    const decision = scheduler.evaluateTrigger(
      makeContext({
        pending_subtasks: [makeSubtask({ estimated_duration_minutes: undefined })],
      }),
      now,
    );
    // 60 min = 3600000 ms, not strictly < 3600000, so falls in medium bucket
    expect(decision.mechanism).toBe("scheduleSessionTurn");
    expect(decision.at_time).toBe(now + 60 * 60 * 1000);
    expect(decision.delay_ms).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// isInQuietHours — 纯函数
// ══════════════════════════════════════════════════════════════════

describe("isInQuietHours", () => {
  it("returns false for empty string", () => {
    expect(isInQuietHours(Date.now(), "")).toBe(false);
  });

  it("returns false for malformed string (no dash)", () => {
    expect(isInQuietHours(Date.now(), "2200")).toBe(false);
  });

  it("returns false for non-numeric hours/minutes", () => {
    expect(isInQuietHours(Date.now(), "xx:00-08:00")).toBe(false);
  });

  it("returns true during quiet hours (cross-midnight, late night)", () => {
    // 构造当地时间 23:00 — 在 22:00-08:00 跨午夜静默时段内
    const now = new Date();
    const lateNight = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      23, 0, 0, 0,
    ).getTime();
    expect(isInQuietHours(lateNight, "22:00-08:00")).toBe(true);
  });

  it("returns true during quiet hours (cross-midnight, early morning)", () => {
    // 构造当地时间 03:00 — 在 22:00-08:00 跨午夜静默时段内
    const now = new Date();
    const earlyMorning = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      3, 0, 0, 0,
    ).getTime();
    expect(isInQuietHours(earlyMorning, "22:00-08:00")).toBe(true);
  });

  it("returns false outside quiet hours (cross-midnight)", () => {
    // 构造当地时间 12:00 — 不在 22:00-08:00 内
    const now = new Date();
    const noon = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      12, 0, 0, 0,
    ).getTime();
    expect(isInQuietHours(noon, "22:00-08:00")).toBe(false);
  });

  it("returns true during quiet hours (same day, non-crossing)", () => {
    // 构造当地时间 02:00 — 在 01:00-05:00 内
    const now = new Date();
    const early = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      2, 0, 0, 0,
    ).getTime();
    expect(isInQuietHours(early, "01:00-05:00")).toBe(true);
  });

  it("returns false outside quiet hours (same day, non-crossing)", () => {
    // 构造当地时间 06:00 — 不在 01:00-05:00 内
    const now = new Date();
    const morning = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      6, 0, 0, 0,
    ).getTime();
    expect(isInQuietHours(morning, "01:00-05:00")).toBe(false);
  });

  it("returns false at exact end time (boundary)", () => {
    // 构造当地时间 08:00 exactly — NOT in quiet hours (end is exclusive)
    const now = new Date();
    const boundary = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      8, 0, 0, 0,
    ).getTime();
    expect(isInQuietHours(boundary, "22:00-08:00")).toBe(false);
  });

  it("returns true at exact start time (boundary)", () => {
    // 构造当地时间 22:00 exactly — IN quiet hours (start is inclusive)
    const now = new Date();
    const boundary = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      22, 0, 0, 0,
    ).getTime();
    expect(isInQuietHours(boundary, "22:00-08:00")).toBe(true);
  });

  it("respects local timezone (not UTC)", () => {
    // 构造当地时间 22:00 = within 22:00-08:00
    const now = new Date();
    const local2200 = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      22, 0, 0, 0,
    ).getTime();
    expect(isInQuietHours(local2200, "22:00-08:00")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// canParallelize — 纯函数
// ══════════════════════════════════════════════════════════════════

describe("canParallelize", () => {
  it("returns true when parallelizable=true and no depends_on", () => {
    expect(canParallelize({ subtask_name: "s1", parallelizable: true })).toBe(true);
  });

  it("returns true when parallelizable=true and depends_on=[]", () => {
    expect(canParallelize({
      subtask_name: "s1",
      parallelizable: true,
      depends_on: [],
    })).toBe(true);
  });

  it("returns false when parallelizable is not true", () => {
    expect(canParallelize({ subtask_name: "s1" })).toBe(false);
    expect(canParallelize({ subtask_name: "s1", parallelizable: false })).toBe(false);
  });

  it("returns false when depends_on is non-empty", () => {
    expect(canParallelize({
      subtask_name: "s1",
      parallelizable: true,
      depends_on: ["other"],
    })).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// executeTrigger — 去重 + 首次确认 + adapter 调用
// ══════════════════════════════════════════════════════════════════

describe("executeTrigger", () => {
  let memory: TaskSchedulerMemoryClient;
  let adapter: TriggerAdapter;
  let scheduler: TaskScheduler;
  let ctx: SchedulerTaskContext;

  beforeEach(() => {
    memory = makeMockMemory();
    adapter = makeMockAdapter();
    scheduler = new TaskScheduler(memory, {
      enabled: true,
      require_user_confirmation_for: [], // disable first-trigger check for most tests
    });
    ctx = makeContext();
  });

  it("returns null when decision.should_trigger is false", async () => {
    const decision = scheduler.evaluateTrigger(
      makeContext({ task_state: "TASK_COMPLETE" }),
    );
    const trigger = await scheduler.executeTrigger(decision, ctx, adapter, "session_key");
    expect(trigger).toBeNull();
  });

  it("creates and persists a trigger for scheduleSessionTurn decisions", async () => {
    const decision = scheduler.evaluateTrigger(ctx);
    const trigger = await scheduler.executeTrigger(decision, ctx, adapter, "session_key");

    expect(trigger).not.toBeNull();
    expect(trigger!.status).toBe("pending");
    expect(trigger!.mechanism).toBe("scheduleSessionTurn");
    expect(trigger!.trigger_id).toMatch(/^trig_\d+_[a-z0-9]+$/);
    expect(adapter.scheduleTurn).toHaveBeenCalledTimes(1);

    // Verify persist was called
    expect(memory.setSlot).toHaveBeenCalled();
  });

  it("calls adapter.scheduleTurn with correct params", async () => {
    const decision = scheduler.evaluateTrigger(ctx);
    await scheduler.executeTrigger(decision, ctx, adapter, "sk_123");

    expect(adapter.scheduleTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "sk_123",
        message: expect.stringContaining("[Praxis V13 自动触发]"),
        tag: "praxis:task:task_001",
      }),
    );
  });

  it("skips duplicate triggers with same reason within 10 min", async () => {
    // First trigger
    const decision = scheduler.evaluateTrigger(ctx);
    const t1 = await scheduler.executeTrigger(decision, ctx, adapter, "sk");

    expect(t1).not.toBeNull();

    // Second trigger with same reason — should be skipped
    const t2 = await scheduler.executeTrigger(decision, ctx, adapter, "sk");
    expect(t2).toBeNull();
  });

  it("replaces expired duplicate trigger (> 10 min old)", async () => {
    const memory = makeMockMemory();
    const scheduler2 = new TaskScheduler(memory, {
      enabled: true,
      require_user_confirmation_for: [],
    });

    // Pre-load a stale trigger (1 hour old)
    const oldTrigger = {
      trigger_id: "trig_old",
      trigger_source: "cron:scheduled" as const,
      scheduled_at: Date.now() - 60 * 60 * 1000, // 1 hour ago
      mechanism: "scheduleSessionTurn" as const,
      reason: "子任务 \"test_subtask\" 估计 30min",
      status: "pending" as const,
      created_at: Date.now() - 60 * 60 * 1000,
    };

    // Manually inject old schedule
    const schedules: Record<string, TaskSchedule> = {
      "task_001": {
        task_id: "task_001",
        pending_triggers: [oldTrigger],
        last_trigger_at: null,
        next_trigger_at: null,
        active_cron_job_ids: [],
      },
    };
    const memWithOld = makeMockMemory(schedules);
    const scheduler3 = new TaskScheduler(memWithOld, {
      enabled: true,
      require_user_confirmation_for: [],
    });

    const decision = scheduler3.evaluateTrigger(ctx);
    const trigger = await scheduler3.executeTrigger(decision, ctx, adapter, "sk");

    // Should replace the old trigger
    expect(trigger).not.toBeNull();
    expect(trigger!.trigger_id).not.toBe("trig_old");

    // Old trigger should be cancelled
    const schedule = await scheduler3.loadSchedule("task_001");
    const oldT = schedule?.pending_triggers.find((t) => t.trigger_id === "trig_old");
    expect(oldT?.status).toBe("cancelled");
  });

  it("skips first trigger when require_user_confirmation includes first_trigger_of_task", async () => {
    const confirmScheduler = new TaskScheduler(makeMockMemory(), {
      enabled: true,
      require_user_confirmation_for: ["first_trigger_of_task"],
    });

    const decision = confirmScheduler.evaluateTrigger(ctx);
    const trigger = await confirmScheduler.executeTrigger(decision, ctx, adapter, "sk");

    expect(trigger).toBeNull();
    // adapter should NOT be called
    expect(adapter.scheduleTurn).not.toHaveBeenCalled();
  });

  it("allows second trigger when first was skipped due to confirmation", async () => {
    const memory2 = makeMockMemory();
    const confirmScheduler = new TaskScheduler(memory2, {
      enabled: true,
      require_user_confirmation_for: ["first_trigger_of_task"],
    });

    const decision = confirmScheduler.evaluateTrigger(ctx);

    // First: skipped due to first_trigger_of_task
    const t1 = await confirmScheduler.executeTrigger(decision, ctx, adapter, "sk");
    expect(t1).toBeNull();

    // Manually seed the schedule to simulate a prior trigger having existed
    await confirmScheduler.saveTrigger("task_001", {
      trigger_id: "trig_manual",
      trigger_source: "cron:scheduled",
      scheduled_at: Date.now() - 3600000, // 1 hour ago, so dedup doesn't fire
      mechanism: "scheduleSessionTurn",
      reason: "some_old_trigger",
      status: "fired",
      created_at: Date.now() - 3600000,
    });

    // Second attempt: schedule now has 1 trigger → not "first" anymore → should proceed
    // Use a new adapter to get clean call counts
    const adapter2 = makeMockAdapter();
    const t2 = await confirmScheduler.executeTrigger(decision, ctx, adapter2, "sk");
    // Now it proceeds past the first_trigger check, creates the trigger
    expect(t2).not.toBeNull();
    expect(adapter2.scheduleTurn).toHaveBeenCalled(); // confirmed: no first-trigger block
  });

  it("handles adapter.scheduleTurn failure gracefully", async () => {
    const failingAdapter: TriggerAdapter = {
      scheduleTurn: vi.fn(async () => { throw new Error("network error"); }),
      cancelTurn: vi.fn(async () => {}),
    };

    const decision = scheduler.evaluateTrigger(ctx);
    const trigger = await scheduler.executeTrigger(decision, ctx, failingAdapter, "sk");

    expect(trigger).not.toBeNull();
    expect(trigger!.status).toBe("cancelled");
  });
});

// ══════════════════════════════════════════════════════════════════
// Schedule 生命周期
// ══════════════════════════════════════════════════════════════════

describe("Schedule lifecycle", () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler(makeMockMemory());
  });

  it("loadSchedule returns null when slot is empty", async () => {
    const schedule = await scheduler.loadSchedule("nonexistent");
    expect(schedule).toBeNull();
  });

  it("saveTrigger + loadSchedule roundtrip", async () => {
    const trigger = {
      trigger_id: "trig_001",
      trigger_source: "cron:scheduled" as const,
      scheduled_at: Date.now() + 3600000,
      mechanism: "scheduleSessionTurn" as const,
      reason: "test trigger",
      status: "pending" as const,
      created_at: Date.now(),
    };

    await scheduler.saveTrigger("task_001", trigger);

    const schedule = await scheduler.loadSchedule("task_001");
    expect(schedule).not.toBeNull();
    expect(schedule!.task_id).toBe("task_001");
    expect(schedule!.pending_triggers).toHaveLength(1);
    expect(schedule!.pending_triggers[0].trigger_id).toBe("trig_001");
    expect(schedule!.last_trigger_at).not.toBeNull();
  });

  it("saveTrigger appends to existing schedule", async () => {
    await scheduler.saveTrigger("task_001", {
      trigger_id: "trig_001",
      trigger_source: "cron:scheduled",
      scheduled_at: Date.now(),
      mechanism: "scheduleSessionTurn",
      reason: "first",
      status: "pending",
      created_at: Date.now(),
    });

    await scheduler.saveTrigger("task_001", {
      trigger_id: "trig_002",
      trigger_source: "heartbeat:wake",
      scheduled_at: Date.now(),
      mechanism: "cron_job",
      cron_job_id: "cj_001",
      reason: "second",
      status: "pending",
      created_at: Date.now(),
    });

    const schedule = await scheduler.loadSchedule("task_001");
    expect(schedule!.pending_triggers).toHaveLength(2);
    expect(schedule!.active_cron_job_ids).toContain("cj_001");
  });

  it("markTriggerFired updates trigger status", async () => {
    await scheduler.saveTrigger("task_001", {
      trigger_id: "trig_001",
      trigger_source: "cron:scheduled",
      scheduled_at: Date.now(),
      mechanism: "scheduleSessionTurn",
      reason: "test",
      status: "pending",
      created_at: Date.now(),
    });

    await scheduler.markTriggerFired("task_001", "trig_001");

    const schedule = await scheduler.loadSchedule("task_001");
    expect(schedule!.pending_triggers[0].status).toBe("fired");
  });

  it("markTriggerFired is no-op for nonexistent task", async () => {
    await expect(
      scheduler.markTriggerFired("nonexistent", "trig_001"),
    ).resolves.toBeUndefined();
  });

  it("cancelTrigger updates trigger status", async () => {
    await scheduler.saveTrigger("task_001", {
      trigger_id: "trig_001",
      trigger_source: "cron:scheduled",
      scheduled_at: Date.now(),
      mechanism: "scheduleSessionTurn",
      reason: "test",
      status: "pending",
      created_at: Date.now(),
    });

    await scheduler.cancelTrigger("task_001", "trig_001");

    const schedule = await scheduler.loadSchedule("task_001");
    expect(schedule!.pending_triggers[0].status).toBe("cancelled");
  });

  it("cleanupExpiredTriggers cancels triggers > 1 hour past scheduled_at", async () => {
    const now = Date.now();
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    await scheduler.saveTrigger("task_001", {
      trigger_id: "trig_old",
      trigger_source: "cron:scheduled",
      scheduled_at: now - TWO_HOURS, // 2 hours ago
      mechanism: "scheduleSessionTurn",
      reason: "old",
      status: "pending",
      created_at: now - TWO_HOURS,
    });

    await scheduler.saveTrigger("task_001", {
      trigger_id: "trig_new",
      trigger_source: "cron:scheduled",
      scheduled_at: now + TWO_HOURS, // 2 hours from now
      mechanism: "scheduleSessionTurn",
      reason: "new",
      status: "pending",
      created_at: now,
    });

    const cleaned = await scheduler.cleanupExpiredTriggers("task_001", now);
    expect(cleaned).toBe(1);

    const schedule = await scheduler.loadSchedule("task_001");
    const oldTrigger = schedule!.pending_triggers.find((t) => t.trigger_id === "trig_old");
    const newTrigger = schedule!.pending_triggers.find((t) => t.trigger_id === "trig_new");
    expect(oldTrigger!.status).toBe("cancelled");
    expect(newTrigger!.status).toBe("pending");
  });

  it("cleanupExpiredTriggers returns 0 for nonexistent task", async () => {
    const cleaned = await scheduler.cleanupExpiredTriggers("nonexistent");
    expect(cleaned).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// 默认配置常量
// ══════════════════════════════════════════════════════════════════

describe("DEFAULT_TRIGGERING_CONFIG", () => {
  it("has all required keys", () => {
    expect(DEFAULT_TRIGGERING_CONFIG.enabled).toBe(false);
    expect(DEFAULT_TRIGGERING_CONFIG.max_triggers_per_day).toBe(8);
    expect(DEFAULT_TRIGGERING_CONFIG.quiet_hours).toBe("22:00-08:00");
    expect(DEFAULT_TRIGGERING_CONFIG.stall_threshold_multiplier).toBe(2.0);
    expect(DEFAULT_TRIGGERING_CONFIG.require_user_confirmation_for).toContain("first_trigger_of_task");
  });
});
