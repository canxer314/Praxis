/**
 * HeartbeatMonitor — V13 Phase 3c: Active Driving (停滞检测 + 分级介入)
 *
 * 职责:
 *   - runHeartbeatCheck: 检查所有活跃任务的子任务是否停滞
 *   - 分级响应: NUDGE (有活跃 session) → WAKE (无 session) → ESCALATE (>24h)
 *   - 持久化心跳状态到 AgentMemory slot
 *
 * 设计: 此类提供检查逻辑，平台层负责调度周期性调用 (setInterval / cron)。
 * 不绑定任何特定运行时。
 */

import type { Result } from "../platform-adapter";
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  HeartbeatState,
  HeartbeatIntervention,
  ActiveTriggeringConfig,
} from "./types";
import { SLOTS } from "./constants";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 依赖接口
// ══════════════════════════════════════════════════════════════════

export interface HeartbeatMemoryClient {
  getSlot(name: string): Promise<Result<unknown>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
}

/** 心跳检查所需的精简任务上下文 */
export interface HeartbeatTaskContext {
  task_id: string;
  task_state: string;
  subtask_id: string;
  subtask_name: string;
  /** 子任务开始时间 (Unix ms) */
  started_at: number;
  /** 估计耗时 (分钟) */
  estimated_duration_minutes: number;
  /** 是否有活跃 session */
  has_active_session: boolean;
}

/** 一次心跳检查的结果 */
export interface HeartbeatCheckResult {
  task_id: string;
  subtask_id: string;
  status: "normal" | "running_long" | "stalled";
  elapsed_ms: number;
  estimated_ms: number;
  intervention?: HeartbeatIntervention;
}

/** 分级介入: 平台层实现的回调 */
export interface StallInterventionCallback {
  /** Nudge: 注入提醒到当前 session */
  nudge(taskId: string, message: string): Promise<void>;
  /** Wake: 无活跃 session → 创建新 session */
  wake(taskId: string, reason: string): Promise<void>;
  /** Escalate: 强制介入 → 标记子任务 BLOCKED */
  escalate(taskId: string, subtaskId: string, reason: string): Promise<void>;
}

// ══════════════════════════════════════════════════════════════════
// HeartbeatMonitor
// ══════════════════════════════════════════════════════════════════

export class HeartbeatMonitor {
  private readonly memory: HeartbeatMemoryClient;
  private readonly config: ActiveTriggeringConfig;

  constructor(
    memory: HeartbeatMemoryClient,
    config: ActiveTriggeringConfig,
  ) {
    if (!memory) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "HeartbeatMemoryClient is required");
    if (!config) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "ActiveTriggeringConfig is required");
    this.memory = memory;
    this.config = config;
  }

  /**
   * 检查所有活跃任务的子任务是否停滞。
   *
   * 对每个活跃任务:
   *   1. 计算 elapsed vs estimated
   *   2. elapsed < estimated → NORMAL
   *   3. estimated ≤ elapsed < stall_threshold → RUNNING_LONG
   *   4. elapsed ≥ stall_threshold → STALL_DETECTED → handleStall
   *
   * @param activeTasks 当前活跃任务列表
   * @returns 每个任务的检查结果
   */
  async runHeartbeatCheck(
    activeTasks: HeartbeatTaskContext[],
  ): Promise<HeartbeatCheckResult[]> {
    if (!this.config.allow_heartbeat_monitor) {
      return [];
    }

    const results: HeartbeatCheckResult[] = [];
    const now = Date.now();

    for (const task of activeTasks) {
      try {
        const result = await this.checkTask(task, now);
        results.push(result);
      } catch (err) {
        logDegraded("heartbeat-monitor", "runHeartbeatCheck",
          `check failed for ${task.task_id}/${task.subtask_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return results;
  }

  /**
   * 对检测到停滞的任务执行分级介入。
   *
   * @param stalledResults runHeartbeatCheck 中 status="stalled" 的结果
   * @param intervention 平台层实现的介入回调
   */
  async handleStalledTasks(
    stalledResults: HeartbeatCheckResult[],
    tasks: HeartbeatTaskContext[],
    intervention: StallInterventionCallback,
  ): Promise<void> {
    for (const result of stalledResults) {
      const task = tasks.find(
        (t) => t.task_id === result.task_id && t.subtask_id === result.subtask_id,
      );
      if (!task) continue;

      try {
        await this.handleStall(task, result.elapsed_ms, result.estimated_ms, intervention);
      } catch (err) {
        logDegraded("heartbeat-monitor", "handleStalledTasks",
          `intervention failed for ${task.task_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ---- 内部 ----

  private async checkTask(
    task: HeartbeatTaskContext,
    now: number,
  ): Promise<HeartbeatCheckResult> {
    const elapsed = now - task.started_at;
    const estimatedMs = task.estimated_duration_minutes * 60 * 1000;
    const stallThreshold = estimatedMs * this.config.stall_threshold_multiplier;

    let status: HeartbeatCheckResult["status"];
    if (elapsed >= stallThreshold) {
      status = "stalled";
    } else if (elapsed >= estimatedMs) {
      status = "running_long";
    } else {
      status = "normal";
    }

    // 更新心跳计数
    await this.updateHeartbeat(task, elapsed, estimatedMs, stallThreshold, now);

    return {
      task_id: task.task_id,
      subtask_id: task.subtask_id,
      status,
      elapsed_ms: elapsed,
      estimated_ms: estimatedMs,
    };
  }

  private async handleStall(
    task: HeartbeatTaskContext,
    elapsed: number,
    estimated: number,
    intervention: StallInterventionCallback,
  ): Promise<void> {
    const elapsedHours = elapsed / 3600000;
    const thresholdHours = (estimated * this.config.stall_threshold_multiplier) / 3600000;

    const reason = [
      `子任务 "${task.subtask_name}" 运行超过预期`,
      `已运行 ${elapsedHours.toFixed(1)}h (阈值: ${thresholdHours.toFixed(1)}h)`,
    ].join(" — ");

    // 检查是否已有近期 nudge (防重复介入)
    const existingState = await this.loadHeartbeatState(task.task_id, task.subtask_id);
    const recentNudge = existingState?.interventions.find(
      (i) => i.type === "nudge" && (Date.now() - i.triggered_at) < 60 * 60 * 1000,
    );
    if (recentNudge) {
      // 1 小时内已有 nudge → 跳过，等待下一次检查
      return;
    }

    const intervention_record: HeartbeatIntervention = {
      triggered_at: Date.now(),
      type: "nudge",
      reason,
      action: "request_heartbeat",
    };

    if (task.has_active_session) {
      // Level 1: NUDGE — 注入提醒到当前 session
      intervention_record.action = "request_heartbeat";
      await intervention.nudge(
        task.task_id,
        `⚠️ [Praxis V13] ${reason}\n建议: 检查进展，或标记为 BLOCKED。`,
      );

      log({
        ts: new Date().toISOString(),
        module: "heartbeat-monitor",
        op: "handleStall",
        duration_ms: 0,
        outcome: "degraded",
        error: `NUDGE: ${task.subtask_name} (${task.task_id})`,
      });
    } else {
      const stalledHours = elapsed / 3600000;
      const autoCancelHours = this.config.auto_cancel_stalled_after_hours;

      if (stalledHours > autoCancelHours) {
        // Level 3: ESCALATE — 超过自动取消阈值 → 标记 BLOCKED
        intervention_record.type = "escalate";
        intervention_record.action = "cancel_subtask";
        intervention_record.reason += ` — 超过自动取消阈值 (${autoCancelHours}h)`;

        await intervention.escalate(task.task_id, task.subtask_id, intervention_record.reason);

        log({
          ts: new Date().toISOString(),
          module: "heartbeat-monitor",
          op: "handleStall",
          duration_ms: 0,
          outcome: "degraded",
          error: `ESCALATE: ${task.subtask_name} (${task.task_id}) — marking BLOCKED`,
        });
      } else {
        // Level 2: WAKE — 无活跃 session → 创建新 session
        intervention_record.action = "request_heartbeat";
        await intervention.wake(task.task_id, intervention_record.reason);

        log({
          ts: new Date().toISOString(),
          module: "heartbeat-monitor",
          op: "handleStall",
          duration_ms: 0,
          outcome: "degraded",
          error: `WAKE: ${task.subtask_name} (${task.task_id})`,
        });
      }
    }

    // 持久化干预记录
    await this.saveIntervention(task.task_id, task.subtask_id, intervention_record);
  }

  // ---- 持久化 ----

  private async updateHeartbeat(
    task: HeartbeatTaskContext,
    elapsed: number,
    estimatedMs: number,
    stallThreshold: number,
    now: number,
  ): Promise<void> {
    const existing = await this.loadHeartbeatState(task.task_id, task.subtask_id);

    const state: HeartbeatState = {
      task_id: task.task_id,
      subtask_id: task.subtask_id,
      subtask_started_at: task.started_at,
      estimated_duration_ms: estimatedMs,
      last_progress_at: now,
      stall_threshold_ms: stallThreshold,
      heartbeat_count: (existing?.heartbeat_count ?? 0) + 1,
      interventions: existing?.interventions ?? [],
    };

    await this.saveHeartbeatState(state);
  }

  async loadHeartbeatState(
    taskId: string,
    subtaskId: string,
  ): Promise<HeartbeatState | null> {
    const result = await this.memory.getSlot(SLOTS.HEARTBEAT_STATE);
    if (!result.ok) return null;

    const data = result.value as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return null;

    const states = (data.states ?? {}) as Record<string, HeartbeatState>;
    const key = `${taskId}::${subtaskId}`;
    return states[key] ?? null;
  }

  private async saveHeartbeatState(state: HeartbeatState): Promise<void> {
    const result = await this.memory.getSlot(SLOTS.HEARTBEAT_STATE);
    const data = (result.ok ? result.value as Record<string, unknown> : null) ?? {};
    const states = (data.states ?? {}) as Record<string, HeartbeatState>;
    const key = `${state.task_id}::${state.subtask_id}`;
    states[key] = state;
    data.states = states;

    const writeResult = await this.memory.setSlot(SLOTS.HEARTBEAT_STATE, data);
    if (!writeResult.ok) {
      logDegraded("heartbeat-monitor", "saveHeartbeatState",
        `slot write failed: ${writeResult.error?.message}`);
    }
  }

  private async saveIntervention(
    taskId: string,
    subtaskId: string,
    intervention: HeartbeatIntervention,
  ): Promise<void> {
    const state = await this.loadHeartbeatState(taskId, subtaskId);
    if (!state) return;

    state.interventions.push(intervention);
    await this.saveHeartbeatState(state);
  }
}
