/**
 * HeartbeatMonitor 测试 — V13 Phase 3c: Active Driving
 *
 * 覆盖路径:
 *   - 构造注入验证
 *   - runHeartbeatCheck: disabled / normal / running_long / stalled / 混合
 *   - handleStalledTasks: nudge (活跃 session) / wake (无 session) / escalate (>24h)
 *   - 防重复介入 (1h 内已有 nudge → 跳过)
 *   - 错误隔离 (单任务失败不影响其他)
 *   - Persistence: loadHeartbeatState / saveHeartbeatState / saveIntervention
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "../platform-adapter";
import {
  HeartbeatMonitor,
} from "./heartbeat-monitor";
import type {
  HeartbeatMemoryClient,
  HeartbeatTaskContext,
  HeartbeatCheckResult,
  StallInterventionCallback,
} from "./heartbeat-monitor";
import type { ActiveTriggeringConfig, HeartbeatState } from "./types";
import { DEFAULT_TRIGGERING_CONFIG } from "./task-scheduler";
import { SLOTS } from "./constants";

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

function makeConfig(overrides: Partial<ActiveTriggeringConfig> = {}): ActiveTriggeringConfig {
  return {
    ...DEFAULT_TRIGGERING_CONFIG,
    allow_heartbeat_monitor: true,
    stall_threshold_multiplier: 2.0,
    auto_cancel_stalled_after_hours: 24,
    ...overrides,
  };
}

function makeTask(overrides: Partial<HeartbeatTaskContext> = {}): HeartbeatTaskContext {
  return {
    task_id: "task_001",
    task_state: "TASK_IN_PROGRESS",
    subtask_id: "sub_001",
    subtask_name: "测试子任务",
    started_at: Date.now() - 10 * 60 * 1000, // 10 min ago
    estimated_duration_minutes: 60, // 1 hour estimated
    has_active_session: false,
    ...overrides,
  };
}

function makeMockMemory(states?: Record<string, HeartbeatState>): HeartbeatMemoryClient {
  const data: Record<string, unknown> = { states: states ?? {} };
  return {
    getSlot: vi.fn(async () => ({ ok: true, value: data } as Result<unknown>)),
    setSlot: vi.fn(async () => ({ ok: true, value: undefined } as Result<void>)),
  };
}

function makeMockIntervention(): StallInterventionCallback {
  return {
    nudge: vi.fn(async () => {}),
    wake: vi.fn(async () => {}),
    escalate: vi.fn(async () => {}),
  };
}

// ══════════════════════════════════════════════════════════════════
// 构造注入
// ══════════════════════════════════════════════════════════════════

describe("HeartbeatMonitor — construction", () => {
  it("throws when memory client is null", () => {
    expect(() => new HeartbeatMonitor(null!, makeConfig())).toThrow("HeartbeatMemoryClient is required");
  });

  it("throws when config is null", () => {
    expect(() => new HeartbeatMonitor(makeMockMemory(), null!)).toThrow("ActiveTriggeringConfig is required");
  });

  it("creates with valid deps", () => {
    const monitor = new HeartbeatMonitor(makeMockMemory(), makeConfig());
    expect(monitor).toBeInstanceOf(HeartbeatMonitor);
  });
});

// ══════════════════════════════════════════════════════════════════
// runHeartbeatCheck
// ══════════════════════════════════════════════════════════════════

describe("runHeartbeatCheck", () => {
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    monitor = new HeartbeatMonitor(makeMockMemory(), makeConfig());
  });

  it("returns empty when heartbeat monitor is disabled", async () => {
    const disabled = new HeartbeatMonitor(
      makeMockMemory(),
      makeConfig({ allow_heartbeat_monitor: false }),
    );
    const results = await disabled.runHeartbeatCheck([makeTask()]);
    expect(results).toHaveLength(0);
  });

  it("returns normal when elapsed < estimated", async () => {
    const task = makeTask({
      started_at: Date.now() - 10 * 60 * 1000, // 10 min
      estimated_duration_minutes: 60, // 60 min estimated
    });
    const results = await monitor.runHeartbeatCheck([task]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("normal");
    expect(results[0].elapsed_ms).toBeGreaterThan(0);
    expect(results[0].estimated_ms).toBe(60 * 60 * 1000);
  });

  it("returns running_long when elapsed >= estimated but < stall_threshold", async () => {
    const task = makeTask({
      started_at: Date.now() - 90 * 60 * 1000, // 90 min ago
      estimated_duration_minutes: 60, // 60 min estimated
    });
    // estimated = 60min, stall = 60 * 2 = 120min, elapsed = 90min → running_long
    const results = await monitor.runHeartbeatCheck([task]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("running_long");
  });

  it("returns stalled when elapsed >= stall_threshold", async () => {
    const task = makeTask({
      started_at: Date.now() - 150 * 60 * 1000, // 150 min ago
      estimated_duration_minutes: 60, // 60 min estimated, stall = 120 min
    });
    // elapsed = 150min >= stall 120min → stalled
    const results = await monitor.runHeartbeatCheck([task]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("stalled");
  });

  it("handles mixed status across multiple tasks", async () => {
    const now = Date.now();
    const tasks: HeartbeatTaskContext[] = [
      makeTask({ task_id: "t1", subtask_id: "s1", started_at: now - 10 * 60 * 1000, estimated_duration_minutes: 60 }), // normal
      makeTask({ task_id: "t2", subtask_id: "s2", started_at: now - 90 * 60 * 1000, estimated_duration_minutes: 60 }), // running_long
      makeTask({ task_id: "t3", subtask_id: "s3", started_at: now - 200 * 60 * 1000, estimated_duration_minutes: 60 }), // stalled
    ];

    const results = await monitor.runHeartbeatCheck(tasks);
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.task_id === "t1")!.status).toBe("normal");
    expect(results.find((r) => r.task_id === "t2")!.status).toBe("running_long");
    expect(results.find((r) => r.task_id === "t3")!.status).toBe("stalled");
  });

  it("isolates errors — one failing task does not block others", async () => {
    const badTask = makeTask({
      task_id: "bad",
      started_at: NaN, // will cause calculation issues
    });
    const goodTask = makeTask({ task_id: "good" });

    const results = await monitor.runHeartbeatCheck([badTask, goodTask]);
    // good task should still be checked
    expect(results.some((r) => r.task_id === "good")).toBe(true);
  });

  it("updates heartbeat count on each check", async () => {
    const memory = makeMockMemory();
    const m = new HeartbeatMonitor(memory, makeConfig());
    const task = makeTask();

    await m.runHeartbeatCheck([task]);
    await m.runHeartbeatCheck([task]);

    // Verify heartbeat state was saved with count=2
    const state = await m.loadHeartbeatState(task.task_id, task.subtask_id);
    expect(state).not.toBeNull();
    expect(state!.heartbeat_count).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════
// handleStalledTasks — 分级响应
// ══════════════════════════════════════════════════════════════════

describe("handleStalledTasks", () => {
  let monitor: HeartbeatMonitor;
  let intervention: StallInterventionCallback;

  beforeEach(() => {
    monitor = new HeartbeatMonitor(makeMockMemory(), makeConfig());
    intervention = makeMockIntervention();
  });

  it("nudges when task has active session", async () => {
    const now = Date.now();
    const task = makeTask({
      task_id: "t1",
      subtask_id: "s1",
      subtask_name: "卡住的子任务",
      started_at: now - 200 * 60 * 1000, // 200 min ago → stalled
      estimated_duration_minutes: 60,
      has_active_session: true,
    });

    const results = await monitor.runHeartbeatCheck([task]);
    const stalled = results.filter((r) => r.status === "stalled");
    expect(stalled).toHaveLength(1);

    await monitor.handleStalledTasks(stalled, [task], intervention);

    expect(intervention.nudge).toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("Praxis V13"),
    );
    expect(intervention.wake).not.toHaveBeenCalled();
    expect(intervention.escalate).not.toHaveBeenCalled();
  });

  it("wakes when task has no active session and within cancel threshold", async () => {
    const now = Date.now();
    const task = makeTask({
      task_id: "t2",
      subtask_id: "s2",
      started_at: now - 200 * 60 * 1000, // 200 min → stalled but < 24h
      estimated_duration_minutes: 60,
      has_active_session: false,
    });

    const results = await monitor.runHeartbeatCheck([task]);
    const stalled = results.filter((r) => r.status === "stalled");
    await monitor.handleStalledTasks(stalled, [task], intervention);

    expect(intervention.nudge).not.toHaveBeenCalled();
    expect(intervention.wake).toHaveBeenCalledWith(
      "t2",
      expect.stringContaining("运行超过预期"),
    );
    expect(intervention.escalate).not.toHaveBeenCalled();
  });

  it("escalates when stalled beyond auto_cancel_stalled_after_hours", async () => {
    const now = Date.now();
    const task = makeTask({
      task_id: "t3",
      subtask_id: "s3",
      // 25 hours ago → beyond 24h cancel threshold
      started_at: now - 25 * 60 * 60 * 1000,
      estimated_duration_minutes: 60,
      has_active_session: false,
    });

    const results = await monitor.runHeartbeatCheck([task]);
    const stalled = results.filter((r) => r.status === "stalled");
    await monitor.handleStalledTasks(stalled, [task], intervention);

    expect(intervention.escalate).toHaveBeenCalledWith(
      "t3",
      "s3",
      expect.stringContaining("超过自动取消阈值"),
    );
  });

  it("skips nudge if one was sent within the last hour", async () => {
    const now = Date.now();
    const task = makeTask({
      task_id: "t4",
      subtask_id: "s4",
      started_at: now - 200 * 60 * 1000,
      estimated_duration_minutes: 60,
      has_active_session: true,
    });

    // Pre-load a recent nudge intervention
    const state: HeartbeatState = {
      task_id: "t4",
      subtask_id: "s4",
      subtask_started_at: task.started_at,
      estimated_duration_ms: 60 * 60 * 1000,
      last_progress_at: now,
      stall_threshold_ms: 120 * 60 * 1000,
      heartbeat_count: 1,
      interventions: [
        {
          triggered_at: now - 30 * 60 * 1000, // 30 min ago
          type: "nudge",
          reason: "previous nudge",
          action: "request_heartbeat",
        },
      ],
    };

    const memory = makeMockMemory({ "t4::s4": state });
    const m = new HeartbeatMonitor(memory, makeConfig());

    const results = await m.runHeartbeatCheck([task]);
    const stalled = results.filter((r) => r.status === "stalled");
    await m.handleStalledTasks(stalled, [task], intervention);

    // Should skip the nudge (already sent within 1h)
    expect(intervention.nudge).not.toHaveBeenCalled();
    expect(intervention.wake).not.toHaveBeenCalled();
    expect(intervention.escalate).not.toHaveBeenCalled();
  });

  it("handles intervention callback errors gracefully", async () => {
    const now = Date.now();
    const task = makeTask({
      task_id: "t5",
      subtask_id: "s5",
      started_at: now - 200 * 60 * 1000,
      estimated_duration_minutes: 60,
      has_active_session: true,
    });

    const brokenIntervention: StallInterventionCallback = {
      nudge: vi.fn(async () => { throw new Error("rpc error"); }),
      wake: vi.fn(async () => {}),
      escalate: vi.fn(async () => {}),
    };

    const results = await monitor.runHeartbeatCheck([task]);
    const stalled = results.filter((r) => r.status === "stalled");

    // Should not throw
    await expect(
      monitor.handleStalledTasks(stalled, [task], brokenIntervention),
    ).resolves.toBeUndefined();
  });

  it("is no-op when stalled results list is empty", async () => {
    await monitor.handleStalledTasks([], [], intervention);
    expect(intervention.nudge).not.toHaveBeenCalled();
    expect(intervention.wake).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
// Persistence
// ══════════════════════════════════════════════════════════════════

describe("Persistence", () => {
  it("loadHeartbeatState returns null when slot is empty", async () => {
    const memory = makeMockMemory();
    memory.getSlot = vi.fn(async () => ({ ok: false, error: { code: "NOT_FOUND", message: "nope" } }));
    const monitor = new HeartbeatMonitor(memory, makeConfig());

    const state = await monitor.loadHeartbeatState("task_001", "sub_001");
    expect(state).toBeNull();
  });

  it("loadHeartbeatState returns null for unknown key", async () => {
    const monitor = new HeartbeatMonitor(makeMockMemory(), makeConfig());
    const state = await monitor.loadHeartbeatState("unknown", "unknown");
    expect(state).toBeNull();
  });

  it("loadHeartbeatState + runHeartbeatCheck roundtrip", async () => {
    const memory = makeMockMemory();
    const monitor = new HeartbeatMonitor(memory, makeConfig());
    const task = makeTask();

    await monitor.runHeartbeatCheck([task]);

    const state = await monitor.loadHeartbeatState(task.task_id, task.subtask_id);
    expect(state).not.toBeNull();
    expect(state!.task_id).toBe("task_001");
    expect(state!.subtask_id).toBe("sub_001");
    expect(state!.heartbeat_count).toBe(1);
    expect(state!.interventions).toHaveLength(0);
  });

  it("persists interventions after handleStalledTasks", async () => {
    const memory = makeMockMemory();
    const monitor = new HeartbeatMonitor(memory, makeConfig());
    const intervention = makeMockIntervention();
    const now = Date.now();
    const task = makeTask({
      started_at: now - 200 * 60 * 1000,
      estimated_duration_minutes: 60,
      has_active_session: true,
    });

    const results = await monitor.runHeartbeatCheck([task]);
    const stalled = results.filter((r) => r.status === "stalled");
    await monitor.handleStalledTasks(stalled, [task], intervention);

    const state = await monitor.loadHeartbeatState(task.task_id, task.subtask_id);
    expect(state).not.toBeNull();
    expect(state!.interventions).toHaveLength(1);
    expect(state!.interventions[0].type).toBe("nudge");
  });
});
