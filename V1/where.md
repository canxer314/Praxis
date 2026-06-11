# Where does Praxis sit?

## 架构定位

Praxis 位于 **AI 推理引擎（LLM）和外部世界之间**，是一个 Harness 层的中间件。

```
┌────────────────────────────────────────────┐
│              用户 (User)                    │
└────────────────┬───────────────────────────┘
                 │ 对话、任务分配、反馈
                 ▼
┌────────────────────────────────────────────┐
│         AI 推理引擎 (LLM / Claude)          │
│         • 通用推理能力                      │
│         • 无状态、无记忆                     │
└────────────────┬───────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
    ▼                         ▼
┌──────────────┐    ┌────────────────────────┐
│   Praxis    │◀──▶│    AgentMemory         │
│  (Harness)   │    │    (存储后端)           │
│              │    │                        │
│ • 能力模型   │    │ • 记忆存储/检索         │
│ • 学习闭环   │    │ • 4层固化管道           │
│ • 知识管理   │    │ • 版本链/衰减/治理      │
│ • 自主决策   │    │ • 知识图谱              │
│ • 工具注册   │    │ • 多实例同步            │
└──────┬───────┘    └────────────────────────┘
       │
       │ 通过 MCP / API / 其他协议
       ▼
┌────────────────────────────────────────────┐
│            外部世界 (The World)             │
│                                            │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐ │
│  │咖啡机│ │ PPT  │ │ 邮件 │ │ 会议音频  │ │
│  │MQTT  │ │ API  │ │ API  │ │ WebSocket│ │
│  └──────┘ └──────┘ └──────┘ └──────────┘ │
│                                            │
│  • Hermes / OpenClaw (计算机操作)           │
│  • 任意 MCP Server                         │
│  • IoT 设备                                │
│  • 第三方 API                              │
└────────────────────────────────────────────┘
```

## Praxis 与各系统的关系

### AgentMemory（存储后端）

AgentMemory 是 Praxis 的**持久化存储层**，提供约 75% 的存储需求：

| Praxis 需求 | AgentMemory 工具 |
|-------------|-----------------|
| 工具注册表 / 能力模型（当前状态） | `memory_slot_*` |
| 能力模型（版本历史） | `memory_save` + supersedes 版本链 |
| 知识条目 | `memory_save`（typed）+ knowledge graph |
| 学习事件 | `memory_lesson_save` / `memory_lesson_recall` |
| 任务管理 | Actions + Sketches + Checkpoints |
| 经验压缩 | `memory_crystallize` |
| 行为模式 | `memory_patterns` |
| 反思/抽象 | `memory_reflect` + consolidation pipeline |
| 跨会话连续性 | `memory_sessions` + `memory_context` |
| 多模态索引 | `memory_save`（imageRef）+ `memory_vision_search` |
| 多实例自我 | `memory_mesh_sync` + agent scope |
| 生命周期管理 | governance + retention + decay |

**关系类型**：组合（Praxis 通过 MCP 调用 AgentMemory）

### Hermes / OpenClaw（行动执行）

Hermes 和 OpenClaw 是 AI 代理框架，专注于让 AI 操作计算机或控制设备。

| 维度 | Hermes / OpenClaw | Praxis |
|------|------------------|---------|
| 核心关注 | 让 AI 能"动手" | 让 AI 能"成长" |
| 工具 | 提供操作工具集（屏幕、键盘、鼠标、API） | 管理工具的熟练度和学习 |
| 时间维度 | 单次任务执行 | 跨任务、跨会话的长期积累 |
| 关系 | **互补**——Hermes/OpenClaw 提供"身体"，Praxis 提供"学习" |

### MCP Servers（工具提供者）

MCP（Model Context Protocol）是工具接入的标准协议。在 Praxis 中：
- 每个 MCP Server 暴露的工具在 Praxis 的**工具注册表**中注册
- Praxis 追踪 AI 使用每个 MCP 工具的熟练度
- 工具反馈通过 MCP 返回，Praxis 解释并转化为学习事件

### Claude Code Harness（运行环境）

Praxis 作为 Harness 层运行在 Claude Code 中：
- **Hooks**：会话开始（加载能力模型）→ 任务完成（触发反思）→ 会话结束（保存状态）
- **System Prompt**：注入当前能力模型摘要和行为指引
- **Skills/Commands**：提供用户可见的命令（如查看能力模型、批准演化提案）

## 多实例部署

通过 AgentMemory 的 mesh sync 和 agent scope，Praxis 支持：

- **single**：一个 AI 实例，一个能力模型
- **shared**：多个 AI 实例共享同一个能力模型（如同一项目的多个会话）
- **isolated_per_project**：每个项目有独立的能力模型（不同的工作风格和技能侧重点）
- **federated**：全局身份 + 项目级能力组合（"我是一个专业的协作者，在项目 A 擅长后端，在项目 B 擅长文档"）

## 兄弟文件

- [What is Praxis?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？谁是那个"自己"？
- [Why does it exist?](why.md) — 它为什么存在
- [How does it work?](how.md) — 六层架构详解
- [When does it operate?](when.md) — 生命周期和触发点
- [Architecture Design](design.md) — V1 架构设计文档
