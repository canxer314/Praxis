# Why Praxis V8?

> 从第一性原理出发，分析 1M 上下文窗口如何改变 V7 的工程约束，以及为什么需要 V8。

---

## 一、不可否认的工程基础（与 V7 对比）

### 不变的事实

```
事实 1: LLM 是无状态的。每次 API 调用独立。→ V7 结论不变。
事实 2: Praxis 没有独立推理引擎。→ V7 结论不变。
事实 3: Hook 回调是同步的。message_received 不能阻塞超过 50ms。→ V7 结论不变。
事实 4: AgentMemory 是唯一的持久化层。→ V7 结论不变。
```

### 改变的事实

```
事实 5 (V7): Token 预算是稀缺资源 → 选择性注入 > 全量注入。
事实 5 (V8): Token 不再是稀缺资源（1M 上下文）→ 全量注入可行。
        新约束: 注意力是稀缺资源 → 组织质量 > 选择准确性。

事实 6 (V7): session_end LLM 分析受 token 限制 → 必须先统计预筛选再 LLM 归纳。
事实 6 (V8): session_end 可以处理完整 transcript → 一步到位，无信息损失。

事实 7 (V7): 上下文注入需控制在 500-1000 tokens。
事实 7 (V8): 上下文注入可扩展到 5000-50000 tokens。
        新约束: API 调用成本与上下文大小成正相关。
```

---

## 二、约束转移：从 token 稀缺到注意力稀缺

这是 V8 最根本的架构驱动力。

```
V7 的核心约束:
  ┌────────────────────────────────────────────┐
  │  Token 预算 (稀缺)                           │
  │    ↓                                        │
  │  必须选择: 哪些结构注入？哪些共现对分析？       │
  │    ↓                                        │
  │  架构复杂度集中在 "选择" (selection)          │
  │  → scene-matcher, salience-marker,          │
  │    pattern-detector, context-builder        │
  └────────────────────────────────────────────┘

V8 的核心约束:
  ┌────────────────────────────────────────────┐
  │  注意力预算 (稀缺)                           │
  │    ↓                                        │
  │  必须组织: 所有结构都在，但如何让 LLM 关注到？  │
  │    ↓                                        │
  │  架构复杂度集中在 "组织" (organization)       │
  │  → context-organizer (层级化, 排序, 显著性标记)│
  └────────────────────────────────────────────┘
```

⚠️ 此处存在不确定性：LLM 注意力在 1M 上下文中的衰减程度因模型而异。DeepSeek-V4-Pro 的注意力分布特性尚未被公开测试。如果注意力均匀分布，层级化组织的价值降低。

---

## 三、逐模块分析：为什么删除、为什么新增

### 3.1 删除：salience-marker.ts（regex 预标记）

**V7 为什么需要它**：message_received 不能调 LLM，token 预算不够在 session_end 中把完整 transcript 交给 LLM 分析 → 必须在 message_received 中做轻量预标记来压缩信息。

**为什么可以删除**：1M 上下文下，可以在 session_end 中将本会话 + 历史会话的完整 transcript 直接交给 LLM。LLM 从原始对话中提取 SalientElement 的质量远高于 regex。

**删除后的信息流**：
```
V7: message_received → regex 预标记 → 噪声候选 → session_end → PMI 筛选 → LLM 归纳
V8: message_received → 归档原始消息 → session_end → 完整 transcript 交给 LLM → 一步提取
```

### 3.2 删除：pattern-detector.ts（PMI 统计预筛选）

**V7 为什么需要它**：token 预算不够把所有 SalientElement 的两两共现对喂给 LLM → 需要用 PMI 预筛选"统计上显著的"共现对。

**为什么可以删除**：完整 transcript 中 LLM 自己就能检测模式，不需要统计指标的预筛选。PMI 预筛选不仅多余，还可能在过滤"统计上不显著但语义上关键的"模式时引入信息损失。

### 3.3 拆分：scene-matcher.ts — 两个功能，两种命运

**V7 的 scene-matcher 做了两件完全不同的事**：

```
功能 A: 选择性注入
  "计算每个 CognitiveStructure 的适配度 → 只注入匹配度 > 0 的结构"
  驱动因素: token 预算不够注入所有结构
  V8 处理: ❌ 删除。全量注入下不需要此功能。

功能 B: 场景识别
  "当前会话的特征与哪个 scenario 最匹配？→ 确定 scenario_id"
  驱动因素: Praxis 需要知道当前在哪个场景中，才能:
    - 在 session_end 中按 scenario_id 加载正确的历史 transcript
    - 将新的 SalientElement 关联到正确的场景
    - 更新正确的 ProtoStructure
  这是认知架构的基础操作——没有它，所有累积分析失去锚点。
  V8 处理: ✅ 保留。以简化形式实现为 scene-recognizer.ts。
```

**为什么 V8 初版错误地将其全部删除**：scene-matcher 的两个功能在 V7 中被实现在同一个模块中，V8 设计时将其视为一个整体。第一性原理审视后发现，选择性注入（功能 A）的 token 妥协掩盖了场景识别（功能 B）的架构必要性。

**V8 修正后的场景识别**：
- 不再用于决定"注入什么"（全量注入）
- 仍用于决定"当前在哪个场景中"（场景归属）
- 因为不再承担"选择"职责，识别可以更粗糙（80% 准确就足够——错了不会漏掉重要结构，只是分析时可能归错场景）
- 粗糙但存在 > 精确但缺失。V7 的选择性注入中，识别错误意味着结构被遗漏。V8 中，识别错误只影响 session_end 的 transcript 分组——LLM 在分析时仍有能力自我纠正

### 3.4 拆分：context-builder.ts — 两种策略，两种命运

**V7 有三种注入策略**：exact/fuzzy/weak/zero_prior 对应不同的 prompt 模板和 token 预算。

**V8 的分析**：

```
功能 A: 选择性注入（不同策略 = 不同 token 预算）
  exact → 完整注入, fuzzy → 部分注入, weak → 最小注入, zero_prior → 仅感知指令
  驱动因素: token 预算 → 不同场景给不同量的上下文
  V8 处理: ❌ 删除。全量注入下不需要按场景分配 token。

功能 B: 置信度校准信号
  "这是确定场景的流程（请信任）" vs "以下模式仅供参考（请验证）"
  驱动因素: LLM 需要知道哪些结构可信、哪些是试探性的
  这是认知操作——不是 token 妥协。
  V8 处理: ✅ 保留。在 context-organizer 的 Layer 2 中为每个结构附加置信度校准指令。
```

**V8 只有一种注入策略**：全量注入，但按层级组织，且每个结构附带置信度校准信号。

```
Layer 2 中的置信度校准（每个结构前附加）:

  高置信度固化结构 (confidence > 0.8):
    "## 确定结构: {name} (置信度 {confidence})
     以下是你对该场景的确定理解。请基于这些结构执行任务。"

  中置信度 ProtoStructure (confidence 0.4-0.8):
    "## 参考模式: {name} (置信度 {confidence}, {n}次观察)
     以下是你在该场景中观察到的模式，可能不完整。请参考但保持警惕。"

  低置信度 ProtoStructure (confidence < 0.4):
    "## 试探性假设: {name} (置信度 {confidence}, 仅{n}次观察)
     以下是初步假设，很可能是错的。请主动验证而非盲从。"

  跨场景引用 (不同 scenario 的结构):
    "## 相关场景参考: [{other_scenario}] {name}
     以下模式来自类似但不完全相同的场景。可能有关联，但不要直接套用。"
```

### 3.5 新增：statistical-verifier.ts（统计验证器）

**V7 缺失了什么**：LLM 既是"预测正确/失败的判断者"（[PREDICTION_FAILED] 标记），又是"ProtoStructure 的构造者"。同一个 LLM 的错误会自我强化。

**V8 为什么新增**：

```
这是打破 "LLM 自引用闭环" 的独立信号源：

输入: 本会话的实际工具调用序列
      + 当前场景的 ProtoSequence 预测序列

算法: 序列对齐
  1. 对每个 ProtoSequence 步骤，在工具调用序列中搜索匹配
     匹配条件: 步骤 label 与工具名/参数/结果摘要的语义相似度
  2. 如果使用 embedding 模型做相似度 → 仍然是独立信号（不是同一个 LLM）
  3. 如果是简单字符串匹配 → 完全独立

输出: 独立于 LLM 自报告的验证结果
  - 匹配的步骤: N/M
  - 错位的步骤: [...]
  - 缺失的步骤: [...]
  - 未预测的额外步骤: [...]

这个信号的价值不在于它比 LLM 标记更准——而在于它与 LLM 标记无关。
两个独立信号同时指向"失败"→ 高置信度的失败。
两个独立信号矛盾 → 至少一个错了 → 保持现状，不调整置信度。
```

### 3.6 新增：local-cache.ts（AgentMemory 降级缓存）

**V7 缺失了什么**：AgentMemory 不可用 → 全系统失忆。V7 设计中有 LLM 调用的降级策略，但没有存储层的降级策略。

**V8 为什么新增**：在 session_start 和 session_end 中维护一个本地文件缓存（JSON），当 AgentMemory 不可用时作为降级读写目标。AgentMemory 恢复后，缓存数据异步同步回 AgentMemory。

```
降级策略:
  AgentMemory 读超时(>2s) → 读 local-cache
  AgentMemory 写超时(>3s) → 写 local-cache + 标记 "pending_sync"
  AgentMemory 恢复 → 逐条同步 pending_sync → 清理标记
  
  注意: local-cache 不是 AgentMemory 的替代品，是临时降级方案。
  缓存的 TTL = 7 天，过期自动清理。
```

---

### 3.7 复杂连续场景的额外考量

上述逐模块分析覆盖了 V8 相对于 V7 的架构变化。但在复杂的大型连续任务中（多场景交叉、长期运行、结构大量积累），还需要额外机制：

**Gap 1: 结构爆炸与注意力稀释**

```
简单场景（< 6 个月, < 50 个 ProtoStructure）:
  Layer 2 注入: ~20K tokens → 1M 上下文的 2% → 无压力

复杂场景（2 年 + 200 个结构）:
  Layer 2 注入: ~80K tokens → 1M 上下文的 8%
  问题不是容量——是 LLM 需要在 200 个结构中自行判断哪 5 个与当前会话相关
  
V8 修正: Layer 2 内部按相关性预排序（见 context-organizer 修订）:
  Tier A (最前面, 完整详情): 当前场景的结构 → ~5K tokens
  Tier B (中间, 摘要+引用): 相近场景的结构 → ~20K tokens
  Tier C (最后, 仅名称+一句话): 不相关场景的结构 → ~5K tokens
  
  LLM 仍然能看到所有结构，但注意力被引导到最相关的部分。
```

**Gap 2: 结构生命周期管理**

```
连续运行 1 年+ 后，部分结构可能:
  - 超过 3 个月未激活 → 占用注意力但无价值
  - 置信度 < 0.3 且停滞 → 可能是错误假设
  - CognitiveStructure 每月使用 < 1 次 → 可能已过时

V8 修正: 新增 structure-lifecycle.ts
  - 归档: 3 个月未激活 → 移出默认注入列表（仍可通过检索访问）
  - 清理: 置信度 < 0.2 + 观察 > 10 + 3 个月无变化 → 提示用户清理
  - 降级: CognitiveStructure 使用频率过低 → 降级为 ProtoStructure
```

**Gap 3: 累积分析的可持续性**

```
观察次数增长 → transcript 累积量增长:
  5 次会话 × 20K tokens = 100K → LLM 分析延迟 ~10s
  20 次会话 × 30K tokens = 600K → LLM 分析延迟 ~40s+
  50 次会话 → 超出 session_end 延迟预算

V8 修正: 自适应分析策略
  - N ≤ 5: 全量分析（每次 session_end 加载全部历史 transcript）
  - 5 < N ≤ 20: 增量分析（加载最近 5 次 + 现有 ProtoStructure 摘要）
  - N > 20: 抽样分析（分层采样 + 置信度引导的加权）
  
  当观察次数超过 20 时，ProtoStructure 通常已足够稳定，
  增量分析足以捕捉退化信号，不需要每次都做全量分析。
```

**这些修正已纳入 how.md 和 where.md 的修订中。**

---

## 四、V8 能力可行性矩阵

| 能力 | V7 评估 | V8 评估 | V8 变化原因 |
|------|--------|--------|-----------|
| Open Perception | 🟢 可行 (混合策略) | 🟢 **更简单** | 删除 regex 预标记，LLM 直接分析完整 transcript |
| ProtoSequence 构造 | 🟡 需验证 | 🟢 **质量更高** | 无 PMI 信息损失; LLM 直接看到原始对话 |
| ProtoRole 构造 | 🟡 需验证 | 🟢 **质量更高** | 完整 transcript 提供更丰富的角色行为线索 |
| ProtoConcept 构造 | 🟡 需验证 | 🟡 仍需验证 | 大上下文帮助有限（概念归纳依赖 LLM 理解能力而非数据量） |
| ProtoPurpose 构造 | 🟢 可行 | 🟢 可行 | 无显著变化 |
| Interactive Validation | 🟢 可行 | 🟢 **更可靠** | 双信号融合减少单一信号误判 |
| Crystallization | 🟢 可行 | 🟢 **更自动** | 自动推进阶梯减少人类依赖 |
| Degradation | 🟢 可行 | 🟢 **更及时** | 从 cron-only 到实时 + cron |
| Layer Self-Mod (Level 1-3) | 🟢 已有 | 🟢 保持 | 无变化 |
| Layer Self-Mod (Level 4-5) | 🟡 可降级 | 🟡 保持 | 大上下文不改变"设计概念≠代码模块"的发现 |
| 统计验证 (新增) | ❌ 不存在 | 🟢 可行 | 纯本地算法，不需要 LLM |
| AgentMemory 降级 (新增) | ❌ 不存在 | 🟢 可行 | 本地文件缓存，低实现成本 |

---

## 五、核心风险与缓解

| 风险 | V7 是否有 | V8 变化 |
|------|----------|--------|
| LLM 归纳 ProtoStructure 质量差 | 有 (🟡) | **🔵降低**: 输入质量提升（完整 transcript vs regex 噪声） |
| Token 预算被挤占 | 有 | **🟢消除**: 不再有 token 预算硬约束 |
| ProtoStructure 相互矛盾 | 有 | **🔵降低**: 累积分析让 LLM 看到跨会话一致/矛盾 |
| 用户不理解新交互模式 | 有 | 不变 (Phase 1 仍为静默观察) |
| **注意力稀释** (新) | 无 | **🔴新增**: LLM 在大量注入中无法聚焦关键结构 → **🟡缓解**: 相关性预排序 + 置信度校准 |
| **跨场景结构污染** (新) | V7 有 scene-matcher 保护 | **🟡新增**: 不相关场景的结构被 LLM 误用 → **🟡缓解**: Tier C 仅提供名称和一句话描述 |
| **结构爆炸** (新) | 无 | **🟡新增**: 长期运行后结构数量膨胀 → **🟢缓解**: structure-lifecycle.ts 自动归档 |
| **API 成本失控** (新) | 无 | **🟡新增**: session_end 每次可能消耗 100K-200K tokens |
| **session_end 延迟超标** (新) | 无 | **🟡新增**: 大 prompt 处理延迟可能超过 20s → **🟡缓解**: 自适应分析策略 |
| AgentMemory 单点故障 | 无缓解 | **🟢缓解**: local-cache 提供降级路径 |

---

## 六、反向论证

**反方论点**："V8 的改进方向是错误的。与其为 1M 上下文重新设计架构，不如保持 V7 的架构不变——当 token 不再是瓶颈，V7 的 regex 和 PMI 预筛选不会变差，只是变得不必要。它们作为'不需要删掉'的冗余步骤继续运行不会有害。V8 新引入的统计验证器和层级化组织器反而增加了架构复杂度。保持简单比追求最优更重要。"

**为什么这不是最优选择**：
1. Regex 预标记不仅"不必要"——它在 message_received 中持续产生噪声候选，这些噪声在 session_end 中仍需要被去重和过滤。**它消耗工程资源维持一个不再创造价值的步骤。**
2. PMI 预筛选不仅"不必要"——它**主动造成信息损失**。过滤掉的"统计不显著但语义关键"的模式永远不会被 LLM 看到。在大上下文下保留它是主动损害质量。
3. 层级化组织器可能是过度设计（参见 3.4 的警告）。但统计验证器不是——它是打破 LLM 自引用闭环的独立机制，无论上下文多大都需要。

**什么条件会改变结论**：
- 如果实验证明扁平化 = 层级化 → 删除 context-organizer，V8 比 V7 更简单
- 如果 LLM [PREDICTION_FAILED] 标记准确率 > 90% → 统计验证器权重可调至 0，但模块保留（成本极低）
- 如果 DeepSeek-V4-Pro 的 API 定价使每次 200K token 分析不可接受 → 需要重新评估累积分析的经济可行性

---

## 七、可证伪预测

1. 如果统计验证器在实际使用中与 LLM 标记的一致率 > 85% → 统计验证器的独立价值有限（但仍可在 15% 的不一致场景中提供关键纠正）
2. 如果层级化组织的 ProtoStructure 利用率不显著高于扁平化 → 删除 context-organizer
3. 如果 auto-crystallization 的错误率 > 10% → 收紧自动推进阈值或禁用

---

## 兄弟文件

- [What is Praxis V8?](what-is.md) — V8 的工程定义
- [Who is it for?](who.md) — 角色职责的变化
- [How does it work?](how.md) — 层级化组织、统计验证、双信号融合
- [When does it operate?](when.md) — 简化的实现路线图
- [Where does it sit?](where.md) — 模块树（删除 + 新增 + 修改）
- [Architecture Design](design.md) — 技术规格与 API 契约
