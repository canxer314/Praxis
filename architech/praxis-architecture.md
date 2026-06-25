# Praxis 架构设计

> **当前迭代**: V13 (完整认知引擎)  
> **架构状态**: 设计完成，部分实现（见末尾实现对照）  
> **设计哲学**: 每个版本聚焦一个核心问题角度，有增有减，非全量替换

---

## 〇、阅读指引：V1→V13 的迭代本质

Praxis 的 13 个版本不是 13 次"推翻重做"。每个版本从一个特定的核心问题出发，在已有架构上增加新维度，同时删除被新约束证明不必要的部分。

理解 Praxis 的关键不是记住每个版本加了什么，而是理解**每个版本试图回答的那个核心问题**，以及**它为什么在那个时间点成为最重要的角度**。

```
V1   "AI 需要什么认知架构？"           → 六层分类法诞生
V2   "这个架构跑在哪里？"              → 载体选择（OpenClaw）
V3   "学什么？谁发起学习？"            → 从被动工具学习到主动多维学习
V4   "下一步该干什么？"                → 从任务执行到过程驱动
V5   "框架本身有问题怎么办？"          → 元层面的结构自演化
V6   "完全陌生怎么办？"                → 零先验的认知从零构建
V7   "怎么把设计变成代码？"            → 工程落地——Context Orchestration Layer
V8   "token 不稀缺了怎么办？"          → 删除 token 妥协,引入独立验证
V9   "token 又不够了怎么办？"          → 压力自适应,优雅降级
V10  "现在在做什么任务？"              → 任务级认知感知
V11  "知识怎么变成行动？"              → 结构化知行闭环
V12  "任务怎么编排？"                  → 状态机驱动的主动认知引擎
V13  "谁推动这一切？"                  → 完全主动驱动
```

每个版本的细节见下文。注意每个版本都有"增加"和"删减/重新审视"两栏——这是理解架构完整性的关键。

---

## V1: 核心架构 — "AI 需要什么认知架构？"

**核心问题**: 如果给一个无状态的 LLM 装上"记忆和学习能力"，它需要哪些组成部分？

### V1 新增

**六层架构**（自底向上）:

```
L6: 自主决策层 (Autonomy Engine)
    • 跨工具的自主性判断 — proficiency × risk → action
L5: 能力模型层 (Competency Manager)
    • 多维度技能树（领域 × 工具 × 熟练度）
L4: 学习闭环层 (Learning Engine)
    • 统一的 执行→评估→差距→更新→固化 循环
L3: 知识管理层 (Knowledge Manager)
    • 多模态知识摄入 + 工具特定知识库 + 关联索引
L2: 任务编排层 (Task Orchestrator)
    • 复杂任务→子任务→工具调用序列 + 错误恢复
L1: 工具与集成层 (Tool Registry)
    • 工具注册、发现、反馈解释器
```

**核心数据模型**（6 个）:
- `Tool` — 工具注册（id, interface, feedback signals, risk 评估）
- `Task` — 任务追踪（assignment, execution, outcome, lessons）
- `Knowledge` — 知识条目（source, modality, organization, confidence）
- `LearningEvent` — 学习事件（type, impact on skills, evidence）
- `CompetencyModel` — 能力模型（skill_tree, composite_skills, working_style）
- `AutonomyPolicy` — 自主性策略（proceed/inform/confirm/block 决策）

**4 种记忆类型**: Episodic（情景）| Procedural（程序）| Semantic（语义）| Metacognitive（元认知）

**学习闭环（3 阶段）**: task_receive（任务前评估+记忆注入）→ task_execute（捕获修正信号）→ session_end（学习提取+持久化）

**Result\<T\> 模式**: 所有异步 API 返回 discriminated union，不用 try-catch。

**AgentMemory 集成**: 21 种存储映射（slot/save/search/lesson/pattern/reflect 等）。

**V1 范围边界**: 明确包含 12 项，明确排除 7 项（音频/视频实时转写、跨工具工作流、多实例 mesh sync、自我驱动学习等——目标 V2-V4）。

### V1 的局限（被后续版本识别的）

V1 回答的是"应该有什么部件"。它没有回答：这些部件在哪里运行、如何运行、数据怎么流转、以及——这些部件之间的关系是什么。V1 是分类法，不是架构。

---

## V2: 架构载体 — "这个架构跑在哪里？"

**核心问题**: V1 假设自建 Harness。但现实中已经有 OpenClaw（开源 Agent 框架）、Hermes（PI 桌面自动化）等候选载体。Praxis 应该作为独立系统还是寄生在现有框架中？

### V2 新增

**架构载体决定**: Praxis 作为 **OpenClaw Memory Plugin** 运行。原因：PI 桌面自动化场景太窄；Hermes 有独立学习循环与 Praxis 冲突；OpenClaw 开源、Plugin 成熟、MCP 原生、Hook 完整、无学习循环重叠。

**三层模型（Praxis 的核心拓扑）**:
```
AgentMemory (大脑皮层, 持久存储)
    ↕ MCP
Praxis (心智模型, 学习+决策)
    ↕ Hook
OpenClaw (身体, 工具执行+Agent调度+通信)
```

**5 个核心 Hook 映射**:
| Hook | 职责 | 返回值 |
|------|------|--------|
| `session_start` | 加载能力模型+工具注册表+思维状态 → 注入 system prompt | prompt 注入 |
| `before_tool_call` | proficiency × risk → autonomy 决策 | proceed/inform/confirm/block |
| `after_tool_call` | 匹配 feedback signals → 检测学习事件 | 追踪记录 |
| `agent_end` | 汇总工具调用 → 学习循环 → 更新能力模型 | TaskTrace 持久化 |
| `session_end` | 反思 + 模式检测 + mental_state 保存 | 状态快照 |

**AutonomyPolicy 决策映射**: 将 V1 的抽象策略映射到 OpenClaw 可执行指令。

**新增数据类型**: ToolProficiency（工具来源追踪）、TaskTrace（调用链追踪）、会话内缓存策略（session_start 批量加载→内存操作→session_end 批量写回）。

### V2 的删减/重新审视

**删除**: V1 的"自建 Harness"假设。V1 设计了独立的消息通道、自建 Hook 系统、Claude Code 特定集成——这些全部被 OpenClaw Plugin 模式替代。

**保留**: V1 的六层架构、数据模型、学习闭环——全部保留，只是运行载体变了。

### V1→V2 的关键差异

| V1 自建 | V2 使用 OpenClaw |
|---------|-----------------|
| Tool Registry（自建数据模型） | Tool Registry（OpenClaw 工具列表 + Praxis 元数据叠加） |
| Claude Code Harness Hooks | OpenClaw Plugin Hook System |
| Claude Code Slash Commands | OpenClaw Plugin Commands |
| 自建消息通道 | OpenClaw 20+ 消息通道 |

---

## V3: 多维学习 + 主动好奇心 — "学什么？谁发起学习？"

**核心问题**: V2 把学习简化为"工具调用的成功/失败反馈"。但一个大学毕业生在工作中成长时，学到的远不止"怎么用咖啡机"。V3 追问：学习的真正对象是什么？学习应该是被动的还是主动的？

### V3 新增

**4D 能力模型**（V2 的 1D 工具熟练度→V3 的 4D）:
| 维度 | 内容 | 示例 |
|------|------|------|
| `tool_skills` | 每工具熟练度（V2 保留） | coffee: 0.72 |
| `domain_familiarity` | 业务领域理解度 | 膜力云水务: 0.65 |
| `task_type_proficiency` | 任务类型熟练度 | 周报制作: 0.80 |
| `user_model_confidence` | 用户偏好/风格了解度 | 沟通风格: 0.75 |

**Curiosity Engine（4 阶段）**: Gap Detection → Prioritization（relevance×frequency×impact×urgency）→ Action Generation（Level 0-3）→ Question Governance（频率/质量/静默时段限制）。

**5 种学习事件**（V2 的 1 种→V3 的 5 种）: mistake_correction | domain_insight | preference_discovery | task_pattern_recognition | procedural_optimization

**5 种知识类型**: domain_knowledge | task_pattern | user_model | procedural_knowledge | tool_knowledge

**message_received Hook（第 6 个）**: 语义意图分析 — teaching_mode / correction_mode / preference_expression / task_evaluation / gap_signal

**双向交互**: Praxis 可通过 OpenClaw 通道主动向用户提问（受治理策略约束）。

### V3 的删减/重新审视

**重新审视**: V2 的"被动学习"假设。V2 认为所有学习由 Hook 事件驱动（用户纠正→Praxis 响应）。V3 引入了内部驱动的 Curiosity Engine——不依赖 Hook，在 agent_end / session_end 主动运行。

### V3 的设计洞察

> V2 的 AI 像一个好用的工具——你教它，它学会，下次做得更好。  
> V3 的 AI 像一个有心气的新人——它不仅学会你教的，还会自己发现自己哪里不懂，在你不忙的时候带着具体问题来请教。

---

## V4: 过程驱动 — "下一步该干什么？"

**核心问题**: V3 让 Praxis 知道"学什么"。但任务不是孤立的工具调用序列——任务是过程网络，涉及多个角色、有等待和阻塞、需要推动和升级。V4 追问：Praxis 如何管理"工作流"而非"工具链"？

### V4 新增

**Process Engine（过程引擎）**: 嵌入 L2（任务编排层），将 V3 的工具链任务模型升级为过程网络模型。

```
ProcessTemplate → ProcessInstance → ProcessStep
    "流程模板"       "流程实例"       "流程步骤"
  "软件开发流程       "用户管理模块      "架构设计这个
   应该怎么走"       开发现在走到哪"    步骤的具体情况"
```

**三种步骤类型**: `self`（Praxis 自己做）| `delegated`（找协作者做）| `collaborative`（混合——Praxis 组织+协作者参与）

**步骤状态机**: `pending → ready → in_progress → completed` / `blocked → waiting → nudge → escalated`

**Role Model（角色模型）**: 嵌入 L3（知识管理），将 V3 的单 UserModel 扩展为多角色注册表——RoleRegistry、角色关系图（谁对谁有依赖、谁能批准谁）、沟通适配。

**Momentum Engine（推动引擎）**: 对称于 V3 的 Curiosity Engine。Curiosity Engine 管理"知识缺口"→ Momentum Engine 管理"过程阻塞"。

```
阻塞检测 → 推动策略决策树:
  wait → nudge (催办, 最多 N 次) → escalate (升级给用户)
  → bypass (绕过, 找替代角色) → abandon (放弃, 记录原因)
```

**Action Verification Loop（5 维验证）**: 步骤决策正确性 | 角色路由准确性 | 时机适当性 | 沟通适配性 | 流程效率

**cron_tick Hook（第 7 个）**: 时间驱动的定期扫描。扫描活跃 ProcessInstance → 检查等待超时 → 触发 Momentum Engine。

**4D→6D 能力模型**: 新增 `process_management`（管理过程、推动步骤、处理阻塞）和 `action_reliability`（行动决策的可信度）。

### V4 的删减/重新审视

**重新审视**: V1-V3 隐含的"任务=工具调用序列"模型。V4 指出任务是过程网络，涉及人、等待、阻塞、推动——这些不是工具调用能覆盖的。

### V4 的设计洞察

> V3 让 Praxis 知道"学什么"。V4 让 Praxis 知道"下一步该干什么"——不是调哪个工具，而是推动什么、找谁推动、卡住了怎么办。

---

## V5: Meta Layer — "框架本身有问题怎么办？"

**核心问题**: V1-V4 的架构假设六层分类法和学习策略本身是正确的。但如果框架本身有缺陷呢？V5 引入 Meta Layer——一个不对任务做处理的侧观察者，专门监控子系统是否存在**结构性不足**（框架本身的缺陷，而非知识缺口）。

### V5 新增

**StructuralGap vs KnowledgeGap 区分**:
| 类型 | 定义 | 处理引擎 |
|------|------|---------|
| `KnowledgeGap` | "我不知道 X"（信息缺口） | Curiosity Engine (V3) |
| `StructuralGap` | "我对这类问题的思考框架本身是错的"（框架缺陷） | Meta Layer (V5) |

**5 种 StructuralGap 检测信号**: 模板匹配度下降 | 跨场景行动验证得分低 | 用户挫败模式 | 认知边界停滞 | 升级模式异常

**Cognitive Structure Registry**: 带版本的历史注册表。生命周期: `hypothesized → candidate → experimental → crystallized → deprecated/rejected`。每个结构有独立版本链、验证实验记录、置信度追踪。

**三种铁律**:
1. 无新结构不经过人类审批 — 不可自动创建
2. 实验必须有范围限制 — 不能无限实验
3. 任何结构可回滚 — 保留所有历史版本

**10→15 种学习事件**: 新增 structural_inadequacy_detected, structure_constructed, structure_validated, structure_regression, governance_override

### V5 的删减/重新审视

**重新审视**: V1-V4 隐含的"框架自身是真理"的假设。V5 是在架构上开了一个"自检"的维度。

### V5 的设计洞察

> V5 不是增加新功能——它是增加了"对功能本身的质疑能力"。正如海德格尔区分"存在"和"存在者"，V5 区分"认知结构"（学到的具体知识）和"认知框架"（学到知识的能力本身是否有缺陷）。

---

## V6: Proto-Cognitive Engine — "完全陌生怎么办？"

**核心问题**: V5 的 StructuralGap 检测需要部分模板匹配作为锚点（需要已有结构才能检测"结构出了问题"）。但如果适应度 = 0——完全陌生，没有任何模板——怎么办？V6 去除该要求，从零构建认知。

### V6 新增

**Proto-Cognitive Engine 四阶段**:

**Phase 1: Open Perception（开放感知）** — 标记 SalientElements（不分组、不分类）。信号: 重复、用户强调、序列位置、用户纠正、新奇度。

**Phase 2: Proto-Structure Construction（原型构造）** — 从共现对形成模糊概率原型。4 种类型:
| 结构类型 | 初始置信度 | 说明 |
|---------|----------|------|
| `ProtoSequence` | 0.30 | 模糊的行为序列假设 |
| `ProtoRole` | 0.35 | 模糊的角色关系假设 |
| `ProtoConcept` | 0.25 | 模糊的概念定义假设 |
| `ProtoPurpose` | 0.25 | 模糊的目标意图假设 |

**Phase 3: Interactive Validation（交互式验证）** — 场景复现→激活原型→做预测→对比现实。置信度更新公式: 成功 +0.1×(1-conf) / 失败 -0.2×conf / 用户纠正 -0.4×conf。

**Phase 4: Crystallization/Degradation** — 固化（conf>0.8+观察≥5→CandidateStructure）和退化（>3个反例→衰退为 ProtoStructure、conf<0.2+60天→标记 degraded）。

**预测协议**: LLM 在输出中用 `[PREDICTION_CONFIRMED: proto_id]` / `[PREDICTION_FAILED: proto_id, reason]` / `[PREDICTION_UNCERTAIN: proto_id, reason]` 标记。

**信息演化管线**: `Raw Observation → SalientElement → ProtoStructure (概率) → CandidateStructure → CrystallizedStructure`。任意阶段可衰退。

**6D→8D 能力模型**: 新增 `proto_cognition` 维度（AI 在完全陌生环境中从零构建认知的能力）。

**Layer Self-Modification**: V5 允许添加/修改 CognitiveStructures。V6 允许修改层定义、层边界甚至 Meta Layer 本身（需人类治理，逐级审批）。

### V6 的删减/重新审视

**重新审视**: V5 的"必须有锚点才能检测缺陷"的假设。V6 证明即使没有锚点，从开放感知开始也可以构建认知。

### V6 的设计洞察

> V5 需要一面镜子才能看到自己的缺陷。V6 问：如果连镜子都没有呢？答案是：从零开始打磨自己的镜子。ProtoStructure 的 4 种类型（Sequence/Role/Concept/Purpose）成为后续所有版本的认知基本单元——这是 V6 对整个架构最深远的贡献。

---

## V7: 工程落地 — "怎么把设计变成代码？"

**核心问题**: V1-V6 的"六层架构"是设计概念，不是代码模块。V7 进行第一次工程映射，并在此过程中发现了一个本质洞察。

### V7 新增

**核心洞察——Context Orchestration Layer**: Praxis 不是传统 AI 系统。所有"认知操作"的底层实现 = Hook 回调函数 + LLM Prompt 调用 + AgentMemory 数据读写。**Praxis 的本质是一个上下文编排层**——在正确的时间，以正确的格式，将正确的结构化记忆注入 LLM 的上下文窗口。质量上限 = LLM 质量 × 上下文构建质量。

**第一个具体模块树**:
```
openclaw/src/plugins/praxis-plugin/
├── hooks/          (6 个 Hook 处理函数)
├── orchestration/  (场景匹配、上下文构建、原型构造、模式检测、置信度更新)
├── analysis/       (transcript 分析、显著性标记、预测协议、衰退检查)
├── memory/         (AgentMemory 客户端、查询、schema、slot)
├── prompts/        (system/、analysis/、user/ 三级 prompt 模板)
├── types/          (memory.ts、scene.ts、hooks.ts)
└── tests/
```

**场景匹配器 (scene-matcher)**: 分类用户当前交互场景 → 决定注入哪些认知结构。

**上下文构建器 (context-builder)**: 4 种注入策略 — `exact`（全量,~1000t）| `fuzzy`（摘要,~300t）| `weak`（名称列表,~100t）| `zero_prior`（开启 Open Perception）。

**性能预算**: message_received < 50ms（只做轻量标记）/ session_end < 20s（批量 LLM 调用）/ 系统提示注入 < 1000 tokens。

### V7 的删减/重新审视

**工程缺陷分析（10 个缺陷，3 类根因）**:

V7 在工程落地过程中，诚实地识别了设计中的 3 类根本缺陷：
1. **验证真空**: LLM 标记→LLM 归纳→LLM 审计。无独立地面真值。
2. **接地脆弱性**: 正则+关键词匹配不能可靠捕获语义显著性。
3. **人工依赖**: 学习循环在多个节点需要人类介入，无降级路径。

这些缺陷不是 V7 的 bug——它们是 V7 对 V1-V6 设计假设的诚实检验结果。它们成为 V8-V9 的核心驱动力。

### V7 的设计洞察

> V7 是 Praxis 从"认知设计"到"工程系统"的转折点。Context Orchestration Layer 的定义——"在正确时间、以正确格式、将正确信息注入 LLM 上下文"——从 V7 起成为所有后续版本的基础假设。

---

## V8: 1M 上下文重架构 — "token 不稀缺了怎么办？"

**核心问题**: V7 假设 token 极度稀缺（注入预算 ~1000 tokens）。但如果上下文窗口是 1M tokens 呢？V8 重新审视 V7 在 token 稀缺约束下做的所有妥协。

### V8 新增

**统计验证器（打破 LLM 自循环）**: V7 最严重的缺陷是"LLM 标记→LLM 归纳→LLM 审计"的自循环。V8 的统计验证器提供**第一个不依赖 LLM 的验证信号**——从 ProtoSequence 提取预测的工具映射，与 AgentMemory 中记录的实际工具调用序列进行模糊匹配。匹配成功→statistical 信号=1.0，失败→0.0。与 LLM 标记独立——一致则高置信度，矛盾则偏信统计。

**上下文组织器 (Tier A/B/C)**: 替代 V7 的选择性注入:
- Tier A: 当前场景结构 → 全量详情 + 置信度校准
- Tier B: 相关场景结构 → 摘要 + 引用
- Tier C: 不相关场景结构 → 名称 + 一行描述

**Transcript Analyzer（端到端）**: 合并 V7 的 proto-constructor + pattern-detector → 一次端到端 LLM 调用。完整对话记录 → 直接输出 SalientElement + ProtoStructure。消除 PMI 预过滤的信息损失。

**置信度融合器**: 替代 V7 的单一 confidence-updater。多源融合: statistical + llm_marker + user_correction。初始权重: statistical 0.30, llm_marker 0.30, user_correction 0.15。

**AgentMemory 降级缓存**: 7 天 TTL 文件缓存。AgentMemory 不可用时自动降级→恢复后自动同步。

### V8 的删减（关键的减法）

| V7 模块 | V8 状态 | 原因 |
|---------|--------|------|
| `salience-marker.ts` | ❌ 删除 | 正则预标记——token 够用，全量 transcript 给 LLM |
| `pattern-detector.ts` | ❌ 删除 | PMI 预过滤——token 够用，且导致信息损失 |
| `scene-matcher.ts` 的选择性注入 | ❌ 删除 | 全量注入下不需要"选择"——Tier A/B/C 替代 |
| `context-builder.ts` 的 token 预算策略 | ❌ 删除 | 从"选择性注入"转为"组织性注入" |
| `confidence-updater.ts` | ❌ 替换为 confidence-fuser | 从单一公式变为多源融合 |

**保留**: scene-matcher 的场景识别功能（非选择性注入功能）→ 重新定位为 `scene-recognizer.ts`。

**净效应**: 模块数 -3 +5 = 净增 2 模块，但实现周期从 4-5 月缩减到 3 月（因复杂度删除）。

### V8 的设计洞察

> V8 的深层教训不是"1M tokens 好"，而是"审视你的架构中有多少是来自约束而非本质"。V7 近一半模块是 token 稀缺的产物——它们不该存在。

---

## V9: 上下文压力自适应 — "token 又不够了怎么办？"

**核心问题**: V8 假设 1M tokens 够用。但在复杂连续任务中，非 Praxis 消耗可达 600K-900K tokens（代码、工具输出、长对话历史）。Praxis 的注入可能成为压垮骆驼的最后一根稻草。V9 解决"当 V8 的假设再次被打破时怎么办"。

### V9 新增

**四级压力自适应**:
| 级别 | 利用率 | Praxis 注入量 | 策略 |
|------|--------|-------------|------|
| Normal | < 60% | ~30K tokens | Tier A/B/C 全量 |
| Elevated | 60-75% | ~16K | Tier A 全量 + Tier B 压缩 + Tier C 移除 |
| High | 75-90% | ~3.5K | Tier A 摘要仅 |
| Critical | > 90% | ~1K | 仅结构索引 + recall_structure 工具注册 |

**Lazy Loading (Critical 压力下)**: LLM 获得结构索引 + `recall_structure` 工具。LLM 需要时主动调用 `recall_structure("门诊流程")`。Push（Praxis 主动注入）→ Pull（LLM 按需拉取）混合。

**注意力遥测**: LLM 标记 `[STRUCTURE_USED: proto_id]` 当实际引用结构时。追踪每个结构的采纳率。发现"僵尸结构"（高置信度但从未被 LLM 实际使用）。

**角色/概念独立验证器**: Role Verifier（比较 ProtoRole 定义的行为与实际工具调用者模式）+ Concept Verifier（对抗 prompt——"尝试找反例"）。

**结构生命周期管理**: 一致性检查器 + 配置自适应 + 衰退检测 + 架构审计。

**3 源→5 源置信度融合**: 新增 role_verifier (0.15) 和 concept_verifier (0.10)。

### V9 的删减/重新审视

**重新审视**: V8 的"全量注入总是可行的"假设。V9 恢复了选择性——但不是 V7 的"只注入匹配度最高的"，而是"注入全部，但压缩深度"——即使在 Critical 下，LLM 仍知道所有结构存在（通过索引+Lazy Loading）。这是 V7 选择性注入和 V9 自适应压缩的关键区别。

### V9 的设计洞察

> V9 在 V7（token 稀缺→选择性注入）和 V8（token 充裕→全量注入）之间找到了第三条路：全量但自适应深度。LLM 始终知道"有哪些结构"，只是"知道多少细节"随压力变化。

---

## V10: 任务级认知 — "现在在做什么任务？"

**核心问题**: V1-V9 的 Praxis 知道所有场景模式，但不知道"当前在做什么项目"。场景是横向的（"门诊流程"是一个场景），任务是纵向的（"构建医院管理系统"是一个任务，跨越多个场景）。V10 填补这个 gap。

### V10 新增

**TaskContext（~200 tokens，极轻量）**:
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

**session_end 自动进度推断**: LLM 分析 transcript→推断进度变化→置信度 < 0.7 不自动更新→用户可覆盖。

**任务感知优先级排序**: Tier A 排序从"纯场景匹配度"变为 `场景匹配度 × 0.60 + 任务相关性 × 0.40`。

**ProtoTask（Phase 2+, 可选）**: 从多次同类项目中学习任务模式。V10 仅概念设计，V11 升格为 Phase 1 核心。

### V10 的删减/重新审视

**重新审视**: V1-V9 的"场景=认知的基本单位"假设。V10 指出任务和场景是两个正交维度——任务是纵向时间轴（项目阶段），场景是横向分类（活动类型）。两者都需要建模。

---

## V11: 知行合一闭环 — "知识怎么变成行动？"

**核心问题**: V10 的知识只能以 prompt 文本注入 LLM。但执行层（planning-with-files 的任务计划、OpenClaw 的调度策略）不能消费 prompt 文本。V11 建立四个结构化接口，使知识可被执行层消费。

### V11 新增

**四个结构化接口**:

| 接口 | 方向 | 功能 |
|------|------|------|
| KnowledgeQuery | Praxis→执行层 | planning-with-files 查询 Praxis 获取 ProtoTask 阶段模板/陷阱 |
| GuidanceSignal | Praxis→LLM/OpenClaw | 类型化信号（phase_suggestion, pitfall_warning, structure_recommendation, contradiction_alert, confidence_advisory）+ severity + 建议行动 |
| OutcomeFeedback | 执行层→Praxis | 子任务成败 → 置信度调整 ±0.05 + ProtoTask 阶段时长修正 |
| MidSessionLearner | LLM 交互→Praxis | 会话中实时矛盾检测（用户纠正 + 工具模式违反）→即时置信度下调 |

**ProtoTask 升格为 Phase 1 核心**: 从 V10 的"可选，>=3 项目触发"升格为"Phase 1 核心交付"。Bootstrap 机制（零样本 LLM 通用知识，置信度 0.2）。随项目积累成长: 0→0.2, 1→0.3, 3→0.5, 5→0.65, 10→0.8。

**5 源→7 源置信度融合**: 新增 outcome_feedback (0.10) 和 mid_session (0.08)。

### V11 的删减/重新审视

**重新审视**: V10 的"开环注入"假设。V10 认为"知识注入 prompt = 完成了知识传递"。V11 指出开环注入不够——知识需要结构化才能被非 LLM 组件（planning-with-files、OpenClaw 调度器）消费，执行结果需要结构化才能反馈到认知系统。

---

## V12: 主动认知引擎 — "任务怎么编排？"

**核心问题**: V11 的四个外部接口存在是因为画错了 Praxis 与 planning-with-files 的边界。planning-with-files 是一个 SKILL.md prompt 模板，不是架构组件。V12 拆除这个错误边界——Praxis 直接做任务分解。

### V12 新增

**两层嵌套状态机**:

外层循环（任务级，7 状态）: `TASK_NOT_STARTED → TASK_ASSESSING → TASK_PLAN_GENERATING → TASK_IN_PROGRESS → TASK_VERIFYING → TASK_ITERATING → TASK_COMPLETE / TASK_ABANDONED`

内层循环（子任务级，4 状态+中间态）: `SUBTASK_PENDING → SUBTASK_ACTIVE → SUBTASK_COMPLETING → SUBTASK_VERIFIED / FAILED`。中间态: `SUBTASK_BLOCKED`（用户纠正/工具违反 3+ 次时触发）。

**plan-generator**: `getProtoTaskTemplate(task_type) → ProtoTask → PlanDocument`（含 phases, subtasks, criteria, guidance）。

**verifier（5 种验收标准）**:
| 类型 | 自动化 | 示例 |
|------|--------|------|
| `command_output` | 自动 | `npm test -- --testPathPattern=X` → 匹配输出 |
| `file_existence` | 自动 | 检查文件是否存在 |
| `test_pass` | 自动 | 运行测试套件 |
| `llm` | 半自动 | LLM 审查代码/文档 |
| `user_approval` | 手动 | 安全/部署类操作 |

**pitfall-tracker**: 子任务失败→关键词匹配 ProtoTask.common_pitfalls→命中反馈（ProtoTask.confidence +0.02）→误报率控制（>30% 自动降 severity）。

**plan-file-writer**: 生成 task_plan.md / progress.md / findings.md（兼容 planning-with-files 格式）。

### V12 的删减（关键的减法）

| V11 组件 | V12 状态 | 说明 |
|---------|--------|------|
| KnowledgeQuery | 内部化 | 接口不再暴露给外部——plan-generator 内部调用 |
| GuidanceSignal | 内部化 | 嵌入 PlanDocument 的 PhaseGuidance 字段 |
| OutcomeFeedback | 内部化 | task-orchestrator 内部 processSubtaskOutcome() |
| planning-with-files 的"任务分解"功能 | 移除 | 迁移到 plan-generator |
| planning-with-files 的"进度跟踪"功能 | 移除 | 迁移到 progress-tracker |

**保持独立的模块**: MidSessionLearner（LLM 交互在 Praxis 外部，无法内部化）。

**planning-with-files 降格**: 从"任务编排者"降格为"文件持久化工具"（保留 Hook 脚本和 SHA-256 验证，移除任务分解/计划模板/进度跟踪）。

### V12 的设计洞察

> V12 不是增加功能——它是纠正了一个架构边界错误。planning-with-files 从来不应该做任务分解——它是一个 prompt 模板。真正的任务编排引擎应该（而且必须）在 Praxis 内部。V12 外部接口从 4 个减少到 1 个，模块数从 32 简化到 29（+6 新, -3 移）。

---

## V13: 完全主动引擎 — "谁推动这一切？"

**核心问题**: V12 的状态机完整但被动——它等待 Hook 事件（session_start, message_received）来推进状态。谁决定"该开始下一个子任务了"？V13 激活 OpenClaw 预留的所有主动驱动能力。

### V13 新增

**四大核心能力最终形成**:
1. **Memory（持久化）** — AgentMemory: 所有认知结构、任务状态、学习历史的持久存储
2. **Learning（学习）** — Proto-Cognitive Engine + Curiosity Engine + 置信度融合 + MidSessionLearner
3. **Orchestration（编排）** — 两层嵌套状态机 + plan-generator + verifier + pitfall-tracker
4. **Drive（驱动）← V13 新增** — 主动调度 + 子 Agent 管理 + 心跳监控

**Task Scheduler**: session_end 触发决策矩阵 — 自主驱动启用？静默时段？每日触发限制？→ 决定机制: subagent_run（可并行子任务）| scheduleSessionTurn（< 1h / 1-24h）| cron_job（> 24h）。

**Subagent Manager**: spawnSubagent()→waitForCompletion()→retrySubagent()→aggregateResults()。最大并行度 3。子 Agent 上下文: 子任务定义 + 陷阱预警 + 验收标准（无父对话历史）。失败隔离: 一个子 Agent 失败不影响其他。

**Heartbeat Monitor**: 每 5 分钟检测子任务停顿。Level 1 (nudge): 注入提醒到活跃会话 → Level 2 (wake): requestHeartbeat() 主动唤醒 → Level 3 (escalate): markSubtaskBlocked() + 推进外循环。

**5 种 Trigger 全部激活**: hook:session_start (V12) + hook:session_end (V12) + cron:scheduled (V13) + subagent:completed (V13) + heartbeat:wake (V13)。

**自主学习触发**: cron 分析 task_history→达到 min_observations→自动构造 ProtoTask。置信度 plateau 检测（3 次观察无提升）→请求更多同类任务。能力模型定期审计→识别停滞技能→生成学习建议。

**跨 Agent 认知同步**: 子 Agent session_end→写入 ProtoStructure 更新（乐观锁+version 号）→父 Agent session_start 读取最新版本。

### V13 的删减/重新审视

**状态机零修改原则**: V13 不修改 V12 状态机的一行代码。`advanceOuterLoop()` 保持不变。仅新增触发调用点——V12 的被动编排和 V13 的主动驱动是同一状态机的两种驱动模式。

**净增 < 530 行代码**: V13 的驱动层很薄——它只是调度和触发的逻辑，真正的"做事"仍然在 V12 的状态机中。

### V13 的设计洞察

> V13 完成了 Praxis 从"被动的记忆系统"到"主动的认知操作系统"的转变。但关键的设计克制是：驱动层不修改编排层。V12 的状态机是真理——V13 只是给真理安上了引擎。

---

## 最终整合: V13 完整架构

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
│   ├── analysis/ (extract-and-update, construct-proto-task, generate-plan, 
│   │              verify-progress, consistency-scan, audit-architecture)
│   └── user/ (perception-summary, crystallization-proposal)
│
├── types/                                   # 类型定义
│   └── memory.ts / scene.ts / hooks.ts
│
└── tests/
```

### AgentMemory 集成 (V13 最终版)

| Slot 名 | 内容 | 大小 | 版本引入 |
|---------|------|------|---------|
| `competency_model` | 8D 能力模型 | < 50KB | V1 |
| `autonomy_policy` | 自主性策略 | < 10KB | V1 |
| `tool_registry` | 工具注册表 | < 20KB | V1 |
| `task_context` | 任务上下文 | < 1KB | V10 |
| `task_orchestration_state` | 编排状态机状态 | < 10KB | V12 |
| `task_plan` | 计划文档 + markdown | < 20KB | V12 |
| `progress_log` | 进度事件 (最近 100 条) | < 5KB | V12 |
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

---

## 跨版本设计主题（正交于版本迭代的演化线索）

以下线索不是"某个版本引入"的——它们在多个版本中逐步浮现和强化。

### 线索 1: 从原子化到关系化

```
V1: {tool_id → proficiency} 独立映射
V3: 4D 能力模型（4 个独立维度）
V5: Cognitive Structure Registry（版本链）
V6: ProtoStructure（4 种类型，但仍独立）
V8: 置信度融合（多源→单一置信度，但结构仍独立）
→ 缺口: 没有 StructureDependencyGraph。一个结构被推翻后，依赖它的结构不受影响。
```

### 线索 2: 从被动到主动

```
V1-V2: 纯被动（用户教导→Praxis 记录）
V3: 主动好奇心（Curiosity Engine，AI 主动提问）
V4: 主动推动（Momentum Engine，AI 催促进度）
V11: 主动指导（GuidanceSignal，AI 给出结构化的行动建议）
V13: 主动驱动（TaskScheduler, SubagentManager, Heartbeat——AI 自己决定下一步）
```

### 线索 3: 从事后检测到事前约束

```
V6: 预测协议（LLM 犯错后标记 [PREDICTION_FAILED]）
V8: 统计验证器（独立于 LLM 的事后验证）
→ 缺口: OntologicalConstraintLayer。没有在 LLM 生成前注入硬约束。
```

### 线索 4: 从单一范畴到范畴演化

```
V6: 4 种 ProtoStructure 类型（固定，从未被质疑）
V9: ConsistencyChecker（在检测约束违反，但约束本身不被建模）
→ 缺口: Meta Layer 不审计"为什么是这 4 种类型？有没有第 5 种？"
```

### 线索 5: 从 token 稀缺到注意力稀缺

```
V7: token 极度稀缺（~1000 tokens 预算）→ 选择性注入
V8: token 充裕（1M 上下文）→ 全量注入 + Tier 排序
V9: 注意力稀缺（窗口大但有效关注度有限）→ 自适应压缩深度
→ 缺口: 粒度控制仍是纯量化的（按 token 数）。认知成熟度未被纳入粒度决策。
```

### 线索 6: 从"场景"到"任务+场景"双轴

```
V1-V9: 场景是认知的基本单位
V10: 任务（纵向时间轴）和场景（横向分类）是两个正交维度
→ 缺口: 跨场景语义消歧（同形异义词在不同场景中的含义不同）
```

---

## 版本追溯矩阵

| 特性 | V1 | V2 | V3 | V4 | V5 | V6 | V7 | V8 | V9 | V10 | V11 | V12 | V13 |
|------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|
| 六层架构设计概念 | ✅ | M | 增强 | 增强 | 增强 | 增强 | E→模块 | E | E | E | E | E | E |
| OpenClaw Plugin 形态 | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
| 三层模型 (AM↔Praxis↔OC) | — | ✅ | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 | 保留 |
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

> 图例: M=修改, E=增强/演进, I=内部化, R=架构就绪, P0/P1/P2=优先级

---

## 当前实现状态（2026-06-25）

以上为完整架构设计。当前代码库 (`src/cognitive/`, v0.7.2.0) 的实现覆盖情况:

### 已实现（7/34 特性）

| 特性 | 版本 | 实现模块 |
|------|------|---------|
| 学习闭环（1 种事件） | V1 | `learning-loop.ts`, `metacognitive-engine.ts` |
| 两层嵌套状态机 | V12 | `task-state-machine.ts` |
| ProtoTask bootstrap | V11 | `proto-task.ts` |
| TaskScheduler | V13 | `task-scheduler.ts` |
| SubagentManager | V13 | `subagent-manager.ts` |
| HeartbeatMonitor | V13 | `heartbeat-monitor.ts` |
| Scene Recognizer | V7 | `scene-recognizer.ts` |

### 部分实现（5/34 特性）

| 特性 | 状态 |
|------|------|
| 六层架构 | 概念存在于 CognitiveCore 中，但未形式化分层 |
| 能力模型 | 停在 ~2D（domainProficiencies + inferredPreferences），未达 8D |
| 自主性策略 | 类型接口定义存在，决策引擎不存在 |
| TaskContext | proto-task.ts 实现了 3/8 字段 |
| 跨 Agent 认知同步 | subagent-manager 有基础上下文构建，但无乐观锁+version 同步 |

### 未实现（22/34 特性）

包括但不限于: OpenClaw Plugin 形态、Curiosity Engine、Process Engine、Meta Layer、Proto-Cognitive Engine (含 4 种 ProtoStructure 数据模型)、预测协议、统计验证器、Tier A/B/C 上下文组织、置信度融合(多源)、四级压力自适应、注意力遥测、GuidanceSignal、MidSessionLearner、plan-generator、verifier、pitfall-tracker、自主学习触发。

**最关键的缺失**: ProtoStructure 的 4 种类型（Sequence/Role/Concept/Purpose）数据模型不存在。它是 V7-V12 所有认知操作的操作对象。没有 ProtoStructure，Context Orchestration Layer 没有"内容"可编排。

### 当前代码结构 (实际)

```
src/
├── cognitive/
│   ├── index.ts                 # 公共 API 导出
│   ├── cognitive-core.ts        # 主入口 + Session 隔离
│   ├── governor.ts              # [Phase 1] 学习决策编排器 (4 阶段管道)
│   ├── task-state-machine.ts    # [V12] 两层嵌套状态机
│   ├── proto-task.ts            # [V11] 零样本任务模板
│   ├── task-scheduler.ts        # [V13] 主动调度决策
│   ├── subagent-manager.ts      # [V13] 子 Agent 管理
│   ├── heartbeat-monitor.ts     # [V13] 心跳监控
│   ├── scene-recognizer.ts      # [Phase 2] 场景识别
│   ├── signal-detector.ts       # [Phase 1] 修正信号检测
│   ├── embedding.ts             # [Phase 2] 文本向量化
│   ├── scenario-registry.ts     # [Phase 0] 场景注册表
│   ├── scenario-cache.ts        # [Phase 0] 场景缓存
│   ├── metacognitive-engine.ts  # 元认知引擎
│   ├── learning-loop.ts         # 学习环路
│   ├── types.ts                 # 类型系统
│   └── ... (共 29 个模块, 482 个测试)
├── transcript-analyzer.ts       # [V8] Transcript→学习事件
├── transcript-analyzer-v2.ts    # Transcript 分析器 v2
├── session-start.ts             # Session 启动
├── session-end.ts               # Session 结束
├── agentmemory-client.ts        # AgentMemory MCP 客户端
└── platform-adapter.ts          # 平台适配层
```

---

> **Praxis V1→V13 完整架构迭代完成。** 从 V1 的六层分类法开始，经过 13 个角度各异的迭代——载体选择、学习范围、过程驱动、元认知、零先验学习、工程落地、约束转移、压力适应、任务感知、知行闭环、主动编排、完全驱动——最终形成了一个完整的、可指导工程落地的认知操作系统架构。每个版本有增有减：增加新的思考维度，删除被新约束证明不必要的部分。当前工程实现主要集中在底层的记忆和学习环路（V1）以及顶层的任务编排和主动驱动（V12-V13）。中段的认知引擎（V3-V9+部分V11-V12）是下一步工程化的核心。
