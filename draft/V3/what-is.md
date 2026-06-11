# What is Praxis V3?

> V3 = OpenClaw Memory Plugin + 多维学习模型 + 主动好奇心引擎

## 一句话定义

**Praxis V3 是运行在 OpenClaw 内部的一个 memory plugin，它让无状态的 LLM 拥有跨会话的持久成长能力——不仅学会"怎么用工具"，还学会"任务怎么做"、"领域里有什么"、"用户在想什么"、"自己还缺什么"——并且，像一个刚毕业的大学生一样，会主动检测自己的知识缺口，在合适的时机向用户请教。**

---

## Is / Is-not

| Is | Is-not |
|----|--------|
| 跨会话的持久学习中间件 | 一个 AI agent 本身 |
| 多维能力模型（工具 + 领域 + 任务 + 用户理解） | 单维度的工具熟练度追踪器 |
| 主动检测知识缺口并向用户请教 | 被动的日志记录系统 |
| OpenClaw 的 memory plugin | 独立的 runtime 或 agent loop |
| 以**任务成功**为最终目标的学习系统 | 以**工具熟练度**为最终目标的追踪器 |
| 有"我知道什么 vs 我该知道什么"的差距认知 | 只有"我做过什么"的历史记录 |

---

## V1 → V2 → V3 演进

| 维度 | V1 (独立 Harness) | V2 (OpenClaw Plugin) | V3 (主动学习者) |
|------|-------------------|---------------------|----------------|
| **运行方式** | 独立进程，自建 Hook | OpenClaw Memory Plugin | 同 V2 |
| **学习对象** | 工具熟练度 | 工具熟练度 | 工具 + 领域 + 任务模式 + 用户模型 |
| **学习触发** | 被动（自建 Hook） | 被动（OpenClaw Hook） | 被动 + **主动**（Curiosity Engine） |
| **知识分类** | 单一类型 | 单一类型 | 五类：领域/任务模式/用户偏好/流程/工具 |
| **学习事件** | 1 种 | 1 种（mistake_correction） | 5 种（+domain_insight, +preference_discovery, +task_pattern, +procedural_optimization） |
| **与用户关系** | 用户单向教导 | 用户单向教导 | **双向**：Praxis 也会主动提问 |
| **核心 Hook** | Claude Code Harness | 5 个 OpenClaw Hook | 6 个（+message_received） |
| **能力模型** | 工具树 | 工具树 | **四维雷达**（工具+领域+任务+用户理解） |

---

## 一个具体的例子：从"会用咖啡机"到"能独立做周报"

### V2 能做到的（工具本位）

> 用户："帮我冲杯咖啡"
> Praxis：查工具熟练度(0.72)→ 自主冲 → 记录使用次数 → 87 次使用，proficient

### V3 能做到的（任务本位 + 主动学习）

> **第 1 周**：用户："帮我做膜力云项目的周报"
> Praxis：用 ppt_generator 做了一份 PPT（工具熟练度 0.5）。用户回复"不错，但少了个风险分析板块"。
> → `after_tool_call`：捕获用户纠正
> → `agent_end`：LearningEvent{ type: "preference_discovery", insight: "周报必须包含风险分析板块" }
> → `agent_end`：LearningEvent{ type: "domain_insight", gap: "还不太理解'膜力云项目'的数据源有哪些" }
>
> **第 2 周**：用户："周报"
> Praxis：这次包含了风险分析板块（已学会）。但数据采集阶段花了很长时间。
> → `agent_end`：Curiosity Engine 检测到"数据源结构"相关术语反复出现但知识库中无定义
> → 标记 KnowledgeGap{ topic: "膜力云数据源架构", priority: 0.75 }
>
> **周五下午（用户不忙时）**：
> Praxis 通过 Telegram 主动发消息：
> > "这周做了两次周报，我注意到每次采集数据时都需要分别查三个系统。方便的时候能跟我讲讲膜力云的数据源架构吗？主要是城乡数据平台、智慧水务、还有制造管理这三个系统的数据分别代表什么。"
>
> 用户回复后 → KnowledgeGap 状态变为 "answered" → 领域知识固化
>
> **第 3 周**：用户："周报"
> Praxis：直接按已知数据源结构采集 → 理解每类数据的业务含义 → 生成有针对性的分析 → **效率提升 60%，用户评价："这次的分析有深度了"**

---

## 兄弟文件

- [Why Praxis V3?](why.md) — 为什么需要 V3，V2 的缺口分析
- [Who is it for?](who.md) — 谁在使用？角色反转：AI 也会提问
- [How does it work?](how.md) — 六层架构 + Curiosity Engine 详解
- [When does it operate?](when.md) — 完整生命周期（被动 + 主动触发）
- [Where does it sit?](where.md) — 架构定位
- [Architecture Design](design.md) — V3 架构设计文档
