# Why Praxis V7?

> V7 从第一性原理出发，分析 V6 的每一项认知能力在工程上是否可落地、代价是什么、需要做什么简化。

---

## 一、不可否认的工程基础

在讨论"能不能做"之前，先确认什么是不可否认的：

### 1.1 LLM 是无状态的

```
事实: 每次 API 调用是独立的。LLM 不记得上一句话——除非它在上一条消息的上下文中。
推论: Praxis 的全部"记忆"能力 = 把正确的历史注入到下一次 API 调用的 messages 数组中。
```

### 1.2 OpenClaw 的 Agent Loop 是同步的

```
事实: 用户发消息 → message_received hook → Agent 开始运行 → 工具调用 → agent_end hook → 返回用户。
      所有 Hook 回调在 Agent Loop 的特定生命周期点同步执行。
推论: Praxis 不能在 Hook 回调中做耗时操作（会阻塞用户看到回复）。
      重计算必须异步化（cron 任务、session_end 后台处理）。
```

### 1.3 AgentMemory 是唯一的持久化层

```
事实: Praxis 不拥有独立的数据库。所有持久化通过 AgentMemory MCP。
可用 API:
  • memory_save(type, data) — 存储任意类型的记忆条目
  • memory_slot_get/set/append/replace — Key-Value 槽位存储
  • memory_smart_search(query, type) — 语义搜索已有记忆
  • memory_patterns(type) — 检测记忆中的模式
  • memory_crystallize(memory_id) — 标记记忆为"固化"
  • memory_reflect() — 触发反思/洞察生成
  • memory_lesson_save(lesson, type) — 保存学习事件
  • memory_recall(query) — 召回相关记忆
推论: V6 的所有数据模型（SalientElement, ProtoStructure 等）必须映射到这些 API。
```

### 1.4 Token 预算是稀缺资源

```
事实: 每次 LLM 调用有上下文窗口限制。注入的 Praxis 记忆越多，留给实际任务的空间越少。
推论: 选择性注入 > 全量注入。必须根据场景相关性过滤要注入的结构。
      一个"医院专家"Praxis 在写代码时不应该加载 23 个医疗 ProtoStructure。
```

### 1.5 没有独立的"Praxis 推理引擎"

```
事实: Praxis 没有自己的推理能力。所有"分析"、"归纳"、"判断"都需要调用 LLM。
推论: 每次"Praxis 想事情"= 一次额外的 LLM API 调用 = 消耗 token + 增加延迟。
      必须在"想多少"和"响应多快"之间做权衡。
```

---

## 二、V6 能力 vs 工程约束：逐项分析

### 2.1 Open Perception（开放感知）

**V6 描述**：在零先验场景中标记 salient 元素，不强行分类。

**工程分析**：

```
方案 A: 在 message_received 中调用 LLM 分析消息 → 提取 SalientElement
  ❌ 问题: message_received 是同步 Hook，LLM 调用增加 2-5 秒延迟
  ❌ 问题: 每条消息都调用 LLM 分析 → token 成本过高

方案 B: 在系统提示中注入"开放感知"指令，让 Agent LLM 自己在分析消息时标记
  ✅ 优点: 零额外延迟（指令在现有上下文中）
  ⚠️ 局限: 依赖 Agent LLM 的执行质量，可能被忽略或不一致
  ⚠️ 局限: Agent LLM 的主要任务是执行用户指令，不是做认知分析

方案 C: 混合策略——系统提示 + session_end 批量分析
  ✅ message_received: 轻量级关键词/模式匹配（本地逻辑，不需要 LLM）
     → 预标记候选 SalientElement（基于重复词、用户强调词、序列转折词）
  ✅ 系统提示: 注入"当前场景可能的新领域，注意观察和标记"
  ✅ session_end: 用 LLM 分析本会话的所有消息 + 已标记的候选元素
     → 去重、合并、生成正式 SalientElement
  ✅ 延迟: 仅 session_end 有一次性 LLM 调用成本（会话结束时用户无感知）
```

**结论**：方案 C 可行。关键是本地预标记逻辑的质量——它决定了多少候选元素能进入 LLM 精化阶段。

### 2.2 Proto-Structure Construction（原型构造）

**V6 描述**：从 SalientElement 的共现模式中检测 ProtoSequence、ProtoRole、ProtoConcept、ProtoPurpose。

**工程分析**：

```
核心问题: "检测共现"到底怎么做？

方法 1: 统计方法（代码逻辑，不需要 LLM）
  ├─ 时间邻接: A 在 B 之前出现了 N 次 → 共现分数
  ├─ 同现概率: A 和 B 在同一会话中出现的联合概率
  ├─ 互信息: 元素之间的统计依赖关系
  └─ ⚠️ 局限: 只能检测表面共现，不理解语义关系

方法 2: LLM 语义归纳
  ├─ 将所有 SalientElement 喂给 LLM
  ├─ Prompt: "这些是在同一类型场景中观察到的元素。请检测:
  │   1. 哪些元素似乎形成序列？（A→B→C）
  │   2. 哪些元素属于同一角色？（X 和 Y 似乎由同一个人/角色完成）
  │   3. 哪些元素构成一个概念？（X、Y、Z 似乎属于同一类别）
  │   4. 整个场景似乎在达成什么目的？"
  └─ ⚠️ 局限: 输入长度有限（不能一次喂入 100 个元素）

方法 3: 混合策略（推荐）
  ├─ Step 1: 统计方法预筛选（找出统计上显著的共现对）
  ├─ Step 2: 将预筛选的候选喂给 LLM 做语义归纳
  ├─ Step 3: LLM 输出 ProtoStructure（带置信度）→ 存入 AgentMemory slot
  └─ 触发时机: session_end（当一个场景的观察数 > 2 时）
```

**⚠️ 此处存在不确定性**：LLM 从 raw interaction traces 中归纳 ProtoSequence 的质量尚未验证。这是 V7 最早需要实验验证的假设。

**结论**：方法 3 可行，但需要实验调优 LLM prompt 和统计预筛选阈值。

### 2.3 Interactive Validation（互动验证）

**V6 描述**：每次场景出现时，用 ProtoStructure 做预测 → 与实际对比 → 更新置信度。

**工程分析**：

```
这是 V6 中最容易工程化的部分：

agent_end Hook:
  ├─ 检查本会话是否使用了某个 ProtoStructure 做预测
  ├─ 预测了什么？（从系统提示中提取预测标记）
  ├─ 实际发生了什么？（从 agent_end 的 result 中提取）
  ├─ 对比 → 更新置信度
  │   • 预测正确: confidence += 0.1
  │   • 预测错误: confidence -= 0.2（错误信息量更大）
  │   • 不确定性（无法判断对错）: confidence 不变
  └─ 将更新后的置信度写回 AgentMemory slot

关键设计决策：
  ├─ 如何让 LLM "使用" ProtoStructure 做预测？
  │   → 系统提示中注入: "你对这个场景的理解：挂号→等待→问诊（置信度0.6）。
  │      在操作前，如果现实与这个理解冲突，请标记 [PREDICTION_FAILED: 原因]"
  │
  └─ 如何从 LLM 输出中提取预测结果？
      → 结构化标记: [PREDICTION_MATCHED] / [PREDICTION_FAILED: 原因]
      → agent_end 解析这些标记 → 更新置信度
```

**结论**：完全可行。核心是设计清晰的预测标记协议。

### 2.4 Crystallization / Degradation（固化/退化）

**V6 描述**：ProtoStructure 置信度达标 → 固化为 CognitiveStructure。固化结构持续失败 → 退化。

**工程分析**：

```
固化流程（工程上很直接）:

session_end:
  ├─ 遍历所有 ProtoStructure
  ├─ 检查固化条件:
  │   • 核心维度置信度 > 0.8
  │   • 观察次数 >= min_observations (5)
  │   • 最近 3 次观察没有显著反例
  ├─ 条件满足 → 生成 CrystallizationProposal
  │   → 数据格式转换: ProtoStructure → CognitiveStructure
  │   → 存储到 AgentMemory slot: "pending_crystallizations"
  │   → 通知用户: "/praxis crystallize 查看待固化的结构"
  └─ 用户批准 → data 从 proto_structures slot 移到 structure_registry slot
                → 调用 memory_crystallize(proto_memory_id)
                → 该场景后续不再触发 Proto-Cognitive Engine

退化流程:

每周 cron:
  ├─ 遍历所有 crystallized structures
  ├─ 检查退化条件:
  │   • 最近 N 次使用中的预测准确率 < 0.7
  │   • 累计反例 > 3 次
  │   • 用户主动标记为 "理解错误"
  ├─ 退化:
  │   → structure 状态改为 "degraded"
  │   → 核心数据保留，重新包装为 ProtoStructure
  │   → 置信度 = 原有置信度 * 0.7（保守降级）
  │   → 反例保留为新的修正信号
  └─ 通知用户: "/praxis degraded 查看退化的结构"
```

**结论**：完全可行。本质是数据格式转换 + 置信度驱动的状态机。

### 2.5 Layer Self-Modification（层自修改）

**V6 描述**：Praxis 可以在人类治理下修改层定义、层边界、甚至 Meta Layer 自身。

**工程分析**：

#### 先确认：Level 4-6 在 V6 中到底指什么

| Level | V6 定义 | V6 给的例子 |
|-------|---------|------------|
| Level 4 | 层定义或层边界的修改 | 合并 L3 和 L4 的功能，新增 L3.5；用 NetworkCognitiveModel 替代层级结构处理创意场景 |
| Level 5 | Meta Layer 自身的修改 | 给 Structural Inadequacy Detector 增加"情感适配质量"检测维度 |
| Level 6 | GovernancePolicy 修改 | Praxis 不能提议，只能人类手动编辑配置文件 |

#### 核心发现：V1-V6 的"层"是设计概念，不是代码模块

```
V1-V6 说的"六层架构":
  L1 工具集成、L2 任务编排、L3 知识管理、L4 学习闭环、L5 能力模型、L6 自主决策

V7 看到的实际代码组织:
  hooks/           ← L3 的知识检索在这里、L4 的学习触发也在这里
  orchestration/   ← L2 的任务编排在这里、L5 的能力评估也在这里
  analysis/        ← L4 的模式检测在这里、L5 Meta Layer 的自检也在这里
  prompts/         ← 所有层的 prompt 注入都在这里
  memory/          ← L3 的存储逻辑在这里
  types/           ← 所有层的数据类型在这里

结论: 不存在 L3.ts 或 L4.ts 可以被"合并"。
      层的逻辑散布在多个文件中，按功能（Hook处理/编排/分析/提示词/存储）而非按层组织。
```

**这就是为什么 V1-V6 没有发现这个问题**：V1-V6 一直在做概念设计，用认知科学语言描述"Praxis 应该表现出什么行为"。"六层架构"在这个语境下是合理的功能划分。V7 是第一次切换到工程语言，切换后才暴露了"设计概念"和"代码模块"之间的映射不是 1:1 的。这就像建筑设计师画功能区（起居区、睡眠区），但施工图按结构柱网和管线走向组织——施工时才发现的摩擦，设计阶段看不到。

#### 逐级分析：每个 Level 在工程上到底意味着什么

```
Level 4: 修改层定义 / 层边界

  V6 场景 A: "合并 L3 和 L4，创建 L3.5 过程知识引擎"
  
  按设计语言的思路: 找到 L3 模块和 L4 模块 → 合并它们 → 生成 L3.5
  
  实际工程中: L3 和 L4 不是两个模块，是一组分布在多个文件中的行为。
  "过程性知识学到即用"这个需求在工程上的真正实现是:
    ① 在 session_start 时，对"过程性知识密集型"场景，
       同时加载知识存储提示 + 学习闭环提示（原来可能分开加载）
    ② 在 context-builder.ts 中调整 prompt 组装逻辑
    ③ 在 scene-matcher.ts 中增加一个新的场景类型标记
    
  这三个操作的对象都是 AgentMemory 中的配置数据 + prompt 模板，
  不需要修改插件代码。→ 本质上是 Level 2（创建新 CognitiveStructure）
  
  V6 场景 B: "创意场景用 NetworkCognitiveModel 替代层级结构"
  
  实际工程实现: 在 CognitiveStructure 的 core_model.process.type 
  字段中新增一个 "network" 类型，然后在 ProcessEngine 的
  执行逻辑中增加对 network 类型的处理分支。
  
  如果 ProcessEngine 的 process type 是数据驱动的（switch on type field），
  那么新增一个 type 就是新增一个 CognitiveStructure → Level 2。
  如果 ProcessEngine 硬编码了线性流程 → 才需要改代码。

Level 5: Meta Layer 自身修改

  V6 场景 C: "给 Detector 增加情感适配质量检测维度"
  
  实际工程实现:
    ① 在 analysis/architecture-auditor.ts 的 prompt 中增加一条检测指令
    ② 在 degradation-checker.ts 中增加一个信号采集点
    ③ 如果 prompt 模板存储在 AgentMemory 中 → 修改 prompt 数据 → Level 1
    ④ 如果信号采集需要有新的 Hook 回调代码 → 需要改代码 → 真正的 Level 5

Level 6: GovernancePolicy 修改
  
  V6 已经明确: Praxis 不能提议。V7 保持不变。
```

#### 关键结论

```
V6 的 Level 4-5 场景在工程上大部分可以降级处理:

  "合并层" → 调整 prompt 模板 + 数据检索策略      → Level 1-2
  "替代组织结构" → 新增 CognitiveStructure (数据)   → Level 2
  "增加检测维度" → 修改分析 prompt (数据)           → Level 1
  "修改 Detector 算法" → 需要改代码                  → Level 5 (真正的)

  触碰到代码的修改（如重写 Detector 算法、重构 Hook 编排逻辑）非常罕见。
  V7 的策略: 这些罕见情况 → 输出 Architecture Improvement Proposal 
  （架构改进建议文档），由人类开发者决定是否实施。
```

#### 为什么这不是在否定 V6

V6 的 Level 4-5 设计意图完全正确——Praxis 确实需要在发现架构组织不够好时做出调整。V7 没有推翻这个意图，只是发现：**实现方式比 V6 设想的更简单。** 大部分"层修改"通过 AgentMemory 中的数据 + prompt 模板就能实现，而这些机制已经在 V7 的 Phase 1-3 中覆盖了。V6 的需求被更简单的工程手段满足了——这说明 V6 的认知设计是合理的，不是过度设计。

**结论**：Level 1-2 已有（V4/V5）。Level 3 简化为结构间关系管理。Level 4-5 的大部分场景通过数据驱动的 prompt + 配置修改实现（降级为 Level 1-3）。触碰到代码的极端情况 → 输出"架构改进建议"给人类开发者。Level 6 保持人类手动编辑。

---

## 三、V6 能力可行性矩阵

| V6 能力 | 工程可行性 | 核心挑战 | V7 策略 |
|---------|-----------|---------|--------|
| Open Perception | 🟢 可行 | 本地预标记质量 | 混合策略：本地预筛选 + session_end LLM 分析 |
| ProtoSequence 构造 | 🟡 需验证 | LLM 归纳质量未知 | 统计预筛选 + LLM 语义归纳 + 实验调优 |
| ProtoRole 构造 | 🟡 需验证 | 角色边界模糊 | 聚类 + LLM 标注 + 用户纠正 |
| ProtoConcept 构造 | 🟡 需验证 | 概念粒度控制 | 语义聚类 + LLM 假设生成 |
| ProtoPurpose 构造 | 🟢 可行 | 置信度困难 | LLM 语义摘要 + 会话级追问用户 |
| Interactive Validation | 🟢 可行 | 预测标记协议 | 结构化标记 [PREDICTION_MATCHED/FAILED] |
| Crystallization | 🟢 可行 | 阈值校准 | 数据格式转换 + 人类审批 |
| Degradation | 🟢 可行 | 退化信号可靠性 | 统计监控 + 自动标记 |
| Layer Self-Mod (Level 1-2) | 🟢 已有 | - | V4/V5 已有 |
| Layer Self-Mod (Level 3) | 🟡 可简化 | 真正的结构重组需改代码 | 简化为关系管理 |
| Layer Self-Mod (Level 4-5) | 🟡 大部分可降级 | 设计概念≠代码模块 | 数据驱动化 → 降级为 Level 1-3；触达代码的极端情况 → 架构建议输出 |
| Layer Self-Mod (Level 6) | 🟢 保持 V6 设计 | - | 人类手动编辑，Praxis 不参与 |

---

## 四、三个必须做的简化

### 简化 1：开放感知不是"零分类"，而是"延迟分类"

V6 强调"不强行分类"。但 LLM 天然会分类——它不理解"不要分类"是什么意思。更务实的做法：

```
不是: "请不要分类这些元素"（LLM 做不到）
而是: "将这些元素标记为 tentative，用带问号的标签，置信度设为低值"
       SalientElement {label: "挂号?", confidence: 0.3, type: "unknown_action"}
```

### 简化 2：ProtoStructure 构造不是"涌现"，而是"LLM 被问了一个好问题"

V6 的语言暗示 ProtoStructure 会从数据中"自发涌现"。工程上，它是：

```
session_end 时:
  1. 把本场景的所有 SalientElement 序列化
  2. 构造 prompt: "以下是在 X 场景中观察到的元素序列。请检测序列模式、角色聚类、概念分组。"
  3. LLM 返回结构化 JSON
  4. 解析为 ProtoStructure 数据
  5. 存入 AgentMemory

这不是"涌现"，这是"有策略地在 session 结束时让 LLM 做一次分析"。
```

### 简化 3：人类不只是在"审核"，而是在"提供 Praxis 无法自己获取的信息"

V6 设计了很多"Praxis 主动提问"的交互。但 LLM 不会"记住"要问什么——除非在上下文中明确告诉它。务实方案：

```
session_end 生成待验证问题:
  → 存入 AgentMemory slot: "pending_questions"
  
session_start 检索待验证问题:
  → 注入到系统提示: "以下是关于当前场景的待验证问题，在合适的时机向用户提问: ..."

这样 Praxis "知道"要问什么，不是因为它在"想"，而是因为系统提示说了。
```

---

## 五、核心风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| LLM 归纳 ProtoStructure 质量差 | 原型不准确 → 后续全部错误 | Phase 1 仅做 SalientElement 存储，不做自动构造。人工 review 前 20 个原型后再决定是否自动化 |
| SalientElement 噪声过多 | 有意义信号被淹没 | 本地预标记 + 显著性阈值（至少 3 次重复才算 salient） |
| Token 预算被认知操作挤占 | Agent 实际任务表现下降 | 认知分析在 session 边界（session_end/cron）执行，不与用户请求争 token |
| ProtoStructure 相互矛盾 | 系统认知混乱 | 每个场景维护独立的 ProtoStructure 集合，跨场景模式由 V5 的 Constructor 处理 |
| 用户不理解新交互模式 | 认知成长停滞 | V7 Phase 1 完全静默——Praxis 只观察不提问。Phase 2 才引入主动提问 |

---

## 六、反向论证

**反方论点**："V7 把 V6 的宏大设计简化成了一堆 prompt engineering + CRUD。这是在降级 V6 的愿景。"

**为什么这不是降级**：

1. **V6 的愿景本身没有变。** V7 只是承认了一个事实：LLM 是无状态的，所有"认知"都是 context injection 的表现。这不是降级——这是诚实。
2. **好的工程简化不应该减少能力。** SalientElement 还是会被标记，ProtoStructure 还是会被构造，置信度还是会被更新。只是实现方式从"神秘的认知引擎"变成了"明确的 Hook 回调 + Prompt 模板 + 数据存储"。
3. **分阶段交付保护了愿景。** V7 Phase 1 只做 SalientElement 存储和人工 review，Phase 2 加入自动原型构造，Phase 3 加入交互验证。每一步都可以独立验证价值。
4. **如果 LLM 的能力边界扩大（更好的推理、更长的上下文），V7 的架构可以无缝升级。** 因为 V7 已经正确定位了 Praxis 的角色：编排层，不是推理引擎。

**什么条件会改变结论？**
- 如果未来出现能持续运行、有独立记忆的 LLM 架构 → V7 的"编排层"定位可能需要重新审视
- 如果 AgentMemory 提供原生后台处理能力 → 部分 session_end 分析可以移到 AgentMemory 侧

---

## 兄弟文件

- [What is Praxis V7?](what-is.md) — V7 的工程定义
- [Who is it for?](who.md) — 开发者、运维者、用户三角色
- [How does it work?](how.md) — Hook 编排、Prompt 工程、数据流详解
- [When does it operate?](when.md) — 实现路线图与分阶段交付
- [Where does it sit?](where.md) — 工程架构与模块划分
- [Architecture Design](design.md) — 技术规格与 API 契约
