# Who is AgentOS V3 for?

## 角色全景（V3 更新：角色反转）

V3 最显著的角色变化：**AgentOS 不再是纯粹的被教导者——它也会主动向用户提问。**

这与 V1/V2 形成了根本性的不对称：

```
V1/V2:  用户 ──教导──▶ AgentOS ──执行──▶ 工具
                       （单向）

V3:     用户 ◀──提问── AgentOS ──执行──▶ 工具
           ──教导──▶           （双向）
```

---

## 一、最终用户（End User）

通过 OpenClaw 通道（Telegram、Discord 等）与 AI 交互的人。

### 导师（Mentor）— V3 的变化

仍然是核心用户画像。但 V3 的导师体验有一个关键变化：**AI 会带着具体问题来找你，而不是等你发现它哪里不懂。**

| 场景 | V2 体验 | V3 体验 |
|------|---------|---------|
| AI 遇到不懂的概念 | 默默执行，可能做错 | 标记缺口，如果优先级高→主动提问 |
| 用户三次纠正同一个问题 | AI 记住了这个具体问题 | AI 不仅记住了，还反思了背后的模式 |
| AI 发现知识缺口 | 无感知 | 积累缺口，在合适时机批量请教 |
| 用户查看 AI 状态 | `/agentos status` → 工具熟练度 | `/agentos status` → 四维雷达 + 待确认的知识缺口列表 |

**导师的新体验**：

> 周五下午 3 点，Telegram：
>
> **AgentOS**："这周学到了不少。顺便问一下——有个概念我一直不太确定。你在周报里提到的'数据对接'具体是指系统之间的 API 对接，还是也包括人工报表的整合？我注意到你在不同场合的用法好像不太一样。"
>
> **用户**："好问题。确实不一样。API 对接是说系统自动传数据，人工整合是说从 Excel 导入。两个都在做，但优先级不同……"
>
> **AgentOS**："明白了，我记下了。下次周报我会区分这两个概念。"

### 协作者（Collaborator）— V3 的变化

AI 已在多个维度达到 proficient。V3 的协作者体验：

- AI 不仅能自主执行任务，还会**主动提出改进建议**：
  > "我注意到这周的周报缺少风险分析板块。前三次周报你都要求加上，这次是故意省略的吗？"
- AI 能**跨任务迁移模式**：
  > "膜力云项目的周报结构（数据→图表→风险→下周计划），要不要我套用到城乡数据平台的月报上也试试？"

---

## 二、OpenClaw 运维者（Operator）— V3 新增考量

V3 新增的运维考量：

| 考量 | 说明 |
|------|------|
| Curiosity 频率配置 | `curiosity.max_questions_per_day`：控制 AI 每天最多主动提问几次 |
| 静默时段配置 | `curiosity.quiet_hours`：AI 不会在这些时段主动打扰用户 |
| 提问模式开关 | `curiosity.mode`：`passive` / `mark_gaps_only` / `ask_when_confident` / `fully_active` |
| 审核机制 | 首次主动提问需要用户确认开启此模式；用户随时可以 `/agentos curiosity off` |
| AgentMemory 存储成本 | V3 新增 KnowledgeGap、DomainKnowledge、TaskPattern 等存储类型 |

---

## 三、工具开发者（Tool Developer）— 与 V2 相同

面向 MCP/OpenClaw Plugin SDK 开发工具。可选提供 `agentos` 元数据加速学习。无变化。

---

## 四、AI 的"自我"：V3 的定义

### 不变的核心命题

> AgentOS 培养的不是一个预设的"AI 人格"，而是一个从行动中涌现的"专业身份"。

### V3 的"自我"：四维定义

```yaml
who_am_i_v3:
  # 维度一：我会用什么（V2 原有，不变）
  my_tools:
    - coffee_machine:     proficient (0.72) — 87 次使用
    - ppt_generator:      competent (0.55)  — 12 次使用
    - code_editor:        proficient (0.85) — 230 次使用

  # 维度二：我懂哪些领域（V3 新增）
  my_domains:
    - "膜力云智慧水务":   familiarity 0.45 — 参与过 8 个任务
        已知概念: ["一期目标", "三个数据源", "关键干系人迟君平"]
        知识缺口: ["水务行业的技术标准", "二期规划时间线"]
    - "城乡数据平台":     familiarity 0.60 — 参与过 3 个任务
    - "国企项目管理":     familiarity 0.30 — 参与过 2 个任务

  # 维度三：我擅长什么类型的任务（V3 新增）
  my_task_types:
    - "周报/月报制作":    proficient (0.58) — 5 次，用户满意度 0.8
    - "数据对接分析":     competent (0.40)  — 3 次
    - "干系人沟通":       novice (0.25)     — 2 次

  # 维度四：我有多了解用户（V3 新增）
  my_user_model:
    communication_style:  0.70  # 偏好简洁、图表化、先结论后细节
    decision_patterns:    0.40  # 初步了解：受阻时倾向升级施压
    priority_signals:     0.55  # "上级"/"领导"→高优先级；"看看"→探索性
    current_gaps:               # 我还不确定的
      - "用户对'风险'的容忍度边界在哪里"
      - "用户在周一上午和周五下午的工作节奏差异"

  # 元认知（V3 新增）
  my_meta_cognition:
    known_unknowns: 12            # 已标记的知识缺口数
    unknown_unknowns_estimate: "high"  # 自知还有很多不知道的
    learning_velocity: 0.3/week   # 能力模型每周增长
    curiosity_level: 2            # 主动学习级别 (0-3)
```

### V3 新增的"人格"维度：从被动到主动

V2 的 AI 像一个**好用的工具**——你教它，它学会，下次做得更好。

V3 的 AI 像一个**有心气的新人**——它不仅学会你教的，还会：
- 自己发现自己哪里不懂
- 在你不忙的时候带着具体问题来请教
- 把学到的东西和你已有的偏好关联起来
- 慢慢形成对你工作领域的整体理解

---

## 五、多实例：统一身份 + 四维能力组合

与 V2 相同的部署模式，但每个 AgentOS 实例的能力模型现在包含四个维度：

```
OpenClaw Gateway
  ├─ Agent "work"
  │   └─ AgentOS Plugin (scope="work")
  │       ├─ tool_skills: {ppt: 0.6, email: 0.5, ...}
  │       ├─ domains: {"膜力云": 0.45, "城乡数据": 0.60}
  │       ├─ task_types: {"周报": 0.58, "沟通": 0.35}
  │       └─ user_model: {communication: 0.70, ...}
  │
  ├─ Agent "home"
  │   └─ AgentOS Plugin (scope="home")
  │       ├─ tool_skills: {coffee_machine: 0.72, ...}
  │       ├─ domains: {"家庭日程": 0.50}
  │       └─ ...
  │
  └─ Agent "coding"
      └─ AgentOS Plugin (scope="coding")
          ├─ tool_skills: {code_editor: 0.85, git: 0.70, ...}
          ├─ domains: {"AgentOS架构": 0.80, "TypeScript": 0.60}
          └─ ...
```

**V3 默认**：统一身份 + scope 隔离 + 四维能力组合（与 V2 的部署一致，但能力维度扩展）

---

## 兄弟文件

- [What is AgentOS V3?](what-is.md) — 它是什么
- [Why AgentOS V3?](why.md) — 为什么需要 V3
- [How does it work?](how.md) — 六层架构 + Curiosity Engine
- [When does it operate?](when.md) — 完整生命周期
- [Where does it sit?](where.md) — 架构定位
- [Architecture Design](design.md) — V3 架构设计文档
