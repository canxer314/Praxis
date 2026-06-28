# Praxis v1.0.0.0

> **"存在就是成为约束变元的值。"** — 威拉德·范·奥曼·奎因

---

AI 缺的不是更大的上下文窗口。它缺的是**本体论承诺**——一套明确声明"我相信哪些实体存在、以多大置信度、基于什么证据、随时准备被推翻"的认知框架。

Praxis 就是这套框架。它是 AI 的大脑皮层——一个位于无状态 LLM 与外部世界之间的**概率化、自我演化的计算本体论引擎**。它从对话和工具调用中提取结构化知识（ProtoStructure），赋予置信度，在下一次任务前注入 LLM 上下文。不是"记住了什么"，而是"相信什么，以及为什么相信"。

---

## 13 次架构迭代——从分类法到认知操作系统

Praxis 的架构不是一次性设计的。它经历了 13 个版本的连续追问，每个版本打破前一个版本的一个核心假设。

### V1-V2：概念确立与载体选择

**V1** 回答"AI 需要什么认知架构？"——诞生了六层架构、4 种记忆类型、3 阶段学习闭环、Result\<T\> 模式。但它是分类法而非架构——只回答了"应该有什么部件"，没有回答"部件如何协作"。

**V2** 追问"这个架构跑在哪里？"——决定 Praxis 不自己造 Agent 运行时，而是以插件形态寄生在 OpenClaw 上，通过 5 个标准 Hook 介入 Agent 生命周期。将 V1 的自建 Harness 假设全部删除——"Praxis 的核心价值是认知，不是工程基础设施"。

### V3-V6：认知引擎的逐步觉醒

**V3** 打破"纯被动学习"假设。Curiosity Engine 让 Praxis 主动检测知识缺口并向用户提问。学习从被动触发变为主动+反应双模式。

**V4** 打破"任务=工具调用序列"的假设。引入 Process Engine + Role Model + Momentum Engine——Praxis 不只是学习者，它是**过程驱动者**。它知道"下一步该推进哪个步骤"、"该找谁"、"被阻塞了怎么办"。

**V5** 打破"框架自身是真理"的假设。Meta Layer 诞生——一个侧观察者，操作的不是 ProtoStructure 本身，而是结构框架是否足够。当 Praxis 反复遇到无法被现有范畴捕获的模式时，不是数据问题——是范畴问题。三种铁律：无新结构不经人类审批、实验必须有范围限制、任何结构可回滚。

**V6** 打破"必须有锚点才能检测缺陷"的假设。Proto-Cognitive Engine 让 Praxis 可以在**完全陌生**的场景中运行——零先验、零模板、零匹配。不分类，先标记显著元素；然后从共现模式构建模糊原型；通过交互验证细化；跨过阈值后结晶。置信度从 0.25 开始，随证据增长。

### V7-V9：工程诚实与压力自适应

**V7** 是第一次工程映射。它做了一个诚实的承认：Praxis 的六层架构是**设计隐喻，不是代码模块**。真正的架构是 hooks/ → orchestration/ → analysis/ → memory/。所有认知操作是 Hook 回调，所有"思考"是 LLM 在做的——Praxis 的本质是 **Context Orchestration Layer**：在正确时间、以正确格式、将正确的结构化记忆注入 LLM 上下文窗口。

**V8** 打破"token 稀缺是永久约束"的假设。1M 上下文窗口意味着不需要选择性注入了——改为全量注入，按 Tier A/B/C 组织排序。删除了 V7 40% 的模块（正则预标记、PMI 预筛选、选择性注入策略——这些是 token 妥协，不是 Praxis 的本质）。同时引入第一个独立于 LLM 的验证信号——**Statistical Verifier**——打破"LLM 自己验证自己"的循环。

**V9** 打破"全量注入永远可行"的假设。1M token 也会被用户数据填满。引入 4 级压力自适应：Normal → Elevated → High → Critical。即使在仅剩 1K token 的临界状态，LLM 仍通过结构索引 + `recall_structure()` 按需拉取知道所有结构存在。引入**注意力遥测**（`[STRUCTURE_USED]` 标记追踪每个结构的实际采纳率）和**僵尸结构检测**（高置信度但 LLM 从不使用——该降级了）。

### V10-V12：任务闭环与边界重新划分

**V10** 打破"场景=认知的基本单位"假设。场景是横向分类（"门诊流程"），任务是纵向时间轴（"构建医院系统 Phase 2"）——是两个正交维度。引入 ~200 token 的 TaskContext 轻量任务感知层，ProtoTask 跨项目学习任务模式。

**V11** 打破"prompt 注入 = 知识传递完成"的假设。Prompt 文本可以被 LLM 忽略。需要结构化接口：GuidanceSignal（typed + severity + suggested_action）、MidSessionLearner（会话中实时修正，纯规则 <10ms，不调 LLM）、OutcomeFeedback（执行结果结构化反馈置信度）。

**V12** 打破"Praxis 和 planning-with-files 是平级组件"的假设。planning-with-files 只是一个 SKILL.md prompt 模板——它没有自己的"智能"。Praxis，凭借其从真实项目历史中学习的 ProtoTask，本身就是天然的任务分解引擎。引入两层嵌套状态机——外层任务级 7 状态 + 内层子任务级 4 状态——外加 plan-generator（ProtoTask → PlanDocument）、verifier（5 种验收标准）和 pitfall-tracker（陷阱匹配+反馈学习）。planning-with-files 降格为文件持久化工具。

### V13：完全自主驱动

**V13** 打破"状态机等待 Hook 事件推进"的假设。增加了主动触发——TaskScheduler 决定是否自主发起下一个动作，SubagentManager 管理并行子 Agent（上限 3，失败隔离），HeartbeatMonitor 检测停顿（3 级介入：提醒→唤醒→升级）。V12 的状态机一行代码未改——驱动源从纯 Hook 变为 Hook + Schedule + Heartbeat + Subagent 混合。净增不到 530 行代码。

---

## 哲学根基

Praxis 的设计不是凭空发明。它站在几个具体的思想传统之上：

**奎因的本体论承诺**（1948）："存在就是成为约束变元的值"。Praxis 将"相信什么"从私人心理状态变为可公开审计的结构化声明——`/praxis ontology` 就是 Praxis 的"约束变元清单"。

**双重性质理论**（Kroes & Meijers）：每个工程造物同时具有物理结构面和意向功能面。Praxis 的 ProtoSequence 直接实现了这一区分——structure（可观察的行为步骤）、function（每一步的目的）、teleological_mapping（结构→功能的逻辑映射）。当用户说"我们改用蓝绿部署代替备份"时，Praxis 检查的是**功能面是否仍被满足**，而非结构是否匹配。

**共相之争的工程实现**：中世纪的实在论/唯名论/概念论三派争论——Praxis 将其实现为可配置的 `ontology_stance`：实在论（bootstrap 预设模板）、唯名论（纯观察驱动，不预设任何结构）、概念论（观察+LLM 归纳）。运维者按领域风险配置混合权重。

**神经符号架构**：符号侧（ProtoStructure + 约束公理 + 统计验证器 + 确定性传播规则）提供精确但脆弱的骨架，神经侧（LLM 分析、场景识别、语义理解）提供灵活但不可靠的血肉。7 源置信度融合中，LLM 相关信号权重合计 0.25，独立于 LLM 的信号权重合计 0.75——这是**认识论立场**，不是技术偏好：语言模型不是真理的担保人。

**波普尔的证伪主义**：置信度不来自"更多证据支持"，而来自"未能被证伪"。ConceptVerifier 的对抗 prompt——"尝试为这个概念的反例辩护"——是这一原则的直接操作化。

---

## 5 分钟上手

```bash
# 安装
.\scripts\install.ps1    # Windows
./scripts/install.sh      # macOS / Linux

# 重启 Claude Code。Praxis 自动工作。
# 首次 session 后：
/praxis ontology           # 查看所有认知结构
/praxis status             # 查看 8D 能力模型
/praxis audit              # 僵尸/低估/违规统计
```

---

**v1.0.0.0 · 873 tests · 71 files · typecheck clean**

[技术规格](docs/SPECIFICATION.md) · [架构设计](architech/praxis-architecture.md) · [演变史](architech/praxis-changelog.md) · [路线图](docs/ROADMAP.md)
