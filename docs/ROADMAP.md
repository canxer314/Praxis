# Praxis RoadMap

> 从零开始，按架构文档 [praxis-architecture.md](../architech/praxis-architecture.md) 的完整设计，逐里程碑构建 World Model 认知引擎。

---

## 原则

1. **架构文档是唯一真理源**。每个里程碑交付的模块、接口、行为必须与架构文档一致。
2. **不假设已有代码正确**。每个模块都需要自己的测试来验证行为，不依赖已有的 482 个测试作为正确性证明。
3. **每个里程碑独立可验证**。完成一个里程碑意味着可以在该里程碑的范围内端到端运行，不依赖后续里程碑。
4. **先建骨架，再填血肉**。M0-M1 建立数据流通路，M2-M4 增加认知深度，M5-M6 增加自主性和多运行时支持。

---

## 路线图总览

```
✅ M0: 核心运行时        (已完成, v0.8.0.1)
  │  最小 Praxis = 观察 → 存储 → 检索 → 注入
  │  交付: EventOrchestrator + 7 handlers + M0Deps + localCache
  │
  ├─→ ✅ M1: 认知数据结构   (已完成, v0.8.1.0 - v0.8.4.0)
  │     ✅ Step 1: 类型系统 + 关系图 + 生命周期
  │     ✅ Step 2-4: 版本链 + 存储注入 + 提取
  │     ProtoStructure 5 类型 + 关系图 + 版本链 + 生命周期
  │
  ├─→ ✅ M2: 上下文编排     (已完成, v0.9.0.0)
  │     Tier A/B/C 分层 + 四级压力自适应 + 注意力遥测 + 语义粒度
  │
  ├─→ ✅ M3: 约束系统       (已完成, v0.10.0.0)
  │     ProtoConstraint 注入 + before_tool_call 拦截 + 自动提取
  │
  ├─→ ✅ M4: 置信度系统     (已完成, v0.11.0.0)
  │     7 源融合 + 统计验证器 + 奎因式结晶化 + Curiosity Engine
  │
  ├─→ ✅ M5: 自主学习       (已完成, v0.11.0.1)
  │     MidSessionLearner + 跨 session 挖掘 + 双重性质建模 + 退役
  │
  └─→ ✅ M6: 元认知 + 适配器 (已完成, v0.12.0.0)
        Meta Layer + 范畴审计 + 适配器接口 + 多运行时
```

**进度: M0 ✅ | M1 ✅ | M2 ✅ | M3 ✅ | M4 ✅ | M5 ✅ | M6 ✅ | 全部完成**。

---

## M0: 核心运行时 — "能跑的最小 Praxis"

**目标**: 建立一个端到端的数据通道——观察用户行为、存储经验、检索相关经验、在下次会话中注入。这是所有后续认知能力的物理基础。如果这个通道不通，后面的 M1-M6 都是空中楼阁。

**对应架构**: §1 (Praxis 是什么), §2 (六层架构——L1/L4 的最小实现), §10 (生命周期事件), §9 (AgentMemory 映射)

### M0.1 生命周期事件处理器 `[P0]`

实现 7 个标准生命周期事件的入口处理。每个事件处理器遵循架构文档 §10 的职责定义。事件处理器是运行时无关的——不绑定到 OpenClaw 或任何特定 Agent 运行时。

```
session_start     → 加载记忆 → 构建上下文 → 注入 system prompt
message_received  → 解析用户意图 → 检测学习信号
before_tool_call  → 自主性判断 (proceed/inform/confirm/block 的简化版)
after_tool_call   → 记录工具使用
agent_end         → 汇总会话数据
session_end       → 提取经验 → 持久化 → 调度下一动作
cron_tick         → 定时扫描 (空实现，后续里程碑填充)
```

**验证**: 模拟一个完整 session 生命周期——session_start → message_received → before_tool_call → after_tool_call → agent_end → session_end。每个事件被正确路由到对应的处理器。

### M0.2 记忆存取 `[P0]`

实现与 AgentMemory 的基本通信: slot 读写、typed memory 存取、smart search。

按照架构文档 §9 的 AgentMemory 存储映射，至少实现以下 slot 的读写:
- `competency_model` (能力模型)
- `autonomy_policy` (自主性策略)

至少实现以下 typed memory:
- `knowledge` (知识条目): save + smart_search
- `learning_events` (学习事件): lesson_save + lesson_recall

**验证**: 写入一条 knowledge → smart_search 检索到它 → 写入一个 lesson → lesson_recall 检索到它。AgentMemory 不可用时，系统能降级运行（local-cache 作为降级路径）。

### M0.3 上下文注入 `[P0]`

在 session_start 时，从 AgentMemory 检索相关信息，构建 system prompt 注入段。初版注入格式简单直接——列出相关内容，不涉及 Tier 分层或压力自适应（那是 M2 的事）。

```
## Praxis Context

### 能力概况
- 总体熟练度: [从 competency_model slot 加载]

### 相关知识
- [从 smart_search 检索的 knowledge 条目]

### 上次停下的地方
- [从 mental_state 加载]
```

**验证**: 提前写入 3 条 knowledge → session_start → system prompt 中包含这 3 条知识。

### M0.4 学习信号捕获 `[P1]`

实现基本的用户纠正检测——当用户说"不对，应该是..."时，Praxis 捕获这个信号。实现基本的反馈信号匹配——工具调用成功/失败时记录。

提示: 这不是完整的 Governor 管道（那是 M4 的事）。初版只需要: 检测到信号 → 暂存 → session_end 时写入 learning_events。

**验证**: 模拟用户纠正 → session_end → AgentMemory 中出现对应的 lesson。

### M0 完成标准

- [x] 7 个生命周期事件处理器能正确路由事件
- [x] AgentMemory slot 读写正常，typed memory 存取正常
- [x] session_start 时 system prompt 包含从 AgentMemory 检索的相关内容
- [x] 用户纠正信号被捕获并写入 learning_events
- [x] AgentMemory 不可用时系统不崩溃（降级到 local-cache 或跳过）
- [x] 所有新模块有对应的测试文件

### M0 实际交付 (v0.8.0.1, 2026-06-25)

**新增模块 (10 files)**:
| 文件 | 说明 |
|------|------|
| `orchestrator.ts` | 纯函数事件路由器, 7 种生命周期事件统一入口 |
| `m0-deps.ts` | M0Deps 依赖注入接口 + 默认自主性策略 |
| `message-received.ts` | 用户纠正检测 (9 正则) + 信号暂存 |
| `before-tool-call.ts` | 自主性决策 (proceed/inform/confirm/block) |
| `after-tool-call.ts` | 工具调用追踪 + 失败信号捕获 |
| `agent-end.ts` | 工具调用摘要 (count/success/failure distribution) |
| `cron-tick.ts` | M0 skeleton (noop) |
| `memory/local-cache.ts` | 7 天 TTL 文件缓存, AgentMemory 降级 |
| `memory/local-cache.test.ts` | 15 测试 |
| `orchestrator.test.ts` | 9 测试 (完整生命周期 + 降级) |

**重构模块 (4 files)**:
| 文件 | 变更 |
|------|------|
| `session-start.ts` | 移除 CognitiveCore 依赖, 直连 AgentMemory |
| `session-end.ts` | 简化信号→lesson 直写 + local-cache 降级 |
| `cognitive-core.ts` | 添加 @deprecated JSDoc |
| `cognitive/index.ts` | 导出 15 个 M0 模块 |

**质量**: 31 test files, 498 tests passing. Typecheck: clean. Zero regression.

---

## M1: 认知数据结构 — "经验有了形状"

**目标**: ProtoStructure 从概念变为代码。5 种类型、关系图、版本链、生命周期状态机全部实现。经验从无结构的文本片段升级为有类型、有关系、可演化的结构化认知单元。

**对应架构**: §3 (认知结构系统——全部), §9 (ProtoStructure 数据模型)

### M1.1 ProtoStructure 类型系统 `[P0]`

实现 5 种 ProtoStructure 类型及其完整字段:

```
ProtoSequence   — 行为序列 + 功能目的 + teleological_mapping
ProtoRole       — 角色关系 + 行为定义 + 沟通模式
ProtoConcept    — 概念定义 + 与其他概念的关系
ProtoPurpose    — 目标意图 + 成功标准
ProtoConstraint — 约束公理 + 严重度(block/confirm/warn) + 来源
```

每个类型按照架构文档 §3 定义的字段实现。特别注意:
- ProtoSequence 的**双重性质**: structure（结构面）+ function（功能面）+ teleological_mapping。这是 §3 的核心设计，不是可选的。
- ProtoConstraint 的**严重度分级**: block 约束在 before_tool_call 被违反时必须拒绝执行。

**验证**: 每种类型至少创建一个实例 → 序列化 → 反序列化 → 字段完整性校验通过。

### M1.2 关系图 `[P0]`

实现 6 种关系类型和置信度传播规则:

| 关系 | 传播规则 | 架构 §3 参考 |
|------|---------|------------|
| depends_on | B↓Δ → A↓Δ×strength | 关系图表 |
| contradicts | A↑Δ → B↓Δ×strength | 关系图表 |
| specializes | BΔ → AΔ×factor | 关系图表 |
| precedes | B 在 A 前出现 → 两者降级 | 关系图表 |
| constrains | B 违反 → B 降级 | 关系图表 |
| alternative_to | B↑ → A 可降级 | 关系图表 |

所有传播规则为**确定性逻辑**，不调 LLM。传播深度 ≤ 3 跳。

**风险**: 依赖图引入后，单次置信度更新从 O(n) 变为 O(n+e)。初次实现传播 1 跳，生产验证后扩展到 3 跳。

**验证**: A depends_on B → B 置信度 -0.4 → A 置信度同步下调。contradicts 关系 → A 上升 → B 下降。

### M1.3 生命周期状态机 `[P1]`

实现 ProtoStructure 的 6 个生命周期状态及其转换规则:

```
hypothesized → candidate → experimental → crystallized
                                          ↑        ↓
                                          └─ deprecated/rejected
```

结晶化条件（五重门控——奎因式本体论承诺，§3）:
1. 置信度 > 0.8
2. 观察次数 ≥ 5
3. 必要性检验
4. 充分性检验
5. 奥卡姆剃刀
6. 人类审批

条件 3-5 在 M4（置信度系统）实现验证器后才真正生效。M1 实现状态机框架和转换逻辑，验证器接口预留。

**验证**: 模拟 ProtoStructure 经历完整生命周期 hypothesized→crystallized→degraded→rejected。

### M1.4 版本链 `[P1]`

每次 ProtoStructure 修改产生新版本，记录: version_id + parent_version + 结构化 diff + rationale + evidence + performance。支持回滚到任意版本。这是 V5 铁律"任何结构可回滚"的工程实现。

**验证**: 修改 3 次 → 3 个版本 → rollback 到 v1 → 恢复 v1 状态。

### M1.5 ProtoStructure 提取 `[P2]`

在 session_end 时，LLM 分析 transcript → 输出 ProtoStructure 候选。先实现 ProtoSequence 提取（一种类型验证端到端链路）。

Prompt 模板按照架构文档 §11 的 `prompts/analysis/extract-and-update.md` 设计。

**验证**: 模拟一次门诊流程对话 → session_end → 自动提取 ProtoSequence "挂号→分诊→问诊"（置信度 0.3-0.5）。

### M1.6 存储与检索 `[P0]`

ProtoStructures 通过 AgentMemory typed memory 存取（`memory_save type="proto_structure"` + `memory_smart_search`）。session_start 时按当前场景检索相关结构并注入。

**验证**: 创建 5 个 ProtoStructure（不同 scenario） → session_start 按 scenario_id 检索 → 返回 2 个匹配。

### M1 完成标准

- [x] 5 种 ProtoStructure 类型可创建、序列化、存储、检索、修改
- [x] 关系图传播在单元测试中验证（所有 6 种关系类型 + 传播深度限制）
- [x] 生命周期状态机覆盖全部 6 个状态和转换
- [x] 版本链支持回滚到任意历史版本
- [x] ProtoSequence 可从 session transcript 自动提取（端到端）
- [x] session_start 时 ProtoStructures 被注入 system prompt
- [x] 每个模块有独立测试文件

### M1 实际交付 (v0.8.1.0 - v0.8.4.0, 2026-06-25/26)

- **v0.8.1.0**: ProtoStructure 5 种类型 + StructureGraph (6 关系类型 + BFS 传播) + StructureLifecycle (6 阶段) + M4 验证器接口预留
- **v0.8.2.0**: 版本链 (createVersion/rollback/diffVersions)
- **v0.8.3.0**: AgentMemory 存储 + session_start 注入
- **v0.8.4.0**: LLM transcript 分析 → ProtoStructure 候选提取

---

## M2: 上下文编排 — "在正确的时机注入正确的内容"

**目标**: 注入从 M1 的"全堆进去"升级为智能编排——按场景匹配度排序、按上下文压力自适应压缩深度、按认知成熟度调整语义粒度、追踪哪些结构被 LLM 实际使用。

**对应架构**: §7 (上下文编排系统——全部)

### M2.1 Tier A/B/C 分层组织 `[P0]`

实现三层注入策略:
- Tier A: 当前场景 + TaskContext.relevant_scenarios 的结构 → 全量详情
- Tier B: 间接相关的结构 → 摘要+引用
- Tier C: 其余 → 名称+一行描述

排序权重: 场景匹配度 × 0.55 + 任务相关性 × 0.35 + 信号推荐 × 0.10

**验证**: 10 个结构跨 3 个场景 → Tier A 全部与当前场景匹配 → Tier B 包含间接相关的 → Tier C 包含其余。

### M2.2 四级压力自适应 `[P0]`

测量上下文利用率，按级别调整注入策略:

| 级别 | 剩余 | 注入量 | 策略 |
|------|------|--------|------|
| Normal | > 400K | ~30K | Tier A/B/C 全量 |
| Elevated | 250-400K | ~16K | Tier A 全量 + Tier B 压缩 + Tier C 移除 |
| High | 100-250K | ~3.5K | 仅 Tier A 摘要 |
| Critical | < 50K | ~1K | 结构索引 + recall_structure Lazy Loading |

**关键设计**: 即使在 Critical 下，LLM 仍知道所有结构存在（通过索引 + Lazy Loading）。Push→Pull 混合。

**验证**: 模拟 95% 占用 → Critical → 注入 ~1K → LLM 可通过 recall_structure("门诊流程") 按需拉取。

### M2.3 注意力遥测 `[P1]`

LLM 输出中解析 `[STRUCTURE_USED: proto_id]` → 追踪采纳率 → 僵尸检测（confidence > 0.7 + 采纳 < 20%）→ 低估检测（confidence < 0.4 + 采纳 > 60%）。

**验证**: 注入 5 个结构 → LLM 标记 3 个 → 遥测报告正确显示采纳率。

### M2.4 认知成熟度驱动的语义粒度 `[P1]`

同一 token 预算下，Novice (0-10 sessions) 注入粗粒度概括，Competent (10-50) 注入中等粒度，Expert (50+) 注入高密度细节。粒度与压力双维交互——Critical + Expert = 极少量极高密度数据。

**验证**: Novice+Normal → 粗粒度 / Expert+Normal → 细粒度数据丰富 / Expert+Critical → 极短极高密度。

### M2.5 TaskContext `[P1]`

实现 TaskContext 的完整 8 字段（task_id/name/type/current_phase/progress_summary/active_subtask/relevant_scenarios/auto_updated）。session_end LLM 自动推断进度变化，置信度 < 0.7 不自动更新。

**验证**: 创建 TaskContext → 模拟一个 session → 进度自动推断 → TaskContext 更新。

### M2.6 跨场景语义消歧 `[P2]`

维护同形异义词注册表。message_received 时用场景上下文消歧——如"对接"在 API 场景 = 系统集成，在干系人沟通场景 = 会议确认。

**验证**: 同一词"对接"在两个不同场景中被正确消歧为不同含义。

### M2 完成标准

- [x] Tier A/B/C 分层注入正确排序和压缩
- [x] 四级压力自适应在每种级别下正确切换
- [x] Critical 下 Lazy Loading 可用
- [x] 注意力遥测追踪结构采纳率
- [x] 认知成熟度影响注入粒度
- [x] TaskContext 自动进度推断正确
- [x] 每个模块有独立测试文件

### M2 实际交付 (v0.9.0.0, 2026-06-26)

- **Step 1**: Tier A/B/C 分层组织 (场景 ×0.55 + 任务 ×0.35 + 信号 ×0.10 排序)
- **Step 2**: 四级压力自适应 (Normal/Elevated/High/Critical) + recall_structure Lazy Loading
- **Step 3**: 注意力遥测 ([STRUCTURE_USED] 标记解析 + 僵尸/低估检测)
- **Step 4**: 认知成熟度驱动的语义粒度 (Novice/Competent/Expert 三档)
- **Step 5**: TaskContext (8 字段 + 置信度门控自动进度推断)
- **Step 6**: 跨场景语义消歧 (同形异义词注册表)

---

## M3: 约束系统 — "在 LLM 犯错之前阻止它"

**目标**: ProtoConstraint 不再只是被动存储的数据——它在 LLM 生成前主动介入，在 before_tool_call 时拦截违规操作，违反被记录并用于持续改进约束质量。

**对应架构**: §3 (ProtoConstraint 类型), §10 (before_tool_call), §7 (约束注入段)

### M3.1 ProtoConstraint 的完整实现 `[P0]`

在 M1 类型定义的基础上，实现 ProtoConstraint 的完整生命周期: 创建（手动教导或自动提取）→ 验证（反例检测）→ 结晶化→ 注入→ 衰退。

实现严重度分级:
- `block`: 绝对禁止。违反时 before_tool_call 返回 block。
- `confirm`: 暂停等待用户确认。
- `warn`: 执行但记录警告。

**验证**: 创建 block 级约束"数据库迁移前必须备份" → 检测到 migrate 调用前无 backup → 返回 block。

### M3.2 上下文约束注入 `[P0]`

session_start 时，在 Tier A/B/C 之前插入 CRITICAL CONSTRAINTS 段。注入格式:

```
⛔ CRITICAL CONSTRAINTS (不可违反):
1. 处方开具必须在诊断完成之后 [3次观察, 0次违规]
2. 数据库迁移操作前必须完成备份 [用户明确教导]

📋 推荐流程: [ProtoSequence 内容]
[约束与流程冲突时，约束优先]
```

约束段在 Critical 压力下仍然注入（~100 tokens）。

**验证**: 3 个已结晶 ProtoConstraint → session_start → system prompt 包含 CRITICAL CONSTRAINTS 段。

### M3.3 before_tool_call 约束验证 `[P1]`

在 before_tool_call 事件处理器中，检查即将执行的操作是否违反任何活跃约束。违反时按照约束的严重度采取对应行动。拦截延迟 < 10ms（纯规则匹配，不调 LLM）。

**验证**: block 约束被违反 → 返回拒绝理由 + 约束 ID。confirm 约束被违反 → 触发用户确认流程。

### M3.4 约束自动提取 `[P2]`

当统计验证器（M4 实现）检测到"A 步骤在 B 步骤之前执行时失败率显著更低"→ 自动生成 ProtoConstraint (severity=warn, confidence=0.3, source=auto_derived)。

触发条件: 步骤顺序差异 > 30% + 观察 ≥ 5 + 无用户纠正过相反顺序。

**验证**: 模拟 10 次任务 → X→Y 成功率 95%, Y→X 成功率 65% → 自动生成约束。

### M3.5 `/praxis ontology` 命令 `[P2]`

实现架构文档 §13 定义的本体论承诺审计命令。输出: 已结晶结构 + 原型结构 + 亚存在结构 + 范畴系统 + 置信度分布。

**验证**: `/praxis ontology` 正确列出所有结构及其状态。

### M3 完成标准

- [x] 约束注入后，违反已结晶约束的 LLM 行为可被 before_tool_call 拦截
- [x] before_tool_call 拦截延迟 < 10ms
- [ ] 自动提取的约束经过 3 次确认后置信度达到可注入水平 *(M3.4 依赖 M4 statistical-verifier，已预留接口)*
- [x] `/praxis ontology` 可运行并输出正确

### M3 实际交付 (v0.10.0.0, 2026-06-26)

- **Step 1**: ProtoConstraint 完整生命周期 + 严重度分级 (block/confirm/warn)
- **Step 2**: CRITICAL CONSTRAINTS 段注入 (Critical 压力下仍注入 ~100 tokens)
- **Step 3**: before_tool_call 约束验证 (collect-all + max-severity 匹配 + orchestrator 接线)
- **M3.4 约束自动提取**: 暂缓 — 依赖 M4 statistical-verifier 生产数据

---

## M4: 置信度系统 — "经验质量的量化验证"

**目标**: ProtoStructure 的置信度从 M1 的简单观察计数，升级为 7 个独立信号源的加权融合。每个信号源可独立验证——打破 LLM 自评循环。

**对应架构**: §4 (学习引擎——Governor + 多源置信度融合 + Curiosity Engine), §3 (结晶化条件)

### M4.1 Governor 完整管道 `[P0]`

实现完整的 4 阶段 Governor 管道（替代 M0 的简化版信号捕获）:

```
classify → gate → decide → dispatch
  (粗分类)  (去噪)  (裁决)   (分发到具体更新路径)
```

classify 粗分类 → LearningEvent 细分类映射按照架构文档 §4 的映射表实现。

**验证**: 模拟 5 种不同类型的信号 → Governor 正确分类 → 路由到对应的 LearningEvent 类型。

### M4.2 多源置信度融合 `[P0]`

实现 7 源加权融合算法。初始权重:

| 信号源 | 权重 | 独立性 |
|--------|------|--------|
| statistical | 0.25 | 独立于 LLM |
| llm_marker | 0.25 | 来自 LLM |
| user_correction | 0.12 | 独立 |
| role_verifier | 0.12 | 独立 |
| concept_verifier | 0.08 | 独立 |
| outcome_feedback | 0.10 | 独立 |
| mid_session | 0.08 | 独立 |

信号源不可用时按比例重新分配权重。融合后置信度决定 Tier 分配策略。

**注意**: 本里程碑实现融合算法框架。具体验证器（statistical/role/concept）在 M4.3 实现。user_correction 和 mid_session 在 M5 完善。M4 至少需要 3 个活跃信号源。

**验证**: 3 个信号源同时输出 → 融合结果与单独信号源偏差在合理范围内 → 缺 2 个源时权重重分配正确。

### M4.3 独立验证器 `[P1]`

实现三个独立于 LLM 的验证信号:

- **statistical-verifier** (架构 §4, V8 核心): 从 ProtoSequence 提取预测的工具映射，与 AgentMemory 中记录的实际工具调用序列模糊匹配。一致→1.0, 不一致→0.0。
- **role-verifier** (架构 §4, V9): 比较 ProtoRole 定义的行为与实际工具调用者模式。
- **concept-verifier** (架构 §4, V9): 对抗 prompt——"尝试为这个概念的反例辩护"。

**验证**: statistical-verifier 在 10 个 session 上的独立判断与 LLM 标记的一致性 ≥ 80%。

### M4.4 奎因式结晶化门控 `[P1]`

将 M1 预留的验证器接口实现为具体逻辑:
- 必要性: leave-one-out——移除结构后预测准确率下降 ≥ 阈值？
- 充分性: 结构被使用的 session 预测准确率 > 不被使用的 session？
- 奥卡姆剃刀: 是否存在更简单的替代结构（更少步骤/更少依赖）？

利用遥测数据和统计验证器日志，不调新 LLM。

**验证**: 置信度 0.85 的"僵尸结构"→ 充分性失败（LLM 从不使用）→ 拒绝结晶化。

### M4.5 Curiosity Engine `[P2]`

实现 4 阶段: 缺口检测→ priority 排序(relevance×frequency×impact×urgency)→ 行动生成→ 提问治理。受 GovernancePolicy §9 的 curiosity 配置节控制。

**验证**: 连续 3 个 session 遇到未知概念 → 自动标记 KnowledgeGap → priority 排序正确。

### M4.6 退役与亚存在 `[P2]`

被取代的结构进入"亚存在"状态（不删除）。保留 superseded_by 映射 + 关键教训 + reactivation_conditions。旧场景重现或新结构衰退时可重新激活。`/praxis ontology` 中可见。

**验证**: 结构 A 被 B 取代 → A 标记为 retired + 保留映射 → B 置信度跌破阈值 → A 重新激活。

### M4 完成标准

- [x] Governor 正确处理 ≥ 5 种信号类型
- [x] 置信度融合至少 3 个信号源活跃
- [x] statistical-verifier 独立判断 + role/concept verifier 均已实现
- [x] 奎因式门控 (必要性/充分性/奥卡姆剃刀) 均已实现
- [x] Curiosity Engine 正确检测和排序知识缺口
- [x] 退役结构保留映射并可重新激活

### M4 实际交付 (v0.11.0.0, 2026-06-27)

- **Phase 1**: Governor M4 升级 (classify→gate→decide→dispatch, 20 LearningEvent 类型) + 关系图传播 (constrains + alternative_to)
- **Phase 2**: ConfidenceFuser (7 源加权融合 + 权重按比例重分配) + prediction-protocol (PREDICTION_* 标记解析) + StatisticalVerifier + RoleVerifier + ConceptVerifier
- **Phases 3-5**: QuineanGating (三重门控) + Curiosity Engine (4 阶段) + StructureRetirement (亚存在状态)
- **Phase 0** (M5 期间追加): Fuser + attention + versioning 运行时接线

---

## M5: 自主学习 — "AI 主动成长"

**目标**: Praxis 不再被动等待 session_end 来学习。它在会话中实时修正错误、从跨 session 模式中归纳规律、在用户纠正时判断"是结构错了还是功能变了"。

**对应架构**: §4 (MidSessionLearner), §6 (自主学习触发), §3 (双重性质——已实现类型,本里程碑实现判断逻辑), §8 (StructuralGap 检测——基础)

### M5.1 MidSessionLearner `[P0]`

message_received 中检测用户纠正 → 即时下调关联 ProtoStructure 置信度。before_tool_call 中检测工具模式违反 ProtoConstraint 3+ 次 → 即时下调。单会话下调总量 ≤ 0.2。纯规则匹配, < 10ms, 不调 LLM。

**验证**: 同一会话中 3 次不同方式纠正同一 ProtoSequence → 置信度下调 0.24（上限截断至 0.2）。

### M5.2 双重性质判断逻辑 `[P1]`

用户在 M1 已有 ProtoSequence 的 structure/function/teleological_mapping 字段。本里程碑实现判断逻辑:

```
用户纠正步骤序列
  ↓
检查功能面: 原始目的是否仍被满足?
  ├─ 是 → 替代实现 → 仅更新 teleological_mapping, 不降置信度
  └─ 否 → 真错误 → 按置信度规则下调
```

**验证**: 用户纠正"挂号窗口→自助挂号机" → 功能不变 → 置信度不下调。用户纠正"问了三个问题就开药了，没有体检" → 功能失败(缺少体格检查步骤) → 置信度下调。

### M5.3 跨 Session 模式挖掘 `[P1]`

cron_tick 触发（30min 间隔），LLM 分析积累的 task_history:
1. ProtoTask 自动更新: 阶段时长估计 + 陷阱命中率 + 置信度成长
2. 跨场景纠错模式: 同类纠正在不同场景反复出现 → 可能范畴盲区
3. 衰退检测: 结构 60 天未引用 → inactive

session_end 的 ~20s 预算不变——挖掘在 cron 中异步。

**验证**: 3 次同类任务 → ProtoTask 置信度 0.2→0.5。60 天未引用结构被正确标记为 inactive。

### M5.4 StructuralGap 基础检测 `[P1]`

M6 的 Meta Layer 需要数据积累。本里程碑实现 5 种 StructuralGap 检测信号的数据采集框架（不要求完整分析）:

1. ProtoTask 置信度在同类任务中连续下降
2. 同一操作在不同场景反复出错
3. 用户反复纠正同一类问题
4. 技能熟练度长期不增长
5. escalation 频率偏离预期

检测结果写入 audit log，供 M6 的 Meta Layer 分析。

**验证**: 连续 5 个 session 同一操作出错 → 日志中记录 signal #2 触发。

### M5.5 `/praxis audit` 命令 `[P2]`

输出当前结构健康度报告: 僵尸结构 + 低估结构 + 约束违反统计 + StructuralGap 触发日志。纯文本格式。为 M6 的完整 Meta Layer 审计报告打基础。

**验证**: `/praxis audit` 输出包含至少僵尸/低估/违反三类数据。

### M5 完成标准

- [x] MidSessionLearner 在 < 10ms 内响应纠正并下调置信度
- [x] 双重性质判断正确区分"替代实现"和"真错误"
- [x] 跨 session 挖掘首次成功自动更新 ProtoTask
- [x] StructuralGap 数据采集覆盖全部 5 种信号
- [x] `/praxis audit` 可运行

### M5 实际交付 (v0.11.0.1, 2026-06-27)

- **Phase 0** (追加): M4 运行时接线 — ConfidenceFuser + updateAttention + createVersion 端到端接入 EventOrchestrator
- **M5.1**: MidSessionLearner — 会话中实时纠正 + 约束违规计数 → mid_session 信号源 (16 tests)
- **M5.2**: TeleologicalJudge — quickCheck (postcondition 关键词覆盖率 ≥70%) + deepCheck (LLM 异步) (8 tests)
- **M5.3**: ProtoTask 累积 — 对数置信度成长 (0.2 + 0.15 × log2(N+1)) + 衰退检测 (复用 shouldMarkInactive) + cron_tick 完整实现
- **M5.4**: StructuralGap 检测 — 5 种纯函数检测器 (ProtoTask decline / cross-scenario failure / correction cluster / skill stagnation / escalation anomaly)
- **M5.5**: `/praxis audit` — 僵尸/低估/衰退警告/违反统计/置信度分布直方图
- **总计**: 20 files (+2855/-65), 6 new source modules + 2 test files, 747 tests, typecheck clean

**已知待办 (不阻塞 M6)**:
- deepCheck 未接入 agent_end (LLM 异步 teleological 分析路径未接线)
- StructuralGap 检测器未接入 cron_tick (纯函数已实现，数据采集未激活)
- `/praxis audit` 约束违反统计依赖 `audit_log` slot，该 slot 尚无写入方
- attentionRecords 跨 session 持久化未实现

---

## M6: 元认知自治 + 适配器 — "审视自身 + 无处不在"

**目标**: Meta Layer 能基于 M5 积累的数据审计范畴盲区、提议新范畴。适配器层使 Praxis 可以接入多个 Agent 运行时，不绑定任何单一平台。

**对应架构**: §8 (元认知系统), §1 (三层运行时拓扑 + 适配器层), §10 (运行时无关接口), §13 (用户命令)

### M6.1 Meta Layer 范畴审计 `[P0]`

基于 M5 积累的 StructuralGap 数据:
- 范畴完备性检查: 被反复纠正但无法被现有 5 种类型捕获的模式 → category_blind_spot
- 康德式诊断分叉: "数据不够？还是范畴不够？"（§8 诊断流程图）
- 领域范畴同质性检查: 不同领域的 ProtoSequence 是否被强行统一？

审计结果通过 `/praxis audit` 报告。新范畴提议需人类审批（三种铁律）。

**验证**: 积累 50+ session 的审计数据 → Meta Layer 至少检测到 1 个 category_blind_spot → 附证据提议新范畴。

### M6.2 适配器接口 `[P0]`

定义标准 AdapterInterface——7 个生命周期事件的方法签名。适配器只做协议转换，不做认知处理。

```typescript
interface AgentRuntimeAdapter {
  // 将运行时的原生事件映射为 Praxis 标准生命周期事件
  mapToSessionStart(raw: RuntimeEvent): PraxisSessionStartEvent;
  mapToMessageReceived(raw: RuntimeEvent): PraxisMessageReceivedEvent;
  // ... 其余 5 个事件
  // 将 Praxis 的决策映射回运行时指令
  mapAutonomyDecision(decision: AutonomyDecision): RuntimeInstruction;
  mapConstraintViolation(violation: ConstraintViolation): RuntimeInstruction;
}
```

实现 openclaw-adapter 作为参考实现。适配器无状态——每次映射是纯函数。

**验证**: 同一组模拟事件通过 adapter-interface 以 OpenClaw 格式输入 → Praxis 处理 → 决策通过 adapter-interface 以 OpenClaw 格式输出。

### M6.3 Claude Code 适配器 `[P1]`

基于 M6.2 的接口，实现 claude-code-adapter。将 Claude Code 的 Hook 事件（PreToolUse/PostToolUse/Notification 等）映射为 Praxis 标准事件。

**验证**: 同一 session 场景用 openclaw-adapter 和 claude-code-adapter 分别运行 → Praxis 产生相同的 ProtoStructure 输出。证明适配器层的隔离是正确的。

### M6.4 `/praxis status` 命令 `[P1]`

实现能力模型 8D 雷达图（文本表示）+ 成长轨迹 + 学习时间线。这是 V1 就定义的命令。

**验证**: 运行 `/praxis status` → 输出包含 8D 能力维度和成长轨迹。

### M6.5 跨 Agent 认知同步（增强）`[P2]`

在 M4 的基础上增强: 子 Agent session_end → 写入 ProtoStructure 更新（乐观锁 + version）→ 父 Agent session_start 读取最新版。M4 已实现冲突策略（pending_merge + LLM 辅助合并）。本里程碑增强: 跨运行时同步——OpenClaw Agent 和 Claude Code Agent 共享同一个 ProtoStructure 池，乐观锁跨运行时生效。

**验证**: OpenClaw Agent 和 Claude Code Agent 同时更新同一 ProtoStructure → 先提交者成功 → 后提交者进入 pending_merge。

### M6 完成标准

- [x] Meta Layer 架构审计 + 范畴审计按定时间隔运行
- [x] 至少 2 个适配器 (OpenClaw + Claude Code) 可互换映射同一场景事件
- [x] `/praxis audit` 输出增强 — 包含 Meta Layer 审计数据
- [ ] `/praxis status` 命令 (M6.4, 延后)
- [ ] 跨运行时乐观锁 (M6.5, 延后)

### M6 实际交付 (v0.12.0.0, 2026-06-27)

- **M5 Fix-1**: deepCheck 接入 agent_end — orchestrator corrections 追踪 + AgentEndHandler 异步 LLM teleological 分析 → audit_log
- **M5 Fix-2**: 5 StructuralGap 检测器接入 cron_tick — 历史快照累积 (proto_task_history + competency_snapshots, 90d) + 信号写入 audit_log
- **M5 Fix-3**: before_tool_call audit_log 写入 — entries 格式 + violations 向后兼容 + 10K 上限
- **M5 Fix-4**: attentionRecords AgentMemory 持久化 — session_end 写入 + orchestrator session_start 恢复
- **M6.1**: ArchitectureAuditor (4 维度 + 对抗性挑战 LLM) + CategoryAuditor (Q1 范畴完备性 + Q2 领域同质性 + 康德式诊断分叉 + 冷启动 insufficient_data) + Meta Layer cron 调度 (168h/720h 间隔)
- **M6.2**: 标准 AdapterInterface (纯函数类型, 6 事件 + 2 决策映射) + OpenClawAdapter 参考实现 (16 tests)
- **M6.3**: ClaudeCodeAdapter (含 Notification 过滤逻辑, 11 tests) + platform-adapter acceptAdapterEvent 桥梁
- **总计**: 16 files changed (+1260/-30), 6 new source modules + 2 test files, 774 tests, typecheck clean
- **M6.4 `/praxis status`**: 延后 (P1, 独立功能)
- **M6.5 跨 Agent 同步**: 延后 (P2, 依赖多运行时环境)

---

## 依赖关系与并行化

```
✅ M0 (核心运行时)           ← 已完成, v0.8.0.1
  │
  ├─→ ✅ M1 (认知数据结构)   ← 已完成, v0.8.1.0 - v0.8.4.0
  │     │
  │     ├─→ ✅ M2 (上下文编排) ← 已完成, v0.9.0.0
  │     │     │
  │     │     ├─→ ✅ M3 (约束系统) ← 已完成, v0.10.0.0
  │     │     │     │
  │     │     │     ├─→ ✅ M4 (置信度系统) ← 已完成, v0.11.0.0
  │     │     │     │     │
  │     │     │     │     ├─→ ✅ M5 (自主学习) ← 已完成, v0.11.0.1
  │     │     │     │     │     │
  │     │     │     │     │     └─→ ✅ M6 (元认知+适配器) ← 已完成, v0.12.0.0
  │     │     │     │     │
  │     │     │     │     └─ M6 适配器部分可与 M2-M5 并行 (未启动)
  │     │     │     │
  │     │     │     └─ M3.4 约束自动提取: 暂缓 (依赖生产数据)
  │     │     │
  │     │     └─ M2.3 注意力遥测 → ✅ M4.4 奎因式门控已实现
  │     │
  │     └─ M2.3 注意力遥测 → M4.4 奎因式门控的关键数据源
  │
  └─ M6 适配器接口设计可与 M2-M5 完全并行
```

**三条并行轨道**:
1. **认知主线** (关键路径): M0→M1→M2→M3→M4→M5 ✅ | M6 待开始 (已耗时 ~2 周, 超前于原估算的 20-28 周)
2. **适配器线** (可并行): M6.1-M6.3 在 M0 完成后即可启动，尚未启动
3. **快速价值线**: M3.1 (约束注入) + M3.5 (`/praxis ontology`) 已交付

---

## 不在此路线图中的事项

- **多模态记忆**: 架构 §9 定义了 AgentMemory imageRef + vision_search 映射。不在此路线图中——当前无实际需求驱动。
- **GUI 查看器**: `/praxis status` 文本报告优先于图形界面。
- **跨团队联邦学习**: M6 完成前不考虑。
- **Process Engine 完整实现**: V4 的过程网络模型已被 TaskOrchestrator (状态机) 和 HeartbeatMonitor (推动) 覆盖。不再独立实现 ProcessTemplate/ProcessInstance/ProcessStep。
- **10→15 种学习事件全部激活**: 实现 15 种类型的框架（类型定义），活跃使用已有信号自然触发的类型。不强制触发没有数据支撑的事件类型。

---

> **立即启动**: M0 (核心运行时)。3-4 周。目标: session_start→session_end 的完整数据通道可运行。  
> **架构参考**: [§1-§2 (定位+六层)](../architech/praxis-architecture.md), [§10 (生命周期事件)](../architech/praxis-architecture.md), [§9 (AgentMemory 映射)](../architech/praxis-architecture.md)
