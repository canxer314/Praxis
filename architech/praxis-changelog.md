# Praxis 架构演变史 (V1 → V13)

> 本文档记录 Praxis 架构从 V1 到 V13 的完整演变过程。  
> 最终合成架构见 [praxis-architecture.md](praxis-architecture.md)。

---

## 演变本质

Praxis 的 13 个版本不是 13 次"推翻重做"。每个版本从一个特定的核心问题出发，在已有架构上增加新维度，同时删除被新约束证明不必要的部分。理解演变的关键是**每个版本试图回答的核心问题**，以及**它为什么在那个时间点成为最重要的角度**。

```
V1   "AI 需要什么认知架构？"           → 六层分类法诞生
V2   "这个架构跑在哪里？"              → 载体选择 (OpenClaw)
V3   "学什么？谁发起学习？"            → 从被动工具学习到主动多维学习
V4   "下一步该干什么？"                → 从任务执行到过程驱动
V5   "框架本身有问题怎么办？"          → 元层面的结构自演化
V6   "完全陌生怎么办？"                → 零先验的认知从零构建
V7   "怎么把设计变成代码？"            → 工程落地 — Context Orchestration Layer
V8   "token 不稀缺了怎么办？"          → 删除 token 妥协, 引入独立验证
V9   "token 又不够了怎么办？"          → 压力自适应, 优雅降级
V10  "现在在做什么任务？"              → 任务级认知感知
V11  "知识怎么变成行动？"              → 结构化知行闭环
V12  "任务怎么编排？"                  → 状态机驱动的主动认知引擎
V13  "谁推动这一切？"                  → 完全主动驱动
```

---

## V1: "AI 需要什么认知架构？"

**新增**: 六层架构（L1 工具集成→L2 任务编排→L3 知识管理→L4 学习闭环→L5 能力模型→L6 自主决策）、6 个核心数据模型（Tool/Task/Knowledge/LearningEvent/CompetencyModel/AutonomyPolicy）、4 种记忆类型（Episodic/Procedural/Semantic/Metacognitive）、3 阶段学习闭环（task_receive→task_execute→session_end）、Result\<T\> 模式、AgentMemory 21 种存储映射。

**局限**: V1 是分类法，不是架构。它回答了"应该有什么部件"，没有回答"部件在哪里运行、如何协作、数据怎么流转"。

---

## V2: "跑在哪里？"

**新增**: OpenClaw Memory Plugin 形态决定、三层运行时拓扑（AgentMemory↔Praxis↔OpenClaw）、5 个核心 Hook 映射（session_start/before_tool_call/after_tool_call/agent_end/session_end）、AutonomyPolicy→OpenClaw 指令映射（proceed/inform/confirm/block）、会话内缓存策略。

**删减**: V1 的"自建 Harness"假设——自建 Hook 系统、自建消息通道、自建工具执行引擎全部由 OpenClaw 替代。

---

## V3: "学什么？谁发起学习？"

**新增**: 4D 能力模型（工具+领域+任务+用户理解）、Curiosity Engine（4 阶段主动缺口检测→排序→行动→治理）、5 种学习事件、5 种知识类型、message_received Hook（语义意图分析）、双向交互（Praxis 可主动提问）。

**删减**: V2 的"纯被动学习"假设——Hook 触发→Praxis 响应。V3 引入内部驱动的 Curiosity Engine，不依赖 Hook 主动运行。

---

## V4: "下一步该干什么？"

**新增**: Process Engine（过程网络模型替代工具链模型）、三种步骤类型（self/delegated/collaborative）、Role Model（多角色注册表+关系图+沟通适配）、Momentum Engine（阻塞检测→催办→升级→绕过→放弃）、Action Verification Loop（5 维验证）、cron_tick Hook（时间驱动定期扫描）、4D→6D 能力模型（+process_management+action_reliability）。

**删减**: V1-V3 隐含的"任务=工具调用序列"模型。

---

## V5: "框架本身有问题怎么办？"

**新增**: StructuralGap vs KnowledgeGap 区分、5 种 StructuralGap 检测信号、Cognitive Structure Registry（hypothesized→candidate→experimental→crystallized→deprecated/rejected）、三种铁律（人类审批/实验范围限制/可回滚）、10→15 种学习事件。

**删减**: V1-V4 隐含的"框架自身是真理"的假设。Meta Layer 在架构上开了"自检"的维度。

---

## V6: "完全陌生怎么办？"

**新增**: Proto-Cognitive Engine 四阶段（Open Perception→Proto-Structure Construction→Interactive Validation→Crystallization/Degradation）、4 种 ProtoStructure 类型（Sequence/Role/Concept/Purpose）、预测协议（[PREDICTION_CONFIRMED/FAILED/UNCERTAIN]）、置信度更新公式（+0.1×(1-c)/-0.2×c/-0.4×c）、信息演化管线（Raw Observation→SalientElement→ProtoStructure→CrystallizedStructure）、6D→8D 能力模型（+proto_cognition）、Layer Self-Modification。

**删减**: V5 的"必须有锚点才能检测缺陷"的假设。V6 证明即使没有锚点，从开放感知开始也可以构建认知。

---

## V7: "怎么把设计变成代码？"

**新增**: Context Orchestration Layer 定义（正确时间+正确格式+正确信息→LLM 上下文）、第一个具体模块树（hooks/orchestration/analysis/memory/prompts/types/tests）、场景匹配器+上下文构建器（4 种注入策略）、性能预算、工程缺陷分析（10 个缺陷 3 类根因——验证真空/接地脆弱性/人工依赖）。

**删减**: V1-V6 的纯设计状态。V7 是第一次工程映射，也是第一次诚实面对设计缺陷。

---

## V8: "token 不稀缺了怎么办？"

**新增**: 统计验证器（第一个非 LLM 验证信号，打破 LLM 自循环）、Tier A/B/C 上下文组织（全量注入+层级排序替代选择性注入）、Transcript Analyzer（端到端 LLM 分析，消除 PMI 信息损失）、置信度融合器（3 源: statistical+llm_marker+user_correction）、AgentMemory 降级缓存（7 天 TTL）。

**删减**: salience-marker（正则预标记）、pattern-detector（PMI 预过滤）、选择性注入策略——这些是 token 稀缺的妥协，不是 Praxis 的本质。模块数 -3 +5 = 净增 2。

---

## V9: "token 又不够了怎么办？"

**新增**: 四级压力自适应（Normal/Elevated/High/Critical）、Lazy Loading（Push→Pull 混合）、注意力遥测（[STRUCTURE_USED] 标记→采纳率追踪→僵尸结构检测）、角色/概念独立验证器、一致性检查器+配置自适应+衰退检查+架构审计+结构生命周期管理、3→5 源置信度融合（+role_verifier+concept_verifier）。

**删减**: V8 的"全量注入总是可行"的假设。V9 恢复了压缩——但不是 V7 的"只注入匹配度最高的"，而是"注入全部但压缩深度"。即使在 Critical 下，LLM 仍通过索引+Lazy Loading 知道所有结构存在。

---

## V10: "现在在做什么任务？"

**新增**: TaskContext（~200 tokens 极轻量任务感知层，8 个字段）、session_end 自动进度推断（置信度 < 0.7 不自动更新）、任务感知优先级排序（场景匹配度×0.60+任务相关性×0.40）、ProtoTask 概念设计（Phase 2+, 可选）。

**删减**: V1-V9 的"场景=认知的基本单位"假设。V10 指出任务（纵向时间轴）和场景（横向分类）是两个正交维度。

---

## V11: "知识怎么变成行动？"

**新增**: 四个结构化接口（KnowledgeQuery/GuidanceSignal/OutcomeFeedback/MidSessionLearner）、ProtoTask 升格为 Phase 1 核心 + bootstrap 机制、5→7 源置信度融合（+outcome_feedback+mid_session）。

**删减**: V10 的"开环注入"假设——知识注入 prompt ≠ 知识传递完成。执行层组件不能消费 prompt 文本，需要结构化接口。

---

## V12: "任务怎么编排？"

**新增**: 两层嵌套状态机（外层 7 状态+内层 4 状态+中间态）、plan-generator（ProtoTask→PlanDocument）、verifier（5 种验收标准）、pitfall-tracker（陷阱匹配+命中反馈+误报率控制）、plan-file-writer（兼容 planning-with-files 格式）。

**删减**: V11 的 4 个外部接口中 3 个被内部化（KnowledgeQuery→plan-generator 内部调用、GuidanceSignal→PlanDocument 嵌入、OutcomeFeedback→内部 processSubtaskOutcome）。planning-with-files 从"任务编排者"降格为"文件持久化工具"。外部接口从 4 个减少到 1 个（MidSessionLearner 保持独立）。模块数从 32 简化到 29（+6 新, -3 移）。

---

## V13: "谁推动这一切？"

**新增**: 四大核心能力最终形成（Memory+Learning+Orchestration+Drive）、TaskScheduler（决策矩阵: 自主驱动？静默时段？触发限制？→ 调度机制）、SubagentManager（spawn/wait/retry/aggregate + 并行上限 3）、HeartbeatMonitor（三级介入: nudge→wake→escalate）、5 种 Trigger 全部激活、自主学习触发（cron→task_history→ProtoTask / plateau 检测 / 能力模型审计）、跨 Agent 认知同步（乐观锁+version 号）。

**删减**: V12 的"被动编排"假设——状态机等待 Hook 事件推进。V13 增加了主动触发——同一状态机，只是驱动源从纯 Hook 变为 Hook+Schedule+Heartbeat+Subagent 混合。

**关键克制**: V13 不修改 V12 状态机的一行代码。净增 < 530 行代码。驱动层很薄——只是调度和触发逻辑，真正的"做事"仍在 V12 的状态机中。

---

## 跨版本设计主题

以下线索在多个版本中逐步浮现和强化:

1. **从原子化到关系化**: V1 {tool→proficiency}→V3 4D 独立维度→V5 版本链→V6 ProtoStructures→V8 置信度融合→StructureDependencyGraph（设计目标）
2. **从被动到主动**: V1-V2 纯被动→V3 主动好奇→V4 主动推动→V11 主动指导→V13 主动驱动
3. **从事后检测到事前约束**: V6 预测标记→V8 统计验证→OntologicalConstraintLayer（设计目标）
4. **从单一范畴到范畴演化**: V6 4 种固定类型→V9 ConsistencyChecker→Meta Layer 范畴审计（设计目标）
5. **从 token 稀缺到注意力稀缺**: V7 选择性注入→V8 全量注入→V9 自适应压缩深度
6. **从场景单轴到任务+场景双轴**: V1-V9 场景唯一维度→V10 任务正交维度→跨场景语义消歧（设计目标）

---

## 当前实现状态

详见 [praxis-architecture.md](praxis-architecture.md) 的"当前实现状态"章节。

| 版本 | 关键特性 | 实现状态 |
|------|---------|---------|
| V1 | 学习闭环 + 记忆类型 + AgentMemory | ✅ 核心已实现 |
| V2 | OpenClaw Plugin 形态 | ❌ 未迁移 (当前为独立 npm 包) |
| V3 | 4D 能力模型 + Curiosity Engine | ❌ 未实现 |
| V4 | Process Engine + Role Model | ❌ 未实现 |
| V5 | Meta Layer + StructuralGap | ❌ 未实现 |
| V6 | Proto-Cognitive Engine + ProtoStructure 数据模型 | ❌ 未实现 (最关键缺失) |
| V7 | Context Orchestration + 场景识别 | ⚠️ 场景识别已实现 |
| V8 | 统计验证器 + Tier A/B/C + Transcript Analyzer | ⚠️ Transcript Analyzer 已实现 |
| V9 | 四级压力 + 注意力遥测 + 置信度融合 | ❌ 未实现 |
| V10 | TaskContext + 任务感知排序 | ⚠️ ProtoTask 已实现, TaskContext 部分 |
| V11 | 四个接口 + ProtoTask bootstrap | ⚠️ 仅 ProtoTask bootstrap 已实现 |
| V12 | 状态机 + plan-generator + verifier + pitfall | ⚠️ 仅状态机已实现 |
| V13 | Scheduler + Subagent + Heartbeat + 自主触发 | ⚠️ 前三者已实现, 自主学习触发未实现 |
