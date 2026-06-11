# Who is Praxis V4 for?

## 角色全景（V4 核心变化：从一个人到一张关系网）

V3 的角色模型中心是**用户**——Praxis 理解用户、向用户学习、在合适时机向用户提问。用户是唯一被建模的人。

V4 承认一个现实：**大多数任务不止一个人**。Praxis 需要理解和协调的不只是用户，而是一整张关系网。

```
V3:                           V4:
    用户                          用户
     │                            │
     ▼                            ├── PM (张三)
  Praxis                         ├── 架构师 (李四)
     │                            ├── 开发经理 (王五)
     ▼                            ├── 测试 (赵六)
   工具                           ├── 客户 (陈总)
                                  └── ...
                                   │
                                   ▼
                                Praxis
                                   │
                                   ▼
                             流程引擎 → 推动 → 协作者们
```

---

## 一、最终用户（End User）— V4 新增的角色感知

用户在 V4 中获得了**两种新能力**：

### 1. 用户可以看到并管理"关系网"

```
/praxis roles
  → 张三 — PM (膜力云项目)
      状态: 忙（膜力云一期 UAT 阶段）
      沟通: 飞书，周二/周四下午
      最近互动: 3 天前（PRD 确认中，等待回复）
      
  → 李四 — 架构师 (膜力云项目)
      状态: 可用
      沟通: 邮件为主，偏好异步
      最近互动: 一周前
      
  → 王五 — 开发经理 (膜力云项目)
      状态: 忙（排期中）
      沟通: 当面聊，不要发长消息
```

### 2. 用户不用再充当"人工路由器"

**V3 的体验**：
> 用户："把用户管理模块做了"
> Praxis：开始写代码
> 用户："等等，你先跟 PM 聊需求"
> Praxis：好的 → 找 PM 聊需求 → 聊完
> 用户："好了，现在去找架构师"
> Praxis：好的 → ...
> （用户必须记得流程，手动指挥每一步）

**V4 的体验**：
> 用户："把用户管理模块做了"
> Praxis："收到。我会按标准流程推进——先找 PM 张三确认 PRD，再找架构师李四沟通方案，然后协调开发经理王五排期，开发完成后找测试赵六验证，最后请 PM 和客户验收。有问题随时跟我同步。"
>
> （Praxis 自己推动流程，卡住时才找用户，不卡就默默推进）

---

## 二、协作者（Collaborator）— V4 全新的角色类型

V4 引入了"协作者"概念：**不是用户、不是 AI，而是流程中需要配合的其他人**。

### 协作者视角的体验

每个协作者通过自己的渠道（飞书、邮件、OpenClaw 通道）与 Praxis 交互：

> **PM 张三** 打开飞书：
> "张三，膜力云的用户管理模块初版 PRD 我整理好了，你看看？核心是三块：注册登录、权限管理、个人信息维护。方便的话周四下午过一遍？"
>
> 张三回复："周四下午可以，发我会议室邀请。"
>
> Praxis：更新 ProcessInstance → 创建会议 → 提醒用户

> **架构师李四** 收到邮件：
> "李四，用户管理模块的 PRD 已确认（附后）。有三个技术选型需要你的意见：认证方案选 JWT 还是 Session？权限模型用 RBAC 够吗？用户数据分表策略怎么定？方便的时候回复即可，不急。"
>
> 李四 3 天后回复 → Praxis 检测到步骤出口条件满足 → 进入下一阶段

### 协作者不需要知道 Praxis 的存在

对协作者来说，他们收到的消息来自"膜力云项目的 AI 助手"——他们不需要理解 Praxis 是什么。他们只需要回复，Praxis 负责：
- 理解回复内容
- 更新流程状态
- 触发下一步
- 在需要时升级给用户

---

## 三、OpenClaw 运维者（Operator）— V4 新增考量

| 考量 | 说明 |
|------|------|
| 多通道配置 | 用户通过 Telegram，PM 通过飞书，架构师通过邮件——OpenClaw 的多通道能力是基础 |
| 角色账号映射 | 配置每个 Role 对应的实际通信地址（飞书 ID、邮箱、Telegram ID...） |
| 推动策略初始化 | 首次部署时的默认策略：保守（长等待期、不主动催办协作者、先告知用户） |
| 隐私与边界 | Praxis 能看到用户与协作者的通信内容吗？权限边界在哪里？ |
| ProcessTemplate 维护 | 谁来定义和维护流程模板？V4 默认：运维者预置通用模板 + Praxis 从实践中学习优化 |

---

## 四、AI 的"自我"：V4 的定义

### V4 新增的"人格"维度：从执行者到推动者

```
V1-V2 的 AI: 一个会学习的工具（你教 → 它学 → 它下次做得更好）
V3 的 AI:     一个有求知欲的新人（它还会主动问"我不懂这个，能教我吗？"）
V4 的 AI:     一个有担当的团队成员（它不只是自己做，还会推动整个流程向前）
```

### V4 的"自我"：六维定义

```yaml
who_am_i_v4:
  # ── V3 原有的四维 ──
  my_tools: {...}                     # 工具熟练度
  my_domains: {...}                   # 领域熟悉度
  my_task_types: {...}                # 任务类型熟练度
  my_user_model: {...}                # 用户模型置信度

  # ── V4 新增的两维 ──

  # 维度五：我多擅长推动流程
  my_process_capability:
    templates_known: 5                # 我已掌握的流程模板
      - "软件开发流程": mastered (0.75)
      - "文件摄入流程": competent (0.55)
      - "周报制作流程": mastered (0.82)
      - "会议组织流程": advanced_beginner (0.35)
      - "合同审核流程": novice (0.20)
    
    momentum_effectiveness:           # 推动效果
      avg_response_time_after_nudge: "1.2 天"
      escalation_accuracy: 0.80      # 升级给用户的时机准确度
      false_alarm_rate: 0.05         # 不必要的升级率
    
    bottleneck_prediction: 0.45      # 预测哪些步骤会卡住（正在学习）

  # 维度六：我的行动有多可靠
  my_action_reliability:
    step_decision_accuracy: 0.72     # "下一步做什么"判断准确率
    role_routing_accuracy: 0.85      # "该找谁"判断准确率
    communication_adaptation: 0.65   # "怎么说"适配准确率
    verification_completeness: 0.50  # 行动事后验证覆盖率

  # ── 认知升级（V4 新增）──
  my_meta_cognition:
    known_unknowns: 12                # 知识缺口（V3 原有）
    process_awareness:                # V4 新增：对正在进行的流程的感知
      active_processes: 3
        - "膜力云-用户管理模块开发" (阶段: 架构设计, 等待: 李四回复, 等了 4 天)
        - "膜力云-周报制作" (阶段: 数据采集)
        - "合同归档-XX供应商" (阶段: 等待用户确认矛盾)
      stalled_processes: 1            # 卡住的流程
        - "膜力云-用户管理模块开发" 卡在"架构设计"步骤
          原因: 等待架构师李四回复（已等 4 天，正常等待期 5 天）
          计划: 如果明天还没回 → 催办
      blocked_processes: 0            # 需要用户介入的流程
```

---

## 五、角色模型 vs 用户模型

V3 有一个 `UserModel`。V4 把它扩展为 `RoleRegistry`——用户只是其中的一个特殊角色。

```yaml
RoleRegistry:
  roles:
    - role_id: "user"
      type: "owner"                    # owner | collaborator | stakeholder
      model: UserModel                 # V3 原有的用户模型
      permissions: ["*"]               # 用户能做任何事
      
    - role_id: "pm_zhang"
      type: "collaborator"
      name: "张三"
      title: "产品经理"
      projects: ["膜力云智慧水务"]
      communication:
        channels: ["飞书"]
        preference: "direct_async"     # 偏好异步，直接沟通
        response_profile:
          avg_response_time: "1.5 天"
          peak_response_windows: ["周二下午", "周四下午"]
          silence_threshold: "5 天"    # 5 天不回 = 异常
        nudge_tolerance: "medium"      # 可以催，但别太频繁
        escalation_sensitivity: "low"  # 升级到用户不介意
      
      current_status:
        load: "high"                   # 膜力云一期压身
        availability: "limited"
        last_interaction: "3 天前"
        open_requests: ["用户管理模块 PRD 确认"]
      
      interaction_history:
        total_requests: 15
        response_rate: 0.87
        avg_satisfaction: 0.8          # 沟通效果
        lessons_learned:
          - "发 PRD 时附上要点摘要，他不看长文"
          - "周四下午联系回复最快"
          - "不要在没有上下文的情况下突然催"

    - role_id: "architect_li"
      type: "collaborator"
      name: "李四"
      title: "架构师"
      # ... 类似的完整画像
```

---

## 六、总结

| 问题 | V3 答案 | V4 答案 |
|------|---------|---------|
| **谁在用？** | 用户、运维者、工具开发者 | 用户、**协作者（多人）**、运维者、工具开发者 |
| **Praxis 在培养谁？** | 一个会学习、会提问的 AI | 一个**能推动流程、协调角色**的 AI |
| **AI 知道谁是谁吗？** | 只知道用户 | 知道**整个角色关系网** |
| **AI 怎么对待不同的人？** | 都当作"用户" | **为每个角色适配沟通策略** |
| **多实例？** | scope 隔离 | scope 隔离 + 跨 scope 的 RoleRegistry 共享 |

---

## 兄弟文件

- [What is Praxis V4?](what-is.md) — 它是什么
- [Why Praxis V4?](why.md) — 为什么需要过程模型
- [How does it work?](how.md) — 四个新子系统详解
- [When does it operate?](when.md) — 过程生命周期
- [Where does it sit?](where.md) — 架构定位
- [Architecture Design](design.md) — V4 架构设计文档
