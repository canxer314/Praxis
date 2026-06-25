# Praxis 架构设计

> Praxis 是一个 AI 认知操作系统——在无状态的 LLM 与外部世界之间的中间件层。  
> 它赋予 LLM 跨会话的记忆、学习和主动任务编排能力。  
> 它的本质是 **Context Orchestration Layer**（上下文编排层）：在正确的时间，以正确的格式，将正确的结构化记忆注入 LLM 的上下文窗口。

---

## 一、Praxis 是什么

### 一句话定义

Praxis 是 AI 的"大脑皮层"。它记住每次任务中学到的东西，在下次任务前把相关经验注入 LLM 的上下文窗口，让 AI 不再每次都从零开始。它学到的不仅仅是"怎么用工具"，还包括"任务怎么做"、"领域里有什么"、"用户在想什么"、"自己还缺什么"——并且会主动发现知识缺口、主动推进任务、主动检测自身的框架缺陷。

### 架构定位

```
┌────────────────────────────────────────────┐
│              用户 (User)                    │
└────────────────┬───────────────────────────┘
                 │ 对话、任务分配、反馈
                 ▼
┌────────────────────────────────────────────┐
│         AI 推理引擎 (LLM)                   │
│         • 通用推理 • 无状态 • 无记忆        │
└────────────────┬───────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
    ▼                         ▼
┌──────────────┐    ┌────────────────────────┐
│   Praxis     │◀──▶│    AgentMemory         │
│  (中间件)    │    │    (持久存储后端)       │
│              │    │                        │
│ • 能力模型   │    │ • Slot 状态管理         │
│ • 学习闭环   │    │ • 记忆存储/检索/版本链  │
│ • 任务编排   │    │ • 知识图谱/模式检测     │
│ • 自主决策   │    │ • 多实例同步            │
│ • 主动驱动   │    │                        │
└──────┬───────┘    └────────────────────────┘
       │
       │ MCP / REST / WebSocket
       ▼
┌────────────────────────────────────────────┐
│            外部世界                         │
│  • OpenClaw / Claude Code (Agent 运行时)    │
│  • MCP Servers (工具集成)                  │
│  • IoT 设备 / API / 数据库                 │
└────────────────────────────────────────────┘
```

### 三层运行时拓扑

Praxis 寄生于 OpenClaw Agent 框架，形成三层关系:

```
AgentMemory (大脑皮层, 持久存储)
    ↕ MCP 协议
Praxis (心智模型, 学习+决策+编排)
    ↕ Hook 系统
OpenClaw (身体, 工具执行+Agent调度+多通道通信)
```

- **AgentMemory**: Praxis 的持久化后端。所有认知结构、任务状态、学习历史通过 MCP 调用存取。
- **Praxis**: 位于中间的心智层。不执行工具、不调度 Agent、不管理通信——这些由 OpenClaw 负责。Praxis 只做认知: 记忆组织、经验学习、场景匹配、置信度管理、任务编排决策。
- **OpenClaw**: 执行层。提供 Hook 系统（Praxis 通过 Hook 介入 Agent 生命周期）、工具执行（MCP 工具和内置工具）、多通道通信（Telegram/Discord 等）。

---

## 二、六层认知架构

Praxis 内部采用六层架构。每层职责独立，层间通过明确的接口通信。

```
┌──────────────────────────────────────────────────────────────┐
│ L6: 自主决策层 (Autonomy Engine)                              │
│     proficiency × risk → proceed / inform / confirm / block  │
│     工具自主性 + 提问自主性 + 驱动自主性                        │
├──────────────────────────────────────────────────────────────┤
│ L5: 能力模型层 (Competency Manager)                           │
│     8D 能力评估: 工具、领域、任务、用户、过程管理、             │
│     行动可靠性、原型认知、学习速度                              │
├──────────────────────────────────────────────────────────────┤
│ L4: 学习闭环层 (Learning Engine)                              │
│     执行 → 评估 → 差距 → 更新 → 固化                          │
│     + Curiosity Engine (主动检测知识缺口)                      │
│     + Momentum Engine (主动推动过程阻塞)                       │
│     + MidSessionLearner (会话中实时修正)                       │
├──────────────────────────────────────────────────────────────┤
│ L3: 知识管理层 (Knowledge Manager)                            │
│     5 类知识: 领域/任务/用户/流程/工具                         │
│     + 知识缺口追踪 + 跨场景语义消歧                            │
│     + Role Model (多角色关系图)                                │
├──────────────────────────────────────────────────────────────┤
│ L2: 任务编排层 (Task Orchestrator)                            │
│     两层嵌套状态机 (任务级 7 状态 + 子任务级 4 状态)           │
│     + plan-generator (ProtoTask → 计划文档)                   │
│     + verifier (5 种验收标准)                                  │
│     + pitfall-tracker (陷阱追踪与反馈学习)                     │
├──────────────────────────────────────────────────────────────┤
│ L1: 工具与集成层 (Tool Registry)                              │
│     工具注册/发现 + 熟练度追踪 + 反馈解释器                    │
│     (工具由 OpenClaw/MCP 提供，Praxis 叠加认知元数据)          │
└──────────────────────────────────────────────────────────────┘

横切关注点:
  Meta Layer (L5.5): 监控所有层的结构性缺陷——框架本身是否有盲区
  Context Orchestration: 所有认知操作的最终落地方式——
    在正确时间以正确格式将正确信息注入 LLM prompt
```

---

## 三、认知结构系统: ProtoStructure

### 核心概念

ProtoStructure 是 Praxis 的**认知基本单元**——从对话和工具调用中提取的概率化、可演化的结构模式。它们是 Praxis "学到的东西"的物质载体。

ProtoStructure 和传统知识图谱的关键区别: 知识图谱由人类专家手动定义，是静态的确定性结构；ProtoStructure 由 LLM 从观察中自动提取，是概率性的（带置信度）、随时间演化的（版本链）、可衰退的（被推翻后可回退）。

### 五种认知结构类型

| 类型 | 捕捉什么 | 示例 |
|------|---------|------|
| **ProtoSequence** | 行为序列模式——"先做什么后做什么" | 门诊流程: 挂号→分诊→问诊→检查→开药 |
| **ProtoRole** | 角色关系——"谁负责什么、和谁交互" | 门诊医生: 诊断决策者, 依赖挂号员+检验科 |
| **ProtoConcept** | 概念定义——"X 是什么、和其他概念的关系" | "分诊": 根据病情紧急程度分配就诊优先级 |
| **ProtoPurpose** | 目标意图——"为什么做这件事" | 挂号的目的: 建立医患法律关系, 确定就诊优先级 |
| **ProtoConstraint** | 约束公理——"什么绝对不能做/必须做" | 处方开具必须在诊断完成之后 |

### 双重性质: 结构面 + 功能面

每个 ProtoStructure 同时记录两个不可互相还原的维度:

```
ProtoSequence "门诊流程":
  ┌─ 结构面 (可观察的行为)
  │  步骤 1: 挂号 (挂号员, 3-5分钟)
  │  步骤 2: 分诊 (分诊护士, 2-3分钟)
  │  步骤 3: 候诊 (患者, 5-30分钟)
  │  步骤 4: 问诊 (门诊医生, 10-15分钟)
  │
  ┌─ 功能面 (为什么每一步存在)
  │  挂号目的: 建立医患法律关系, 确定就诊优先级
  │  分诊目的: 按病情紧急程度分配资源
  │  候诊目的: 缓冲医生资源的不均匀需求
  │  问诊目的: 采集病史+体格检查→初步诊断
  │
  └─ 结构→功能映射 (teleological mapping)
     步骤 1 → 服务于"建立法律关系" (essential)
     步骤 1 → 服务于"确定优先级" (supporting)
     
当用户说"我们取消了挂号窗口, 全部在线预检分诊":
  → Praxis 检查功能面: "建立法律关系"和"确定优先级"两个目的
    是否仍然被满足?
  → 是 → 结构改变但功能不变 → 只更新 teleological_mapping
    否 → 结构改变且功能失败 → 置信度下调
```

### 关系图: 结构之间的依赖

ProtoStructure 不是孤立的。它们之间通过显式的关系边连接:

| 关系类型 | 语义 | 置信度传播规则 |
|---------|------|--------------|
| `depends_on` | A 的正确性依赖 B | B 置信度下降 Δ → A 下降 Δ × 依赖强度 |
| `contradicts` | A 和 B 不能同时为真 | A 上升 Δ → B 下降 Δ × 矛盾强度 |
| `specializes` | A 是 B 的子类型 | B 变化 → A 同向变化 × 特化因子 |
| `precedes` | A 必须在 B 之前发生 | B 在 A 之前出现 → 两个结构都降级 |
| `constrains` | A 对 B 施加约束 | B 违反约束 → B 降级 |
| `alternative_to` | A 和 B 是同一功能的不同实现 | B 置信度上升 → A 可降级（功能覆盖） |

传播深度限制: ≤ 3 跳，防止远距离弱依赖造成噪声震荡。所有传播规则为确定性逻辑，不调 LLM。

### 生命周期与版本链

每个 ProtoStructure 在以下状态间流转:

```
hypothesized → candidate → experimental → crystallized → deprecated/rejected
                                          ↑__________________↓
                                          (衰退可逆转)
```

**结晶化条件（四重门控）**:
1. 置信度 > 0.8
2. 观察次数 ≥ 5
3. 反事实检验: 移除该结构后，LLM 的预测准确率是否显著下降？（是 → 通过）
4. 人类审批（V5 铁律: 无新结构不经过人类审批）

**版本链**: 每次修改（用户纠正/自动优化/结晶化/衰退/融合）产生一个新版本，记录 diff、rationale、evidence、performance。支持回滚到任意历史版本。支持从多个版本融合。

### 退役与亚存在

被取代的结构不会被删除。它们进入"亚存在"状态——当前不活跃，但保留了到新结构的映射和关键教训。当旧场景重现或新结构衰退时，可重新激活。

---

## 四、学习引擎

### 学习闭环

```
┌──────────────────────────────────────────────────────┐
│                  Learning Loop                        │
│                                                       │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐     │
│  │ 执行任务  │──▶│ 评估结果  │──▶│ 识别能力差距  │     │
│  │ (L2)     │   │          │   │              │     │
│  └──────────┘   └────┬─────┘   └──────┬───────┘     │
│       ▲               │               │              │
│       │          ┌────▼─────┐   ┌─────▼────────┐    │
│       │          │ 用户反馈  │   │ 更新能力模型  │    │
│       │          │ (稀缺)    │   │ (L5)         │    │
│       │          └──────────┘   └──────┬────────┘    │
│       │                                │              │
│       │          ┌──────────┐   ┌─────▼────────┐    │
│       └──────────┤ 应用到   │◀──┤ 更新行为指引  │    │
│                  │ 下次任务  │   │ (注入上下文)  │    │
│                  └──────────┘   └──────────────┘    │
└──────────────────────────────────────────────────────┘
```

**三条学习路径**:
- **路径 A — 工具反馈**: before_tool_call/after_tool_call → 匹配成功/失败信号 → 更新工具熟练度
- **路径 B — 对话语义**: message_received → 语义意图分析（教导模式/纠正模式/偏好表达/任务评价）→ 提取知识/更新用户模型
- **路径 C — 任务级反思**: agent_end → 跳出单工具视角 → 评估整体任务成败 → 提取任务模式 → 更新 ProtoTask

### Governor: 学习决策编排器

Governor 是学习管道的统一入口。4 阶段:

```
信号进入 → classify (分类: correction/insight/preference/pattern) 
        → gate (门控: 去噪/去重/频次限制) 
        → decide (裁决: 是否学习/学什么/调整幅度) 
        → dispatch (分发: 更新能力模型/存储知识/生成 ProtoTask)
```

降级策略: Governor 自身抛错 → 信号旁路到原始执行反馈收集器（不丢失学习信号）。

### 多源置信度融合

每个 ProtoStructure 的置信度由 7 个独立信号源加权融合:

| 信号源 | 权重 | 独立性 | 说明 |
|--------|------|--------|------|
| statistical | 0.25 | 独立于 LLM | 工具序列实际匹配 vs ProtoSequence 预测 |
| llm_marker | 0.25 | 来自 LLM | [PREDICTION_CONFIRMED/FAILED/UNCERTAIN] 标记 |
| user_correction | 0.12 | 独立于 LLM | 用户显式纠正 |
| role_verifier | 0.12 | 独立 | ProtoRole 行为 vs 实际工具调用者模式 |
| concept_verifier | 0.08 | 独立 | 对抗 prompt 寻找反例 |
| outcome_feedback | 0.10 | 独立 | 子任务成败→使用的结构表现 |
| mid_session | 0.08 | 独立 | 会话中实时矛盾检测 |

融合后的单一置信度决定该结构的注入策略（Tier A/B/C/不注入）。

### Curiosity Engine: 主动知识缺口检测

不依赖 Hook 触发——在 agent_end 和 session_end 主动运行:

```
阶段 1 — 缺口检测: 扫描任务中的未知术语/被反复纠正的模式/长期不增长的技能
阶段 2 — 缺口排序: relevance × frequency × impact × urgency → priority 0.0-1.0
阶段 3 — 行动生成: 
  priority < 0.3 → 静默标记等待自然填充
  priority 0.3-0.6 → 下次相关任务时检索外部资源
  priority 0.6-0.8 → 生成提问草稿等待合适时机
  priority > 0.8 → 立即请求用户协助
阶段 4 — 提问治理: 频率限制 + 静默时段 + 批量合并 + 冗余检查
```

### MidSessionLearner: 会话中实时学习

不等到 session_end——在 message_received 和 before_tool_call 中同步运行（< 10ms，纯规则匹配，不调 LLM）:
- 用户说"不对，应该是 X" → 即时下调关联 ProtoStructure 置信度
- 工具调用模式违反 ProtoConstraint 3+ 次 → 即时下调该结构置信度
- 单会话下调总量上限: 0.2（防止过度修正）

---

## 五、任务编排引擎

### 两层嵌套状态机

```
外层循环 (任务级, 7 状态):
TASK_NOT_STARTED → TASK_ASSESSING → TASK_PLAN_GENERATING → TASK_IN_PROGRESS
    → TASK_VERIFYING → TASK_COMPLETE
    ↕ (verification_failed 时)
    TASK_ITERATING → TASK_IN_PROGRESS

内层循环 (子任务级, 4 状态 + 1 中间态):
SUBTASK_PENDING → SUBTASK_ACTIVE → SUBTASK_COMPLETING → SUBTASK_VERIFIED
                                                      → SUBTASK_FAILED
中间态: SUBTASK_BLOCKED (用户纠正或工具违反 3+ 次时触发)
```

**驱动方式**: 每个到达 Praxis 的 Hook 事件（session_start, message_received, before_tool_call, after_tool_call, agent_end, session_end）推进状态机一步。V13 的主动驱动层在此基础上增加了自动触发: TaskScheduler 在 session_end 时决定是否自主发起下一个动作。

### 计划生成: ProtoTask → PlanDocument

Praxis 从历史同类任务中学习任务模式（ProtoTask），用于指导新任务的计划:

```
bootstrap (0 个项目, 置信度 0.2):
  LLM 通用知识 → 基本的阶段划分 + 常见陷阱

累积成长:
  1 个项目 → 0.3 (开始与现实校准)
  3 个项目 → 0.5 (团队模式开始浮现)
  5 个项目 → 0.65 (阶段时长和陷阱开始可靠)
  10+ 个项目 → 0.8-0.95 (高度可靠)
```

plan-generator 将 ProtoTask 模板 + 当前 TaskContext 转化为可执行的 PlanDocument（含 phases, subtasks, criteria, guidance signals）。

### 验收: 5 种验证标准

| 类型 | 自动化程度 | 示例 |
|------|----------|------|
| `command_output` | 自动 | `npm test -- --testPathPattern=X` → 匹配输出 |
| `file_existence` | 自动 | 检查文件是否已生成 |
| `test_pass` | 自动 | 运行测试套件 |
| `llm` | 半自动 | LLM 审查代码/文档质量 |
| `user_approval` | 手动 | 部署/安全/财务类操作必须人类确认 |

命令白名单: `npm test`, `cargo test`, `go test`, `pytest`（防止任意命令执行）。

### 陷阱追踪

子任务失败 → 关键词匹配 ProtoTask.common_pitfalls → 命中反馈（ProtoTask 置信度 +0.02）→ 误报率控制（> 30% 自动降 severity）。陷阱知识随项目积累成长——第 1 次遇到是意外，第 3 次就是已知陷阱。

---

## 六、主动驱动系统

### TaskScheduler: 主动调度决策

在 session_end 时触发决策矩阵:

```
评估: 自主驱动是否启用？是否在静默时段？今日触发次数是否超限？
  ↓
决策:
  subagent_run        → 存在可并行子任务 → spawn 子 Agent
  scheduleSessionTurn  → 存在需本 Agent 继续的任务 → 调度下个会话 (< 1h 相对时间)
  scheduleSessionTurn  → 存在需等待外部反馈的任务 → 调度下个会话 (1-24h 绝对时间)
  cron_job            → 存在需定期检查的任务 → 注册定期任务 (> 24h)
```

### SubagentManager: 并行子 Agent 生命周期

```
spawnSubagent()         构建上下文(子任务+陷阱预警+验收标准, 不含父对话历史)
  → waitForCompletion()  等待完成 + 超时检测
  → retrySubagent()      失败重试 (max_retries 次)
  → aggregateResults()   汇总所有子 Agent 结果
```

约束: 最大并行度 3（可配置）。失败隔离: 一个子 Agent 失败不影响其他子 Agent。

### HeartbeatMonitor: 心跳停顿检测

每 5 分钟检查所有活跃任务的子任务状态:

```
Level 1 — NUDGE:   有活跃 session → 注入提醒到 LLM 上下文
Level 2 — WAKE:    无活跃 session → 主动请求唤醒
Level 3 — ESCALATE: 停顿 > 24h → 标记 SUBTASK_BLOCKED + 推进外循环到 TASK_ITERATING
```

### 自主学习触发

定期 cron 任务:
- 分析 task_history → 达到 min_observations → 自动构造/更新 ProtoTask
- 置信度 plateau 检测（连续 3 次观察无提升）→ 请求更多同类任务
- 能力模型定期审计 → 识别停滞技能 → 生成学习建议

### 跨 Agent 认知同步

子 Agent session_end → 写入 ProtoStructure 更新（乐观锁 + version 号）→ 父 Agent session_start 读取最新版本。确保子 Agent 学到的经验回流到父 Agent 的认知模型中。

---

## 七、上下文编排系统

### 场景识别

session_start 时，LLM 分析当前对话的初始上下文，将其分类到一个或多个已知场景（scenario_id）。场景是 Praxis 选择注入哪些认知结构的首要维度。

### 四级压力自适应

Praxis 在每次注入前测量上下文利用率，按压力级别调整注入策略:

| 级别 | 利用率 | 注入量 | 策略 |
|------|--------|--------|------|
| **Normal** | < 60% | ~30K tokens | Tier A/B/C 全量: 当前场景全量详情 + 相关场景摘要 + 其他场景索引 |
| **Elevated** | 60-75% | ~16K tokens | Tier A 全量 + Tier B 压缩 + Tier C 移除 |
| **High** | 75-90% | ~3.5K tokens | 仅 Tier A 摘要 |
| **Critical** | > 90% | ~1K tokens | 仅结构索引 + recall_structure 工具注册 (Lazy Loading) |

**关键设计**: 即使在 Critical 下，LLM 仍知道所有结构存在（通过索引 + Lazy Loading）。LLM 需要时可以主动调用 `recall_structure("门诊流程")`。Push（Praxis 主动注入）和 Pull（LLM 按需拉取）混合，区别于 V7 的纯选择性注入（"不注入就是不让你知道"）。

### Tier A/B/C 分层组织

全量结构按优先级分为三层注入:

```
Tier A: 当前场景 + TaskContext.relevant_scenarios 的结构
  → 全量详情 + 置信度校准 + 约束标记

Tier B: 与当前任务间接相关的结构
  → 摘要 + 引用 ID (LLM 可通过 recall_structure 拉取详情)

Tier C: 不相关场景的结构
  → 名称 + 一行描述

排序权重 = 场景匹配度 × 0.55 + 任务相关性 × 0.35 + 信号推荐 × 0.10
```

### TaskContext: 任务级认知定位

~200 tokens 的极轻量任务感知层。不替代场景识别——场景是横向分类（"门诊流程"属于 healthcare 场景），任务是纵向时间轴（"构建医院系统 Phase 2"是当前任务）。

```
TaskContext:
  task_id: "task_hospital_sys_2026"
  task_name: "构建医院管理系统"
  task_type: "software_project"
  current_phase: "Phase 2: API 开发"
  progress_summary: "数据模型完成, API 60%, 预约挂号进行中"
  active_subtask: "实现预约挂号接口"
  relevant_scenarios: ["hospital_outpatient", "api_design", "rest_patterns"]
```

session_end 时 LLM 自动推断进度变化（置信度 < 0.7 不自动更新，用户可覆盖）。

### 注意力遥测

LLM 在输出中使用 `[STRUCTURE_USED: proto_id]` 标记实际引用了哪个结构。Praxis 追踪每个结构的采纳率。发现"僵尸结构"（置信度 > 0.7 但采纳率 < 20%）→ 降级或提议退化。发现"低估结构"（置信度 < 0.4 但采纳率 > 60%）→ 提议重新评估。

---

## 八、元认知系统: Meta Layer

Meta Layer 是一个不对任务做处理的侧观察者。它不操作 ProtoStructure，它操作的是"ProtoStructure 的框架本身"。

### 核心区分: KnowledgeGap vs StructuralGap

| 类型 | 定义 | 处理引擎 |
|------|------|---------|
| **KnowledgeGap** | "我不知道 X" | Curiosity Engine (L4) |
| **StructuralGap** | "我对这类问题的思考框架本身是错的" | Meta Layer |

### 五种 StructuralGap 检测信号

1. **模板匹配度下降**: ProcessTemplate 适应得分连续降低
2. **跨场景验证低**: 同一操作在不同场景反复出错
3. **用户挫败模式**: 用户反复纠正同一类问题
4. **认知边界停滞**: 某技能熟练度长期不增长
5. **升级模式异常**: escalation 频率或类型偏离预期

### 范畴审计

Meta Layer 定期检查一个根本问题: **现有的 5 种 ProtoStructure 类型是否足够？**

场景中反复出现但无法被现有类型捕获的模式 → 标记为 `category_blind_spot`。积累到阈值 → 提议新范畴类型（如 ProtoQuantity / ProtoRelation），附带证据 → 等待人类审批。

### 三种铁律（不可自动突破）

1. **无新结构不经过人类审批** — Meta Layer 可以提议，不能自动创建
2. **实验必须有范围限制** — 不能无限实验新范畴
3. **任何结构可回滚** — 保留所有历史版本，支持任意版本恢复

---

## 九、数据模型

### 核心实体

```
ProtoStructure (认知基本单元)
  ├─ ProtoSequence  — 行为序列模式 + 功能目的 + 结构→功能映射
  ├─ ProtoRole      — 角色关系 + 行为定义 + 沟通模式
  ├─ ProtoConcept   — 概念定义 + 与其它概念的关系
  ├─ ProtoPurpose   — 目标意图 + 成功标准
  └─ ProtoConstraint — 约束公理 + 严重度(block/confirm/warn) + 来源

relations: [                            # 关系图
  { target_id, type: depends_on|contradicts|specializes|precedes|constrains|alternative_to,
    strength: 0.0-1.0, evidence: [...], established_at, last_validated_at }
]

version_chain: [                        # 版本历史
  { version_id, parent_version, merge_sources, created_at, created_by,
    diff: [{ type, path, old_value, new_value }],
    rationale, evidence, performance: { prediction_accuracy, user_satisfaction, active_days } }
]

lifecycle: hypothesized | candidate | experimental | crystallized | deprecated | rejected
confidence: 0.0-1.0 (由 7 源融合)
observations_count: int
adoption_rate: float (注意力遥测)
```

```
TaskContext (轻量任务感知)
  task_id, task_name, task_type, current_phase,
  progress_summary, active_subtask, relevant_scenarios[]

ProtoTask (任务模式——跨项目的同类任务知识)
  task_type, confidence, source: bootstrap|cumulative,
  typical_phases: [{ name, subtasks, criteria, guidance, relevant_structure_ids }],
  common_pitfalls: [{ description, severity, mitigation, hit_count }],
  observations_count, source_tasks[]

CompetencyModel (8D 能力模型)
  tool_skills, domain_familiarity, task_type_proficiency,
  user_model_confidence, process_management, action_reliability,
  proto_cognition, learning_velocity

LearningEvent (学习事件 — 15 种类型)
  mistake_correction, domain_insight, preference_discovery,
  task_pattern_recognition, procedural_optimization,
  action_decision_*, role_routing_*, timing_*, communication_*, process_efficiency_*,
  structural_inadequacy_detected, structure_constructed, structure_validated,
  structure_regression, governance_override
```

### AgentMemory 存储映射

| Praxis 数据 | AgentMemory 工具 | 存储方式 |
|-------------|-----------------|---------|
| CompetencyModel | `memory_slot_get/set "competency_model"` | Slot (project) |
| AutonomyPolicy | `memory_slot_get/set "autonomy_policy"` | Slot |
| Tool Registry | `memory_slot_get/set "tool_registry"` | Slot |
| TaskContext | `memory_slot_get/set "task_context"` | Slot |
| TaskOrchestrationState | `memory_slot_get/set "task_orchestration_state"` | Slot |
| TaskPlan | `memory_slot_get/set "task_plan"` | Slot |
| ProgressLog | `memory_slot_get/set "progress_log"` | Slot |
| ProtoTask | `memory_slot_get/set "proto_task"` | Slot |
| ProtoStructures | `memory_smart_search` + `memory_save type="proto_structure"` | Memory (typed) |
| Knowledge entries | `memory_save type="knowledge"` | Memory (typed) |
| Learning events | `memory_lesson_save` | Lesson |
| Behavior patterns | `memory_patterns` | Pattern |
| Mental state | `memory_save type="mental_state"` | Memory |
| Multi-modal (image) | `memory_save` + imageRef + `memory_vision_search` | Memory (image) |

### GovernancePolicy 关键配置

```yaml
autonomy:
  default_policy:
    unknown_operation: "confirm"
    low_risk_known: "inform"
    high_risk_known: "confirm"
    after_error: "downgrade_one"

context_pressure:
  normal_threshold_k: 500
  elevated_threshold_k: 200
  high_threshold_k: 100
  critical_threshold_k: 0

task_context:
  auto_update_confidence_threshold: 0.7

mid_session_learner:
  contradiction_threshold: 3
  max_immediate_penalty_per_session: 0.2

proto_task:
  bootstrap_on_task_start: true
  min_observations_for_update: 1

task_orchestration:
  auto_generate_plan: true
  auto_verify_on_session_end: true

verification:
  allowed_check_commands: [npm test, cargo test, go test, pytest]

pitfall_tracking:
  auto_downgrade_misrate: 0.3

task_scheduler:
  max_daily_triggers: 10
  max_parallel_subagents: 3
  quiet_hours_start: "22:00"
  quiet_hours_end: "07:00"

curiosity:
  mode: "ask_when_confident"
  max_questions_per_day: 3
  quiet_hours: "22:00-07:00"

meta_layer:
  structural_gap_scan_interval_hours: 168    # 每周
  category_audit_interval_hours: 720         # 每月
  max_experimental_structures: 3
```

---

## 十、Hook 系统 — Praxis 对 Agent 生命周期的介入点

Praxis 通过 7 个 Hook 介入 OpenClaw 的 Agent 生命周期:

| Hook | 触发时机 | Praxis 操作 |
|------|---------|------------|
| **session_start** | 会话开始 | 加载能力模型+TaskContext+ProtoStructures → 场景识别 → 上下文压力测量 → 注入 system prompt (含约束+认知指导+相关结构) |
| **message_received** | 收到用户消息 | 语义意图分析 → 检测用户纠正 → MidSessionLearner 实时调整 |
| **before_tool_call** | LLM 准备调用工具 | 查询自主性策略 → 检查约束违反 → 决定 proceed/inform/confirm/block |
| **after_tool_call** | 工具调用完成 | 追踪工具使用 → 匹配成功/失败信号 → 暂存学习事件 |
| **agent_end** | Agent 执行单元结束 | 汇总工具调用链 → 统计验证器进行独立验证 → 任务级反思 → 触发 Curiosity Engine |
| **session_end** | 会话结束 | 全量 transcript 分析 → 提取 ProtoStructures → 置信度融合更新 → TaskContext 自动进度推断 → TaskScheduler 决策 → 持久化 |
| **cron_tick** | 定时触发 | 扫描活跃 ProcessInstance → 检查等待超时 → HeartbeatMonitor 停顿检测 → 跨 session 模式挖掘 → 自主学习触发 |

---

## 十一、模块树

```
openclaw/src/plugins/praxis-plugin/
├── index.ts                              # 插件入口, 注册 Hook + Service
├── config.ts                             # GovernancePolicy 配置聚合
│
├── orchestration/                        # 编排层: 决定"什么信息何时进入 LLM"
│   ├── task-orchestrator.ts              # 两层嵌套状态机 + 事件路由
│   ├── plan-generator.ts                 # ProtoTask → PlanDocument
│   ├── verifier.ts                       # 5 种验收标准执行
│   ├── progress-tracker.ts               # 进度事件收集 + 摘要生成
│   ├── pitfall-tracker.ts                # 陷阱匹配 + 命中反馈 + 误报率控制
│   ├── task-scheduler.ts                 # 主动调度决策矩阵
│   ├── subagent-manager.ts               # 子 Agent 生命周期 + 并行控制
│   ├── heartbeat-monitor.ts              # 停顿检测 + 三级介入 (nudge/wake/escalate)
│   ├── context-pressure-monitor.ts       # 四级压力测量
│   ├── scene-recognizer.ts               # 场景识别 + 场景→结构匹配
│   ├── context-organizer.ts              # Tier A/B/C 分层 + 排序 + 压缩
│   ├── task-context.ts                   # TaskContext 读写 + 自动进度推断
│   ├── confidence-fuser.ts               # 7 源加权融合 + 关系图传播
│   └── prediction-protocol.ts            # [PREDICTION_*] 标记解析
│
├── analysis/                             # 分析层: 从原始数据提取认知结构
│   ├── transcript-analyzer.ts            # 端到端: 对话 transcript → ProtoStructures + LearningEvents
│   ├── statistical-verifier.ts           # 独立统计验证: 工具序列匹配
│   ├── proto-task.ts                     # ProtoTask: bootstrap + 累积构造 + 置信度成长
│   ├── mid-session-learner.ts            # 实时矛盾检测 + 即时置信度下调
│   ├── pitfall-tracker.ts                # (同 orchestration/pitfall-tracker, 分析侧逻辑)
│   ├── role-verifier.ts                  # 角色行为 vs 实际工具调用者模式
│   ├── concept-verifier.ts               # 对抗 prompt 寻找反例
│   ├── attention-telemetry.ts            # [STRUCTURE_USED] 采纳率追踪 + 僵尸/低估检测
│   ├── consistency-checker.ts            # 跨结构一致性验证
│   ├── degradation-checker.ts            # 衰退条件检测
│   ├── structure-lifecycle.ts            # 生命周期状态机 + 结晶化/退化门控
│   ├── architecture-auditor.ts           # Meta Layer: 对抗性架构审计
│   ├── category-auditor.ts               # Meta Layer: 范畴盲区检测 + 新范畴提议
│   ├── config-adapter.ts                 # 配置自适应
│   └── semantic-disambiguator.ts         # 跨场景同形异义词消歧
│
├── files/                                # 文件持久化 (兼容 planning-with-files 格式)
│   └── plan-file-writer.ts               # task_plan.md / progress.md / findings.md
│
├── hooks/                                # Hook 事件处理器
│   ├── session-start.ts                  # 上下文加载 + 注入
│   ├── message-received.ts               # 语义分析 + 实时学习
│   ├── before-tool-call.ts               # 自主性 + 约束验证
│   ├── after-tool-call.ts                # 工具追踪
│   ├── agent-end.ts                      # 统计验证 + 任务反思
│   ├── session-end.ts                    # 全量分析 + 调度决策 + 持久化
│   └── cron-tick.ts                      # 定期扫描 + 模式挖掘
│
├── memory/                               # AgentMemory 接口
│   ├── client.ts                         # MCP 客户端
│   ├── local-cache.ts                    # 7 天 TTL 降级缓存
│   ├── recall-structure.ts               # Lazy Loading: LLM 按需拉取结构详情
│   ├── schemas.ts                        # JSON Schema 定义
│   ├── slots.ts                          # Slot 名称 + 大小 + 版本
│   └── queries.ts                        # 复合查询封装
│
├── prompts/                              # Prompt 模板
│   ├── system/                           # 注入到 system prompt
│   │   ├── memory-context.md             # 认知状态概览
│   │   ├── plan-injection.md             # 任务计划 + 认知指导 (GuidanceSignal)
│   │   ├── constraint-injection.md       # CRITICAL CONSTRAINTS 段
│   │   ├── prediction-markers.md         # 预测协议说明
│   │   └── critical-mode.md             # Critical 压力下的极简格式
│   ├── analysis/                         # LLM 分析任务
│   │   ├── extract-and-update.md         # transcript → ProtoStructures + LearningEvents
│   │   ├── construct-proto-task.md       # task_history → ProtoTask
│   │   ├── generate-plan.md              # ProtoTask + TaskContext → PlanDocument
│   │   ├── verify-progress.md            # 自动进度推断
│   │   ├── consistency-scan.md           # 结构一致性检查
│   │   └── audit-architecture.md         # 对抗性架构审计
│   └── user/                             # 面向用户的输出
│       ├── perception-summary.md         # 会话感知摘要
│       └── crystallization-proposal.md   # 结晶化审批提案
│
├── types/                                # TypeScript 类型定义
│   ├── memory.ts                         # ProtoStructure, ProtoTask, LearningEvent, CompetencyModel...
│   ├── scene.ts                          # Scenario, TaskContext, GuidanceSignal...
│   └── hooks.ts                          # Hook 上下文类型
│
└── tests/                                # 测试
    ├── orchestration/                    # 编排层测试
    ├── analysis/                         # 分析层测试
    ├── hooks/                            # Hook 处理器测试
    └── integration/                      # 端到端集成测试
```

---

## 十二、设计原则

1. **Context Orchestration Layer** — Praxis 不能执行代码、不能调用工具、不能读写文件（除 AgentMemory 外）。它唯一的"执行"方式是: 在正确时间、以正确格式、将正确信息注入 LLM 的上下文窗口。

2. **LLM 是不可靠的概率引擎** — 任何依赖 LLM 做唯一判断源的环节最终会崩。Praxis 的验证必须包含独立于 LLM 的信号: 统计验证器（工具序列匹配）、角色/概念验证器、用户纠正、任务成败反馈。

3. **从原子化到关系化** — 认知结构不是孤立的概率标签。它们之间存在依赖、矛盾、特化、时序、约束、替代关系。一个结构的置信度变化必须沿关系图传播。传播规则为确定性逻辑（不调 LLM），传播深度 ≤ 3 跳。

4. **从事后检测到事前约束** — LLM 犯错后再标记 [PREDICTION_FAILED] 不够。已结晶的 ProtoConstraint 应在 LLM 调用前作为 hard constraint 注入 system prompt。`before_tool_call` Hook 应在工具执行前拦截违规操作。

5. **优雅降级** — 四级压力自适应保证在上下文紧张时仍保留核心功能。Critical 下 LLM 仍知道所有结构存在（索引 + Lazy Loading），只是"知道多少细节"随压力变化。

6. **知行闭环** — 知识必须能够结构化地驱动执行（GuidanceSignal 进入 system prompt + plan-generator 生成可执行计划），执行结果必须能够结构化地反馈知识（OutcomeFeedback → 置信度调整 + ProtoTask 更新）。

7. **人类治理** — 新范畴的创建、结构的结晶化/退化、超过 20% 的置信度调整——需人类审批。任何结构可回滚到任意历史版本。

8. **元认知自检** — Meta Layer 周期性地审计: 框架本身是否有缺陷？范畴系统是否足够？是否存在范畴盲区？这区别于"学到了什么"（知识缺口），追问的是"学习的框架本身是否有问题"（结构缺口）。

---

> **附录**: 架构从 V1 到 V13 的演变过程见 [praxis-changelog.md](praxis-changelog.md)。本文档是合成后的最终架构设计，不再按版本时间线组织。
