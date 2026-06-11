# Praxis 架构设计

> **当前迭代**: V13 (完整认知引擎)
> **下一迭代**: 架构完成, 可指导工程落地
> **状态**: V1-V13 所有特性已迭代整合

---

## V2: 架构载体确定 — OpenClaw Memory Plugin

### V2 核心变更

V2 确定了 Praxis 的架构载体：作为 **OpenClaw Memory Plugin** 运行（非独立 Harness）。

**为什么选择 OpenClaw?**: PI 桌面自动化场景太窄；Hermes 有独立学习循环与 Praxis 冲突；OpenClaw 开源、Plugin 成熟、MCP 原生、Hook 完整、无学习循环重叠。

**三层模型**: `AgentMemory (大脑皮层,持久存储) ↕MCP Praxis (心智模型,学习+决策) ↕Hook OpenClaw (身体,工具执行+Agent调度+通信)`

### V2 新增: 5 个核心 Hook 映射到 OpenClaw Agent Loop

| Hook | 职责 | OpenClaw 返回值 |
|------|------|----------------|
| `session_start` | 加载能力模型+工具注册表+思维状态 → 注入 system prompt | prompt 注入 |
| `before_tool_call` | proficiency × risk → autonomy 决策 | `proceed`/`inform`/`confirm`/`block` |
| `after_tool_call` | 匹配 feedback signals → 检测学习事件 | 追踪记录 |
| `agent_end` | 汇总工具调用 → 学习循环 → 更新能力模型 | TaskTrace 持久化 |
| `session_end` | 反思 + 模式检测 + mental_state 保存 | 状态快照 |

### V2 新增: AutonomyPolicy 决策映射

将自主性策略映射到 OpenClaw 可执行指令: `proceed`(自主执行)/`inform`(执行后告知)/`confirm`(暂停等待确认)/`block`(拒绝并解释)

### V2 新增: ToolProficiency + TaskTrace + 会话内缓存

- **ToolProficiency**: 工具来源追踪 (openclaw_native|mcp_server|plugin)，工具由 OpenClaw/MCP 提供，Praxis 叠加熟练度元数据
- **TaskTrace**: 追踪工具调用链 + autonomy_decision + feedback signal 匹配
- **会话内缓存**: session_start 批量加载 → session 期间内存操作 → agent_end/session_end 批量写回

---

## V3: 多维学习 + 主动好奇心

### V3 核心变更

V2 解决了"在哪里运行"。V3 解决了"学什么 + 谁发起"。

### V3 新增: 四维能力模型 (1D→4D)

| 维度 | 内容 | 示例 |
|------|------|------|
| `tool_skills` | 每工具熟练度 (V2 保留) | coffee: 0.72 |
| `domain_familiarity` | 业务领域理解度 | 膜力云水务: 0.65 |
| `task_type_proficiency` | 任务类型熟练度 | 周报制作: 0.80 |
| `user_model_confidence` | 用户偏好/风格了解度 | 沟通风格: 0.75 |

### V3 新增: Curiosity Engine (4 阶段)

Phase 1 Gap Detection → Phase 2 Prioritization (relevance×frequency×impact×urgency) → Phase 3 Action Generation (Level 0-3) → Phase 4 Question Governance (频率/质量/静默时段限制)

### V3 新增: 5 种学习事件 + 5 种知识类型 + message_received Hook

**5 种学习事件**: mistake_correction(错误纠正)、domain_insight(领域洞察)、preference_discovery(偏好发现)、task_pattern_recognition(任务模式识别)、procedural_optimization(流程优化)

**5 种知识类型**: domain_knowledge(领域概念/干系人/项目约束)、task_pattern(工具链/陷阱/成功模式/用户偏好)、user_model(沟通偏好/决策模式/优先级信号)、procedural_knowledge(跨工具工作流/依赖)、tool_knowledge(最佳实践/失败模式/技巧)

**message_received Hook (第 6 个)**: 语义意图分析 — teaching_mode/correction_mode/preference_expression/task_evaluation/gap_signal

**双向交互**: Praxis 可通过 OpenClaw 通道主动向用户提问（需满足治理策略）

---

## V4: 过程驱动 — Process Engine + Role Model + Momentum Engine

### V4 核心变更

**V3 让 Praxis 知道"学什么"。V4 让 Praxis 知道"下一步该干什么"**——不是调哪个工具，而是推动什么、找谁推动、卡住了怎么办。

### V4 新增: Process Engine（过程引擎）

嵌入 L2（任务编排层），将 V3 的工具链任务模型升级为过程网络模型:

```
ProcessTemplate → ProcessInstance → ProcessStep
    "流程模板"       "流程实例"       "流程步骤"
  "软件开发流程       "用户管理模块      "架构设计这个
   应该怎么走"       开发现在走到哪"    步骤的具体情况"
```

**三种步骤类型**:
| 类型 | 说明 | 示例 |
|------|------|------|
| `self` | Praxis 自己做 | 数据采集、代码生成 |
| `delegated` | 找协作者做 | 让 PM 确认 PRD |
| `collaborative` | 混合 | 客户验收（Praxis 组织+协作者参与） |

**步骤状态机**: `pending → ready → in_progress → completed` / `blocked → waiting → nudge → escalated`

**Delegated 步骤的等待策略**: reasonable_wait → nudge_threshold → escalation_threshold, max_nudges, nudge_interval

**ProcessTemplate 从实际执行中进化**: 初始模板(运维者预置) → 第 N 次执行后(Praxis 从 ActionVerification 学到优化)

### V4 新增: Role Model（角色模型）

嵌入 L3（知识管理），将 V3 的单 UserModel 扩展为多角色注册表:

- `RoleRegistry`: 多个角色注册（用户、PM、架构师、客户...）
- 每个角色: 沟通偏好(渠道+风格)、可用时间、响应模式、互动历史
- 角色关系图: 谁对谁有依赖、谁能批准谁
- 沟通适配: Praxis 根据不同角色调整沟通风格

### V4 新增: Momentum Engine（推动引擎）

对称于 V3 的 Curiosity Engine。Curiosity Engine 管理"知识缺口"→ Momentum Engine 管理"过程阻塞":

```
阻塞检测 → 推动策略决策树:
  wait (合理等待期内) → nudge (催办, 最多 N 次) → escalate (升级给用户)
  → bypass (绕过, 找替代角色) → abandon (放弃该步骤, 记录原因)
```

### V4 新增: Action Verification Loop（行动验证循环）

5 个验证维度:
- 步骤决策正确性: 该步骤是否应该做？
- 角色路由准确性: 是否找了正确的人？
- 时机适当性: 催办/升级的时机是否合适？
- 沟通适配性: 沟通风格是否被接受？
- 流程效率: 实际执行 vs 历史数据？

### V4 新增: cron_tick Hook（第 7 个 Hook）

时间驱动的定期扫描。每 N 小时触发，扫描所有活跃 ProcessInstance，检查等待步骤的超时状态，触发 Momentum Engine。

### V4: 能力模型 4D→6D

新增两个维度:
- `process_management`: 管理过程、推动步骤、处理阻塞的能力
- `action_reliability`: 行动决策（催办/升级/绕过）的可信度

---

## V5: Meta Layer — 结构自演化

### V5 核心变更

**V5 引入 Meta Layer**——一个不对任务做处理的侧观察者，专门监控所有子系统是否存在**结构性不足**（框架本身的缺陷）。

### V5 新增: StructuralGap vs KnowledgeGap

| 类型 | 定义 | 处理引擎 |
|------|------|---------|
| `KnowledgeGap` | "我不知道 X"（信息缺口） | Curiosity Engine (V3) |
| `StructuralGap` | "我对这类问题的思考框架本身是错的"（框架缺陷） | Meta Layer (V5) |

### V5 新增: 五种 StructuralGap 检测信号

1. 模板匹配度下降（ProcessTemplate 适应得分连续降低）
2. 跨场景行动验证得分低（同一操作在不同场景反复出错）
3. 用户挫败模式（用户反复纠正同一类问题）
4. 认知边界停滞（某技能熟练度长期不增长）
5. 升级模式异常（escalation 频率或类型偏离预期）

### V5 新增: Cognitive Structure Registry（认知结构注册表）

带版本的历史注册表，生命周期状态:
```
hypothesized → candidate → experimental → crystallized → deprecated/rejected
```
每个结构: 独立版本链、验证实验记录、置信度追踪。

### V5 新增: 三种铁律

1. **无新结构不经过人类审批** — 不可自动创建
2. **实验必须有范围限制** — 不能无限实验
3. **任何结构可回滚** — 保留所有历史版本

### V5: 学习事件 10→15 种

新增: structural_inadequacy_detected, structure_constructed, structure_validated, structure_regression, governance_override

### V5 保留: V1-V4 所有组件

六层架构、4D→6D 能力模型、Process Engine、Role Model、Momentum Engine、Curiosity Engine 全部保留。

---

## V6: Proto-Cognitive Engine — 零先验学习

### V6 核心变更

**V5 需要部分模板匹配作为锚点。V6 去除该要求**——当场景适应度 = 0（完全陌生，没有任何模板），Proto-Cognitive Engine 从零构建认知。

### V6 新增: Proto-Cognitive Engine 四阶段

**Phase 1: Open Perception（开放感知）**
- 标记 SalientElements（不分组、不分类）
- 信号: 重复、用户强调、序列位置、用户纠正、新奇度
- "注意到 X。注意到 Y。注意到 X 和 Y 似乎相关。"

**Phase 2: Proto-Structure Construction（原型构造）**
从共现对形成模糊概率原型（一切可修正）:

| 结构类型 | 初始置信度 | 说明 |
|---------|----------|------|
| `ProtoSequence` | 0.30 | 模糊的行为序列假设 |
| `ProtoRole` | 0.35 | 模糊的角色关系假设 |
| `ProtoConcept` | 0.25 | 模糊的概念定义假设 |
| `ProtoPurpose` | 0.25 | 模糊的目标意图假设 |

**Phase 3: Interactive Validation（交互式验证）**
每次场景复现 → 激活当前原型的最高置信度版本 → 做预测 → 对比现实:
- 成功: +0.1×(1-conf)
- 失败: -0.2×conf
- 用户纠正: -0.4×conf

LLM 预测标记:
```
[PREDICTION_CONFIRMED: proto_id]  — 预测正确
[PREDICTION_FAILED: proto_id, reason]  — 预测错误
[PREDICTION_UNCERTAIN: proto_id, reason]  — 不确定
```

**Phase 4: Crystallization/Degradation**
- 置信度 > 0.8 + 观察 >= 5 → 候选固化 (CandidateStructure)
- 固化结构遇 > 3 个反例 → 衰退回 ProtoStructure
- 置信度 < 0.2 + 60 天未观察 → 标记 degraded

### V6 新增: ProtoStructure 数据模型

```yaml
ProtoStructure:
  proto_id: string          # "proto_hospital_outpatient_001"
  proto_type: "sequence" | "role" | "concept" | "purpose"
  tentative_name: string
  scenario_id: string
  confidence: float         # 0.0-1.0 (交互式验证后)
  observations_count: int
  prediction_protocol:      # 预测标记
    last_prediction: string | null
    prediction_result: "confirmed" | "failed" | "uncertain" | null
  lifecycle_stage: "prototype" | "verified" | "crystallized" | "degrading" | "archived"
```

### V6 新增: 信息演化管线

```
Raw Observation → SalientElement → ProtoStructure (概率) → CandidateStructure → CrystallizedStructure
                                                                    ↑ 任意阶段可衰退 ↓
```

### V6: 能力模型 6D→8D

新增 `proto_cognition` 维度: AI 在完全陌生的环境中从零构建认知的能力。

### V6: Layer Self-Modification

V5 允许添加/修改 CognitiveStructures。V6 允许修改层定义、层边界甚至 Meta Layer 本身（需人类治理，逐级审批）。

### V6 保留: V1-V5 所有组件

> **V4-V6 迭代完成。** V4 增加过程驱动(Process Engine+Role+Momentum)、V5 增加结构自演化(Meta Layer+StructuralGap)、V6 增加零先验认知(Proto-Cognitive Engine+ProtoStructures+预测协议)。能力模型从 1D→4D→6D→8D。

---

## V7: 工程落地 — Context Orchestration Layer

### V7 核心洞察

**Praxis 不是传统 AI 系统。所有"认知操作"的底层实现 = Hook 回调函数 + LLM Prompt 调用 + AgentMemory 数据读写。Praxis 的本质是一个 Context Orchestration Layer（上下文编排层）**——在正确的时间，以正确的格式，将正确的结构化记忆注入 LLM 的上下文窗口。

质量上限 = LLM_质量 × 上下文构建质量。

### V7 新增: 第一个具体模块树

V1-V6 的"六层架构"是设计概念，不是代码模块。V7 将其映射为实际代码结构:

```
openclaw/src/plugins/praxis-plugin/
├── hooks/          (6 个 Hook 处理函数)
├── orchestration/  (5 个: scene-matcher, context-builder, proto-constructor,
│                    pattern-detector, confidence-updater)
├── analysis/       (4 个: transcript-analyzer, salience-marker,
│                    prediction-protocol, degradation-checker)
├── memory/         (4 个: client, queries, schemas, slots)
├── prompts/        (system/, analysis/, user/)
├── types/          (3 个: memory.ts, scene.ts, hooks.ts)
└── tests/
```

### V7 新增: 核心工程模块

**场景匹配器 (scene-matcher)**: 分类用户当前交互场景 → 决定注入哪些认知结构

**上下文构建器 (context-builder)**: 根据场景匹配结果选择注入策略:
- `exact`: 场景精确匹配 → 注入全量结构 (~1000 tokens)
- `fuzzy`: 场景模糊匹配 → 注入摘要 (~300 tokens)
- `weak`: 场景弱相关 → 注入名称列表 (~100 tokens)
- `zero_prior`: 完全陌生 → 开启 Open Perception

**显著性标记器 (salience-marker)**: 基于正则的轻量预标记（5 种信号: repetition, user_emphasis, sequence_position, user_correction, novelty）

**模式检测器 (pattern-detector)**: 基于 PMI（点间互信息）的统计预过滤，过滤共现对

**原型构造器 (proto-constructor)**: 从 AgentMemory 查询共现数据 → LLM 语义归纳 → ProtoSequence

**置信度更新器 (confidence-updater)**: +0.1×(1-c) 成功, -0.2×c 失败, -0.4×c 用户纠正, 早期观察折扣

**预测协议 (prediction-protocol)**: LLM 在输出中用 `[PREDICTION_FAILED: reason]` / `[PREDICTION_UNCERTAIN: reason]` 标记

### V7: 性能预算

- `message_received` hook: < 50ms（只做轻量标记）
- `session_end` hook: < 20s（批量 LLM 调用）
- 系统提示注入: < 1000 tokens

### V7: 工程缺陷分析（10 个缺陷，3 类根因）

1. **验证真空**: LLM 标记 → LLM 归纳 → LLM 审计。无独立地面真值。
2. **接地脆弱性**: 正则+关键词匹配不能可靠捕获语义显著性。
3. **人工依赖**: 学习循环在多个节点需要人类介入，无降级路径。

### V7 保留: V1-V6 所有认知设计概念（转化为工程规格）

> **V7 迭代完成。** 确立了 Praxis 的工程本质: Context Orchestration Layer。所有 V1-V6 的认知概念映射为 Hook 回调 + LLM Prompt + AgentMemory 操作。4-5 月实现路线图。

---

## V8: 1M 上下文重架构

### V8 核心变更

约束从"token 稀缺"变为"注意力稀缺"。V7 限制 ~1000 tokens 注入 → V8 可注入 50000+ tokens，但需管理注意力。

### V8 新增: 统计验证器（打破 LLM 自循环）

V7 最严重的缺陷是"LLM 标记→LLM 归纳→LLM 审计"的自循环。V8 的统计验证器提供**第一个不依赖 LLM 的验证信号**:

- 从 ProtoSequence 提取预测的工具映射
- 与 AgentMemory 中记录的实际工具调用序列进行模糊匹配
- 匹配成功 → statistical 信号 = 1.0 / 失败 → 0.0
- 与 LLM 标记信号独立 → 一致高置信度 / 矛盾偏信统计

### V8 新增: 上下文组织器 (Tier A/B/C)

替代 V7 的选择性注入:
- **Tier A**: 当前场景结构 → 全量详情 + 置信度校准
- **Tier B**: 相关场景结构 → 摘要 + 引用
- **Tier C**: 不相关场景结构 → 名称 + 一行描述

### V8 新增: Transcript Analyzer（端到端）

合并 V7 的 proto-constructor + pattern-detector → 一次端到端 LLM 调用。完整对话记录 → SalientElement + ProtoStructure。无 PMI 信息损失。

### V8 新增: 置信度融合器

替代 V7 的单一 confidence-updater。多源融合: statistical + llm_marker + user_correction。

### V8 新增: 本地缓存 (AgentMemory 降级)

7 天 TTL 文件缓存。AgentMemory 不可用时自动降级 → 恢复后自动同步。

### V8 新增: 自动固化 + 对抗架构审计

### V8 删除的模块（简化）

- `salience-marker.ts`: 正则预标记 → 不需要（全量 transcript 给 LLM）
- `pattern-detector.ts`: PMI 预过滤 → 不需要（且导致信息损失）
- `scene-matcher.ts` 选择性注入 → 替换为 Tier A/B/C 全量注入
- `context-builder.ts` 注入策略 → 替换为 context-organizer
- `confidence-updater.ts` → 替换为 confidence-fuser

### V8: 模块变化 -3 +5

净增 2 模块，但实现周期从 4-5 月缩减到 3 月（因模块删除）。

> **V8 迭代完成。** 统计验证器打破 LLM 自循环、全量注入+Tier排序简化架构、删除了不必要的正则/PMI预过滤。实现周期缩减。

---

## V9: 上下文压力自适应

### V9 核心变更

V8 假设 1M tokens 够用。V9 识别: 复杂连续任务中非 Praxis 消耗可达 600K-900K tokens，Praxis 的注入成为压垮骆驼的最后一根稻草。

### V9 新增: 上下文压力监控器

在 `session_start` 测量上下文利用率。四级:

| 级别 | 利用率 | Praxis 注入量 | 策略 |
|------|--------|-------------|------|
| Normal | < 60% | ~30K tokens | Tier A/B/C 全量 |
| Elevated | 60-75% | ~16K | Tier A 全量 + Tier B 压缩 + Tier C 移除 |
| High | 75-90% | ~3.5K | Tier A 摘要仅 |
| Critical | > 90% | ~1K | 仅结构索引 + recall_structure 工具注册 |

### V9 新增: Lazy Loading

Critical 压力下: LLM 获得结构索引 + `recall_structure` 工具。LLM 需要时主动调用 `recall_structure("门诊流程")`。Push → Pull 混合。

### V9 新增: 注意力遥测

LLM 标记 `[STRUCTURE_USED: proto_id]` 当实际引用结构时。追踪每个结构的采纳率。发现"僵尸结构"（高置信度、低采纳）。

### V9 新增: 角色/概念独立验证器

- **Role Verifier**: 比较 ProtoRole 定义的行为与实际工具调用者模式
- **Concept Verifier**: 对抗 prompt — "尝试找这个概念的反例"

### V9 新增: 一致性检查器 + 配置自适应 + 结构生命周期管理

### V9: 置信度融合 3 源 → 5 源

+role_verifier, +concept_verifier

> **V9 迭代完成。** 四级压力自适应保证优雅降级、Lazy Loading Push→Pull、注意力遥测发现僵尸结构。关键与 V7 选择性注入的区别: 即使在 Critical 下，LLM 仍知道所有结构存在（通过索引）。

---

## V10: 任务级认知 — TaskContext

### V10 核心变更

**V1-V9 的 Praxis 知道所有场景模式，但不知道"当前在做什么项目"**。V10 填补这个 gap。

### V10 新增: TaskContext (~200 tokens)

极轻量任务感知层。认知索引而非执行计划:

```typescript
interface TaskContext {
  task_id: string;                // "task_hospital_sys_2026"
  task_name: string;              // "构建医院管理系统"
  task_type: string | null;       // "software_project"
  current_phase: string | null;   // "Phase 2: API Development"
  progress_summary: string;       // "数据模型完成, API 60%"
  active_subtask: string | null;  // "实现预约挂号接口"
  relevant_scenarios: string[];   // ["hospital_outpatient", "api_design"]
  auto_updated: boolean;          // LLM 自动推断?
}
```

### V10 新增: session_end 自动进度推断

LLM 分析 transcript → 推断进度变化 → 置信度 < 0.7 不自动更新 → 用户可覆盖

### V10 新增: 任务感知优先级排序

Tier A 排序权重: 场景匹配度 × 0.60 + 任务相关性 × 0.40
- 与当前任务 relevant_scenarios 匹配的结构 → Tier A 最前
- 与 task_name token 匹配的结构 → 中等优先级

### V10 新增: ProtoTask (Phase 2+, 可选)

从多次同类项目中学习任务模式。phase_structures 引用已有 ProtoStructure。V10 仅概念设计，V11 升格为 Phase 1 核心。

### V10 新增: /praxis task start/update/status/end 命令

> **V10 迭代完成。** TaskContext 消除"任务认知真空"。~200 tokens 极轻量。ProtoTask 概念基础建立。等待 V11 知行闭环。

---

## V11: 知行合一闭环

### V11 核心变更

**V10 的知识只能以 prompt 文本注入。V11 建立四个结构化接口使知识可被执行层消费**。

### V11 新增: 四个结构化接口

**接口 1: KnowledgeQuery** — planning-with-files 查询 Praxis 获取 ProtoTask 阶段模板/陷阱
**接口 2: GuidanceSignal** — 类型化信号（phase_suggestion, pitfall_warning, structure_recommendation, contradiction_alert, confidence_advisory）+ severity + 建议行动
**接口 3: OutcomeFeedback** — 子任务成败 → 置信度调整 ±0.05 + ProtoTask 更新
**接口 4: MidSessionLearner** — 会话中实时矛盾检测（用户纠正 + 工具模式违反）→ 即时置信度下调

### V11 新增: ProtoTask 升格为 Phase 1 核心

Bootstrap 机制（零样本 LLM 通用知识，置信度 0.2）。随项目积累成长: 0→0.2, 1→0.3, 3→0.5, 5→0.65, 10→0.8。

### V11: 置信度融合 5 源 → 7 源

+outcome_feedback (0.10), +mid_session (0.08)

> **V11 迭代完成。** 四个结构化接口建立知行闭环。ProtoTask 从可选升格为核心，bootstrap 支持零样本。MidSessionLearner 实现会话中实时修正。

---

## V12: 主动认知引擎 — 任务编排状态机

### V12 核心变更

**V11 的三个外部接口存在是因为画错了 Praxis 与 planning-with-files 的边界**。planning-with-files 是一个 SKILL.md prompt 模板，不是架构组件。V12 拆除边界，Praxis 直接做任务分解。

### V12 新增: 任务编排状态机（两层嵌套 while() 循环）

**外层循环（任务级）**: TASK_NOT_STARTED → TASK_ASSESSING → TASK_PLAN_GENERATING → TASK_IN_PROGRESS → TASK_VERIFYING → TASK_ITERATING → TASK_COMPLETE/TASK_ABANDONED

**内层循环（子任务级）**: SUBTASK_PENDING → SUBTASK_ACTIVE → SUBTASK_COMPLETING → SUBTASK_VERIFIED/FAILED
中间态: SUBTASK_BLOCKED（用户纠正/工具违反3+次）

**V12: Hook 驱动 → 每个 Hook 调用推进状态机一步。V13: 主动驱动。**

### V12 新增: plan-generator（ProtoTask → PlanDocument）

```
getProtoTaskTemplate(task_type) → ProtoTask
  ├─ bootstrap (置信度 0.2) 或 cumulative (置信度 ≥0.5)
  └─ typical_phases → PlanPhase[] (含 subtasks, criteria, guidance)
     common_pitfalls → PlanPitfall[] (含 severity, mitigation, hit_count)
```

### V12 新增: verifier（5 种验收标准）

| 类型 | 自动化 | 示例 |
|------|--------|------|
| `command_output` | 自动 | `npm test -- --testPathPattern=X` → 匹配输出 |
| `file_existence` | 自动 | 检查文件是否存在 |
| `test_pass` | 自动 | 运行测试套件 |
| `llm` | 半自动 | LLM 审查代码/文档 |
| `user_approval` | 手动 | 安全/部署类操作 |

命令白名单: npm test, cargo test, go test, pytest

### V12 新增: pitfall-tracker（陷阱主动监控 + 反馈学习）

子任务失败 → 关键词匹配 ProtoTask.common_pitfalls → 命中反馈（ProtoTask.confidence +0.02）→ 误报率控制（> 30% 自动降 severity）

### V12 新增: progress-tracker + plan-file-writer

- progress-tracker: Hook 驱动的进度事件记录 + 摘要生成
- plan-file-writer: 生成 task_plan.md / progress.md / findings.md（兼容 planning-with-files 格式）

### V12: V11 接口内部化

- KnowledgeQuery → plan-generator 内部 getProtoTaskTemplate()
- GuidanceSignal → PlanDocument 嵌入 PhaseGuidance
- OutcomeFeedback → task-orchestrator 内部 processSubtaskOutcome()
- MidSessionLearner → 保留（LLM 交互在外部）

### V12: planning-with-files 降格为文件持久化工具

保留: Hook 脚本（PreToolUse/PostToolUse/Stop）、SHA-256 验证

移除: 任务分解（→ plan-generator）、计划模板（→ ProtoTask 驱动）、进度跟踪（→ progress-tracker）

> **V12 迭代完成。** 架构从 32 模块简化为 29 模块（+6新, -3移）。外部接口从 4 减到 1。任务编排状态机 + 计划生成 + 验收体系 + 陷阱追踪 = 完整认知引擎。

---

## V13: 完全主动引擎

### V13 核心变更

**V12 的状态机完整但被动（等待 Hook 事件）。V13 激活 OpenClaw 预留的所有主动驱动能力**。

### V13 新增: 四种核心能力

**1. Memory（持久化）**: AgentMemory — 所有认知结构、任务状态、学习历史的持久存储

**2. Learning（学习）**: Proto-Cognitive Engine + Curiosity Engine + 置信度融合 + MidSessionLearner

**3. Orchestration（编排）**: 两层嵌套状态机 + plan-generator + verifier + pitfall-tracker

**4. Drive（驱动）← V13 新增**:

### V13 新增: Task Scheduler（任务调度器）

session_end 触发决策矩阵: 自主驱动启用？静默时段？每日触发限制？→ 决定机制:
- `subagent_run`: 可并行子任务
- `scheduleSessionTurn`: < 1 小时（相对时间）
- `scheduleSessionTurn`: 1-24 小时（绝对时间）
- `cron_job`: > 24 小时（定期检查）

### V13 新增: Subagent Manager（子 Agent 管理器）

- spawnSubagent() → waitForCompletion() → retrySubagent() → aggregateResults()
- 最大并行度: 3（可配置）
- 子 Agent 上下文: 子任务定义 + 陷阱预警 + 验收标准（无父对话历史）
- 失败隔离: 一个子 Agent 失败不影响其他

### V13 新增: Heartbeat Monitor（心跳监控）

注册为 OpenClaw Service。每 5 分钟检测子任务停顿:
- Level 1 (nudge): 注入提醒到活跃会话
- Level 2 (wake): requestHeartbeat() 主动唤醒
- Level 3 (escalate): markSubtaskBlocked() + 推进外循环

### V13: 5 种 Trigger 全部激活

V12 定义 5 种 TriggerSource，仅使用 2 种。V13 全部激活:
- `hook:session_start` (V12) + `hook:session_end` (V12)
- `cron:scheduled` (V13) + `subagent:completed` (V13) + `heartbeat:wake` (V13)

### V13: 状态机零修改原则

V13 不修改 V12 状态机的一行代码。`advanceOuterLoop()` 保持不变。仅新增触发调用点。

### V13 新增: 自主学习触发

- cron 分析 task_history → 达到 min_observations → 自动构造 ProtoTask
- 置信度 plateau 检测（3 次观察无提升）→ 请求更多同类任务
- 能力模型定期审计 → 识别停滞技能 → 生成学习建议

### V13 新增: 跨 Agent 认知同步

子 Agent session_end → 写入 ProtoStructure 更新（乐观锁 + version 号）→ 父 Agent session_start 读取最新版本

> **V13 迭代完成。** 四大核心能力（Memory+Learning+Orchestration+Drive）= 完整认知操作系统。V12 的被动编排 → V13 的主动驱动。净增 < 530 行代码。

---

## 最终整合: 完整架构

### 模块树 (V13 最终版)

```
openclaw/src/plugins/praxis-plugin/
├── index.ts                                 # 插件入口
├── config.ts                                # GovernancePolicy 配置聚合
│
├── orchestration/                           # 任务编排核心层
│   ├── task-orchestrator.ts                 # [V12] 两层嵌套状态机
│   ├── plan-generator.ts                    # [V12] ProtoTask → PlanDocument
│   ├── verifier.ts                          # [V12] 5 种验收标准
│   ├── progress-tracker.ts                  # [V12] 进度事件管理
│   ├── task-scheduler.ts                    # [V13] 主动调度决策
│   ├── subagent-manager.ts                  # [V13] 子 Agent 生命周期
│   ├── heartbeat-monitor.ts                 # [V13] 心跳停顿检测
│   ├── context-pressure-monitor.ts          # [V9] 四级压力
│   ├── scene-recognizer.ts                  # [V7] 场景识别
│   ├── context-organizer.ts                 # [V8] Tier A/B/C 组织
│   ├── task-context.ts                      # [V10] TaskContext 管理
│   ├── confidence-fuser.ts                  # [V7/V8] 多源融合
│   └── prediction-protocol.ts              # [V7] 预测协议
│
├── analysis/                                # 分析与学习层
│   ├── mid-session-learner.ts               # [V11] 实时学习
│   ├── proto-task.ts                        # [V10/V11] ProtoTask 构造
│   ├── pitfall-tracker.ts                   # [V12] 陷阱追踪
│   ├── transcript-analyzer.ts               # [V8] 端到端分析
│   ├── statistical-verifier.ts              # [V8] 独立统计验证
│   ├── role-verifier.ts                     # [V9] 角色验证
│   ├── concept-verifier.ts                  # [V9] 概念验证
│   ├── attention-telemetry.ts               # [V9] 注意力遥测
│   ├── consistency-checker.ts               # [V9] 一致性检查
│   ├── config-adapter.ts                    # [V9] 配置自适应
│   ├── degradation-checker.ts               # [V9] 衰退检查
│   ├── structure-lifecycle.ts               # [V9] 结构生命周期
│   └── architecture-auditor.ts              # [V9] 架构审计
│
├── files/                                   # 文件持久化层 [V12]
│   └── plan-file-writer.ts
│
├── hooks/                                   # Hook 事件处理
│   ├── session-start.ts
│   ├── message-received.ts
│   ├── before-tool-call.ts
│   ├── after-tool-call.ts
│   ├── agent-end.ts
│   └── session-end.ts
│
├── memory/                                  # AgentMemory 接口
│   ├── client.ts / recall-structure.ts / local-cache.ts
│   ├── schemas.ts / slots.ts / queries.ts
│
├── prompts/                                 # Prompt 模板
│   ├── system/ (memory-context, plan-injection, prediction-markers, critical-mode)
│   ├── analysis/ (extract-and-update, construct-proto-task, generate-plan, verify-progress, consistency-scan, audit-architecture)
│   └── user/ (perception-summary, crystallization-proposal)
│
├── types/                                   # 类型定义
│   └── memory.ts / scene.ts / hooks.ts
│
└── tests/
```

### AgentMemory 集成 (V13 最终版)

**Slots**:
| Slot 名 | 内容 | 大小 | 版本引入 |
|---------|------|------|---------|
| `competency_model` | 8D 能力模型 | < 50KB | V1 |
| `autonomy_policy` | 自主性策略 | < 10KB | V1 |
| `tool_registry` | 工具注册表 | < 20KB | V1 |
| `task_context` | 任务上下文 | < 1KB | V10 |
| `task_orchestration_state` | 编排状态机状态 | < 10KB | V12 |
| `task_plan` | 计划文档 + markdown | < 20KB | V12 |
| `progress_log` | 进度事件 (最近100条) | < 5KB | V12 |
| `proto_task` | ProtoTask 结构 | < 5KB | V11 |

### GovernancePolicy 关键配置

```yaml
autonomy_policy: { ... }         # V1
context_pressure:                # V9
  normal_threshold_k: 500
  moderate_threshold_k: 200
  high_threshold_k: 100
task_context:                    # V10
  auto_update_confidence_threshold: 0.7
mid_session_learner:             # V11
  contradiction_threshold: 3
  max_immediate_penalty_per_session: 0.2
proto_task:                      # V11
  bootstrap_on_task_start: true
task_orchestration:              # V12
  auto_generate_plan: true
  auto_verify_on_session_end: true
verification:                    # V12
  allowed_check_commands: [npm test, cargo test, go test, pytest]
pitfall_tracking:                # V12
  auto_downgrade_misrate: 0.3
task_scheduler:                  # V13
  max_daily_triggers: 10
  quiet_hours_start: "22:00"
  quiet_hours_end: "07:00"
```

### 版本特性追溯矩阵

| 特性 | V1 | V2 | V3 | V4 | V5 | V6 | V7 | V8 | V9 | V10 | V11 | V12 | V13 |
|------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|
| 六层架构设计概念 | ✅ | M | 增强 | 增强 | 增强 | 增强 | E→模块 | E | E | E | E | E | E |
| OpenClaw Plugin 形态 | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| 三层模型 (AM=Praxis=OC) | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| 工具注册+反馈解释器 | ✅ | E | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| 能力模型 | ✅1D | 2D | 4D | 6D | 6D | 8D | 8D | 8D | 8D | 8D | 8D | 8D | 8D |
| 自主性策略 | ✅ | E | 保留 | E | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| 学习闭环+事件 | ✅1种 | 1种 | 5种 | 10种 | 15种 | 15种 | 15种 | 15种 | 15种 | 15种 | 15种 | 15种 | 15种 |
| Curiosity Engine | — | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| Process Engine | — | — | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | E→Orch | E→HB |
| Role Model + Momentum | — | — | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | E |
| Meta Layer + StructGap | — | — | — | — | ✅ | 保留 | 实用化 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| Proto-Cognitive Engine | — | — | — | — | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| ProtoStructure (4类型) | — | — | — | — | — | ✅ | ✅ | E | E | 保留 | 保留 | 保留 | 保留 |
| 预测协议 | — | — | — | — | — | ✅ | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| Context Orchestration Layer | — | — | — | — | — | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| 统计验证器 (独立信号) | — | — | — | — | — | — | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 |
| Tier A/B/C 上下文组织 | — | — | — | — | — | — | — | ✅ | 保留 | E | 保留 | E | E |
| 置信度融合 (多源) | — | — | — | — | — | — | — | ✅3源 | 5源 | 保留 | 7源 | 7源 | 保留 |
| 四级压力自适应 | — | — | — | — | — | — | — | — | ✅ | 保留 | 保留 | 保留 | 保留 |
| Lazy Loading | — | — | — | — | — | — | — | — | ✅ | 保留 | 保留 | 保留 | 保留 |
| 注意力遥测 | — | — | — | — | — | — | — | — | ✅ | 保留 | 保留 | 保留 | 保留 |
| 结构生命周期管理 | — | — | — | — | — | — | — | — | ✅ | 保留 | 保留 | 保留 | 保留 |
| TaskContext | — | — | — | — | — | — | — | — | — | ✅ | 保留 | E | E |
| 任务感知优先级排序 | — | — | — | — | — | — | — | — | — | ✅ | 保留 | E | E |
| GuidanceSignal | — | — | — | — | — | — | — | — | — | — | ✅ | I | I |
| MidSessionLearner | — | — | — | — | — | — | — | — | — | — | ✅ | E | E |
| ProtoTask (bootstrap) | — | — | — | — | — | — | — | — | — | P2 | P0 | P0 | P0 |
| 两层嵌套状态机 | — | — | — | — | — | — | — | — | — | — | — | ✅ | E |
| plan-generator | — | — | — | — | — | — | — | — | — | — | — | ✅ | E |
| verifier (5 种验收) | — | — | — | — | — | — | — | — | — | — | — | ✅ | E |
| pitfall-tracker | — | — | — | — | — | — | — | — | — | — | — | ✅ | E |
| plan-file-writer | — | — | — | — | — | — | — | — | — | — | — | ✅ | 保留 |
| Task Scheduler | — | — | — | — | — | — | — | — | — | — | — | R | ✅ |
| Subagent Manager | — | — | — | — | — | — | — | — | — | — | — | — | ✅ |
| Heartbeat Monitor | — | — | — | — | — | — | — | — | — | — | — | — | ✅ |
| 自主学习触发 | — | — | — | — | — | — | — | — | — | — | — | — | ✅ |

> 图例: M=修改, E=增强/演进, I=内部化, R=架构就绪, P0/P1/P2=优先级, Orch=TaskOrchestrator, HB=Heartbeat

---

> **Praxis V1→V13 完整架构迭代完成。** 从 V1 的六层设计概念开始，经过 V2 架构载体确定、V3 多维主动学习、V4 过程驱动、V5 结构自演化、V6 零先验认知、V7 工程落地（Context Orchestration Layer）、V8 1M上下文重架构、V9 压力自适应、V10 任务级认知、V11 知行闭环、V12 主动认知引擎（状态机+计划生成+验收+陷阱），到 V13 完全主动引擎（自主调度+子Agent管理+Heartbeat+自主学习触发）。所有版本特性已迭代整合为一个完整的、可指导工程落地的架构设计。

---

## V1: 核心架构

### 1. 架构定位

Praxis 是一个 **AI 通用行动代理操作系统**。位于 AI 推理引擎（LLM）与外部世界之间，作为 Harness 层中间件。

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
│   Praxis     │◀──▶│    AgentMemory         │
│  (Harness)    │    │    (存储后端)           │
│              │    │                        │
│ • 能力模型   │    │ • 记忆存储/检索         │
│ • 学习闭环   │    │ • 知识图谱              │
│ • 知识管理   │    │ • 版本链/衰减/治理      │
│ • 自主决策   │    │ • 多实例同步            │
│ • 工具注册   │    │ • Slot 状态管理         │
└──────┬───────┘    └────────────────────────┘
       │
       │ MCP / REST / MQTT / WebSocket
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
└────────────────────────────────────────────┘
```

### 2. 六层架构

```
┌──────────────────────────────────────────────────────────────┐
│ L6: 自主决策层 (Autonomy Engine)                              │
│ • 跨工具的自主性判断                                          │
│ • proficiency × risk → action                                │
├──────────────────────────────────────────────────────────────┤
│ L5: 能力模型层 (Competency Manager)                           │
│ • 多维度技能树（领域 × 工具 × 熟练度）                        │
│ • 跨工具技能组合                                              │
│ • 每个工具/技能的独立成长曲线                                  │
├──────────────────────────────────────────────────────────────┤
│ L4: 学习闭环层 (Learning Engine)                              │
│ • 统一的 执行→评估→差距→更新→固化 循环                       │
│ • 每个工具的反馈解释器                                        │
│ • 跨会话的经验传递                                            │
├──────────────────────────────────────────────────────────────┤
│ L3: 知识管理层 (Knowledge Manager)                            │
│ • 多模态知识摄入（文字/语音/图像/视频）                       │
│ • 工具特定知识库                                              │
│ • 知识→工具→技能的关联索引                                    │
├──────────────────────────────────────────────────────────────┤
│ L2: 任务编排层 (Task Orchestrator)                            │
│ • 任务分解：复杂任务→子任务→工具调用序列                      │
│ • 跨工具工作流                                                │
│ • 错误恢复和容错策略                                          │
├──────────────────────────────────────────────────────────────┤
│ L1: 工具与集成层 (Tool Registry)                              │
│ • 工具注册、发现、描述                                        │
│ • 每个工具的熟练度追踪                                        │
│ • 工具反馈解释器                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3. 核心数据模型

#### 3.1 Tool（工具注册）

```yaml
Tool:
  id: string                    # 唯一标识 "coffee_machine"
  name: string                  # 人类可读名称 "咖啡机"
  type: ToolType                # physical_control | document_creation | communication | perception | data_processing
  provider: string              # MCP | REST | MQTT | gRPC | WebSocket
  status: ToolStatus            # active | disabled | error | onboarding
  
  interface:
    actions:
      - name: string
        params: [{name, type, required, default}]
        returns: string
    events:                     # 异步事件
      - name: string
        payload_schema: object
  
  feedback:
    success_signals: string[]   # ["brew_complete", "user_affirms"]
    failure_signals: string[]   # ["error", "out_of_beans"]
    quality_indicators:
      - signal: string
        interpretation: string
  
  risk:
    physical_consequences: string[]
    max_autonomy: AutonomyLevel # supervised | semi_autonomous | fully_autonomous
    confirm_required_for: string[]
    special_concerns: string[]  # ["privacy", "safety_critical"]
  
  metadata:
    installed_at: datetime
    version: string
    documentation_url: string
```

#### 3.2 Task（任务）

```yaml
Task:
  id: string
  title: string
  type: TaskType               # implementation | analysis | learning | operation | perception
  
  assignment:
    description: string
    context: {project, relates_to, dependencies}
    expectations:
      output: string[]
      quality_criteria: string[]
      constraints: string[]
    autonomy_granted: AutonomyLevel
  
  execution:
    sessions: string[]          # 涉及的会话 ID
    tools_used: string[]        # 使用的工具
    decisions: [{what, why, alternatives_considered}]
    mistakes: [{what, when, how_fixed}]
    self_assessment: string
  
  outcome:
    status: TaskStatus          # pending | in_progress | completed | blocked | needs_review
    quality_score: float        # 0.0-1.0
    user_feedback:
      rating: float
      notes: string
      implicit_signals: string[]
    lessons_extracted: string[] # 关联的 Lesson ID
```

#### 3.3 Knowledge（知识条目）

```yaml
Knowledge:
  id: string
  title: string
  
  source:
    type: KnowledgeSource       # user_instruction | document | voice_note | image | video | web_article | self_derived
    modality: Modality          # text | audio_transcript | image_description | video_transcript
    original_ref: string
    media_location: string?
  
  content: string
  
  organization:
    domain: string              # "authentication"
    topics: string[]            # ["jwt", "token-management"]
    skill_associations: string[]
    tool: string?
    difficulty_level: string    # beginner | intermediate | advanced
  
  state:
    confidence: float           # 0.0-1.0
    last_applied: datetime
    application_count: int
    needs_review: boolean
```

#### 3.4 LearningEvent（学习事件）

```yaml
LearningEvent:
  id: string
  timestamp: datetime
  source_task: string           # 关联的 Task ID
  
  type: LearningEventType       # mistake_correction | skill_improvement | new_knowledge | feedback_integration | insight
  
  description:
    before: string              # 之前的行为/认知
    after: string               # 之后的行为/认知
    root_cause: string
  
  impact:
    affected_skills:
      - skill: string
        proficiency_change: float
        reason: string
    new_knowledge_ids: string[]
    prevention_strategy: string
  
  evidence:
    observation_refs: string[]
    confidence: float
```

#### 3.5 CompetencyModel（能力模型）

```yaml
CompetencyModel:
  version: int
  last_updated: datetime
  total_tasks_completed: int
  
  skill_tree:
    - domain: string            # "software-engineering"
      overall_proficiency: float
      skills:
        - id: string            # "skill:system-architecture"
          name: string
          tool: string?         # 关联工具 ID
          proficiency: float    # 0.0-1.0
          level: SkillLevel     # novice | advanced_beginner | competent | proficient | expert
          
          evidence:
            - task: string
              performance: float
              date: datetime
          
          best_practices: string[]
          anti_patterns:
            - pattern: string
              occurrences: int
              last_occurred: datetime
              prevention: string
          
          learning_focus: string
          knowledge_gaps: string[]
          user_preferences: object
          
          autonomy:
            level: AutonomyLevel
            needs_confirmation_when: string[]
            effective_since: datetime
          
          learning_timeline:
            - date: datetime
              event: string
              proficiency_before: float
              proficiency_after: float
  
  composite_skills:
    - id: string
      name: string               # "周报工作流"
      tool_sequence: string[]
      overall_proficiency: float
      bottleneck: string
  
  working_style:
    problem_solving: string
    code_style: string
    communication: string
    learning_style: string
```

#### 3.6 AutonomyPolicy（自主性策略）

```yaml
AutonomyPolicy:
  default_policy:
    unknown_operation: "confirm"
    low_risk_known: "inform"
    high_risk_known: "confirm"
    after_error: "downgrade_one"
  
  operation_policies:
    - operation: string
      required_proficiency: float
      autonomy: AutonomyLevel
      exceptions: string[]
  
  risk_levels:
    low: ["reading_files", "searching", "summarizing"]
    medium: ["code_refactoring", "document_generation"]
    high: ["database_changes", "email_sending", "physical_device_control"]
    critical: ["production_deploy", "financial_operations", "privacy_sensitive"]
```

### 4. 核心流程

#### 4.1 会话生命周期

```
START ──────────────────────────────────────────────────── END
  │                                                         │
  ├─ [1] SessionStart Hook:                                │
  │       • memory_slot_get("competency_model")              │
  │       • memory_slot_get("autonomy_policy")               │
  │       • memory_slot_get("tool_registry")                 │
  │       • memory_smart_search("mental_state")              │
  │       • inject_into_system_prompt()                     │
  │                                                         │
  ├─ [2] 工作阶段:                                          │
  │       • 用户分配任务                                     │
  │       • AI 查询能力模型 → 判断自主性                     │
  │       • AI 查询相关知识 → 应用最佳实践                   │
  │       • AI 执行任务 (调用工具)                           │
  │       • PostToolUse Hook: 追踪工具使用                  │
  │                                                         │
  ├─ [3] 任务完成:                                          │
  │       • AI 自我评估                                     │
  │       • 用户反馈收集                                    │
  │       • 学习事件自动生成                                 │
  │       • 更新受影响技能评分                               │
  │                                                         │
  ├─ [4] SessionEnd Hook:                                  │
  │       • 会话反思总结                                    │
  │       • memory_patterns() 模式检测                      │
  │       • 能力模型版本快照                                │
  │       • memory_save(type="mental_state")                │
  └─ [5] 后台定期任务:                                      │
          • 每2小时: 知识固化                                │
          • 每天: 演化叙事更新                               │
          • 每周: 能力缺口分析                               │
          • 每月: 能力模型审计                               │
```

#### 4.1a 触发点详解

| 触发点 | 触发条件 | 动作 |
|--------|---------|------|
| **SessionStart** | 会话开始 | 加载能力模型摘要 + 恢复思维状态 + 注入工具熟练度指引 |
| **During Task** | AI 准备调用工具 | 查询 autonomy 策略 → 决定是否需要用户确认 |
| **During Task** | AI 需要特定知识 | 查询知识库 → 检索最佳实践 |
| **During Task** | AI 不确定该怎么做 | 查询 known_failure_modes → 规避已知错误 |
| **Post-Task** | 任务完成 | AI 自我评估 + 用户反馈收集 + 学习事件自动生成 |
| **错误发生** | 工具调用失败或用户指正 | 立即记录错误模式 |
| **重复错误** | 同一错误 2+ 次 | 提升为 anti-pattern，下次任务前主动提醒 |
| **突破** | 用户明确肯定 | 强化对应技能，可能提升熟练度 |
| **新工具接入** | 新 MCP/集成安装 | 初始化工具注册表，设定初始自主性为 supervised |
| **用户偏好变化** | 用户说"以后用 X 而不是 Y" | 更新 user_preferences 和 best_practices |
| **SessionEnd** | 会话结束 | 自我反思 + 模式检测 + 演化提案 + 保存 mental_state + 能力模型快照 |

**后台定期任务**:
| 周期 | 任务 |
|------|------|
| 每 2 小时 | 知识固化（碎片→主题） |
| 每次会话后 | 技能评估校准 |
| 每天 | 演化叙事更新 |
| 每周 | 能力缺口分析 |
| 每月 | 能力模型审计（评分准确性、过期数据清理） |

#### 4.1b 自主性级别变化时机

```
novice ──────▶ advanced_beginner ──────▶ competent ──────▶ proficient ──────▶ expert
  │                  │                      │                  │                │
  │ 首次使用工具      │ 完成 5+ 任务          │ 完成 20+ 任务     │ 完成 50+ 任务   │ 100+ 任务
  │ 每步都需确认      │ 基础操作自主          │ 标准任务自主      │ 复杂任务自主     │ 可以教别人
  │                  │ 新参数需确认          │ 重大变化确认      │ 仅异常情况确认   │
```

#### 4.2 任务执行流程

```
User: "帮我做一份本周的进度报告 PPT"
          │
          ▼
┌─────────────────────────────────────────────┐
│ TaskOrchestrator.create_task()               │
│ • 解析任务：type=document_creation           │
│ • 查询工具注册表：需要 ppt_generator          │
│ • 查询能力模型：ppt_generator proficiency=0.55│
│ • 决定自主性：semi_autonomous                 │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ LearningEngine.pre_task_injection()          │
│ • 查询知识库："PPT设计原则"、"上周报告格式"   │
│ • 查询 known_failure_modes：上次字体太小      │
│ • 注入上下文：偏好简洁 + 图表优先             │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ LLM + Tools 执行任务                         │
│ • 创建 PPT → 添加幻灯片 → 插入图表           │
│ • 自主操作：添加幻灯片                       │
│ • 确认操作：最终设计方案                     │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ TaskOrchestrator.complete_task()             │
│ • AI 自我评估                                │
│ • 收集用户反馈                               │
│ • 触发 LearningEngine.process_feedback()     │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ LearningEngine.generate_learning_event()     │
│ • 比较表现 vs 能力模型的预期                 │
│ • 提取教训：图表位置选择需要更多上下文信息    │
│ • 更新技能评分：ppt-proficiency +0.05        │
│ • 存储 LearningEvent + Lesson                │
└─────────────────────────────────────────────┘
```

#### 4.3 学习闭环

```
┌──────────────────────────────────────────────────────────┐
│                     Learning Loop                         │
│                                                           │
│  ┌──────────┐     ┌──────────┐     ┌──────────────┐     │
│  │ 执行任务  │────▶│ 评估结果  │────▶│ 识别能力差距  │     │
│  │ (Layer 2)│     │          │     │              │     │
│  └──────────┘     └────┬─────┘     └──────┬───────┘     │
│       ▲                │                  │              │
│       │           ┌────▼─────┐    ┌───────▼──────┐      │
│       │           │ 用户反馈  │    │ 更新能力模型  │      │
│       │           │ (稀缺资源)│    │ (Layer 5)    │      │
│       │           └──────────┘    └───────┬──────┘      │
│       │                                   │              │
│       │           ┌──────────┐    ┌───────▼──────┐      │
│       └───────────┤ 应用到   │◀───┤ 更新行为指引  │      │
│                   │ 下次任务  │    │ (注入上下文)  │      │
│                   └──────────┘    └──────────────┘      │
└──────────────────────────────────────────────────────────┘
```

#### 4.4 自主性决策流程

```
AI 准备调用 tool.action
          │
          ▼
┌─────────────────────┐
│ 查询该操作的 policy  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     YES     ┌─────────────┐
│ proficiency >=       │───────────▶│ 自主执行     │
│ required_proficiency?│            │ 可告知用户   │
└──────────┬──────────┘            └─────────────┘
           │ NO
           ▼
┌─────────────────────┐     YES     ┌─────────────┐
│ 该操作是否低风险？    │───────────▶│ 确认后执行   │
└──────────┬──────────┘            └─────────────┘
           │ NO
           ▼
┌─────────────────────────────┐
│ 必须用户确认                  │
│ 提供：操作描述 + 风险评估     │
│ + 替代方案（如有）            │
└─────────────────────────────┘
```

### 5. AgentMemory 集成

#### 5.1 存储映射

| Praxis 数据 | AgentMemory 工具 | 存储方式 |
|-------------|-----------------|---------|
| Tool Registry (active) | `memory_slot_get/set "tool_registry"` | Slot (project scope) |
| Tool Registry (history) | `memory_save type="tool_registry_version"` | Memory + supersedes |
| CompetencyModel (active) | `memory_slot_get/set "competency_model"` | Slot (project scope) |
| CompetencyModel (history) | `memory_save type="competency_model_version"` | Memory + supersedes |
| AutonomyPolicy | `memory_slot_get/set "autonomy_policy"` | Slot (project scope) |
| Knowledge entries | `memory_save type="knowledge"` | Memory (typed) |
| Knowledge retrieval | `memory_smart_search` | Triple-stream search |
| Tasks | Actions + Sketches | Action |
| Task history | `memory_crystallize` → Crystal → Lessons | Crystal + Lesson |
| Learning events | `memory_lesson_save` | Lesson |
| Learning retrieval | `memory_lesson_recall` / `memory_smart_search` | Lesson search |
| Behavior patterns | `memory_patterns` (behavioral 类型) | Pattern |
| Session state | `memory_sessions` + `memory_checkpoint` | Session + Checkpoint |
| Mental state | `memory_save type="mental_state"` | Memory |
| Reflections | `memory_reflect` → insights | Insight |
| Multi-modal (image) | `memory_save` + imageRef + `memory_vision_search` | Memory (image) |
| Audit trail | `memory_audit` | Audit |
| Data lifecycle | `memory_governance_*` + retention | Governance |

#### 5.2 调用模式

```
Praxis Core ──(MCP calls)──▶ AgentMemory MCP Server
                                    │
                                    ├─ memory_slot_get("competency_model")
                                    ├─ memory_smart_search(query, type="knowledge")
                                    ├─ memory_lesson_save(...)
                                    ├─ memory_save(type="mental_state", ...)
                                    └─ ...
```

### 6. Harness 集成点

#### 6.1 Hooks 配置

```yaml
hooks:
  SessionStart:
    - praxis_load_context:
        description: "加载 Praxis 能力模型和行为指引"
        actions:
          - memory_slot_get("competency_model")
          - memory_slot_get("autonomy_policy")
          - memory_slot_get("tool_registry")
          - memory_smart_search("mental_state", limit=3)
          - inject_into_system_prompt()
  
  PostToolUse:
    - praxis_track_tool_use:
        description: "追踪工具使用，检测学习事件"
        triggers: ["error", "user_correction", "task_completion"]
        actions:
          - evaluate_tool_performance()
          - maybe_generate_learning_event()
  
  SessionEnd:
    - praxis_reflect:
        description: "会话结束反思和能力更新"
        actions:
          - summarize_session_growth()
          - detect_new_patterns() via memory_patterns()
          - generate_evolution_proposals()
          - memory_save(type="mental_state", ...)
          - memory_slot_replace("competency_model", updated)
```

#### 6.2 System Prompt 注入格式

```markdown
## Praxis Context

### 当前能力概况
- 总体熟练度：0.70（competent）
- 最强领域：code-quality (0.85), technical-writing (0.80)
- 最弱领域：security-patterns (0.55), requirement-clarification (0.55)
- 当前学习重点：security-patterns

### 工具自主性策略
- coffee_machine: semi_autonomous（改参数需确认）
- ppt_generator: semi_autonomous（设计方案需确认）
- code_editor: fully_autonomous（低风险操作）
- email_sender: supervised（发邮件前必须确认）

### 上次停下的地方
[从 mental_state 加载]
```

#### 6.3 User Commands

| 命令 | 功能 |
|------|------|
| `/praxis status` | 查看能力模型和成长轨迹 |
| `/praxis tools` | 查看已注册工具及其熟练度 |
| `/praxis teach <topic>` | 主动教导知识 |
| `/praxis task <desc>` | 分配任务 |
| `/praxis review` | 审核待处理的演化提案 |
| `/praxis learn <topic>` | 发起学习任务 |
| `/praxis history` | 查看学习历史时间线 |

### 7. 多模态支持

| 模态 | V1 支持 | 方式 |
|------|---------|------|
| 文字 | ✅ 完整支持 | 直接存储和索引 |
| 图片 | ✅ 基础支持 | AgentMemory imageRef + vision_search |
| 语音 | ⚠️ 部分支持 | 外部转写 → 文本存储；原始音频文件引用 |
| 视频 | ⚠️ 部分支持 | 外部关键帧提取 + 转写 → 文本存储；原始视频引用 |
| 实时流 | ❌ V1 范围外 | 需要实时转写和事件流处理 |

### 8. 多实例部署

通过 AgentMemory 的 mesh sync 和 agent scope：

| 模式 | 说明 |
|------|------|
| `single` | 一个 AI 实例，一个能力模型 |
| `shared` | 多个 AI 实例共享同一个能力模型 |
| `isolated_per_project` | 每个项目独立能力模型 |
| `federated` | 全局身份 + 项目级能力组合 |

### 9. 核心 API 接口

```typescript
interface Praxis {
  // L1: Tool Registry
  toolRegistry: {
    register(tool: Tool): Promise<void>
    unregister(toolId: string): Promise<void>
    get(toolId: string): Promise<Tool>
    list(): Promise<Tool[]>
    updateProficiency(toolId: string, event: ProficiencyUpdate): Promise<void>
  }
  
  // L2: Task Orchestrator
  taskOrchestrator: {
    create(task: TaskInput): Promise<Task>
    complete(taskId: string, outcome: TaskOutcome): Promise<LearningEvent[]>
    getStatus(taskId: string): Promise<Task>
    listActive(): Promise<Task[]>
  }
  
  // L3: Knowledge Manager
  knowledgeManager: {
    ingest(knowledge: KnowledgeInput): Promise<Knowledge>
    search(query: string, filters?: SearchFilters): Promise<Knowledge[]>
    associate(knowledgeId: string, skillId: string): Promise<void>
    getBySkill(skillId: string): Promise<Knowledge[]>
  }
  
  // L4: Learning Engine
  learningEngine: {
    processTaskCompletion(taskId: string, outcome: TaskOutcome): Promise<LearningEvent[]>
    processFeedback(feedback: UserFeedback): Promise<LearningEvent>
    detectGaps(): Promise<SkillGap[]>
    getLearningTimeline(skillId?: string): Promise<LearningEvent[]>
  }
  
  // L5: Competency Manager
  competencyManager: {
    getModel(): Promise<CompetencyModel>
    getSkill(skillId: string): Promise<Skill>
    updateSkill(skillId: string, update: SkillUpdate): Promise<void>
    getGrowthTrajectory(): Promise<GrowthReport>
  }
  
  // L6: Autonomy Engine
  autonomyEngine: {
    canActAutonomously(toolId: string, action: string): Promise<AutonomyDecision>
    getPolicy(): Promise<AutonomyPolicy>
    updatePolicy(update: Partial<AutonomyPolicy>): Promise<void>
  }
}
```

### 10. V1 范围边界

**V1 包含**:
| 组件 | 优先级 | 说明 |
|------|--------|------|
| Tool Registry + Proficiency | P0 | 工具注册和熟练度追踪 |
| CompetencyModel (slot-based) | P0 | 能力模型的读写 |
| Task → Lesson extraction | P0 | 任务完成后自动提取教训 |
| Knowledge ingestion (text + image) | P1 | 基础多模态知识管理 |
| SessionStart context injection | P1 | 会话开始时的上下文加载 |
| Post-task learning event generation | P1 | 任务完成后的自动学习 |
| `/praxis status` command | P1 | 用户可见的能力查看 |
| Autonomy decision (basic) | P2 | 基于熟练度的自主性建议 |
| SessionEnd reflection | P2 | 会话结束时的反思和状态保存 |
| Mental state continuity | P2 | 跨会话"思维状态"传递 |

**V1 明确排除 (目标后续版本)**:
| 组件 | 目标版本 |
|------|---------|
| 音频/视频实时转写 | V2 |
| 实时事件流处理 | V2 |
| 跨工具复杂工作流引擎 | V3 |
| 多实例 mesh sync | V3 |
| 演化叙事自动生成 | V3 |
| 自我驱动学习请求 | V3 |
| GUI 能力模型查看器 | V4 |

---

> **V1 基础架构完成。** 核心概念确立: 六层架构、工具注册与熟练度追踪、能力模型、学习闭环、自主性策略、AgentMemory 持久化、多模态知识管理、多实例部署。等待 V2 迭代。
