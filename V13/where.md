# Where does AgentOS V13 sit?

> V13 在 V12 基础上添加 3 个新模块（orchestration/ 下 2 个 + services/ 下 1 个），修改 5 个模块，新增 2 个 AgentMemory slots。V12 模块零移除。`services/` 目录为 V13 新增。

---

## 一、完整模块树（V13）

```
openclaw/src/plugins/agentos-plugin/
├── index.ts                                 # [V13修改] +heartbeatMonitorService 注册
├── config.ts                                # [V13修改] +activeTriggering +subagentManagement +triggerAdapter 配置段
│
├── orchestration/                           # 任务编排核心层
│   ├── task-orchestrator.ts                 # [V13修改] +ActivationMode subagent +scheduleNextAction()
│   ├── task-scheduler.ts                    # [新 V13] 主动触发决策引擎 + TriggerAdapter
│   ├── subagent-manager.ts                  # [新 V13] 并行子 Agent 管理器
│   ├── plan-generator.ts                    # [V13修改] +analyzeParallelization()
│   ├── verifier.ts                          # [V13修改] +verifySubagentResult()
│   ├── progress-tracker.ts                  # 同 V12
│   ├── context-pressure-monitor.ts          # 同 V9
│   ├── scene-recognizer.ts                  # 同 V9
│   ├── context-organizer.ts                 # 同 V10
│   ├── task-context.ts                      # 同 V12
│   ├── confidence-fuser.ts                  # 同 V12
│   └── prediction-protocol.ts               # 同 V9
│
├── services/                                # [新 V13] 后台服务层
│   └── heartbeat-monitor.ts                 # [新 V13] 停滞检测 + 分级介入
│
├── analysis/                                # 分析与学习层 (全部同 V12)
│   ├── mid-session-learner.ts
│   ├── proto-task.ts
│   ├── pitfall-tracker.ts
│   ├── transcript-analyzer.ts
│   ├── statistical-verifier.ts
│   ├── role-verifier.ts
│   ├── concept-verifier.ts
│   ├── attention-telemetry.ts
│   ├── consistency-checker.ts
│   ├── config-adapter.ts
│   ├── degradation-checker.ts
│   ├── structure-lifecycle.ts
│   └── architecture-auditor.ts
│
├── files/                                   # 文件持久化层 (同 V12)
│   └── plan-file-writer.ts
│
├── hooks/
│   ├── session-start.ts                    # [V13修改] +detectTriggerSource() +过期触发清理 +自动触发通知
│   ├── message-received.ts                 # 同 V12
│   ├── before-tool-call.ts                 # 同 V12
│   ├── after-tool-call.ts                  # 同 V12
│   ├── agent-end.ts                        # 同 V12
│   └── session-end.ts                      # [V13修改] +scheduleNextIfEnabled()
│
├── memory/
│   ├── client.ts                           # 同 V12
│   ├── recall-structure.ts                 # 同 V12
│   ├── local-cache.ts                      # 同 V12
│   ├── schemas.ts                          # [V13修改] +task_schedule +subagent_registry +heartbeat_state schemas
│   ├── slots.ts                            # [V13修改] +task_schedule +subagent_registry +heartbeat_state slots
│   └── queries.ts                          # [V13修改] +orchestration 状态查询 +活跃任务查询
│
├── prompts/                                # 同 V12
│   ├── system/
│   │   ├── memory-context.md
│   │   ├── plan-injection.md
│   │   ├── prediction-markers.md
│   │   └── critical-mode.md
│   ├── analysis/
│   │   ├── extract-and-update.md
│   │   ├── construct-proto-task.md
│   │   ├── generate-plan.md
│   │   ├── verify-progress.md
│   │   ├── consistency-scan.md
│   │   └── audit-architecture.md
│   └── user/
│       ├── perception-summary.md
│       └── crystallization-proposal.md
│
├── types/
│   ├── memory.ts                           # [V13修改] +TaskSchedule +ScheduledTrigger +SubagentRun +SubagentResult +SubagentRegistry +HeartbeatState +HeartbeatIntervention
│   ├── scene.ts                            # 同 V12
│   └── hooks.ts                            # [V13修改] +OrchestrationContext.triggerSource +scheduleState
│
└── tests/
    ├── task-scheduler.test.ts               # [新 V13]
    ├── subagent-manager.test.ts             # [新 V13]
    ├── heartbeat-monitor.test.ts            # [新 V13]
    ├── task-orchestrator.test.ts            # [修改]
    ├── plan-generator.test.ts               # [修改]
    ├── verifier.test.ts                     # [修改]
    ├── progress-tracker.test.ts             # 同 V12
    ├── pitfall-tracker.test.ts              # 同 V12
    ├── plan-file-writer.test.ts             # 同 V12
    ├── mid-session-learner.test.ts          # 同 V12
    └── proto-task.test.ts                   # 同 V12
```

---

## 二、V12 → V13 模块变化清单

### 新增模块（3 个）

| 模块 | 路径 | 职责 | 替代/增强 |
|------|------|------|----------|
| task-scheduler | `orchestration/task-scheduler.ts` | 触发决策矩阵 + TriggerAdapter（bundled + cron fallback）+ 去重 + 静默时段 | — (新能力) |
| subagent-manager | `orchestration/subagent-manager.ts` | 子 Agent spawn/监控/聚合/重试 + 精简上下文构建 | — (新能力) |
| heartbeat-monitor | `services/heartbeat-monitor.ts` | OpenClaw Service 注册 + 停滞检测 + 分级响应 (nudge/wake/escalate) | — (新能力) |

### 修改模块（8 个）

| 模块 | 改动量 | 说明 |
|------|--------|------|
| `orchestration/task-orchestrator.ts` | ~40 行 | `activateSubtask()` + ActivationMode 'subagent' 路径；新增 `scheduleNextAction()` |
| `hooks/session-end.ts` | ~30 行 | `scheduleNextIfEnabled()`: 调用 scheduler + 注册定时任务 |
| `hooks/session-start.ts` | ~15 行 | `detectTriggerSource()` + 过期触发清理 + 自动触发/停滞唤醒通知 |
| `orchestration/plan-generator.ts` | ~15 行 | `analyzeParallelization()`: parallelizable + depends_on + parallel_group |
| `orchestration/verifier.ts` | ~10 行 | `verifySubagentResult()`: 异步验证结果处理 |
| `config.ts` | ~20 行 | +activeTriggering +subagentManagement +triggerAdapter 配置段 |
| `types/memory.ts` | ~30 行 | +TaskSchedule +SubagentRun +HeartbeatState 等 7 个新类型 |
| `index.ts` | ~5 行 | +heartbeatMonitorService 注册 |

### 移除模块（0 个）

V13 不移除任何 V12 模块。所有 V12 功能完整保留。

### 新目录（1 个）

| 目录 | 说明 |
|------|------|
| `services/` | 后台服务层 — 存放注册为 OpenClaw Service 的长期运行模块。V13 仅有 heartbeat-monitor。未来可能扩展（如 cron-manager、notification-service）。 |

---

## 三、新增 AgentMemory Slots / Types

### Slots

```yaml
# task_schedule slot (V13 新增)
# 存储: TaskSchedule JSON
# 大小: < 2KB
# 索引: 按 task_id
# 读写: session_end 写入，session_start 读取
memory_slot_get: "task_schedule"
memory_slot_set: "task_schedule"

# subagent_registry slot (V13 新增)
# 存储: SubagentRegistry JSON
# 大小: < 5KB
# 索引: 按 task_id
# 读写: subagent-manager 写入，session_start 读取
memory_slot_get: "subagent_registry"
memory_slot_set: "subagent_registry"

# heartbeat_state slot (V13 新增)
# 存储: HeartbeatState JSON
# 大小: < 1KB
# 索引: 按 task_id + subtask_id
# 读写: heartbeat-monitor 写入，heartbeat-monitor 读取
memory_slot_get: "heartbeat_state"
memory_slot_set: "heartbeat_state"
```

### Memory Types

| Type | 数据结构 | 查询方式 | 保存时机 |
|------|---------|---------|---------|
| `scheduled_turn` | ScheduledTrigger | `memory_smart_search(task_id)` | 每次触发注册 |
| `subagent_run` | SubagentRun | `memory_smart_search(task_id, subtask_id)` | 子 Agent spawn/complete/fail |
| `heartbeat_checkpoint` | HeartbeatState | `memory_timeline(task_id)` | 每次心跳检查 |
| `trigger_decision` | TriggerDecision | `memory_smart_search(task_id)` | 每次调度决策 |
| `heartbeat_intervention` | HeartbeatIntervention | `memory_smart_search(task_id)` | 每次停滞干预 |

### V12 memory types 保留

全部保留: `subtask_outcome`, `plan_snapshot`, `verification_report`, `pitfall_observation`, `orchestration_event`, `task_outcomes`, `guidance_signals`(降格), `proto_task`

---

## 四、数据流（V13 新增部分）

```
session_end (V13 增量):
  [V12 完整流程: 验证 + 陷阱 + 推进外循环 + 持久化]
  7. 【V13 新增】主动调度:
     ├── scheduleNextIfEnabled(state, ctx, policy):
     │   ├── active_triggering.enabled? → 否 → 返回
     │   ├── task_state in [COMPLETE, ABANDONED]? → 是 → 返回
     │   ├── evaluateTrigger(state, policy) → TriggerDecision
     │   │   ├── 检查静默时段、每日上限、最小间隔
     │   │   ├── 查找下一个 PENDING 子任务
     │   │   └── 决策: subagent_run | scheduleSessionTurn | cron_job | none
     │   ├── executeTrigger(decision, state, adapter)
     │   │   ├── 去重检查
     │   │   ├── 首次触发确认检查
     │   │   ├── BundledTriggerAdapter.scheduleTurn() 或 CronTriggerAdapter.scheduleTurn()
     │   │   └── 持久化 ScheduleTrigger 到 task_schedule slot
     │   └── (如果是 subagent_run) → SubagentManager.spawnSubagent()
     └── 持久化 task_schedule slot

session_start (V13 增量):
  [V12 完整流程: 加载状态 + 生成计划 + 注入上下文]
  0. 【V13 新增】触发源识别:
     ├── detectTriggerSource(ctx):
     │   ├── systemEvents 含 "[AgentOS V13 自动触发]" → 'cron:scheduled'
     │   ├── systemEvents 含 "[AgentOS V13 停滞检测]" → 'heartbeat:wake'
     │   └── 其他 → 'hook:session_start'
     ├── cron:scheduled → 注入 buildAutoTriggerNotice()
     ├── heartbeat:wake → 注入 buildHeartbeatWakeNotice()
     └── 恢复调度状态:
         ├── 加载 task_schedule slot
         ├── 清理过期触发 (> 1h 未触发)
         └── 标记匹配触发为 fired

heartbeat-monitor 检查循环 (V13 新增，后台 Service):
  每 5 分钟:
  ├── 加载所有 TASK_IN_PROGRESS 任务
  ├── 对每个活跃子任务:
  │   ├── 计算 elapsed = now - subtask.started_at
  │   ├── 计算 stall_threshold = estimated_duration × multiplier
  │   ├── elapsed < estimated → 正常
  │   ├── estimated < elapsed < stall_threshold → "running long"
  │   └── elapsed > stall_threshold → STALL DETECTED:
  │       ├── 有活跃 session → nudge (注入提醒)
  │       ├── 无活跃 session + < 24h → requestHeartbeat 唤醒
  │       └── > auto_cancel_stalled_after_hours → escalate (标记 BLOCKED)
  └── 保存 heartbeat_state

子 Agent 回调 (V13 新增):
  subagent_ended hook → 父 session:
  ├── SubagentManager.waitForCompletion(runId)
  ├── verifySubagentResult(subtask, result)
  ├── processSubtaskOutcome(state, subtaskId, outcome, criteriaResults)
  └── 所有并行子 Agent 完成 → advanceOuterLoop()
```

---

## 五、V10 → V11 → V12 → V13 完整差异矩阵

| 维度 | V10 | V11 | V12 | V13 |
|------|-----|-----|-----|-----|
| 架构哲学 | 开环注入 | 四个结构化接口 | AgentOS 直接做任务分解 | **AgentOS 主动驱动任务执行** |
| 核心职能 | 记忆 | 记忆+学习 | 记忆+学习+编排 | **记忆+学习+编排+驱动** |
| 驱动方式 | Hook(被动) | Hook(被动) | Hook(被动) | **5源驱动(Hook+Cron+Subagent+Heartbeat+Service)** |
| 子任务执行 | 无 | 无 | 串行(inline) | **串行+并行(subagent)** |
| 会话触发 | 用户手动 | 用户手动 | 用户手动 | **手动+自动** |
| 后台运行 | 无 | 无 | 无 | **Service常驻** |
| 停滞检测 | 无 | 无 | 无 | **Heartbeat监控** |
| 外部接口数 | 0 | 4 | 1 | 1 |
| 模块数 | ~27 | ~32 | ~29 | **~32** |
| AgentMemory Slots | 7 | 8 | 10 | **13** (+task_schedule +subagent_registry +heartbeat_state) |
| AgentMemory Types | 5 | 7 | 12 | **17** (+5 V13 types) |
| 实现周期 | - | +10周 | +9周 | **+5周(累计14周)** |
| 代码量 | - | ~800 行 | ~1065 行 | **~1595 行** |

---

## 六、与 OpenClaw Plugin API 的集成点（V13 激活）

```
V12 (预留，未使用):
  advanceOuterLoop(triggerSource)
    ├── "hook:session_start"     ← V12 使用
    ├── "hook:session_end"       ← V12 使用
    ├── "cron:scheduled"         ← 预留
    ├── "subagent:completed"     ← 预留
    └── "heartbeat:wake"         ← 预留

V13 (全部激活):
  advanceOuterLoop(triggerSource)
    ├── "hook:session_start"     ← 保留
    ├── "hook:session_end"       ← 保留
    ├── "cron:scheduled"         ← task-scheduler 通过 scheduleSessionTurn/cron 触发
    ├── "subagent:completed"     ← subagent-manager 的 waitForRun 回调
    └── "heartbeat:wake"         ← heartbeat-monitor 通过 requestHeartbeat 触发

  activateSubtask(subtask, mode)
    ├── "inline"                 ← V12 使用
    └── "subagent"              ← V13 subagent-manager.spawnSubagent()

新增 API 使用:
  api.session.workflow.scheduleSessionTurn()    ← task-scheduler (BundledTriggerAdapter)
  api.runtime.subagent.run()                    ← subagent-manager.spawnSubagent()
  api.runtime.subagent.waitForRun()             ← subagent-manager.waitForCompletion()
  api.runtime.system.requestHeartbeat()          ← heartbeat-monitor.handleStall()
  api.runtime.system.enqueueSystemEvent()        ← heartbeat-monitor.handleStall() (nudge)
  api.registerService()                          ← heartbeatMonitorService
  cron service (via gateway_start hook)          ← task-scheduler (CronTriggerAdapter)
```

---

## 兄弟文件

- [What is AgentOS V13?](what-is.md) — V13 定义 + 四个核心职能
- [Why AgentOS V13?](why.md) — 第一性原理：为什么被动响应不够
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 三个新模块 + 五个修改模块的完整实现
- [When does it operate?](when.md) — Phase 7-9 路线图（+5 周）
- [Architecture Design](design.md) — 触发决策矩阵、并行执行协议、心跳监控协议
