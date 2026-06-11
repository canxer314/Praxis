# How does Praxis V2 work?

## 总览：Praxis Plugin 内部架构

Praxis V2 仍然保持六层架构，但运行在 OpenClaw 的 Memory Plugin 槽位内。每一层通过 OpenClaw Plugin Hooks 与外部交互：

```
┌──────────────────────────────────────────────────────────────┐
│                   OpenClaw Agent Loop                         │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Praxis Memory Plugin                       │  │
│  │                                                          │  │
│  │  Layer 6: 自主决策层 (Autonomy)                          │  │
│  │  • 接收 before_tool_call → 返回 autonomy_decision       │  │
│  │  • proficiency × risk → autonomy level                  │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 5: 能力模型层 (Competency Model)          │    │  │
│  │  │ • 技能树（领域 × 工具 × 熟练度）                │    │  │
│  │  │ • 证据驱动的评估                                │    │  │
│  │  │ • 每个工具/技能的独立成长曲线                    │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 4: 学习闭环层 (Learning Loop)             │    │  │
│  │  │ • 接收 after_tool_call → 提取反馈               │    │  │
│  │  │ • 接收 agent_end → 执行学习闭环                 │    │  │
│  │  │ • 统一的 执行→评估→差距→更新→固化 循环         │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 3: 知识管理层 (Knowledge Management)      │    │  │
│  │  │ • 多模态知识摄入                                │    │  │
│  │  │ • 知识→工具→技能的关联索引                      │    │  │
│  │  │ • 在 before_tool_call 时注入相关知识            │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 2: 任务编排层 (Task Orchestration)        │    │  │
│  │  │ • 任务分解（委托给 OpenClaw agent loop）         │    │  │
│  │  │ • 追踪任务→工具调用→结果的完整链路              │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 1: 工具熟练度层 (Tool Proficiency)        │    │  │
│  │  │ • 工具元数据管理（反馈信号、风险评级）           │    │  │
│  │  │ • 熟练度追踪（从 OpenClaw 工具调用中采集）      │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │                                                          │  │
│  │  Hook Handlers:  ←── OpenClaw Plugin Hook System        │  │
│  │  • onSessionStart / onBeforeToolCall / onAfterToolCall  │  │
│  │  • onAgentEnd / onSessionEnd                            │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                             │                                   │
│  OpenClaw 原生工具执行      │  Praxis 不直接执行工具           │
│  • Browser / Terminal       │  而是通过 Hook 观察和引导         │
│  • MCP Client → MCP Servers │                                   │
└─────────────────────────────┼───────────────────────────────────┘
                              │
                              │ MCP Protocol
                              ▼
┌──────────────────────────────────────────────────────────────┐
│               AgentMemory (Storage Backend)                    │
└──────────────────────────────────────────────────────────────┘
```

---

## Layer 1: 工具熟练度层 —— AI 的"身体感"

在 V2 中，工具不由 Praxis 注册或执行。工具属于 OpenClaw（native tools）或 MCP Servers（external tools）。Praxis 的工具层只做一件事：**管理工具的元数据和熟练度**。

### 工具元数据（可选）

工具开发者可以选择为 OpenClaw Plugin 或 MCP Server 提供 `praxis` 元数据：

```yaml
# 放在 OpenClaw plugin manifest 或 MCP Server metadata 中
praxis:
  tool_id: "coffee_machine"
  type: "physical_control"  # physical_control | document_creation | communication | perception | data_processing
  
  feedback:
    success_signals: ["brew_complete", "user_affirms_taste"]
    failure_signals: ["error", "out_of_beans", "user_complains"]
    quality_indicators:
      - signal: "user_complains_bitter"
        interpretation: "研磨太细或水温太高"
  
  risk:
    physical_consequences: ["waste_beans", "water_spill"]
    max_autonomy: "semi_autonomous"
```

如果没有提供元数据，Praxis 从零开始学习——慢，但不阻塞。

### 工具熟练度追踪（核心不变）

```yaml
tool_proficiency:
  tool_id: "coffee_machine"
  proficiency: 0.65          # 0.0-1.0
  level: "competent"          # novice → advanced_beginner → competent → proficient → expert
  evidence: [task-023, task-024, task-028]
  known_failure_modes:
    - pattern: "忘记检查水量"
      occurrences: 3
      prevention: "调用 brew() 前先调用 status()"
  user_preferences:
    strength: "strong"
    temperature: 85
    volume_ml: 200
  learning_history: [...]
```

### 工具发现

Praxis 不需要手动注册工具。它在 `session_start` 时通过 OpenClaw 的已加载工具列表发现可用的工具，然后从 AgentMemory 的 `tool_registry` slot 中加载已有的熟练度数据。新工具自动以 `novice` 级别开始。

---

## Layer 2: 任务编排层 —— AI 的"行动"

V2 中任务编排的"执行"部分由 OpenClaw agent loop 负责。Praxis 的任务层负责"追踪"和"评估"。

### 任务生命周期

```
用户分配任务（通过 OpenClaw 通道）
  → OpenClaw agent 接收并开始执行
  → Praxis 在 before_tool_call 注入上下文
  → OpenClaw 执行工具
  → Praxis 在 after_tool_call 追踪步骤
  → [循环直到任务完成]
  → OpenClaw agent_end
  → Praxis 在 agent_end 评估整条任务链
  → 提取学习事件，更新能力模型
```

### 与 V1 的区别

| V1 | V2 |
|----|----|
| Praxis 负责任务分解和执行 | OpenClaw 负责分解和执行，Praxis 追踪 |
| TaskOrchestrator 直接调用工具 | TaskOrchestrator 观察 OpenClaw 的工具调用 |
| 需要自建错误恢复逻辑 | 利用 OpenClaw 的错误处理 |

---

## Layer 3: 知识管理层 —— AI 的"记忆"

与 V1 基本一致，但知识检索的触发点变了：

### 知识来源（多模态，不变）

| 模态 | 摄入方式 | 存储 | 检索 |
|------|---------|------|------|
| 文字 | 直接存储 | Markdown → AgentMemory | BM25 + 向量 |
| 语音 | OpenClaw voice memo → 转写 | 带时间戳转写 → AgentMemory | 文本检索 + 时间定位 |
| 图片 | 视觉描述 + OCR | 描述 + 元数据 → AgentMemory | 文本检索 + 视觉特征 |
| 视频 | 关键帧 + 转写 + 描述 | 多段带时间戳内容 → AgentMemory | 文本检索 + 关键帧 |

### V2 的检索触发点

在 `before_tool_call` 中，Praxis 自动检索与该工具/任务相关的知识：

```
before_tool_call(tool="ppt_generator", action="create_presentation")
  → Praxis: memory_smart_search("PPT设计原则 user:canxe", type="knowledge")
  → 找到: "图表优先，文字精简，深色模板"
  → 注入到 OpenClaw 的工具调用上下文中
```

---

## Layer 4: 学习闭环引擎 —— AI 的"成长"

这是 Praxis 的核心，V2 中完全保留。

### 学习闭环

```
执行任务 → 评估结果 → 识别能力差距 → 更新能力模型 → 调整行为 → 应用到下次任务
```

### V2 的具体执行流程

```
┌──────────────────────────────────────────────────────────┐
│              Learning Loop (in Praxis Plugin)            │
│                                                           │
│  1. after_tool_call hook 触发                             │
│     ├─ 收集执行结果                                       │
│     ├─ 匹配成功/失败信号                                  │
│     └─ 暂存为 pending_learning_event (in-memory)          │
│                                                           │
│  2. agent_end hook 触发                                   │
│     ├─ 汇总所有 pending_learning_events                   │
│     ├─ 对每个事件:                                        │
│     │   ├─ 比较实际表现 vs 能力模型预期                   │
│     │   ├─ 识别能力差距                                   │
│     │   ├─ 计算 proficiency delta                         │
│     │   ├─ memory_lesson_save(LearningEvent)               │
│     │   └─ 更新 in-memory competency model                │
│     └─ memory_slot_replace("competency_model", updated)    │
│                                                           │
│  3. session_end hook 触发                                 │
│     ├─ 汇总本会话的所有成长                               │
│     ├─ memory_patterns() → 检测新行为模式                 │
│     └─ memory_save(type="mental_state", ...)              │
└──────────────────────────────────────────────────────────┘
```

### 学习事件 (LearningEvent) 结构（不变）

```yaml
learning_event:
  source_task: "task-023"
  type: "mistake_correction"
  before: "忘记检查水量就开始冲泡"
  after: "冲泡前自动检查 status()"
  root_cause: "对咖啡机状态检查不够重视"
  affected_skills:
    - skill: "coffee-brewing"
      change: "+0.1 proficiency"
  prevention_strategy: "每次 brew() 前先调用 status()"
```

### 反馈解释器（V2 更新）

反馈解释器的输入从 Praxis 自己的工具调用结果变为 OpenClaw 的工具调用结果。但由于两者最终都是调用同一个 MCP Server，返回格式一致，因此反馈解释器逻辑**不变**。

---

## Layer 5: 能力模型层 —— AI 的"自我认知"

### 统一技能结构（不变）

```yaml
skill:
  id: "skill:coffee-brewing"
  domain: "physical_control"
  tool: "coffee_machine"       # ← OpenClaw tool ID
  proficiency: 0.65
  level: "competent"
  evidence: [task-023, task-024, task-028]
  best_practices: ["冲前检查水量和豆量"]
  anti_patterns: ["不要在豆子不足时开始"]
  user_preferences: {strength: "strong", temperature: 85}
  autonomy_level: "semi_autonomous"
  learning_timeline: [...]
```

### V2 的变化：能力模型存储

- **活跃模型**：`memory_slot_get/set("competency_model")` → 在 session_start 加载到内存，agent_end 写回
- **版本历史**：`memory_save(type="competency_model_version")` → supersedes 版本链
- **关联元数据**：技能关联的 `tool` 字段现在引用 OpenClaw 的工具命名空间

---

## Layer 6: 自主决策层 —— AI 的"判断"

### 自主性判断逻辑（不变）

```
当 OpenClaw 准备执行一个工具操作时 before_tool_call：
  1. Praxis 查该 tool_id 的 proficiency
  2. 查该操作类型的风险等级
  3. 决定：
     - 熟练 + 低风险 → "proceed"（自主执行）
     - 熟练 + 高风险 → "inform"（执行但告知用户）
     - 不熟练 + 低风险 → "confirm"（确认后执行）
     - 不熟练 + 高风险 → "confirm"（必须确认）
     - 发生过错误 → 降级一级
```

### V2 的自主性实现

```typescript
// Praxis Plugin 的 before_tool_call handler 内部逻辑
function onBeforeToolCall(event: PluginHookBeforeToolCallEvent) {
  const { toolId, action } = event;
  
  // 1. 从 in-memory competency model 查询
  const skill = competencyCache.getSkill(toolId, action);
  
  // 2. 查自主性策略
  const policy = autonomyPolicyCache.getPolicy(toolId, action);
  
  // 3. 判断
  if (skill.proficiency >= policy.requiredProficiency) {
    if (policy.risk <= "medium") return { decision: "proceed" };
    else return { decision: "inform", context: skill.userPreferences };
  }
  
  if (policy.risk <= "medium") return { decision: "confirm", reason: "熟练度不足" };
  
  return { decision: "confirm", reason: "高风险 + 熟练度不足", alternatives: [...] };
}
```

---

## AgentMemory 通信模式

### 会话内缓存策略

```
session_start:  批量加载（所有高频数据）
    ↓
session 期间:   全内存操作（不调 MCP）
    ↓
agent_end:      批量写入（learning events + competency model）
    ↓
session_end:    最终写入（mental_state + 反思）
```

这个策略与 OpenClaw AGENTS.md 的性能准则一致：**"Do not fix repeated request-time discovery with scattered caches. Move the canonical fact earlier."**

### MCP 调用映射

| Praxis 操作 | AgentMemory MCP 调用 | 频率 |
|-------------|---------------------|------|
| 加载能力模型 | `memory_slot_get("competency_model")` | 每会话 1 次 |
| 加载自主策略 | `memory_slot_get("autonomy_policy")` | 每会话 1 次 |
| 加载工具注册表 | `memory_slot_get("tool_registry")` | 每会话 1 次 |
| 恢复思维状态 | `memory_smart_search("mental_state", 3)` | 每会话 1 次 |
| 知识检索 | `memory_smart_search(query, type="knowledge")` | 按需（触发时） |
| 存储学习事件 | `memory_lesson_save(LearningEvent)` | 每 agent_end 批量 |
| 更新能力模型 | `memory_slot_replace("competency_model", ...)` | 每 agent_end 1 次 |
| 保存思维状态 | `memory_save(type="mental_state", ...)` | 每 session_end 1 次 |
| 行为模式检测 | `memory_patterns()` | 每 session_end 1 次 |

---

## 兄弟文件

- [What is Praxis V2?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？
- [Why Praxis V2?](why.md) — 为什么是这个组合
- [When does it operate?](when.md) — Hook 触发点和生命周期
- [Where does it sit?](where.md) — 架构定位与系统关系
- [Architecture Design](design.md) — V2 集成架构设计文档
