# Who is AgentOS V2 for?

## 角色全景（V2 更新）

V2 引入 OpenClaw 后，角色多了一层：

1. **最终用户** — 通过 OpenClaw 通道（Telegram、Discord 等）与 AI 交互的人
2. **OpenClaw 运维者** — 部署 OpenClaw Gateway + AgentOS Plugin 的人
3. **工具开发者** — 面向 OpenClaw Plugin SDK / MCP 开发工具的人
4. **AI 本身** — 那个在成长的实体

---

## 一、最终用户（End User）

通过 OpenClaw 的任意通道与 AI 交互。他们不直接接触 AgentOS——AgentOS 在背后让 AI 越来越好用。

### 导师（Mentor）

这是核心用户画像。把 AI 当作一个刚毕业的大学生来培养。

**导师做的事**（通过 Telegram/Discord/...）：
- 分配任务："帮我做本周的进度报告 PPT"
- 教导知识："注意，我们的 PPT 风格是图表优先、文字精简"
- 给予反馈："这次字体太小了，下次正文至少 24pt"
- 审核成长："让我看看你现在 PPT 能力到哪个水平了" → AgentOS 通过 `/agentos status` 返回能力报告
- 调整自主性："发邮件这件事你先继续让我确认，下个月再看"

**导师得到什么**：
- 一个随着时间推移越来越省心的协作者
- 可追踪的能力成长（不只是"感觉它变好了"，而是有数据）
- 不需要切换工具——一切在已有的聊天通道中完成

### 协作者（Collaborator）

AI 已在某些领域达到 proficient/expert 水平。

**协作者做的事**：
- 直接分配复杂任务，不需要详细指示
- 只在关键决策点参与确认（AgentOS 的 autonomy engine 自动判断哪些操作需要确认）
- 把 AI 当作"团队里的一个熟手"

---

## 二、OpenClaw 运维者（Operator）

这是 V2 的新角色。部署和维护 OpenClaw Gateway + AgentOS Plugin 的人。

**运维者做的事**：
- 部署 OpenClaw Gateway（`openclaw onboard`）
- 安装 AgentOS Plugin（`openclaw plugins install agentos`）
- 配置 AgentMemory 连接（MCP endpoint + credentials）
- 在 `openclaw.json` 中设置 `plugins.slots.memory = "agentos"`
- 监控 AgentMemory 的存储健康状态
- 定期审查能力模型的演化提案

**运维者需要的能力**：
- 基本的 Docker / Node.js 部署经验
- 理解 MCP 协议的连接配置
- 理解 AgentMemory 的数据生命周期（governance + retention）

---

## 三、工具开发者（Tool Developer）

这是变化最大的角色。V1 中工具开发者直接面向 AgentOS 的工具注册 API。V2 中工具开发者面向的是 OpenClaw / MCP 生态。

**工具开发者做的事**：
- 为咖啡机写 MCP Server（与 V1 相同，因为 MCP 是通用协议）
- 或者：写 OpenClaw Plugin（如果工具需要深度集成到 OpenClaw runtime）
- 为工具定义 AgentOS 元数据（可选）：

```yaml
# tool-meta.yaml（放在 MCP Server 或 Plugin 的 manifest 中）
agentos:
  feedback:
    success_signals: ["brew_complete", "user_affirms"]
    failure_signals: ["error", "out_of_beans"]
    quality_indicators:
      - signal: "user_complains_bitter"
        interpretation: "研磨太细或水温太高"
  risk:
    physical_consequences: ["waste_beans", "water_spill"]
    max_autonomy: "semi_autonomous"
```

**工具开发者得到什么**：
- 他们的工具不只是"被调用"——是"被学会"的
- 工具不需要任何修改就能接入 AgentOS 的学习闭环（AgentOS 需要反馈解释器，但可以从默认模板开始）
- 如果提供了 `agentos` 元数据 → 学习速度更快，自主性判断更准确
- 如果没有提供 → AgentOS 从零开始学习（慢但不阻塞）

**关键变化**：工具开发者的目标平台从 "AgentOS Tool Registry" 变为 "MCP Server" 或 "OpenClaw Plugin"。AgentOS 不再拥有工具的所有权——它只是观察者和加速器。

---

## 四、AI 的"自我"：AgentOS 在培养谁？

**不变的核心命题**：

> **AgentOS 培养的不是一个预设的"AI 人格"，而是一个从行动中涌现的"专业身份"。**

V2 中这个"自我"的定义不变：

```yaml
who_am_i:
  my_tools:
    - coffee_machine:     proficient (0.72) — 87 次使用，自主冲泡
    - ppt_generator:      competent (0.55)  — 12 次使用，需确认设计方案
    - code_editor:        proficient (0.85) — 230 次使用，完全自主
    - email_sender:       novice (0.30)     — 5 次使用，每封都需确认
  my_growth: [...]
  my_mistakes: [...]
  my_relationship: [...]
```

**V2 的新增维度**：

因为 AgentOS 在 OpenClaw 内部运行，AI 的"身体边界"由 OpenClaw 的工具生态定义：
- AI 可以通过 OpenClaw 的 20+ 通道与用户交互
- AI 可以操作 OpenClaw 支持的所有 MCP 工具
- AI 的"我能做什么" = OpenClaw 已安装的工具集 + AgentOS 追踪的熟练度

---

## 五、多实例：统一身份还是隔离？

V1 的两种模式在 V2 中通过 OpenClaw 的 agent scope + AgentMemory 的 mesh sync 实现：

```
OpenClaw Gateway
  ├─ Agent "work"   → AgentOS scope="work"   → AgentMemory project scope
  ├─ Agent "home"   → AgentOS scope="home"   → AgentMemory project scope
  └─ Agent "coding" → AgentOS scope="coding" → AgentMemory project scope
```

**模式 A（统一身份）**：所有 agent 共享同一个 AgentMemory slot，使用不同的 scope tag
**模式 B（完全隔离）**：每个 agent 使用独立的 AgentMemory 数据库

**V2 默认**：模式 A（统一身份 + 项目级技能组合）

---

## 总结

| 问题 | V2 答案 |
|------|---------|
| **谁在用？** | 最终用户（通过 OpenClaw 通道）、运维者（部署集成）、工具开发者（面向 MCP/Plugin SDK） |
| **AgentOS 在培养谁？** | 从行动中涌现的专业身份——通过 OpenClaw 的工具执行被证明 |
| **工具开发者的变化？** | 面向 MCP/OpenClaw Plugin SDK，AgentOS 是可选的加速元数据 |
| **一个还是多个自我？** | 默认统一身份 + OpenClaw agent scope + AgentMemory mesh sync |

---

## 兄弟文件

- [What is AgentOS V2?](what-is.md) — 它是什么
- [Why AgentOS V2?](why.md) — 为什么是这个组合
- [How does it work?](how.md) — AgentOS Plugin 架构详解
- [When does it operate?](when.md) — Hook 触发点和生命周期
- [Where does it sit?](where.md) — 架构定位与系统关系
- [Architecture Design](design.md) — V2 集成架构设计文档
