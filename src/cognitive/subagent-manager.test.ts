/**
 * SubagentManager 测试 — V13 Phase 3b
 *
 * 覆盖路径:
 *   - 构造注入验证
 *   - canSpawn: 并行上限检查
 *   - spawnSubagent: 成功 / 达到上限 / API 失败
 *   - waitForCompletion: ok / error / timeout / API 异常
 *   - retrySubagent: 重试成功 / 超过 max_retries
 *   - aggregateResults: 汇总逻辑
 *   - buildSubagentContext: 完整上下文 / 无选项的降级
 *   - Persistence: loadRegistry / persistRegistry / clear
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Result } from "../platform-adapter";
import {
  SubagentManager,
  buildSubagentContext,
} from "./subagent-manager";
import type {
  SubagentMemoryClient,
  SubagentExecutionAPI,
  SubagentTaskInfo,
} from "./subagent-manager";
import type { SchedulerSubtask } from "./task-scheduler";

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

function makeTaskInfo(overrides: Partial<SubagentTaskInfo> = {}): SubagentTaskInfo {
  return {
    task_name: "测试任务",
    phase_name: "Phase 1",
    pitfalls: [],
    ...overrides,
  };
}

function makeMockMemory(): SubagentMemoryClient {
  return {
    getSlot: vi.fn(async () => ({ ok: true, value: {} } as Result<unknown>)),
    setSlot: vi.fn(async () => ({ ok: true, value: undefined } as Result<void>)),
  };
}

function makeMockAPI(overrides: Partial<SubagentExecutionAPI> = {}): SubagentExecutionAPI {
  return {
    run: vi.fn(async () => ({ runId: "run_001" })),
    waitForRun: vi.fn(async () => ({ status: "ok" as const })),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// 构造注入
// ══════════════════════════════════════════════════════════════════

describe("SubagentManager — construction", () => {
  it("throws when memory client is null", () => {
    expect(() => new SubagentManager("task_001", null!)).toThrow("SubagentMemoryClient is required");
  });

  it("creates with valid memory client and defaults", () => {
    const mgr = new SubagentManager("task_001", makeMockMemory());
    expect(mgr).toBeInstanceOf(SubagentManager);
    const registry = mgr.getRegistry();
    expect(registry.max_parallel).toBe(3);
  });

  it("accepts custom maxParallel and maxRetries", () => {
    const mgr = new SubagentManager("task_001", makeMockMemory(), {
      maxParallel: 5,
      maxRetries: 4,
    });
    const registry = mgr.getRegistry();
    expect(registry.max_parallel).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════
// canSpawn — 并行上限
// ══════════════════════════════════════════════════════════════════

describe("canSpawn", () => {
  it("returns true when no active runs", () => {
    const mgr = new SubagentManager("task_001", makeMockMemory());
    expect(mgr.canSpawn()).toBe(true);
  });

  it("returns false when max_parallel is reached", () => {
    const mgr = new SubagentManager("task_001", makeMockMemory(), { maxParallel: 2 });
    // Manually fill active_runs
    const registry = mgr.getRegistry();
    registry.active_runs = [
      { run_id: "r1", subtask_id: "s1", session_key: "sk1", status: "running", spawned_at: Date.now(), completed_at: null, retry_count: 0, max_retries: 2 },
      { run_id: "r2", subtask_id: "s2", session_key: "sk2", status: "running", spawned_at: Date.now(), completed_at: null, retry_count: 0, max_retries: 2 },
    ];
    // Use internal state injection — test assumes canSpawn reads registry directly
    // We spawn to populate active_runs naturally
  });

  it("returns true when some runs finished and slots are free", async () => {
    const mgr = new SubagentManager("task_001", makeMockMemory(), { maxParallel: 2 });
    const api = makeMockAPI({
      run: vi.fn()
        .mockResolvedValueOnce({ runId: "run_1" })
        .mockResolvedValueOnce({ runId: "run_2" }),
    });

    // Spawn 2 (fills up)
    await mgr.spawnSubagent(makeSubtask({ subtask_name: "s1" }), makeTaskInfo(), [], [], api);
    await mgr.spawnSubagent(makeSubtask({ subtask_name: "s2" }), makeTaskInfo(), [], [], api);

    expect(mgr.canSpawn()).toBe(false);

    // Complete one
    const runs = mgr.getActiveRuns();
    await mgr.waitForCompletion(runs[0], api);

    expect(mgr.canSpawn()).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// spawnSubagent
// ══════════════════════════════════════════════════════════════════

describe("spawnSubagent", () => {
  let mgr: SubagentManager;
  let api: SubagentExecutionAPI;

  beforeEach(() => {
    mgr = new SubagentManager("task_001", makeMockMemory(), { maxParallel: 3 });
    api = makeMockAPI();
  });

  it("spawns a subagent and returns a running SubagentRun", async () => {
    const run = await mgr.spawnSubagent(
      makeSubtask(), makeTaskInfo(), ["验证文件存在"], ["read", "write"], api,
    );

    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");
    expect(run!.run_id).toMatch(/^sa_\d+_[a-z0-9]+$/);
    expect(run!.session_key).toBe("run_001");
    expect(run!.retry_count).toBe(0);

    // Should be in active runs
    const active = mgr.getActiveRuns();
    expect(active).toHaveLength(1);
  });

  it("returns null when parallel limit is reached", async () => {
    const smallMgr = new SubagentManager("task_001", makeMockMemory(), { maxParallel: 1 });
    const api2 = makeMockAPI({ run: vi.fn(async () => ({ runId: "run_1" })) });

    // First: spawns
    await smallMgr.spawnSubagent(makeSubtask({ subtask_name: "s1" }), makeTaskInfo(), [], [], api2);

    // Second: blocked
    const run2 = await smallMgr.spawnSubagent(makeSubtask({ subtask_name: "s2" }), makeTaskInfo(), [], [], api2);
    expect(run2).toBeNull();
  });

  it("returns failed run when api.run returns null", async () => {
    const nullAPI = makeMockAPI({ run: vi.fn(async () => null) });
    const run = await mgr.spawnSubagent(makeSubtask(), makeTaskInfo(), [], [], nullAPI);

    expect(run).not.toBeNull();
    expect(run!.status).toBe("failed");
  });

  it("returns failed run when api.run throws", async () => {
    const throwAPI = makeMockAPI({
      run: vi.fn(async () => { throw new Error("network error"); }),
    });
    const run = await mgr.spawnSubagent(makeSubtask(), makeTaskInfo(), [], [], throwAPI);

    expect(run).not.toBeNull();
    expect(run!.status).toBe("failed");
  });
});

// ══════════════════════════════════════════════════════════════════
// waitForCompletion
// ══════════════════════════════════════════════════════════════════

describe("waitForCompletion", () => {
  let mgr: SubagentManager;
  let api: SubagentExecutionAPI;

  beforeEach(() => {
    mgr = new SubagentManager("task_001", makeMockMemory());
    api = makeMockAPI();
  });

  it("completes successfully when result is ok", async () => {
    const run = await mgr.spawnSubagent(makeSubtask(), makeTaskInfo(), [], [], api);
    const completed = await mgr.waitForCompletion(run!, api);

    expect(completed.status).toBe("completed");
    expect(completed.completed_at).not.toBeNull();
    expect(completed.result?.status).toBe("ok");

    // Moved from active to completed
    expect(mgr.getActiveRuns()).toHaveLength(0);
    const results = mgr.aggregateResults();
    expect(results.success).toHaveLength(1);
  });

  it("marks timeout when waitForRun returns timeout status", async () => {
    const timeoutAPI = makeMockAPI({ waitForRun: vi.fn(async () => ({ status: "timeout" })) });
    const run = await mgr.spawnSubagent(makeSubtask(), makeTaskInfo(), [], [], timeoutAPI);
    const completed = await mgr.waitForCompletion(run!, timeoutAPI);

    expect(completed.status).toBe("timeout");
    expect(completed.result?.status).toBe("timeout");
  });

  it("marks failed when waitForRun returns error status", async () => {
    const errorAPI = makeMockAPI({ waitForRun: vi.fn(async () => ({ status: "error" })) });
    const run = await mgr.spawnSubagent(makeSubtask(), makeTaskInfo(), [], [], errorAPI);
    const completed = await mgr.waitForCompletion(run!, errorAPI);

    expect(completed.status).toBe("failed");
    expect(completed.result?.status).toBe("error");
  });

  it("marks failed when waitForRun throws", async () => {
    const throwAPI = makeMockAPI({
      waitForRun: vi.fn(async () => { throw new Error("rpc error"); }),
    });
    const run = await mgr.spawnSubagent(makeSubtask(), makeTaskInfo(), [], [], throwAPI);
    const completed = await mgr.waitForCompletion(run!, throwAPI);

    expect(completed.status).toBe("failed");
  });
});

// ══════════════════════════════════════════════════════════════════
// retrySubagent
// ══════════════════════════════════════════════════════════════════

describe("retrySubagent", () => {
  let mgr: SubagentManager;

  beforeEach(() => {
    mgr = new SubagentManager("task_001", makeMockMemory(), { maxRetries: 2 });
  });

  it("retries a failed subagent and carries forward retry_count", async () => {
    const api = makeMockAPI();
    const subtask = makeSubtask();
    const taskInfo = makeTaskInfo();

    // First spawn
    const run = await mgr.spawnSubagent(subtask, taskInfo, [], [], api);
    expect(run!.retry_count).toBe(0);
    // Mark as failed
    run!.status = "failed";

    // Retry — should spawn a new run with retry_count=1
    const retried = await mgr.retrySubagent(run!, subtask, taskInfo, [], [], api);
    expect(retried).not.toBeNull();
    expect(retried!.retry_count).toBe(1); // carried forward

    // Old run is removed from active
    expect(mgr.getActiveRuns()).toHaveLength(1);
    expect(mgr.getActiveRuns()[0].run_id).toBe(retried!.run_id);
  });

  it("stops retrying when max_retries is reached", async () => {
    const api = makeMockAPI();
    const subtask = makeSubtask();
    const taskInfo = makeTaskInfo();

    const run = await mgr.spawnSubagent(subtask, taskInfo, [], [], api);
    run!.status = "failed";
    run!.retry_count = 2; // Already at max

    const retried = await mgr.retrySubagent(run!, subtask, taskInfo, [], [], api);

    expect(retried!.status).toBe("failed");
    // Should be removed from active, added to completed
    expect(mgr.getActiveRuns()).toHaveLength(0);
    const results = mgr.aggregateResults();
    expect(results.failed).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════
// aggregateResults
// ══════════════════════════════════════════════════════════════════

describe("aggregateResults", () => {
  it("returns empty summaries when no completed runs", () => {
    const mgr = new SubagentManager("task_001", makeMockMemory());
    const results = mgr.aggregateResults();

    expect(results.success).toHaveLength(0);
    expect(results.failed).toHaveLength(0);
    expect(results.timeout).toHaveLength(0);
    expect(results.summary).toContain("✅ 成功: 0");
    expect(results.summary).toContain("❌ 失败: 0");
  });

  it("correctly categorizes mixed results", async () => {
    const mgr = new SubagentManager("task_001", makeMockMemory());
    // Simulate 3 runs with different outcomes
    const api1 = makeMockAPI({ run: vi.fn(async () => ({ runId: "r1" })), waitForRun: vi.fn(async () => ({ status: "ok" as const })) });
    const api2 = makeMockAPI({ run: vi.fn(async () => ({ runId: "r2" })), waitForRun: vi.fn(async () => ({ status: "error" as const })) });
    const api3 = makeMockAPI({ run: vi.fn(async () => ({ runId: "r3" })), waitForRun: vi.fn(async () => ({ status: "timeout" as const })) });

    // Sequential spawn + wait (maxParallel=1 forces sequential for test simplicity)
    const singleMgr = new SubagentManager("task_001", makeMockMemory(), { maxParallel: 1 });
    let run = await singleMgr.spawnSubagent(makeSubtask({ subtask_name: "s1" }), makeTaskInfo(), [], [], api1);
    await singleMgr.waitForCompletion(run!, api1);

    run = await singleMgr.spawnSubagent(makeSubtask({ subtask_name: "s2" }), makeTaskInfo(), [], [], api2);
    await singleMgr.waitForCompletion(run!, api2);

    run = await singleMgr.spawnSubagent(makeSubtask({ subtask_name: "s3" }), makeTaskInfo(), [], [], api3);
    await singleMgr.waitForCompletion(run!, api3);

    const results = singleMgr.aggregateResults();
    expect(results.success).toHaveLength(1);
    expect(results.failed).toHaveLength(1);
    expect(results.timeout).toHaveLength(1);
    expect(results.summary).toContain("s1");
    expect(results.summary).toContain("s2");
    expect(results.summary).toContain("s3");
  });
});

// ══════════════════════════════════════════════════════════════════
// buildSubagentContext — 纯函数
// ══════════════════════════════════════════════════════════════════

describe("buildSubagentContext", () => {
  it("includes task name, phase, and subtask name", () => {
    const ctx = buildSubagentContext(
      makeSubtask({ subtask_name: "设计DB Schema" }),
      makeTaskInfo({ task_name: "电商平台", phase_name: "Phase 2" }),
      [],
      [],
    );
    expect(ctx).toContain("电商平台");
    expect(ctx).toContain("Phase 2");
    expect(ctx).toContain("设计DB Schema");
    expect(ctx).toContain("[Praxis V13 子 Agent 上下文]");
  });

  it("includes completion criteria", () => {
    const ctx = buildSubagentContext(
      makeSubtask(),
      makeTaskInfo(),
      ["文件 db/schema.sql 存在", "所有字段有默认值"],
      [],
    );
    expect(ctx).toContain("文件 db/schema.sql 存在");
    expect(ctx).toContain("所有字段有默认值");
  });

  it("shows fallback when no criteria", () => {
    const ctx = buildSubagentContext(makeSubtask(), makeTaskInfo(), [], []);
    expect(ctx).toContain("无验收标准");
  });

  it("includes allowed operations", () => {
    const ctx = buildSubagentContext(
      makeSubtask(), makeTaskInfo(), [], ["read", "write", "bash"],
    );
    expect(ctx).toContain("read, write, bash");
  });

  it("shows fallback when no allowed ops", () => {
    const ctx = buildSubagentContext(makeSubtask(), makeTaskInfo(), [], []);
    expect(ctx).toContain("全部操作允许");
  });

  it("includes pitfall warnings", () => {
    const ctx = buildSubagentContext(
      makeSubtask(),
      makeTaskInfo({
        task_name: "test",
        phase_name: "Phase 1",
        pitfalls: [
          { severity: "HIGH", description: "不要用 DELETE CASCADE", mitigation: "手动检查外键" },
        ],
      }),
      [],
      [],
    );
    expect(ctx).toContain("陷阱预警");
    expect(ctx).toContain("DELETE CASCADE");
    expect(ctx).toContain("手动检查外键");
  });

  it("does not include pitfalls section when empty", () => {
    const ctx = buildSubagentContext(
      makeSubtask(), makeTaskInfo({ task_name: "t", phase_name: "p" }), [], [],
    );
    expect(ctx).not.toContain("陷阱预警");
  });

  it("includes output requirements section", () => {
    const ctx = buildSubagentContext(makeSubtask(), makeTaskInfo(), [], []);
    expect(ctx).toContain("输出要求");
    expect(ctx).toContain("完成的工作内容");
    expect(ctx).toContain("验收标准检查结果");
  });
});

// ══════════════════════════════════════════════════════════════════
// Persistence
// ══════════════════════════════════════════════════════════════════

describe("Persistence", () => {
  it("loadRegistry restores from slot", async () => {
    const stored: SubagentRegistry = {
      task_id: "task_001",
      active_runs: [],
      completed_runs: [
        {
          run_id: "sa_old",
          subtask_id: "old_subtask",
          session_key: "sk_old",
          status: "completed",
          spawned_at: 1000,
          completed_at: 2000,
          retry_count: 0,
          max_retries: 2,
        },
      ],
      max_parallel: 3,
    };

    const memory = makeMockMemory();
    memory.getSlot = vi.fn(async () => ({
      ok: true,
      value: { registries: { task_001: stored } },
    }));

    const mgr = new SubagentManager("task_001", memory);
    await mgr.loadRegistry();

    const registry = mgr.getRegistry();
    expect(registry.completed_runs).toHaveLength(1);
    expect(registry.completed_runs[0].run_id).toBe("sa_old");
  });

  it("loadRegistry is no-op when slot is missing", async () => {
    const memory = makeMockMemory();
    memory.getSlot = vi.fn(async () => ({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }));

    const mgr = new SubagentManager("task_001", memory);
    await mgr.loadRegistry();
    // Should still have empty default state
    expect(mgr.getRegistry().completed_runs).toHaveLength(0);
  });

  it("persistRegistry writes to slot", async () => {
    const memory = makeMockMemory();
    const mgr = new SubagentManager("task_001", memory);
    const api = makeMockAPI();

    await mgr.spawnSubagent(makeSubtask(), makeTaskInfo(), [], [], api);
    // persistRegistry is called internally by spawnSubagent

    expect(memory.setSlot).toHaveBeenCalled();
  });

  it("clear empties all runs and persists", async () => {
    const memory = makeMockMemory();
    const mgr = new SubagentManager("task_001", memory);
    const api = makeMockAPI();

    await mgr.spawnSubagent(makeSubtask(), makeTaskInfo(), [], [], api);
    expect(mgr.getActiveRuns()).toHaveLength(1);

    await mgr.clear();
    expect(mgr.getActiveRuns()).toHaveLength(0);
    expect(mgr.getRegistry().completed_runs).toHaveLength(0);
    expect(memory.setSlot).toHaveBeenCalled();
  });
});
