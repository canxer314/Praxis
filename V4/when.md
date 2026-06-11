# When does AgentOS V4 operate?

## V4 触发模型：事件驱动 + 时间驱动 + 过程驱动

V3 是"事件驱动 + 主动扫描"。V4 新增了"时间驱动"和"过程驱动"两个触发维度。

```
触发类型              触发点                              V3    V4
──────────────────────────────────────────────────────────────
Hook (事件驱动)       session_start                       ✅    ✅
Hook (事件驱动)       message_received                    ✅    ✅（扩展：识别协作者回复）
Hook (事件驱动)       before_tool_call                    ✅    ✅
Hook (事件驱动)       after_tool_call                     ✅    ✅
Hook (事件驱动)       agent_end                           ✅    ✅（扩展：流程反思）
Hook (事件驱动)       session_end                         ✅    ✅
定时扫描 (时间驱动)    cron_tick (每 N 小时)               ❌    ✅ 新增
过程事件 (过程驱动)    步骤入口条件满足                     ❌    ✅ 新增
过程事件 (过程驱动)    步骤出口条件满足 → 推进下一步        ❌    ✅ 新增
过程事件 (过程驱动)    步骤超时 → Momentum Engine           ❌    ✅ 新增
过程事件 (过程驱动)    依赖角色回复 → 更新步骤状态          ❌    ✅ 新增
主动检测               Curiosity Engine 缺口扫描           ✅    ✅
用户命令               /agentos *                         ✅    ✅（扩展）
```

---

## 完整生命周期（V4）

```
┌────────────────────────────────────────────────────────────┐
│                  AgentOS V4 Lifecycle                        │
│                                                              │
│  OPENCLAW SESSION START ──────────────────────────────────▶ │
│    │                                                         │
│    ├─ [Hook: session_start]                                  │
│    │   ├─ 加载六维能力模型                                   │
│    │   ├─ 加载活跃 ProcessInstance[]  ← V4 新增             │
│    │   ├─ 加载 RoleRegistry             ← V4 新增           │
│    │   ├─ 加载 CuriosityConfig + MomentumConfig ← V4 新增   │
│    │   └─ 注入 AgentOS Context (含活跃流程摘要)              │
│    │                                                         │
│    │   ┌─── WORK PHASE ────────────────────────────────┐    │
│    │   │                                                │    │
│    │   │  [Hook: message_received]                      │    │
│    │   │  ├─ V3 原有: 语义分析（教导/纠正/偏好/评价）   │    │
│    │   │  └─ V4 新增: 协作者回复识别                    │    │
│    │   │      ├─ 发送者是否在 RoleRegistry 中？         │    │
│    │   │      ├─ 回复是否匹配活跃步骤的出口条件？       │    │
│    │   │      └─ 更新步骤状态 + 检查是否推进下一步      │    │
│    │   │                                                │    │
│    │   │  ┌─── 过程事件: 步骤出口条件满足 ← V4 新增 ──┐│    │
│    │   │  │ Process Engine:                            ││    │
│    │   │  │ → 当前步骤 → completed                     ││    │
│    │   │  │ → Action Verification: 评估这一步           ││    │
│    │   │  │ → 检查流程是否完成                         ││    │
│    │   │  │   → 未完成: 触发下一步骤                   ││    │
│    │   │  │   → 完成: 流程闭环反思                     ││    │
│    │   │  └────────────────────────────────────────────┘│    │
│    │   │                                                │    │
│    │   │  [Hook: before_tool_call / after_tool_call]    │    │
│    │   │  (V3 逻辑，不变)                               │    │
│    │   │                                                │    │
│    │   └────────────────────────────────────────────────┘    │
│    │                                                         │
│    │  [Hook: agent_end] ← V4 扩展                            │
│    │  ├─ V3 原有: 工具级学习 + 任务级反思                    │
│    │  ├─ V3 原有: Curiosity Engine 扫描                     │
│    │  └─ V4 新增:                                            │
│    │      ├─ 更新活跃 ProcessInstance 的当前步骤状态         │
│    │      ├─ 对所有 "self" 类型步骤: 评估完成情况            │
│    │      ├─ 对刚完成的步骤: Action Verification             │
│    │      └─ 检测新依赖（如: 开发中发现需要架构师澄清）      │
│    │                                                         │
│  ═══════════════════════════════════════════════════════════ │
│  ║          跨会话: cron_tick 定期扫描 ← V4 新增            ║ │
│  ║                                                          ║ │
│  ║  每 N 小时自动触发（OpenClaw cron）:                      ║ │
│  ║  ├─ 扫描所有活跃 ProcessInstance                         ║ │
│  ║  ├─ 检查每个 waiting 步骤的等待时间                       ║ │
│  ║  ├─ T > nudge_threshold → Momentum Engine 评估           ║ │
│  ║  ├─ T > escalation_threshold → 升级通知用户              ║ │
│  ║  └─ 记录扫描结果（不阻塞正常会话）                        ║ │
│  ╚══════════════════════════════════════════════════════════ ╝
│                                                              │
│  OPENCLAW SESSION END ────────────────────────────────────▶ │
│    │                                                         │
│    └─ [Hook: session_end] ← V4 扩展                          │
│        ├─ V3 原有: 四维成长总结 + Curiosity 缺口审计         │
│        └─ V4 新增:                                            │
│            ├─ 流程状态快照 (所有活跃 ProcessInstance)         │
│            ├─ 流程效率对比 (本次 vs 同模板历史)               │
│            ├─ Momentum 效果总结 (催了几次/升级几次/效果)     │
│            ├─ Role 互动统计 (与各协作者的互动次数和效果)     │
│            └─ ProcessTemplate 优化提案 (如有显著偏离)        │
└────────────────────────────────────────────────────────────┘
```

---

## 新增触发详解

### 1. cron_tick（V4 新增，时间驱动）

```
触发: OpenClaw cron job，默认每 4 小时
处理:

function onCronTick():
  active_processes = memory_slot_get("active_processes")
  
  for each process in active_processes:
    current_step = process.current_step
    
    if current_step.type == "self":
      continue  # 自己做的步骤不需要催
    
    if current_step.status == "waiting":
      elapsed = now() - current_step.last_status_change
      
      # 检查是否超时
      if elapsed > current_step.escalation_threshold:
        → MomentumEngine.decide(step=current_step, severity="critical")
      
      elif elapsed > current_step.nudge_threshold:
        → MomentumEngine.decide(step=current_step, severity="moderate")
      
      elif elapsed > current_step.reasonable_wait:
        → 标记关注（不行动，但下次扫描优先检查）
  
  # 频率自适应
  if any_step_close_to_threshold:
    schedule_next_scan("1h")
  else:
    schedule_next_scan("4h")
```

### 2. 过程事件：步骤入口条件满足（V4 新增，过程驱动）

```
触发: 上一个步骤完成时自动检查

ProcessEngine.checkNextStep():
  next_step = process.template.steps[process.current_index + 1]
  
  # 检查入口条件
  conditions_met = all([
    check_dependency(next_step.depends_on),      # 依赖的步骤都完成了？
    check_data_available(next_step.inputs),       # 需要的数据都有了？
    check_role_available(next_step.assignee),     # 协作者可用？
    check_timing(next_step.timing_constraints),   # 时间约束满足？
  ])
  
  if conditions_met:
    → 激活步骤: status → "ready"
    → 如果 type == "self": 在下次 agent loop 中执行
    → 如果 type == "delegated": 通过 Momentum Engine 发起请求
    → 如果 type == "collaborative": 通知所有参与者
  else:
    → 标记阻塞原因
    → 如果阻塞在"角色不可用" → 触发 Momentum Engine (策略=bypass?)
    → 通知用户（仅当阻塞会影响整体时间线时）
```

### 3. 过程事件：步骤超时（V4 新增，过程驱动）

```
触发: cron_tick 或 agent_end 检测到等待时间超过阈值

MomentumEngine.decide():
  context = {
    step: current_step,
    assignee: RoleRegistry.get(step.assignee),
    wait_duration: elapsed,
    nudge_history: step.nudge_history,
    process_urgency: process.deadline ? (remaining_time / total_time) : 0.5
  }
  
  decision = momentum_decision_tree.evaluate(context)
  
  # 可能的输出:
  # - {action: "wait", reason: "还没到催办时间"}
  # - {action: "nudge", level: "light", message: "..."}
  # - {action: "nudge", level: "firm", message: "..."}
  # - {action: "escalate", message_to_user: "...", context: "..."}
  # - {action: "bypass", alternative_roles: [...], reason: "..."}
  # - {action: "abandon", reason: "目标不再有效"}
```

### 4. message_received 扩展：协作者回复识别

```
[Hook: message_received] ← V4 扩展

原有 V3 逻辑:
  → 分析发送者 = user 的消息意图

V4 新增逻辑:
  → 如果发送者 != user:
      → 查 RoleRegistry: 发送者是否匹配某个 Role？
      → 如果是:
          → 查找"等待此人回复"的活跃步骤
          → 分析回复内容:
              ├─ 确认/批准 → 步骤出口条件满足
              ├─ 修改意见 → 更新输出 + 重新等待确认
              ├─ 拒绝 → 通知用户 + 建议替代方案
              ├─ 转介 ("这个应该找XX") → 更新 RoleModel + 重新路由
              └─ 一般交流 → 无流程影响，更新互动历史
      → 更新 Role.interaction_history + last_interaction
```

---

## 推动时机治理

V4 的 Momentum Engine 和 V3 的 Curiosity Engine 共享"不烦人"原则，但有独立的治理参数：

| 治理维度 | Curiosity Engine (V3) | Momentum Engine (V4) |
|---------|----------------------|---------------------|
| 频率限制 | 每天最多 N 个提问 | 每个协作者每天最多 N 次催办 |
| 静默时段 | quiet_hours | 协作者 dead_zones 内不催 |
| 首次确认 | Level 0→2 需用户手动 | 首次催办某协作者 → 告知用户 |
| 降级策略 | 被忽略 3 天降级 | 催了 max_nudges 次 → 升级 |
| 关闭机制 | `/agentos curiosity off` | `/agentos momentum off [role]` |
| 学习能力 | 从用户回应中学习 | 从协作者响应模式中学习 |

### MomentumConfig（V4 新增）

```yaml
MomentumConfig:
  mode: "conservative"               # conservative | balanced | aggressive
  
  global_limits:
    max_nudges_per_day: 5            # 全局催办上限
    max_escalations_per_week: 3      # 全局升级上限
    quiet_hours: ["22:00", "08:00"]
    no_nudge_on_weekends: true
  
  role_defaults:                     # 每个角色的默认策略
    max_nudges: 3
    nudge_interval: "2 天"
    escalation_after_nudges_exhausted: true
  
  auto_learn: true                   # 从互动中自动调整策略
  
  user_notifications:                # 什么时候通知用户
    on_escalation: true              # 升级时立即通知
    on_nudge_chain: "summary"        # 催办链结束后汇总
    on_bypass: true                  # 绕过时通知
    on_process_complete: true        # 流程完成时总结
```

---

## 用户命令（V4 新增）

| 命令 | 功能 | V3 | V4 |
|------|------|----|----|
| `/agentos processes` | 查看所有活跃流程及状态 | ❌ | ✅ |
| `/agentos process <id>` | 查看某个流程的详细信息 | ❌ | ✅ |
| `/agentos process <id> skip <step>` | 跳过某个步骤 | ❌ | ✅ |
| `/agentos process <id> reassign <step> <role>` | 重新分配步骤给另一个角色 | ❌ | ✅ |
| `/agentos roles` | 查看角色注册表 | ❌ | ✅ |
| `/agentos role <id>` | 查看角色详细画像 | ❌ | ✅ |
| `/agentos role <id> update` | 更新角色信息 | ❌ | ✅ |
| `/agentos momentum` | 查看 Momentum 配置 | ❌ | ✅ |
| `/agentos momentum off [role]` | 暂停催办（全局/某角色） | ❌ | ✅ |
| `/agentos templates` | 查看流程模板 | ❌ | ✅ |
| `/agentos template <name> edit` | 编辑流程模板 | ❌ | ✅ |

---

## 后台定期任务（V4 新增）

| 周期 | 任务 | 触发方式 |
|------|------|---------|
| 每 1-8 小时 | cron_tick: 扫描活跃流程（频率自适应） | OpenClaw cron |
| 每次 agent_end | 当前步骤状态更新 + Action Verification | agent_end hook |
| 每次 session_end | 流程状态快照 + 模板优化提案 | session_end hook |
| 每天 | 流程效率统计 + 角色互动统计 | OpenClaw cron |
| 每周 | ProcessTemplate 审计: 模板是否需要基于实际数据优化 | OpenClaw cron |
| 每周 | Role 互动质量评估: 哪些协作关系在恶化 | OpenClaw cron |

---

## 兄弟文件

- [What is AgentOS V4?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 角色扩展
- [Why AgentOS V4?](why.md) — 为什么需要过程模型
- [How does it work?](how.md) — 四个新子系统详解
- [Where does it sit?](where.md) — 架构定位
- [Architecture Design](design.md) — V4 架构设计文档
