# Praxis V13 Architecture Design

> 版本：v13 (Complete Cognitive OS)
> 状态：设计阶段
> 基于：V12 + OpenClaw 主动机制 (2026-06-11)

---

## 零、架构哲学：从"被动编排"到"主动驱动"

```
V12: Praxis 编排任务的结构（状态机），但不驱动任务的执行（等 Hook）
     → 状态机是完整的，但它是"等事件"的状态机

V13: Praxis 既编排任务的结构，又驱动任务的执行
     → 状态机不变 — 只在 trigger 层添加事件创造能力
     → V12 的 TriggerSource/ActivationMode 预留被激活

关键进化:
  V12 解决了 "Praxis 应该管理任务结构"（任务分解 + 状态机 + 验收）
  V13 解决了 "Praxis 应该驱动任务执行"（主动调度 + 并行 + 监控）

  状态机一行不改 — 这是 V12 前瞻设计正确的证据。
  V13 只在"谁调用 advanceOuterLoop()"这一点上扩展 — 从 2 个调用者到 5 个。
```

---

## 一、V13 核心数据模型

### 1.1 TaskSchedule（任务调度状态）

```typescript
interface TaskSchedule {
  task_id: string;
  pending_triggers: ScheduledTrigger[];
  last_trigger_at: number | null;
  next_trigger_at: number | null;
  active_cron_job_ids: string[];
}

interface ScheduledTrigger {
  trigger_id: string;                    // "trig_" + timestamp + random
  trigger_source: 'cron:scheduled' | 'heartbeat:wake';
  scheduled_at: number;                  // Unix timestamp
  mechanism: 'scheduleSessionTurn' | 'cron_job';
  cron_job_id?: string;                  // OpenClaw cron job ID (if applicable)
  reason: string;                        // Human-readable trigger reason
  subtask_id?: string;                   // Associated subtask
  status: 'pending' | 'fired' | 'cancelled';
  created_at: number;
}
```

### 1.2 SubagentRun（子 Agent 运行状态）

```typescript
interface SubagentRun {
  run_id: string;                        // "sa_" + timestamp + random
  subtask_id: string;
  session_key: string;                   // Subagent session key
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
  max_parallel: number;                  // GovernancePolicy 控制
}
```

### 1.3 HeartbeatState（心跳监控状态）

```typescript
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
```

### 1.4 SubtaskDefinition V13 扩展字段

```typescript
// V13 在 SubtaskDefinition 上添加（通过动态属性，不在类型定义中）:
//   parallelizable?: boolean;    // 无依赖，可并行执行
//   depends_on?: string[];       // 依赖的子任务 subtask_id 列表
//   parallel_group?: string;     // 并行组标识 (如 "phase_2_parallel")

// 这些字段由 plan-generator 的 analyzeParallelization() 填充
```

---

## 二、触发决策矩阵规格

### 2.1 决策流程

```
session_end
  │
  ▼
scheduleNextIfEnabled(state, ctx, policy)
  │
  ├── active_triggering.enabled === false? → RETURN (自动驾驶未开启)
  ├── task_state ∈ {COMPLETE, ABANDONED}?  → RETURN (任务已结束)
  │
  ▼
evaluateTrigger(state, policy)
  │
  ├── Guard 1: isInQuietHours(now, policy)?
  │   → Yes: skip_reasons += "静默时段", continue (不强制返回)
  │
  ├── Guard 2: todayTriggers >= max_triggers_per_day?
  │   → Yes: RETURN { should_trigger: false, reason: "daily_limit" }
  │
  ├── Guard 3: now - last_trigger_at < min_interval?
  │   → Yes: skip_reasons += "间隔过短"
  │
  ├── Guard 4: findNextPendingSubtask() === null?
  │   → Yes: RETURN { should_trigger: false, reason: "no_pending" }
  │
  ▼
  Decision Matrix:
  ┌────────────────────────────────────────────────────────────────┐
  │ 条件                                      │ 机制              │
  ├───────────────────────────────────────────┼───────────────────┤
  │ subtask.parallelizable && !depends_on     │ subagent_run      │
  │   && allow_subagent_spawn                │ (立即 spawn)      │
  ├───────────────────────────────────────────┼───────────────────┤
  │ estimated_duration < 1h                   │ scheduleSessionTurn│
  │   && allow_schedule_session_turn         │ (delayMs)         │
  ├───────────────────────────────────────────┼───────────────────┤
  │ estimated_duration 1h-24h                 │ scheduleSessionTurn│
  │   && allow_schedule_session_turn         │ (at: timestamp)   │
  ├───────────────────────────────────────────┼───────────────────┤
  │ estimated_duration > 24h                  │ cron_job          │
  │   && allow_background_service            │ (定期检查)        │
  ├───────────────────────────────────────────┼───────────────────┤
  │ User said "等我回来"                      │ none              │
  │   (detected via mid-session-learner)     │ (尊重用户意愿)    │
  └───────────────────────────────────────────┴───────────────────┘
```

### 2.2 Guard 详细规格

```
Guard 1: 静默时段检查
  输入: currentTime (Unix ms), policy.quiet_hours ("HH:MM-HH:MM")
  逻辑:
    [startH, startM] = parse(policy.quiet_hours.split('-')[0])
    [endH, endM] = parse(policy.quiet_hours.split('-')[1])
    nowMinutes = now.getHours() * 60 + now.getMinutes()
    startMinutes = startH * 60 + startM
    endMinutes = endH * 60 + endM
    if startMinutes <= endMinutes:
      return startMinutes <= nowMinutes < endMinutes
    else:  // 跨午夜
      return nowMinutes >= startMinutes || nowMinutes < endMinutes
  行为: 在静默时段内 → skip（记录原因但继续检查其他 guards）
       原因: 静默时段不强制阻止 — 如果其他条件不满足，仍会返回 false

Guard 2: 每日触发上限
  输入: task_schedule.pending_triggers (当天创建的)
  阈值: policy.max_triggers_per_day (默认 8)
  行为: 达到上限 → 强制返回 false，reason = "daily_limit"

Guard 3: 最小触发间隔
  输入: task_schedule.last_trigger_at, policy.min_interval_between_triggers_minutes
  行为: 间隔过短 → skip（不强制返回）

Guard 4: 无待执行子任务
  输入: TaskOrchestrationState.subtasks
  行为: 无 PENDING 子任务 → 强制返回 false
```

### 2.3 去重规格

```
executeTrigger() 在执行前:
  1. 加载 task_schedule
  2. 查找 pending_triggers 中 status='pending' + reason 相同的触发
  3. 如果找到且未过期 (scheduled_at > now - 10min):
     → 跳过，不创建重复触发
  4. 如果找到但已过期:
     → 取消旧触发，创建新触发

去重 key: task_id + reason (不是 trigger_id)
原因: 同一个原因（如"下一子任务 ready"）不应该有多个并行触发
```

---

## 三、并行执行协议

### 3.1 SubagentManager 生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│                    SubagentManager 生命周期                       │
│                                                                   │
│  spawnSubagent()                                                  │
│    │                                                              │
│    ├── canSpawn()? → No → return null (排队)                     │
│    │                                                              │
│    ├── buildSubagentContext(subtask, orchState)                   │
│    │   → 精简上下文: 子任务定义 + pitfalls + criteria             │
│    │   → 不包含: 父对话历史 + 其他子任务状态                      │
│    │                                                              │
│    ├── api.subagent.run({                                         │
│    │     sessionKey, message, extraSystemPrompt                  │
│    │   })                                                         │
│    │                                                              │
│    ├── registry.active_runs.push(run)                            │
│    └── return SubagentRun { status: 'running' }                  │
│                                                                   │
│  waitForCompletion(run)                                           │
│    │                                                              │
│    ├── api.subagent.waitForRun({ runId, timeoutMs })             │
│    │                                                              │
│    ├── 成功 → run.status = 'completed'                           │
│    ├── 超时 → run.status = 'timeout'                             │
│    ├── 失败 → run.status = 'failed'                              │
│    │                                                              │
│    ├── registry: active → completed                              │
│    └── return SubagentResult                                      │
│                                                                   │
│  retrySubagent(failedRun)                                         │
│    │                                                              │
│    ├── retry_count < max_retries? → Yes → spawnSubagent()        │
│    └── retry_count >= max_retries? → 标记最终失败                 │
│                                                                   │
│  aggregateResults()                                               │
│    │                                                              │
│    └── 返回 { success[], failed[], timeout[], summary }          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 子 Agent 上下文注入格式

```
[Praxis V13 子 Agent 上下文]

## 任务: {task_name}
阶段: Phase {n} — {phase_name}
子任务: {subtask_name}

## 子任务描述
{description}

## 验收标准
- [{type}] {description}
- [{type}] {description}

## 允许的操作
{allowed_operations}

## ⚠️ 陷阱预警
- [{severity}] {description}
  缓解: {mitigation}

## 输出要求
完成后请输出完成报告，包含:
1. 完成的工作内容
2. 遇到的关键问题及解决方案
3. 验收标准检查结果
```

### 3.3 并行执行规则

```
规则 1: 并行上限 = GovernancePolicy.subagent_management.max_parallel_subagents (默认 3)
规则 2: 只有 parallelizable = true AND depends_on = [] 的子任务才能并行
规则 3: 一个子 Agent 失败不影响其他并行子 Agent（失败隔离）
规则 4: 所有并行子 Agent 完成后才聚合结果，推进外循环
规则 5: 子 Agent 超时 (subagent_timeout_minutes) → 标记 timeout → 重试
规则 6: 子 Agent 重试次数用尽 → 标记 failed → 回退到 inline 串行模式
规则 7: 如果并行组中 > 50% 失败 → 暂停并行，剩余子任务转串行
```

### 3.4 并行安全边界

```
不允许并行的子任务:
  • depends_on 非空 — 显式依赖其他子任务
  • 同一 phase 的第一个子任务 — 可能建立后续子任务所需的基础
  • 用户标记为 "sequential" 的子任务

允许并行的子任务:
  • parallelizable = true
  • depends_on = []
  • allowed_operations 不包含破坏性操作 (如 'Bash' 中的 rm -rf)
  • 子任务描述不包含 "之后"、"然后"、"基于上一个" 等顺序暗示词
```

---

## 四、心跳监控协议

### 4.1 Service 注册

```typescript
// index.ts
api.registerService(heartbeatMonitorService);

// heartbeatMonitorService:
//   id: 'praxis-heartbeat-monitor'
//   start(ctx): 检查 allow_heartbeat_monitor → 启动 setInterval
//   stop(ctx): clearInterval
```

### 4.2 心跳检查循环

```
每 5 分钟 (可配置: max_heartbeat_checks_per_hour = 12):

1. 加载活跃任务
   memory_smart_search("task_orchestration_state", { task_state: "TASK_IN_PROGRESS" })

2. 对每个活跃任务:
   a. 获取活跃子任务 getActiveSubtask(state)
   b. 如果无活跃子任务或状态 != SUBTASK_ACTIVE → skip
   c. 加载 heartbeat_state
   d. 计算:
      elapsed = now - subtask.started_at
      estimated = subtask.estimated_duration_minutes * 60 * 1000
      stall_threshold = estimated × policy.stall_threshold_multiplier (默认 2.0)

3. 状态判定:
   ┌──────────────────────────────────────────────────────────────┐
   │ elapsed < estimated                     → NORMAL             │
   │   • 更新 last_progress_at                                   │
   │   • heartbeat_count++                                       │
   ├──────────────────────────────────────────────────────────────┤
   │ estimated ≤ elapsed < stall_threshold    → RUNNING_LONG      │
   │   • 记录但不干预                                             │
   │   • 可在 session_start 时注入提醒                            │
   ├──────────────────────────────────────────────────────────────┤
   │ elapsed ≥ stall_threshold               → STALL_DETECTED     │
   │   → handleStall(task, subtask, elapsed, estimated, policy)  │
   └──────────────────────────────────────────────────────────────┘
```

### 4.3 分级响应协议

```
STALL DETECTED:

Level 1: NUDGE (有活跃 session)
  条件: checkActiveSession(task_id) === true
  动作: enqueueSystemEvent(nudgeMessage, { sessionKey, contextKey: 'heartbeat_nudge' })
  效果: 下一次 prompt 构建时，LLM 看到:
        "⚠️ [Praxis V13] 子任务 '{name}' 运行时间超过预期。
         已运行 {elapsed}h，估计 {estimated}h。
         建议: 检查进展，或标记为 BLOCKED。"
  后续: 如果 nudge 后 1 小时内子任务有进展 (tool_call 发生) → 解除停滞

Level 2: WAKE (无活跃 session, < 24h 停滞)
  条件: checkActiveSession(task_id) === false
        AND elapsed < auto_cancel_stalled_after_hours
  动作: requestHeartbeat({ source: 'interval', intent: 'event', reason, sessionKey })
  效果: 创建新 session，session_start 时注入 buildHeartbeatWakeNotice()
  后续: 用户在新 session 中看到停滞提醒

Level 3: ESCALATE (> 24h 停滞)
  条件: elapsed > auto_cancel_stalled_after_hours (默认 24h)
  动作: markSubtaskBlocked(task, subtask_id, 'pitfall_hit', reason)
        → advanceOuterLoop(state, 'gaps_found', 'heartbeat:wake')
  效果: 子任务标记 BLOCKED → 外循环推进到 TASK_ITERATING → 生成补救子任务
  后续: 下次 session_start 时看到 BLOCKED 状态和补救计划

假阳性控制:
  • 如果最近 30 分钟内有 tool_call 活动 → 不标记停滞（子任务仍在运行）
  • 如果子任务在 nudge 后 1 小时内有进展 → 清除停滞标记
  • 用户可手动清除: /praxis task heartbeat-clear
```

### 4.4 心跳状态转换图

```
                    ┌──────────┐
                    │  NORMAL  │
                    └─────┬────┘
                          │ elapsed > estimated
                          ▼
                    ┌──────────────┐
                    │ RUNNING_LONG │
                    └──────┬───────┘
                           │ elapsed > stall_threshold
                           ▼
                    ┌────────────────┐
                    │ STALL_DETECTED │
                    └───────┬────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌─────────┐  ┌──────────┐  ┌──────────┐
        │  NUDGE  │  │   WAKE   │  │ ESCALATE │
        │(有session)│  │(无session)│  │ (>24h)   │
        └────┬────┘  └────┬─────┘  └────┬─────┘
             │            │             │
             ▼            ▼             ▼
        进展→NORMAL  介入→NORMAL   →BLOCKED
```

---

## 五、降级策略

### 5.1 TriggerAdapter 降级

```
Deployment Mode Detection:
  auto (默认):
    1. 尝试 api.session.workflow.scheduleSessionTurn → 可用?
       → Yes: BundledTriggerAdapter
       → No: 继续
    2. 尝试通过 gateway_start hook 获取 CronServiceContract → 可用?
       → Yes: CronTriggerAdapter
       → No: 抛出错误 "无可用触发机制"

  bundled (强制):
    → 仅使用 BundledTriggerAdapter
    → 不可用则抛出错误

  cron (强制):
    → 仅使用 CronTriggerAdapter
    → 不可用则抛出错误
```

### 5.2 Cron 降级路径的限制

```
Bundled (scheduleSessionTurn):
  ✅ 毫秒级精度
  ✅ deleteAfterRun (一次性触发)
  ✅ tag-based 管理
  ❌ 仅 bundled 插件

Cron Fallback:
  ✅ 所有部署模式
  ✅ 完整的 cron 表达式
  ❌ 分钟级精度（最小 1 分钟）
  ❌ 不支持 deleteAfterRun（需手动清理）
  ❌ 需要 gateway_start hook 权限
  ❌ 需要 cron_changed hook 监控

降级影响:
  • 触发时间偏差: ±1 分钟 (可接受，因为子任务估计本身就是粗略的)
  • 清理负担: session_start 自动清理过期 cron job
  • 代码复杂度: TriggerAdapter 接口抽象了差异，调用方不感知
```

### 5.3 子 Agent 失败降级

```
子 Agent spawn 失败:
  → 重试 1 次
  → 仍失败 → 回退到 inline 模式（在当前 session 中串行执行）

子 Agent 执行超时:
  → 重试 (max_retries 次)
  → 仍超时 → 标记 failed → 转为 remediation subtask

所有并行子 Agent 全部失败:
  → 暂停并行模式（当前 phase 内不再 spawn 子 Agent）
  → 剩余子任务转为 inline 串行
  → 下次 phase 重新评估是否恢复并行
```

---

## 六、AgentMemory 集成规格

### 6.1 V13 新增 Slots

```yaml
# task_schedule slot
memory_slot_get: "task_schedule"       # session_start: 加载调度状态
memory_slot_set: "task_schedule"       # session_end: 持久化调度状态
# 存储: TaskSchedule JSON
# 大小: < 2KB

# subagent_registry slot
memory_slot_get: "subagent_registry"   # session_start: 恢复子Agent状态
memory_slot_set: "subagent_registry"   # subagent-manager: 每次状态变更
# 存储: SubagentRegistry JSON
# 大小: < 5KB

# heartbeat_state slot
memory_slot_get: "heartbeat_state"     # heartbeat-monitor: 每次检查
memory_slot_set: "heartbeat_state"     # heartbeat-monitor: 每次检查后
# 存储: HeartbeatState JSON
# 大小: < 1KB
```

### 6.2 API 调用频率估算（V13 增量 vs V12）

```
session_start (V13 增量):
  + memory_slot_get("task_schedule") ×1          [新]
  + memory_slot_get("subagent_registry") ×1      [新]
  + 过期触发清理 (内存操作)                        [新]
  增量: +2 reads

session_end (V13 增量):
  + evaluateTrigger() (内存操作)                  [新]
  + executeTrigger() → scheduleSessionTurn API ×0-1 [新]
  + memory_slot_get("task_schedule") ×1          [新]
  + memory_slot_set("task_schedule") ×1           [新]
  + (如果是 subagent_run) subagent.run() API ×1-3 [新]
  增量: +2 slot ops + 0-4 external API calls

heartbeat-monitor (V13 新增，后台):
  + memory_smart_search("task_orchestration_state") ×1/check  [新]
  + memory_slot_get("heartbeat_state") ×1/active_subtask     [新]
  + memory_slot_set("heartbeat_state") ×1/active_subtask     [新]
  + (如果停滞) enqueueSystemEvent ×1 或 requestHeartbeat ×1  [新]
  频率: 每 5 分钟 × active tasks × active subtasks
  正常情况: ~2-10 slot ops + 0 API calls / 5 min

总计 V13 增量 (vs V12):
  - session_start: +2 reads
  - session_end: +2 slot ops + 0-4 API calls
  - 后台: ~2-10 slot ops / 5 min (独立于用户 session)
  - LLM 调用: 0 新增
  - 代码增量: ~530 行
```

---

## 七、V13 架构边界图

```
┌──────────────────────────────────────────────────────────────────┐
│                        OpenClaw (执行宿主)                         │
│                                                                    │
│  Hook 系统                                                        │
│  ├── session_start / session_end / message_received               │
│  ├── before_tool_call / after_tool_call / agent_end               │
│  └── subagent_ended / cron_changed / gateway_start                │
│                                                                    │
│  主动机制 (V13 激活)                                               │
│  ├── api.session.workflow.scheduleSessionTurn()    ← task-scheduler│
│  ├── api.runtime.subagent.run()                    ← subagent-mgr │
│  ├── api.runtime.subagent.waitForRun()             ← subagent-mgr │
│  ├── api.runtime.system.requestHeartbeat()         ← heartbeat-mon│
│  ├── api.runtime.system.enqueueSystemEvent()       ← heartbeat-mon│
│  ├── api.registerService()                         ← heartbeat-mon│
│  └── cron service (via gateway_start)              ← CronAdapter  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Praxis V13 (认知操作系统)                     │
│                                                                    │
│  ┌────────────────────┐  ┌──────────────────┐                    │
│  │   task-scheduler   │  │ subagent-manager │                    │
│  │   • evaluateTrigger│  │ • spawnSubagent  │                    │
│  │   • executeTrigger │  │ • waitForComplete│                    │
│  │   • TriggerAdapter │  │ • aggregateResults│                   │
│  └────────┬───────────┘  └────────┬─────────┘                    │
│           │                       │                               │
│           ▼                       ▼                               │
│  ┌─────────────────────────────────────────────┐                  │
│  │       task-orchestrator (V12, 不变)          │                  │
│  │  • advanceOuterLoop(event, triggerSource)   │                  │
│  │  • activateSubtask(subtaskId, mode)         │                  │
│  │  • TriggerSource: 全部 5 种激活              │                  │
│  │  • ActivationMode: inline + subagent        │                  │
│  └─────────────────────────────────────────────┘                  │
│           │                                                       │
│           ▼                                                       │
│  ┌─────────────────────────────────────────────┐                  │
│  │       heartbeat-monitor (后台 Service)       │                  │
│  │  • runHeartbeatCheck()                      │                  │
│  │  • handleStall() (nudge/wake/escalate)      │                  │
│  └─────────────────────────────────────────────┘                  │
│                                                                    │
│  V12 模块 (全部保留):                                              │
│  ┌─────────────────────────────────────────────┐                  │
│  │ plan-generator (+analyzeParallelization)     │                  │
│  │ verifier (+verifySubagentResult)             │                  │
│  │ progress-tracker • pitfall-tracker           │                  │
│  │ mid-session-learner • proto-task             │                  │
│  │ context-pressure-monitor • scene-recognizer  │                  │
│  │ context-organizer • confidence-fuser         │                  │
│  │ plan-file-writer • AgentMemory client        │                  │
│  └─────────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 八、错误处理矩阵

| 错误场景 | 检测位置 | 处理方式 | 用户感知 |
|---------|---------|---------|---------|
| scheduleSessionTurn 不可用 | task-scheduler.createTriggerAdapter() | 降级到 CronTriggerAdapter | 透明（分钟级精度） |
| Cron 也不可用 | task-scheduler.createTriggerAdapter() | 抛出错误 + 日志 | session_end 正常完成，无调度 |
| subagent.run() 抛异常 | subagent-manager.spawnSubagent() | catch → retry 1 次 → 回退 inline | 子任务串行执行（略慢） |
| subagent.waitForRun() 超时 | subagent-manager.waitForCompletion() | 标记 timeout → retry → 回退 inline | 同上 |
| 子 Agent 全部失败 | subagent-manager.aggregateResults() | 暂停并行 + 转串行 + 日志 | 当前 phase 后续子任务串行 |
| heartbeat-monitor 检查异常 | runHeartbeatCheck() | catch → 跳过本次检查 | 不感知（下次检查恢复） |
| 静默时段解析错误 | isInQuietHours() | 默认返回 false（不阻止） | 可能在静默时段触发 |
| 触发去重失败 | executeTrigger() | 创建重复触发（无害） | 最多多一次自动 session |
| 过期触发清理失败 | session-start | catch → 保留（下次清理） | cron job 可能泄漏 |
| AgentMemory 读写失败 | 各 slot 操作 | catch → 使用内存缓存 + 日志 | 重启后丢失调度状态 |

---

## 九、性能预算

```
V13 操作性能预算:

session_start (V13 增量):
  detectTriggerSource()          < 1ms   (系统事件字符串匹配)
  过期触发清理                    < 5ms   (内存数组遍历)
  调度状态恢复                    < 10ms  (AgentMemory slot get)
  总计 V13 增量:                 < 20ms

session_end (V13 增量):
  evaluateTrigger()              < 5ms   (内存决策矩阵)
  executeTrigger()               < 50ms  (AgentMemory slot ops)
  scheduleSessionTurn API 调用   < 100ms (外部 API)
  subagent.run() API 调用        < 200ms (spawn session)
  总计 V13 增量:                 < 400ms

heartbeat-monitor (每次检查):
  runHeartbeatCheck()            < 100ms (1 个活跃任务的检查)
  每增加 1 个活跃任务:            +50ms
  典型负载 (3 个活跃任务):        < 300ms

子 Agent 生命周期:
  上下文构建 buildSubagentContext < 5ms
  subagent.run() spawn           < 200ms
  waitForRun() 阻塞              取决于子任务时长 (秒到分钟)

V13 总开销:
  session_start: < 20ms 增量 (可接受)
  session_end:   < 400ms 增量 (可接受 — session_end 通常有 LLM 调用，400ms 可忽略)
  后台:          < 300ms / 5min (极低 — 不影响用户体验)
```

---

## 十、兄弟文件

- [What is Praxis V13?](what-is.md) — V13 定义 + 四个核心职能
- [Why Praxis V13?](why.md) — 第一性原理：为什么被动响应不够
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 三个新模块 + 五个修改模块的完整实现
- [When does it operate?](when.md) — Phase 7-9 路线图（+5 周）
- [Where does it sit?](where.md) — 完整模块树（V12 基础 + 3 新增 + services/ 目录）
