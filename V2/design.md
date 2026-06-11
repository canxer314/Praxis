# AgentOS V2 Architecture Design

> 版本：v2 (OpenClaw + AgentMemory Integration)
> 状态：设计阶段
> 基于分析：PI vs Hermes vs OpenClaw 对比分析 (2026-06-11)

---

## 一、架构总览

### V2 集成架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                              │
│                                                                      │
│  Channels: Telegram · Discord · Slack · WhatsApp · Signal · CLI ... │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    OpenClaw Agent Runtime                       │  │
│  │                                                                  │  │
│  │  Agent Loop:                                                     │  │
│  │  User Input → LLM → Tool Calls → Results → Response             │  │
│  │       │                    │              │            │         │  │
│  │       ▼                    ▼              ▼            ▼         │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │               AgentOS Memory Plugin                        │  │  │
│  │  │                                                             │  │  │
│  │  │  ┌─────────────────────────────────────────────────────┐  │  │  │
│  │  │  │ Hook Handlers (5 core hooks)                         │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │ session_start ──────▶ load_context()                 │  │  │  │
│  │  │  │ before_tool_call ──▶ autonomy_check()                │  │  │  │
│  │  │  │ after_tool_call ───▶ capture_feedback()              │  │  │  │
│  │  │  │ agent_end ─────────▶ learning_loop()                 │  │  │  │
│  │  │  │ session_end ───────▶ reflect_and_save()              │  │  │  │
│  │  │  └──────────────────────┬──────────────────────────────┘  │  │  │
│  │  │                         │                                  │  │  │
│  │  │  ┌──────────────────────┴──────────────────────────────┐  │  │  │
│  │  │  │              AgentOS Core Engine                     │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │  L6  AutonomyEngine     • proficiency × risk →       │  │  │  │
│  │  │  │                           autonomy decision          │  │  │  │
│  │  │  │  L5  CompetencyManager  • skill tree + evidence +    │  │  │  │
│  │  │  │                           growth trajectory          │  │  │  │
│  │  │  │  L4  LearningEngine     • execute→evaluate→gap→      │  │  │  │
│  │  │  │                           update→crystallize         │  │  │  │
│  │  │  │  L3  KnowledgeManager   • multimodal ingestion +     │  │  │  │
│  │  │  │                           index + association        │  │  │  │
│  │  │  │  L2  TaskTracker        • task→tool_call→result      │  │  │  │
│  │  │  │                           trace                      │  │  │  │
│  │  │  │  L1  ToolProficiencyMgr • metadata + proficiency +   │  │  │  │
│  │  │  │                           feedback interpreter       │  │  │  │
│  │  │  └──────────────────────┬──────────────────────────────┘  │  │  │
│  │  │                         │                                  │  │  │
│  │  │  ┌──────────────────────┴──────────────────────────────┐  │  │  │
│  │  │  │         AgentMemory MCP Client                       │  │  │  │
│  │  │  │  • memory_slot_* (competency model, tool registry)  │  │  │  │
│  │  │  │  • memory_lesson_save / memory_lesson_recall         │  │  │  │
│  │  │  │  • memory_save (knowledge, mental_state)             │  │  │  │
│  │  │  │  • memory_smart_search (知识检索)                    │  │  │  │
│  │  │  │  • memory_crystallize / memory_patterns              │  │  │  │
│  │  │  │  • memory_reflect / memory_sessions                  │  │  │  │
│  │  │  └─────────────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                                                                  │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │              OpenClaw Tool Execution                       │  │  │
│  │  │                                                            │  │  │
│  │  │  Native Tools:    Browser · Terminal · File System        │  │  │
│  │  │  MCP Client ──────▶ External MCP Servers                  │  │  │
│  │  │  Plugin Tools:    Third-party OpenClaw plugins            │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│  ┌─────────────────────────────────┼──────────────────────────────┐  │
│  │              AgentMemory (via MCP)                               │  │
│  │                                                                  │  │
│  │  • SQLite-backed knowledge graph + vector index                  │  │
│  │  • 4-layer consolidation pipeline                                │  │
│  │  • Version chains (supersedes)                                   │  │
│  │  • Mesh sync for multi-instance                                  │  │
│  │  • Governance (retention + decay)                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│  ┌─────────────────────────────────┼──────────────────────────────┐  │
│  │                    External World                                │  │
│  │                                                                  │  │
│  │  MCP Servers  │  REST APIs  │  MQTT/IoT  │  WebSocket  │  ...  │  │
│  │  (代码工具)    │  (PPT/邮件)  │  (咖啡机)   │  (会议音频)  │      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、核心数据模型（V2 更新）

### 2.1 Tool Proficiency Entry（工具熟练度条目）

```yaml
ToolProficiency:
  tool_id: string                    # OpenClaw tool ID "coffee_machine" 或 MCP tool ID
  tool_name: string                  # "咖啡机"
  source: "openclaw_native" | "mcp_server" | "openclaw_plugin"
  
  proficiency: float                 # 0.0-1.0
  level: SkillLevel                  # novice | advanced_beginner | competent | proficient | expert
  evidence:                          # 证据驱动
    - task_id: string
      session_id: string
      performance: float
      timestamp: datetime
  
  feedback_interpreter:
    success_signals: string[]
    failure_signals: string[]
    quality_indicators:
      - signal: string
        interpretation: string
    # 如果工具提供了 agentos 元数据，从这里加载
    # 否则从学习事件中自动提取
  
  risk:
    physical_consequences: string[]
    max_autonomy: AutonomyLevel
    confirm_required_for: string[]
  
  known_failure_modes:
    - pattern: string
      occurrences: int
      last_occurred: datetime
      prevention: string
  
  user_preferences: object           # {strength: "strong", temperature: 85}
  learning_timeline: [...]           # 完整成长时间线
```

### 2.2 Task Trace（任务追踪）

OpenClaw agent 执行任务时，AgentOS 追踪工具调用链：

```yaml
TaskTrace:
  task_id: string                    # 关联 OpenClaw agent session
  started_at: datetime
  completed_at: datetime
  
  tool_calls:
    - tool_id: string
      action: string
      params: object
      timestamp: datetime
      autonomy_decision: string      # "proceed" | "inform" | "confirm"
      result:
        status: "success" | "failure"
        details: string
        matched_signal: string
      learning_triggered: boolean
  
  summary:
    total_tool_calls: int
    success_rate: float
    new_failure_modes_discovered: int
    proficiency_changes: [{skill_id, before, after}]
```

### 2.3 Knowledge、LearningEvent、CompetencyModel（不变）

与 V1 设计完全相同。参见 [V1 design.md](../V1/design.md) 第 2.3-2.5 节。

### 2.4 AutonomyPolicy（V2 更新）

自主性策略现在映射到 OpenClaw 的 before_tool_call 返回值：

```yaml
AutonomyPolicy:
  default_policy:
    unknown_operation: "confirm"
    low_risk_known: "inform"
    high_risk_known: "confirm"
    after_error: "downgrade_one"
  
  # 映射到 OpenClaw autonomy_decision
  decision_mapping:
    proceed:    # OpenClaw 自主执行，不告知用户
    inform:     # OpenClaw 执行，通过通道告知用户（如 Telegram message）
    confirm:    # OpenClaw 暂停 agent loop，等待用户通过通道确认
    block:      # 拒绝执行，向用户解释原因
  
  operation_policies:
    - tool_action: "coffee_machine.brew"
      required_proficiency: 0.6
      autonomy: "proceed"
    - tool_action: "email_sender.send"
      required_proficiency: 0.8
      autonomy: "confirm"           # 始终需要确认
```

---

## 三、核心流程

### 3.1 完整任务执行流程

```
User (via Telegram): "帮我冲杯咖啡"
          │
          ▼
┌─────────────────────────────────────────────┐
│ OpenClaw Agent 接收消息，启动 agent loop      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ [Hook: before_tool_call]                     │
│ AgentOS:                                     │
│ • tool_id = "coffee_machine"                 │
│ • action = "brew"                            │
│ • 查询 proficiency: 0.72 (proficient)        │
│ • 查询 policy: required=0.6, risk="medium"   │
│ • 0.72 >= 0.6 → 自主执行                     │
│ • 注入 user_preferences: {strength, temp}    │
│ • 返回 { decision: "inform",                 │
│          context: "用 85°C 冲深烘焙" }       │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ OpenClaw 执行 coffee_machine.brew()          │
│ 通过 MCP Client 调用 MCP Server              │
│ 结果: { status: "brew_complete" }            │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ [Hook: after_tool_call]                      │
│ AgentOS:                                     │
│ • status = "brew_complete"                   │
│ • 匹配 success_signal: "brew_complete" ✅    │
│ • 无错误 → 无学习事件                        │
│ • 记录: 第 88 次使用，成功                   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ OpenClaw 回复用户: "咖啡冲好了！"            │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ [Hook: agent_end]                            │
│ AgentOS:                                     │
│ • 汇总本 agent 的所有工具调用                 │
│ • 无新的学习事件 → 能力模型不变               │
│ • task_trace 存储到 AgentMemory              │
└─────────────────────────────────────────────┘
```

### 3.2 错误学习流程

```
同样的场景，但 coffee_machine 返回 out_of_water:

┌─────────────────────────────────────────────┐
│ [Hook: after_tool_call]                      │
│ AgentOS:                                     │
│ • status = "out_of_water"                    │
│ • 匹配 failure_signal: "out_of_water" ❌     │
│ • 检查 known_failure_modes:                  │
│   • 是否存在 "冲前未检查水量"?                │
│   • 首次出现 → 创建新 failure_mode          │
│ • 暂存 pending_learning_event:               │
│   { type: "mistake_correction",              │
│     before: "直接调用 brew()",               │
│     after: "先调用 status() 检查水量",       │
│     root_cause: "忽略了前置检查" }           │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ [Hook: agent_end]                            │
│ AgentOS:                                     │
│ • 处理 pending_learning_event                │
│ • proficiency: 0.72 → 0.71 (-0.01)          │
│ • 添加 prevention: "brew() 前先 status()"    │
│ • memory_lesson_save(learning_event)         │
│ • memory_slot_replace("competency_model")    │
└─────────────────────────────────────────────┘
```

### 3.3 重复错误 → anti-pattern

```
第 2 次忘记检查水量:

[Hook: after_tool_call]
  → 匹配 known_failure_mode: "冲前未检查水量"
  → occurrences: 1 → 2
  → 提升为 anti_pattern
  → proficiency penalty 加倍: -0.03

第 3 次及以后:
[Hook: before_tool_call]
  → 查询 known_failure_modes
  → 发现 anti_pattern "冲前未检查水量" (occurrences >= 2)
  → 主动注入提醒: "⚠️ 上次你忘了检查水量——先调用 status()"
  → 降级 autonomy: "confirm"（即使熟练度够）
```

---

## 四、OpenClaw Plugin 接口

### 4.1 Plugin Manifest

```json
{
  "name": "agentos",
  "version": "0.1.0",
  "kind": "memory",
  "description": "AgentOS learning loop and competency model as an OpenClaw memory plugin",
  "entry": {
    "api": "./api.js",
    "runtime": "./runtime.js"
  },
  "slots": {
    "memory": true
  },
  "requires": {
    "mcp": ["agentmemory"]
  }
}
```

### 4.2 Plugin Runtime API

```typescript
// AgentOS Plugin 暴露给 OpenClaw 的 runtime interface
interface AgentOSPlugin {
  // Memory plugin 标准接口（OpenClaw 要求在 memory slot 中的插件实现）
  getMemorySearchManager(params: {
    agentId: string;
    purpose?: "default" | "status" | "cli";
  }): Promise<MemorySearchManager>;
  
  resolveMemoryBackendConfig(params: {
    agentId: string;
  }): MemoryBackendConfig | null;
  
  // Hook 注册（通过 OpenClaw Plugin SDK）
  registerHooks(): PluginHookRegistration[];
  
  // Slash Commands（通过 OpenClaw 的 command 系统暴露给用户）
  getCommands(): PluginCommand[];
}
```

### 4.3 Hook 注册

```typescript
function registerHooks(): PluginHookRegistration[] {
  return [
    {
      hook: "session_start",
      handler: onSessionStart,
      priority: "high",  // 需要在其他插件之前加载上下文
    },
    {
      hook: "before_tool_call",
      handler: onBeforeToolCall,
      priority: "normal",
    },
    {
      hook: "after_tool_call",
      handler: onAfterToolCall,
      priority: "normal",
    },
    {
      hook: "agent_end",
      handler: onAgentEnd,
      priority: "normal",
    },
    {
      hook: "session_end",
      handler: onSessionEnd,
      priority: "low",  // 在其他插件清理之后
    },
  ];
}
```

### 4.4 User Commands（暴露给 OpenClaw）

| 命令 | 功能 | 实现 |
|------|------|------|
| `/agentos status` | 查看能力模型和成长轨迹 | 从 AgentMemory slot 读取，格式化展示 |
| `/agentos tools` | 查看已注册工具及其熟练度 | 从 in-memory competency model 读取 |
| `/agentos teach <topic>` | 主动教导知识 | 触发 KnowledgeManager.ingest() → AgentMemory |
| `/agentos review` | 审核待处理的演化提案 | 列出未审批的 SelfModelUpdateProposal |
| `/agentos history [tool]` | 查看学习历史时间线 | 检索 LearningEvent + Lesson |

---

## 五、AgentMemory 集成映射

| AgentOS 数据 | AgentMemory 工具 | 存储方式 | 频率 |
|-------------|-----------------|---------|------|
| CompetencyModel (active) | `memory_slot_get/set "competency_model"` | Slot (project scope) | session_start 读, agent_end 写 |
| CompetencyModel (history) | `memory_save type="competency_model_version"` | Memory + supersedes | 能力模型变更时 |
| Tool Registry (active) | `memory_slot_get/set "tool_registry"` | Slot (project scope) | session_start 读, 新工具发现时写 |
| AutonomyPolicy | `memory_slot_get/set "autonomy_policy"` | Slot (project scope) | session_start 读 |
| Knowledge entries | `memory_save type="knowledge"` | Memory (typed) | 教导/学习时 |
| Knowledge retrieval | `memory_smart_search` | Triple-stream search | before_tool_call 按需 |
| Learning events | `memory_lesson_save` | Lesson | agent_end 批量 |
| Task traces | `memory_crystallize` → Crystal → Lessons | Crystal + Lesson | agent_end |
| Behavior patterns | `memory_patterns` (behavioral type) | Pattern | session_end |
| Session state | `memory_sessions` + `memory_checkpoint` | Session + Checkpoint | session_start/end |
| Mental state | `memory_save type="mental_state"` | Memory | session_end |
| Reflections | `memory_reflect` → insights | Insight | session_end |
| Audit trail | `memory_audit` | Audit | 自动 |

---

## 六、会话内缓存策略

为避免 "repeated request-time discovery"（OpenClaw AGENTS.md 明确反对的模式）：

```
┌─────────────────────────────────────────────────┐
│           Session-Long In-Memory Cache            │
│                                                   │
│  session_start:                                   │
│    competencyModel   ← memory_slot_get()          │
│    autonomyPolicy    ← memory_slot_get()          │
│    toolRegistry      ← memory_slot_get()          │
│    mentalState       ← memory_smart_search()      │
│                                                   │
│  session 期间:                                    │
│    所有查询命中 in-memory cache                   │
│    knowledge search 例外: 按需调用 MCP            │
│    pending_learning_events: 存储在 plugin 内存    │
│                                                   │
│  agent_end:                                       │
│    批量写入 learning events → AgentMemory         │
│    更新 competency model → AgentMemory            │
│    更新 in-memory cache                           │
│                                                   │
│  session_end:                                     │
│    最终 flush + 反思 + mental_state               │
└─────────────────────────────────────────────────┘
```

---

## 七、V2 范围边界

### V2: 包含

| 组件 | 优先级 | 说明 |
|------|--------|------|
| AgentOS Memory Plugin (OpenClaw) | P0 | 核心：plugin manifest + runtime + hooks |
| AgentMemory MCP 集成 | P0 | 核心：slot 读写、lesson 存储、知识检索 |
| before/after_tool_call hooks | P0 | 核心：自主性检查 + 反馈收集 |
| agent_end learning loop | P0 | 核心：学习事件生成 + 能力模型更新 |
| CompetencyModel (slot-based) | P0 | 与 V1 相同的数据模型 |
| session_start context injection | P1 | 会话开始时的能力上下文加载 |
| `/agentos status` command | P1 | 用户可见的能力查看 |
| session_end reflection | P2 | 会话结束反思 + mental_state |
| 反馈解释器（自动模式检测） | P2 | 无需工具元数据，自动从失败中学习 |
| 工具元数据发现 | P2 | 从 OpenClaw plugin manifest / MCP metadata 读取 agentos 元数据 |

### V2: 明确排除

| 组件 | 说明 | 目标版本 |
|------|------|---------|
| 自建 agent runtime | 已由 OpenClaw 提供 | 不需要 |
| 自建消息通道 | 已由 OpenClaw 提供 | 不需要 |
| 自建工具执行引擎 | 已由 OpenClaw 提供 | 不需要 |
| 音频/视频实时转写 | 需要外部基础设施 | V3 |
| 跨工具复杂工作流引擎 | V2 聚焦单工具 proficiency | V3 |
| 多实例 mesh sync | 依赖 AgentMemory mesh 成熟度 | V3 |
| 自我驱动学习请求 | 需要成熟的缺口检测 | V3 |
| GUI 能力模型查看器 | V2 使用命令行 | V4 |

### 与 V1 的关键差异

| V1 自建 | V2 使用 OpenClaw |
|---------|-----------------|
| Tool Registry（自建数据模型） | Tool Registry（OpenClaw 工具列表 + AgentOS 元数据） |
| Claude Code Harness Hooks | OpenClaw Plugin Hook System |
| Claude Code Slash Commands | OpenClaw Plugin Commands |
| Claude Code System Prompt 注入 | OpenClaw Plugin session_start hook |
| Claude Code 对话通道 | OpenClaw 20+ 消息通道 |

---

## 八、兄弟文件

- [What is AgentOS V2?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？
- [Why AgentOS V2?](why.md) — 为什么是这个组合
- [How does it work?](how.md) — AgentOS Plugin 架构详解
- [When does it operate?](when.md) — Hook 触发点和生命周期
- [Where does it sit?](where.md) — 架构定位与系统关系
