/**
 * SubagentManager — V13 Phase 3b: 并行子 Agent 生命周期管理
 *
 * 职责:
 *   - spawnSubagent: 构建上下文 → 调用平台 API → 追踪运行状态
 *   - waitForCompletion: 等待子 Agent 完成 + 超时检测
 *   - retrySubagent: 失败重试 (max_retries 次)
 *   - aggregateResults: 汇总所有完成子 Agent 的结果
 *   - 并行上限控制: canSpawn() 检查是否达到 max_parallel
 *
 * 在 session_end 时由 task-scheduler 触发，为可并行子任务 spawn 独立子 Agent。
 *
 * 通用性: 不绑定 Claude Code 或任何特定平台。
 * SubagentExecutionAPI 由平台层实现。
 */

import type { Result } from "../platform-adapter";
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  SubagentRun,
  SubagentResult,
  SubagentRegistry,
} from "./types";
import type { SchedulerSubtask } from "./task-scheduler";
import { SLOTS } from "./constants";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 依赖接口
// ══════════════════════════════════════════════════════════════════

export interface SubagentMemoryClient {
  getSlot(name: string): Promise<Result<unknown>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
}

/** 平台层子 Agent 执行 API — 由宿主 (OpenClaw / Claude Code) 实现 */
export interface SubagentExecutionAPI {
  run(params: {
    sessionKey: string;
    message: string;
    extraSystemPrompt?: string;
  }): Promise<{ runId: string } | null>;
  waitForRun(params: {
    runId: string;
    timeoutMs: number;
  }): Promise<{ status: "ok" | "error" | "timeout" }>;
}

/** 上下文构建所需的任务/阶段信息 */
export interface SubagentTaskInfo {
  task_name: string;
  phase_name: string;
  /** 陷阱预警 — 传递给子 Agent 以避免已知坑 */
  pitfalls?: Array<{ severity: string; description: string; mitigation: string }>;
}

// ══════════════════════════════════════════════════════════════════
// SubagentManager
// ══════════════════════════════════════════════════════════════════

export class SubagentManager {
  private readonly memory: SubagentMemoryClient;
  private registry: SubagentRegistry;
  private readonly maxRetries: number;

  constructor(
    taskId: string,
    memory: SubagentMemoryClient,
    opts?: { maxParallel?: number; maxRetries?: number },
  ) {
    if (!memory) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "SubagentMemoryClient is required");
    this.memory = memory;
    this.maxRetries = opts?.maxRetries ?? 2;

    this.registry = {
      task_id: taskId,
      active_runs: [],
      completed_runs: [],
      max_parallel: opts?.maxParallel ?? 3,
    };
  }

  // ---- 并行控制 ----

  /** 检查是否可以 spawn 更多子 Agent */
  canSpawn(): boolean {
    const activeCount = this.registry.active_runs.filter(
      (r) => r.status === "spawning" || r.status === "running",
    ).length;
    return activeCount < this.registry.max_parallel;
  }

  // ---- 生命周期 ----

  /**
   * Spawn 一个子 Agent 执行子任务。
   *
   * 1. 检查并行上限 → canSpawn()
   * 2. 构建精简上下文 → buildSubagentContext()
   * 3. 调用平台 API → api.run()
   * 4. 记录到 active_runs → 持久化
   *
   * @returns SubagentRun 或 null (达到并行上限时排队)
   */
  async spawnSubagent(
    subtask: SchedulerSubtask,
    taskInfo: SubagentTaskInfo,
    criteria: string[],
    allowedOps: string[],
    api: SubagentExecutionAPI,
  ): Promise<SubagentRun | null> {
    if (!this.canSpawn()) {
      logDegraded("subagent-manager", "spawnSubagent",
        `parallel limit reached (${this.registry.max_parallel}), queuing: ${subtask.subtask_name}`);
      return null;
    }

    const systemPrompt = buildSubagentContext(subtask, taskInfo, criteria, allowedOps);

    const run: SubagentRun = {
      run_id: `sa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      subtask_id: subtask.subtask_name,
      session_key: "",
      status: "spawning",
      spawned_at: Date.now(),
      completed_at: null,
      retry_count: 0,
      max_retries: this.maxRetries,
    };

    try {
      const result = await api.run({
        sessionKey: `praxis:subtask:${subtask.subtask_name}`,
        message: `执行子任务: ${subtask.subtask_name}`,
        extraSystemPrompt: systemPrompt,
      });

      if (!result) {
        run.status = "failed";
        logDegraded("subagent-manager", "spawnSubagent",
          `api.run returned null for: ${subtask.subtask_name}`);
        return run;
      }

      run.session_key = result.runId;
      run.status = "running";
      this.registry.active_runs.push(run);
      await this.persistRegistry();

      log({
        ts: new Date().toISOString(),
        module: "subagent-manager",
        op: "spawnSubagent",
        duration_ms: 0,
        outcome: "success",
        error: `Spawned: ${subtask.subtask_name} (${run.run_id})`,
      });

      return run;
    } catch (err) {
      run.status = "failed";
      logDegraded("subagent-manager", "spawnSubagent",
        `spawn failed for ${subtask.subtask_name}: ${err instanceof Error ? err.message : String(err)}`);
      return run;
    }
  }

  /**
   * 等待子 Agent 完成。
   *
   * 超时检测: 超过 timeoutMs → 标记 timeout
   * 完成后: active_runs → completed_runs
   */
  async waitForCompletion(
    run: SubagentRun,
    api: SubagentExecutionAPI,
    timeoutMinutes: number = 60,
  ): Promise<SubagentRun> {
    const timeoutMs = timeoutMinutes * 60 * 1000;

    try {
      const result = await api.waitForRun({
        runId: run.run_id,
        timeoutMs,
      });

      run.completed_at = Date.now();

      if (result.status === "ok") {
        run.status = "completed";
        run.result = { run_id: run.run_id, status: "ok" };
      } else if (result.status === "timeout") {
        run.status = "timeout";
        run.result = { run_id: run.run_id, status: "timeout" };
      } else {
        run.status = "failed";
        run.result = { run_id: run.run_id, status: "error" };
      }
    } catch (err) {
      run.status = "failed";
      run.result = { run_id: run.run_id, status: "error" };
      logDegraded("subagent-manager", "waitForCompletion",
        `wait failed for ${run.subtask_id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // active → completed
    this.registry.active_runs = this.registry.active_runs.filter(
      (r) => r.run_id !== run.run_id,
    );
    this.registry.completed_runs.push(run);
    await this.persistRegistry();

    return run;
  }

  /**
   * 重试失败的子 Agent。
   *
   * 超过 max_retries → 标记最终失败
   * 未超过 → 移除旧 run → 重新 spawn → 继承 retry_count
   */
  async retrySubagent(
    run: SubagentRun,
    subtask: SchedulerSubtask,
    taskInfo: SubagentTaskInfo,
    criteria: string[],
    allowedOps: string[],
    api: SubagentExecutionAPI,
  ): Promise<SubagentRun | null> {
    if (run.retry_count >= run.max_retries) {
      logDegraded("subagent-manager", "retrySubagent",
        `max retries (${run.max_retries}) reached for ${subtask.subtask_name}`);
      run.status = "failed";
      // Remove from active, add to completed
      this.registry.active_runs = this.registry.active_runs.filter(
        (r) => r.run_id !== run.run_id,
      );
      this.registry.completed_runs.push(run);
      await this.persistRegistry();
      return run;
    }

    // Remove old failed run from registry — new spawn creates fresh run
    this.registry.active_runs = this.registry.active_runs.filter(
      (r) => r.run_id !== run.run_id,
    );

    const retryCount = run.retry_count + 1;

    log({
      ts: new Date().toISOString(),
      module: "subagent-manager",
      op: "retrySubagent",
      duration_ms: 0,
      outcome: "degraded",
      error: `Retry ${retryCount}/${run.max_retries} for ${subtask.subtask_name}`,
    });

    const newRun = await this.spawnSubagent(subtask, taskInfo, criteria, allowedOps, api);
    if (newRun) {
      // Carry forward retry count — spawnSubagent always starts at 0
      newRun.retry_count = retryCount;
      newRun.max_retries = run.max_retries;
    }
    return newRun;
  }

  // ---- 结果聚合 ----

  /** 汇总所有已完成子 Agent 的结果 */
  aggregateResults(): {
    success: SubagentRun[];
    failed: SubagentRun[];
    timeout: SubagentRun[];
    summary: string;
  } {
    const completed = this.registry.completed_runs;
    const success = completed.filter((r) => r.status === "completed");
    const failed = completed.filter((r) => r.status === "failed");
    const timeout = completed.filter((r) => r.status === "timeout");

    const summary = [
      "并行执行汇总:",
      `  ✅ 成功: ${success.length} (${success.map((r) => r.subtask_id).join(", ") || "无"})`,
      `  ❌ 失败: ${failed.length} (${failed.map((r) => r.subtask_id).join(", ") || "无"})`,
      `  ⏱ 超时: ${timeout.length} (${timeout.map((r) => r.subtask_id).join(", ") || "无"})`,
    ].join("\n");

    return { success, failed, timeout, summary };
  }

  // ---- 查询 ----

  getActiveRuns(): SubagentRun[] {
    return this.registry.active_runs.filter(
      (r) => r.status === "spawning" || r.status === "running",
    );
  }

  getRegistry(): SubagentRegistry {
    return { ...this.registry, active_runs: [...this.registry.active_runs], completed_runs: [...this.registry.completed_runs] };
  }

  // ---- 持久化 ----

  async loadRegistry(): Promise<void> {
    const result = await this.memory.getSlot(SLOTS.SUBAGENT_REGISTRY);
    if (!result.ok) return;

    const data = result.value as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return;

    const registries = (data.registries ?? {}) as Record<string, SubagentRegistry>;
    const stored = registries[this.registry.task_id];
    if (stored) {
      this.registry = stored;
    }
  }

  async persistRegistry(): Promise<void> {
    const result = await this.memory.getSlot(SLOTS.SUBAGENT_REGISTRY);
    const data = (result.ok ? result.value as Record<string, unknown> : null) ?? {};
    const registries = (data.registries ?? {}) as Record<string, SubagentRegistry>;
    registries[this.registry.task_id] = this.registry;
    data.registries = registries;

    const writeResult = await this.memory.setSlot(SLOTS.SUBAGENT_REGISTRY, data);
    if (!writeResult.ok) {
      logDegraded("subagent-manager", "persistRegistry",
        `slot write failed: ${writeResult.error?.message}`);
    }
  }

  /** Factory reset — 清除当前任务的所有子 Agent 记录 */
  async clear(): Promise<void> {
    this.registry.active_runs = [];
    this.registry.completed_runs = [];
    await this.persistRegistry();
  }
}

// ══════════════════════════════════════════════════════════════════
// 纯函数 — 上下文构建
// ══════════════════════════════════════════════════════════════════

/**
 * 构建子 Agent 上下文 (精简版)。
 *
 * 包含: 任务名 + 阶段 + 子任务描述 + 验收标准 + 允许操作 + 陷阱预警 + 输出要求
 * 不包含: 父对话历史 + 其他子任务状态
 */
export function buildSubagentContext(
  subtask: SchedulerSubtask,
  taskInfo: SubagentTaskInfo,
  criteria: string[],
  allowedOps: string[],
): string {
  const lines: string[] = [];

  lines.push("[Praxis V13 子 Agent 上下文]");
  lines.push("");
  lines.push(`## 任务: ${taskInfo.task_name}`);
  lines.push(`阶段: ${taskInfo.phase_name}`);
  lines.push(`子任务: ${subtask.subtask_name}`);
  lines.push("");
  lines.push("## 验收标准");
  if (criteria.length > 0) {
    for (const c of criteria) {
      lines.push(`- ${c}`);
    }
  } else {
    lines.push("- (无验收标准 — 信任子 Agent 自报结果)");
  }
  lines.push("");
  lines.push("## 允许的操作");
  lines.push(allowedOps.length > 0 ? allowedOps.join(", ") : "(全部操作允许)");
  lines.push("");

  if (taskInfo.pitfalls && taskInfo.pitfalls.length > 0) {
    lines.push("## ⚠️ 陷阱预警");
    for (const p of taskInfo.pitfalls) {
      lines.push(`- [${p.severity}] ${p.description}`);
      lines.push(`  缓解: ${p.mitigation}`);
    }
    lines.push("");
  }

  lines.push("## 输出要求");
  lines.push("完成后请输出完成报告，包含:");
  lines.push("1. 完成的工作内容");
  lines.push("2. 遇到的关键问题及解决方案");
  lines.push("3. 验收标准检查结果");

  return lines.join("\n");
}
