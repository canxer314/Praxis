# What is AgentOS V7?

> V7 = V6 的工程实现方案 = 将认知架构设计映射到可落地的代码、数据结构和 Hook 编排

## 一句话定义

**AgentOS V7 不引入新的认知能力。V7 回答一个问题：V6 设计中的每一项"智能"，在工程上到底是什么？答案是：AgentOS 不是一个 AI 系统——它是一个上下文编排层（Context Orchestration Layer），通过 Hook 回调在正确的时机把正确的结构化记忆注入 LLM 的上下文窗口，让无状态的 LLM 表现出持续成长的认知能力。V7 把这个本质从 V1-V6 的设计隐喻中剥离出来，给出可实施的工程方案。**

---

## 核心洞察：AgentOS 的工程本质

V1 到 V6 用认知科学语言描述了 AgentOS：能力维度、学习闭环、元认知、原型认知引擎。这些是**设计语言**——它们描述了 AgentOS 应该表现出什么行为。

V7 用工程语言描述同一件事：

```
┌─────────────────────────────────────────────────────────────┐
│                  AgentOS 的工程本质                           │
│                                                               │
│  输入:                                                        │
│  ├─ 用户消息 (via message_received hook)                      │
│  ├─ 工具调用结果 (via before/after_tool_call hooks)           │
│  ├─ Agent 执行结果 (via agent_end hook)                       │
│  └─ 会话生命周期事件 (session_start, session_end)              │
│                                                               │
│  处理:                                                        │
│  ├─ 从 AgentMemory 检索相关记忆和结构                         │
│  ├─ 将结构化数据序列化为 LLM 可理解的 prompt 片段              │
│  ├─ 注入到 LLM 的系统提示或上下文消息中                        │
│  └─ 从 LLM 输出和交互结果中提取新的结构化数据                  │
│                                                               │
│  输出:                                                        │
│  ├─ 写回 AgentMemory (新的记忆、更新的结构、学习事件)           │
│  └─ 影响下一次会话的 prompt 构造                               │
│                                                               │
│  AgentOS 的"智能" = LLM 的智能 + 正确的上下文在正确的时机      │
│  被注入。没有 AgentOS 自身的"推理"——所有推理是 LLM 做的。     │
└─────────────────────────────────────────────────────────────┘
```

---

## V7 的三个工程命题

### 命题 1：一切"认知结构"都是 Prompt 片段

V6 的 ProtoSequence、ProtoRole、ProtoConcept、ProtoPurpose——它们不是某种神奇的"认知模型"。它们是**存储在 AgentMemory 中的结构化数据，在 session_start 时被检索并序列化为 prompt 文本片段，注入到 LLM 的上下文中**。

```
ProtoSequence "门诊流程" (置信度 0.8)
        │
        │ 序列化
        ▼
"你对门诊就诊流程的理解（置信度 0.8, 8次观察）:
 1. 挂号 → 2. 等待叫号 → 3. 医生问诊 → 4. 检查 → 5. 复诊 → 6. 开药
 变体: 急诊模式跳过步骤2-3
 注意: 这是从观察中形成的模式，可能不完整。如与实际不符，请更新。"
```

### 命题 2：一切"认知操作"都是 Hook 回调

V6 的"开放感知"、"原型构造"、"互动验证"——它们不是后台持续运行的认知进程。它们是**在特定 Hook 回调中执行的函数**：

| V6 认知操作 | 工程实现 |
|------------|---------|
| 开放感知 | `message_received` 回调中的轻量标记 + 系统提示中的 "注意但不分类" 指令 |
| 原型构造 | `session_end` 回调：用 LLM 分析本会话的 SalientElement → 检测共现 → 更新 ProtoStructure |
| 互动验证 | `agent_end` 回调：比较 LLM 的预测动作与实际结果 → 更新置信度 |
| 固化提议 | `session_end` 回调：检查置信度是否跨过阈值 → 生成审批请求 |
| 退化检测 | 每周 cron：比较固化结构的预测准确率 → 标记退化 |
| 架构审计 | 每周 cron：检查 ArchitectureGap → 生成提案 |

### 命题 3：AgentOS 的质量天花板 = LLM 的质量 + 上下文构造的质量

AgentOS 不做推理。它做的是：
1. **记忆管理**：保存什么、何时检索、检索什么
2. **上下文构造**：如何把记忆序列化为 LLM 能有效利用的 prompt
3. **反馈提取**：从 LLM 的输出中提取什么信息来更新记忆
4. **编排逻辑**：在哪个 Hook 中执行哪个操作

如果 LLM 不能从原始交互中归纳出 ProtoSequence，AgentOS 也不能——它没有"自己的"归纳能力。

---

---

## 关键发现：V1-V6 的"层"是设计概念，不是代码模块

V1 到 V6 迭代过程中一直引用"六层架构"（L1 工具集成、L2 任务编排、L3 知识管理、L4 学习闭环、L5 能力模型、L6 自主决策）。这是合理的概念框架——它清晰地划分了功能域。

但 V7 从工程角度审视时，发现了一个 V1-V6 没有暴露的事实：

```
V1-V6 使用的语言（认知设计语言）:
  "L3 知识管理层负责存储和检索所有类型的知识"
  "L4 学习闭环层负责从交互中提取学习事件"
  "如果 L3 和 L4 的边界模糊了，就合并它们"  ← V6 的 Level 4 场景

V7 看到的现实（工程语言）:
  知识存储 → hooks/session-start.ts 中的 memory_recall() 调用
          → memory/queries.ts 中的语义搜索
          → prompts/system/proto-structure.md 中的注入模板
  
  学习闭环 → hooks/session-end.ts 中的分析触发
           → analysis/proto-constructor.ts 中的 LLM 归纳
           → orchestration/confidence-updater.ts 中的置信度算法
  
  "合并 L3 和 L4" → 不存在 L3.ts 或 L4.ts 可以被合并
                 → 实际需要的是: 调整 prompt 模板 + 改变数据检索策略
                 → 这些都是修改 AgentMemory 中的配置数据
```

**这就是为什么 V1-V6 没有发现这个问题的原因**：V1-V6 在用认知科学的语言描述"AgentOS 应该表现出什么行为"，而不是"代码怎么写"。在这个层面上，"六层架构"是一个完全合理的概念框架。就像建筑设计师画了"功能区"（起居区、睡眠区、烹饪区），但施工图是按"结构柱网"和"管线走向"组织的——施工时才发现"烹饪区"跨了三根柱子。这不是设计错误，这是设计语言和工程语言之间的正常翻译摩擦。这种摩擦只有切换到工程视角时才会暴露。

**对 V6 Level 4-5 的影响**：V6 的"层自修改"设计意图是正确的——AgentOS 确实需要能在发现架构组织不够好时做出调整。但实现方式比 V6 设想的更简单：大部分"层修改"场景（合并功能、增加检测维度、替代结构组织方式）通过修改 AgentMemory 中的配置数据 + prompt 模板即可实现，不需要改动插件代码。这恰好证明 V6 的设计是合理的——它的需求可以被更简单的工程手段满足。

---

## Is / Is-not

| Is | Is-not |
|----|--------|
| V6 的工程实现方案和落地路线图 | 新的认知能力设计 |
| 上下文编排层的技术规范 | AI 推理引擎 |
| Hook 回调中的确定性编排逻辑 | 后台持续运行的认知进程 |
| 基于 AgentMemory API 的数据持久化方案 | 独立数据库或新的存储系统 |
| 可逐步实现的工程路线图 | 一次性构建的完整系统 |

---

## V6 → V7：从认知设计到工程方案

| V6 概念 | V6 描述 | V7 工程映射 |
|---------|---------|------------|
| Proto-Cognitive Engine | "在零先验场景中从零构建认知" | Hook 编排 + Prompt 模板 + AgentMemory 读写 |
| Open Perception | "标记 salient 元素但不分类" | 系统提示指令 + message_received 轻量解析 |
| Proto-Structure Construction | "从共现中形成模糊原型" | session_end LLM 调用 + memory_patterns |
| Interactive Validation | "通过互动精化原型" | agent_end 置信度更新算法 |
| Crystallization/Degradation | "原型↔固化结构转化" | 数据格式转换 + 人类审批工作流 |
| Layer Self-Modification | "修改自己的架构组织" | 配置文件修改 + 多级审批 + 版本管理 |

---

## 兄弟文件

- [Why AgentOS V7?](why.md) — 第一性原理工程可行性分析
- [Who is it for?](who.md) — 开发者、运维者、用户三角色
- [How does it work?](how.md) — Hook 编排、Prompt 工程、数据流详解
- [When does it operate?](when.md) — 实现路线图与分阶段交付
- [Where does it sit?](where.md) — 工程架构与模块划分
- [Architecture Design](design.md) — 技术规格与 API 契约
