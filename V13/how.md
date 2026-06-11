# How does AgentOS V13 work?

> V13 在 V12 基础上添加 3 个新模块（~370 行）+ 修改 5 个模块（~110 行）。V12 的状态机代码完全不变——V13 只在 trigger 层和 session hook 中添加代码。总增量 < 500 行。

---

## 零、前置依赖

```typescript
// V13 的所有新代码依赖于 V12 的以下类型和函数（不修改它们）:
import {
  TaskOrchestrationState,
  TaskState,
  SubtaskState,
  SubtaskDefinition,
  PlanDocument,
  VerificationResult,
  TriggerSource,
  ActivationMode,
  advanceOuterLoop,
  activateSubtask,
  markSubtaskCompleting,
  markSubtaskBlocked,
  processSubtaskOutcome,
  getActiveSubtask,
  getPhaseSubtasks,
  isPhaseComplete,
  isAllSubtasksDone,
  getProgressSummary,
} from './task-orchestrator';

import { verifyCompletion } from './verifier';
import { generatePlan } from './plan-generator';
import { GovernancePolicy } from '../config';
```

---

## 一、task-scheduler.ts [新 V13] (~120 行)

```typescript
// orchestration/task-scheduler.ts
// V13: 主动触发决策引擎
// 在 session_end 时被调用，决定是否/何时/如何触发下一个动作

import { TaskOrchestrationState, SubtaskDefinition, TriggerSource } from './task-orchestrator';
import { GovernancePolicy } from '../config';

// ── Types ──

interface TaskSchedule {
  task_id: string;
  pending_triggers: ScheduledTrigger[];
  last_trigger_at: number | null;
  next_trigger_at: number | null;
  active_cron_job_ids: string[];
}

interface ScheduledTrigger {
  trigger_id: string;
  trigger_source: 'cron:scheduled' | 'heartbeat:wake';
  scheduled_at: number;
  mechanism: 'scheduleSessionTurn' | 'cron_job';
  cron_job_id?: string;
  reason: string;
  subtask_id?: string;
  status: 'pending' | 'fired' | 'cancelled';
  created_at: number;
}

interface TriggerDecision {
  should_trigger: boolean;
  mechanism: 'scheduleSessionTurn' | 'cron_job' | 'subagent_run' | 'none';
  delay_ms?: number;           // 多久后触发
  at_time?: number;             // 绝对时间戳
  reason: string;
  skip_reasons: string[];       // 被跳过但可能下次触发的条件
}

// ── TriggerAdapter 接口（抽象 scheduleSessionTurn vs cron fallback）──

interface TriggerAdapter {
  scheduleTurn(params: {
    sessionKey: string;
    message: string;
    at?: number;
    delayMs?: number;
    cron?: string;
    tag: string;
  }): Promise<{ jobId: string } | null>;

  cancelTurn(jobId: string): Promise<void>;
}

// ── 触发决策矩阵 ──

export function evaluateTrigger(
  state: TaskOrchestrationState,
  policy: GovernancePolicy,
  currentTime: number = Date.now()
): TriggerDecision {
  const skipReasons: string[] = [];

  // 1. 检查自动驾驶是否开启
  if (!policy.active_triggering?.enabled) {
    return { should_trigger: false, mechanism: 'none', reason: 'disabled', skip_reasons: ['自动驾驶未开启'] };
  }

  // 2. 检查静默时段
  if (isInQuietHours(currentTime, policy.active_triggering)) {
    skipReasons.push('当前在静默时段');
  }

  // 3. 检查每日触发上限
  const todaysTriggers = countTodayTriggers(state);
  if (todaysTriggers >= policy.active_triggering.max_triggers_per_day) {
    return { should_trigger: false, mechanism: 'none', reason: 'daily_limit', skip_reasons: ['已达每日触发上限'] };
  }

  // 4. 检查最小间隔
  const schedule = loadTaskSchedule(state.task_id);
  if (schedule?.last_trigger_at && (currentTime - schedule.last_trigger_at) <
      policy.active_triggering.min_interval_between_triggers_minutes * 60 * 1000) {
    skipReasons.push('距上次触发时间过短');
  }

  // 5. 任务已完成或废弃 → 不触发
  if (state.task_state === 'TASK_COMPLETE' || state.task_state === 'TASK_ABANDONED') {
    return { should_trigger: false, mechanism: 'none', reason: 'task_ended', skip_reasons: ['任务已结束'] };
  }

  // 6. 检查是否有 PENDING 子任务
  const nextSubtask = findNextPendingSubtask(state);
  if (!nextSubtask) {
    return { should_trigger: false, mechanism: 'none', reason: 'no_pending', skip_reasons: ['没有待执行的子任务'] };
  }

  // 7. 决策: 并行 vs 定时
  if (canParallelize(nextSubtask, policy)) {
    // 独立子任务 → spawn 子 Agent
    return {
      should_trigger: true,
      mechanism: 'subagent_run',
      reason: `子任务 "${nextSubtask.subtask_name}" 无依赖可并行`,
      skip_reasons: skipReasons,
    };
  }

  // 8. 决策: 定时触发
  const estimatedMs = (nextSubtask.estimated_duration_minutes || 60) * 60 * 1000;

  if (estimatedMs < 60 * 60 * 1000) {  // < 1 小时
    return {
      should_trigger: true,
      mechanism: 'scheduleSessionTurn',
      delay_ms: estimatedMs,
      reason: `子任务 "${nextSubtask.subtask_name}" 估计 ${nextSubtask.estimated_duration_minutes}min`,
      skip_reasons: skipReasons,
    };
  } else if (estimatedMs < 24 * 60 * 60 * 1000) {  // < 24 小时
    return {
      should_trigger: true,
      mechanism: 'scheduleSessionTurn',
      at_time: currentTime + estimatedMs,
      reason: `子任务 "${nextSubtask.subtask_name}" 估计 ${nextSubtask.estimated_duration_minutes}min`,
      skip_reasons: skipReasons,
    };
  } else {
    // 长时间任务: 使用定期 cron + heartbeat
    return {
      should_trigger: true,
      mechanism: 'cron_job',
      reason: `长运行子任务 "${nextSubtask.subtask_name}" 需要定期检查`,
      skip_reasons: skipReasons,
    };
  }
}

// ── 触发执行 ──

export async function executeTrigger(
  decision: TriggerDecision,
  state: TaskOrchestrationState,
  adapter: TriggerAdapter,
  sessionKey: string,
  policy: GovernancePolicy
): Promise<ScheduledTrigger | null> {
  if (!decision.should_trigger) return null;

  // 去重检查
  const existingSchedule = loadTaskSchedule(state.task_id);
  const duplicate = existingSchedule?.pending_triggers.find(
    t => t.reason === decision.reason && t.status === 'pending'
  );
  if (duplicate) {
    // 已有相同触发，跳过
    return null;
  }

  // 首次触发 → 需要用户确认?
  if (policy.active_triggering.require_user_confirmation_for?.includes('first_trigger_of_task')) {
    const triggerCount = countTaskTriggers(state.task_id);
    if (triggerCount === 0) {
      // TODO: 发送确认请求给用户，等待确认后再触发
      // 暂时返回 null，等待用户通过 /agentos task auto confirm 确认
      return null;
    }
  }

  const trigger: ScheduledTrigger = {
    trigger_id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    trigger_source: decision.mechanism === 'subagent_run' ? 'heartbeat:wake' : 'cron:scheduled',
    scheduled_at: decision.at_time || (Date.now() + (decision.delay_ms || 0)),
    mechanism: decision.mechanism === 'subagent_run' ? 'cron_job' : decision.mechanism,
    reason: decision.reason,
    status: 'pending',
    created_at: Date.now(),
  };

  try {
    if (decision.mechanism === 'scheduleSessionTurn') {
      const result = await adapter.scheduleTurn({
        sessionKey,
        message: `[AgentOS V13 自动触发] ${decision.reason}`,
        at: decision.at_time,
        delayMs: decision.delay_ms,
        tag: `agentos:task:${state.task_id}`,
      });
      if (result) {
        trigger.cron_job_id = result.jobId;
      }
    } else if (decision.mechanism === 'cron_job') {
      // 使用 cron 表达式进行定期检查
      const result = await adapter.scheduleTurn({
        sessionKey,
        message: `[AgentOS V13 定期检查] ${decision.reason}`,
        cron: '*/30 * * * *',  // 每 30 分钟检查一次
        tag: `agentos:task:${state.task_id}:heartbeat`,
      });
      if (result) {
        trigger.cron_job_id = result.jobId;
      }
    }
    // subagent_run 在 subagent-manager 中处理，不在这里
  } catch (err) {
    trigger.status = 'cancelled';
    console.error(`[task-scheduler] 触发失败: ${decision.reason}`, err);
  }

  // 持久化调度状态
  saveTrigger(state.task_id, trigger);

  return trigger;
}

// ── 辅助函数 ──

function isInQuietHours(now: number, policy: GovernancePolicy['active_triggering']): boolean {
  if (!policy?.quiet_hours) return false;
  const [start, end] = policy.quiet_hours.split('-');
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);

  const nowDate = new Date(now);
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  } else {
    // 跨午夜: 如 22:00-08:00
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
}

function countTodayTriggers(state: TaskOrchestrationState): number {
  const schedule = loadTaskSchedule(state.task_id);
  if (!schedule) return 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return schedule.pending_triggers.filter(t => t.created_at >= todayStart.getTime()).length;
}

function countTaskTriggers(taskId: string): number {
  const schedule = loadTaskSchedule(taskId);
  return schedule?.pending_triggers.length || 0;
}

function findNextPendingSubtask(state: TaskOrchestrationState): SubtaskDefinition | null {
  const phaseSubtasks = getPhaseSubtasks(state);
  return phaseSubtasks.find(s => s.state === 'SUBTASK_PENDING') || null;
}

function canParallelize(subtask: SubtaskDefinition, policy: GovernancePolicy): boolean {
  return (
    (subtask as any).parallelizable === true &&
    (!(subtask as any).depends_on || (subtask as any).depends_on.length === 0) &&
    policy.active_triggering?.allow_subagent_spawn === true
  );
}

// ── 持久化（通过 AgentMemory slot）──

function loadTaskSchedule(taskId: string): TaskSchedule | null {
  // memory_slot_get("task_schedule", { task_id: taskId })
  return null;  // 实现: AgentMemory 读取
}

function saveTrigger(taskId: string, trigger: ScheduledTrigger): void {
  // memory_slot_set("task_schedule", updatedSchedule)
  // 实现: 加载 → 追加 trigger → 保存
}

export function cancelTrigger(taskId: string, triggerId: string): void {
  // memory_slot_set("task_schedule", schedule with trigger removed)
}

export function markTriggerFired(taskId: string, triggerId: string): void {
  // memory_slot_set("task_schedule", schedule with trigger.status = 'fired')
}
```

---

## 二、subagent-manager.ts [新 V13] (~150 行)

```typescript
// orchestration/subagent-manager.ts
// V13: 并行子 Agent 生命周期管理
// 负责 spawn、监控、聚合子 Agent 结果

import { SubtaskDefinition, TaskOrchestrationState, VerificationResult } from './task-orchestrator';
import { ExpectedArtifact } from '../types/memory';
import { GovernancePolicy } from '../config';

// ── Types ──

interface SubagentRun {
  run_id: string;
  subtask_id: string;
  session_key: string;
  status: 'spawning' | 'running' | 'completed' | 'failed' | 'timeout';
  spawned_at: number;
  completed_at: number | null;
  result?: SubagentResult;
  retry_count: number;
  max_retries: number;
}

interface SubagentResult {
  run_id: string;
  status: 'ok' | 'error' | 'timeout';
  verification_results?: VerificationResult;
  artifacts?: ExpectedArtifact[];
  transcript_summary?: string;
}

interface SubagentRegistry {
  task_id: string;
  active_runs: SubagentRun[];
  completed_runs: SubagentRun[];
  max_parallel: number;
}

// ── SubagentManager ──

export class SubagentManager {
  private registry: SubagentRegistry;
  private policy: GovernancePolicy;

  constructor(taskId: string, policy: GovernancePolicy) {
    this.policy = policy;
    this.registry = this.loadRegistry(taskId) || {
      task_id: taskId,
      active_runs: [],
      completed_runs: [],
      max_parallel: policy.subagent_management?.max_parallel_subagents || 3,
    };
  }

  // 检查是否可以 spawn 更多子 Agent
  canSpawn(): boolean {
    const activeCount = this.registry.active_runs.filter(
      r => r.status === 'spawning' || r.status === 'running'
    ).length;
    return activeCount < this.registry.max_parallel;
  }

  // Spawn 一个子 Agent
  async spawnSubagent(
    subtask: SubtaskDefinition,
    orchState: TaskOrchestrationState,
    parentSessionKey: string,
    api: { subagent: { run: Function; waitForRun: Function } }
  ): Promise<SubagentRun | null> {
    if (!this.canSpawn()) {
      console.warn(`[subagent-manager] 达到并行上限 ${this.registry.max_parallel}，排队子任务 ${subtask.subtask_name}`);
      return null;
    }

    // 构建子 Agent 的上下文
    const systemPrompt = this.buildSubagentContext(subtask, orchState);

    const run: SubagentRun = {
      run_id: `sa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      subtask_id: subtask.subtask_id,
      session_key: '',  // 将由 api.subagent.run 返回的 session 填充
      status: 'spawning',
      spawned_at: Date.now(),
      completed_at: null,
      retry_count: 0,
      max_retries: this.policy.subagent_management?.max_retry_per_subagent || 2,
    };

    try {
      const result = await api.subagent.run({
        sessionKey: `agentos:subtask:${subtask.subtask_id}`,
        message: `执行子任务: ${subtask.subtask_name}\n\n${subtask.description}`,
        extraSystemPrompt: systemPrompt,
        deliver: false,  // 子 Agent 结果不直接发送给用户
      });

      run.session_key = result.runId;  // 实际实现中需要从 result 获取 session key
      run.status = 'running';

      this.registry.active_runs.push(run);
      this.saveRegistry();

      return run;
    } catch (err) {
      run.status = 'failed';
      console.error(`[subagent-manager] Spawn 失败: ${subtask.subtask_name}`, err);
      return run;
    }
  }

  // 等待子 Agent 完成
  async waitForCompletion(
    run: SubagentRun,
    api: { subagent: { waitForRun: Function } }
  ): Promise<SubagentResult | null> {
    const timeoutMs = (this.policy.subagent_management?.subagent_timeout_minutes || 60) * 60 * 1000;

    try {
      const result = await api.subagent.waitForRun({
        runId: run.run_id,
        timeoutMs,
      });

      const subagentResult: SubagentResult = {
        run_id: run.run_id,
        status: result.status === 'ok' ? 'ok' : result.status === 'timeout' ? 'timeout' : 'error',
      };

      run.completed_at = Date.now();

      if (result.status === 'ok') {
        run.status = 'completed';
        run.result = subagentResult;
      } else if (result.status === 'timeout') {
        run.status = 'timeout';
        run.result = { run_id: run.run_id, status: 'timeout' };
      } else {
        run.status = 'failed';
        run.result = { run_id: run.run_id, status: 'error' };
      }

      // 从 active 移到 completed
      this.registry.active_runs = this.registry.active_runs.filter(r => r.run_id !== run.run_id);
      this.registry.completed_runs.push(run);
      this.saveRegistry();

      return subagentResult;
    } catch (err) {
      run.status = 'failed';
      console.error(`[subagent-manager] 等待失败: ${run.subtask_id}`, err);
      return null;
    }
  }

  // 重试失败的子 Agent
  async retrySubagent(
    run: SubagentRun,
    subtask: SubtaskDefinition,
    orchState: TaskOrchestrationState,
    parentSessionKey: string,
    api: { subagent: { run: Function; waitForRun: Function } }
  ): Promise<SubagentRun | null> {
    if (run.retry_count >= run.max_retries) {
      console.warn(`[subagent-manager] 子任务 ${subtask.subtask_name} 已达最大重试次数 ${run.max_retries}`);
      run.status = 'failed';
      return run;
    }

    run.retry_count++;
    run.spawned_at = Date.now();
    run.status = 'spawning';

    return this.spawnSubagent(subtask, orchState, parentSessionKey, api);
  }

  // 聚合所有完成的子 Agent 结果
  aggregateResults(): {
    success: SubagentRun[];
    failed: SubagentRun[];
    timeout: SubagentRun[];
    summary: string;
  } {
    const completed = this.registry.completed_runs;
    const success = completed.filter(r => r.status === 'completed');
    const failed = completed.filter(r => r.status === 'failed');
    const timeout = completed.filter(r => r.status === 'timeout');

    const summary = [
      `并行执行汇总:`,
      `  ✅ 成功: ${success.length} (${success.map(r => r.subtask_id).join(', ') || '无'})`,
      `  ❌ 失败: ${failed.length} (${failed.map(r => r.subtask_id).join(', ') || '无'})`,
      `  ⏱ 超时: ${timeout.length} (${timeout.map(r => r.subtask_id).join(', ') || '无'})`,
    ].join('\n');

    return { success, failed, timeout, summary };
  }

  // 获取活跃子 Agent 状态
  getActiveRuns(): SubagentRun[] {
    return this.registry.active_runs.filter(
      r => r.status === 'spawning' || r.status === 'running'
    );
  }

  // 构建子 Agent 上下文（精简版）
  private buildSubagentContext(
    subtask: SubtaskDefinition,
    orchState: TaskOrchestrationState
  ): string {
    const lines: string[] = [];

    lines.push('[AgentOS V13 子 Agent 上下文]');
    lines.push('');
    lines.push(`## 任务: ${orchState.plan?.task_name || '未命名'}`);
    lines.push(`阶段: Phase ${subtask.phase_index + 1} — ${subtask.phase_name}`);
    lines.push(`子任务: ${subtask.subtask_name}`);
    lines.push('');
    lines.push('## 子任务描述');
    lines.push(subtask.description);
    lines.push('');
    lines.push('## 验收标准');
    for (const c of subtask.completion_criteria) {
      lines.push(`- [${c.type}] ${c.description}`);
    }
    lines.push('');
    lines.push('## 允许的操作');
    lines.push(subtask.allowed_operations.join(', '));
    lines.push('');
    if (subtask.pitfalls_warned.length > 0) {
      lines.push('## ⚠️ 陷阱预警');
      for (const pId of subtask.pitfalls_warned) {
        const pitfall = orchState.plan?.pitfalls.find(p => p.pitfall_id === pId);
        if (pitfall) {
          lines.push(`- [${pitfall.severity}] ${pitfall.description}`);
          lines.push(`  缓解: ${pitfall.mitigation}`);
        }
      }
      lines.push('');
    }
    lines.push('## 输出要求');
    lines.push('完成后请输出完成报告，包含:');
    lines.push('1. 完成的工作内容');
    lines.push('2. 遇到的关键问题及解决方案');
    lines.push('3. 验收标准检查结果');

    return lines.join('\n');
  }

  // ── 持久化 ──

  private loadRegistry(taskId: string): SubagentRegistry | null {
    // memory_slot_get("subagent_registry", { task_id: taskId })
    return null;
  }

  private saveRegistry(): void {
    // memory_slot_set("subagent_registry", this.registry)
  }
}
```

---

## 三、heartbeat-monitor.ts [新 V13] (~100 行)

```typescript
// services/heartbeat-monitor.ts
// V13: 后台心跳监控服务
// 注册为 OpenClaw Service，持续监控活跃子任务，检测停滞并分级介入

import { TaskOrchestrationState, SubtaskDefinition } from '../orchestration/task-orchestrator';
import { GovernancePolicy } from '../config';

// ── Types ──

interface HeartbeatState {
  task_id: string;
  subtask_id: string;
  subtask_started_at: number;
  estimated_duration_ms: number;
  last_progress_at: number;
  stall_threshold_ms: number;
  heartbeat_count: number;
  interventions: HeartbeatIntervention[];
}

interface HeartbeatIntervention {
  triggered_at: number;
  type: 'nudge' | 'escalate' | 'replan';
  reason: string;
  action: 'request_heartbeat' | 'cancel_subtask' | 'notify_user';
  outcome?: string;
}

// ── OpenClaw Service 定义 ──

export const heartbeatMonitorService = {
  id: 'agentos-heartbeat-monitor',

  async start(ctx: {
    config: { agentos?: GovernancePolicy };
    logger: { info: Function; warn: Function; error: Function };
  }): Promise<void> {
    const policy = ctx.config?.agentos;
    if (!policy?.active_triggering?.allow_heartbeat_monitor) {
      ctx.logger.info('[heartbeat-monitor] 心跳监控未启用，跳过');
      return;
    }

    ctx.logger.info('[heartbeat-monitor] 启动心跳监控服务');

    const checkIntervalMs = Math.min(
      5 * 60 * 1000,  // 默认 5 分钟
      (policy.active_triggering.max_heartbeat_checks_per_hour
        ? 60 * 60 * 1000 / policy.active_triggering.max_heartbeat_checks_per_hour
        : 5 * 60 * 1000)
    );

    // 定期检查循环
    const intervalId = setInterval(async () => {
      try {
        await runHeartbeatCheck(policy);
      } catch (err) {
        ctx.logger.error('[heartbeat-monitor] 检查失败', err);
      }
    }, checkIntervalMs);

    // 返回清理函数
    return () => clearInterval(intervalId);
  },

  async stop(ctx: { logger: { info: Function } }): Promise<void> {
    ctx.logger.info('[heartbeat-monitor] 停止心跳监控服务');
  },
};

// ── 心跳检查逻辑 ──

async function runHeartbeatCheck(policy: GovernancePolicy): Promise<void> {
  // 1. 加载所有 TASK_IN_PROGRESS 的任务
  const activeTasks = loadActiveTasks();  // 从 AgentMemory 加载

  for (const task of activeTasks) {
    const activeSubtask = getActiveSubtask(task);
    if (!activeSubtask || activeSubtask.state !== 'SUBTASK_ACTIVE') continue;

    const heartbeat = loadHeartbeatState(task.task_id, activeSubtask.subtask_id);

    // 2. 检查是否停滞
    const now = Date.now();
    const elapsed = now - (activeSubtask.started_at || now);
    const estimatedMs = (activeSubtask.estimated_duration_minutes || 60) * 60 * 1000;
    const stallThreshold = estimatedMs * (policy.active_triggering?.stall_threshold_multiplier || 2.0);

    if (elapsed > stallThreshold) {
      // 停滞检测
      const existingIntervention = heartbeat?.interventions.find(
        i => i.type === 'nudge' && (now - i.triggered_at) < 60 * 60 * 1000
      );

      if (!existingIntervention) {
        await handleStall(task, activeSubtask, elapsed, estimatedMs, stallThreshold, policy);
      }
    }

    // 3. 更新心跳计数
    saveHeartbeatState({
      ...heartbeat,
      task_id: task.task_id,
      subtask_id: activeSubtask.subtask_id,
      subtask_started_at: activeSubtask.started_at || now,
      estimated_duration_ms: estimatedMs,
      last_progress_at: now,
      stall_threshold_ms: stallThreshold,
      heartbeat_count: (heartbeat?.heartbeat_count || 0) + 1,
      interventions: heartbeat?.interventions || [],
    } as HeartbeatState);
  }
}

// ── 分级响应 ──

async function handleStall(
  task: TaskOrchestrationState,
  subtask: SubtaskDefinition,
  elapsed: number,
  estimated: number,
  threshold: number,
  policy: GovernancePolicy
): Promise<void> {
  const intervention: HeartbeatIntervention = {
    triggered_at: Date.now(),
    type: 'nudge',
    reason: `子任务 "${subtask.subtask_name}" 超过估计时间 ${Math.round(elapsed / 3600000)}h (阈值: ${Math.round(threshold / 3600000)}h)`,
    action: 'request_heartbeat',
  };

  // Level 1: Nudge — 注入提醒到当前 session
  const hasActiveSession = checkActiveSession(task.task_id);
  if (hasActiveSession) {
    // 在下一次 prompt 构建时注入提醒
    enqueueSystemEvent(
      `⚠️ [AgentOS V13] 子任务 "${subtask.subtask_name}" 运行时间超过预期。` +
      `已运行 ${Math.round(elapsed / 3600000)}h，估计 ${Math.round(estimated / 3600000)}h。` +
      `建议: 检查进展，或标记为 BLOCKED。`,
      { sessionKey: task.active_session_id!, contextKey: 'heartbeat_nudge' }
    );
    intervention.action = 'request_heartbeat';  // 标记为 nudge
  } else {
    // Level 2: Wake — 无活跃 session → 创建新 session
    const stalledHours = elapsed / 3600000;
    if (stalledHours > (policy.active_triggering?.auto_cancel_stalled_after_hours || 24)) {
      // Level 3: Escalate — 长时间停滞 → 强制介入
      intervention.type = 'escalate';
      intervention.action = 'cancel_subtask';
      intervention.reason += ' — 超过自动取消阈值，标记为 BLOCKED';
      // 推进外循环：标记子任务 BLOCKED
      markSubtaskBlocked(task, subtask.subtask_id, 'pitfall_hit', intervention.reason);
    } else {
      // 中等停滞 → 唤醒
      requestHeartbeat({
        source: 'interval',
        intent: 'event',
        reason: intervention.reason,
        sessionKey: task.active_session_id || undefined,
      });
      intervention.action = 'request_heartbeat';
    }
  }

  // 记录干预
  const heartbeat = loadHeartbeatState(task.task_id, subtask.subtask_id);
  if (heartbeat) {
    heartbeat.interventions.push(intervention);
    saveHeartbeatState(heartbeat);
  }
}

// ── 辅助函数（stub，实际实现依赖 AgentMemory + OpenClaw API）──

function loadActiveTasks(): TaskOrchestrationState[] {
  // memory_smart_search("task_orchestration_state", { task_state: "TASK_IN_PROGRESS" })
  return [];
}

function loadHeartbeatState(taskId: string, subtaskId: string): HeartbeatState | null {
  // memory_slot_get("heartbeat_state", { task_id: taskId, subtask_id: subtaskId })
  return null;
}

function saveHeartbeatState(state: HeartbeatState): void {
  // memory_slot_set("heartbeat_state", state)
}

function checkActiveSession(taskId: string): boolean {
  // 检查 task 是否有活跃的 session
  return false;
}

// 以下函数来自 OpenClaw runtime API（实际实现中通过 api.runtime.system 调用）:
declare function enqueueSystemEvent(text: string, opts: { sessionKey: string; contextKey?: string }): boolean;
declare function requestHeartbeat(opts: { source: string; intent: string; reason: string; sessionKey?: string }): void;
```

---

## 四、task-orchestrator.ts [V13 修改] (~40 行增量)

```typescript
// orchestration/task-orchestrator.ts
// V13 修改：在 activateSubtask() 中添加 ActivationMode 'subagent' 路径
// 原 V12 代码不变，以下是 V13 增量

// ── activateSubtask() V13 修改 ──
// 在原函数 (V12 how.md 第 189-209 行) 中添加以下分支:

export function activateSubtaskV13(
  state: TaskOrchestrationState,
  subtaskId: string,
  mode: ActivationMode,
  subagentManager?: import('./subagent-manager').SubagentManager
): SubtaskDefinition {
  const subtask = state.subtasks.find(s => s.subtask_id === subtaskId);
  if (!subtask) throw new Error(`Subtask not found: ${subtaskId}`);

  if (mode === 'subagent') {
    // V13: 子 Agent 模式 — 委托给 subagent-manager
    // 不在这里阻塞等待，返回 subtask 让调用方 spawn
    subtask.state = 'SUBTASK_ACTIVE';
    subtask.started_at = Date.now();
    subtask.assigned_session_id = `subagent:pending`;  // 标记为待 spawn
    state.active_subtask_id = subtaskId;
    state.inner_loop.current_subtask_started_at = Date.now();
    state.inner_loop.tool_call_count = 0;
    state.inner_loop.user_correction_count = 0;

    // 实际的 subagent.run() 调用在 session-end hook 中由 task-scheduler 触发
    // 这样 session-end 统一管理所有触发决策
    return subtask;
  }

  // V12: inline 模式 — 原逻辑不变
  subtask.state = 'SUBTASK_ACTIVE';
  subtask.started_at = Date.now();
  subtask.assigned_session_id = state.active_session_id;
  state.active_subtask_id = subtaskId;
  state.inner_loop.current_subtask_started_at = Date.now();
  state.inner_loop.tool_call_count = 0;
  state.inner_loop.user_correction_count = 0;

  return subtask;
}

// ── scheduleNextAction() [V13 新增方法] ──
// 在 task-orchestrator 中新增，供 session-end hook 调用

export interface ScheduleNextActionResult {
  trigger_decision: import('./task-scheduler').TriggerDecision;
  scheduled_trigger: import('./task-scheduler').ScheduledTrigger | null;
  subagent_spawned: boolean;
}

export async function scheduleNextAction(
  state: TaskOrchestrationState,
  policy: GovernancePolicy,
  adapter: import('./task-scheduler').TriggerAdapter,
  sessionKey: string,
  subagentManager: import('./subagent-manager').SubagentManager | null,
  api: { subagent: { run: Function } } | null
): Promise<ScheduleNextActionResult> {
  const { evaluateTrigger, executeTrigger } = await import('./task-scheduler');

  const decision = evaluateTrigger(state, policy);
  let scheduledTrigger = null;
  let subagentSpawned = false;

  if (decision.mechanism === 'subagent_run' && subagentManager && api) {
    // 并行路径: spawn 子 Agent
    const nextSubtask = state.subtasks.find(s => s.state === 'SUBTASK_PENDING');
    if (nextSubtask) {
      const run = await subagentManager.spawnSubagent(nextSubtask, state, sessionKey, api);
      if (run) {
        subagentSpawned = true;
        activateSubtaskV13(state, nextSubtask.subtask_id, 'subagent', subagentManager);
      }
    }
  } else {
    // 定时触发路径
    scheduledTrigger = await executeTrigger(decision, state, adapter, sessionKey, policy);
  }

  return { trigger_decision: decision, scheduled_trigger, subagent_spawned: subagentSpawned };
}
```

---

## 五、hooks/session-end.ts [V13 修改] (~30 行增量)

```typescript
// hooks/session-end.ts
// V13 修改：在 session_end 末尾添加主动调度逻辑
// 原 V12 session-end 代码之后，添加以下:

// ... V12 session-end 完整逻辑（验证 + 陷阱 + 推进外循环）...

// ── V13 增量: 主动调度 ──
async function scheduleNextIfEnabled(
  state: TaskOrchestrationState,
  ctx: SessionEndContext,
  policy: GovernancePolicy
): Promise<void> {
  // 仅在自动驾驶开启时执行
  if (!policy.active_triggering?.enabled) return;
  if (state.task_state === 'TASK_COMPLETE' || state.task_state === 'TASK_ABANDONED') return;

  const { scheduleNextAction } = await import('../orchestration/task-orchestrator');
  const { createTriggerAdapter } = await import('../orchestration/task-scheduler');

  // 选择 TriggerAdapter（bundled vs cron fallback）
  const adapterMode = policy.trigger_adapter?.mode || 'auto';
  const adapter = createTriggerAdapter(adapterMode, ctx);

  // 获取 subagent manager（如果并行执行启用）
  const subagentMgr = policy.active_triggering?.allow_subagent_spawn
    ? new (await import('../orchestration/subagent-manager')).SubagentManager(state.task_id, policy)
    : null;

  // 执行调度决策
  const result = await scheduleNextAction(
    state,
    policy,
    adapter,
    ctx.sessionKey,
    subagentMgr,
    ctx.api  // OpenClaw plugin API
  );

  // 记录调度结果
  if (result.scheduled_trigger) {
    console.log(`[session-end] 已注册定时触发: ${result.scheduled_trigger.reason}`);
  }
  if (result.subagent_spawned) {
    console.log(`[session-end] 已 spawn 并行子 Agent`);
  }
}
```

---

## 六、hooks/session-start.ts [V13 修改] (~15 行增量)

```typescript
// hooks/session-start.ts
// V13 修改：处理非 hook 触发源 + 恢复调度状态
// 在原 V12 session-start 代码中添加:

async function onSessionStartV13(ctx: SessionStartContext): Promise<void> {
  // ... V12 原有逻辑（加载 orchestrator state + 生成计划 + 注入上下文）...

  // ── V13 增量: 识别触发源 ──
  const triggerSource = detectTriggerSource(ctx);

  if (triggerSource === 'cron:scheduled') {
    // 由 scheduleSessionTurn / cron 触发
    // 注入额外的上下文，告诉 LLM 这是自动触发的 session
    ctx.injectToPrompt('layer_1', buildAutoTriggerNotice(ctx));
  } else if (triggerSource === 'heartbeat:wake') {
    // 由 heartbeat-monitor 唤醒
    // 注入停滞检测上下文
    ctx.injectToPrompt('layer_1', buildHeartbeatWakeNotice(ctx));
  }

  // ── V13 增量: 恢复调度状态 ──
  const schedule = loadTaskSchedule(ctx.taskId);
  if (schedule) {
    // 清理已过期的触发
    const now = Date.now();
    const expiredTriggers = schedule.pending_triggers.filter(
      t => t.scheduled_at < now - 60 * 60 * 1000 && t.status === 'pending'  // 延迟 1 小时以上的未触发
    );
    for (const trigger of expiredTriggers) {
      cancelTrigger(ctx.taskId, trigger.trigger_id);
    }
    // 标记匹配的触发为 fired
    const matchingTrigger = schedule.pending_triggers.find(
      t => t.status === 'pending' && Math.abs(t.scheduled_at - now) < 10 * 60 * 1000  // 10 分钟内的
    );
    if (matchingTrigger) {
      markTriggerFired(ctx.taskId, matchingTrigger.trigger_id);
    }
  }
}

// ── 辅助函数 ──

function detectTriggerSource(ctx: SessionStartContext): TriggerSource {
  // 检查 system events 中是否有 AgentOS 自动触发的标记
  const hasAutoTrigger = ctx.systemEvents?.some(
    e => e.includes('[AgentOS V13 自动触发]')
  );
  if (hasAutoTrigger) return 'cron:scheduled';

  const hasHeartbeatWake = ctx.systemEvents?.some(
    e => e.includes('[AgentOS V13 停滞检测]')
  );
  if (hasHeartbeatWake) return 'heartbeat:wake';

  // 默认: Hook 触发
  return 'hook:session_start';
}

function buildAutoTriggerNotice(ctx: SessionStartContext): string {
  return [
    '',
    '> 📅 [AgentOS V13] 此会话由自动驾驶模式自动触发。',
    '> 上一个子任务已完成，当前子任务已准备好上下文。',
    '> 使用 /agentos task auto off 关闭自动驾驶。',
    '',
  ].join('\n');
}

function buildHeartbeatWakeNotice(ctx: SessionStartContext): string {
  return [
    '',
    '> ⚠️ [AgentOS V13] 此会话由停滞检测触发。',
    '> 检测到活跃子任务可能停滞——运行时间超过预期。',
    '> 请检查当前子任务的状态，必要时标记为 BLOCKED 或重新计划。',
    '',
  ].join('\n');
}
```

---

## 七、plan-generator.ts [V13 修改] (~15 行增量)

```typescript
// orchestration/plan-generator.ts
// V13 修改：在子任务生成时添加并行化标记

// 在 generatePlan() 中，为每个 phase 的 subtasks 添加并行化分析:

function analyzeParallelization(
  subtasks: SubtaskDefinition[],
  phaseIndex: number
): void {
  // 为每个子任务标记并行化属性
  for (const subtask of subtasks) {
    // 默认: 检查是否有依赖
    const hasDeps = subtask.dependencies && subtask.dependencies.length > 0;

    // [V13] 扩展 SubtaskDefinition 以包含并行化标记
    (subtask as any).parallelizable = !hasDeps;
    (subtask as any).depends_on = subtask.dependencies || [];

    // 如果无依赖且不是第一个子任务（第一个可能需要建立基础）
    if (!hasDeps && subtasks.indexOf(subtask) > 0) {
      (subtask as any).parallelizable = true;
    }
  }

  // 同一 phase 内，标记可以并行的子任务组
  const parallelGroup = subtasks.filter(s => (s as any).parallelizable);
  if (parallelGroup.length > 1) {
    // 为每个并行子任务添加并行组标记
    for (const s of parallelGroup) {
      (s as any).parallel_group = `phase_${phaseIndex}_parallel`;
    }
  }
}

// 在 generatePlan() 的 Phase 生成循环中调用:
// for (const phase of phases) {
//   analyzeParallelization(phase.subtasks, phase.phase_index);
// }
```

---

## 八、verifier.ts [V13 修改] (~10 行增量)

```typescript
// orchestration/verifier.ts
// V13 修改：支持异步验证结果（子 Agent 完成后的回调）

// ── V13 新增函数 ──

export async function verifySubagentResult(
  subtask: SubtaskDefinition,
  subagentResult: import('./subagent-manager').SubagentResult
): Promise<VerificationResult> {
  // 如果子 Agent 已经包含了验证结果，直接使用
  if (subagentResult.verification_results) {
    return subagentResult.verification_results;
  }

  // 否则运行标准验证
  // 注意: 子 Agent 在独立 session 中运行，文件/命令验证需要在父 session 上下文中执行
  // 因此优先信任子 Agent 的自报结果，仅对 file_existence 和 command_output 类型进行确认性验证

  const confirmCriteria = subtask.completion_criteria.filter(
    c => c.type === 'file_existence' || c.type === 'command_output'
  );

  if (confirmCriteria.length > 0) {
    // 对可自动验证的标准进行确认
    return verifyCompletion(subtask, { criteriaFilter: confirmCriteria.map(c => c.criterion_id) });
  }

  // 如果子 Agent 报告成功但无可自动验证的标准 → 信任子 Agent
  return {
    subtask_id: subtask.subtask_id,
    criteria_results: subtask.completion_criteria.map(c => ({
      criterion_id: c.criterion_id,
      status: 'passed',  // 信任子 Agent
      evidence: '子 Agent 报告完成，无可自动验证的标准',
    })),
    overall: 'verified',
    remediation: [],
  };
}
```

---

## 九、TriggerAdapter 实现 [V13]

```typescript
// orchestration/task-scheduler.ts (续)
// TriggerAdapter 的两个实现

import { TriggerAdapter } from './task-scheduler';

// ── Bundled 实现: 使用 scheduleSessionTurn ──

export class BundledTriggerAdapter implements TriggerAdapter {
  constructor(private api: { session: { workflow: { scheduleSessionTurn: Function } } }) {}

  async scheduleTurn(params: {
    sessionKey: string;
    message: string;
    at?: number;
    delayMs?: number;
    cron?: string;
    tag: string;
  }): Promise<{ jobId: string } | null> {
    const scheduleParams: any = {
      sessionKey: params.sessionKey,
      message: params.message,
      tag: params.tag,
    };

    if (params.cron) {
      scheduleParams.cron = params.cron;
    } else if (params.at) {
      scheduleParams.at = new Date(params.at).toISOString();
    } else if (params.delayMs) {
      scheduleParams.delayMs = params.delayMs;
    }

    const result = await this.api.session.workflow.scheduleSessionTurn(scheduleParams);
    return result ? { jobId: result.id } : null;
  }

  async cancelTurn(jobId: string): Promise<void> {
    // 通过 tag 取消
    await this.api.session.workflow.unscheduleSessionTurnsByTag(jobId);
  }
}

// ── Cron 降级实现: 使用 cron 系统 ──

export class CronTriggerAdapter implements TriggerAdapter {
  constructor(
    private cronService: {
      add: Function;
      remove: Function;
    },
    private sessionKey: string
  ) {}

  async scheduleTurn(params: {
    sessionKey: string;
    message: string;
    at?: number;
    delayMs?: number;
    cron?: string;
    tag: string;
  }): Promise<{ jobId: string } | null> {
    const jobName = `agentos:trigger:${params.tag}:${Date.now()}`;

    let schedule: { kind: string; at?: string; everyMs?: number; expr?: string };

    if (params.cron) {
      schedule = { kind: 'cron', expr: params.cron };
    } else if (params.at) {
      schedule = { kind: 'at', at: new Date(params.at).toISOString() };
    } else if (params.delayMs) {
      schedule = { kind: 'every', everyMs: params.delayMs };
    } else {
      return null;
    }

    const result = await this.cronService.add({
      name: jobName,
      enabled: true,
      schedule,
      sessionTarget: `session:${params.sessionKey}`,
      payload: {
        kind: 'agentTurn',
        message: params.message,
      },
    });

    return result?.id ? { jobId: result.id } : null;
  }

  async cancelTurn(jobId: string): Promise<void> {
    await this.cronService.remove(jobId);
  }
}

// ── 工厂函数 ──

export function createTriggerAdapter(
  mode: 'auto' | 'bundled' | 'cron',
  ctx: any  // Hook context
): TriggerAdapter {
  if (mode === 'bundled') {
    return new BundledTriggerAdapter(ctx.api);
  }

  if (mode === 'cron') {
    return new CronTriggerAdapter(ctx.cronService, ctx.sessionKey);
  }

  // auto: 自动检测
  try {
    // 尝试获取 scheduleSessionTurn API
    if (ctx.api?.session?.workflow?.scheduleSessionTurn) {
      return new BundledTriggerAdapter(ctx.api);
    }
  } catch {
    // fallthrough to cron
  }

  // 降级到 cron
  if (ctx.cronService) {
    return new CronTriggerAdapter(ctx.cronService, ctx.sessionKey);
  }

  throw new Error('[task-scheduler] 无法创建 TriggerAdapter: 没有可用的触发机制');
}
```

---

## 十、config.ts [V13 修改] (~20 行增量)

```typescript
// config.ts
// V13 修改：在 GovernancePolicy 中添加 activeTriggering 和 subagentManagement 配置段

// V13 新增配置类型
interface ActiveTriggeringConfig {
  enabled: boolean;                          // 默认 false
  allow_schedule_session_turn: boolean;      // 默认 true
  allow_subagent_spawn: boolean;             // 默认 true
  allow_heartbeat_monitor: boolean;          // 默认 true
  allow_background_service: boolean;         // 默认 true
  max_parallel_subagents: number;            // 默认 3
  min_interval_between_triggers_minutes: number;  // 默认 30
  max_triggers_per_day: number;              // 默认 8
  quiet_hours: string;                       // 默认 "22:00-08:00"
  quiet_hours_timezone: string;              // 默认 "Asia/Shanghai"
  require_user_confirmation_for: string[];   // 默认 ["first_trigger_of_task", "subagent_spawn"]
  stall_threshold_multiplier: number;        // 默认 2.0
  auto_cancel_stalled_after_hours: number;   // 默认 24
  max_heartbeat_checks_per_hour: number;     // 默认 12
  trigger_failure_backoff_minutes: number;   // 默认 30
}

interface SubagentManagementConfig {
  max_parallel_subagents: number;            // 默认 3
  subagent_timeout_minutes: number;          // 默认 60
  max_retry_per_subagent: number;            // 默认 2
  inherit_parent_context: boolean;           // 默认 true
  inherit_relevant_structures: boolean;      // 默认 true
  aggregate_results_in_parent: boolean;      // 默认 true
  cleanup_subagent_sessions: boolean;        // 默认 true
  subagent_model_override: string | null;    // 默认 null
}

interface TriggerAdapterConfig {
  mode: 'auto' | 'bundled' | 'cron';         // 默认 "auto"
  cron_fallback: {
    min_interval_minutes: number;            // 默认 5
    max_pending_jobs: number;                // 默认 20
    cleanup_completed_after_hours: number;   // 默认 1
  };
}

// V13 默认配置
const V13_DEFAULT_CONFIG = {
  active_triggering: {
    enabled: false,
    allow_schedule_session_turn: true,
    allow_subagent_spawn: true,
    allow_heartbeat_monitor: true,
    allow_background_service: true,
    max_parallel_subagents: 3,
    min_interval_between_triggers_minutes: 30,
    max_triggers_per_day: 8,
    quiet_hours: '22:00-08:00',
    quiet_hours_timezone: 'Asia/Shanghai',
    require_user_confirmation_for: ['first_trigger_of_task', 'subagent_spawn'],
    stall_threshold_multiplier: 2.0,
    auto_cancel_stalled_after_hours: 24,
    max_heartbeat_checks_per_hour: 12,
    trigger_failure_backoff_minutes: 30,
  },
  subagent_management: {
    max_parallel_subagents: 3,
    subagent_timeout_minutes: 60,
    max_retry_per_subagent: 2,
    inherit_parent_context: true,
    inherit_relevant_structures: true,
    aggregate_results_in_parent: true,
    cleanup_subagent_sessions: true,
    subagent_model_override: null,
  },
  trigger_adapter: {
    mode: 'auto',
    cron_fallback: {
      min_interval_minutes: 5,
      max_pending_jobs: 20,
      cleanup_completed_after_hours: 1,
    },
  },
};
```

---

## 十一、types/memory.ts [V13 修改] (~30 行增量)

```typescript
// types/memory.ts
// V13 新增类型

// ── TaskScheduler Types ──

interface TaskSchedule {
  task_id: string;
  pending_triggers: ScheduledTrigger[];
  last_trigger_at: number | null;
  next_trigger_at: number | null;
  active_cron_job_ids: string[];
}

interface ScheduledTrigger {
  trigger_id: string;
  trigger_source: 'cron:scheduled' | 'heartbeat:wake';
  scheduled_at: number;
  mechanism: 'scheduleSessionTurn' | 'cron_job';
  cron_job_id?: string;
  reason: string;
  subtask_id?: string;
  status: 'pending' | 'fired' | 'cancelled';
  created_at: number;
}

// ── SubagentManager Types ──

interface SubagentRun {
  run_id: string;
  subtask_id: string;
  session_key: string;
  status: 'spawning' | 'running' | 'completed' | 'failed' | 'timeout';
  spawned_at: number;
  completed_at: number | null;
  result?: SubagentResult;
  retry_count: number;
  max_retries: number;
}

interface SubagentResult {
  run_id: string;
  status: 'ok' | 'error' | 'timeout';
  verification_results?: import('../orchestration/verifier').VerificationResult;
  artifacts?: import('../orchestration/task-orchestrator').ExpectedArtifact[];
  transcript_summary?: string;
}

interface SubagentRegistry {
  task_id: string;
  active_runs: SubagentRun[];
  completed_runs: SubagentRun[];
  max_parallel: number;
}

// ── HeartbeatMonitor Types ──

interface HeartbeatState {
  task_id: string;
  subtask_id: string;
  subtask_started_at: number;
  estimated_duration_ms: number;
  last_progress_at: number;
  stall_threshold_ms: number;
  heartbeat_count: number;
  interventions: HeartbeatIntervention[];
}

interface HeartbeatIntervention {
  triggered_at: number;
  type: 'nudge' | 'escalate' | 'replan';
  reason: string;
  action: 'request_heartbeat' | 'cancel_subtask' | 'notify_user';
  outcome?: string;
}

// ── SubtaskDefinition V13 扩展字段 ──
// 以下字段通过 (subtask as any) 动态添加，不在类型定义中:
//   parallelizable?: boolean;     // 无依赖，可并行执行
//   depends_on?: string[];        // 依赖的子任务 ID 列表
//   parallel_group?: string;      // 并行组标识
```

---

## 十二、代码统计

```
V13 代码增量:

新增模块 (3):
  task-scheduler.ts     ~120 行  (决策矩阵 + TriggerAdapter + 持久化)
  subagent-manager.ts   ~150 行  (SubagentManager 类 + 上下文构建)
  heartbeat-monitor.ts  ~100 行  (Service 注册 + 分级响应 + 心跳循环)
  小计:                 ~370 行

修改模块 (5):
  task-orchestrator.ts   ~40 行  (ActivationMode + scheduleNextAction)
  session-end.ts         ~30 行  (scheduleNextIfEnabled)
  session-start.ts       ~15 行  (触发源识别 + 调度状态恢复)
  plan-generator.ts      ~15 行  (并行化标记分析)
  verifier.ts            ~10 行  (异步验证结果处理)
  小计:                 ~110 行

新增类型 (1):
  types/memory.ts        ~30 行  (TaskSchedule + SubagentRun + HeartbeatState)

新增配置 (1):
  config.ts              ~20 行  (activeTriggering + subagentManagement + triggerAdapter)

总计:                   ~530 行

V12 基础:               ~1065 行
V13 总代码量:           ~1595 行
V13 净增量:             ~530 行

⚠️ 此处存在不确定性：实际实现时可能因错误处理、日志、测试辅助函数等增加 10-20% 代码量。
  预估最终增量在 500-650 行之间。
```

---

## 兄弟文件

- [What is AgentOS V13?](what-is.md) — V13 定义 + 四个核心职能
- [Why AgentOS V13?](why.md) — 第一性原理：为什么被动响应不够
- [Who is it for?](who.md) — 三角色职责变化
- [When does it operate?](when.md) — Phase 7-9 路线图（+5 周）
- [Where does it sit?](where.md) — 完整模块树（V12 基础 + 3 新增 + services/ 目录）
- [Architecture Design](design.md) — 触发决策矩阵、并行执行协议、心跳监控协议
