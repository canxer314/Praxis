# How does AgentOS V3 work?

## 总览：六层架构 + Curiosity Engine

AgentOS V3 保持六层架构，但每一层都有扩展。新增的 **Curiosity Engine** 是一个横切关注点——嵌入在 L3（知识管理）和 L4（学习闭环）中，由 L6（自主决策）治理。

```
┌──────────────────────────────────────────────────────────────┐
│                   OpenClaw Agent Loop                         │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              AgentOS Memory Plugin (V3)                  │  │
│  │                                                          │  │
│  │  Layer 6: 自主决策层 (Autonomy)                          │  │
│  │  • 工具自主性判断（不变）                                │  │
│  │  • 提问自主性判断 ← V3 新增                             │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 5: 能力模型层 (Competency Model)          │    │  │
│  │  │ • 工具熟练度（不变）                            │    │  │
│  │  │ • 领域熟悉度 ← V3 新增                         │    │  │
│  │  │ • 任务类型熟练度 ← V3 新增                     │    │  │
│  │  │ • 用户模型置信度 ← V3 新增                     │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 4: 学习闭环层 (Learning Loop)             │    │  │
│  │  │ • 工具反馈学习（不变）                          │    │  │
│  │  │ • 对话语义学习 ← V3 新增                       │    │  │
│  │  │ • 任务级反思 ← V3 新增                         │    │  │
│  │  │ • Curiosity Engine ← V3 新增                   │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 3: 知识管理层 (Knowledge Management)      │    │  │
│  │  │ • 五维知识分类 ← V3 新增                       │    │  │
│  │  │ • 知识缺口追踪 ← V3 新增                       │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 2: 任务编排层 (Task Orchestration)        │    │  │
│  │  │ • 任务追踪（不变）                              │    │  │
│  │  │ • 任务模式识别 ← V3 新增                       │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────┐    │  │
│  │  │ Layer 1: 工具熟练度层 (Tool Proficiency)        │    │  │
│  │  │ • 同 V2（不变）                                │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │                                                          │  │
│  │  Hook Handlers (6 个):                                   │  │
│  │  • session_start / message_received / before_tool_call  │  │
│  │  • after_tool_call / agent_end / session_end            │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Layer 1: 工具熟练度层 —— 与 V2 相同

V3 的工具层与 V2 完全相同。工具由 OpenClaw 注册和执行，AgentOS 管理元数据和熟练度追踪。

**V3 不变的原因**：工具熟练度是四个学习维度中最成熟的一个。V2 的设计已经正确——通过 before/after_tool_call 收集反馈信号，更新 proficiency。不需要改动。

详见 [V2 how.md Layer 1](../V2/how.md)。

---

## Layer 2: 任务编排层 —— V3 新增任务模式识别

V2 的任务层只做追踪（task→tool_call→result）。V3 新增两个能力：

### 2.1 任务模式识别

当同一类任务重复出现时，AgentOS 自动提取结构模式：

```
任务 "周报-膜力云-W1" → 工具链: [data_fetch, chart_gen, ppt_gen, email_send]
任务 "周报-膜力云-W2" → 工具链: [data_fetch, chart_gen, ppt_gen, email_send]
任务 "周报-膜力云-W3" → 工具链: [data_fetch, chart_gen, ppt_gen, email_send, team_msg]
                        ↑
AgentOS: 检测到稳定的工具链模式 → 提取为 TaskPattern
```

### 2.2 任务级反思（在 agent_end 中触发）

不只是反思单个工具调用，而是反思整个任务：

```
agent_end:
  ├─ 工具级反思（V2 原有）: 每个 tool_call 的 success/failure
  └─ 任务级反思（V3 新增）:
      ├─ 这个任务整体上做对了吗？
      ├─ 用户对结果的整体评价是什么？
      ├─ 有哪些步骤是冗余的？缺少的？
      └─ 这个任务和之前的某个任务是否属于同一模式？
```

---

## Layer 3: 知识管理层 —— V3 核心变化

### 3.1 五维知识分类

V2 中知识是扁平的。V3 将知识分为五类，每类有不同的存储策略和检索触发条件：

| 知识类型 | 内容 | 学习来源 | 存储方式 | 检索触发 |
|---------|------|---------|---------|---------|
| **领域知识** (domain_knowledge) | 行业概念、项目信息、干系人、约束条件 | `message_received` 中的用户解释 | `memory_save(type="domain_knowledge")` | 任务涉及该领域时自动检索 |
| **任务模式** (task_pattern) | 任务结构、典型工具链、常见陷阱、成功模式 | `agent_end` 任务级反思 | `memory_save(type="task_pattern")` | 用户下达类似任务时匹配 |
| **用户模型** (user_model) | 沟通偏好、决策模式、优先级信号、反馈风格 | `message_received` 中的隐式模式 + 显式纠正 | `memory_save(type="user_model")` + slot | 每次 before_tool_call 时参考 |
| **流程知识** (procedural_knowledge) | 跨工具工作流、最佳实践序列、前置条件 | `agent_end` 全链路评估 | `memory_save(type="procedural_knowledge")` | 执行相关流程时注入 |
| **工具知识** (tool_knowledge) | 工具使用技巧、反馈解释器、失败模式 | `after_tool_call` | `memory_save(type="tool_knowledge")` + slot | before_tool_call |

### 3.2 知识缺口追踪

```
KnowledgeGap:
  检测来源:
    - 用户在对话中反复提到一个概念，但 AgentOS 知识库中无定义
    - 执行任务时遇到未知术语/系统/干系人
    - 任务结果被用户纠正，且纠正涉及 AgentOS 不理解的业务逻辑
    - Curiosity Engine 定期扫描发现的结构性空白

  生命周期:
    检测 → 标记 → 优先级排序 → [自动检索 | 静默等待 | 主动提问] → 填充 → 关闭
```

### 3.3 知识检索触发点（V3 扩展）

V2 只在 `before_tool_call` 时检索相关知识。V3 扩展为三个检索时机：

```
1. session_start:
   → 加载该 scope 的领域知识摘要
   → 加载活跃的用户模型
   → 加载待处理的知识缺口列表

2. before_tool_call:
   → 检索与工具/任务相关的所有五类知识（V2 原有 + 扩展）

3. message_received（V3 新增）:
   → 用户提到已知概念 → 检索背景知识以理解上下文
   → 用户提到未知概念 → 标记为潜在知识缺口
```

---

## Layer 4: 学习闭环引擎 —— V3 核心变化

这是 V3 变化最大的层。V2 的学习闭环是：

```
after_tool_call → 匹配信号 → agent_end 汇总 → 更新 proficiency
```

V3 的学习闭环扩展为**三条学习路径**：

### 路径 A：工具反馈学习（V2 原有，微调）

```
after_tool_call
  → 匹配 success/failure/quality 信号
  → 暂存 pending_learning_event (type: mistake_correction)
  → agent_end: 批量处理 → 更新 tool_skills
```

### 路径 B：对话语义学习（V3 新增）

```
message_received
  → 分析用户消息的语义意图：
      ├─ "教导模式"检测: "让我解释..."、"注意..."、"实际上..."
      │   → 提取关键概念 → 存入 domain_knowledge
      │   → 生成 LearningEvent { type: "domain_insight" }
      │
      ├─ "纠正模式"检测: "不对..."、"不是这样..."、"重点是..."
      │   → 定位被纠正的知识/行为
      │   → 生成 LearningEvent { type: "preference_discovery" }
      │
      ├─ "偏好表达"检测: "下次直接..."、"我不喜欢..."、"以后..."
      │   → 更新 user_model
      │   → 生成 LearningEvent { type: "preference_discovery" }
      │
      └─ "任务评价"检测: "这次不错"、"这里还可以改进..."
          → 关联到具体任务/步骤
          → 更新对应的 proficiency + task_pattern
```

### 路径 C：任务级反思（V3 新增）

```
agent_end
  → 跳出单个工具调用的视角:
      1. 这个任务的目标是什么？完成了吗？
      2. 用户对整体结果的反馈是什么？
      3. 工具链是否高效？有没有更好的顺序？
      4. 这个任务和之前的任务是否属于同一模式？
         → 是 → 更新/创建 TaskPattern
         → 否 → 标记为新型任务，后续观察
      5. 涉及了哪些领域？我对这些领域的了解程度如何？
         → 标记 domain_familiarity 的变化
         → 发现新的 KnowledgeGap
```

### Curiosity Engine（V3 核心新增）

Curiosity Engine 是嵌入在 L4 中的一个自主循环。它不依赖 Hook 触发——它在 `agent_end` 和 `session_end` 时主动运行。

```
┌──────────────────────────────────────────────────────────┐
│              Curiosity Engine 执行流程                     │
│                                                           │
│  输入:                                                     │
│  • 当前 competency model（四维）                           │
│  • 本会话的 task_traces                                   │
│  • 已有的 knowledge_gaps                                  │
│  • 用户模型（沟通偏好、当前状态）                          │
│                                                           │
│  阶段 1: 缺口检测 (Gap Detection)                         │
│  ├─ 扫描任务中出现的术语 → 交叉检查知识图谱               │
│  ├─ 扫描用户纠正 → 是否有反复出现的模式                   │
│  ├─ 扫描能力模型的各个维度 → 哪些维度长期不增长            │
│  └─ 输出: List<KnowledgeGap> (new + updated)              │
│                                                           │
│  阶段 2: 缺口排序 (Gap Prioritization)                    │
│  ├─ 关联度得分: 与活跃项目的关联程度                       │
│  ├─ 频率得分: 在最近 N 个任务中出现的次数                  │
│  ├─ 影响得分: 填补缺口对任务成功率的潜在提升               │
│  └─ 综合排序 → priority (0.0-1.0)                        │
│                                                           │
│  阶段 3: 学习行动生成 (Action Generation)                  │
│  ├─ priority < 0.3 → 静默标记，等待自然填充               │
│  ├─ priority 0.3-0.6 → 下次相关任务时主动检索外部资源      │
│  ├─ priority 0.6-0.8 → 生成提问草稿，等待合适时机          │
│  └─ priority > 0.8 → 立即请求用户协助（阻塞当前任务）     │
│                                                           │
│  阶段 4: 提问治理 (Question Governance)                    │
│  ├─ 检查频率限制: 今天已经问过几个问题了？                  │
│  ├─ 检查时机: 现在是 quiet_hours 吗？用户忙吗？            │
│  ├─ 检查冗余: 这个问题之前问过吗？在等回答吗？             │
│  ├─ 批量合并: 如果有多个中优先级缺口 → 合并在一条消息中    │
│  └─ 格式化: 生成带上下文的具体问题                         │
└──────────────────────────────────────────────────────────┘
```

---

## Layer 5: 能力模型层 —— V3 核心变化

### V2（一维）→ V3（四维）

```
V2:
  competency_model:
    skills:
      - tool: "coffee_machine"
        proficiency: 0.72

V3:
  competency_model:
    tool_skills:           # 维度一：不变
      - tool: "coffee_machine"
        proficiency: 0.72
        level: "proficient"

    domain_familiarity:     # 维度二：新增
      - domain: "膜力云智慧水务"
        familiarity: 0.45
        key_concepts: ["一期目标", "三个数据源", "迟君平"]
        tasks_involved: 8
        gaps: ["水务行业标准", "二期时间线"]

    task_type_proficiency:  # 维度三：新增
      - task_type: "周报/月报制作"
        proficiency: 0.58
        examples: 5
        typical_tool_chain: [data_fetch, chart_gen, ppt_gen]
        success_patterns: ["先确认数据新鲜度", "先发摘要确认方向"]

    user_model_confidence:  # 维度四：新增
      communication_style: 0.70
      decision_patterns: 0.40
      domain_context: 0.55
      priority_signals:
        - signal: "提到'上级'或'领导'"
          interpretation: "高优先级，需加快响应"
        - signal: "回复'嗯'或'行'"
          interpretation: "满意，但可能没细看"
```

### 成长可视化

四维能力模型支持**雷达图**展示，用户通过 `/agentos status` 查看：

```
        工具熟练度
           /\
          /  \
         /    \
        /  0.70\
       /        \
      /__________\
用户理解          领域熟悉度
  0.55              0.45
      \          /
       \  0.58  /
        \      /
         \    /
          \  /
           \/
       任务熟练度
```

---

## Layer 6: 自主决策层 —— V3 新增提问自主性

V2 的自主决策只判断一件事：**这个工具操作我能不能自己做？**

V3 新增第二判断维度：**这个知识缺口我该不该问用户？**

### 6.1 工具自主性判断（不变）

```
before_tool_call:
  proficiency × risk → "proceed" | "inform" | "confirm" | "block"
```

### 6.2 提问自主性判断（V3 新增）

```
curiosity_decision:
  输入:
    • KnowledgeGap.priority
    • CuriosityConfig.level (用户设定)
    • 当前时机评估（quiet_hours? 用户刚发过消息?）
    • 今日已提问次数
    • 缺口是否阻塞了当前任务

  决策矩阵:
    Level 0 (完全被动):
      → 永远不主动提问

    Level 1 (标记缺口):
      → 检测 + 标记缺口，不提问
      → session_end 时展示给用户："/agentos gaps" 可查看

    Level 2 (择机提问):
      → priority > 0.6 + 时机合适 + 不超频率 → 提问
      → 否则 → 加入待问队列

    Level 3 (自主研究 + 择机提问):
      → 低风险缺口 → 自己搜索/web/browser
      → 中风险缺口 → 在 sandbox 练习
      → 高风险缺口 → 提问
```

---

## 主动学习的四个级别

模仿毕业生从"事事要问"到"独立自主"的成长：

```
Level 0: 完全被动（对应 Novice 阶段）
  • 只在工具出错时学习
  • 不主动提问
  • 适用: 用户刚开始用 AgentOS，建立信任

Level 1: 标记缺口（对应 Advanced Beginner 阶段）
  • 在 session_end 反思时识别知识缺口
  • 缺口存储但不主动提问
  • 用户可通过 /agentos gaps 查看并选择回答
  • 适用: AgentOS 在积累"我不知道什么"的认知

Level 2: 择机提问（对应 Competent 阶段）
  • 高频/高影响缺口 → 在合适时机主动提问
  • 遵守频率限制 + 时机治理 + 批量合并
  • 用户可随时关闭或降级
  • 适用: 用户信任 AgentOS，愿意被"好问题"打断

Level 3: 自主研究（对应 Proficient 阶段）
  • 低风险缺口 → 自己用 browser 搜索、读文档
  • 中风险缺口 → 在 sandbox/测试环境练习
  • 高风险缺口 → 仍然向用户提问
  • 适用: AgentOS 已有足够判断力自主探索
```

### 级别升级条件

```
Level 0 → Level 1: 工具熟练度 ≥ 0.3 且用户未禁用
Level 1 → Level 2: 用户手动升级（/agentos curiosity level 2）
Level 2 → Level 3: 多维度 proficiency ≥ 0.7 且用户手动升级
```

**关键设计原则**：从 Level 1 到 Level 2 的升级必须是**用户手动**的——AgentOS 不能单方面决定开始主动打扰用户。

---

## AgentMemory 通信（V3 更新）

与 V2 相同的会话内缓存策略（session_start 批量加载 → 内存操作 → agent_end 批量写入 → session_end 最终 flush），新增以下 MCP 调用：

| AgentOS 操作 | AgentMemory MCP 调用 | 频率 |
|-------------|---------------------|------|
| 存储领域知识 | `memory_save(type="domain_knowledge")` | 教导/学习时 |
| 存储任务模式 | `memory_save(type="task_pattern")` | agent_end (发现新模式时) |
| 存储用户模型 | `memory_save(type="user_model")` + `memory_slot_replace` | 会话中逐步更新 |
| 存储知识缺口 | `memory_save(type="knowledge_gap")` | agent_end + session_end |
| 检索领域知识 | `memory_smart_search(type="domain_knowledge")` | session_start + 按需 |
| 匹配任务模式 | `memory_smart_search(type="task_pattern")` | 用户下达任务时 |
| 加载用户模型 | `memory_slot_get("user_model")` | session_start |
| 发送提问 | OpenClaw `message_sending` (via channel) | 择机（受治理） |

---

## 兄弟文件

- [What is AgentOS V3?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？
- [Why AgentOS V3?](why.md) — 为什么需要 V3
- [When does it operate?](when.md) — 完整生命周期
- [Where does it sit?](where.md) — 架构定位
- [Architecture Design](design.md) — V3 架构设计文档
