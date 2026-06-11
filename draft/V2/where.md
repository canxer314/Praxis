# Where does Praxis V2 sit?

## 架构定位（V2）

Praxis V2 位于 **OpenClaw 的内部**（作为 memory plugin）和 **AgentMemory 的前端**（作为 MCP client）。它不是一个独立运行的进程——它是 OpenClaw runtime 的一部分，在 plugin slot 中运行。

```
┌────────────────────────────────────────────────────────────┐
│              用户 (User)                                     │
│    Telegram · Discord · WhatsApp · Slack · Signal · CLI    │
└────────────────────────┬───────────────────────────────────┘
                         │
┌────────────────────────┴───────────────────────────────────┐
│                  OpenClaw Gateway                            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                OpenClaw Agent Loop                     │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────┐     │  │
│  │  │         Praxis Plugin (Memory Slot)         │     │  │
│  │  │                                              │     │  │
│  │  │  L6  自主决策引擎 (AutonomyEngine)            │     │  │
│  │  │  L5  能力模型管理器 (CompetencyManager)       │     │  │
│  │  │  L4  学习闭环引擎 (LearningEngine)            │     │  │
│  │  │  L3  知识管理器 (KnowledgeManager)            │     │  │
│  │  │  L2  任务编排器 (TaskOrchestrator)            │     │  │
│  │  │  L1  工具熟练度管理器 (ToolProficiencyMgr)    │     │  │
│  │  │                                              │     │  │
│  │  │  Hook Handlers:                              │     │  │
│  │  │  • session_start  → load context             │     │  │
│  │  │  • before_tool_call → autonomy check          │     │  │
│  │  │  • after_tool_call  → feedback capture        │     │  │
│  │  │  • agent_end       → learning loop            │     │  │
│  │  │  • session_end     → reflect + save           │     │  │
│  │  └──────────────────┬──────────────────────────┘     │  │
│  │                     │                                 │  │
│  │  OpenClaw Tools:    │  (executed by OpenClaw)        │  │
│  │  • Browser          │                                 │  │
│  │  • Terminal         │                                 │  │
│  │  • File System      │                                 │  │
│  │  • MCP Client ──────┼──────▶ External MCP Servers     │  │
│  └─────────────────────┼────────────────────────────────┘  │
│                        │                                    │
└────────────────────────┼────────────────────────────────────┘
                         │
                         │ MCP Protocol
                         ▼
┌────────────────────────────────────────────────────────────┐
│                  AgentMemory (Storage Backend)               │
│                                                             │
│  • memory_slot_*        → 能力模型、工具注册表 (当前状态)  │
│  • memory_save          → 知识条目、演化历史、学习事件     │
│  • memory_lesson_save   → 教训存储                          │
│  • memory_smart_search  → 知识检索、经验召回               │
│  • memory_crystallize   → 任务完成→经验压缩                │
│  • memory_patterns      → 行为模式检测                     │
│  • memory_reflect       → 跨图谱反思                       │
│  • memory_sessions      → 会话管理                         │
│  • memory_mesh_sync     → 多实例同步                       │
│  • memory_governance_*  → 数据生命周期                     │
└────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│                  外部世界 (The World)                        │
│                                                             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐ ┌───────────┐  │
│  │咖啡机│ │ PPT  │ │ 邮件 │ │ 会议音频  │ │ 任意 MCP  │  │
│  │MQTT  │ │ API  │ │ API  │ │ WebSocket│ │ Server    │  │
│  └──────┘ └──────┘ └──────┘ └──────────┘ └───────────┘  │
└────────────────────────────────────────────────────────────┘
```

## V1 → V2 架构定位变化

| 维度 | V1 | V2 |
|------|----|----|
| Praxis 位置 | LLM 和世界之间（独立 Harness）| OpenClaw 内部（Memory Plugin） |
| 工具执行 | Praxis 直接编排 | OpenClaw 原生执行，Praxis 观察 |
| Hook 来源 | Claude Code Harness Hooks | OpenClaw Plugin Hook System |
| 用户交互 | Claude Code 对话 | OpenClaw 任意通道（Telegram 等） |
| 存储后端 | AgentMemory (MCP) | AgentMemory (MCP) — 不变 |
| 工具注册 | Praxis Tool Registry | OpenClaw 工具生态 + Praxis 元数据层 |

## Praxis 与各系统的关系

### AgentMemory（存储后端）

**关系类型**：组合（Praxis Plugin 通过 MCP 调用 AgentMemory）

与 V1 的关系不变。Praxis 通过 OpenClaw 的 MCP 客户端能力连接到 AgentMemory MCP Server。所有存储操作（slot 读写、lesson 存储、知识检索）通过 MCP 协议。

### OpenClaw（运行宿主）

**关系类型**：宿主-插件（Praxis 是 OpenClaw 的 memory plugin）

这是 V2 最大的架构变化。Praxis 不控制 OpenClaw——OpenClaw 控制 agent loop，Praxis 在钩子点响应事件。这类似于一个浏览器扩展：扩展不能改变浏览器的渲染引擎，但可以在页面加载、用户点击等事件中插入自己的逻辑。

### MCP Servers（工具提供者）

**关系类型**：间接（OpenClaw 连接 MCP → Praxis 观察工具使用）

在 V1 中 Praxis 直接管理和调用 MCP 工具。在 V2 中 Praxis 不直接调用工具——它观察 OpenClaw 的工具调用，追踪熟练度，在适当的时候影响自主性决策。

### Hermer / PI（互补系统）

**关系类型**：互补，非集成

- **PI**：作为 OpenClaw 的一个 coding tool（不是 Praxis 的组成部分）
- **Hermes**：作为 Praxis 的**替代方案参考**（Hermes 内置学习闭环 vs Praxis 独立学习闭环）

## 多实例部署（V2 更新）

通过 OpenClaw 的多 agent + AgentMemory 的 mesh sync：

```
OpenClaw Gateway
  ├─ agent "work"
  │   └─ Praxis Plugin (scope="work")
  │       └─ AgentMemory project="work"
  │
  ├─ agent "home"
  │   └─ Praxis Plugin (scope="home")
  │       └─ AgentMemory project="home"
  │
  └─ agent "coding"
      └─ Praxis Plugin (scope="coding")
          └─ AgentMemory project="coding"
```

- **single**：一个 OpenClaw agent + 一个 Praxis plugin + 一个 AgentMemory 实例
- **shared**：多个 agent 共享同一个 AgentMemory（通过 mesh sync）
- **isolated_per_project**：每个 agent 独立的能力模型
- **federated**：全局身份 + 项目级能力组合（通过 AgentMemory agent scope）

## 兄弟文件

- [What is Praxis V2?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？
- [Why Praxis V2?](why.md) — 为什么是这个组合
- [How does it work?](how.md) — Praxis Plugin 架构详解
- [When does it operate?](when.md) — Hook 触发点和生命周期
- [Architecture Design](design.md) — V2 集成架构设计文档
