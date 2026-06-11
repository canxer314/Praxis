# When does Praxis V13 operate?

> V13 在 V12 的 9 周实现基础上增加 5 周（Phase 7-9）。三个新模块逐 Phase 交付，每个 Phase 可独立验证。总增量 < 530 行代码。

---

## 一、实现路线图总览

```
Phase 7: 主动调度 (周 9-11)
│  • task-scheduler.ts: 触发决策矩阵 + TriggerAdapter
│  • session-end 增强: 调度下一触发
│  • session-start 增强: 识别触发源 + 恢复调度状态
│  • GovernancePolicy 集成
│  目标: session_end 后自动注册定时触发，session_start 正确识别触发源
│
├── Phase 8: 并行子 Agent (周 11-13)
│   • subagent-manager.ts: spawn/monitor/aggregate
│   • task-orchestrator 增强: ActivationMode 'subagent'
│   • plan-generator 增强: parallelizable + depends_on
│   • verifier 增强: 异步验证结果
│   目标: 3 个独立子任务并行执行，结果正确聚合
│
└── Phase 9: 心跳监控 + 集成 (周 13-14)
    • heartbeat-monitor.ts: Service + 停滞检测 + 分级响应
    • 端到端测试: 完整任务自主完成
    • 性能优化 + 文档
    目标: 停滞在 2x 估计时间内被检测，完整 3 阶段任务自主完成

总计: +5 周（Phase 7-9）
累计: 14 周（Phase 0-9）
```

---

## 二、Phase 7: 主动调度（周 9-11）

**目标**: session_end 后自动计算并注册下一次触发。session_start 识别非 Hook 触发源。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **task-scheduler.ts** | `evaluateTrigger()` 决策矩阵 + `executeTrigger()` + `BundledTriggerAdapter` + `CronTriggerAdapter` + `createTriggerAdapter()` 工厂 | P0 | 中 (~120 行) |
| session-end 增强 | 在验证+持久化后调用 `scheduleNextIfEnabled()` | P0 | 小 (~15 行) |
| session-start 增强 | `detectTriggerSource()` + 过期触发清理 + `buildAutoTriggerNotice()` | P0 | 小 (~10 行) |
| data model | TaskSchedule + ScheduledTrigger 类型定义 + task_schedule AgentMemory slot | P0 | 小 (~15 行) |
| config | GovernancePolicy activeTriggering + triggerAdapter 配置段 + 默认值 | P0 | 小 (~10 行) |
| 去重逻辑 | `executeTrigger()` 中的触发去重检查 | P1 | 小 (已在 task-scheduler 中) |
| 静默时段检查 | `isInQuietHours()` 实现 + 跨午夜边界测试 | P1 | 小 (已在 task-scheduler 中) |
| 单元测试 | TriggerDecision 矩阵所有分支 + 静默时段 + 去重 | P0 | 中 |

**验证标准**:
```
✅ evaluateTrigger(TASK_IN_PROGRESS + enabled) → should_trigger = true
✅ evaluateTrigger(TASK_COMPLETE + enabled) → should_trigger = false (reason: task_ended)
✅ evaluateTrigger(TASK_IN_PROGRESS + disabled) → should_trigger = false (reason: disabled)
✅ evaluateTrigger(TASK_IN_PROGRESS + quiet_hours) → skip_reasons 包含 "当前在静默时段"
✅ evaluateTrigger(TASK_IN_PROGRESS + parallelizable subtask) → mechanism = 'subagent_run'
✅ evaluateTrigger(TASK_IN_PROGRESS + dependent subtask < 1h) → mechanism = 'scheduleSessionTurn'
✅ isInQuietHours("22:00-08:00", 23:00) → true
✅ isInQuietHours("22:00-08:00", 09:00) → false
✅ BundledTriggerAdapter.scheduleTurn() → 返回 { jobId }
✅ CronTriggerAdapter.scheduleTurn() → 返回 { jobId } (降级路径)
✅ 重复触发去重: 相同 reason 的第二个触发被跳过
✅ session_end → scheduleNextIfEnabled → pending_triggers 中有新触发
✅ session_start with [Praxis V13 自动触发] system event → triggerSource = 'cron:scheduled'
✅ session_start with [Praxis V13 停滞检测] system event → triggerSource = 'heartbeat:wake'
✅ session_start (普通用户启动) → triggerSource = 'hook:session_start'
✅ 过期触发 (> 1h 未触发) 在 session_start 时被自动清理
```

---

## 三、Phase 8: 并行子 Agent（周 11-13）

**目标**: 独立子任务通过 subagent.run() 并行执行。结果正确聚合回父 orchestrator。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **subagent-manager.ts** | `SubagentManager` 类：spawn / waitForCompletion / retry / aggregateResults / buildSubagentContext | P0 | 中 (~150 行) |
| task-orchestrator 增强 | `activateSubtaskV13()` 中的 ActivationMode 'subagent' 路径 + `scheduleNextAction()` | P0 | 中 (~40 行) |
| plan-generator 增强 | `analyzeParallelization()`: parallelizable + depends_on + parallel_group 标记 | P0 | 小 (~15 行) |
| verifier 增强 | `verifySubagentResult()`: 异步验证结果处理 | P1 | 小 (~10 行) |
| data model | SubagentRun + SubagentResult + SubagentRegistry 类型 + subagent_registry slot | P0 | 小 (~10 行) |
| config | GovernancePolicy subagentManagement 配置段 + 默认值 | P0 | 小 (~5 行) |
| 上下文构建 | `buildSubagentContext()`: 精简上下文格式（子任务定义 + pitfalls + criteria） | P1 | 小 (已在 subagent-manager 中) |
| 单元测试 | SubagentManager 生命周期 + 并行上限 + 重试 + 聚合 | P0 | 中 |

**验证标准**:
```
✅ SubagentManager.canSpawn() (active < max) → true
✅ SubagentManager.canSpawn() (active = max) → false
✅ SubagentManager.spawnSubagent(parallelizable subtask) → SubagentRun { status: 'running' }
✅ SubagentManager.spawnSubagent(dependent subtask) → (不强制 spawn，由 scheduler 决策)
✅ SubagentManager.waitForCompletion(run) → SubagentResult { status: 'ok' }
✅ SubagentManager.waitForCompletion(run) timeout → SubagentResult { status: 'timeout' }
✅ SubagentManager.retrySubagent(failed run, retry < max) → 新 SubagentRun
✅ SubagentManager.retrySubagent(failed run, retry = max) → status: 'failed' (不再重试)
✅ SubagentManager.aggregateResults(2 success + 1 failed) → { success: 2, failed: 1, timeout: 0 }
✅ buildSubagentContext() 包含: 子任务描述 + 验收标准 + 允许操作 + 陷阱预警
✅ buildSubagentContext() 不包含: 父 session 对话历史 + 其他子任务状态
✅ plan-generator: 无依赖子任务 → parallelizable = true
✅ plan-generator: 有依赖子任务 → parallelizable = false, depends_on = [...]
✅ verifySubagentResult(subagent reported ok) → 确认性验证 + trust fallback
✅ 父 session 的 subagent_registry 正确追踪 3 个并行子 Agent 状态
```

---

## 四、Phase 9: 心跳监控 + 集成（周 13-14）

**目标**: heartbeat-monitor 作为后台 Service 运行。停滞在 2x 估计时间内被检测。完整端到端测试。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **heartbeat-monitor.ts** | `heartbeatMonitorService` 定义 + `runHeartbeatCheck()` + `handleStall()` 分级响应 | P0 | 中 (~100 行) |
| Service 注册 | index.ts 中注册 heartbeatMonitorService 到 OpenClaw | P1 | 小 (~5 行) |
| data model | HeartbeatState + HeartbeatIntervention 类型 + heartbeat_state slot | P0 | 小 (~5 行) |
| 端到端测试 | 3 阶段任务: Phase 1 (inline) → Phase 2 (自动触发) → Phase 3 (并行+串行混合) → TASK_COMPLETE | P0 | 中 |
| 停滞模拟测试 | 模拟子任务超时 → heartbeat-monitor 检测 → nudge → wake → escalate | P0 | 中 |
| 边界情况 | 网络中断时降级路径、cron job 泄漏清理、子 Agent 全部失败回退 | P1 | 小 |
| 性能优化 | 验证 trigger 操作开销 < 50ms（不含 LLM 调用） | P1 | 小 |
| 文档 | 开发者指南更新 + V13 ADR (Architecture Decision Records) | P1 | 中 |

**验证标准**:
```
✅ heartbeatMonitorService.start() 正确注册 Service
✅ heartbeatMonitorService.start() with disabled → 跳过
✅ runHeartbeatCheck() 检测到活跃 TASK_IN_PROGRESS → 加载并检查子任务
✅ 子任务运行时间 < estimated → 不触发干预
✅ 子任务运行时间 > estimated < stall_threshold → 标记 "running long"
✅ 子任务运行时间 > stall_threshold + 有活跃 session → nudge (注入提醒)
✅ 子任务运行时间 > stall_threshold + 无活跃 session → requestHeartbeat 唤醒
✅ 子任务运行时间 > auto_cancel_stalled_after_hours → escalate (标记 BLOCKED)
✅ HeartbeatIntervention 正确记录在 heartbeat_state 中
✅ 假阳性控制: 最近 30 分钟有 tool_call 活动的子任务不被标记停滞

端到端测试:
✅ 任务: "构建 API 服务"
   Phase 1 (inline, 用户 session): 需求分析 → 数据模型设计 → 项目脚手架
     → session_end → task-scheduler 计算: 下一子任务估计 2h → scheduleSessionTurn(2h)
   Phase 2 (自动触发, cron): 2h 后自动 session → API 端点实现 → 单元测试
     → session_end → 检测 3 个独立子任务 → spawn 3 个子 Agent 并行
   Phase 3 (并行+串行混合):
     • 子Agent 1: 集成测试 (20 min) ✅
     • 子Agent 2: API 文档 (15 min) ✅
     • 子Agent 3: 性能测试 (25 min) ✅
     → 聚合结果 → verifier → 全部通过
     → TASK_COMPLETE
   ✅ 总耗时: Phase 1 (inline) + max(Phase 3 子Agent 耗时) ≈ 大幅短于全串行
   ✅ 至少 1 次自动触发 + 至少 1 次并行子 Agent

停滞检测测试:
✅ 模拟: 子任务启动 3h 后无进展 → heartbeat-monitor 检测停滞
✅ Level 1 (nudge): 当前有活跃 session → 注入提醒到 prompt
✅ Level 2 (wake): 无活跃 session 6h → requestHeartbeat 创建新 session
✅ Level 3 (escalate): 24h 无响应 → 标记子任务 BLOCKED → 外循环推进到 TASK_ITERATING
```

---

## 五、V12 → V13 路线图对比

| 维度 | V12 Phase 0-6 | V13 Phase 7-9 | 差异 |
|------|-------------|-------------|------|
| 交付模块 | 6 新 + 7 修改 | **3 新 + 5 修改** | 更轻量 |
| 工作量 | 9 周 | **5 周** | 略少 |
| 新 Hook | 6 个修改 | **2 个修改** (session-start + session-end) | 更少 |
| 新 Service | 0 | **1** (heartbeat-monitor) | +1 |
| 新 slot | 3 | **2** (task_schedule + subagent_registry) | +2 |
| 新 LLM 调用 | 2 | **0** (纯工程代码) | 无新增 |
| 移除模块 | 3 | **0** | 无移除 |
| 外部接口变化 | -3 (4→1) | **0** (1→1) | 不变 |
| 状态机改动 | 全新设计 | **0** (V12 状态机不动) | 零改动 |
| Trigger 源 | 2 (V12 预留) | **+3 激活** | 激活预留 |
| 净代码增量 | ~1065 行 | **~530 行** | 约一半 |

---

## 六、风险与缓解

| 风险 | 影响 | 概率 | 缓解 |
|------|------|------|------|
| scheduleSessionTurn bundled 限制 | Phase 7 核心能力不可用 | 中 | CronTriggerAdapter 降级路径已设计 |
| subagent.run() context 不足导致质量下降 | Phase 8 子 Agent 产出不可用 | 低 | relevant_structures 精准注入 + 确认性验证 |
| heartbeat-monitor 假阳性过高 | Phase 9 用户被打扰 | 中 | 30 分钟 activity 检查 + 分级响应 + 用户可调整 multiplier |
| cron job 泄漏（未清理的历史 job） | 资源浪费 + 错误触发 | 低 | session_start 自动清理过期触发 |
| 并行子 Agent 全部失败 | Phase 8 无进展 | 低 | 失败回退到串行 inline 模式 |
| 用户不接受主动触发 | V13 核心价值无法实现 | 中 | 默认关闭 + 静默时段 + 每日上限 + 确认机制 |

---

## 兄弟文件

- [What is Praxis V13?](what-is.md) — V13 定义 + 四个核心职能
- [Why Praxis V13?](why.md) — 第一性原理：为什么被动响应不够
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 三个新模块 + 五个修改模块的完整实现
- [Where does it sit?](where.md) — 完整模块树（V12 基础 + 3 新增 + services/ 目录）
- [Architecture Design](design.md) — 触发决策矩阵、并行执行协议、心跳监控协议
