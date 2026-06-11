# How does AgentOS V4 work?

## 总览：V3 六层 + V4 四个新子系统

V4 保留了 V3 的全部六层架构，在三个层中嵌入四个新子系统，新增一个 Hook。

```
┌──────────────────────────────────────────────────────────────┐
│                   OpenClaw Agent Loop                         │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              AgentOS Memory Plugin (V4)                  │  │
│  │                                                          │  │
│  │  V3 保留 (六层)              V4 新增 (四个子系统)        │  │
│  │                                                          │  │
│  │  L6 自主决策               ┌─ 推动自主性决策             │  │
│  │    工具自主 + 提问自主     │  wait/nudge/escalate/...   │  │
│  │                           │                             │  │
│  │  L5 六维能力模型           │  + 过程管理能力             │  │
│  │    工具+领域+任务+用户    │  + 行动可靠性              │  │
│  │                           │                             │  │
│  │  L4 学习闭环              ┌─ Momentum Engine            │  │
│  │    + Curiosity Engine     ├─ Action Verification Loop   │  │
│  │                           │                             │  │
│  │  L3 知识管理              ┌─ Role Model                 │  │
│  │    五类知识               │  (多角色注册表+互动历史)    │  │
│  │                          │                             │  │
│  │  L2 任务编排              ┌─ Process Engine             │  │
│  │    TaskTrace              │  (模板+实例+步骤+状态)      │  │
│  │                          │                             │  │
│  │  L1 工具熟练度 (不变)     │  (无变化)                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## V4 子系统一：Process Engine（过程引擎）

### 定位

嵌入在 L2（任务编排层），是 V4 最核心的新增子系统。它将 V3 的工具链任务模型升级为**过程网络模型**。

### 核心概念

```
┌─────────────────────────────────────────────────────────┐
│                  Process Engine                           │
│                                                           │
│  ProcessTemplate (流程模板)                                │
│  └─ "软件开发流程应该怎么走"                               │
│     定义: 有哪些步骤 / 先后依赖 / 谁承担 / 出入口条件     │
│                                                           │
│  ProcessInstance (流程实例)                                │
│  └─ "用户管理模块的开发现在走到哪了"                       │
│     状态: 当前步骤 / 各步骤状态 / 阻塞原因 / 历史轨迹     │
│                                                           │
│  ProcessStep (流程步骤)                                    │
│  └─ "架构设计这个步骤的具体情况"                           │
│     承担者 / 入口条件 / 出口条件 / 超时阈值 / 状态        │
│                                                           │
│  状态流转:                                                 │
│  pending → ready → in_progress → completed                 │
│                    ↓                                       │
│                 blocked → waiting → nudge → escalated      │
└─────────────────────────────────────────────────────────┘
```

### 步骤类型

V4 区分三种步骤类型，每种有不同的处理逻辑：

```yaml
# 类型 A: AgentOS 自己做的步骤
- step: "数据采集"
  type: "self"
  tools: ["data_fetcher", "chart_generator"]
  entry_condition: "任务已分配"
  exit_condition: "数据采集完成 + 图表生成"
  timeout: "30min"                    # 执行超时

# 类型 B: 找人做的步骤
- step: "PRD 确认"
  type: "delegated"
  assignee: "pm_zhang"                # RoleModel 中的角色
  entry_condition: "PRD 初稿已生成"
  exit_condition: "PM 确认 PRD 文档"
  wait_policy:
    reasonable_wait: "3 天"           # 开始担心前等多久
    nudge_threshold: "5 天"           # 催办前等多久
    escalation_threshold: "10 天"      # 升级给用户前等多久
  nudge_strategy:
    max_nudges: 2                     # 最多催几次
    nudge_interval: "3 天"            # 两次催办间隔
    escalation_after_nudges: true     # 催了没用 → 升级

# 类型 C: 混合步骤
- step: "客户验收"
  type: "collaborative"
  participants: ["user", "client_chen"]
  agentos_role: "facilitator"         # AgentOS 是组织者
  entry_condition: "测试通过 + 演示材料准备完毕"
  exit_condition: "客户签字验收或提出修改意见"
```

### 流程模板进化

ProcessTemplate 不是写死的——AgentOS 从实际执行中学习并优化模板：

```
初始模板（运维者预置）:
  需求 → 设计 → 开发 → 测试 → 验收

第 5 次执行后（AgentOS 从 ActionVerification 中学到）:
  需求 → 设计 → 开发经理排期 → 开发 → 测试 → PM 预验收 → 客户正式验收
          ↑                        ↑
      "架构师反馈总是慢"          "测试发现的 bug 太多，
       增加了'架构设计初稿'      加了'开发自测'作为开发
       和'正式评审'两个子步骤     步骤的出口条件"
```

---

## V4 子系统二：Role Model（角色模型）

### 定位

嵌入在 L3（知识管理层）。V3 的 UserModel 只建模用户。V4 的 RoleRegistry 建模所有协作者。

### 角色数据结构

```yaml
Role:
  role_id: string                    # "pm_zhang"
  type: "collaborator"
  name: "张三"
  title: "产品经理"
  projects: ["膜力云智慧水务"]

  # 沟通画像
  communication:
    channels: ["飞书"]               # 可用渠道
    preference: "direct_async"       # direct_async | formal_async | quick_sync | ...
    style:                           # 沟通风格适配
      greeting: "casual"             # casual | formal
      brevity: "high"                # 偏好简短
      needs_context: false           # 不需要每次都提供上下文
      sensitive_to_tone: false       # 不介意直接催促

  # 响应模式
  response_profile:
    avg_response_time: "1.5 天"      # 平均回复时间
    peak_windows: ["周二下午", "周四下午"]
    dead_zones: ["周一上午", "周五下午"]
    silence_threshold: "5 天"        # 超过这个时间没回 = 异常

  # 推动策略（从互动中学习）
  nudge_profile:
    tolerance: "medium"              # 对催办的容忍度
    effective_nudge_timing: "上午"   # 什么时间催最有效
    effective_nudge_tone: "casual"   # 什么语气最有效
    max_nudges_before_annoyed: 3    # 催几次会烦
    escalation_response: "positive"  # 被升级后的反应: positive | neutral | negative

  # 当前状态
  current_status:
    load: "high"
    availability: "limited"
    last_interaction: "2026-06-08"
    open_requests: ["用户管理模块 PRD 确认"]
    mood_indicators: null            # "最近压力大" / "刚休假回来" / null

  # 互动历史
  interaction_history:
    total_requests: 15
    response_rate: 0.87
    avg_satisfaction: 0.8
    recent_momentum_actions:
      - {type: "nudge", date: "2026-06-06", result: "replied_next_day"}
      - {type: "nudge", date: "2026-05-20", result: "no_response"}
      - {type: "escalation", date: "2026-05-08", result: "resolved_by_user"}
```

### 角色间关系

```
角色关系图（AgentOS 内部维护）:

    用户 (Owner)
      ├── 直接管理 → PM 张三 (膜力云)
      │               └── 间接影响 → 开发经理王五
      ├── 直接管理 → 架构师李四 (膜力云)
      │               └── 技术指导 → 开发经理王五
      └── 直接对接 → 客户陈总
                      └── 最终决策权（验收）

AgentOS 使用这个关系图来:
  • 判断升级路径: PM 卡住了 → 升级给用户（用户是 PM 的上级）
  • 判断影响范围: 架构师没回 → 会不会影响开发经理的排期？
  • 判断替代方案: PM 不在 → 能不能先找用户确认需求？
```

---

## V4 子系统三：Momentum Engine（推动引擎）

### 定位

嵌入在 L4（学习闭环层）。与 Curiosity Engine 对称——Curiosity Engine 管理"知识缺口"，Momentum Engine 管理"流程阻塞"。

### 核心决策流程

```
┌─────────────────────────────────────────────────────────┐
│                Momentum Engine 决策流程                    │
│                                                           │
│  输入:                                                    │
│  • ProcessInstance 当前卡住的步骤                          │
│  • Role.assignee 的沟通画像 + 响应模式                    │
│  • 已等待时间 T                                           │
│  • 历史推动记录（这个角色、这类步骤）                      │
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │ Step 1: 判断是否真的阻塞了                         │   │
│  │                                                    │   │
│  │ T < assignee.avg_response_time?                    │   │
│  │   → 还没到正常回复时间 → do_nothing                │   │
│  │                                                    │   │
│  │ T > avg_response_time 且 T < silence_threshold?    │   │
│  │   → 偏离正常模式，但不算异常 → 标记关注            │   │
│  │                                                    │   │
│  │ T > silence_threshold?                             │   │
│  │   → 确认阻塞 → 进入 Step 2                         │   │
│  └───────────────────────────────────────────────────┘   │
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │ Step 2: 决定推动策略                               │   │
│  │                                                    │   │
│  │ 决策矩阵:                                          │   │
│  │                                                    │   │
│  │ T < nudge_threshold?                               │   │
│  │   → 策略: wait（继续等，但标记关注）               │   │
│  │                                                    │   │
│  │ T > nudge_threshold 且 nudge_count < max_nudges?   │   │
│  │   AND assignee.nudge.tolerance != "none"?          │   │
│  │   → 策略: nudge（催办）                            │   │
│  │                                                    │   │
│  │ T > escalation_threshold OR nudge_count >= max?    │   │
│  │   → 策略: escalate（升级给用户）                   │   │
│  │                                                    │   │
│  │ assignee 明确拒绝?                                  │   │
│  │   → 策略: bypass（找替代方案）                     │   │
│  │                                                    │   │
│  │ 流程目标已过时?                                     │   │
│  │   → 策略: abandon（放弃这个步骤，通知用户）        │   │
│  └───────────────────────────────────────────────────┘   │
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │ Step 3: 生成沟通内容                               │   │
│  │                                                    │   │
│  │ 调用 LLM，注入:                                    │   │
│  │  • 催办/升级的上下文（等了多久、请求是什么）        │   │
│  │  • assignee.communication.style 适配               │   │
│  │  • 历史互动中有效的措辞模式                        │   │
│  │  • 语气降级: 第一次催办 → casual; 第 N 次 → formal │   │
│  │                                                    │   │
│  │ 输出: 适配后的消息草稿                             │   │
│  └───────────────────────────────────────────────────┘   │
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │ Step 4: 发送 + 追踪                                 │   │
│  │                                                    │   │
│  │ • 通过 OpenClaw channel 发送                        │   │
│  │ • 记录 nudge_count += 1                            │   │
│  │ • 设置下一个检查点                                  │   │
│  │ • 如果升级 → 通知用户 + 附上完整等待历史           │   │
│  │ • 如果 bypass → 查找替代角色并发起新请求           │   │
│  └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 推动策略学习

```
每次推动动作之后，Momentum Engine 记录结果:

动量历史条目:
  timestamp: "2026-06-06 10:00"
  action: "nudge"
  target: "pm_zhang"
  step: "PRD 确认"
  wait_duration: "5 天"
  message_sent: "张三，PRD 还没确认～不急，有空看看就行"
  
  result:
    type: "replied"
    response_time: "4 小时"
    outcome: "positive"               # positive | neutral | negative | ignored
  
  learning:
    → update Role.pm_zhang.nudge_profile:
        effective_nudge_timing: "上午" (confirmed)
        effective_nudge_tone: "casual" (confirmed)
        avg_response_time: 1.5 → 1.4 天 (微调)
    
    → update ProcessTemplate:
        这个步骤的 reasonable_wait 可以设短一点（PM 催了就会回）
```

---

## V4 子系统四：Action Verification Loop（行动验证循环）

### 定位

嵌入在 L4（学习闭环层）。V3 验证的是"工具调用对不对"。V4 新增验证"我做的决策对不对"。

### 验证维度

```
┌─────────────────────────────────────────────────────────┐
│            Action Verification Dimensions                 │
│                                                           │
│  1. 步骤决策验证 (Step Decision Verification)             │
│     • "我选择下一步做架构设计 → 对吗？"                   │
│     • 验证信号：                                          │
│       - 用户纠正："不是，你应该先找开发经理排期"          │
│       - 流程卡住："架构师说没需求文档没法设计"            │
│       - 流程顺畅：无纠正 = 默认正确                       │
│                                                           │
│  2. 角色路由验证 (Role Routing Verification)              │
│     • "我找张三聊需求 → 找对人了吗？"                     │
│     • 验证信号：                                          │
│       - 目标角色说："这个你应该找李四"                    │
│       - 用户纠正："张三不负责这个，找王五"                │
│       - 流程完成了 → 路由链整体正确                       │
│                                                           │
│  3. 时机验证 (Timing Verification)                        │
│     • "我等了 3 天才催 → 等太久了还是催早了？"            │
│     • 验证信号：                                          │
│       - 协作者回复迅速 → 催晚了（应该更早催）             │
│       - 协作者说"我刚看到" → 时机合适                     │
│       - 协作者说"催什么催" → 催早了或不该催               │
│                                                           │
│  4. 沟通适配验证 (Communication Adaptation Verification)  │
│     • "我催办的语气 → 合适吗？"                            │
│     • 验证信号：                                          │
│       - 协作者积极回应 → 语气合适                         │
│       - 协作者不回应但后来做了 → 语气可能需要调整         │
│       - 用户说"你太生硬了" → 语气需要调整                 │
│                                                           │
│  5. 流程效率验证 (Process Efficiency Verification)        │
│     • "这次流程总共花了 12 天 → 还能更快吗？"             │
│     • 验证信号：                                          │
│       - 与同模板的历史流程对比                             │
│       - 可并行化的步骤是否被串行了                         │
│       - 用户是否表达了时间不满                             │
└─────────────────────────────────────────────────────────┘
```

### 验证信号来源

| 信号类型 | 来源 | 例子 |
|---------|------|------|
| 显式纠正 | 用户/协作者消息 | "不对，你应该先找XX" |
| 隐式信号 | 行为模式 | 协作者 5 次都没回催办 → 催办对这个角色无效 |
| 结果信号 | 流程产出 | 流程按期完成 → 时机和路由基本正确 |
| 对比信号 | 历史对比 | 这次流程比上次快 30% → 推动策略在改进 |
| 用户反馈 | 用户评价 | "这次推进得不错" / "下次别催这么紧" |

---

## V4 新增 Hook：cron_tick

V3 的 6 个 Hook 全是事件驱动的（用户发消息、工具被调用、会话结束...）。V4 新增一个**时间驱动的 Hook**：

```
cron_tick:  # 利用 OpenClaw 的 cron 能力
  触发: 定期（默认每 4 小时）
  
  动作:
  1. 扫描所有活跃的 ProcessInstance
  2. 检查每个 delegating 步骤的等待时间
  3. 如果 T > 阈值 → 触发 Momentum Engine
  4. 如果 T > 严重阈值 → 标记为需要用户关注
  
  频率策略:
  - 正常: 每 4 小时扫描一次
  - 有接近阈值的步骤: 每 1 小时扫描一次
  - 所有流程正常: 每 8 小时扫描一次（节省资源）
```

---

## V4 完整执行流程示例

### 用户说"把用户管理模块做了"

```
┌─────────────────────────────────────────────────────────┐
│ [message_received]: "把用户管理模块做了"                  │
│                                                           │
│ Process Engine:                                           │
│   → 意图分类: "任务分配"                                  │
│   → 匹配 ProcessTemplate: "软件开发流程"                  │
│   → 创建 ProcessInstance:                                 │
│      template: "软件开发流程"                              │
│      context: {project: "膜力云", module: "用户管理"}     │
│      current_step: "需求分析"                             │
│                                                           │
│   → 回复用户:                                             │
│   "收到。按标准流程推进：                                  │
│    1️⃣ 需求分析 → 找 PM 张三                              │
│    2️⃣ 架构设计 → 找架构师李四                            │
│    3️⃣ 开发排期 → 找开发经理王五                          │
│    4️⃣ 编码实现 → 我来做                                  │
│    5️⃣ 测试验证 → 找测试赵六                              │
│    6️⃣ 验收交付 → PM + 客户                               │
│    现在开始第一步，有任何阻塞会跟你同步。"                 │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Process Engine 自动推进:                                  │
│                                                           │
│ Step 1: 需求分析 (type: delegated, assignee: pm_zhang)    │
│   → 检查入口条件: ✅（任务已分配）                        │
│   → 生成 PRD 草稿（AgentOS 用 LLM + 客户原始需求）        │
│   → Momentum Engine → 生成给 PM 的消息:                   │
│                                                           │
│   "张三，膜力云的用户管理模块初版 PRD 整理好了。           │
│    核心三块：注册登录、权限管理、个人信息维护。           │
│    你看看需求和优先级对不对？方便的话周四下午过一遍？"     │
│                                                           │
│   → 通过飞书发送                                           │
│   → 步骤状态: waiting（等待 PM 回复）                      │
│   → 设置超时监控: 3 天后检查                               │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ [cron_tick: 3 天后]                                      │
│                                                           │
│ Process Engine:                                           │
│   → 扫描活跃流程 → 发现"需求分析"步骤等了 3 天            │
│   → T (3天) = reasonable_wait (3天) → 还没到催办阈值     │
│   → 标记关注，不行动                                      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ [cron_tick: 5 天后]                                      │
│                                                           │
│ Process Engine:                                           │
│   → T (5天) = nudge_threshold (5天) → 触发催办           │
│                                                           │
│ Momentum Engine:                                          │
│   → 决策: nudge（轻度）                                   │
│   → 查 Role.pm_zhang.nudge_profile:                      │
│       tolerance=medium, effective_timing=上午,            │
│       effective_tone=casual                               │
│   → 生成催办消息:                                         │
│                                                           │
│   "张三，用户管理模块的 PRD 还没确认～                     │
│    你忙的话不急，有空看看就行 🙏"                          │
│                                                           │
│   → 发送 + 记录 nudge_count: 1                            │
│   → 设置下次检查: 3 天后                                   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ [3 天后，PM 回复了飞书]                                   │
│                                                           │
│ [message_received] (via 飞书 channel):                    │
│   "PRD 看完了，整体方向对。权限管理那块再加一个角色管理    │
│    功能，另外注册流程能不能简化成手机号一键注册？"        │
│                                                           │
│ AgentOS:                                                  │
│   → 意图: "步骤反馈"（非教导、非纠正）                    │
│   → 关联到 ProcessInstance.step "需求分析"                │
│   → 更新 PRD                                              │
│   → 检查出口条件: PM 的反馈已收到 → 已确认 ✅             │
│   → 步骤状态: completed                                    │
│                                                           │
│   → Action Verification:                                  │
│       step_decision: 正确 ✅                               │
│       role_routing: 正确 ✅ (张三确实是 PM)               │
│       nudge_timing: 正确 ✅ (催办后 3 天回复)              │
│       nudge_tone: 正确 ✅ (正面回应)                      │
│                                                           │
│   → Process Engine 推进到下一步:                           │
│   Step 2: 架构设计 (type: delegated, assignee: architect_li)│
│   ...                                                     │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ [整个过程重复上述模式，直到...]                            │
│                                                           │
│ 开发 → 测试 → 验收 → 用户确认                              │
│                                                           │
│ [agent_end]: 流程闭环                                     │
│                                                           │
│ Action Verification 总结:                                 │
│   • 总体流程耗时: 18 天                                   │
│   • 比同模板平均 (22 天) 快 18%                            │
│   • 阻塞次数: 2 (架构师等太久、测试发现 bug 返工)         │
│   • 推动次数: 3 (催 PM 1 次、催架构师 1 次、升级 1 次)    │
│   • 用户介入: 1 次（架构师升级）                           │
│   • 推动建议:                                              │
│       - 架构师的 reasonable_wait 从 5 天缩短为 3 天        │
│       - 测试步骤前增加"开发自测"出口条件                   │
│                                                           │
│   → 更新 ProcessTemplate "软件开发流程"                    │
│   → 更新 Role.architect_li.nudge_profile                   │
│   → 更新六维能力模型中的 process_capability +0.03          │
└─────────────────────────────────────────────────────────┘
```

---

## V4 与 V3 的 Curiosity Engine 的关系

V3 的 Curiosity Engine 和 V4 的 Momentum Engine 是**对称的双引擎**：

| 维度 | Curiosity Engine (V3) | Momentum Engine (V4) |
|------|----------------------|---------------------|
| **管理对象** | 知识缺口 | 流程阻塞 |
| **触发条件** | 遇到未知概念 / 能力停滞 | 步骤超时 / 角色无响应 |
| **决策输出** | 静默 / 检索 / 提问 / 立即提问 | 等待 / 催办 / 升级 / 绕过 / 放弃 |
| **治理约束** | 频率 × 时机 × 冗余 × 用户状态 | 等待期 × 催办次数 × 角色容忍度 × 升级阈值 |
| **学习反馈** | 用户回答了吗？质量如何？ | 协作者响应了吗？效果如何？ |
| **优化目标** | 填补知识缺口越快越好 | 推动流程不烦人、不拖延 |

它们共享同一个治理原则：**不烦人**。Curiosity Engine 不频繁提问，Momentum Engine 不频繁催办。两者的节奏都由用户可调。

---

## 兄弟文件

- [What is AgentOS V4?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 角色扩展
- [Why AgentOS V4?](why.md) — 为什么需要过程模型
- [When does it operate?](when.md) — 过程生命周期
- [Where does it sit?](where.md) — 架构定位
- [Architecture Design](design.md) — V4 架构设计文档
