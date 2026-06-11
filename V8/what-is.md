# What is AgentOS V8?

> V8 = V7 在大上下文（1M tokens）时代的重新设计 = 删除 token 稀缺妥协，引入独立验证，从"选择注入什么"转向"如何组织注入"

## 一句话定义

**AgentOS V8 不再是一个 token 稀缺约束下的有损压缩系统。1M 上下文窗口消除了解 V7 架构中近一半的模块——regex 预标记、PMI 预筛选、选择性注入策略——它们不是 AgentOS 的本质，它们是在 token 稀缺环境下被迫的迂回。V8 走直线：原始会话 transcript → 累积 LLM 分析 → 结构化认知。同时 V8 首次引入独立于 LLM 的统计验证信号，打破"LLM 自己验证自己"的闭环。**

---

## 核心洞察：V7 的复杂度有多少来自 token 约束？

```
V7 的模块分类审计：

  来自 AgentOS 本质需求的模块（换什么上下文大小都需要）:
  ├─ hooks/session-start.ts        → 记忆加载 + 上下文注入
  ├─ hooks/session-end.ts          → 分析触发 + 持久化
  ├─ hooks/agent-end.ts            → 预测验证 + 置信度更新
  ├─ orchestration/confidence-*.ts → 置信度算法
  ├─ analysis/degradation-checker  → 退化检测
  ├─ memory/*                      → AgentMemory 集成
  └─ prompts/*                     → Prompt 模板

  来自 token 稀缺约束的模块（大上下文下可删除）:
  ├─ orchestration/salience-marker.ts    → regex 预标记（token 不够装完整 transcript 的妥协）
  ├─ analysis/pattern-detector.ts        → PMI 预筛选（token 不够装所有共现对的妥协）
  ├─ orchestration/scene-matcher.ts      → 选择性匹配功能（token 不够装所有结构的妥协）
  │                                        ⚠️ 但其"场景识别"功能不可删除（见下文）
  └─ orchestration/context-builder.ts    → 三种注入策略（token 不够统一注入的妥协）
                                          ⚠️ 但其"置信度校准信号"功能应保留

  ⚠️ 第一性原理审视后发现的关键修正（2026-06-11）:
    scene-matcher 有两个功能，V8 初版错误地将其视为一个来删除:
      功能 A: 选择性注入（"只注入匹配度最高的结构"）→ token 妥协 → ✅ 可删除
      功能 B: 场景识别（"当前会话属于哪个 scenario_id？"）→ 认知架构基础 → ❌ 不可删除
      
    context-builder 有两个功能，V8 初版只替换了其中一个:
      功能 A: 三种注入策略（exact/fuzzy/weak/zero_prior 的不同 token 预算）→ token 妥协 → ✅ 可删除
      功能 B: 置信度校准信号（"这个结构你可以信任" vs "这个结构仅供参考"）→ 认知操作 → ❌ 应保留

    V8 修正: 新增 scene-recognizer.ts（场景识别）+ 在 context-organizer 中增加
    相关性预排序和置信度校准指令。

  来自 LLM 自引用问题的模块（V7 缺失，V8 新增）:
  ├─ analysis/statistical-verifier.ts    → 独立验证信号（打破 LLM 自引用闭环）
  └─ orchestration/confidence-fuser.ts   → 多源置信度融合

  来自注意力稀释风险的模块（大上下文新问题，V8 新增）:
  └─ orchestration/context-organizer.ts  → 层级化上下文组织
```

**关键发现**：V7 20 个模块中约 4 个是纯 token 约束的产物（可完全删除）。另有 2 个模块（scene-matcher、context-builder）各有一个功能是 token 妥协（可删除），另一个功能是认知架构的必要组成（不可删除）。V8 修正后将这 2 个必要功能以简化形式保留。

---

## V8 的三个工程命题（修订）

### 命题 1：一切"认知结构"仍是 Prompt 片段，但不再需要选择性注入

```
V7:  场景匹配 → 选择相关结构 → 注入（可能选错，可能遗漏）
V8:  全量加载 → 层级化组织 → 全部注入（不选择，只排序）

V7 的问题是"这个结构和当前场景相关吗？"（selection problem）
V8 的问题是"这些结构中哪个最重要？"（ordering problem）

在 1M 上下文中，"全部注入"是可行的。代价转移到如何组织
让 LLM 最有效地利用它们。
```

### 命题 2：一切"认知操作"仍是 Hook 回调，但分析步骤大幅合并

| V6 认知操作 | V7 工程实现 | V8 工程实现 |
|------------|-----------|-----------|
| 开放感知 | message_received regex + session_end LLM | **仅 session_end LLM**（完整 transcript 直接分析） |
| 原型构造 | PMI 预筛选 + LLM 归纳（两步） | **LLM 一步完成**（从 transcript 到 ProtoStructure） |
| 互动验证 | LLM 标记解析（单一信号） | **统计验证 + LLM 标记**（双信号融合） |
| 固化提议 | 置信度 > 0.8 → 等待用户审批 | **置信度 > 0.8 + 零用户纠正 → 自动推进阶梯** |
| 退化检测 | 每周 cron | **session_end 实时 + cron 深度检测** |
| 架构审计 | LLM 单一视角 | **对抗性 prompt 交叉验证** |

### 命题 3：AgentOS 的质量天花板 = LLM 质量 + 上下文构造质量 + 验证信号独立性

V7 的质量只依赖 LLM + 上下文构造。V8 增加第三个维度：

```
AgentOS 质量 = LLM推理能力 × 上下文组织质量 × 验证信号独立性

验证信号独立性 = f(统计验证器准确率, 用户纠正频率, 跨模型交叉验证)
```

---

## V8 Is / Is-not

| Is | Is-not |
|----|--------|
| V7 在大上下文约束下的架构简化与增强 | 新的认知能力设计 |
| 从"token 稀缺"到"注意力稀缺"的约束转移 | 放弃 V7 的编排层定位 |
| 引入独立统计验证 + 自动推进机制 | AI 推理引擎 |
| 删除 token 妥协模块后的简化架构 | 1M 上下文的盲目乐观（注意力稀释是真实风险） |

---

## V7 → V8 模块变化矩阵

| V7 模块 | V8 状态 | 原因 |
|---------|--------|------|
| `salience-marker.ts` | ❌ 删除 | token 够用，完整 transcript 交给 LLM |
| `pattern-detector.ts` | ❌ 删除 | token 够用，不需要 PMI 预筛选 |
| `scene-matcher.ts` (选择注入) | ❌ 删除 | 全量注入下不需要选择性匹配 |
| **`scene-matcher.ts` (场景识别)** | 🔄 **保留为 scene-recognizer.ts** | **场景识别是认知架构基础，不可删除** |
| `context-builder.ts` (注入策略) | ❌ 删除 | token 约束解除 |
| **`context-builder.ts` (置信度校准)** | 🔄 **保留到 context-organizer** | **LLM 需要知道哪些结构可信、哪些仅供参考** |
| `context-builder.ts` | 🔄 替换为 context-organizer.ts | 从"选择策略"变为"组织策略" |
| `confidence-updater.ts` | 🔄 替换为 confidence-fuser.ts | 从"单一信号"变为"多源融合" |
| `proto-constructor.ts` | 🔄 合并到 transcript-analyzer.ts | 统计预筛选 + LLM 归纳合并为一步 |
| `degradation-checker.ts` | 🔄 增强 | 从 cron-only 到实时 + cron 双重 |
| — | ✅ 新增 `statistical-verifier.ts` | 独立于 LLM 的工具序列验证 |
| — | ✅ 新增 `local-cache.ts` | AgentMemory 降级缓存 |
| — | ✅ 新增 `transcript-analyzer.ts` | 端到端 transcript → 结构化认知 |

---

## 兄弟文件

- [Why AgentOS V8?](why.md) — 第一性原理：为什么 1M 上下文改变了架构
- [Who is it for?](who.md) — 角色职责的变化
- [How does it work?](how.md) — 层级化组织、统计验证、双信号融合
- [When does it operate?](when.md) — 简化的实现路线图
- [Where does it sit?](where.md) — 模块树（删除 + 新增 + 修改）
- [Architecture Design](design.md) — 技术规格与 API 契约
