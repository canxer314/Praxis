# Who is AgentOS V13 for?

> V13 三角色模型不变。核心变化：AgentOS 从"任务编排者"升级为"任务驱动者"——用户获得自动驾驶选项，开发者实现 3 个轻量触发模块，运维者获得精密的触发边界控制。

---

## 一、角色三角（不变的结构，V13 新增的职责）

```
              ┌──────────┐
              │  用户     │
              │ (User)    │
              └─────┬─────┘
                    │ 使用 AgentOS + OpenClaw 时:
                    │  • [V12继承] 任务开始时自动生成计划
                    │  • [V12继承] 会话中看到结构化的进度和陷阱预警
                    │  • [V12继承] 子任务完成时自动验收
                    │  • [V13新增] 开启"自动驾驶"模式——AgentOS 在后台自动推进任务
                    │  • [V13新增] 独立子任务并行执行——等待时间减少
                    │  • [V13新增] 子任务停滞时收到提醒——不会忘记任务
                    │  • [V13新增] 在合适的时间被自动唤醒——"刚好该做下一步了"
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  开发者   │  │  运维者   │  │  AgentOS │
│(Developer)│  │(Operator) │  │  自身     │
└──────────┘  └──────────┘  └──────────┘
 实现3个触发模块  配置触发边界    主动驱动任务状态机
 实现并行子Agent  控制自动驾驶权限  计算+选择触发机制
 实现心跳监控     设定静默时段      spawn并行子Agent
 V12代码几乎不改  监控触发频率     后台持续监控健康
```

---

## 二、用户（User）

### V13 新增/变化的交互

```
1. 开启自动驾驶模式:
   用户: /agentos task auto on
   
   AgentOS: "自动驾驶模式已开启。我将:
           - 在每个子任务完成后自动安排下一个 session
           - 对独立子任务使用并行执行（最多 3 个）
           - 在子任务停滞时主动提醒你
           - 静默时段: 22:00-08:00（可在配置中修改）
           你可以随时用 /agentos task auto off 关闭。"

2. 自动 session 触发:
   [用户在 14:00 完成了"数据库 Schema 设计"子任务]
   [AgentOS 计算: 下一子任务"API 端点实现"估计 3 小时]
   [AgentOS 注册 scheduleSessionTurn: at 17:00]
   
   [17:00 — 用户收到通知，打开 Claude]
   AgentOS 已准备好上下文:
   "## 任务编排状态 [AgentOS V13 — 自动驾驶]
   任务: 医院管理系统
   阶段: Phase 2/5 — API 开发
   当前子任务: 实现预约挂号 API (第 3/7 步)
   
   📅 自动触发: 基于上一子任务完成时间 + 3h 估计
   ✅ 已完成: 数据库 Schema 设计 (14:00 完成)
   ⚡ 并行进行中: 前端脚手架搭建 (子 Agent, 14:05 启动)"
   
   用户感知: 不需要记得"该做下一步了"——AgentOS 在合适的时间准备好了上下文。

3. 并行子 Agent 执行:
   用户: "开始 Phase 3 的三个独立子任务"
   
   V13 AgentOS:
   → 检测 3 个子任务都标记为 parallelizable + 无依赖
   → spawn 3 个子 Agent:
     • 子Agent 1: 设计数据库 Schema — 独立 session
     • 子Agent 2: 搭建前端脚手架 — 独立 session
     • 子Agent 3: 配置 CI/CD Pipeline — 独立 session
   → 父 session 显示并行状态:
     "⚡ 3 个子任务并行执行中...
      🔄 Schema 设计 — 运行中 (15 min)
      🔄 前端脚手架 — 运行中 (8 min)
      ✅ CI/CD 配置 — 已完成 (5 min)"
   → 全部完成后聚合结果，验证，推进到下一批子任务
   
   用户感知: 3 个子任务同时进行，总等待时间 = 最慢的那个 (15 min)，而不是 15+8+5=28 min。

4. 停滞检测 + 主动介入:
   [用户 3 天前开始了一个复杂子任务，然后忘记了]
   
   V13 heartbeat-monitor:
   Day 1: 子任务运行中，未超过估计时间 → 正常
   Day 2: 子任务超过估计时间，但未超 stall_threshold → 标记 "running long"
   Day 3: 子任务超过 2x 估计时间 → STALL DETECTED
   
   → 检查: 当前无活跃 session
   → requestHeartbeat() 创建新 session
   → session_start 时注入:
     "⚠️ 停滞检测: 子任务 '医保接口对接' 已超过估计时间 3x。
      上次活动: 3 天前。
      建议: 检查医保接口的外部依赖是否已就绪，或考虑标记为 BLOCKED。"
   
   用户感知: 不是 3 周后才发现卡住了——3 天内就收到了提醒。

5. 用户管理自动驾驶:
   /agentos task auto status
   → "自动驾驶: 开启
      活跃触发: 1 个定时 session (明天 09:00)
      并行子Agent: 0 个运行中, 3 个已完成
      心跳监控: 监控 2 个活跃子任务
      今日触发: 2/8
      静默时段: 22:00-08:00"
   
   /agentos task auto off
   → "自动驾驶已关闭。已清理 1 个待触发定时任务。"
   
   /agentos task auto config
   → 修改自动驾驶参数（静默时段、每日上限、并行数等）
```

---

## 三、开发者（Developer）

### V13 新增/修改模块清单

| 模块 | 路径 | 职责 | 代码量 | 复杂度 |
|------|------|------|--------|--------|
| **task-scheduler** | `orchestration/task-scheduler.ts` | 触发决策矩阵 + scheduleSessionTurn 集成 | ~120 行 | 中 |
| **subagent-manager** | `orchestration/subagent-manager.ts` | 子Agent spawn/监控/聚合/重试 | ~150 行 | 中 |
| **heartbeat-monitor** | `services/heartbeat-monitor.ts` | Service注册 + 停滞检测 + 分级响应 | ~100 行 | 中 |
| *task-orchestrator* | `orchestration/task-orchestrator.ts` | +ActivationMode 'subagent' + 新TriggerSource处理 | ~40 行 | 低 |
| *session-end* | `hooks/session-end.ts` | +调用scheduler + 注册定时任务 | ~30 行 | 低 |
| *session-start* | `hooks/session-start.ts` | +处理非hook触发源 + 恢复调度状态 | ~15 行 | 低 |
| *plan-generator* | `orchestration/plan-generator.ts` | +parallelizable标记 + depends_on分析 | ~15 行 | 低 |
| *verifier* | `orchestration/verifier.ts` | +异步验证结果处理 | ~10 行 | 低 |

**粗体** = 新模块, *斜体* = 修改模块

### 关键设计决策（V13 新增）

```
决策 1: 状态机零改动策略
  方案: V13 不修改 V12 的 TaskOrchestrationState 状态机逻辑。
        advanceOuterLoop() 的 switch-case 完全不变。
        TriggerSource 和 ActivationMode 只是传入参数——状态机不关心来源。
  理由: 状态机是正确的、经过设计的。在 trigger 层添加功能不应该强迫状态机改变。
        这证明了 V12 的"trigger 解耦"设计是有效的。
  风险: 如果未来需要 trigger-source-specific 的状态转换（如"cron触发时行为不同"），
        可能需要在状态机中添加条件分支。缓解：当前不需要，保持简单。

决策 2: scheduleSessionTurn 的抽象层
  方案: task-scheduler 不直接调用 api.session.workflow.scheduleSessionTurn()。
        而是通过一个 TriggerAdapter 接口:
          interface TriggerAdapter {
            scheduleTurn(params): Promise<{jobId}>;
            cancelTurn(jobId): Promise<void>;
          }
        两个实现:
          BundledTriggerAdapter → api.session.workflow.scheduleSessionTurn()
          CronTriggerAdapter → cron.add() + enqueueSystemEvent()
  理由: 抽象层实现降级路径，不绑定部署模式。
  风险: 抽象层增加了一层间接性。缓解：接口只有 2 个方法，非常薄。

决策 3: 子 Agent 上下文注入格式
  方案: 子 Agent 的 extraSystemPrompt 包含:
        - 精简的 TaskOrchestrationState（当前子任务 + 相关 pitfalls）
        - 子任务的 full SubtaskDefinition（scope, criteria, allowed_operations）
        - 相关的 ProtoStructures（仅 relevant_structures 列表中的）
        - 不包含: 父 session 的对话历史、其他子任务的状态
  理由: 精简上下文 = 更低的 token 成本 + 更少的干扰。
        子 Agent 只做一件事，它不需要知道整个项目的状态。
  风险: 子 Agent 可能缺少上下文做出正确判断。缓解：relevant_structures 字段
        由 plan-generator 在计划生成时填充，确保关键知识被注入。

决策 4: 心跳监控的检查间隔
  方案: 默认每 5 分钟检查一次活跃子任务。检查内容:
        1. 子任务是否仍处于 ACTIVE 状态
        2. 当前时间 - subtask_started_at 是否超过 estimated_duration
        3. 如果超过，是否超过 stall_threshold (estimated × multiplier)
        4. 是否有最近的活动信号（tool_call 在最近 30 分钟内）
  理由: 5 分钟间隔在"及时发现停滞"和"不消耗过多资源"之间平衡。
        对于估计 1 小时的子任务，5 分钟粒度足够。
  风险: 对于估计 5 分钟的快速子任务，5 分钟检查间隔可能来不及。
        缓解：快速子任务通常在单次会话中完成——不需要心跳监控。

决策 5: 触发去重
  方案: task-scheduler 在创建新触发前:
        1. 检查 pending_triggers 是否已有同类型触发
        2. 检查 active_cron_job_ids 是否已有活跃 cron job
        3. 如果已有且未过期 → 跳过（不创建重复触发）
        4. 如果已有但已过期 → 取消旧触发，创建新触发
  理由: session_end 可能被多次调用（重试、子Agent结束回调等），
        需要确保不会创建多个重复的定时触发。
  风险: 去重逻辑可能误取消合理的重复触发。缓解：去重基于 (task_id + subtask_id + reason)，
        只有完全相同的触发才被去重。
```

---

## 四、运维者（Operator）

### GovernancePolicy V13 新增配置

```yaml
# ── V13 新增: activeTriggering ──
active_triggering:
  enabled: false                      # 默认关闭 — 用户必须显式开启
  allow_schedule_session_turn: true   # 允许定时触发 session
  allow_subagent_spawn: true          # 允许 spawn 子 Agent
  allow_heartbeat_monitor: true       # 允许心跳监控
  allow_background_service: true      # 允许注册后台服务
  max_parallel_subagents: 3           # 最多并行子 Agent 数 (1-10)
  min_interval_between_triggers_minutes: 30  # 两次触发最小间隔 (10-240)
  max_triggers_per_day: 8             # 每日最大触发次数 (1-24)
  quiet_hours: "22:00-08:00"          # 静默时段（不触发），格式 "HH:MM-HH:MM"
  quiet_hours_timezone: "Asia/Shanghai"
  require_user_confirmation_for:      # 需要用户确认的触发类型
    - "first_trigger_of_task"         # 首次开启自动驾驶
    - "subagent_spawn"                # spawn 子 Agent
  stall_threshold_multiplier: 2.0     # 子任务超时阈值 = 估计时间 × 此值 (1.5-5.0)
  auto_cancel_stalled_after_hours: 24 # 停滞超过此时间自动取消子任务 (0 = 不自动取消)
  max_heartbeat_checks_per_hour: 12   # 心跳监控每小时最多检查次数
  trigger_failure_backoff_minutes: 30 # 触发失败后的退避时间

# ── V13 新增: subagentManagement ──
subagent_management:
  max_parallel_subagents: 3           # 同 active_triggering.max_parallel_subagents
  subagent_timeout_minutes: 60        # 子 Agent 超时时间 (5-240)
  max_retry_per_subagent: 2           # 每个子 Agent 最多重试次数 (0-5)
  inherit_parent_context: true        # 子 Agent 继承父 session 上下文
  inherit_relevant_structures: true   # 子 Agent 继承相关 ProtoStructures
  aggregate_results_in_parent: true   # 结果聚合到父 orchestrator
  cleanup_subagent_sessions: true     # 完成后清理子 Agent session
  subagent_model_override: null       # 子 Agent 模型覆盖 (null = 使用默认)

# ── V13 新增: triggerAdapter ──
trigger_adapter:
  mode: "auto"                        # "auto" | "bundled" | "cron"
                                      # auto: 自动检测部署模式
                                      # bundled: 强制使用 scheduleSessionTurn
                                      # cron: 强制使用 cron 降级路径
  cron_fallback:
    min_interval_minutes: 5           # cron 最小间隔
    max_pending_jobs: 20              # 最多待处理 cron job
    cleanup_completed_after_hours: 1  # 完成后多久清理 cron job
```

### AgentOS 自主权边界（V13 重新界定）

```
V12 的立场:
  ✅ 生成任务计划（ProtoTask → 这是从已有知识推导，不是决策）
  ✅ 管理子任务状态机（确定性状态转换，不是决策）
  ✅ 运行验收检查（确定性标准匹配，不是决策）
  ✅ 监控陷阱命中（模式匹配 + 历史对比，不是决策）
  ❌ 替代 LLM 推理（LLM 仍然做代码/内容工作）
  ❌ 替代用户决策（用户仍然决定"做什么任务"）
  ❌ 替代 OpenClaw 执行工具（工具调用仍在 OpenClaw 中）

V13 的立场:
  ✅ [V12 全部保留]
  ✅ 调度下一个 session（基于确定性决策矩阵，不是决策）
  ✅ 识别可并行子任务（基于依赖分析，不是决策）
  ✅ 检测子任务停滞（基于时间阈值比较，不是决策）
  ✅ 选择触发机制（基于配置 + 条件匹配，不是决策）
  ❌ 在用户未授权时启动主动触发（GovernancePolicy enabled: false）
  ❌ 在静默时段触发 session
  ❌ 超过每日触发上限后继续触发

关键原则（不变）:
  AgentOS 仍然不"做决策"——它做的是"条件→动作"的确定性映射。
  主动触发 = 在满足 GovernancePolicy 所有约束条件时，自动执行预定义的触发动作。
  这不是 AI 的自主决策——这是配置驱动的自动化。
```

---

## 兄弟文件

- [What is AgentOS V13?](what-is.md) — V13 定义 + 四个核心职能
- [Why AgentOS V13?](why.md) — 第一性原理：为什么被动响应不够
- [How does it work?](how.md) — 三个新模块 + 五个修改模块的完整实现
- [When does it operate?](when.md) — Phase 7-9 路线图（+5 周）
- [Where does it sit?](where.md) — 完整模块树（V12 基础 + 3 新增 + services/ 目录）
- [Architecture Design](design.md) — 触发决策矩阵、并行执行协议、心跳监控协议
