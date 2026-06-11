# What is AgentOS V10?

> V10 = 从"场景级认知"到"任务级认知"。V1-V9 让 AgentOS 学会"医院门诊的流程是什么"。V10 让 AgentOS 知道"当前正在构建一个医院系统，处于 Phase 2，下一步是预约挂号 API，最相关的认知结构是门诊流程和 API 设计模式"。

## 一句话定义

**AgentOS V10 引入 TaskContext——一个仅 ~200 tokens 的轻量任务感知层。它不替代 OpenClaw 的 planning-with-files（任务计划和执行协调），而是在此之上叠加一层认知上下文：AgentOS 知道"当前在做什么项目、处于哪个阶段、哪些 ProtoStructure 最相关、子 Agent 需要继承什么认知结构"。V10 的增量极小，但它打开了任务级认知学习（ProtoTask）的大门。**

---

## V9 → V10 演进

```
V1-V6: 认知概念设计 — AgentOS 应该表现出什么行为
V7:     场景级工程落地 — 所有认知操作 = Hook + LLM + AgentMemory
V8:     1M 上下文简化 — 删除 token 妥协，全量注入 + 独立验证
V9:     上下文压力自适应 — 四级压缩 + Lazy Loading + 注意力遥测

V10:    任务级认知感知 — TaskContext (~200 tokens)
        从 "AgentOS 理解场景" 到 "AgentOS 理解任务中的场景"
        
关键洞察:
  V1-V9 的 AgentOS 在每次会话中都是"失忆但博学"的——
  它记得所有场景模式（ProtoStructures），但不记得"当前在做什么项目"。
  
  V10 填补这个 gap —— 不需要 AgentOS 做任务规划（那是 OpenClaw 的事），
  只需要 AgentOS 知道"当前任务的认知上下文是什么"。
```

---

## V10 的三个工程命题

### 命题 1：TaskContext — 认知上下文的最小化任务感知

```
TaskContext 不是任务计划。它是认知索引——告诉 AgentOS：
  • 当前任务是什么？（一个标识符 + 一句话描述）
  • 处于哪个阶段？（Phase 2 / 3）
  • 进度如何？（"API 60% 完成"）
  • 哪些场景结构最相关？（["hospital_outpatient", "api_design"]）

大小: ~200 tokens — 即使在 V9 的 Critical 压力下也可注入。
存储: AgentMemory slot "task_context"
更新: session_end 中 LLM 推断 + 用户显式设置
```

### 命题 2：任务感知的场景优先级 — 更精准的注意力引导

```
V8/V9 的 Tier A/B/C 基于"场景匹配度"排序结构。

V10 增加了"任务相关性"维度:
  → 当前任务 Phase 的 relevant_scenarios 中的结构 → Tier A (最前)
  → 当前场景匹配的结构 → Tier A (次前)
  → 相近场景的结构 → Tier B
  → 不相关结构 → Tier C

这意味着同一场景的结构中，与当前任务阶段相关的会被优先展示。
```

### 命题 3：ProtoTask（远期）— 可学习的任务模式

```
正如 ProtoSequence 从场景观察中学习"这个场景的典型流程"，
ProtoTask 从多次同类项目中学习"这类项目的典型推进模式"。

做了 10 次医院系统开发后:
  ProtoTask "医院系统开发":
    typical_phases: [需求分析 → 数据模型 → API开发 → UI → 集成测试]
    common_pitfalls: ["医保对接模块工作量容易被低估"]
    phase_structures: { "API开发": ["api_design", "rest_patterns"] }
    
这是 V6 Proto-Cognitive Engine 在任务级的自然延伸。
```

---

## V10 Is / Is-not

| Is | Is-not |
|----|--------|
| 场景级认知到任务级认知的桥梁 (~200 tokens) | 新的认知能力设计 |
| 任务认知上下文的轻量感知层 | 任务规划和执行引擎（那是 OpenClaw 的事） |
| ProtoTask 的概念基础和 Phase 2+ 路线图 | V10 Phase 1 的完整实现 |
| V9 基础上的最小增量 | 对 V9 核心架构的任何修改 |

---

## V9 → V10 模块变化

| 维度 | V9 | V10 | 增量 |
|------|----|----|------|
| 注入策略 | 四级压缩 | 四级压缩 + TaskContext 优先级 | TaskContext 注入 ~200 tokens |
| Slot | 6 个 | **7 个** (+task_context) | 1 个新 slot |
| 上下文组织 | Tier A/B/C (场景匹配) | **Tier A/B/C (场景 + 任务相关性)** | 排序算法微调 |
| 认知结构 | ProtoSequence/Role/Concept/Purpose | **+ ProtoTask (Phase 2+)** | 1 个新结构类型 |
| Hook | 6 个 | 6 个 (session_start/end 微调) | 无新增 hook |
| 模块数 | ~26 | ~27 (+task-context.ts) | 1 个新模块 |
| 实现周期 | ~4 个月 | **+2-3 周 (Phase 0) + 可选 Phase 2** | 增量极小 |

---

## 兄弟文件

- [Why AgentOS V10?](why.md) — 第一性原理：为什么需要任务级认知
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — TaskContext 注入、ProtoTask 构造
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V9 基础 + 1 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
