# Why AgentOS V10?

> 从第一性原理出发，分析为什么 V9 的"场景级认知"不足以应对复杂连续任务，为什么需要任务级认知感知，以及为什么方案 C（轻量 TaskContext）是正确的架构选择。

---

## 一、不可否认的工程基础

```
事实 1: 复杂任务跨越多个场景，场景级认知无法捕捉跨场景的结构。
        例如 "构建医院系统" 包含: 需求讨论、数据库设计、API开发、
        UI实现、测试——每个都是不同的场景。

事实 2: 用户在中断后恢复任务时，AgentOS 不知道"上次在做什么"。
        V1-V9 的 AgentOS 记得所有 ProtoStructure，但不记得任务进度。
        这是 planning-with-files 的领域——但 planning-with-files
        的状态与 AgentOS 的认知结构之间没有桥梁。

事实 3: 子 Agent 在独立 session 中运行，默认不继承父 Agent 的认知上下文。
        如果父 Agent 在当前会话中已经更新了 ProtoStructure 置信度
        （在内存中，尚未持久化），子 Agent 看不到这些更新。

事实 4: 任务级认知不需要"任务规划引擎"。任务规划是执行框架的职责。
        AgentOS 只需要知道"当前任务是什么、处于哪个阶段、哪些认知结构
        最相关"——这是一个索引，不是一个计划。

事实 5: 在 1M 上下文中，~200 tokens 的 TaskContext 开销可忽略不计。
        即使在 V9 Critical 压力下（可用空间 < 100K），200 tokens
        只占 0.2%——完全不影响其他内容的注入。
```

---

## 二、为什么 V9 的场景认知不足以应对复杂任务

### 2.1 场景 vs 任务：两种不同的认知抽象

```
场景级认知 (V1-V9 覆盖):
  抽象粒度: 单次或多次交互的模式
  时间跨度: 分钟到天
  认知产物: ProtoSequence, ProtoRole, ProtoConcept, ProtoPurpose
  例子:      "在医院门诊场景中，流程是挂号→等待→问诊"

任务级认知 (V10 新增):
  抽象粒度: 跨场景的项目推进模式
  时间跨度: 天到月
  认知产物: TaskContext, ProtoTask (Phase 2+)
  例子:      "构建医院系统这类项目通常经历需求→数据→API→UI四个阶段"
             "当前在 API 阶段，最相关的场景结构是门诊流程和 REST API 设计"
```

### 2.2 V9 在处理复杂任务时的具体失败模式

```
失败模式 1: 场景切换导致认知结构注入变化
  用户: "先继续写预约挂号的 API，然后我看看前端的界面设计"
  V9:  前半句 → scene = "api_design" → 注入 API 相关结构
        后半句 → scene 可能切换为 "ui_design" → 注入 UI 相关结构
        但 AgentOS 不知道这两个场景都属于同一个任务，
        注入的结构之间没有"任务关联"的线索。

失败模式 2: 跨会话恢复时缺乏任务动量
  周一: 用户做了 3 小时医院系统开发，AgentOS 学会了"门诊预约 API 的
        典型请求格式"（ProtoStructure 更新了置信度）
  周三: 用户说"继续做医院系统"
  V9:   scene-recognizer → "医院门诊"场景 → 注入相关 ProtoStructure
        但没有注入 "当前任务 Phase 2, API 60% 完成" 的上下文
        → LLM 知道门诊流程，但不知道"做到哪了"

失败模式 3: 子 Agent 认知隔离
  父 Agent 启动子 Agent 做"数据库迁移脚本"
  子 Agent session:
    session_start → AgentOS 注入医院相关 ProtoStructure
    但子 Agent 在 session 中发现了"数据库表结构需要调整"
    → session_end → 更新 ProtoStructure
    但父 Agent 的 ProtoStructure 在内存中已更新 → 竞态
    且父 Agent 不知道子 Agent 发现了什么
```

---

## 三、方案 C 的架构论证：为什么不是方案 A 或方案 B

### 3.1 方案 A 为什么不够

```
方案 A: AgentOS 不参与任务协调，全部交给 OpenClaw Skill

问题不在于 planning-with-files 不能记录任务状态。
问题在于: planning-with-files 的记录是"死"的——它回显你写的文字。

AgentOS 的认知结构是"活"的——它从实际交互中学习模式。

做了 10 次医院系统开发后:
  planning-with-files: 还是一堆文件，每次都要手动写计划
  AgentOS + TaskContext: 自动知道"这类项目通常需要哪些阶段"、
   "当前阶段最相关的 ProtoStructure 是什么"、"上次类似阶段遇到了什么坑"

没有 TaskContext 桥梁，这些认知结构就无法与当前任务关联起来。
AgentOS 空有知识但不会在正确的时机调度。
```

### 3.2 方案 B 为什么过度

```
方案 B: AgentOS 新建完整的 Task Engine

问题: 任务分解、子 Agent 协调、并行执行——这些本质上不是认知操作。
它们是执行框架的职责。AgentOS 的架构哲学从 V7 开始就是"上下文编排层"，
不是"执行引擎"。

把执行协调纳入 AgentOS = 架构膨胀 + 职责模糊。

V10 的正确边界:
  AgentOS:   "当前任务的认知上下文是什么？"（认知索引）
  OpenClaw:  "任务的下一步应该是什么？"（执行规划）
  
  两者互补，互不侵犯。
```

### 3.3 方案 C 为什么是正确的

```
方案 C: TaskContext (~200 tokens) 作为认知索引

增量:  1 个新 slot (task_context)
       1 个新模块 (task-context.ts)
       session_start 中 ~5 行代码 (注入 TaskContext)
       session_end 中 ~10 行代码 (更新 TaskContext)

成本:  几乎为零。
       不改变 V9 的任何核心架构。
       不需要新的 Hook。
       不需要新的 LLM 调用。

收益:  任务认知上下文注入
       场景优先级按任务阶段调整
       子 Agent 认知继承
       ProtoTask 的数据基础
```

---

## 四、V10 能力矩阵

| 能力 | V9 | V10 | 增量描述 |
|------|----|----|---------|
| TaskContext 注入 | ❌ | 🟢 **~200 tokens** | 1 slot + session_start 微调 |
| 任务感知优先级 | ❌ | 🟢 **Tier A 优先任务相关** | 排序算法中增加一个乘法因子 |
| 子 Agent 认知继承 | ❌ | 🟢 **session_start 注入 TaskContext** | 同 session_start 逻辑, 无新代码 |
| session_end 进度推断 | ❌ | 🟢 **LLM 推断 + 更新** | transcript-analyzer 增加一个输出字段 |
| ProtoTask 构造 (Phase 2+) | ❌ | 🟡 **需验证** | 可学习的任务模式 |

---

## 五、核心风险

| 风险 | 缓解 |
|------|------|
| TaskContext 过时（任务阶段已推进但未更新） | session_end LLM 推断 + 用户显式命令 `/agentos task update` |
| TaskContext 与 planning-with-files 的计划不一致 | 两者独立。不一致不影响功能——TaskContext 是认知索引，不是执行计划 |
| ProtoTask 从稀疏数据中归纳的质量 | Phase 2+ 且需要 min_observations >= 3 同类项目 |
| 子 Agent 的 ProtoStructure 竞态更新 | session_end 写入时检查乐观锁（version 号） |

---

## 六、反向论证

**反方论点**："TaskContext 的价值被夸大了。用户说'继续做医院系统'时，V9 的场景识别已经会匹配到'hospital'场景并注入相关 ProtoStructure。TaskContext 额外注入的'Phase 2, API 60%'信息，LLM 从对话历史的前几条消息就能推断出来——不需要 AgentOS 专门维护。新增 slot、新增模块、新增 session_end LLM 推断——这些都是为了一个对话历史已经包含的信息。"

**回应**：
1. LLM 从对话历史推断任务状态的前提是对话历史中包含这些信息。如果用户的上一句话只是"继续"（而没有重复"我们在做医院系统 Phase 2"），对话历史中的相关内容可能已经被上下文截断（长会话中最早的消息被自动移除）。TaskContext 在系统提示中——不受对话历史截断影响。
2. 任务相关性排序（"Phase 2 的 relevant_scenarios 中的结构优先"）是对话历史无法自动提供的——LLM 不会自己重新排列 AgentOS 注入的结构顺序。
3. 子 Agent 不继承父 Agent 的对话历史——它只获得 TaskContext + ProtoStructure。没有 TaskContext，子 Agent 完全不知道自己在什么任务上下文中工作。
4. TaskContext 是 ProtoTask 的前提。对话历史中的隐含信息无法自动转化为可学习的任务模式——需要结构化的数据积累。

---

## 七、可证伪预测

1. 如果用户在 80% 的会话中通过对话历史的前 3 条消息就恢复了任务上下文 → TaskContext 的增量价值有限
2. 如果 ProtoTask 在 5 次同类项目后的归纳准确率 < 40% → 任务模式学习不可靠，应放弃
3. 如果 TaskContext 注入后 LLM 的行为与不注入无显著差异（A/B 测试）→ 删除 TaskContext

---

## 兄弟文件

- [What is AgentOS V10?](what-is.md) — V10 的工程定义
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — TaskContext 注入、ProtoTask 构造
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V9 基础 + 1 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
