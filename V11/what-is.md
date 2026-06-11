# What is AgentOS V11?

> V11 = 从"开环上下文注入"到"闭环知行循环"。V10 让 AgentOS 知道"当前在做什么任务"。V11 让 AgentOS 的知识能结构化地驱动执行层，执行层的结果能结构化地反馈给 AgentOS——知识与行动形成闭合循环。

## 一句话定义

**AgentOS V11 在 V10 的 TaskContext 基础上，建立了四个结构化接口：知识查询 API（AgentOS → planning-with-files）、认知指导信号（AgentOS → LLM/OpenClaw）、任务结果反馈（OpenClaw → AgentOS）、会话中实时学习（LLM 交互 → AgentOS mid-session）。这四个接口将 AgentOS 从"开环上下文注入器"升级为"闭环认知引擎"——知识在实践中验证和成长，更好的知识指导更精准的执行。AgentOS 仍然不做任务执行，但它的知识现在可以有效地进入执行层。**

---

## V10 → V11 演进

```
V1-V6: 认知概念设计 — AgentOS 应该表现出什么行为
V7:     场景级工程落地 — 所有认知操作 = Hook + LLM + AgentMemory
V8:     1M 上下文简化 — 删除 token 妥协，全量注入 + 独立验证
V9:     上下文压力自适应 — 四级压缩 + Lazy Loading + 注意力遥测
V10:    任务级认知感知 — TaskContext (~200 tokens)，知道"在做什么任务"

V11:    知行合一闭环 — 四个结构化接口
        从 "AgentOS 知道但不能有效行动"
        到 "AgentOS 的知识驱动执行，执行结果反馈知识"
        
关键洞察:
  V10 暴露了一个根本问题：AgentOS 的知识（ProtoStructures、ProtoTask）
  只能通过 prompt 文本注入到 LLM 的上下文窗口。planning-with-files 
  的任务计划、OpenClaw 的调度策略——这些执行层组件无法消费 AgentOS 
  的知识。同时，执行层的结果（任务成败、用户反馈）无法结构化地反馈给
  AgentOS。知行之间的循环是断裂的。
  
  V11 不跨界做执行——但它在知与行之间建立了结构化的桥梁。
```

---

## V11 的四个工程命题

### 命题 1：知识查询 API — AgentOS 的知识可被 planning-with-files 消费

```
V10: planning-with-files 创建任务计划 → 看不到 AgentOS 学到的 ProtoTask
V11: planning-with-files 查询 AgentOS → 获得 ProtoTask 的阶段模板、
     常见陷阱、推荐 ProtoStructure → 作为计划骨架

这不是 AgentOS "替" planning-with-files 做计划。
这是 AgentOS "为" planning-with-files 提供基于历史的认知素材。
```

### 命题 2：认知指导信号 — 类型化信号，比 prompt 文本更强

```
V10: AgentOS 注入 "门诊流程: 挂号→问诊→检查" → LLM 可能参考，可能忽略
V11: AgentOS 同时生成 GuidanceSignal (phase_suggestion, pitfall_warning, 
     structure_recommendation) → LLM 看到自然语言版本，
     OpenClaw 解析结构化版本用于调度决策

每个信号有: 类型、严重度、置信度、来源结构、建议行动
```

### 命题 3：任务结果反馈 — 成败驱动置信度更新

```
V10: ProtoStructure 置信度仅依赖观察频次 → 可能虚高
V11: 子任务成败 → 使用的结构置信度上调/下调
     陷阱预测与实际失败匹配 → ProtoTask.pitfall 置信度强化
     阶段时长估计准确 → ProtoTask.confidence 上升

AgentOS 第一次知道了"我学到的知识在实践中是否有效"。
```

### 命题 4：会话中实时学习 — 不等 session_end 才修正错误

```
V10: 如果 AgentOS 注入了错误的结构 → 整个会话中持续误导 LLM
     → session_end 才能修正 → 用户已经离开
V11: message_received 检测用户纠正（"不对，应该是..."）
     before_tool_call 检测工具模式违反
     → 即时下调错误结构置信度（不做"构建"，只做"削弱"）
     → 开销 < 10ms，纯规则匹配，不调 LLM
```

### 命题 5：ProtoTask 升格 — 从可选到核心，零样本可用

```
V10: ProtoTask 在 Phase 2+（可选，需 ≥3 同类项目）
V11: ProtoTask 在 Phase 1 核心交付
     Bootstrap: 零样本时用 LLM 通用知识（置信度 0.2）
     随项目积累逐步成长: 0→0.2, 1→0.3, 3→0.5, 5→0.65, 10→0.8
```

---

## V11 Is / Is-not

| Is | Is-not |
|----|--------|
| V10 + 知行合一闭环（四个结构化接口） | AgentOS 跨界做任务执行 |
| 类型化认知指导信号 + 结果反馈 | 替代 planning-with-files 或 OpenClaw |
| 会话中实时轻量学习（削弱，不构建） | 完整的实时认知引擎 |
| ProtoTask 从可选升级为核心 + bootstrap | 取代 LLM 的推理能力 |
| 保持 Hook 驱动 + 上下文编排层定位 | 主动任务分解引擎 |
| 知识可以结构化的进入执行层 | 知识替执行层做决策 |

---

## V10 → V11 模块变化

| 维度 | V10 | V11 | 增量 |
|------|-----|-----|------|
| 知行关系 | 开环（知→行是软性 prompt） | **闭环（四个结构化接口）** | 知行合一 |
| 知识输出 | 仅 prompt 文本 | **prompt 文本 + GuidanceSignal 元数据** | 类型化信号 |
| 学习时机 | 仅 session_end | **session_end + mid-session 实时** | 会话中学习 |
| 置信度信号 | 频次 + LLM 标记 + 用户纠正 | **+ 任务成败 + 工具匹配** | 结果驱动 |
| ProtoTask | Phase 2+ 可选 | **Phase 1 核心 (含 bootstrap)** | 零样本可用 |
| 对执行层影响 | 软性（LLM 可能忽略） | **结构化（OpenClaw 可解析）** | 可验证的影响 |
| Hook 改动 | 无新 hook | **3 个 hook 增强** (message_received, before_tool_call, session_end) | 微调 |
| Slot | 7 个 | **8 个 (+proto_task)** | 1 个新 slot |
| 模块数 | ~27 | **~32 (+5)** | 5 个新模块 |
| 实现周期 | +2-3 周 (Phase 1) | **+10 周 (Phase 1+2)** | 显著但非架构重构 |

---

## 兄弟文件

- [Why AgentOS V11?](why.md) — 第一性原理：为什么需要知行合一闭环
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 四个接口的完整实现
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V10 基础 + 5 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
