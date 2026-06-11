# Why Praxis V11?

> 从第一性原理出发，分析为什么 V10 的"开环上下文注入"不足以实现真正的知行合一，为什么需要在 Praxis 和 OpenClaw 之间建立四个结构化接口。

---

## 一、不可否认的工程基础

```
事实 1: V10 的 Praxis 学会了 ProtoTask（"医院系统开发通常有 5 个阶段"），
        但这个知识只能以 prompt 文本形式注入 LLM 的上下文窗口。
        planning-with-files 的任务计划文件不知道这个知识存在。

事实 2: V10 的置信度更新仅基于观察频次和 LLM 标记。
        Praxis 不知道它学到的结构在实践中是成功还是失败。
        一个被频繁观察但总是导致失败的结构，置信度可能虚高。

事实 3: V10 的学习只在 session_end 触发。
        如果 Praxis 在会话开始注入了错误的结构，
        它会在整个会话中持续误导 LLM，直到会话结束才能修正。

事实 4: Praxis 和 OpenClaw 之间的唯一结构化接口是 TaskContext (~200 tokens)。
        其他所有信息流都是非结构化的 prompt 文本——
        LLM 可以读，但 planning-with-files 和 OpenClaw 调度器不能消费。

事实 5: 这四个问题不要求 Praxis 跨界做任务执行。
        它们只要求在"知"（Praxis）和"行"（OpenClaw/planning-with-files）
        之间建立更厚的结构化接口。
```

---

## 二、为什么 V10 的开环注入不足以实现"知行合一"

### 2.1 知行断裂的三个具体表现

```
断裂 1: 知不能有效进入行
  场景: Praxis 从 3 次医院系统开发中学到了 ProtoTask——
        "Phase 2 API 开发阶段，医保对接模块是最大的陷阱"。
  V10:  用户启动第 4 个医院系统项目，planning-with-files 创建计划。
        Praxis 将 ProtoTask 作为 prompt 片段注入 LLM 上下文。
        但 planning-with-files 的任务计划文件中没有任何陷阱预警——
        因为 planning-with-files 不消费 prompt 文本。
        → 如果 LLM 忽略了这段 prompt（在复杂任务中很可能），
          陷阱知识就丢失了。

断裂 2: 行不能结构化地反馈到知
  场景: 子 Agent 完成了"预约挂号 API"，但用户反馈"响应时间不达标"。
  V10:  session transcript 中记录了用户反馈。
        session_end 的 transcript-analyzer 可能（或可能不）提取到这一点。
        即使提取到了——它只知道"用户不满意"，
        不知道"ProtoStructure '门诊预约流程'在这次任务中被使用了，
        但结果不好"——因为没有结构化的关联。
        → 结果信息丢失了与认知结构的关联。

断裂 3: 知在行动中无法自我修正
  场景: Praxis 注入了 ProtoSequence "门诊流程: 挂号→等待→问诊→检查→开药"。
        但用户在第 3 条消息中说"不对，现在我们医院改了流程，
        挂号之后直接分诊到专科"。
  V10:  LLM 看到了纠正，调整了行为。但 Praxis 不知道——
        它要等到 session_end 分析 transcript 时才发现这个矛盾，
        而这个错误的结构在本次会话中已经持续影响了 LLM 的行为。
        → 修正延迟了一个完整会话。
```

### 2.2 这不是边界错误——这是接口贫乏

```
正确的诊断:
  Praxis = 记忆/认知系统 (知) ←→ OpenClaw = 执行系统 (行)
  这个边界本身是正确的。
  
  错误的是: 两者之间的接口只有一个 ~200 tokens 的 TaskContext。
  
  一个认知系统和执行系统之间的接口应该包含:
    ✓ 认知系统 → 执行系统: 可查询的知识、可解析的指导信号
    ✓ 执行系统 → 认知系统: 结构化的结果反馈、成败信号
    ✓ 执行过程中: 实时的矛盾检测和修正
```

---

## 三、四个接口为什么是必需的（各自独立论证）

### 接口 1：知识查询 API — 必要性论证

**如果没有**：planning-with-files 只能依赖 LLM 的通用知识做任务分解。做了 10 次同类项目后，Praxis 学到了团队特定的陷阱和阶段模式，但这些知识无法进入任务计划——它们停留在 LLM 的上下文窗口中，随着会话结束而消失。

**有了之后**：planning-with-files 在创建计划时主动查询 Praxis："这类任务通常有哪些阶段？每个阶段需要注意什么？"Praxis 返回基于真实项目历史的结构化答案——不是 LLM 的通用猜测。

⚠️ 此处存在不确定性：planning-with-files 是否在架构上能够调用 Praxis 的查询端点？这取决于 OpenClaw plugin 系统是否支持 skill→plugin 的函数调用。如果不支持，可能需要通过 AgentMemory slot 作为中介（planning-with-files 读 slot → Praxis 写 slot）。

### 接口 2：认知指导信号 — 必要性论证

**如果没有**：Praxis 的指导是 prompt 文本。LLM 可以遵循也可以忽略。OpenClaw 调度器完全看不到。例如 ProtoTask 说"Phase 2 通常需要 3 个子 Agent 并行"，但 OpenClaw 不知道——它按默认策略调度。

**有了之后**：GuidanceSignal 是类型化的元数据。LLM 在 prompt 中看到自然语言版本，OpenClaw 可以解析结构化版本。例如一个 `phase_suggestion` 信号可以包含 `suggested_action: "spawn 3 parallel sub-agents for API endpoints"`——OpenClaw 据此调整调度策略。

**关键限制**：GuidanceSignal 的 `suggested_action` 是"建议"而非"指令"。OpenClaw 可以忽略。这是刻意的——Praxis 的置信度可能不够高，不应强制执行。但如果采纳率 < 30%（见可证伪预测），接口 2 的价值就有限。

### 接口 3：任务结果反馈 — 必要性论证

**如果没有**：置信度 = f(观察频次, LLM 标记, 用户纠正)。缺少最关键的信息：这个结构在实践中是否导致了好的结果？

**有了之后**：置信度 = f(观察频次, LLM 标记, 用户纠正, **任务成败**)。一个结构被使用 100 次但总是与失败关联 → 置信度下降。一个结构被使用 10 次且每次成功 → 置信度加速上升。这是"实践是检验真理的唯一标准"在工程上的体现。

**关键设计决策**：结果反馈的置信度调整幅度很小（±0.05）。这不是 bug——单次成败不足以推翻一个结构。需要多次一致的结果信号才能显著改变置信度。这避免了偶然因素导致的置信度震荡。

### 接口 4：会话中实时学习 — 必要性论证

**如果没有**：错误结构在会话中持续为害。用户纠正了 LLM，但 Praxis 没有听到。

**有了之后**：用户纠正 → 即时置信度下调。错误结构在本次会话中就被削弱。主要的结构更新仍在 session_end（深度分析），但"紧急修正"不再需要等待。

**关键设计决策**：只做"削弱"，不做"构建"。新建结构和置信度上升仍在 session_end 的完整分析中进行。原因：新建结构需要理解上下文和验证一致性——这需要 LLM 分析，开销太大（几秒 + 几千 tokens），不适合在 message_received hook 中同步执行。

---

## 四、ProtoTask 为什么必须升格为 Phase 1 核心

```
V10 的 ProtoTask 是 Phase 2+ 的可选增强。
V11 的 ProtoTask 必须是 Phase 1 的核心交付。

原因:
  接口 1（知识查询）的核心查询对象是 ProtoTask。
  接口 2（认知指导信号）的 phase_suggestion 和 pitfall_warning 
  都依赖 ProtoTask.typical_phases 和 ProtoTask.common_pitfalls。
  
  如果 ProtoTask 是"可选的、需要 3 个同类项目才触发"——
  那么这四个接口中有两个在绝大部分场景下是空转的。
  
  Bootstrap 机制（零样本 LLM 通用知识）解决了冷启动问题:
    即使从未做过同类项目，Praxis 也能提供基本可用的 ProtoTask
    （置信度 0.2，标记来源: llm_general_knowledge）。
    
  这不是"虚假的知识"——这是"标注了低置信度的通用知识"。
  LLM 和 OpenClaw 知道置信度低，可以据此调整信任程度。
```

---

## 五、反向论证

**反方论点**："四个结构化接口是过度设计。LLM 足够聪明，能从 prompt 文本中提取关键信息。planning-with-files 的 markdown 文件 + LLM 读取已经能完成任务协调。增加接口复杂度带来的收益不值得维护成本。"

**回应**：
1. "LLM 能从 prompt 提取关键信息"这个假设在复杂任务中不成立。当上下文窗口被 300K tokens 的对话历史填满时，Praxis 的 prompt 注入可能被淹没在噪声中。结构化信号不受此影响——OpenClaw 在注入 prompt 之前就解析了 GuidanceSignal 并据此调整调度策略。
2. planning-with-files 的 markdown 文件是"死"的——它们回显你写的内容。Praxis 的 ProtoTask 是"活"的——它从实际项目历史中学习。这是质的差异，不是量的差异。
3. 维护成本：5 个新模块（4 个接口 + ProtoTask），~400 行新代码。这不是一个大的增量。V9 增加了 7 个新模块——V11 的增量更小。

**什么证据会推翻当前结论？**
- 如果 V10 部署后的数据显示：90%+ 的用户场景中，planning-with-files + prompt 注入已经足够（任务分解质量高、陷阱被有效避免）→ 结构化接口不必要
- 如果 GuidanceSignal 的采纳率 < 30% → 接口 2 降级
- 如果 OutcomeFeedback 的置信度调整与 LLM 标记高度相关（r > 0.9）→ 结果反馈没有增加独立的信息

---

## 六、可证伪预测

1. 如果 GuidanceSignal 的 `suggested_action` 被 OpenClaw 采纳率 < 30% → 接口 2 价值有限，降级为纯 prompt 文本
2. 如果 OutcomeFeedback 驱动的置信度调整使 ProtoStructure 准确率提升 < 5% → 接口 3 贡献不显著
3. 如果 MidSessionLearner 的误报率 > 20%（错误地标记了合理的变体行为）→ 接口 4 带来负面体验
4. 如果 ProtoTask bootstrap 的 phase 建议与实际项目偏差 > 50% → bootstrap 不可靠，回到观察门槛

---

## 兄弟文件

- [What is Praxis V11?](what-is.md) — V11 的工程定义
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 四个接口的完整实现
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V10 基础 + 5 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
