# Praxis RoadMap

> 从已实现的 ~20% 到完整 World Model 认知引擎的里程碑路线图  
> 架构设计: [praxis-architecture.md](../architech/praxis-architecture.md)  
> 起点: v0.7.2.0 | 482 tests | 29 modules

---

## 〇、当前状态 (2026-06-25)

### 已实现

```
✅ 学习记忆环路 (V1)
   CognitiveCore + MetacognitiveEngine + LearningLoop
   + 4记忆类型 + Result<T> + AgentMemory MCP集成

✅ 学习决策编排 (Phase 1)
   Governor (4阶段管道: classify→gate→decide→dispatch)
   + TimingController + SignalDetector

✅ 场景感知基础设施 (Phase 0-2)
   SceneRecognizer + ScenarioRegistry + ScenarioCache + Embedding

✅ 任务编排与主动驱动 (V12-V13)
   TaskStateMachine (两层嵌套) + TaskScheduler
   + SubagentManager + HeartbeatMonitor
   + ProtoTask bootstrap + TranscriptAnalyzer
```

### 核心缺口

```
❌ ProtoStructure 数据模型 (V6)
   5种类型(Sequence/Role/Concept/Purpose/Constraint) 均无类型定义
   → 没有操作对象，所有认知操作(§3-§9)无法落地

❌ 上下文编排系统 (§7)
   场景识别有, 但 Tier A/B/C 组织、四级压力自适应、
   认知成熟度粒度、注意力遥测 — 全部未实现

❌ 学习引擎深化 (§4)
   Curiosity Engine、MidSessionLearner、7源置信度融合 — 未实现

❌ 约束系统 (§3+§10)
   ProtoConstraint 数据不存在, 约束注入+验证 — 无法实现

❌ 元认知系统 (§8)
   Meta Layer + 范畴审计 + StructuralGap检测 — 未实现

❌ 适配器层 (§1+§10)
   标准生命周期事件接口、多运行时适配器 — 未实现
```

### 架构定位

当前 Praxis 是 Feature List 认知系统（原子化的独立结构）。目标是 World Model 引擎（关系图+置信度传播+事前约束）。架构文档 §1 header 显式命名了这个核心张力。本路线图是实现这个目标的工程计划。

---

## 一、路线图概览

```
M0 (当前) ──→ M1 ──→ M2 ──→ M3 ──→ M4 ──→ M5 ──→ M6
已实现       数据    上下文   约束    置信度  自主    元认知+
   ~20%     模型    编排    系统    系统    学习    适配器

每个里程碑交付一个用户可感知的能力跃升。
```

| 里程碑 | 核心交付 | 用户看到什么 | 预计周期 |
|--------|---------|------------|---------|
| **M1** 认知基础 | ProtoStructure 数据模型 + 关系图 | 经验以有类型的结构存储，可按场景检索 | 4-6 周 |
| **M2** 上下文编排 | Tier A/B/C + 四级压力 + 注意力遥测 | LLM 在正确的时机获得正确深度的经验 | 3-5 周 |
| **M3** 约束系统 | ProtoConstraint + 注入 + before_tool_call 验证 | LLM 不再重复已知的错误 | 3-4 周 |
| **M4** 置信度系统 | 7 源融合 + Curiosity Engine + 版本链 | 经验质量从"猜的"变为"多源验证的" | 4-6 周 |
| **M5** 自主学习 | MidSessionLearner + 跨session挖掘 + 双重性质 | AI 主动发现知识缺口，自我修正 | 4-6 周 |
| **M6** 元认知+ | Meta Layer + 适配器 + 用户命令 | AI 能审视自身框架缺陷，多运行时兼容 | 4-6 周 |

**总计: 22-33 周**（可并行路径缩短后约 16-24 周）

---

## 二、M1: 认知基础设施（ProtoStructure 数据模型）

**目标**: ProtoStructure 从"不存在的概念"变为"可创建、存储、检索、注入的一等公民"。

**为什么是第一个里程碑**: ProtoStructure 是架构文档 §3-§9 所有认知操作的唯一操作对象。它不先存在，后续所有"智能"都是空中楼阁。

### M1.1 数据模型定义 `[P0]`

**要做什么**:
- 在 `types.ts` 中定义 5 种 ProtoStructure 类型（Sequence/Role/Concept/Purpose/Constraint）
- 实现 `relations[]` 字段（6 种关系类型: depends_on/contradicts/specializes/precedes/constrains/alternative_to）
- 实现关系图置信度传播（确定性逻辑，≤3 跳，不调 LLM）
- 实现生命周期状态机（hypothesized→candidate→experimental→crystallized→deprecated/rejected）

**架构参考**: [§3 认知结构系统](../architech/praxis-architecture.md)  
**影响代码**: `types.ts` (+ProtoStructure 接口族), 新增 `structure-graph.ts`  
**验证**: 创建 ProtoSequence → 添加 depends_on 边 → 修改依赖结构置信度 → 传播到依赖方

### M1.2 存储与检索 `[P0]`

**要做什么**:
- AgentMemory slot: `proto_structures`（Memory typed, 非 Slot——结构太多不适合 slot）
- `memory_save type="proto_structure"` + `memory_smart_search` 按 scenario_id/task_type 检索
- session_start 时按当前场景检索相关 ProtoStructures

**影响代码**: `agentmemory-client.ts` (+proto_structure 存取), `session-start.ts` (+结构检索)  
**验证**: 创建 5 个 ProtoStructure → session_start 按场景检索 → 返回匹配的结构列表

### M1.3 基本注入 `[P0]`

**要做什么**:
- 在 session_start 时将检索到的 ProtoStructures 注入 system prompt
- 注入格式: 结构名称 + 置信度 + 关键内容摘要
- 先做最简单的注入（不分 Tier，不区分压力级别——那是 M2 的事）

**影响代码**: `session-start.ts` (+结构注入段), 新增 `prompts/system/memory-context.md`  
**验证**: 创建 3 个 ProtoStructure → session_start → system prompt 中包含这 3 个结构

### M1.4 ProtoStructure 提取（最小版）`[P1]`

**要做什么**:
- 在 session_end 时，transcript-analyzer 输出 ProtoStructure 候选（不仅是 LearningEvent）
- 利用已有的 TranscriptAnalyzer + LLM prompt 模板
- 仅提取 ProtoSequence（先做一种类型验证链路）

**影响代码**: `transcript-analyzer.ts` (+ProtoStructure 提取), 新增 `prompts/analysis/extract-structures.md`  
**验证**: 模拟一次门诊流程对话 → session_end → 自动提取出 ProtoSequence "挂号→分诊→问诊"

### M1 完成标准

- [ ] 5 种 ProtoStructure 类型在 TypeScript 中有完整接口定义
- [ ] ProtoStructure 可通过 AgentMemory 创建、存储、检索
- [ ] session_start 时 ProtoStructures 被注入 system prompt
- [ ] session_end 时自动提取 ProtoSequence（至少 1 种类型跑通端到端）
- [ ] 关系图置信度传播在单元测试中验证（A depends_on B → B 下调 → A 同步下调）
- [ ] 相关测试覆盖 ≥ 80%

---

## 三、M2: 上下文编排（从"注入"到"编排"）

**目标**: 注入从"全部堆进去"升级为"在正确时间、以正确深度、注入正确的结构"。

**前置条件**: M1 完成。

### M2.1 Tier A/B/C 分层 + 排序 `[P0]`

**要做什么**:
- 实现三层注入策略: Tier A（当前场景全量）、Tier B（相关场景摘要）、Tier C（其余索引）
- 排序权重: 场景匹配度 × 0.55 + 任务相关性 × 0.35 + 信号推荐 × 0.10
- context-organizer 模块: 输入 ProtoStructures + 场景 + TaskContext → 输出排序后的 Tier 列表

**架构参考**: [§7 Tier A/B/C 分层组织](../architech/praxis-architecture.md)  
**影响代码**: 新增 `orchestration/context-organizer.ts`, `session-start.ts` (改造)  
**验证**: 10 个结构跨 3 个场景 → 排序后 Tier A 全部与当前场景匹配

### M2.2 四级压力自适应 `[P1]`

**要做什么**:
- 实现 context-pressure-monitor: 测量当前上下文利用率
- Normal/Elevated/High/Critical 四级 + 对应注入策略
- Critical 下 Lazy Loading（注册 `recall_structure` 工具，LLM 按需拉取）
- GovernancePolicy 配置: normal=400K/elevated=250K/high=100K/critical=50K

**架构参考**: [§7 四级压力自适应](../architech/praxis-architecture.md)  
**影响代码**: 新增 `orchestration/context-pressure-monitor.ts`, `memory/recall-structure.ts`  
**验证**: 模拟 95% 上下文占用 → Critical 模式 → 注入 ~1K tokens → LLM 可通过 recall_structure 拉取详情

### M2.3 注意力遥测 `[P1]`

**要做什么**:
- LLM 输出中解析 `[STRUCTURE_USED: proto_id]` 标记
- 追踪每个结构的采纳率（被引用的 session 数 / 应该被使用的 session 数）
- 僵尸结构检测: confidence > 0.7 + 采纳率 < 20% → 标记 needs_review
- 低估结构检测: confidence < 0.4 + 采纳率 > 60% → 标记 confidence_suspect

**架构参考**: [§7 注意力遥测](../architech/praxis-architecture.md)  
**影响代码**: 新增 `analysis/attention-telemetry.ts`, `session-end.ts` (+遥测解析)  
**验证**: 注入 5 个结构 → LLM 在输出中标记 3 个 → 遥测数据显示 3/5 采纳

### M2.4 认知成熟度驱动的语义粒度 `[P2]`

**要做什么**:
- 按同类 session 数分级: Novice (0-10) / Competent (10-50) / Expert (50+)
- 同一 Tier 下，Novice 注入粗粒度概括，Expert 注入高密度细节（数值+标准差+陷阱命中率）
- 粒度与压力双维交互: Critical+Expert = 极少量极高密度数据

**架构参考**: [§7 认知成熟度驱动的语义粒度](../architech/praxis-architecture.md)  
**影响代码**: `context-organizer.ts` (+成熟度参数)  
**验证**: Novice + Normal → 粗粒度概括 / Expert + Normal → 细粒度数据丰富

### M2 完成标准

- [ ] Tier A/B/C 分层注入正常工作
- [ ] 四级压力自适应在 4 种利用率下正确切换注入策略
- [ ] Critical 下 Lazy Loading 可用（LLM 可以主动拉取结构详情）
- [ ] 注意力遥测正确追踪至少 20 个 session 的结构采纳率
- [ ] 僵尸/低估结构检测逻辑通过单元测试

---

## 四、M3: 约束系统（从事后到事前）

**目标**: LLM 在犯错之前就被阻止。约束从"不存在"变为"在 LLM 生成前主动拦截"。

**前置条件**: M1 完成（需要 ProtoConstraint 类型）。M2 的部分能力可并行（Tier A/B/C 可以容纳约束注入段）。

### M3.1 上下文约束注入 `[P0]`

**要做什么**:
- 在 session_start 注入 Tier A/B/C 之前插入 CRITICAL CONSTRAINTS 段
- 从已结晶的 ProtoConstraint 中选取与当前场景相关的约束（最多 5 个）
- 注入格式: `⛔ CRITICAL CONSTRAINTS (不可违反):` + 约束描述 + 来源标注
- 约束段在 Critical 压力下仍然注入（~100 tokens 几乎无成本）

**架构参考**: [§3 ProtoConstraint 类型](../architech/praxis-architecture.md), [§7 Tier A/B/C](../architech/praxis-architecture.md)  
**影响代码**: `session-start.ts` (+约束注入), 新增 `prompts/system/constraint-injection.md`  
**验证**: 创建 3 个结晶化 ProtoConstraint → 匹配当前场景 → 注入到 system prompt 的 CRITICAL CONSTRAINTS 段

### M3.2 before_tool_call 约束验证 `[P1]`

**要做什么**:
- 在 before_tool_call 事件处理器中，检查即将执行的操作是否违反任何活跃约束
- 三级拦截: block（绝对禁止）、confirm（等待用户确认）、warn（执行但记录警告）
- 纯规则匹配，< 10ms 延迟
- 违反约束时返回拦截理由 + 约束 ID

**架构参考**: [§10 生命周期事件](../architech/praxis-architecture.md)  
**影响代码**: `hooks/before-tool-call.ts` (+约束验证), 新增 `orchestration/constraint-validator.ts`  
**验证**: 约束"数据库迁移前必须备份" → 检测到 migrate 调用前无 backup 调用 → 返回 block

### M3.3 约束从观察中自动提取 `[P2]`

**要做什么**:
- 当 statistical-verifier 检测到"A 步骤在 B 步骤之前执行时失败率显著更低"→ 自动生成 ProtoConstraint
- 触发: 步骤顺序差异 > 30% 成功率 + 观察 ≥ 5 + 无用户纠正过相反顺序
- 自动提取的约束: severity=warn, confidence=0.3, source=auto_derived

**架构参考**: [§8 范畴审计](../architech/praxis-architecture.md)  
**影响代码**: `statistical-verifier.ts` (+约束生成), 新增 `analysis/constraint-extractor.ts`  
**验证**: 模拟 10 次任务 → 步骤 X→Y 成功率 95%, Y→X 成功率 65% → 自动生成 ProtoConstraint

### M3.3 用户可见: `/praxis ontology` `[P2]`

**要做什么**:
- 实现架构文档 §13 定义的 `/praxis ontology` 命令
- 输出: 已结晶结构 + 原型结构 + 亚存在结构 + 范畴系统 + 置信度分布
- 纯文本报告格式

**影响代码**: 新增命令处理逻辑  
**验证**: 创建若干结构 → `/praxis ontology` → 输出完整清单

### M3 完成标准

- [ ] 约束注入后，违反已结晶约束的 LLM 行为减少 ≥ 70%
  - 如果 < 30% → 说明 hard constraint 格式无效，需要更强的机制
- [ ] before_tool_call 拦截延迟 < 10ms
- [ ] 自动提取的约束在 3 次人工确认后置信度达到可注入水平
- [ ] `/praxis ontology` 可运行

---

## 五、M4: 置信度系统（从"猜"到"验证"）

**目标**: ProtoStructure 的置信度从单一的观察计数升级为 7 源加权融合。结构质量可被多维度独立验证。

**前置条件**: M1+M2+M3 完成（需要 ProtoStructure 数据 + 注意力遥测数据 + 约束违反日志）。

### M4.1 多源置信度融合 `[P0]`

**要做什么**:
- 实现 7 源加权融合算法: statistical(0.25) + llm_marker(0.25) + user_correction(0.12) + role_verifier(0.12) + concept_verifier(0.08) + outcome_feedback(0.10) + mid_session(0.08)
- 实现 statistical-verifier（V8 核心——独立于 LLM 的工具序列匹配）
- 实现 role-verifier + concept-verifier（对抗 prompt 验证）
- 融合算法: 加权平均。信号源 NA 时按比例重新分配权重
- 融合后置信度直接决定 Tier 分配（高置信度→Tier A 优先级提升）

**架构参考**: [§4 多源置信度融合](../architech/praxis-architecture.md)  
**影响代码**: 改造 `orchestration/confidence-fuser.ts`, 新增 `analysis/statistical-verifier.ts`, `analysis/role-verifier.ts`, `analysis/concept-verifier.ts`  
**验证**: 创建 ProtoStructure → 5 个 session 后 → 至少 3 个信号源贡献置信度

### M4.2 版本链 `[P1]`

**要做什么**:
- 每次 ProtoStructure 修改产生一个新版本
- 记录: version_id + parent_version + diff(结构化) + rationale + evidence + performance
- 支持: 回滚到任意版本 + 多版本 diff + 从多个版本融合
- 实现 V5 铁律"任何结构可回滚"

**架构参考**: [§3 版本链](../architech/praxis-architecture.md)  
**影响代码**: `types.ts` (+VersionChain), 新增 `analysis/structure-lifecycle.ts` (+版本管理)  
**验证**: 修改 ProtoStructure 3 次 → 3 个版本 → rollback 到 v1 → 恢复 v1 状态

### M4.3 奎因式结晶化门控 `[P1]`

**要做什么**:
- 实现五重门控: 置信度>0.8 + 观察≥5 + 必要性 + 充分性 + 奥卡姆剃刀
- 必要性: leave-one-out 分析——移除该结构后预测准确率是否下降
- 充分性: 该结构被使用的 session 预测准确率是否显著高于不被使用的 session
- 奥卡姆剃刀: 是否存在更简单的替代结构
- 条件 3-5 不调 LLM——基于遥测数据和统计验证器的日志

**架构参考**: [§3 结晶化条件](../architech/praxis-architecture.md)  
**影响代码**: `structure-lifecycle.ts` (+门控逻辑), 新增 `analysis/counterfactual.ts`  
**验证**: 置信度 0.85+观察 7 的"僵尸结构"→ 充分性检验失败(LLM 从不使用) → 拒绝结晶化

### M4.4 Curiosity Engine `[P2]`

**要做什么**:
- 四阶段: 缺口检测→排序(relevance×frequency×impact×urgency)→行动生成→提问治理
- priority < 0.3: 静默标记 / 0.3-0.6: 检索外部 / 0.6-0.8: 生成提问草稿 / > 0.8: 请求协助
- 受 GovernancePolicy 的 curiosity 配置节控制

**架构参考**: [§4 Curiosity Engine](../architech/praxis-architecture.md)  
**影响代码**: 新增 `orchestration/curiosity-engine.ts`  
**验证**: 连续 3 个 session 遇到未知术语"HL7 协议" → priority 0.75 → 生成提问草稿

### M4 完成标准

- [ ] 7 源置信度融合在生产环境中至少 3 个信号源活跃
- [ ] statistical-verifier 的独立验证信号与 LLM 标记的一致性达到 ≥ 80%
- [ ] 版本链能正确回滚到任意历史版本
- [ ] 奎因式门控成功阻止至少 1 个"僵尸结构"的结晶化
- [ ] Curiosity Engine 成功检测并排序至少 3 个知识缺口

---

## 六、M5: 自主学习（AI 主动成长）

**目标**: AI 不再等着被教——它主动发现自己的知识缺口、在会话中实时修正错误、从跨 session 模式中归纳规律。

**前置条件**: M1-M4 完成。

### M5.1 MidSessionLearner `[P0]`

**要做什么**:
- message_received 中检测用户纠正（"不对，应该是..."）→ 即时下调关联 ProtoStructure 置信度
- before_tool_call 中检测工具模式违反 ProtoConstraint 3+ 次 → 即时下调
- 单会话下调总量上限: 0.2
- 纯规则匹配, < 10ms, 不调 LLM

**架构参考**: [§4 MidSessionLearner](../architech/praxis-architecture.md)  
**影响代码**: `message-received.ts` (+纠正检测), `before-tool-call.ts` (+模式违反检测), 新增 `analysis/mid-session-learner.ts`  
**验证**: 用户在会话中说 3 次不同方式纠正同一个 ProtoSequence → 置信度下调 0.24（不超过 0.2 上限）

### M5.2 跨 Session 模式挖掘 `[P1]`

**要做什么**:
- cron_tick 触发（每 30 分钟），LLM 分析积累的 task_history
- 三件事: (a) 自动更新 ProtoTask 阶段时长和陷阱命中率, (b) 检测跨场景同类纠错→可能的范畴盲区, (c) 衰退检测: 结构 60 天未引用→标记 inactive
- session_end 的 20s 预算不变——挖掘在 cron 中异步执行

**架构参考**: [§6 自主学习触发](../architech/praxis-architecture.md)  
**影响代码**: `cron-tick.ts` (+模式挖掘), 新增 `analysis/pattern-miner.ts`  
**验证**: 3 次同类任务 → ProtoTask 置信度从 0.2 升到 0.5

### M5.3 双重性质建模 `[P1]`

**要做什么**:
- ProtoSequence 拆分为结构面(structure) + 功能面(function) + teleological_mapping
- 用户纠正时先判断: 结构改变但功能不变？（替代实现）→ 只更新 mapping, 不降置信度
- 实现架构文档 §3 中"门诊流程"示例的逻辑

**架构参考**: [§3 双重性质: 结构面+功能面](../architech/praxis-architecture.md)  
**影响代码**: `types.ts` (+structure/function/teleological_mapping), `mid-session-learner.ts` (+功能检查)  
**验证**: 用户纠正"挂号窗口→自助挂号机" → Praxis 判断功能未变 → 不降置信度

### M5.4 退役与亚存在 `[P2]`

**要做什么**:
- 被取代的结构不删除→进入"亚存在"状态
- 保留: superseded_by 映射 + 关键教训 + reactivation_conditions
- 旧场景重现或新结构衰退时→可重新激活
- `/praxis ontology` 中可见

**架构参考**: [§3 退役与亚存在](../architech/praxis-architecture.md)  
**影响代码**: `structure-lifecycle.ts` (+退役策略)  
**验证**: 结构 A 被结构 B 取代 → A 标记为 retired → B 置信度跌破阈值 → A 重新激活

### M5 完成标准

- [ ] MidSessionLearner 在用户纠正时 < 10ms 内下调关联结构置信度
- [ ] 跨 session 模式挖掘首次成功自动更新 ProtoTask 置信度
- [ ] 双重性质建模成功区分"替代实现"和"真错误"（替代实现不降置信度）
- [ ] 退役结构可在条件满足时重新激活

---

## 七、M6: 元认知自治 + 适配器（自我审视 + 多运行时）

**目标**: Praxis 能审视自身的框架缺陷 + 支持多个 Agent 运行时接入。

**前置条件**: M1-M5 完成，且有充足的跨领域生产数据。

### M6.1 Meta Layer + 范畴审计 `[P1]`

**要做什么**:
- 5 种 StructuralGap 检测信号（利用已有的遥测+审计数据）
- 范畴完备性检查: 被反复纠正但无法被现有类型捕获的模式 → category_blind_spot
- 康德式诊断分叉: "数据问题还是范畴问题？"
- 领域范畴同质性检查: 不同领域是否需要不同的 ProtoStructure 子类型
- 三种铁律: 人类审批 + 实验范围限制 + 可回滚

**架构参考**: [§8 元认知系统](../architech/praxis-architecture.md)  
**影响代码**: 新增 `analysis/category-auditor.ts`, `analysis/architecture-auditor.ts`  
**验证**: 积累 50 个 session → Meta Layer 检测到 1 个 category_blind_spot → 提议新范畴 → 人类审批

### M6.2 适配器接口 + 首个非 OpenClaw 适配器 `[P1]`

**要做什么**:
- 定义标准 AdapterInterface（7 个生命周期事件的方法签名）
- 将现有的 session-start/session-end 等重构为适配器无关的事件处理器
- 实现 openclaw-adapter（迁移现有逻辑）
- 实现 claude-code-adapter（通过 Claude Code hooks）
- 适配器层不做认知处理，只做协议转换

**架构参考**: [§1 三层运行时拓扑](../architech/praxis-architecture.md), [§10 生命周期事件](../architech/praxis-architecture.md)  
**影响代码**: 新增 `adapters/` 目录 (5 文件), 重构 `hooks/` 为运行时无关事件处理器  
**验证**: OpenClaw + Claude Code 两个适配器 → 同一 session 场景在两个运行时中产生相同的 ProtoStructure 输出

### M6.3 `/praxis audit` 命令 `[P2]`

**要做什么**:
- 输出 Meta Layer 审计报告: 范畴盲区 + 结构健康度(僵尸/低估) + 约束违反统计
- 输出格式: 文本报告（和 `/praxis ontology` 一致）

**架构参考**: [§13 用户可见的认知状态](../architech/praxis-architecture.md)  
**验证**: 运行 `/praxis audit` → 输出当前僵尸结构列表 + 约束违反统计

### M6.4 跨场景语义消歧 `[P2]`

**要做什么**:
- 维护跨场景同形异义词注册表
- message_received 时用当前场景上下文消歧
- 减少因"听错意思"导致的学习噪声

**架构参考**: [§7 跨场景语义消歧](../architech/praxis-architecture.md)  
**影响代码**: `analysis/semantic-disambiguator.ts` (+消歧逻辑)  
**验证**: 用户说"对接" → API 开发场景 → 正确消歧为"系统集成"而非"会议确认"

### M6 完成标准

- [ ] Meta Layer 在生产数据上至少提出 1 个经过验证的范畴盲区
- [ ] 至少 2 个适配器（OpenClaw + Claude Code）可互换运行
- [ ] 适配器切换不改变 Praxis 的核心行为（同一测试用例在两个适配器上产生相同输出）
- [ ] `/praxis audit` 可运行

---

## 八、里程碑依赖与并行度

```
M1 (ProtoStructure数据模型)    ← 无前置, 立即启动
  ├─→ M2 (上下文编排)          ← 依赖 M1
  │     ├─→ M3 (约束系统)      ← 依赖 M1, M2.1 可并行于 M2.2-2.4
  │     │     ├─→ M4 (置信度)  ← 依赖 M1+M2+M3
  │     │     │     ├─→ M5 (自主学习) ← 依赖 M1-M4
  │     │     │     │     └─→ M6 (元认知+适配器) ← 依赖 M1-M5
  │     │     │     │
  │     │     │     └─ M6 适配器部分可在 M3 后启动 (不依赖 M4-M5)
  │     │     │
  │     │     └─ M4.4 Curiosity 可在 M2.3 遥测完成后提前启动
  │     │
  │     └─ M3.2 约束验证 + M4.1 statistical-verifier 可在 M2.3 遥测完成后提前启动
  │
  └─ M6 适配器接口可独立于 M2-M5 启动 (适配器不依赖认知能力)
```

**关键并行路径**:
- **路径 A (认知主线)**: M1 → M2 → M3 → M4 → M5 → M6
- **路径 B (适配器)**: 与 M2-M5 完全并行，在 M1 完成后即可启动
- **路径 C (快速价值)**: M2.3(遥测) + M3.1(约束注入) 可在 M2.1 完成后提前交付

---

## 九、每个里程碑的新增/修改文件

| 里程碑 | 新增文件 | 修改文件 |
|--------|---------|---------|
| **M1** | `structure-graph.ts`, `extract-structures.md` | `types.ts`, `agentmemory-client.ts`, `session-start.ts`, `transcript-analyzer.ts`, `memory-context.md` |
| **M2** | `context-organizer.ts`, `context-pressure-monitor.ts`, `recall-structure.ts`, `attention-telemetry.ts` | `session-start.ts`, `session-end.ts` |
| **M3** | `constraint-validator.ts`, `constraint-extractor.ts`, `constraint-injection.md` | `session-start.ts`, `before-tool-call.ts`, `statistical-verifier.ts` |
| **M4** | `confidence-fuser.ts`, `statistical-verifier.ts`, `role-verifier.ts`, `concept-verifier.ts`, `counterfactual.ts`, `structure-lifecycle.ts`, `curiosity-engine.ts` | `types.ts`, `session-end.ts`, `agent-end.ts` |
| **M5** | `mid-session-learner.ts`, `pattern-miner.ts`, `semantic-disambiguator.ts` | `message-received.ts`, `before-tool-call.ts`, `cron-tick.ts`, `types.ts`, `structure-lifecycle.ts` |
| **M6** | `adapters/` (5 files), `category-auditor.ts`, `architecture-auditor.ts` | `hooks/` (重构为运行时无关) |

---

## 十、可验证预测

每条路线图决策附带可证伪的预测:

1. **如果 M1（ProtoStructure 数据模型）的方向正确**: M2-M6 的每个里程碑都能在已有数据模型上增量构建，不需要再次修改核心类型定义。如果 M3 实现时需要回头大改 ProtoStructure 接口 → 说明 M1 设计不充分。

2. **如果 M2（上下文编排）有效**: Tier A/B/C 注入后，LLM 输出中 `[STRUCTURE_USED]` 标记的 Tier A 采纳率 ≥ 60%。如果 < 30% → Tier 排序算法无效。

3. **如果 M3（约束注入）有效**: 约束注入后，违反已结晶约束的 LLM 行为减少 ≥ 70%。如果 < 30% → hard constraint 格式无效。

4. **如果 M5（自主学习）的 MidSessionLearner 有价值**: 实时纠正导致的置信度下调与 session_end 批量分析的结果一致性 ≥ 80%。如果 < 50% → 实时学习噪声过大。

5. **如果 M6（范畴演化）必要**: 在 M1-M5 完成后，≥ 1 种模式在被纠正 5+ 次后仍无法被现有 5 种 ProtoStructure 类型捕获。如果不存在 → 范畴演化可无限期推迟。

---

## 十一、不在此路线图中的事项

- **多模态记忆（图像/音频/视频）**: 架构文档 §9 定义了 AgentMemory 存储映射。当前 LLM 视觉能力受限于模型本身，Praxis 侧不需要额外工程。
- **GUI 能力模型查看器**: `/praxis status` 文本报告的信息密度优于图形界面。在文本报告不满足需求前不投资。
- **跨团队联邦学习**: 隐私和治理问题未解决。M6 完成后重新评估。
- **端到端自主任务分解**: 当前 plan-generator + ProtoTask 驱动。完全自主需要 M5 的模式挖掘成熟。
- **7 源置信度全量实现**: statistical + role + concept 三个验证器在数据不足时不强制激活。M4 目标 ≥ 3 源活跃即可。

---

> **立即启动**: M1 (ProtoStructure 数据模型 + 关系图 + 存储检索 + 基本注入)  
> **预计工期**: 4-6 周  
> **架构参考**: [§3 认知结构系统](../architech/praxis-architecture.md), [§9 数据模型](../architech/praxis-architecture.md)
