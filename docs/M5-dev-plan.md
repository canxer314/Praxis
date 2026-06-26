# M5 开发计划：自主学习

> **目标**: Praxis 不再被动等待 session_end 来学习。它在会话中实时修正错误、从跨 session 模式中归纳规律、在用户纠正时判断"是结构错了还是功能变了"。
>
> **对应架构**: §4 (MidSessionLearner), §6 (自主学习触发), §3 (双重性质——teleological_mapping), §8 (StructuralGap 检测——基础), §13 (`/praxis audit`)
>
> **原则**: 架构文档是唯一真理源。当前代码能用的用、不能用的改。架构优先于已实现代码。

---

## 当前代码现状审计

### 架构 §4/§6/§3/§8 与 ROADMAP M5 要求 vs 当前实现

| 架构要求 | 当前实现文件 | 状态 | 判定 |
|---------|------------|------|------|
| **M5.1 MidSessionLearner**: message_received + before_tool_call 中实时置信度下调 | `message-received.ts` + `before-tool-call.ts` | message_received 检测纠正信号但仅追加 pendingSignals，不做置信度下调。before_tool_call 有约束检查但不跟踪违规计数。均无 session-scoped 下调上限。 | ❌ 核心逻辑缺失 |
| **M5.1 违规计数**: 工具调用违反 ProtoConstraint 3+ 次 → 即时下调 | `constraint-validator.ts` | `checkConstraints()` 只返回是否命中，不跨调用累积计数 | ⚠️ 需补充 |
| **M5.2 双重性质判断**: 纠正时判断替代实现 vs 真错误 | 无 | 不存在。ProtoSequence 类型已有 `structure`/`function`/`teleologicalMapping` 字段，但无判断逻辑 | ❌ 全新模块 |
| **M5.3 ProtoTask 累积更新**: 跨 session 数据 → 置信度成长(0.2→0.8) | `proto-task.ts` | 仅有 `bootstrapProtoTask()` (初始 0.2)，无累积更新函数 | ❌ 需扩展 |
| **M5.3 衰退检测**: 60 天未引用 → inactive | `structure-lifecycle.ts` | `shouldMarkInactive(id, days, 60)` 已存在，`canDegrade(..., daysSinceLastObserved)` 也已实现 60 天条件。缺的是 cron 驱动的调用方 | ⚠️ 仅需调用方 |
| **M5.3 跨场景纠错模式**: cron 中分析同类纠正在不同场景的出现 | `cross-domain-analyzer.ts` | 存在但做的是跨领域迁移分析（不同功能），不检测跨场景纠错模式 | ⚠️ 需新函数 |
| **M5.4 StructuralGap 检测**: 5 种信号数据采集框架 | `gap-detector.ts`（被计划遗漏） | `gap-detector.ts` 已有 `PERSISTENT_GAP` 停滞检测（3 sessions 无提升 → gap）。与 M5.4 信号 #4 重叠 | ⚠️ 需扩展而非新建 |
| **M5.3a ProtoTask 版本历史** | `structure-version.ts`（被计划遗漏） | `createVersion()` 已实现但从未在生产代码中调用。ProtoStructure 的 `versionChain` 基础设施已存在 | ⚠️ 仅需接线 |
| **M4 置信度管道运行时接线** | `confidence-fuser.ts` + `attention-telemetry.ts` + `structure-version.ts` | 三个模块的纯函数逻辑已测试通过，但零生产接线：fuser 从未在 `session-end` 调用，`updateAttention()` 从未调用（`adoptionRate` 始终为 0），`createVersion()` 从未调用（`versionChain` 始终为 `[]`） | ❌ 关键缺失 — Phase 0 |
| **M5.5 `/praxis audit`**: 结构健康度报告 | 无 | 不存在。无任何 `/praxis` 命令基础设施 | ❌ 全新模块 |
| **cron_tick**: 30min 间隔触发挖掘 | `cron-tick.ts` | 纯骨架（no-op），注释标注"M5: 跨 session 模式挖掘" | ❌ 需填充 |
| **MidSession 信号源**: confidence-fuser 中的 mid_session (0.08) | `confidence-fuser.ts` | 权重已定义，但无实际信号源数据输入 | ⚠️ 接口预留 |

### 可用代码清单

| 文件 | 保留策略 | 说明 |
|------|---------|------|
| `message-received.ts` | **改造** — 在 `handle()` 中集成 MidSessionLearner | 纠正检测已有，需增加置信度下调调用 |
| `before-tool-call.ts` | **改造** — 在 `handle()` 中集成约束违规计数 | 约束检查已有，需增加 session-scoped 计数器 |
| `constraint-validator.ts` | **保留** — 纯函数，架构正确 | 只需调用方增加计数逻辑 |
| `signal-detector.ts` | **保留** — 修正检测逻辑不变 | 纠正关键词/LLM 检测均可复用 |
| `proto-task.ts` | **扩展** — 增加 `accumulateProtoTask()` | Bootstrap 和缓存逻辑保留 |
| `cron-tick.ts` | **重写** — 从骨架变为完整实现 | 现有 no-op，无保留价值 |
| `cross-domain-analyzer.ts` | **扩展** — 增加 `analyzeCrossScenarioCorrections()` | 现有跨领域迁移分析保留 |
| `structure-lifecycle.ts` | **保留** — `shouldMarkInactive()` + `canDegrade()` 已实现 60 天规则 | 仅需 cron 调用方，M5.3c 复用而非新建 |
| `structure-retirement.ts` | **保留** — 退役逻辑已在 M4 完成 | M5 使用而非修改 |
| `structure-version.ts` | **接线** — `createVersion()` 逻辑完整但从未在生产中调用 | Phase 0 接入 session-end |
| `heartbeat-monitor.ts` | **保留** — 停顿检测不变 | 与衰退检测互补，不冲突 |
| `attention-telemetry.ts` | **接线** — `updateAttention()`/`detectZombies()`/`detectUnderestimated()` 已实现但从未调用 | Phase 0 接入；当前 adoptionRate 始终为 0 |
| `confidence-fuser.ts` | **接线** — 融合算法 + 7 权重完整，但无生产调用方 | Phase 0 接入 session-end/agent-end |
| `gap-detector.ts` | **扩展** — 已有 `PERSISTENT_GAP` 停滞检测 | M5.4 信号 #4 复用并扩展 |
| `cognitive/types.ts` | **扩展** — 新增 StructuralGapSignal, AuditReport 等类型 | 基础 ProtoStructure 类型完整 |
| `orchestrator.ts` | **改造** — session_start 时初始化 MidSessionLearner + fuser；session_end 时融合 + 持久化 | 事件路由骨架不变 |
| `m0-deps.ts` | **扩展** — 增加 ConfidenceFuser + ProtoStructure store + structure update API | Phase 0 核心依赖注入 |
| `phase1a-bridge.ts` | **扩展** — 增加 `/praxis` 命令解析；修复 lessonRecall 的 taskType/domain 字段 | Hook 桥接逻辑不变 |
| `session-end.ts` | **改造** — 集成 fuser.fuse() + updateAttention() + createVersion() + 持久化更新路径 | Phase 0 核心接线点 |
| `agent-end.ts` | **改造** — 增加 agent_end 融合点（使 MidSession 下调在当前会话中生效） | 当前仅做摘要统计 |

---

## Phase 0: M4 运行时接线 — "让数据管道先流动起来"

### 问题

Codex outside voice 审查发现：M4 的三个核心子系统（ConfidenceFuser、AttentionTelemetry、StructureVersion）的纯函数逻辑已测试通过，但**零生产接线**：

- `ConfidenceFuser.fuse()` — 仅在测试中调用。`ProtoStructure.confidence` 冻结在 LLM 提取时的初始值，从未被 7 源融合更新
- `attention-telemetry.updateAttention()` — `session-end.ts:73` 解析了 `[STRUCTURE_USED: id]` 标记，写了 lesson，但**不调用** `updateAttention()`。所有结构的 `adoptionRate` 始终为 0
- `structure-version.createVersion()` — 已实现但从未调用。所有结构的 `versionChain` 始终为 `[]`

此外，lesson schema 缺少 `taskType`/`domain`/`scenario` 维度——两个学习子系统（orchestrator session-end 路径和 CognitiveCore/LearningLoop 路径）写 lesson 时均不包含可查询的 `taskType`。`lessonRecall` 返回的 `domain` 始终为 `"unknown"`。

**影响**: M5 的所有数据驱动功能（audit、decay、structural gap、cross-scenario analysis）建立在空数据管道上。不先接线，M5 的单元测试可以通过但生产环境零可观测效果。

### 目标

将 M4 已验证的纯函数接入运行时事件流，确保：
1. 每次 session_end 时，ProtoStructure 的置信度由 7 源融合重新计算
2. STRUCTURE_USED 标记被实际追踪，`adoptionRate` 正确累积
3. ProtoStructure 修改时，`versionChain` 正确记录版本历史
4. Lesson 记录包含可查询的 `taskType`/`domain`/`scenario` 字段
5. 提供 `saveProtoStructure` 更新路径（当前只有 `setSlot` 覆盖式写入）

### 接线点设计

```
session_end 流程 (改造后):
  1. 收集 pendingSignals (已有)
  2. 提取 ProtoStructure 候选 (已有)
  3. [NEW] 收集 7 源信号 → ConfidenceFuser.fuse() → 更新 confidence
  4. [NEW] AttentionTelemetry.updateAttention() → 更新 adoptionRate
  5. [NEW] StructureVersion.createVersion() → 追加 versionChain
  6. [NEW] 持久化更新后的 ProtoStructure (saveProtoStructure)
  7. 写入 lessons (已有, +taskType/domain/scenario 字段)

agent_end 流程 (改造后):
  1. 工具调用链摘要 (已有)
  2. [NEW] MidSession 惩罚信号 → 触发轻量融合 (使本会话内下调即时生效)
  3. [NEW] 融合结果写回 session-scoped structure cache
```

### 实现清单

```
Phase 0 Step 1: M0Deps 扩展
  改造: src/m0-deps.ts                           # +25 lines
    ├── fuser: ConfidenceFuser                    # 新增可选依赖
    ├── saveProtoStructure(structure) → Promise   # 新增: ProtoStructure 更新路径
    ├── getProtoStructures(sessionId) → ProtoStructure[]  # 新增: 会话结构访问
    └── currentTaskType?: string                  # 新增: lesson schema 用

Phase 0 Step 2: session-end 接线
  改造: src/session-end.ts                        # +60 lines
    ├── handle() 中, 提取 ProtoStructure 后:
    │   ├── 收集 7 源信号 → deps.fuser.fuse()
    │   ├── 写回 structure.confidence
    │   ├── deps.telemetry.updateAttention(usedIds, injectedIds)
    │   ├── deps.versioning.createVersion(structure, ...)
    │   └── deps.saveProtoStructure(structure)
    └── writeLesson() 增加 taskType/domain 字段

Phase 0 Step 3: agent-end 接线
  改造: src/agent-end.ts                          # +20 lines
    └── 收集 MidSession 惩罚信号 → fuser.fuse() → 更新 session 内 structure cache

Phase 0 Step 4: orchestrator 依赖注入
  改造: src/orchestrator.ts                       # +15 lines
    └── session_start: 初始化 ConfidenceFuser + AttentionTelemetry + StructureVersion
    └── session_end: 传入 fuser/telemetry/versioning 给 SessionEndHandler

Phase 0 Step 5: lesson schema 补全
  改造: src/session-end.ts writeLesson()          # +10 lines
  改造: src/phase1a-bridge.ts lessonRecall()     # +15 lines
    └── saveLesson 增加: { taskType, domain, scenarioId }
    └── lessonRecall 返回: 解析 content 中的 taskType/domain, 不再默认 "unknown"

Phase 0 Step 6: ProtoStructure 持久化更新路径
  改造: src/agentmemory-client.ts                 # +20 lines
    └── saveProtoStructure(structure): memory_save(type="proto_structure") 
         → 用 structure.id 做 upsert (覆盖旧版本)
  改造: src/memory/local-cache.ts                 # +10 lines
    └── 降级路径: set(`proto_structure_${id}`, structure)
```

### Phase 0 验证标准

1. session_end 后，ProtoStructure 的 `confidence` 不等于初始提取值（被 fuser 重新计算过）
2. 3 次 session 注入同一结构 + LLM 标记使用 → `adoptionRate > 0`
3. 修改结构 → `versionChain.length >= 2`（原始版本 + 新版本）
4. `lessonRecall({taskType: "bug_fix"})` 返回正确的同类任务 lessons（不再是 `domain: "unknown"`）
5. 已有 723 测试零回归

### Phase 0 位置

Phase 0 在所有 M5 子里程碑**之前**执行。它是 M5.1-M5.5 的数据基础。Phase 0 完成后，M5.1 的 MidSessionLearner 才有可以下调的置信度、M5.5 的 audit 才有非零的 adoptionRate、M5.3c 的衰退检测才有可查询的最后引用时间。

---

## Fuser-vs-惩罚 对接设计

Codex 指出了一个关键矛盾：D2 的惩罚公式产出的是**减量 delta**（如 penalty = 0.05），但 `ConfidenceFuser.fuse()` 接收入的是**绝对值**（0-1 的 signal source value）。直接修改 `structure.confidence` 会被下一次融合覆盖。

**解决方案**: MidSessionLearner 不直接修改 `structure.confidence`。而是：

1. 每个惩罚事件 → 转换为一个 `mid_session` 信号源，其 `value` = `1.0 - penalty`（惩罚越大，信号源值越低）
2. 在下一个融合点（agent_end 或 session_end），fuser 将这些 mid_session 信号源与其他 6 源一起融合
3. `mid_session` 权重仅 0.08，自然限制了单次惩罚的影响——需要多次独立纠正才能显著拉低融合置信度
4. 融合后的最终置信度写回 `structure.confidence` 并持久化

```
示例: 中等否定 (confidence=0.8) × 高相关性 (relevance=1.0)
  penalty = 0.05 × 0.8 × 1.0 = 0.04
  mid_session source value = 1.0 - 0.04 = 0.96
  
  Fuser 输入: [statistical:0.85, llm_marker:0.90, mid_session:0.96, ...]
  Fuser 输出: ≈ 0.867 (mid_session 0.08 权重仅拉低 0.003)
  
  3 次独立纠正 (同一结构 3 次 penalty=0.04):
  Fuser 输入: [..., mid_session:0.88, ...]  (3 次取最低值? 或取均值?)
  → D3 明确: 取最低 source value (最悲观的 mid_session 信号)
  → mid_session source = 1.0 - min(0.2, totalPenalty) = 0.88
  Fuser 输出: ≈ 0.861 (3 次纠正拉低约 0.009)
```

⚠️ 此设计的实际下调幅度很小（mid_session 仅 0.08 权重）。架构 §4 中说"即时下调关联 ProtoStructure 置信度"——下调是即时的（agent_end 融合点，同会话内生效），但**幅度受权重限制**。如果用户期望更大幅度的即时下调，需在 Phase 0 后根据实际数据校准 mid_session 权重。

---

## M5.1: MidSessionLearner — "会话中实时修正"

### 目标

实现架构 §4 定义的 MidSessionLearner。在 `message_received` 和 `before_tool_call` 中同步运行（纯规则匹配，< 10ms，不调 LLM），实时下调关联 ProtoStructure 的置信度。

### 架构要求（原文引用）

> 不等到 session_end——在 message_received 和 before_tool_call 中同步运行（< 10ms，纯规则匹配，不调 LLM）:
> - 用户说"不对，应该是 X" → 即时下调关联 ProtoStructure 置信度
> - 工具调用模式违反 ProtoConstraint 3+ 次 → 即时下调该结构置信度
> - 单会话下调总量上限: 0.2（防止过度修正）

### 关键设计决策

#### D1: 如何将纠正信号关联到具体 ProtoStructure？

纠正信号（"不对，应该用 POST 而不是 GET"）需要映射到受影响的 ProtoStructure。有三种策略：

**A) 关键词匹配** — 从纠正文本中提取名词/动词，与 ProtoStructure 的名称、步骤、行为做 substring 匹配。简单但不精确。

**B) LLM 语义匹配** — 调 LLM 判断纠正意图对应的 ProtoStructure。精确但违反 < 10ms 约束。

**C) 两级策略（推荐）** — 先用关键词做快速候选筛选（< 1ms），再用结构化的信号类型（correction→target ProtoSequence step, preference→target ProtoConcept）定位。仅在候选集 > 5 时降级为"标记待 session_end 处理"。

**推荐 C**。理由：满足 < 10ms 约束，同时在不调 LLM 的前提下最大化匹配精度。关键词失败时优雅降级——不强求实时匹配，推迟到 session_end。

#### D2: 置信度下调公式

单次修正的置信度下调幅度：

```
penalty = base_penalty × correction_confidence × structure_relevance
  base_penalty = 0.05（每次修正基础下调 5%）
  correction_confidence = 用户语言强度因子:
    强否定（"完全错了"/"重新做"） → 1.0
    中等否定（"不对"/"应该是"） → 0.8
    弱否定（"不是这样"/"换一种"） → 0.5
  structure_relevance = 关键词命中率（命中数 / 结构关键词总数）
```

约束违反的下调幅度：
```
  violation 1-2 次 → 仅计数，不出手
  violation 3+ 次 → penalty = 0.03 × violation_count（上限 0.10）
```

#### D3: 会话状态管理

MidSessionLearner 需要 session-scoped 状态：
- `correctionCount`: 本会话纠正次数
- `totalPenalty`: 累计惩罚值（硬上限 0.2）
- `violationCounters`: `Map<constraintId, count>`
- `affectedStructures`: `Set<structureId>` — 防止同一结构被重复惩罚

⚠️ **预算共享**: 纠正惩罚和违规惩罚**共享** 0.2 上限（`totalPenalty = sum(correctionPenalties) + sum(violationPenalties)`，统一截断）。理由：上限的目的是"防止单会话过度修正"——两个信号源的下调效应是叠加的，分开计算会绕过上限的设计意图。

在 session_start 初始化，session_end 清理。

### 实现清单

⚠️ **Codex 发现的接线问题**:
- `handleBeforeToolCall(toolName)` 没有 `sessionId` 参数 — `sessionId` 需要从 orchestrator 线程传入
- `MessageReceivedHandler` 构造时无 ProtoStructure 访问 — 需要在 `handle()` 中传入 session structures
- `M0Deps` 无 ProtoStructure store — Phase 0 已解决（`getProtoStructures` + `saveProtoStructure`）

```
src/analysis/mid-session-learner.ts          # 新模块 (~180 lines)
  ├── class MidSessionLearner
  │   ├── handleCorrection(message, structures) → DowngradeResult[]
  │   │   └── 关键词提取 → 结构匹配 → 下调公式 → 上限检查
  │   │   └── 不下调 confidence — 而是记录 mid_session 信号源 (见 Fuser-vs-惩罚 对接设计)
  │   ├── handleConstraintViolation(toolName, constraints) → void
  │   │   └── 计数 + 阈值判断(≥3) → 记录 mid_session 信号源
  │   ├── getMidSessionSources() → SignalSourceInput[]  # 供 agent_end/session_end 融合
  │   └── reset() → void  # session_end 时调用
  ├── extractKeywords(message: string) → string[]
  ├── matchStructures(keywords, structures) → ProtoStructure[]
  └── computePenalty(correction, structure) → number

src/analysis/mid-session-learner.test.ts     # 新测试 (~15 tests)

改造: src/orchestrator.ts                    # +15 lines (原估算 +5 低估)
  └── handleBeforeToolCall: 增加 sessionId 参数 → 传入 handler
  └── handleMessageReceived: 传入 session structures
  └── session_start: new MidSessionLearner() + 加载 structures
  └── session_end: learner.getMidSessionSources() → fuser → learner.reset()

改造: src/message-received.ts                # +15 lines (原估算 +10 低估)
  └── handle() 接受 ProtoStructure[] 参数
  └── detectCorrection() 后调用 midSessionLearner.handleCorrection()

改造: src/before-tool-call.ts                # +20 lines (原估算 +15 低估)
  └── handle() 接受 sessionId 参数
  └── checkConstraints() 后调用 midSessionLearner.handleConstraintViolation()
```

### 验证标准

1. 同一会话纠正同一 ProtoSequence 3 次 → 置信度下调 0.12-0.15（不超 0.2 上限）
2. 约束违反 3 次 → 触发下调；1-2 次不出手
3. 第 5 次纠正时 totalDowngrade 已达 0.2 → 不再下调（上限生效）
4. handleCorrection + handleConstraintViolation 总耗时 < 10ms（纯规则，无 I/O）
5. 不同 session 的下调计数器互相隔离

---

## M5.2: 双重性质判断 — "是错了还是换了个做法？"

### 目标

实现架构 §3 的 teleological_mapping 判断逻辑。当用户纠正 ProtoSequence 的步骤时，Praxis 检查：原始功能目的是否仍被满足？是 → 只是替代实现（更新 teleological_mapping，不降置信度）。否 → 真错误（按 M5.1 规则下调）。

### 架构要求（原文引用）

> 当用户说"我们取消了挂号窗口, 全部在线预检分诊":
>   → Praxis 检查功能面: "建立法律关系"和"确定优先级"两个目的
>     是否仍然被满足?
>   → 是 → 结构改变但功能不变 → 只更新 teleological_mapping
>     否 → 结构改变且功能失败 → 置信度下调

### 关键设计决策

#### D4: 功能面检查由谁执行？

**A) 纯规则匹配** — 检查纠正后的步骤序列是否覆盖了原始 function.precondition 和 postcondition。

**B) LLM 语义判断** — 调 LLM 比较原始 function + teleological_mapping 与新步骤序列。

**C) 混合策略（推荐）** — 实时路径做简单判断，agent_end 时调 LLM 做完整分析。

**推荐 C**。

⚠️ **Codex 发现的隐藏假设**: `quickCheck(sequence, newSteps)` 假设 `newSteps` 是结构化数据，但用户纠正文本是自然语言（如"不对，应该用 POST 而不是 GET"）。从纠正文本中提取结构化步骤本身就是 NLU 问题。

**解决**: quickCheck 的第一参数改为 `correctionText: string`（原始纠正文本），而非假设的 `newSteps: Step[]`。用 postcondition 关键词在纠正文本中做 substring 匹配（覆盖率 ≥ 70% → 替代实现）。这更粗糙但不需要上游 step extractor。复杂判断仍走 deepCheck（有 LLM，可以做完整的语义分析）。

### 实现清单

```
src/analysis/teleological-judge.ts            # 新模块 (~130 lines)
  ├── quickCheck(sequence, correctionText: string) → { isAltImpl: boolean, confidence: number }
  │   └── 纯规则: postcondition 关键词在 correctionText 中覆盖率 ≥ 70% → 替代实现
  │   └── 不假设结构化 newSteps — 直接在原始纠正文本上匹配
  ├── deepCheck(sequence, correctionText, llm) → Promise<TeleologicalJudgment>
  │   └── LLM 分析: 从自然语言纠正文本中推断意图 → 功能面是否仍被满足
  ├── updateTeleologicalMapping(sequence, judgment) → ProtoSequence
  │   └── 更新 teleologicalMapping[] 映射关系
  └── export interface TeleologicalJudgment {
        isAlternativeImpl: boolean
        preservedPurposes: string[]
        lostPurposes: string[]
        newPurposes: string[]
        confidence: number
      }

src/analysis/teleological-judge.test.ts       # 新测试 (~10 tests)
  ├── quickCheck: postcondition 全覆盖 → 替代实现
  ├── quickCheck: postcondition 缺失 → 待 deepCheck
  ├── deepCheck: LLM 判断为替代实现 (mocked)
  ├── deepCheck: LLM 判断为真错误 (mocked)
  └── updateTeleologicalMapping: 正确更新映射

改造: src/analysis/mid-session-learner.ts      # +15 lines
  └── handleCorrection() 中: 如果目标是 ProtoSequence → 调用 teleologicalJudge.quickCheck()
  └── 替代实现 → 只记录，不下调置信度

改造: src/agent-end.ts                         # +10 lines
  └── 处理"待判断"的纠正 → 调 teleologicalJudge.deepCheck()
```

### 验证标准

1. 纠正"挂号窗口 → 自助挂号机" → postcondition "建立法律关系"仍满足 → 替代实现 → 置信度不下调
2. 纠正"问了三个问题就开药，没有体检" → postcondition "完成体格检查"失败 → 真错误 → 置信度下调
3. quickCheck 返回 uncertain → agent_end 时 deepCheck 正确分类
4. teleologicalMapping 更新后正确反映新步骤→功能映射

---

## M5.3: 跨 Session 模式挖掘 — "从历史中归纳规律"

### 目标

填充 `cron-tick.ts` 骨架，实现三类跨 session 挖掘：ProtoTask 累积更新、跨场景纠错模式分析、结构衰退检测。

### 架构要求（原文引用）

> cron_tick 触发（30min 间隔），LLM 分析积累的 task_history:
> 1. ProtoTask 自动更新: 阶段时长估计 + 陷阱命中率 + 置信度成长
> 2. 跨场景纠错模式: 同类纠正在不同场景反复出现 → 可能范畴盲区
> 3. 衰退检测: 结构 60 天未引用 → inactive

### 子模块设计

#### M5.3a: ProtoTask 累积更新

从 AgentMemory 中读取该 task_type 的所有历史任务数据，调用 LLM 分析后更新 ProtoTask：

```
src/analysis/proto-task-learner.ts            # 新模块 (~150 lines)
  ├── accumulateProtoTask(taskType, llm, memory) → Promise<ProtoTask | null>
  │   ├── 从 memory.lessonRecall 读取同类任务的所有 lessons
  │   ├── 统计: 各阶段实际耗时、陷阱真实命中率、用户满意度
  │   ├── LLM 分析 → 更新 typicalPhases + commonPitfalls
  │   ├── 置信度成长公式（对数增长, 架构 §5 的目标值校准）:
  │   │   confidence_new = clamp(0.2 + 0.15 × log2(observations + 1), 0.2, 0.95)
  │   │   observations=0→0.20, 1→0.35, 3→0.50, 5→0.59, 10→0.72, 15→0.80, 31→0.95
  │   │   架构参考值: 1项目→0.3, 3→0.5, 5→0.65, 10+→0.8-0.95
  │   │   ⚠️ 此公式为初始校准, 实际参数需根据生产数据调整
  │   └── source 切换: observations ≥ 5 → "cumulative"
  └── 合理性守卫:
      ├── observations < 3 → 只更新统计数字，不改结构（数据不足）
      └── 置信度变化 > 0.15 → 标记为"需人类审批"

src/analysis/proto-task-learner.test.ts       # 新测试 (~8 tests)
```

**置信度成长曲线**: 对数增长（前期快后期慢），上限 0.95。这反映了一个事实：前几次观察信息量最大，后续观察边际收益递减。`observations` 从 AgentMemory 中的同类任务 history 计数获得。

#### M5.3b: 跨场景纠错模式分析

从 lesson 历史中提取同类纠正，检查它们是否跨越不同场景。如果同一类纠正（如"API 认证方式"）在多个场景（healthcare, e-commerce）反复出现 → 可能是范畴盲区信号。

```
扩展: src/cross-domain-analyzer.ts             # +80 lines
  ├── analyzeCrossScenarioCorrections(llm, memory) → CrossScenarioReport[]
  │   ├── 从 lessons 提取所有 correction 类型
  │   ├── 按语义聚类（LLM）→ 找出跨场景出现的聚类
  │   └── 输出: { correctionCluster, scenarios[], frequency, possibleBlindSpot }
  └── 阈值: ≥ 2 个不同场景 + ≥ 3 次纠正 → 报告
```

#### M5.3c: 衰退检测

⚠️ **Codex 发现**: `structure-lifecycle.ts` 已有 `shouldMarkInactive(id, days, 60)` 和 `canDegrade(..., daysSinceLastObserved)` — 检测逻辑不需要新建模块。缺的是 cron 驱动的调用方和引用时间追踪。

**状态机约束**: `TRANSITIONS` 表中 `deprecate` 仅对 `crystallized` 状态有效，`rejected` 仅对 `hypothesized`/`candidate`/`experimental` 有效。没有独立的 "inactive" 状态。计划调整为:
- `crystallized` + 60 天未引用 → `deprecated` (通过已有 `transition()`)
- `experimental`/`candidate` + 60 天未引用 → 降至 `hypothesized` (通过 `degrade` transition)
- 90 天 + 低置信规则移除（状态机不支持 `deprecated` → `rejected` 路径）

```
实现: 在 cron_tick.ts 中调用已有函数                   # ~30 lines (非新模块)
  ├── 遍历所有非 deprecated/rejected 结构
  ├── crystallized + shouldMarkInactive(id, days, 60) → transition(structure, "deprecate")
  ├── experimental/candidate + shouldMarkInactive(id, days, 60) → transition(structure, "degrade")
  ├── 高置信豁免: confidence > 0.85 → 跳过 (即使超 60 天)
  └── 引用时间来源: 从 attention-telemetry 的 AttentionRecord.lastUsedAt 读取（需 Phase 0 持久化）

### cron_tick 集成

⚠️ **cron_health 双重写入**: `cross-domain-analyzer.writeHealthSlot` 已占用 `CRON_HEALTH` slot。cron_tick 不再写入 cron_health——改为各子模块独立写入各自的 slot（`proto_task_health`、`decay_health`、`cross_scenario_health`）。

```
重写: src/cron-tick.ts                         # ~80 lines
  ├── async handle()
  │   ├── 1. ProtoTask 累积更新 (所有已知 taskType) → 写入 proto_task slot
  │   ├── 2. 跨场景纠错模式分析 → 写入 cross_scenario_health slot
  │   ├── 3. 衰退检测 (调用已有 shouldMarkInactive + transition) 
  │   │   → 标记 deprecated / degraded
  │   └── 错误隔离: 任一步骤失败不影响其他步骤
  └── 守卫: 无新数据 (no new lessons since last tick) → 跳过 LLM 调用
```

### 验证标准

1. 模拟 3 次同类任务 → ProtoTask 置信度 0.20→0.50; 5 次 → ≥0.59
2. 同一纠正类型在 2+ 场景出现 → 跨场景报告正确标识
3. 60 天未引用结构 → deprecated；90 天 + 低置信 → rejected
4. 高置信结构 (0.85+) 不受 60 天规则影响
5. cron_tick 内单步骤失败不影响后续步骤

---

## M5.4: StructuralGap 基础检测 — "为 M6 积累审计数据"

### 目标

实现架构 §8 描述的 5 种 StructuralGap 检测信号的数据采集框架。不做完整分析——只做检测 + 结构化日志写入。M6 的 Meta Layer 消费这些日志。

### 架构要求（原文引用）

> 1. 模板匹配度下降: ProtoTask 置信度在同类任务中连续 3+ 次下降
> 2. 跨场景验证低: 同一操作在不同场景反复出错
> 3. 用户挫败模式: 用户反复纠正同一类问题
> 4. 认知边界停滞: 某技能熟练度长期不增长
> 5. 升级模式异常: escalation 频率或类型偏离预期

### 检测实现设计

每条信号是一个独立的纯函数检测器。输入是 AgentMemory 中的历史数据，输出是 `StructuralGapSignal | null`。

```
src/analysis/structural-gap-detector.ts       # 新模块 (~200 lines)
  ├── interface StructuralGapSignal {
  │     signalType: 1|2|3|4|5
  │     detectedAt: number
  │     evidence: {
  │       taskType?: string
  │       scenarioIds?: string[]
  │       affectedStructures?: string[]
  │       metricSnapshot: Record<string, number>
  │     }
  │     severity: "low"|"medium"|"high"
  │   }
  │
  ├── detectProtoTaskDecline(protoTaskHistory) → StructuralGapSignal | null
  │   └── 同一 task_type 的 ProtoTask 置信度连续 3+ 次更新下降
  │
  ├── detectCrossScenarioFailure(failureLog, scenarios) → StructuralGapSignal | null
  │   └── 同一 toolName 在 ≥ 2 个不同 scenario 中频繁失败（失败率 > 50%）
  │
  ├── detectCorrectionCluster(correctionLog) → StructuralGapSignal | null
  │   └── 同一类纠正（语义聚类）出现 ≥ 5 次 / 30 天
  │
  ├── detectSkillStagnation(competencyHistory) → StructuralGapSignal | null
  │   └── 任一 8D 维度连续 30 天无变化 + 该维度 ≥ 5 个 session
  │
  ├── detectEscalationAnomaly(escalationLog) → StructuralGapSignal | null
  │   └── 7 天内 escalation 次数超过历史均值 + 2σ
  │
  └── writeToAuditLog(signal, memory) → Promise<void>
      └── 写入 AgentMemory slot "audit_log" 或 typed memory

src/analysis/structural-gap-detector.test.ts  # 新测试 (~10 tests)
  ├── 信号 #1: 连续下降 → 触发; 波动 → 不触发
  ├── 信号 #2: 跨场景高失败率 → 触发; 单场景 → 不触发
  ├── 信号 #3: 高频同类纠正 → 触发; 分散纠正 → 不触发
  ├── 信号 #4: 30天停滞 → 触发; 有增长 → 不触发
  └── 信号 #5: 异常 escalation → 触发; 正常波动 → 不触发
```

### 数据可用性分析

| 信号 | 所需数据 | 当前可用性 | M5 策略 |
|------|---------|----------|--------|
| #1 ProtoTask 置信度下降 | ProtoTask version history | ❌ 不追踪历史 | M5.3a 增加 ProtoTask version 持久化 |
| #2 跨场景失败 | tool failure log + scenario tag | ⚠️ after_tool_call 记录失败但无 scenario 维度 | 扩展 after_tool_call 增加 scenario 字段 |
| #3 纠正聚类 | correction history | ⚠️ message_received 暂存但未经 LLM 聚类 | M5.1 增加纠正分类 |
| #4 技能停滞 | 8D competency history | ⚠️ metacognitive-engine 评估但不追踪历史 | 扩展 competency slot 增加时间序列 |
| #5 escalation 异常 | escalation log | ⚠️ heartbeat-monitor 记录但不追踪趋势 | 扩展 heartbeat slot 增加历史窗口 |

⚠️ 此处存在不确定性：5 种信号中有 3 种需要扩展已有模块的数据收集能力。如果数据基础设施不足以支撑所有 5 种信号，Phase 3 可能只能实现 #1 + #3（数据相对充分），其余作为 stubs 预留接口。

### 验证标准

1. 模拟 ProtoTask 连续 3 次下降 → 信号 #1 触发并写入 audit_log
2. 正常波动（上升→下降→上升）→ 不触发
3. 信号 #3 正确聚类同类纠正（如 5 次"API 认证方式"纠正）
4. audit_log slot 可被 M6 的 Meta Layer 读取

---

## M5.5: `/praxis audit` 命令 — "认知健康度报告"

### 目标

实现 `/praxis audit` 命令，输出当前结构健康度报告：僵尸结构 + 低估结构 + 约束违反统计 + StructuralGap 触发日志。

### 命令基础设施

当前无任何 `/praxis` 命令框架。需要先建立一个命令解析和路由层，供 M5.5（audit）、M3.5（ontology）、M6.4（status）共用。

```
src/commands/praxis-cli.ts                    # 新模块 (~80 lines)
  ├── parsePraxisCommand(message: string) → PraxisCommand | null
  │   └── 解析 "/praxis <subcommand>" 模式
  ├── type PraxisCommand = "ontology" | "audit" | "status" | "task"
  └── handlePraxisCommand(cmd, deps) → Promise<string>
      └── 路由到对应 handler

src/commands/praxis-audit.ts                  # 新模块 (~160 lines)
  ├── generateAuditReport(deps) → Promise<AuditReport>
  │   ├── 僵尸结构: adoptionRate < 20% AND confidence > 0.7
  │   ├── 低估结构: adoptionRate > 60% AND confidence < 0.4
  │   ├── 约束违反统计: 最近 30 天违反次数按约束排序
  │   ├── StructuralGap 触发: 从 audit_log 读取最近信号
  │   ├── 衰退警告: M5.3c 衰退检测结果
  │   └── 置信度分布直方图 (文本柱状图)
  ├── formatAuditReport(report) → string
  │   └── 纯文本格式，架构 §13 定义的结构
  └── export interface AuditReport { ... }

src/commands/praxis-audit.test.ts            # 新测试 (~8 tests)
  ├── 僵尸检测: 高置信低采纳 → 出现在报告中
  ├── 低估检测: 低置信高采纳 → 出现在报告中
  ├── 违反统计: 正确聚合和排序
  ├── 空数据: 无结构时退化为"无数据"报告
  └── 输出格式验证

改造: src/message-received.ts                  # +8 lines
  └── handle() 开始时检查是否为 /praxis 命令 → 路由到 praxis-cli
```

### 验证标准

1. `/praxis audit` 输出包含僵尸/低估/违反/衰退四类数据
2. 僵尸结构检测正确：confidence=0.85, adoptionRate=0.1 → 标记
3. 低估结构检测正确：confidence=0.3, adoptionRate=0.7 → 标记
4. 无数据时优雅降级（"No structures crystallized yet"）

---

## 依赖关系图

```
M0 (核心运行时) ✅
  │
  ├─→ M1 (ProtoStructure 类型) ✅ (teleologicalMapping 已存在)
  │     │
  │     ├─→ M2 (上下文编排) ⚠️ (部分实现)
  │     │     │
  │     │     ├─→ M3 (约束系统) ⚠️ (部分实现)
  │     │     │     │
  │     │     │     ├─→ M4 (置信度系统) ⚠️ (纯函数已测试，零生产接线)
  │     │     │     │     │
  │     │     │     │     ├─→ 🔴 Phase 0: M4 运行时接线 (NEW — 必须先做)
  │     │     │     │     │       │
  │     │     │     │     │       ├─→ M5.1 MidSessionLearner ──────┐
  │     │     │     │     │       │       │                         │
  │     │     │     │     │       │       ├─→ M5.2 双重性质判断 ────┤
  │     │     │     │     │       │       │       (依赖 M5.1)       │
  │     │     │     │     │       │       │                         │
  │     │     │     │     │       │       ├─→ M5.3 跨 Session 挖掘 ─┤
  │     │     │     │     │       │       │       (依赖 Phase 0     ├─→ M5.5 /praxis audit
  │     │     │     │     │       │       │        数据管道)        │       (依赖 Phase 0
  │     │     │     │     │       │       │                         │        + M5.3c + M5.4)
  │     │     │     │     │       │       └─→ M5.4 StructuralGap ───┘
  │     │     │     │     │       │               (依赖 Phase 0 数据)
  │     │     │     │     │       │
  │     │     │     │     │       └─→ M6 适配器接口 (可与 M5 并行)
```

**关键依赖**:
- **Phase 0 → M5.1–M5.5**: Phase 0 是 M5 的数据基础。不接线，M5 工作在全空数据集上
- M5.1 → M5.2: M5.2 的 quickCheck 嵌入 M5.1 的 handleCorrection 流程
- M5.1 + M5.2 → M5.4 信号 #3: M5.4 的纠正聚类依赖 M5.1 的纠正分类数据
- M5.3c → M5.5: 衰退检测结果是 audit 报告的组成部分（M5.3c 复用已有 `shouldMarkInactive`）
- M5.4 → M5.5: StructuralGap 触发日志是 audit 报告的数据源

**并行机会**:
- Phase 0 必须串行（是 M5 所有步骤的前置依赖）
- M5.1+M5.2 与 M5.3a+M5.3b 可在 Phase 0 后并行
- M5.4 可在 Phase 0 后独立开发

---

## 实现阶段

### Phase 0: M4 运行时接线 — "让数据管道先流动起来"

| Step | 内容 | 新文件 | 改造文件 | 预计行数 |
|------|------|--------|---------|---------|
| Step 0a | M0Deps 扩展 (fuser + ProtoStructure store + saveProtoStructure) | — | `m0-deps.ts` | +25 |
| Step 0b | session-end 接线 (fuser + attention + versioning + persistence) | — | `session-end.ts` | +60 |
| Step 0c | agent-end 接线 (MidSession 融合点) | — | `agent-end.ts` | +20 |
| Step 0d | orchestrator 依赖注入 (fuser/telemetry/versioning 生命周期) | — | `orchestrator.ts` | +15 |
| Step 0e | lesson schema 补全 (taskType/domain/scenario) | — | `session-end.ts`, `phase1a-bridge.ts` | +25 |
| Step 0f | ProtoStructure 持久化更新路径 (saveProtoStructure + upsert) | — | `agentmemory-client.ts`, `memory/local-cache.ts` | +30 |

**Phase 0 完成标准**:
- [ ] session_end 后 confidence 由 fuser 重新计算（不等于提取初始值）
- [ ] 多 session 注入+使用 → adoptionRate > 0
- [ ] 结构修改 → versionChain.length ≥ 2
- [ ] lessonRecall 可按 taskType/domain 过滤
- [ ] 723 已有测试零回归

### Phase 1: M5.1 + M5.2 — 会话中学习

| Step | 内容 | 新文件 | 改造文件 | 预计行数 |
|------|------|--------|---------|---------|
| Step 1 | MidSessionLearner 核心 | `analysis/mid-session-learner.ts` + test | `message-received.ts`, `before-tool-call.ts`, `orchestrator.ts` | +250 / ~30 |
| Step 2 | TeleologicalJudge | `analysis/teleological-judge.ts` + test | `mid-session-learner.ts`, `agent-end.ts` | +200 / ~30 |

**Phase 1 完成标准**:
- [ ] 用户纠正被实时捕获并下调关联结构置信度
- [ ] 约束违反 3+ 次触发下调
- [ ] 单会话下调总量 ≤ 0.2
- [ ] 双重性质判断正确区分替代实现 vs 真错误
- [ ] handleCorrection + handleConstraintViolation < 10ms
- [ ] 全部新模块有测试覆盖

### Phase 2: M5.3 — 跨 Session 挖掘

| Step | 内容 | 新文件 | 改造文件 | 预计行数 |
|------|------|--------|---------|---------|
| Step 3 | ProtoTask 累积更新 + 持久化 | `analysis/proto-task-learner.ts` + test | `proto-task.ts` (persist) | +260 |
| Step 4 | 衰退检测 (复用已有 `shouldMarkInactive` + `transition`) | — | `cron-tick.ts` | +30 |
| Step 5 | 跨场景纠错分析 + cron_tick 填充 | — | `cross-domain-analyzer.ts`, `cron-tick.ts` | +120 / +80 |

**Phase 2 完成标准**:
- [ ] ProtoTask 置信度随 observations 对数成长 + 持久化（重启后不丢失）
- [ ] 60 天未引用 crystallized 结构 → deprecated；experimental/candidate → degraded
- [ ] 跨场景同类纠正被正确聚类（受 MIN_LESSONS=20 数据地板限制——见风险表）
- [ ] cron_tick 完整运行 + 无新数据时跳过 LLM 调用（节省 token）
- [ ] 全部新模块有测试覆盖

### Phase 3: M5.4 — StructuralGap 数据采集

| Step | 内容 | 新文件 | 改造文件 | 预计行数 |
|------|------|--------|---------|---------|
| Step 6 | StructuralGap 检测器 (5 signals) — 信号 #4 复用 `gap-detector.ts` 的 `PERSISTENT_GAP` | `analysis/structural-gap-detector.ts` + test | `gap-detector.ts` | +260 |
| Step 7 | 数据管道补齐 (scenario tag + competency history + escalation log) | — | `after-tool-call.ts`, `metacognitive-engine.ts`, `heartbeat-monitor.ts` | ~60 |

**Phase 3 完成标准**:
- [ ] 5 种信号检测器全部实现
- [ ] 信号 #4 正确复用 `gap-detector.ts` 已有逻辑（不重复造轮子）
- [ ] 至少 2-3 种信号能基于 Phase 0 接线后的实际数据触发
- [ ] 检测结果写入 audit_log slot

### Phase 4: M5.5 — 命令系统

| Step | 内容 | 新文件 | 改造文件 | 预计行数 |
|------|------|--------|---------|---------|
| Step 8 | `/praxis` 命令框架 | `commands/praxis-cli.ts` + test | `message-received.ts` | +120 / +8 |
| Step 9 | `/praxis audit` 报告 | `commands/praxis-audit.ts` + test | — | +220 |

**Phase 4 完成标准**:
- [ ] `/praxis audit` 可运行并输出正确报告
- [ ] 僵尸/低估/违反/衰退/StructuralGap 五类数据全部覆盖
- [ ] 命令框架可扩展（ontology/status 在后续里程碑接入）

---

## 测试要求

### 单元测试

| 模块 | 最低测试数 | 关键覆盖 |
|------|----------|---------|
| Phase 0: `session-end.ts` 接线 | 8 | fuser 调用、attention 更新、version 创建、持久化路径 |
| Phase 0: `agent-end.ts` 接线 | 3 | MidSession 融合点、session cache 更新 |
| Phase 0: lesson schema | 4 | taskType/domain 写入、lessonRecall 过滤 |
| `mid-session-learner.ts` | 15 | 信号源记录（非直接改 confidence）、上限截断、违规计数 |
| `teleological-judge.ts` | 10 | quickCheck (correctionText)、deepCheck 分类、mapping 更新 |
| `proto-task-learner.ts` | 8 | 累积更新公式、持久化、观测数守卫、source 切换 |
| `cron-tick.ts` | 6 | shouldMarkInactive 调用、transition 正确性、守卫跳过逻辑 |
| `structural-gap-detector.ts` | 10 | 每种信号触发/不触发条件，信号 #4 集成 gap-detector |
| `praxis-cli.ts` | 5 | 命令解析、路由 |
| `praxis-audit.ts` | 8 | 僵尸/低估/违反/衰退检测、空数据降级 |

### 集成测试

| 场景 | 验证点 |
|------|--------|
| 完整 session 生命周期 | session_start → 多次纠正 → agent_end → session_end → MidSessionLearner 状态正确重置 |
| cron_tick 端到端 | cron_tick → ProtoTask 更新 → 衰退检测 → audit_log 写入 |
| `/praxis audit` 端到端 | 从 AgentMemory 读取数据 → 生成报告 → 输出格式正确 |

---

## 完成标准（M5 整体）

- [ ] **Phase 0**: session_end 后 confidence 由 fuser 重新计算, adoptionRate > 0, versionChain 增长
- [ ] MidSessionLearner 在 < 10ms 内响应纠正并记录 mid_session 信号源 → 验证: benchmark 测试
- [ ] 双重性质判断正确区分"替代实现"和"真错误" → 验证: 8+ 个测试场景
- [ ] 跨 session 挖掘首次成功自动更新 ProtoTask + 持久化 → 验证: 模拟 3 次任务 → 置信度 0.2→0.50 + 重启后保留
- [ ] StructuralGap 数据采集覆盖全部 5 种信号 → 验证: 每种信号至少 1 个测试可触发
- [ ] `/praxis audit` 可运行 → 验证: 端到端命令输出，adoptionRate 非零
- [ ] 全部新模块有对应测试文件 → 验证: `npm test` 全部通过, `npm run typecheck` clean
- [ ] 不破坏已有 723 个测试 → 验证: 零回归

---

## 不在 M5 范围内的事项

| 事项 | 原因 | 归属 |
|------|------|------|
| Meta Layer 完整分析（范畴审计、新范畴提议） | 需要 M5.4 数据积累 + M6 的完整分析引擎 | M6 |
| 适配器接口实现 | ROADMAP 明确归入 M6 | M6 |
| `/praxis ontology` 命令 | ROADMAP M3.5，可在 M5 之后补 | M3 |
| `/praxis status` 命令 (8D 雷达图) | ROADMAP M6.4 | M6 |
| ProtoTask plateau 检测 | 需要累积足够数据后才能有意义地检测停滞 | M6 |
| 能力模型停滞检测（完整版） | 30 天窗口需要 30 天实际运行数据 | M6 |
| MidSessionLearner 下调总量动态调整 | 需生产数据校准，当前固定 0.2 上限 | 后续 |
| 跨 Agent 认知同步增强 | M4 已有乐观锁 + pending_merge，增强版归 M6 | M6 |

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| **Phase 0 接线破坏已有测试** | 723 测试回归 | 渐进接线：每个 Step 后跑全量测试；接口级 mock 覆盖新旧路径 |
| M5.1 关键词匹配精度不足，错误下调无辜结构 | 好结构被降级 | 两级匹配：关键词候选 + 结构化过滤；teleological-judge 二次确认；mid_session 0.08 权重天然限制单次误伤 |
| M5.3 数据不足（任务历史过少）无法有效累积 | ProtoTask 置信度不成长 | 守卫条件：observations < 3 只更新统计不修改结构 |
| M5.4 数据管道不完整导致半数信号无法实际触发 | audit 报告空洞 | Phase 3 明确标注：信号 #4 复用 gap-detector，优先实现数据最充分的 #1/#3/#4 |
| cron_tick 触发频率（30min）对 LLM 调用成本高 | Token 消耗 | 守卫条件跳过无新数据的周期；批量处理而非逐条 LLM 调用 |
| M5.1 性能超标（> 10ms）阻塞消息处理 | 用户体验延迟 | benchmark 测试封门；纯规则匹配 + Set/Map 数据结构 |
| **mid_session 0.08 权重导致即时下调幅度过小** | 用户纠正几乎不影响置信度 | Phase 0 后基于实际数据评估；若幅度不足，上调 mid_session 权重至 0.12-0.15 |
| **cross-domain-analyzer MIN_LESSONS=20 限制跨场景分析** | M5.3b 在冷启动时从不触发 | 跨场景分析独立设置阈值 `MIN_CORRECTIONS_FOR_CROSS_SCENARIO = 5`（而非复用 20） |

---

> **立即启动**: Phase 1 (M5.1 + M5.2)。预计 3-4 天。目标: 会话中实时修正置信度可用。
> **架构参考**: [§4 MidSessionLearner](../architech/praxis-architecture.md), [§3 双重性质](../architech/praxis-architecture.md), [§6 自主学习触发](../architech/praxis-architecture.md), [§8 StructuralGap](../architech/praxis-architecture.md), [§13 用户命令](../architech/praxis-architecture.md)
