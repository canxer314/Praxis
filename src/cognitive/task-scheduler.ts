/**
 * TaskScheduler — V13 Phase 3: 主动触发决策引擎
 *
 * 职责:
 *   - evaluateTrigger: 决策矩阵 — 是否/何时/如何触发下一个动作
 *   - executeTrigger: 执行触发 + 去重 + 持久化
 *   - 管理 TaskSchedule 生命周期 (加载/保存/标记完成/取消)
 *
 * 在 session_end 时被调用，决定是否主动调度下一 session。
 *
 * 通用性: 不绑定 Claude Code 或任何特定平台。
 * TriggerAdapter 接口由平台层实现（bundled scheduleSessionTurn 或 cron fallback）。
 */

import type { Result } from "../platform-adapter";
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  TaskSchedule,
  ScheduledTrigger,
  TriggerDecision,
  TriggerAdapter,
  ActiveTriggeringConfig,
} from "./types";
import { SLOTS } from "./constants";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 依赖接口
// ══════════════════════════════════════════════════════════════════

export interface TaskSchedulerMemoryClient {
  getSlot(name: string): Promise<Result<unknown>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
}

// ══════════════════════════════════════════════════════════════════
// 简化的任务上下文 (不依赖完整的 TaskOrchestrationState)
// ══════════════════════════════════════════════════════════════════

export interface SchedulerTaskContext {
  task_id: string;
  task_state: string;
  /** 待执行的子任务列表（仅需 name, estimated_duration, parallelizable, depends_on） */
  pending_subtasks: SchedulerSubtask[];
}

export interface SchedulerSubtask {
  subtask_name: string;
  /** 估计耗时（分钟），默认 60 */
  estimated_duration_minutes?: number;
  /** 是否可并行执行 */
  parallelizable?: boolean;
  /** 依赖的其他子任务 ID 列表 */
  depends_on?: string[];
}

// ══════════════════════════════════════════════════════════════════
// 默认配置
// ══════════════════════════════════════════════════════════════════

export const DEFAULT_TRIGGERING_CONFIG: ActiveTriggeringConfig = {
  enabled: false,
  allow_schedule_session_turn: true,
  allow_subagent_spawn: true,
  allow_heartbeat_monitor: true,
  allow_background_service: true,
  max_parallel_subagents: 3,
  min_interval_between_triggers_minutes: 30,
  max_triggers_per_day: 8,
  quiet_hours: "22:00-08:00",
  quiet_hours_timezone: "Asia/Shanghai",
  require_user_confirmation_for: ["first_trigger_of_task", "subagent_spawn"],
  stall_threshold_multiplier: 2.0,
  auto_cancel_stalled_after_hours: 24,
  max_heartbeat_checks_per_hour: 12,
  trigger_failure_backoff_minutes: 30,
};

// ══════════════════════════════════════════════════════════════════
// TaskScheduler
// ══════════════════════════════════════════════════════════════════

export class TaskScheduler {
  private readonly memory: TaskSchedulerMemoryClient;
  private readonly config: ActiveTriggeringConfig;

  constructor(
    memory: TaskSchedulerMemoryClient,
    config?: Partial<ActiveTriggeringConfig>,
  ) {
    if (!memory) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP, "TaskSchedulerMemoryClient is required");
    this.memory = memory;
    this.config = { ...DEFAULT_TRIGGERING_CONFIG, ...config };
  }

  // ---- 触发决策 ----

  /**
   * 评估是否应该触发下一动作。
   *
   * 决策矩阵 (按优先级):
   *   1. 自动驾驶未开启 → false
   *   2. 任务已结束 → false
   *   3. 静默时段 → skip (不强制阻止)
   *   4. 超过每日触发上限 → false
   *   5. 距上次触发过短 → skip (不强制阻止)
   *   6. 无待执行子任务 → false
   *   7. 可并行 → subagent_run
   *   8. 短任务(<1h) → scheduleSessionTurn (delay)
   *   9. 中任务(1-24h) → scheduleSessionTurn (at)
   *   10. 长任务(>24h) → cron_job
   *
   * @param schedule 可选的任务调度状态 — 提供则启用基于持久化数据的 guard (每日上限 + 最小间隔)
   */
  evaluateTrigger(
    ctx: SchedulerTaskContext,
    currentTime: number = Date.now(),
    schedule?: TaskSchedule | null,
  ): TriggerDecision {
    const skipReasons: string[] = [];

    // 1. 自动驾驶未开启
    if (!this.config.enabled) {
      return { should_trigger: false, mechanism: "none", reason: "disabled", skip_reasons: ["自动驾驶未开启"] };
    }

    // 2. 任务已结束
    if (ctx.task_state === "TASK_COMPLETE" || ctx.task_state === "TASK_ABANDONED") {
      return { should_trigger: false, mechanism: "none", reason: "task_ended", skip_reasons: ["任务已结束"] };
    }

    // 3. 静默时段
    if (isInQuietHours(currentTime, this.config.quiet_hours)) {
      skipReasons.push("当前在静默时段");
    }

    // 4. 每日触发上限 (需要 schedule 数据才能准确计数)
    if (schedule) {
      const todayCount = countTodayTriggers(schedule, currentTime);
      if (todayCount >= this.config.max_triggers_per_day) {
        return { should_trigger: false, mechanism: "none", reason: "daily_limit", skip_reasons: ["已达每日触发上限"] };
      }

      // 5. 最小触发间隔 (需要 schedule 数据)
      if (schedule.last_trigger_at != null) {
        const elapsed = currentTime - schedule.last_trigger_at;
        const minIntervalMs = this.config.min_interval_between_triggers_minutes * 60 * 1000;
        if (elapsed < minIntervalMs) {
          skipReasons.push("距上次触发时间过短");
        }
      }
    }

    // 6. 检查是否有待执行子任务
    const nextSubtask = ctx.pending_subtasks[0];
    if (!nextSubtask) {
      return { should_trigger: false, mechanism: "none", reason: "no_pending", skip_reasons: ["没有待执行的子任务"] };
    }

    // 7. 可并行 → subagent_run
    if (this.config.allow_subagent_spawn && canParallelize(nextSubtask)) {
      return {
        should_trigger: true,
        mechanism: "subagent_run",
        reason: `子任务 "${nextSubtask.subtask_name}" 无依赖可并行`,
        skip_reasons: skipReasons,
      };
    }

    // 8. 按估计时间选择机制
    const estimatedMs = (nextSubtask.estimated_duration_minutes ?? 60) * 60 * 1000;

    if (estimatedMs < 60 * 60 * 1000) {
      // < 1 小时 → delay-based
      return {
        should_trigger: true,
        mechanism: "scheduleSessionTurn",
        delay_ms: estimatedMs,
        reason: `子任务 "${nextSubtask.subtask_name}" 估计 ${nextSubtask.estimated_duration_minutes ?? 60}min`,
        skip_reasons: skipReasons,
      };
    }

    if (estimatedMs < 24 * 60 * 60 * 1000) {
      // 1-24 小时 → at-based
      return {
        should_trigger: true,
        mechanism: "scheduleSessionTurn",
        at_time: currentTime + estimatedMs,
        reason: `子任务 "${nextSubtask.subtask_name}" 估计 ${nextSubtask.estimated_duration_minutes ?? 60}min`,
        skip_reasons: skipReasons,
      };
    }

    // > 24 小时 → cron job
    return {
      should_trigger: true,
      mechanism: "cron_job",
      reason: `长运行子任务 "${nextSubtask.subtask_name}" 需要定期检查`,
      skip_reasons: skipReasons,
    };
  }

  // ---- 触发执行 ----

  /**
   * 执行触发决策: 去重 → 首次确认检查 → 调用 adapter → 持久化。
   *
   * @returns 创建的 ScheduledTrigger，如果跳过则返回 null
   */
  async executeTrigger(
    decision: TriggerDecision,
    ctx: SchedulerTaskContext,
    adapter: TriggerAdapter,
    sessionKey: string,
  ): Promise<ScheduledTrigger | null> {
    if (!decision.should_trigger) return null;

    // 去重: 检查是否已有相同 reason 的 pending 触发
    const schedule = await this.loadSchedule(ctx.task_id);
    const duplicate = schedule?.pending_triggers.find(
      (t) => t.reason === decision.reason && t.status === "pending",
    );
    if (duplicate) {
      // 已有未过期的相同触发 → 跳过
      const TEN_MINUTES = 10 * 60 * 1000;
      if (duplicate.scheduled_at > Date.now() - TEN_MINUTES) {
        return null;
      }
      // 已过期 → 取消旧触发，继续创建新触发
      await this.cancelTrigger(ctx.task_id, duplicate.trigger_id);
    }

    // 首次触发确认检查
    if (this.config.require_user_confirmation_for.includes("first_trigger_of_task")) {
      const existingSchedule = await this.loadSchedule(ctx.task_id);
      const totalTriggers = existingSchedule?.pending_triggers.length ?? 0;
      if (totalTriggers === 0) {
        // 首次触发需用户确认 — 暂不自动触发
        log({
          ts: new Date().toISOString(),
          module: "task-scheduler",
          op: "executeTrigger",
          duration_ms: 0,
          outcome: "skipped",
          error: `First trigger for task ${ctx.task_id} — awaiting user confirmation`,
        });
        return null;
      }
    }

    // mechanism cannot be "none" at this point (should_trigger=true guarantees it)
    const schedMechanism: "scheduleSessionTurn" | "cron_job" =
      decision.mechanism === "subagent_run" ? "cron_job" : decision.mechanism as "scheduleSessionTurn" | "cron_job";

    const trigger: ScheduledTrigger = {
      trigger_id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      trigger_source: decision.mechanism === "subagent_run" ? "heartbeat:wake" : "cron:scheduled",
      scheduled_at: decision.at_time ?? (Date.now() + (decision.delay_ms ?? 0)),
      mechanism: schedMechanism,
      reason: decision.reason,
      status: "pending",
      created_at: Date.now(),
    };

    // 调用 adapter 注册定时触发
    if (decision.mechanism === "scheduleSessionTurn" || decision.mechanism === "cron_job") {
      try {
        const result = await adapter.scheduleTurn({
          sessionKey,
          message: `[Praxis V13 自动触发] ${decision.reason}`,
          at: decision.at_time,
          delayMs: decision.delay_ms,
          cron: decision.mechanism === "cron_job" ? "*/30 * * * *" : undefined,
          tag: `praxis:task:${ctx.task_id}`,
        });
        if (result) {
          trigger.cron_job_id = result.jobId;
        }
      } catch (err) {
        trigger.status = "cancelled";
        logDegraded("task-scheduler", "executeTrigger",
          `adapter.scheduleTurn failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // subagent_run 由 subagent-manager 处理，不在此处 spawn

    // 持久化
    await this.saveTrigger(ctx.task_id, trigger);

    log({
      ts: new Date().toISOString(),
      module: "task-scheduler",
      op: "executeTrigger",
      duration_ms: 0,
      outcome: trigger.status === "cancelled" ? "degraded" : "success",
      error: trigger.status === "pending"
        ? `Scheduled trigger: ${decision.reason}`
        : `Trigger cancelled: ${decision.reason}`,
    });

    return trigger;
  }

  // ---- Schedule 生命周期管理 ----

  /** 加载任务调度状态 */
  async loadSchedule(taskId: string): Promise<TaskSchedule | null> {
    const result = await this.memory.getSlot(SLOTS.TASK_SCHEDULE);
    if (!result.ok) return null;
    const data = result.value as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return null;

    const schedules = (data.schedules ?? data) as Record<string, unknown>;
    const taskSchedule = (schedules[taskId] ?? null) as TaskSchedule | null;
    return taskSchedule;
  }

  /** 保存触发记录到调度状态 */
  async saveTrigger(taskId: string, trigger: ScheduledTrigger): Promise<void> {
    const existing = await this.loadSchedule(taskId);
    const schedule: TaskSchedule = existing ?? {
      task_id: taskId,
      pending_triggers: [],
      last_trigger_at: null,
      next_trigger_at: null,
      active_cron_job_ids: [],
    };

    schedule.pending_triggers.push(trigger);
    schedule.last_trigger_at = Date.now();
    schedule.next_trigger_at = trigger.scheduled_at;

    if (trigger.cron_job_id) {
      schedule.active_cron_job_ids.push(trigger.cron_job_id);
    }

    await this.persistSchedule(taskId, schedule);
  }

  /** 标记触发为已完成 */
  async markTriggerFired(taskId: string, triggerId: string): Promise<void> {
    const schedule = await this.loadSchedule(taskId);
    if (!schedule) return;

    const trigger = schedule.pending_triggers.find((t) => t.trigger_id === triggerId);
    if (trigger) {
      trigger.status = "fired";
      await this.persistSchedule(taskId, schedule);
    }
  }

  /** 取消触发 */
  async cancelTrigger(taskId: string, triggerId: string): Promise<void> {
    const schedule = await this.loadSchedule(taskId);
    if (!schedule) return;

    const trigger = schedule.pending_triggers.find((t) => t.trigger_id === triggerId);
    if (trigger) {
      trigger.status = "cancelled";
      await this.persistSchedule(taskId, schedule);
    }
  }

  /** 清理过期触发（> 1 小时未触发的 pending triggers） */
  async cleanupExpiredTriggers(taskId: string, now: number = Date.now()): Promise<number> {
    const schedule = await this.loadSchedule(taskId);
    if (!schedule) return 0;

    const ONE_HOUR = 60 * 60 * 1000;
    let cleaned = 0;

    for (const trigger of schedule.pending_triggers) {
      if (trigger.status === "pending" && trigger.scheduled_at < now - ONE_HOUR) {
        trigger.status = "cancelled";
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.persistSchedule(taskId, schedule);
    }

    return cleaned;
  }

  // ---- 内部 ----

  /** 持久化调度状态到 slot */
  private async persistSchedule(taskId: string, schedule: TaskSchedule): Promise<void> {
    // 加载全量 schedules map，更新后写回
    const result = await this.memory.getSlot(SLOTS.TASK_SCHEDULE);
    const data = (result.ok ? result.value as Record<string, unknown> : null) ?? {};
    const schedules = (data.schedules ?? {}) as Record<string, TaskSchedule>;
    schedules[taskId] = schedule;

    const writeResult = await this.memory.setSlot(SLOTS.TASK_SCHEDULE, { schedules });
    if (!writeResult.ok) {
      logDegraded("task-scheduler", "persistSchedule",
        `slot write failed: ${writeResult.error?.message}`);
    }
  }

  /** 计算今日已创建触发数 (需要 schedule 数据) */
  // countTodayTriggers 现在是纯函数 — 见文件底部
}

// ══════════════════════════════════════════════════════════════════
// 纯函数 — 决策矩阵辅助
// ══════════════════════════════════════════════════════════════════

/**
 * 检查当前时间是否在静默时段内。
 *
 * 格式: "HH:MM-HH:MM"
 * 支持跨午夜: "22:00-08:00"
 */
export function isInQuietHours(now: number, quietHours: string): boolean {
  if (!quietHours || !quietHours.includes("-")) return false;

  const [start, end] = quietHours.split("-");
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);

  if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return false;

  const nowDate = new Date(now);
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // 同一天内: 如 08:00-22:00
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // 跨午夜: 如 22:00-08:00
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/**
 * 判断子任务是否可并行执行。
 *
 * 条件: parallelizable === true AND depends_on 为空。
 */
export function canParallelize(subtask: SchedulerSubtask): boolean {
  return (
    subtask.parallelizable === true &&
    (!subtask.depends_on || subtask.depends_on.length === 0)
  );
}

/**
 * 计算今日已创建的触发数。
 *
 * 基于持久化的 schedule 数据，按 created_at 过滤当天 00:00 之后的触发。
 *
 * @param schedule 任务的调度状态
 * @param now 当前时间戳 (ms)
 */
export function countTodayTriggers(schedule: TaskSchedule, now: number = Date.now()): number {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  return schedule.pending_triggers.filter(
    (t) => t.created_at >= todayStartMs,
  ).length;
}
