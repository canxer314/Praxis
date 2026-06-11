# Why Praxis V13?

> 从第一性原理出发，分析为什么 V12 的 Hook 驱动不够——为什么 Praxis 需要"主动驱动"能力，以及为什么这个能力不能在 V12 的 Hook 框架内实现。

---

## 一、不可否认的工程基础

```
事实 1: V12 的状态机是完整的——但它是"等事件"的状态机。
        advanceOuterLoop(state, event, triggerSource) 可以处理任何事件，
        但它不创造事件。它等待 session_start hook 告诉它"用户来了"，
        等待 session_end hook 告诉它"用户走了"。
        如果用户在子任务 A 完成后离开了 3 天，状态机就停在那里 3 天。

事实 2: OpenClaw 提供了创造事件的所有基础设施。
        scheduleSessionTurn() 可以定时触发 session。
        subagent.run() 可以程序化 spawn 子 Agent。
        requestHeartbeat() 可以主动唤醒。
        registerService() 可以注册常驻后台服务。
        enqueueSystemEvent() 可以注入系统事件。
        这些 API 都存在——V12 只是没有使用它们。

事实 3: V12 的 TriggerSource 和 ActivationMode 类型已经定义了 V13 的扩展点。
        TriggerSource 包含 5 个变体，V12 只用 2 个。
        ActivationMode 包含 'subagent'，V12 只用 'inline'。
        V12 的架构明确为 V13 预留了空间——这不是事后合理化，
        而是 V12 设计时的前瞻决策。

事实 4: 复杂任务的自然节奏不是"用户每次打开会话做一点"。
        一个 5 阶段的软件项目不会在每次用户打开 Claude 时恰好推进一个子任务。
        有些子任务需要 15 分钟（用户在一次会话中完成），
        有些子任务需要 4 小时（用户离开，Praxis 应该在 4 小时后提醒），
        有些子任务互相独立（应该并行执行，而不是等用户逐个串行启动）。

事实 5: 停滞是复杂任务最常见的失败模式。
        子任务被阻塞但没有被检测到 → 用户忘记了这个任务 →
        几周后重新打开 → 不记得做到哪了 → 放弃或重做。
        V12 的 Hook 驱动无法检测停滞——它只在 Hook 触发时运行。
        V13 的 heartbeat-monitor 可以在后台持续监控，在停滞发生时立即介入。
```

---

## 二、为什么 Hook 驱动不够

### 2.1 时间盲区

V12 的状态机只在 Hook 触发时运行。Hook 之间的时间段是"盲区"：

```
V12 时间线:
  session_start ──── [盲区] ──── message_received ──── [盲区] ──── session_end ──── [盲区: 3天] ──── session_start

  在 3 天盲区中:
    • 状态机不运行
    • 没有停滞检测
    • 子任务超时不会被发现
    • ProtoTask 学习被延迟（要等到下一个 session_end）
    • 用户可能忘记任务的存在
```

V13 消除了盲区：

```
V13 时间线:
  session_start ──── [心跳监控] ──── session_end
       │                                      │
       └── scheduleSessionTurn("4h later") ──→ [4h后自动触发新session]
                                                  │
                                                  └── heartbeat-monitor 持续运行
                                                      检测停滞 → requestHeartbeat → 介入
```

### 2.2 串行瓶颈

V12 的所有子任务在当前 session 中串行执行（inline 模式）。在一个 session 中，用户和 LLM 逐个完成子任务。但：

- 如果 3 个子任务互相独立（如"设计数据库 Schema"、"搭建前端脚手架"、"配置 CI/CD pipeline"），它们应该可以并行执行
- 串行执行浪费用户时间（用户必须等待每个子任务逐一完成，而不是同时推进 3 个）
- 串行执行浪费 LLM 能力（3 个子 Agent 可以同时工作，每个专注于自己的子任务）

V13 的 subagent-manager 打破串行瓶颈：
- 独立子任务同时 spawn 为子 Agent
- 每个子 Agent 专注自己的子任务（更少的分心，更高的质量）
- 父 session 聚合结果，继续推进依赖子任务

### 2.3 被动等待

V12 在 session_end 时保存状态，然后什么也不做——等待用户下次启动会话。这隐含假设"用户会记得、会在合适的时间回来、会知道接下来做什么"。但：

- 用户可能忘记（"那个项目我做到哪了？"）
- 用户可能在不合适的时间回来（子任务需要前置条件还没满足）
- 用户不知道"现在该做什么"（V12 注入了上下文，但用户必须主动打开会话才能看到）

V13 的 task-scheduler 在 session_end 时主动规划：
- "下一个子任务估计需要 2 小时 → 2 小时后自动触发 session"
- "这个子任务被阻塞了，等待外部依赖 → 24 小时后检查"
- "任务完成！→ 不触发，标记 TASK_COMPLETE"

---

## 三、V13 修正了什么

### 3.1 从"事件消费者"到"事件生产者"

```
V12: Praxis 是事件消费者
  Hook 事件 → Praxis 响应 → 更新状态 → 等待下一个 Hook 事件

V13: Praxis 既是消费者，也是生产者
  Hook 事件 → Praxis 响应 → 更新状态 → 计算下一步 → 创造新事件
                                           │
                                           ├── scheduleSessionTurn()
                                           ├── subagent.run()
                                           ├── requestHeartbeat()
                                           └── enqueueSystemEvent()
```

### 3.2 能力对比

| 能力 | V12 (Hook驱动) | V13 (多源驱动) | 差异 |
|------|---------------|---------------|------|
| 响应 Hook | ✅ | ✅ | 不变 |
| 定时触发 session | ❌ | ✅ scheduleSessionTurn | 新增 |
| 并行执行子任务 | ❌ | ✅ subagent.run | 新增 |
| 停滞检测 | ❌ | ✅ heartbeat-monitor | 新增 |
| 后台持续运行 | ❌ | ✅ registerService | 新增 |
| 注入系统事件 | ❌ | ✅ enqueueSystemEvent | 新增 |
| 计划并行优化 | ❌ | ✅ parallelizable 标记 | 新增 |
| 降级路径 | — | ✅ cron fallback | 新增 |

### 3.3 代码变更范围

```
V13 新增代码 (~370 行):
  task-scheduler.ts    ~120 行  — 触发决策矩阵
  subagent-manager.ts  ~150 行  — 子Agent生命周期
  heartbeat-monitor.ts ~100 行  — 停滞检测+分级响应

V13 修改代码 (~110 行):
  task-orchestrator.ts  ~40 行  — ActivationMode 'subagent' + 新TriggerSource
  session-end.ts        ~30 行  — 调用scheduler + 注册定时任务
  session-start.ts      ~15 行  — 处理非hook触发源
  plan-generator.ts     ~15 行  — parallelizable + depends_on
  verifier.ts           ~10 行  — 异步验证结果

总增量: < 500 行
移除: 0 行（所有 V12 代码保留）
```

---

## 四、主动驱动的独立论证

### 4.1 task-scheduler — 必要性论证

**如果没有**：Praxis 在 session_end 后停止运行。任务的下一个子任务何时启动，完全取决于用户何时手动开始下一个 session。如果用户忘记或延迟，任务就停滞。Praxis 知道"接下来该做什么"（状态机记录了），但没有能力"让接下来发生"。

**有了之后**：session_end 时，task-scheduler 检查 TaskOrchestrationState，计算下一子任务的启动时间，通过 scheduleSessionTurn() 注册定时触发。用户不需要记得——Praxis 会在合适的时间主动启动 session，准备好转入下一子任务的上下文。

### 4.2 subagent-manager — 必要性论证

**如果没有**：所有子任务在用户的主 session 中串行执行。用户必须等待每个子任务完成才能进入下一个。3 个独立子任务 = 3 倍等待时间。且当前 session 的上下文会被 3 个子任务混杂——子任务 A 的代码 + 子任务 B 的配置 + 子任务 C 的测试，全部在一个对话中。

**有了之后**：独立的子任务 spawn 为子 Agent。每个子 Agent 有自己的 session，专注自己的子任务。3 个子 Agent 并行工作 = 理论加速 3x。父 session 保持干净——只关注依赖关系和聚合结果。

### 4.3 heartbeat-monitor — 必要性论证

**如果没有**：子任务在运行中停滞（等待外部 API 响应、用户的同事没有回复、依赖的服务宕机），Praxis 不知道。直到用户下次启动 session，发现"子任务卡住了"，手动处理。这个"发现"可能发生在几天后——浪费了几天的时间。

**有了之后**：heartbeat-monitor 作为后台 Service 持续运行。每 5 分钟检查活跃子任务的状态。如果子任务在 2x 估计时间内没有进展 → 分级响应：nudge → wake → escalate → notify。停滞在几分钟或几小时内被发现和处理，而不是几天后。

---

## 五、反向论证

**反方论点**："V12 的 Hook 驱动已经足够了。用户本来就是任务的主导者——他们会在合适的时候启动 session。Praxis 主动触发 session 可能打扰用户（在不合适的时间弹出通知），或者做出错误的并行决策（把有隐含依赖的子任务标记为并行）。V13 增加的复杂度（3 个新模块）不值得——用户手动控制更安全。"

**回应**：

1. "用户主导"不意味着"用户包办一切"。V13 的主动触发默认关闭——用户决定是否开启。开启后，Praxis 的调度仍然受 GovernancePolicy 严格约束（静默时段、每日上限、确认机制）。这不是从用户手中夺取控制权，而是给用户提供一个"自动驾驶"选项。

2. "错误并行"的风险是真实的——但控制在 plan-generator 的依赖分析中。只有被明确标记为 `parallelizable: true` 且 `depends_on: []` 的子任务才会被并行执行。如果依赖分析错误，影响是局部的（一个子 Agent 的上下文不完整），不会导致系统崩溃。

3. "打扰用户"的风险通过静默时段（默认 22:00-08:00 不触发）和首次触发确认机制来控制。而且 V13 的触发不是"弹出通知"——它是自动启动一个 session，准备好上下文。用户看到的是一个已经准备好的工作环境，而不是打断。

4. V13 的净代码增量 < 500 行——3 个轻量模块 + 5 个小改动。复杂度增加与能力增加不成比例（3 个新核心能力，< 500 行代码）。

**什么证据会推翻当前结论？**

- 如果 scheduleSessionTurn 在所有部署模式下都不可用且降级路径也失败 → V13 的核心能力无法实现
- 如果用户调研显示 > 50% 的用户认为主动触发"令人不安"或"失去控制感" → 主动驱动的需求假设不成立
- 如果并行子 Agent 的失败率 > 串行执行的失败率（即并行带来的上下文精简导致质量下降）→ 子 Agent 的上下文继承策略有问题
- 如果 heartbeat-monitor 的误报率 > 40%（将正常运行标记为停滞）→ 心跳监控的阈值设计有问题

---

## 六、可证伪预测（V13 新增）

8. **触发准确率**: task-scheduler 计算的触发时间与实际需要的偏差 < 30%。即如果估计子任务需要 2 小时，实际触发时间在 1.4-2.6 小时之间。

9. **并行加速比**: 3 个可并行子任务使用 subagent.run() 的总耗时 ≤ 串行执行的 60%。即如果串行需要 3 小时，并行 ≤ 1.8 小时。

10. **停滞检测率**: ≥ 80% 的实际停滞子任务在 2x 估计时间内被 heartbeat-monitor 检测到。即如果一个子任务估计 1 小时，实际上停滞了，在 2 小时内被检测到的概率 > 80%。

11. **用户接受度**: 开启主动触发的用户中，< 20% 在 10 次任务后关闭该功能。

12. **V13 净代码增量**: V13 总代码量 < V12 + 500 行。新增 3 模块 ~370 行 + 5 模块修改 ~110 行 = ~480 行。

13. **降级路径可用性**: cron 降级路径在 workspace 插件部署模式下成功触发 ≥ 95% 的定时 session（允许 5% 的 cron 精度误差）。

---

## 七、输出前自检

- [x] 结论（V13 需要主动驱动）是在分析 V12 的局限性和 OpenClaw 的能力之后形成的
- [x] 认真构建了反面论证（Hook 驱动已足够 + 四个证伪条件）
- [x] 最薄弱的假设已标注（scheduleSessionTurn 可用性、用户接受度、子 Agent 质量）
- [x] 没有迎合"V13 必须是革命性升级"的隐含期望（明确指出净增量 < 500 行，是一次轻量升级）

---

## 兄弟文件

- [What is Praxis V13?](what-is.md) — V13 定义 + 四个核心职能
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 三个新模块 + 五个修改模块的完整实现
- [When does it operate?](when.md) — Phase 7-9 路线图（+5 周）
- [Where does it sit?](where.md) — 完整模块树（V12 基础 + 3 新增）
- [Architecture Design](design.md) — 触发决策矩阵、并行执行协议、心跳监控协议
