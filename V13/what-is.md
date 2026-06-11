# What is AgentOS V13?

> V13 = 完整认知操作系统。V12 实现了记忆+学习+编排，V13 激活第四个核心职能——**驱动**。AgentOS 不再只是"响应 hook"，而是主动发起会话、并行执行子任务、持续监控任务健康。

## 一句话定义

**AgentOS V13 是一个完整的认知操作系统——具备记忆（结构化知识存储）、学习（置信度驱动的知识成长）、编排（任务状态机+验收）、驱动（主动调度+并行执行+健康监控）四个核心职能。它位于 LLM 和世界之间，把 LLM 每次会话的"空白大脑"状态，转换为"有记忆、有经验、有任务意识、能自主推进"的连续认知存在。**

---

## V12 → V13 演进

```
V1-V6:  认知概念设计
V7:     场景级工程落地 — 所有认知操作 = Hook + LLM + AgentMemory
V8:     1M 上下文简化
V9:     上下文压力自适应
V10:    任务级认知感知 — TaskContext
V11:    知行合一闭环 — 四个结构化接口
V12:    从"被动记忆"到"主动认知引擎" — 任务编排状态机
        • 拆除 planning-with-files 边界，AgentOS 直接做任务分解
        • 两个嵌套 while() 循环状态机（Hook 驱动）
        • ProtoTask 驱动的计划生成 + 5 种验收标准 + 陷阱监控

V13:    完整认知操作系统 — 记忆 + 学习 + 编排 + 驱动
        • 从"被动响应 Hook"到"多源主动驱动"
        • 状态机不变，trigger 层升级为 5 源驱动
        • 并行子 Agent 执行 + 后台心跳监控
        • 四个核心职能全部到位

关键洞察:
  V12 的状态机设计已经为 V13 做好了准备——TriggerSource 类型定义了 5 种触发源，
  ActivationMode 类型定义了 inline/subagent 两种执行模式。V12 只用到了其中
  hook:session_start 和 hook:session_end 两种。V13 激活其余三种——
  cron:scheduled, subagent:completed, heartbeat:wake。

  V13 不改变 V12 的一行状态机逻辑。它只在 trigger 层添加三个新模块，
  让状态机从"等待事件"变成"创造事件"。
```

---

## V13 的四个核心职能

### 职能 1：记忆（V1-V8，V13 继承）

```
原始交互 → 结构化知识表示 → AgentMemory 持久化 → 跨会话检索
  • ProtoStructure（序列、角色、概念、目的）
  • 场景识别 + 上下文组织
  • 置信度驱动的结晶化/降解
  • 上下文压力自适应注入
```

### 职能 2：学习（V3-V11，V13 继承）

```
观察 → 预测 → 执行 → 验证 → 置信度更新 → 知识成长
  • ProtoTask：从 bootstrap (0.2) 到高置信度 (0.8+)
  • 7 源置信度融合（统计+角色+概念+LLM标记+用户修正+任务结果+会话中）
  • 陷阱反馈闭环（命中 → 反馈 → 下次预警更准确）
  • 实时矛盾检测 + 即时修正（mid-session-learner）
```

### 职能 3：编排（V10-V12，V13 继承 + 增强）

```
ProtoTask → PlanDocument → 两个嵌套 while() 状态机 → 验收 + 陷阱
  外层循环（任务级）：8 个状态，从 TASK_NOT_STARTED 到 TASK_COMPLETE
  内层循环（子任务级）：6 个状态，从 SUBTASK_PENDING 到 SUBTASK_VERIFIED
  • plan-generator：ProtoTask → PlanDocument
  • verifier：5 种验收标准（command/file/test/llm/user）
  • pitfall-tracker：失败匹配 + 反馈学习
  • V13 增强：ActivationMode 'subagent' 并行执行
```

### 职能 4：驱动（V13 新增）

```
不再等待 Hook → 主动计算触发时机 → 选择触发机制 → 创造事件推动状态机
  • task-scheduler：触发决策矩阵（何时/如何触发下一动作）
  • subagent-manager：并行子 Agent spawn → 监控 → 聚合
  • heartbeat-monitor：后台 Service → 停滞检测 → 分级介入
  • 5 源驱动：Hook + Cron + Subagent + Heartbeat + Service
```

---

## V13 的六个工程命题

### 命题 1：状态机不变，trigger 层升级

```
V12 状态机 (不变):
  advanceOuterLoop(state, event, triggerSource)
    triggerSource: 'hook:session_start' | 'hook:session_end'  ← V12 只用这 2 个

V13 trigger 层 (新增):
  advanceOuterLoop(state, event, triggerSource)
    triggerSource: 全部 5 种:
      'hook:session_start'    ← Hook 触发（保留）
      'hook:session_end'      ← Hook 触发（保留）
      'cron:scheduled'        ← scheduleSessionTurn() 触发 [V13 新增]
      'subagent:completed'    ← subagent.run() 完成回调 [V13 新增]
      'heartbeat:wake'        ← requestHeartbeat() 唤醒 [V13 新增]

  V12 的 1 行代码都不用改。V13 只添加新的 trigger 调用点。
```

### 命题 2：主动会话调度 — task-scheduler

```
session_end 时:
  task-scheduler.evaluate(state, policy):
    ├── 下一子任务无依赖 + parallelizable → subagent.run() 立即 spawn
    ├── 下一子任务有依赖 + 估计 < 1h → scheduleSessionTurn(at: now + estimate)
    ├── 下一子任务有依赖 + 估计 1-24h → scheduleSessionTurn(delayMs: estimate)
    ├── 长期任务 + 无人交互 → registerService() 后台监控
    └── 用户说"等我回来" → 不触发，等待 hook

  触发前检查:
    ├── active_triggering.enabled === true?
    ├── 当前时间不在 quiet_hours?
    ├── 今日触发次数 < max_triggers_per_day?
    ├── 距上次触发 > min_interval_between_triggers?
    └── 首次触发此任务? → 需用户确认 (GovernancePolicy)
```

### 命题 3：并行子 Agent 执行 — subagent-manager

```
V12: 子任务串行执行（inline），user session 中逐个完成
V13: 独立子任务并行执行（subagent），多个子 Agent 同时工作

plan-generator 标记并行化:
  subtask.parallelizable = true       // 无依赖，可并行
  subtask.depends_on = ['sub_001']    // 依赖其他子任务，不可并行

subagent-manager 生命周期:
  spawn(subtask) → SubagentRun{running}
    ├── waitForRun(runId) → SubagentResult{ok/error/timeout}
    ├── 失败 → retry (max max_retries 次)
    └── 成功 → verifyCompletion() → 聚合结果到 orchestrator

并行上限: GovernancePolicy.subagent_management.max_parallel_subagents (默认 3)
失败隔离: 一个子 Agent 失败不影响其他并行子 Agent
```

### 命题 4：持续健康监控 — heartbeat-monitor

```
heartbeat-monitor 注册为 OpenClaw Service:
  start():
    1. 加载所有 active 子任务 (task_state === TASK_IN_PROGRESS)
    2. 为每个 active 子任务计算 stall_threshold = estimated_duration × multiplier
    3. 定期检查（每 5 分钟）:
       ├── 子任务在估计时间内完成 → 正常，继续监控
       ├── 子任务超过估计时间但未超过 stall_threshold → 标记 "running long"
       └── 子任务超过 stall_threshold → STALL DETECTED

  停滞响应（分级）:
    Level 1 (nudge): 注入提醒到当前 session 的 system prompt
    Level 2 (wake): 如果无活跃 session → requestHeartbeat() 创建新 session
    Level 3 (escalate): 24h 无响应 → 标记子任务 BLOCKED，推进外循环
    Level 4 (notify): 通知用户（需要用户配置通知渠道）
```

### 命题 5：降级路径 — scheduleSessionTurn 的 bundled 限制

```
OpenClaw 约束: scheduleSessionTurn() 仅对 bundled 插件开放

V13 降级策略:
  Primary (bundled):  api.session.workflow.scheduleSessionTurn({...})
  Fallback (workspace): cron 系统 + enqueueSystemEvent()
    ├── 通过 gateway_start hook 获取 CronServiceContract
    ├── 使用 cron.add() 创建定时任务
    ├── cron 触发时 → enqueueSystemEvent() → session_start hook
    └── session_start hook 识别 trigger_source = 'cron:scheduled'

  降级代价:
    • 精度降低: 分钟级 (cron) vs 毫秒级 (scheduleSessionTurn)
    • 不支持 deleteAfterRun (需手动清理过期 cron job)
    • 需要 gateway_start hook 权限获取 CronServiceContract
```

### 命题 6：完整认知操作系统

```
AgentOS V13 完整架构:

┌──────────────────────────────────────────────────────────────┐
│                    AgentOS V13                                │
│                                                               │
│  记忆层 (V1-V8)           学习层 (V3-V11)                     │
│  ├── AgentMemory 持久化    ├── ProtoTask 任务模式             │
│  ├── 场景识别              ├── 7源置信度融合                   │
│  ├── 上下文组织            ├── 陷阱反馈闭环                   │
│  └── 压力自适应注入        └── 实时矛盾检测                   │
│                                                               │
│  编排层 (V10-V12)         驱动层 (V13)                        │
│  ├── 任务状态机 (2循环)    ├── 主动会话调度                   │
│  ├── 计划生成 (ProtoTask)  ├── 并行子Agent执行                │
│  ├── 5种验收标准           ├── 心跳健康监控                   │
│  └── 陷阱主动监控          └── 降级路径保障                   │
│                                                               │
│  四个核心职能全部到位。AgentOS 从"认知数据库"进化为             │
│  "认知操作系统"——不仅存储和组织知识，还主动驱动任务执行。       │
└──────────────────────────────────────────────────────────────┘
```

---

## V13 Is / Is-Not

| Is | Is-Not |
|----|--------|
| 完整认知操作系统（记忆+学习+编排+驱动） | 通用 AI（仍然依赖 LLM 推理） |
| 5 源驱动（Hook+Cron+Subagent+Heartbeat+Service） | 替代 Hook 系统（Hook 仍然是主要触发源） |
| 主动调度下一个 session | AgentOS 绕过用户控制（GovernancePolicy 控制） |
| 并行执行独立子任务 | 替代所有串行执行 |
| 后台监控任务健康 | 替代用户判断任务是否完成 |
| 状态机与 trigger 完全解耦 | 重写 V12 状态机逻辑 |
| 默认关闭主动触发（需用户显式开启） | 默认全自动 |
| 降级路径（workspace 插件可用） | 依赖 bundled 权限 |
| V13 代码量 < V12 + 500 行 | 大规模重构 |

---

## V12 → V13 模块变化

| 维度 | V12 | V13 | 变化 |
|------|-----|-----|------|
| 架构哲学 | AgentOS 直接做任务分解 | **AgentOS 主动驱动任务执行** | 职能扩展 |
| 核心职能 | 记忆+学习+编排 | **记忆+学习+编排+驱动** | +1 |
| 驱动方式 | Hook（被动, 2 种） | **5 源驱动（Hook+Cron+Subagent+Heartbeat+Service）** | +3 源 |
| TriggerSource | 2 种激活 | **5 种全部激活** | +3 |
| ActivationMode | inline only | **inline + subagent** | +parallel |
| 子任务执行 | 串行 | **串行 + 并行** | +concurrency |
| 会话触发 | 用户手动 | **用户手动 + AgentOS 自动** | +autonomy |
| 后台运行 | 无 | **Service 常驻** | +persistence |
| 停滞检测 | 无 | **Heartbeat 监控** | +resilience |
| 模块数 | ~29 | **~32** (+3 新, 0 移除) | +3 |
| AgentMemory Slots | 10 | **12** (+task_schedule +subagent_registry) | +2 |
| 外部接口 | 1 (MidSessionLearner) | 1 (MidSessionLearner) | 不变 |
| 实现周期 | 9 周 (Phase 0-6) | **+5 周 (Phase 7-9)** | 累计 14 周 |
| V13 净代码增量 | — | **< 500 行** | 轻量升级 |

---

## 兄弟文件

- [Why AgentOS V13?](why.md) — 第一性原理：为什么被动响应不够，为什么需要主动驱动
- [Who is it for?](who.md) — 三角色职责（用户获得自主推进能力）
- [How does it work?](how.md) — 三个新模块 + 五个修改模块的完整实现
- [When does it operate?](when.md) — Phase 7-9 路线图（+5 周）
- [Where does it sit?](where.md) — 完整模块树（V12 基础 + 3 新增 + services/ 目录）
- [Architecture Design](design.md) — 触发决策矩阵、并行执行协议、心跳监控协议
