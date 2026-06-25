
● Update(CLAUDE.md)
Added 27 lines
# CLAUDE.md

## Praxis 项目上下文
机本体论的定义是："共享概念模型的明确的形式化规范说明"。Praxis 做的正是这件事——它从原始对话中提取概念模型（ProtoStructure），赋予置信度（形式化规范），注入 LLM 
— 共相在事物之中，在心智中作为概念 │ 观察 + LLM 归纳 — 从具体实例中提取模式                     │ ✅ 当前主路径                        │
└───────────────────────────────────────────┴────────────────────────────────────────────────────────────┴──────────────────────────────────────┘
这篇文章读完了。让我用第一性原理的方式，把本体论的核心概念映射到 Praxis 的架构上。

---
从本体论看 Praxis：十个架构洞察

1. Praxis 的本质：一个"计算本体论"引擎

文章给计算机本体论的定义是："共享概念模型的明确的形式化规范说明"。Praxis 做的正是这件事——它从原始对话中提取概念模型（ProtoStructure），赋予置信度（形式化规范），注入 LLM 上下文（共享）。

但 Praxis 和传统知识图谱有一个关键区别：

知识图谱:  人类专家 → 手动定义类/关系/公理 → 静态本体
Praxis:    LLM观察 → 自动提取ProtoStructure → 概率本体（置信度随时间演化）

启发：Praxis 不是静态知识库，它是概率化的、自我演化的计算本体论。这一定位应该被明确写入架构文档。

2. 共相与殊相 → ProtoStructure 置信度的哲学基础

中世纪"共相之争"的三派直接映射到 Praxis 的学习策略：

┌───────────────────────────────────────────┬────────────────────────────────────────────────────────────┬──────────────────────────────────────┐
│                 哲学立场                  │                       Praxis 等价物                        │               当前实现               │
├───────────────────────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ 极端实在论 — 共相先于殊相存在             │ Bootstrap ProtoTask (置信度 0.2) — 从 LLM 通用知识预设模式 │ ✅ V11                               │
├───────────────────────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ 唯名论 — 只有殊相真实，共相只是名称       │ 纯观察驱动 — 不预设任何结构，仅从原始数据归纳              │ ⚠️ 仅在 V6 Proto-Cognitive Engine 中 │
├───────────────────────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ 概念论 — 共相在事物之中，在心智中作为概念 │ 观察 + LLM 归纳 — 从具体实例中提取模式                     │ ✅ 当前主路径                        │
└───────────────────────────────────────────┴────────────────────────────────────────────────────────────┴──────────────────────────────────────┘

启发：Praxis 已经在无意识中实现了三种"共相策略"。可以显式化为一个 ontologyStance 配置，让运维者选择偏"唯名论"（保守，只从数据学）还是偏"实在论"（激进，bootstrap 更多预设）。

3. 奎因的"本体论承诺" → 结晶化阈值的形式化

奎因说："存在就是成为约束变元的值"——一个理论必须用量化变量指代的东西，就是该理论承诺存在的实体。

这对 Praxis 的结晶化（crystallization）阈值有直接意义：

当前: confidence > 0.8 + observations >= 5 → 结晶化

奎因式重构:
  一个 ProtoStructure 应该被结晶化，当且仅当:
    1. 如果不假设它的存在，就无法解释观察到的行为模式（必要性）
    2. 假设它的存在后，预测成功率显著高于不假设（充分性）
    3. 没有更简单的替代结构能同等解释观察（奥卡姆剃刀）

⚠️ 当前实现的问题：结晶化只看置信度和观察次数，不看必要性和不可替代性。一个被观察 100 次但从不影响 LLM 行为的"僵尸结构"（V9 注意力遥测已发现这类问题），按奎因标准不应该存在。

启发：结晶化条件应增加"反事实检验"——移除该结构后，LLM 的行为是否显著变差

4. 海德格尔的"存在论差异" → V5 Meta Layer 的哲学锚点

海德格尔区分"存在"（Sein）和"存在者"（Seiendes）：

存在者 (Seiendes)  = Praxis 学到的具体 ProtoStructure
存在 (Sein)        = ProtoStructure 被学习的那个框架本身
                    （为什么有这 4 种类型？为什么用置信度？
                     为什么用预测协议？）

V5 的 Meta Layer 正是 Praxis 的"存在论差异"实现——它不处理具体结构，它审视结构背后的框架。但 V5 缺了一个关键维度：它不去问"为什么是这 4 种 ProtoStructure 类型？有没有第 5 种？"

启发：Meta Layer 应该周期性地执行"范畴审计"——审视 Praxis 自身的类型系统是否足够。场景中反复出现但无法被现有 4 种 ProtoStructure 类型捕获的模式 →
提议新范畴。这正是亚里士多德在《范畴篇》做的事，Praxis 应该对自身的范畴

5. 关系本体论 → ProtoStructure 依赖图

量子力学揭示：事物的属性不是内在固有的，而是在与其他系统的相互作用（关系）中才得以显现。

Praxis 当前将 ProtoStructure 视为独立实体。但实际上：
- ProtoRole 的"角色行为"只在 ProtoSequence 的上下文中才有意义
- ProtoConcept 的定义依赖于它与其他概念的关系
- ProtoPurpose 是对 ProtoSequence 的元级描述

启发：应该显式建模 StructureDependencyGraph——一个 ProtoStructure 的置信 如果"门诊流程"ProtoSequence 的置信度从 0.8 降到
2. **零先验学习** — 在完全陌生的场景中从原始观察构建认知，而非依赖预设模板
3. **统计验证独立性** — 置信度不依赖 LLM 自评；工具序列的实际匹配提供独立验证信号
4. **优雅降级** — 4 级压力自适应保证在上下文紧张时仍保留核心功
5. **知行闭环** — 知识结构化地驱动执行，执行结果结构化地反馈知识
6. **人类治理** — 新认知结构的创建需人类审批；任何结构可回滚

---

## 相关文档

- [完整架构设计](architech/praxis-architecture.md) — V1-V13 所
- [原始设计迭代](draft/) — 每个版本的 why/what/how/when/where/who + design
- [CLAUDE.md](CLAUDE.md) — 行为准则和 skill 路由

  Thought for 5s

Now let me update CLAUDE.md with Praxis-specific project context — the current file has only generic behavioral guidelines with no project information.

● Update(CLAUDE.md)
Added 27 lines
# CLAUDE.md

## Praxis 项目上下文

**Praxis** 是 AI 认知操作系统 — 在 LLM 与外部世界之间的中间件，赋予 AI 跨会话记忆、学习和任务编排能力。

### 架构
- **六层架构**: L1 工具集成 → L2 任务编排 → L3 知识管理 → L4 学习闭环 → L5 能力模型 → L6 自主决策
- **核心模块**: `src/cognitive/` — CognitiveCore, Governor, TaskStateMachine, ProtoTask, TaskScheduler, SubagentManager, HeartbeatMonitor, SceneRecognizer, Sign
alDetector
- **完整设计**: `architech/praxis-architecture.md` (V1-V13 架构迭代)
- **原始迭代**: `draft/V1/` 到 `draft/V13/`

### 关键概念
- **Result\<T\>**: 所有异步 API 返回 `{ ok: true, value: T } | { ok: false, error: {...} }`，调用方通过 `result.ok` 分支
- **Session 隔离**: `core.createSession(id)` 为每个会话创建独立的 CognitiveCore 实例
- **学习环路**: 任务评估(assessTask) → 执行反馈(captureCorrection) → 学习更新(finalizeLearning)
- **ProtoTask**: 零样本任务模板，bootstrap 置信度 0.2，随项目积累成长
- **任务状态机**: 两层嵌套 — 外层(任务级 7 状态) + 内层(子任务级 4 状态+中间态)

### 测试
- `npm test` — vitest run
- `npm run typecheck` — tsc --noEmit

### 架构文档
- 完整架构: `architech/praxis-architecture.md`
- 原始迭代: `draft/` (V1-V13, 每版本 ~6 文件: what/why/how/when/where/who + design)

---

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

  Thought for 3s

Let me verify the docs are consistent and run a quick check.

  Thought for 2s, searched for 1 pattern, ran 1 shell command

All 482 tests pass. Links are valid. Let me commit the documentation changes.

  Thought for 9s, committed 0512ab4, ran 2 shell commands

Documentation generated and committed. Here's the summary:

---
Documentation Generated

Scope: Praxis 项目入口文档重写 — README.md (完整重写) + CLAUDE.md (Praxis 上下文注入)

Files: 2 modified, 0 new

Coverage:

┌─────────────┬───────────┬────────────────────────────────────────────────────────────────────┐
│  Quadrant   │   Files   │                            Description                             │
├─────────────┼───────────┼────────────────────────────────────────────────────────────────────┤
│ Reference   │ README.md │ 完整 API 模块表(24 个导出模块)、六层架构、项
├─────────────┼───────────┼────────────────────────────────────────────────────────────────────┤
│ Explanation │ README.md │ V1→V13 架构迭代历程表、设计原则(6 条)、一句
└─────────────┴───────────┴────────────────────────────────────────────────────────────────────┘

What changed from the old README:
- 旧版: 4 种记忆类型 + CognitiveCore 基础 API (~100 行，V1 时代)
- 新版: 全面覆盖 V1-V13 架构 + 当前所有模块(Governor, ProtoTask, TaskStateMachine, TaskScheduler, SubagentManager, HeartbeatMonitor, SceneRecognizer 等) + 架构迭代历程 +
设计原则 (~270 行)

Quality gates:
- Accuracy: ✅ 所有 API 模块名与 src/cognitive/index.ts 导出一致；所有架构概念与 architech/praxis-architecture.md 一致
- Completeness: ✅ 覆盖所有公共导出模块、架构层、迭代版本
- Links: ✅ 所有链接指向存在的文件
- Tests: ✅ 482 tests passing, 29 test files — 无回归

Not changed (already comprehensive):
- architech/praxis-architecture.md — 760+ 行完整架构设计，无需修改
- draft/ — 80+ 原始迭代文件，无需修改

✻ Worked for 8m 35s

※ recap: Rewrote README and CLAUDE.md to reflect full V13 architecture (was V1-era), committed. 482 tests still pass. Ready to push or iterate.

❯ /office-hours 阅读 @docs/超深度解析：本体论（Ontology）——从形而上学的终极追问到数字时代的知识架构.md 看看对Praxis有什么启发
Read docs\超深度解析：本体论（Ontology）——从形而上学的终极追问到数字时代的知识架构.md (156 lines)

  Thought for 32s

这篇文章读完了。让我用第一性原理的方式，把本体论的核心概念映射到 Praxis

---
从本体论看 Praxis：十个架构洞察

1. Praxis 的本质：一个"计算本体论"引擎

文章给计算机本体论的定义是："共享概念模型的明确的形式化规范说明"。Praxis 做的正是这件事——它从原始对话中提取概念模型（ProtoStructure），赋予置信度（形式化规范），注入 LLM 上下文（共享）。

但 Praxis 和传统知识图谱有一个关键区别：

知识图谱:  人类专家 → 手动定义类/关系/公理 → 静态本体
Praxis:    LLM观察 → 自动提取ProtoStructure → 概率本体（置信度随时间演化）

启发：Praxis 不是静态知识库，它是概率化的、自我演化的计算本体论。这一定

2. 共相与殊相 → ProtoStructure 置信度的哲学基础

中世纪"共相之争"的三派直接映射到 Praxis 的学习策略：

┌───────────────────────────────────────────┬────────────────────────────────────────────────────────────┬──────────────────────────────────────┐
│                 哲学立场                  │                       Praxis 等价物                        │               当前实现               │
├───────────────────────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ 极端实在论 — 共相先于殊相存在             │ Bootstrap ProtoTask (置信度 0.2) — 从 LLM 通用知识预设模式 │ ✅ V11                               │
├───────────────────────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ 唯名论 — 只有殊相真实，共相只是名称       │ 纯观察驱动 — 不预设任何结构，仅从原始数据归纳              │ ⚠️ 仅在 V6 Proto-Cognitive Engine 中 │
├───────────────────────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────┤
│ 概念论 — 共相在事物之中，在心智中作为概念 │ 观察 + LLM 归纳 — 从具体实例中提取模式                     │ ✅ 当前主路径                        │
└───────────────────────────────────────────┴────────────────────────────────────────────────────────────┴──────────────────────────────────────┘

启发：Praxis 已经在无意识中实现了三种"共相策略"。可以显式化为一个 ontologyStance 配置，让运维者选择偏"唯名论"（保守，只从数据学）还是偏"实在论"（激进，bootstrap 更多预设）。

3. 奎因的"本体论承诺" → 结晶化阈值的形式化

奎因说："存在就是成为约束变元的值"——一个理论必须用量化变量指代的东西，就是该理论承诺存在的实体。

这对 Praxis 的结晶化（crystallization）阈值有直接意义：

当前: confidence > 0.8 + observations >= 5 → 结晶化

奎因式重构:
  一个 ProtoStructure 应该被结晶化，当且仅当:
    1. 如果不假设它的存在，就无法解释观察到的行为模式（必要性）
    2. 假设它的存在后，预测成功率显著高于不假设（充分性）
    3. 没有更简单的替代结构能同等解释观察（奥卡姆剃刀）

⚠️ 当前实现的问题：结晶化只看置信度和观察次数，不看必要性和不可替代性。一个被观察 100 次但从不影响 LLM 行为的"僵尸结构"（V9 注意力遥测已发现这类问题），按奎因标准不应该存在。

启发：结晶化条件应增加"反事实检验"——移除该结构后，LLM 的行为是否显著变差？如果不，该结构不配存在。

4. 海德格尔的"存在论差异" → V5 Meta Layer 的哲学锚点

海德格尔区分"存在"（Sein）和"存在者"（Seiendes）：

存在者 (Seiendes)  = Praxis 学到的具体 ProtoStructure
存在 (Sein)        = ProtoStructure 被学习的那个框架本身
                    （为什么有这 4 种类型？为什么用置信度？
                     为什么用预测协议？）

V5 的 Meta Layer 正是 Praxis 的"存在论差异"实现——它不处理具体结构，它审视结构背后的框架。但 V5 缺了一个关键维度：它不去问"为什么是这 4 种 ProtoStructure 类型？有没有第 5 种？"

启发：Meta Layer 应该周期性地执行"范畴审计"——审视 Praxis 自身的类型系统是否足够。场景中反复出现但无法被现有 4 种 ProtoStructure 类型捕获的模式 → 提议新范畴。这正是亚里士多德在《范畴篇》做的事，Praxis 应该对自身的范畴系统做同样的事。

5. 关系本体论 → ProtoStructure 依赖图

量子力学揭示：事物的属性不是内在固有的，而是在与其他系统的相互作用（关系）中才得以显现。

Praxis 当前将 ProtoStructure 视为独立实体。但实际上：
- ProtoRole 的"角色行为"只在 ProtoSequence 的上下文中才有意义
- ProtoConcept 的定义依赖于它与其他概念的关系
- ProtoPurpose 是对 ProtoSequence 的元级描述

启发：应该显式建模 StructureDependencyGraph——一个 ProtoStructure 的置信度变化应该传播到依赖它的结构。如果"门诊流程"ProtoSequence 的置信度从 0.8 降到
0.4（用户纠正），那么依赖它的 ProtoRole（"门诊医生"）和 ProtoConcept（"  。

这在当前架构中不存在——置信度更新是逐结构的，没有传播。

6. 迈农主义 → "亚存在"结构的处理

迈农说："不存在的事物也有某种本体论地位"（圆的方形、福尔摩斯——它们"有"属性，只是缺乏"存在"属性）。

Praxis 每天都会遇到"亚存在"结构：
- 置信度 0.1-0.3 的 ProtoStructure — 太弱不能注入，但有信息价值
- 被退化（degraded）的结构 — 不再活跃，但包含历史教训
- 被拒绝（rejected）的结晶化提案 — 证明某条路行不通

当前 Praxis 怎么处理它们？ 被退化和被拒绝的结构最终被归档或删除。

启发：这些"非存在但存有的结构"应该保留在一个 SubsistenceRegistry 中，作为"已知的死胡同"和"未被证实的猜想"。当类似场景再次出现时，它们可以作为负例（"上次我们发现这个模式不成立"）或低优先级候选（"有一个未被证实的假设可以参考"）注入。

7. 范畴论 → Praxis 的类型系统需要第 5 种 ProtoStructure

亚里士多德的 10 范畴：实体、数量、性质、关系、地点、时间、姿态、状态、动作、承受。

Praxis 只有 4 种：Sequence、Role、Concept、Purpose。

对比发现明显缺失：

┌───────────────────┬──────────────────────────┬───────────────────────────────────────────────┐
│  亚里士多德范畴   │      Praxis 覆盖？       │                   缺失表现                    │
├───────────────────┼──────────────────────────┼───────────────────────────────────────────────┤
│ 实体 (Substance)  │ 部分覆盖 (ProtoRole)     │ ProtoRole 混合了"角色"和"实体"                │
├───────────────────┼──────────────────────────┼───────────────────────────────────────────────┤
│ 数量 (Quantity)   │ ❌ 缺失                  │ "大型项目通常 3-5 人"这类量化知识无处存储     │
├───────────────────┼──────────────────────────┼───────────────────────────────────────────────┤
│ 性质 (Quality)    │ ❌ 缺失                  │ "这个 API 应该是幂等的"这类规范性知识无处存储 │
├───────────────────┼──────────────────────────┼───────────────────────────────────────────────┤
│ 关系 (Relation)   │ ❌ 缺失                  │ "膜力云项目依赖城乡数据平台"这类跨领域关系    │
├───────────────────┼──────────────────────────┼────────────────────────
│ 时间 (Time)       │ 部分覆盖 (ProtoSequence) │ "周报通常在周五下午做"这类时间约束            │
├───────────────────┼──────────────────────────┼───────────────────────────────────────────────┤
│ 约束/公理 (Axiom) │ ❌ 缺失                  │ "一个任务不能同时处于两个互斥状态"            │
└───────────────────┴──────────────────────────┴───────────────────────────────────────────────┘

启发：应该增加 ProtoConstraint（约束/公理类型）作为第 5 种 ProtoStructure，至少覆盖"规范性知识"和"跨领域关系"这两个明显缺口。V9 的 ConsistencyChecker
实际上已经在验证约束，但它验证的约束本身没有被建模为一等公民。
德的认识论转向 → Praxis 的"先验范畴"问题

康德说：人类不是被动接收世界，而是通过先天认知形式（时空观和十二范畴）主动构造经验。

Praxis 有没有自己的"先验范畴"？有：
- 4 种 ProtoStructure 类型（sequence/role/concept/purpose）— 这是 Praxis 的"先天范畴"
- 5 种显著性信号（repetition/user_emphasis/sequence_position/user_correction/novelty）— 这是 Praxis 的"先天感知形式"
- 置信度更新公式（+0.1×(1-c)/-0.2×c/-0.4×c）— 这是 Praxis 的"先天判断力"

康德的洞见是：这些先天形式既使认知成为可能，也限制了认知的边界。Praxis 看不到它没有范畴去接收的东西。

启发：被用户反复纠正但 Praxis 仍然学不会的模式——可能不是因为数据不够，而是因为Praxis 缺少接收这类模式的"范畴"。当一个模式在 3 次以上纠正后仍未形成 ProtoStructure，Meta Layer 应该问："是不是我的范畴系统本身有盲区？" 而不是简单地"再观察几次"。

9. 计算机本体论的 4 要素 → Praxis 的结构完备性检查

计算机本体论（OWL/RDF）的 4 要素：
1. 类/概念 ✅ Praxis: ProtoConcept
2. 属性/槽 ⚠️ 部分覆盖 — ProtoRole 有 behavior 但没有显式的 property schema
3. 关系 ❌ 缺失 — 没有 structure_A → relates_to → structure_B 的显式边
4. 公理/规则 ❌ 缺失 — 没有"如果门诊预约成功，则挂号状态必须已确认"这类跨步骤约束

启发：应该为 ProtoStructure 增加显式的 relations 字段和 axioms 字段。Relation 类型至少包括：depends_on（A 的存在依赖 B）、contradicts（A 和 B 不能同时为真）、specializes（A 是 B 的子类型）、precedes（A 在 B 之前发生）。

10. 终极洞察：Praxis 的"本体论承诺"应该是可审计的

奎因的方法论核心：本体论承诺不是私人的形而上学信念，而是可以从理论的语言
is 当前本体论承诺 (v2.1.3, 2026-06-25):
  已结晶结构 (12):
    - hospital_outpatient_flow v2.1 (置信度 0.87, 23 次观察)
    - api_design_pattern v1.0 (置信度 0.82, 15 次观察)
    ...
  原型结构 (8):
    - proto_meeting_cadence_001 (置信度 0.45, 5 次观察)
    ...
  亚存在结构 (3):
    - rejected: 旧版门诊流程 v1.0 (被 v2.1 取代)
    ...
  范畴系统:
    当前范畴: Sequence, Role, Concept, Purpose (4 种)
    待审查范畴提案: Constraint (1 次提议, 未批准)

---
最值得立刻做的三件事

1. 增加 ProtoConstraint 作为第 5 种 ProtoStructure 类型 — 覆盖规范性知识和跨结构约束，这是当前最大的类型盲区。
2. 实现 StructureDependencyGraph — 当一个结构的置信度变化时，传播到依赖它的结构。这是关系本体论的直接工程应用。
3. 增加"反事实检验"作为结晶化的必要条件 — "如果移除这个结构，预测准确率是否显著下降？" 不下降 → 不配结晶化。比当前的纯置信度阈值更可靠。

---
这些洞察中哪个方向你想深入讨论？

✻ Cooked for 1m 7s

❯ 再读下 @"docs\超深度解析：工程本体论（Engineering Ontology）——从造物哲学
Read docs\超深度解析：工程本体论（Engineering Ontology）——从造物哲学到数字孪生的语义基石.md (121 lines)

  Thought for 10s

读完了。这篇文章比上一篇"纯哲学本体论"更贴近 Praxis 的工程现实。让我做同样的概念映射。

---
从工程本体论看 Praxis：八个架构洞察

1. 双重性质理论 → Praxis 认知结构的"结构面"和"功能面"分裂

工程本体论的核心：任何工程造物同时具有物理结构（物质实体）和意向功能（人类目的），两者不可互相还原。

Praxis 的 ProtoStructure 当前将两者混在一个对象里：

# 当前 Praxis: 结构描述和功能意图混在一起
ProtoSequence:
  tentative_name: "门诊流程"
  sequence:
    - position: 1
      tentative_label: "挂号"
      # 这是"发生了什么"（结构面）还是"为什么要做"（功能面）？

问题：当前的 ProtoSequence 只记录了结构面（"步骤 1 是挂号"），没有显式记建立医患法律关系"）。当用户说"我们不需要挂号了，改成在线预检分诊"——Praxis不知道这到底是替换了步骤（结构改变）还是用另一种方式实现了同一目的（结构改变、功能不变）。

启发：ProtoStructure 应该引入双重性质建模：

interface ProtoSequenceV2 {
  // 结构面：发生了什么
  structure: {
    steps: { position: number; action: string; agent: string }[];
    observed_timing: string;  // "通常 5-10 分钟"
  };

  // 功能面：为什么这么做
  function: {
    purpose: string;           // "建立医患法律关系，确定就诊优先级"
    precondition: string[];    // ["患者未处于就诊状态"]
    postcondition: string[];   // ["患者已进入候诊队列"]
    failure_modes: string[];   // ["挂错科室", "无法确认身份"]
  };

  // 结构面 → 功能面的映射
  teleological_mapping: {
    step_index: number;
    contributes_to: string;    // 指向 function.purpose 中的条款
    criticality: 'essential' | 'supporting' | 'optional';
  }[];
}

这样当结构变化时，Praxis 可以判断：功能还满足吗？ 如果不满足，是真的需要重新学习（置信度下调）。如果结构变了但功能不变（比如"挂号窗口"换成"自助挂号机"），那只是一个 teleological_mapping 的更新，不需要整个 ProtoSequence 置信度下调。

2. 同一性与时间演化 → ProtoStructure 应该是"四维主义"的

文章指出：一架波音 747 服役 30 年间几乎所有部件都被更换过——它还是同一架飞机吗？工程本体论的答案是四维主义：将实体定义为在时间轴上延伸的"时空虫"。

当前 Praxis 的 ProtoStructure 是瞬时快照——只有一个 confidence 和一个 last_updated_at。它不知道自己 3 个月前是什么样子、经历了什么变化、为什么变化。

启发：每个 ProtoStructure 应该有一个 evolution_spacetime：

interface StructureEvolutionTrace {
  structure_id: string;
  timestamps: {
    first_observed: number;     // 首次出现
    crystallized_at?: number;   // 结晶化时间
    degraded_at?: number;       // 退化时间
    last_modified: number;
  };

  // 关键：不是"当前置信度"，而是时间切片序列
  time_slices: {
    at: number;
    confidence: number;
    observation_count: number;
    active_scenarios: string[];  // 当时在哪些场景中被使用
    structure_snapshot_hash: string;  // 结构内容哈希
    change_type: 'refinement' | 'correction' | 'expansion' | 'contradiction' | 'fusion' | 'split';
    change_rationale?: string;   // 为什么变
  }[];

  // 同一性判断：以下变化的组合是否仍然保持"同一个结构"？
  identity_rules: {
    // "如果功能目的不变，即使步骤序列全变了，仍是同一结构"
    functional_identity: boolean;
    // "如果 50% 以上的步骤被替换 → 视为新结构"
    structural_threshold: number;
  };
}

这解决了什么实际问题？当用户问"我上次教你的门诊流程怎么又忘了？"——Praxis 可以回答："我没有忘，它经历过 3 次修正。当前版本 v1.3 是上个月根据你反馈的流程变更更新的。这是变更历史……"

3. 跨学科异构性 → V8 的局限：一个 LLM 不能覆盖所有"工程学科"

文章的核心痛点：机械工程师用 CAD、电气工程师用 EDA、软件工程师用 UML、土木工程师用 BIM——底层数据模型互不相通。

Praxis 当前假设：一个 LLM（Claude）可以通过观察对话学习所有领域。但这忽略了"学科异构性"的本质：

- 软件工程场景的 ProtoStructure 类型可能需要完全不同的范畴系统
- 物理设备控制场景的学习信号来自工具调用成败，而非对话语义
- 建筑设计场景的"约束"是物理定律（重力、材料强度），不是用户偏好

⚠️ 此处存在根本性局限：当前 Praxis 对"跨领域"的理解是切换 scenario_id（从 hospital_outpatient 切换到 api_design）。但真正的跨学科异构意味着：不仅场景不同，认知范畴本身也不同。软件工程关心的 ProtoSequence 是"数据流"，物理工程关心的是"物质流"和"能量流"——它们不是同一种"序列"。

启发：应该允许不同领域注册不同的 ProtoStructure 子类型：

软件工程领域:
  ProtoSequence → ProtoDataFlow (数据如何在系统间流转)
  ProtoConstraint → ProtoInvariant (数据库约束、类型约束)

物理工程领域:
  ProtoSequence → ProtoMaterialFlow (物料如何流转)
  ProtoConstraint → ProtoPhysicalLaw (重力、热力学)

Praxis 的 Meta Layer 不应该只审计"范畴是否够用"，
还应该审计"不同领域的范畴是否在强行统一"。

这实际上意味着"范畴系统"本身应该按领域（domain）分叉。

4. 语义模糊性 → Praxis 需要一个"同名异义词"消歧器

文章的例子："泵"在机械本体中是物理组件（叶轮+壳体），在流体系统本体中是功能黑盒（提供压头），在控制本体中是执行器（启停状态）。

Praxis 会遇到的等价问题：用户说"对接"——
- 在场景 A（API 开发）中："对接" = 两个系统的 API 集成
- 在场景 B（干系人沟通）中："对接" = 和客户开会确认需求
- 在场景 C（数据处理）中："对接" = 数据格式转换

当前 Praxis 没有跨场景语义消歧机制。同一个词在不同场景中可能被映射到不同的 ProtoConcept，但它们之间没有显式的"这是同一个词的不同意义"关系。

启发：增加 SemanticDisambiguator，维护一个跨场景的同形异义词注册表：

interface HomonymEntry {
  surface_form: string;        // "对接"
  meanings: {
    scenario_id: string;
    concept_id: string;
    definition: string;        // "两个系统的 API 集成"
    distinguishing_context: string;  // 出现"接口"、"联调"等相关词时激活
  }[];
}

当 message_received 检测到模糊术语时，主动用当前场景上下文消歧，减少因为"听错意思"导致的学习噪声。

5. 本体演化的版本控制 → Praxis 当前缺失的最关键基础设施

文章强调：工程标准是不断迭代的（国五→国六排放标准）。当底层本体改变时，如何保证依赖它的上层应用不崩溃？需要本体版本管理和差异比对算法。

Praxis 的 ProtoStructure 当前没有版本概念——只有一个 confidence 数值。当用户纠正了一个步骤，旧版本直接被覆盖。

但 Praxis 的场景比工程本体更复杂：

工程标准:  国五 → 国六 (单向、权威发布、有过渡期)
Praxis 认知: 用户纠正 → 置信度下降 → 可能后来又回升
             (双向、不确定性高、随时可能反转)

启发：Praxis 需要的是 ProtoStructureVersionChain（不是 Git 那种线性的，而是支持分支和融合的）：

interface ProtoStructureVersionChain {
  structure_id: string;

  head_version: string;  // "v3" — 当前活跃版本

  versions: {
    version_id: string;
    parent_version: string | null;     // 从哪个版本派生
    merge_sources?: string[];          // 如果从多个版本融合
    created_at: number;
    created_by: 'user_correction' | 'auto_refinement' | 'crystallization' | 'degradation' | 'fusion';

    // 与父版本的差异（结构化 diff，不是全文对比）
    diff: {
      type: 'step_added' | 'step_removed' | 'step_reordered' | 'confidence_changed' | 'purpose_refined';
      path: string;          // "sequence.steps[2]"
      old_value: unknown;
      new_value: unknown;
    }[];

    // 为什么创建这个版本
    rationale: string;
    evidence: string[];      // 支持这个版本变更的观察/用户纠正

    // 这个版本在实践中表现如何
    performance: {
      prediction_accuracy: number;  // 使用这个版本时的预测准确率
      user_satisfaction: number;
      active_duration_days: number;
    };
  }[];

  // 回滚能力
  rollback_to(version_id: string): ProtoStructureVersionChain;
}

这直接实现了 V5/V6 的可回滚约束（"任何结构可回滚"），但目前没有任何工程实现支撑。

6. 粒度控制 → Praxis 的"注入预算"应该从 token 数量升级为语义粒度

文章提出：粒度过细 → 组合爆炸，粒度过粗 → 丧失工程指导意义。需要基于具体任务动态裁剪。

当前 Praxis 的粒度控制是纯量化的——V9 的四级压力自适应按 token 数 裁剪内容。但没有考虑语义粒度：

- 一个刚学会"软件开发"的 Praxis 实例 → 注入"软件项目的 5 个标准阶段"就够了（粗）
- 一个在特定团队做了 10 个医院系统的 Praxis 实例 → 需要注入"医保对接模块的 3 个具体陷阱"（细）

启发：粒度应该由两个维度共同决定：

1. 上下文压力（已实现）：Normal → Critical，token 预算递减
2. 认知成熟度（未实现）：Novice → Expert，语义粒度递增

Novice Praxis 的注入（认知成熟度低）:
  "Phase 2 是 API 开发阶段，通常需要 3-4 周"

Expert Praxis 的注入（认知成熟度高）:
  "Phase 2: API 开发 (通常 3.3 周, 标准差 0.8 周, 基于 7 次观察)
   关键子任务:
     2a. 预约挂号 API — 标准 REST, 注意并发控制 (陷阱: 号源超卖, 3/7 项目出现)
     2b. 医保对接模块 — 外部依赖风险高 (6/7 项目延期, 平均延期 2.1 周)
     ..."

这其实是知识密度的自适应——token 一样多时，成熟度越高，注入的"单位 token 信息量"越大。

7. 神经符号 AI → 这是 Praxis 架构的最终形态

文章点出了 Praxis 的终极定位："符号逻辑（本体）+ 神经网络（LLM）= 神经符

回顾 Praxis V1→V13 的演进，这一点越来越清晰：

V1-V6: 纯符号设计（六层架构、数据模型、学习闭环——全是手工规则）
V7-V9: LLM 引入（场景识别、transcript 分析——符号框架 + LLM 执行）
V10-V13: 混合深化（ProtoTask 是符号模板，LLM 是填充者；置信度融合混合了统计和 LLM）

但当前架构中，符号侧和神经侧的权重是不平衡的：
- 符号侧（置信度算法、统计验证器、任务状态机）：精确但脆弱
- 神经侧（LLM 分析、场景识别）：灵活但不可靠

文章提出的解决方案是Constrained Decoding——用本体公理对 LLM 输出进行逻辑校验与约束。

Praxis 还没有做到这一点。当前的 prediction-protocol 是事后检测 LLM 的错误（[PREDICTION_FAILED: ...]），不是在 LLM 生成时事前约束。

启发：Praxis 应该实现一个 OntologicalConstraintLayer——在 LLM 生成前注入公理约束：

当前（事后纠正）:
  LLM 输出 → [PREDICTION_FAILED: tool_used was file_write, predicted data_query]
  → 置信度下调 → 下次注意

理想（事前约束）:
  ProtoAxiom: "处方开具必须在诊断之后"
  → 注入到 system prompt: "CRITICAL CONSTRAINT: 在任何涉及处方的操作前，
    必须先完成诊断操作。违反此约束的操作将被拒绝。"
  → LLM 在生成时被约束 → 不会提出违规操作

8. 工程本体的生命周期 → Praxis 缺少一个"认知退役"机制

ISO 15926 和 IFC 都有完整的生命周期管理：设计 → 建造 → 运营 → 报废。

当前 Praxis 的结构生命周期只有 4 个状态（hypothesized → candidate → experecated/rejected），缺了退役后的知识保留。

工程本体论的做法是：一个被取代的标准不会消失，它被标记为"已取代"，并保留

但 Praxis 的 degraded 和 rejected 结构当前被归档或删除。上一轮讨论中提到的"亚存在结构"（迈农主义）在这里找到了工程对应物——被取代的工程标准仍然有参考价值，因为老系统可能还在按旧标准运行。

启发：增加 StructureRetirementPolicy：

interface StructureRetirementPolicy {
  // 不是删除，而是转换状态
  retired_structure: {
    structure_id: string;
    retired_at: number;
    reason: 'superseded' | 'obsolete' | 'contradicted' | 'domain_inactive';

    // 关键：保留到新结构的映射
    superseded_by?: string[];       // 被哪些结构取代
    equivalent_in_new_context?: string;  // 在新上下文中对应什么

    // 退役后何时还能被激活
    reactivation_conditions: {
      // 如果老场景重新出现 → 可以重新激活
      scenario_ids: string[];
      // 如果新结构置信度跌破阈值 → 可以回退
      fallback_if_new_fails: boolean;
    };

    // 保留的关键教训
    retained_lessons: string[];
  };
}

---
与前一篇"纯哲学本体论"的交叉对照

两篇文章合在一起，画出了 Praxis 目前最大的架构缺口：

┌──────────────────────┬────────────────────────────────────────────┬────────────────────────────────────┐
│     哲学本体论 →     │                Praxis 缺口                 │            ← 工程本体论            │
├──────────────────────┼────────────────────────────────────────────┼────────────────────────────────────┤
│ 共相之争（3 种立场） │ 没有显式的 ontology stance 配置            │ 双重性质理论（结构面+功能面分裂）  │
├──────────────────────┼────────────────────────────────────────────┼────────────────────────────────────┤
│ 奎因的本体论承诺     │ 结晶化只看置信度，不做反事实检验           │ 本体演化的版本控制                 │
├──────────────────────┼────────────────────────────────────────────┼────────────────────────────────────┤
│ 海德格尔的存在论差异 │ Meta Layer 不审计范畴系统本身              │ 跨学科异构（不同领域需要不同范畴） │
├──────────────────────┼────────────────────────────────────────────┼────────────────────────────────────┤
│ 迈农的亚存在对象     │ 被拒绝/退化的结构直接丢弃                  │ 退役标准的保留与映射               │
├──────────────────────┼────────────────────────────────────────────┼────────────────────────────────────┤
│ 康德的先验范畴       │ 从不质疑"4 种 ProtoStructure 类型是否够用" │ 语义模糊性（同名异义词跨场景消歧） │
├──────────────────────┼────────────────────────────────────────────┼────────────────────────────────────┤
│ 亚里士多德的范畴表   │ 缺第 5 种 ProtoConstraint                  │ 粒度控制（token 数量→语义密度）    │
└──────────────────────┴────────────────────────────────────────────┴────────────────────────────────────┘

最大的洞见是：哲学本体论告诉你"看不见什么"（范畴盲区），工程本体论告诉你"怎么在看不见的情况下仍然让系统运作"（版本管理、异构映射、粒度裁剪）。两者互补，一个诊断问题，一个提供解决方案。

---
最值得立刻做的三件事（修订版）

基于工程本体论的补充：

1. 为 ProtoStructure 引入双重性质建模（结构面 + 功能面 + teleological_ma判断功能是否改变，再决定置信度调整幅度。
2. 实现 ProtoStructureVersionChain — 每个结构保留完整的时间切片序列和支持的分支/融合版本历史。这是 V5 "任何结构可回滚"的工程实现前提。
3. 增加 OntologicalConstraintLayer — 在 LLM 调用前将已结晶的 ProtoConstraint 作为 hard constraint 注入 prompt，实现从事后检测到事前约束的升级。

✻ Cogitated for 1m 4s

我现在不好下判断，你结合「第一性原理」以及「推理诚实性规则」，前面的结论你是怎么得出来的，并论证下如果从长期规划全局考虑，Praxis后续应该怎么全面演化？不要仅局限于最值得立刻做的三件事，分出优先级就行，我需要一个演变的全貌

好的。这个任务要求我先审视自己前面的推理过程是否诚实，再从第一性原理重建分析。让我严格按照规则顺序来。

---
第一步：列出已知事实与相关信息

不可否认的事实（物理/逻辑约束）

1. LLM 是无状态的。每次 API 调用不携带上一次调用的内部状态。跨会话记忆必须由外部系统提供。这是 LLM 推理引擎的基本架构约束，非选择。
2. 上下文窗口是有限的。当前 Claude 模型支持 1M tokens，但存在注意力衰减（长上下文中部信息被有效忽略）。窗口大小是物理约束（GPU 内存/计算），注意力衰减是当前架构的实测特性。
3. LLM 输出是概率性的。不存在"绝对正确"的 LLM 判断。任何依赖 LLM 做判断的系统，其质量上限 = LLM 质量 × 上下文构建质量 × 验证信号独立性。这是 Transformer 架构的数学约束。
4. 信息只能通过 prompt 注入 LLM。LLM 没有其他输入通道。Praxis 的所有"认知操作"最终都落地为：在正确时间、以正确格式、将正确信息放入 prompt。这是 LLM 接口的物理约束。
5. AgentMemory 提供了持久存储（slot、memory、lesson、pattern 等），但存储本身不产生智能——如何组织、检索、验证存储内容才是智能的来源。
6. 代码已经存在。src/cognitive/ 下有 29 个测试文件、482 个通过的测试。这不是从零开始——任何演化计划必须考虑现有实现的惯性。
                                                                           已知的 Praxis 架构事实

7. V1-V6 建立了认知概念框架（六层架构、多维能力模型、学习闭环、Proto-Cognitive Engine）。
8. V7 确立了工程本质：Context Orchestration Layer（上下文编排层）。
9. V8 通过统计验证器打破了 LLM 自循环，但统计验证只覆盖 ProtoSequence（工具序列匹配）。
10. V9 实现了四级压力自适应，但粒度控制是纯量化的（按 token 数量，非语义密度）。
11. V10-V11 建立了 TaskContext 和知识-行动闭环。
12. V12-V13 建立了任务编排状态机和主动驱动（Scheduler/Subagent/Heartbeat）。
13. 当前代码实现了 V13 架构的一部分：Governor（4 阶段学习管道）、TaskStateMachine、ProtoTask（bootstrap）、TaskScheduler、SubagentManager、HeartbeatMonitor、SceneRecognizer、SignalDetector。

已知的缺口（从前两篇本体论分析中提取）

14. ProtoStructure 只有 4 种类型（Sequence/Role/Concept/Purpose），缺第 5 种 ProtoConstraint。
15. 没有 StructureDependencyGraph（置信度变化不传播）。
16. 结晶化条件只看置信度和观察次数，不做反事实检验。
17. ProtoStructure 没有版本链，不支持 diff/回滚/融合。
18. 双重性质（结构面+功能面）没有在数据模型中分离。
19. 没有跨场景语义消歧（同名异义词）。
20. 没有 OntologicalConstraintLayer（事前约束，只有事后检测）。
21. 没有退役结构的知识保留策略。
22. Meta Layer 不审计自身的范畴系统（"4 种 ProtoStructure 类型够不够"）。

---
第二步：识别信息缺口与不确定性

信息缺口

- [缺口] 没有 Praxis 在生产环境中的运行数据——注意力遥测、预测准确率、用户纠- [缺口] 不知道 OpenClaw 的 Plugin API 对"事前约束 LLM 输出"的支持程度。前提是 hook 能够在 LLM 调用前修改 prompt——[假设]这应该是可行的（session_start 已注入 prompt），但注入"hard constraint"的格式需要与 OpenClaw 的 system prompt 模板协调。
- [缺口] 不知道当前 482 个测试对架构变更的覆盖程度。如果要在 ProtoStructure 中引入双重性质建模，会影响多少现有测试？
- [缺口] 两篇本体论文章是我基于已有结论去"找印证"读的，还是独立阅读后客观推导的？——这是后验合理化检测的关键问题。

不确定性的来源

- ⚠️ 两篇文章是用户提供的。用户指令是"看看对 Praxis 有什么启发"。这意味着存在提示锚定风险——用户期望这些文章对 Praxis 有启发，我可能过度解读了"启发"的数量和深度。
- ⚠️ 我的分析顺序存在倒置。先读了文章 → 然后"找到"了 Praxis 中的对应概念 → 然后提出改进建议。这个顺序本身不一定是后验合理化（因为我确实是在读完文章 是否因为知道"要找启发"而把不够强的概念对应也当作"洞察"？

可能的结论方向 A：本体论框架对 Praxis 有深刻的架构指导价值（我之前的结论）

支撑论据：
- 双重性质理论直接对应 Praxis 当前只记录行为序列、不记录功能意图的缺陷——这是可验证的差距
- 版本链/时间演化的缺失在 V5 就被设计出来了（"任何结构可回滚"），但一直没有工程实现
- 范畴盲区（缺第 5 种类型）被 V9 的 ConsistencyChecker 间接验证——它已经在检测约束违反，但约束本身没有被建模
- 神经符号架构是 Praxis 的自然演化方向——从 V8 的统计验证器（第一个非 LLM 信号）到 OntologicalConstraintLayer（事前符号约束），存在逻辑连续性

可能的结论方向 B：本体论概念对 Praxis 的指导价值有限，是概念过度映射

支撑论据：
- Praxis 的工程本质是"context orchestration layer"——正确的内容在正确的时间注入正确的 prompt。这不是本体论工程，这是 prompt 工程。
- 两篇文章讨论的是人类如何建模世界（哲学本体论）和人类工程师如何用本体语言规范领域知识（工程本体论）。Praxis 的认知结构是LLM 自动提取的概率模型，不是人类手动定义的形式化本体。混淆这两者等于把"地图"（人类手工本体）和"自动生成的概率认知"混为一谈。
- 当前 Praxis 最迫切的工程问题可能不是"本体论框架不完善"，而是更基础的问题：AgentMemory 不可用时的降级路径不够健壮、上下文压力自适应没有经过实际压力测试、任务编排状态机在复杂多 Agent 场景下的正确性未经验证。
- 用户提供的文章可能引导了思考方向——"如果你手里只有锤子，所有东西看起来都像钉子"。本体论文章是锤子，Praxis 的缺口是钉子。

可能的结论方向 C：本体论框架对 Praxis 的元层面（Meta Layer）有重要价值，但对操作层（Orchestration Layer）价值有限

支撑论据：
- Praxis 的 Meta Layer（V5）的职责就是审视"框架本身是否有缺陷"。本体论（尤其是范畴论和奎因的本体论承诺）天然适合 Meta Layer 的分析工具。
- 但 Praxis 的 Orchestration 层（任务编排、计划生成、验收验证）的瓶颈在于状态机的正确性和调度策略的优化——这些与本体论关系不大。
- 这个方向是 A 和 B 的综合——承认本体论对特定层有价值，但不认为它应该驱动整体的架构演化。

---
第四步：反向测试

在形成我自己的结论之前，先对方向 A（我之前的立场）做最严格的反驳：

反方最强论证：Praxis 不需要"本体论"——它需要的是更好的工程实践

1. Praxis 的核心问题不是"缺少哲学框架"，而是缺少生产验证。没有人在生产环境中跑过 V13 的完整架构。在没有使用数据的情况下讨论"应该增加第 5 种 ProtoStructure 类型"是本末倒置——你都不知道现有的 4 种类型是否在真实场景中有用。
2. 两篇本体论文章中列出的 20+ 个"缺口"中，至少有一半是同一类问题换不同哲学词汇重新描述。例如：
  - "结构面和功能面分裂" ≈ "ProtoSequence 不区分步骤和步骤的目的" — 这是同一个 gap
  - "四维主义的时空虫" ≈ "ProtoStructure 需要版本历史" — 同一个 gap
  - "迈农的亚存在对象" ≈ "degraded/rejected 结构不应该被删除" — 同一个 gap
  - "退役标准的保留与映射" ≈ "degraded/rejected 结构不应该被删除" — 又是同一个 gap

用 8 个不同的哲学概念描述 4 个工程缺口，制造了"有很多启发"的假象。
3. 最关键的反驳：本体论是描述性的，Praxis 需要的是操作性的。知道"存在论差异"这个概念不会让 ProtoStructure 的置信度更新更准确。知道"双重性质理论"不会自动生成功能面的数据——那需要 LLM 去提取，而 LLM 提取的质量上限已经被 V8 的统计验证器证明了不可靠。
4. 替代解释：我之前列出 20+ 个"洞察"可能是因为：(a) 用户提供了两篇高质量的文章 → 期望有高质量的输出，(b) 作为 AI 倾向于"找到对应关系"而不是"说没多大关系"，(c) 哲学概念映射到工程概念可以用力让任何两个系统看起来"深度关联"。

什么证据会推翻方向 A（我之前的结论）？
- 如果在真实场景中运行 100 个 session，现有的 4 种 ProtoStructure 类型中，有 1 种以上从未被 LLM 实际使用（采纳率 < 5%）→ 说明类型系统不是瓶颈
- 如果生产数据显示，置信度更新不准确的主要原因不是"缺少反事实检验"，而是更基础的问题（如 transcript 分析质量差、信号检测误报率高）→ 说明本体论改进的优先级低于基础质量改进
- 如果用户纠正的模式分析显示，80%+ 的纠正可以在现有框架内处理，不需要新的范畴类型 → 说明"范畴盲区"被夸大了

---
第五步：形成结论（在完成以上步骤之后）

推理结果与我的初始直觉不同——我最初列出了 20+ 个"启发"并建议 3+3 个优先事项，但经过反向论证后，我认为：

1. 本体论概念确实为 Praxis 的 Meta Layer 提供了有价值的分析框架——但不是操作指南。
2. 但之前的"启发"列表被过度扩展了——20+ 个洞察中，真正独立的工程缺口大约是 5-6
个（范畴盲区、功能面缺失、版本链缺失、结构依赖图缺失、事前约束缺失、退役 同哲学表述。
3. 从长期演化来看，Praxis 面临的根本张力不是"本体论框架不够完善"，而是更基础的：如何在 LLM 的不可靠性和符号系统的可靠性之间建立正确的分工。

基于这些分析，我现在来构建 Praxis 的长期演化全貌。

---
Praxis 长期演化全貌：从第一性原理重建

〇、不可否认的起点

在规划任何演化之前，先确立不需要论证的基础：

1. LLM 永远是不可靠的概率引擎。Praxis 不能假设 LLM 的判断是正确的。任何依赖 LLM 做唯一判断源的环节，最终都会崩。
2. 上下文编排是 Praxis 唯一的"执行"方式。Praxis 不能执行代码、不能调用工具、不能读写文件（除了通过 AgentMemory）——它只能决定"什么信息在什么时间进入 LLM 的上下文"。
3. AgentMemory 是 Praxis 唯一的持久化通道。数据模型的设计直接决定检索质量和注入效率。
4. 人类的反馈是稀缺且不可靠的。明确的纠正很少发生。隐式信号（用户跳过、重做、沉默）才是主体——但它们噪声极高。
5. 任何结构都可能被未来的观察推翻。认知结构是概率性的，不是真理。系统架构必须内建"自己可能是错的"假设。

---
一、从 5 层"为什么"追问 Praxis 的根本问题

表面问题：Praxis 应该增加哪些能力？

Why 1：为什么需要新能力？→ 因为当前架构存在缺口，学到的结构可能在实践中误导 LLM。

Why 2：为什么会误导 LLM？→ 因为置信度可能虚高（只看观察次数，不看实际表现），结构之间的关系没有被追踪（一个结构被推翻后，依赖它的结构不受影响），LLM 只有在事后才知道预测错了。

Why 3：为什么这些问题存在？→ 因为 Praxis 的认知模型本质上是扁平的概率标签系统——每个 ProtoStructure 是一个独立节点，带有一个置信度数值。没有结构之间的因果图、没有反事实推理、没有事前约束。这是一个"feature list"模型，不是"world model"模型。

Why 4：为什么选了"feature list"而不是"world model"？→ [假设] 因为 V6 的 Proto-Cognitive Engine 从零先验学习出发，自然产物就是独立的 ProtoStructure。然后 V7-V13 的所有迭代都在这个基础上做增量（增加类型、增加信号源、增加调度能力），但没有重新审视底层的数据模型本身——ProtoStructure 作为一个原子化的、独立更新的、无依赖图的知识单元，是否是正确的基础抽象？

Why 5：底层数据模型的选择是被谁决定的？→ [假设] 被 V1 的"工具熟练度"模型决定了思维惯性。V1 的能力模型是 {tool_id → proficiency} 的映射——每个工具独立评分。这个"独立实体+独立评分"的模式一直延续到 V13 的 ProtoStructure。没有人问过"认知结构之间的关系是否应该是一等公民"。

追问出无法再分解的基本事实：Praxis 的底层数据模型从 V1 起就是原子化的（独立实体 + 独立置信度）。没有关系图、没有因果结构、没有约束传播。这是所有后续缺口的共同根因。

---
二、根本张力：Feature List vs World Model

Praxis 当前是一个Feature List 认知系统：

Feature List 模型（当前 Praxis）:
  ProtoSequence_1: confidence=0.8
  ProtoRole_1:     confidence=0.6
  ProtoConcept_1:  confidence=0.7
  ProtoSequence_2: confidence=0.5
  ...
  // 没有结构之间的关系
  // 一个结构置信度变化不影响其他结构
  // 没有"如果 A 被推翻，B 也悬了"的传播

World Model 模型（Praxis 应该成为的）：

World Model 模型:
  ProtoSequence_1 (门诊流程)
    ├─ depends_on → ProtoRole_1 (门诊医生)
    │                 └─ implies → ProtoConcept_1 (分诊)
    ├─ depends_on → ProtoRole_2 (挂号员)
    └─ constrained_by → ProtoConstraint_1 (挂号在就诊前)

  当 ProtoRole_1 置信度下降 0.3:
    → ProtoSequence_1 置信度也受影响（依赖链传播）
    → ProtoConcept_1 置信度受影响（通过 ProtoRole_1 间接）
    → 传播幅度与依赖强度成正比

这不是类比"就像知识图谱一样"——我是在描述一个功能需求：如果 Praxis 不知道结构之间的关系，它就无法在结构被推翻时判断影响范围。这是逻辑约束，不需要参照任何外部系统。

功能等价替代方案：
- 方案 A：关系图（显式边 + 传播规则）——需要新的数据模型和更新逻辑
- 方案 B：联合置信度（把相关结构打包，统一更新置信度）——更简单但更粗糙
- 方案 C：不做传播，但增加"关联结构列表"字段，在结构被推翻时标记关联结构为"待审查"——最轻量

---
三、Praxis 长期演化的四个阶段

基于以上分析，Praxis 的演化不是"加功能"的线性过程，而是一个数据模型升级 → 约束系统建立 → 自主学习闭环 → 自主范畴演化的阶梯。每个阶段建立在上一阶段的基础上。

---
Phase I: 认知基础设施（数据模型升级）

核心问题：ProtoStructure 的底层数据模型从 V1 起没有本质改变。需要从"原子化概率标签"升级为"结构化概率网络"。

不可跳过此阶段的原因：后续所有能力（约束传播、事前验证、范畴演化）都依赖一个能够表达结构之间关系的数据模型。

I-A: ProtoStructure 关系图（优先级：最高）

是什么：在 ProtoStructure 之间增加显式的关系边，使置信度变化可以沿依赖链传播。

新增关系类型:
  - depends_on:     A 的正确性依赖 B 的正确性
  - contradicts:     A 和 B 不能同时为真
  - specializes:     A 是 B 的子类型
  - precedes:        A 必须在 B 之前发生（时序约束）
  - constrains:      A 对 B 施加约束条件
  - alternative_to:  A 和 B 是实现同一功能的不同方式

传播规则（确定性逻辑，不依赖 LLM）：
- A depends_on B，B 置信度下降 Δ → A 置信度下降 Δ × dependency_strength(A,B)
- A contradicts B，A 置信度上升 Δ → B 置信度下降 Δ × contradiction_strength(A,B)
- A specializes B，B 置信度变化 Δ → A 置信度变化 Δ × specialization_factor

为什么先做这个：这是最底层的改变。一旦有依赖图，置信度传播、反事实检验、退化级联都自然成立。没有它，后续所有"智能"都是空中楼阁。

⚠️ 工程风险：引入依赖图后，置信度更新从 O(n) 变为 O(n+e)（e = 边数）。需要限制传播深度（建议 ≤ 3 跳）防止"远距离弱依赖"造成噪声震荡。

I-B: 双重性质建模（优先级：高）

是什么：将 ProtoStructure 拆分为结构面（发生了什么）和功能面（为什么这么做），增加 teleological mapping。

为什么必须在 I-A 之后：功能和结构的对应关系本身就是一种 depends_on 的变   I-A 的关系图来表达（function_purpose ← constrains ← structural_step）。

I-C: 版本链（优先级：高）

是什么：每个 ProtoStructure 保留完整的时间切片序列，支持 diff/回滚/分支融合。

为什么必须在 I-A 之后：版本之间的"为什么变"（change_rationale）需要引用关系图中的依赖结构。例如："门诊流程 v1.2 → v1.3：因为依赖的 ProtoRole '挂号员' 被用户纠正（置信度 0.7 → 0.3），将其标记为 optional。"

I-D: 反事实检验（优先级：中）

是什么：在结晶化条件中增加"如果移除该结构，预测准确率是否下降"的检验。

为什么必须在 I-A 之后：反事实检验需要知道"这个结构被哪些预测依赖"——这正是关系图中的 depends_on 边的反向查询。

功能等价替代方案：如果在 V8 有统计验证器的预测日志，可以做"leave-one-out"分析——对比使用该结构和未使用该结构的 session 的预测准确率。不完美但可行。

---
Phase II: 约束系统（从检测到预防）

核心问题：当前 Praxis 只能在 LLM 犯错后检测（[PREDICTION_FAILED]），不能阻止 LLM 犯错。

前置条件：Phase I 完成（需要关系图来定义约束，需要功能面来定义"什么行为违反了功能意图"）。

II-A: 上下文约束注入（优先级：高）

是什么：在 session_start 时，将已结晶的 ProtoConstraint 作为 hard constraint 注入 system prompt。

当前注入:
  "你正在处理医院门诊场景。参考以下流程: 挂号→问诊→检查→开药"

升级后注入:
  "你正在处理医院门诊场景。
                                                                                                                                                                           ⛔ CRITICAL CONSTRAINTS (不可违反):
   1. 处方开具必须在诊断完成之后
   2. 患者信息修改必须经患者本人确认

   📋 推荐流程: 挂号→问诊→检查→开药
   [如果上述约束与流程冲突，约束优先]"

为什么这不等同于"在 prompt 中提醒 LLM"：格式是关键。当前 prompt 注入是信息性的（"你可以参考"）。hard constraint 是规范性的（"你不能违反"）。LLM 在"不得违反"的框架下的行为与"可以参考"的框架下显著不同——这是 prompt engineering 的实测结果，非推测。

⚠️ 工程风险：hard constraint 格式如果过度使用，LLM 可能变得过于保守（拒绝合理操作以避免违规）。需要 A/B 测试确定约束/建议的最佳比例。

II-B: 工具调用前的约束验证（优先级：中）

是什么：在 before_tool_call hook 中，检查即将执行的操作是否违反已结晶的 ProtoConstraint。如果违反 → block 或 confirm（取决于约束严重度）。

约束: "数据库迁移操作必须在备份之后"
before_tool_call 检测到: tool="database_migrate", 而之前的操作中没有 tool="database_backup"
→ decision: BLOCK
→ explanation: "违反约束: 数据库迁移操作必须在备份之后。请先执行备份。"

II-C: 约束从观察中自动提取（优先级：低，Phase II 后期）

是什么：ProtoConstraint 的创建不依赖用户显式教导。当 V8 的统计验证器检测到"A 步骤在 B 步骤之前执行时，失败率显著更低"→ 自动生成 ProtoConstraint（置信度 0.3-0.5，标记为 auto-derived）。

为什么优先级低：自动提取的约束可靠性需要 Phase I 的依赖图和 Phase II 的约束注入来交叉验证。不宜在基础设施未验证时引入。

---
Phase III: 自主学习闭环（认知结构的自动维护）

核心问题：当前 Praxis 的认知结构维护大部分依赖 session_end 的批量 LLM 分析。这有几个问题：(a) 分析质量依赖 transcript 完整性，(b) 修正延迟一个完整会话，(c) 不会主动寻求澄清。

前置条件：Phase I 完成（需要关系图来判断"哪些结构需要重新评估"），Phase II 部分完成（需要约束系统来判断"LLM 为什么违反了预期"）。

III-A: 注意力遥测驱动的结构审计（优先级：中）

是什么：V9 已定义了 [STRUCTURE_USED: proto_id] 的遥测标记。Phase III 将该数据用于主动审计：
- 高置信度 + 低采纳率 > 3 个 session → 自动标记为"疑似僵尸结构" → 降级 confidence 或提议退化
- 低置信度 + 高采纳率 > 3 个 session → 自动标记为"疑似低估结构" → 提议重新评估

定量的触发阈值（需要生产数据校准）：
僵尸结构:  confidence > 0.7 AND 最近 10 个相关 session 中采纳率 < 20%
低估结构:  confidence < 0.4 AND 最近 10 个相关 session 中采纳率 > 60%

III-B: 跨 session 模式挖掘（优先级：中）

是什么：利用 cron 定期任务，对积累的 task_history 做模式挖掘：
- 同一 task_type 的多个项目 → 自动构造/更新 ProtoTask
- 跨场景的同类用户纠正 → 检测可能的范畴盲区
- 长时间未观察的结构 → 提议退化或归档

为什么是 cron 而不是实时：跨 session 模式挖掘需要 LLM 分析大量历史数据（token 消耗大），不适合在 session_end 的 20s 预算内同步执行。

III-C: 主动澄清请求（优先级：低）

是什么：当"疑似僵尸结构"或"疑似低估结构"积累到阈值时，Praxis 在 session 结束时主动向用户提出一个简洁的问题。

session_end 输出:
  "本次会话中我注意到，'门诊流程 v1.2' 结构（置信度 0.78）在过去 8 个相
   会话中的采纳率为 0%。这可能意味着流程已变更。需要我降低其置信度吗？"

---
Phase IV: 元认知自治（范畴系统的自我演化）[假设]

核心问题：当前 Praxis 的 4 种 ProtoStructure 类型是 V6 定义的，从未被质疑过。如果 Praxis 确实在演化，它最终需要面临一个问题——"我的范畴系统是否足够？"

前置条件：Phase I-III 的充分生产验证。这个阶段建立在大量真实数据的基础上，而非架构推理。

为什么这是最后一个阶段：在没有充足数据的情况下，让 Meta Layer 修改自身的范畴系统等于让一个没有经验的医生给自己做脑部手术。Phase I-III 的积累（版本历史、依赖图、采纳率数据、约束违反日志）提供了"诊断自身"所需的数据基础。

IV-A: 范畴盲区检测（优先级：低，远期）

是什么：Meta Layer 定期分析"被用户反复纠正但始终无法被现有 4 种 ProtoStructure 类型捕获的模式"——如果某个模式在被纠正 5+ 次后仍未形成任何 ProtoStructure → 可能意味着现有范畴无法表达它。

IV-B: 新范畴提议（优先级：低，远期）

是什么：当范畴盲区检测触发 → Meta Layer 提议一个新范畴类型（如 ProtoConstraint/ProtoQuantity/ProtoRelation），附带支持证据 → 等待人类审批。

IV-C: 范畴合并/废弃（优先级：低，远期）

是什么：如果某种 ProtoStructure 类型的使用率长期趋近于 0 → Meta Layer 提议合并到其他类型或废弃。

---
四、演化路线图总览

Phase I: 认知基础设施 (数据模型升级)
├─ I-A: ProtoStructure 关系图         [P0] ← 所有后续能力的前置条件
├─ I-B: 双重性质建模                  [P1] ← 依赖 I-A
├─ I-C: 版本链                       [P1] ← 依赖 I-A
└─ I-D: 反事实检验                    [P2] ← 依赖 I-A

Phase II: 约束系统 (从检测到预防)
├─ II-A: 上下文约束注入                [P0] ← 不依赖 Phase I 完成，但效果依赖关系图
├─ II-B: before_tool_call 约束验证    [P1] ← 依赖 II-A 的约束格式定义
└─ II-C: 约束自动提取                  [P2] ← 依赖 I-A + II-A/B

Phase III: 自主学习闭环
├─ III-A: 注意力遥测驱动的结构审计     [P1] ← 依赖 V9 的遥测基础设施(已
├─ III-B: 跨 session 模式挖掘          [P1] ← 依赖 I-A 的关系图
└─ III-C: 主动澄清请求                [P2] ← 依赖 III-A 的数据积累

Phase IV: 元认知自治 [假设]
├─ IV-A: 范畴盲区检测                  [P3] ← 依赖 I-III 的生产数据
├─ IV-B: 新范畴提议                    [P3]
└─ IV-C: 范畴合并/废弃                 [P3]

---
五、每条结论的可验证预测

1. 如果 I-A（关系图）是正确的优先事项：在生产环境中运行后，当一个高置信度结构被用户推翻时，依赖它的结构应该表现出预测准确率下降（因为它们的置信度没有同步下调）→ 引入依赖传播后，关联结构的预测准确率应该更快恢复。
2. 如果 I-B（双重性质建模）有价值：在用户纠正步骤序列的场景中，应该观察到~30%+ 的纠正实际上是"结构变了但功能不变"（替代实现）→ 双重性质建模能将这类纠正的置信度调整幅度降低 50%，减少不必要的"重新学习"。
3. 如果 II-A（上下文约束注入）有效：hard constraint 注入后，违反已结晶约束的 LLM 行为应该减少 70%+。如果减少 < 30% → constraining prompt 格式无效，需要更强的约束机制。
4. 如果 III-A（僵尸结构检测）有意义：生产数据中应该存在置信度 > 0.7 但采纳率 < 20% 的结构（它们被观察了很多次但 LLM 从不使用）→ 这些结构确实应该在数据模型中存在但不注入，节省上下文预算。
5. 如果 IV（范畴演化）是必要的：在 I-III 完成后，应该观察到至少一种模式被反复纠正（5+ 次）但无法被现有 4 种 ProtoStructure 类型表达 → 否则说明 4 种类型在当前领域已经足够，范畴演化可以无限期推迟。

---
六、与前面"最值得立刻做的三件事"的差异

推理结果与我的初始直觉不同。前面两轮分析中我提出了 6 个"最值得立刻做的"事项（3+3），但经过第一性原理重建后，我认为：

- 之前建议中仍然成立的：增加 ProtoConstraint（现在被纳入 Phase II-A/B）、实现 ProtoStructureVersionChain（现在被纳入 Phase I-C）、OntologicalConstraintLayer（现在被纳入 Phase II-A）。
- 之前建议中优先级被下调的：StructureDependencyGraph 被重新定义为 Phase I-A（最根本的前置条件，而非"三件事之一"），因为它是一切后续能力的基础。反事实检验被从"立刻做"降为 Phase I-D（依赖 I-A 先完成）。
- 之前建议中被重新审视的：ProtoConstraint 作为"第 5 种类型"是在现有框架的关系图暗示了一个更根本的改变——不是加一个新类型，而是让所有类型之间的关系成为一等公民。在这个新框架下，约束（constraint）自然诞生于结构之间的关系，而不是一种独立的新类型。
- 真正的"三件事"：如果只看 Phase I 中最高优先级的三个子任务：I-A（关系图-B（双重性质建模）。这三个的排序是基于"关系图是底层数据模型变更 →必须先做，约束注入不依赖关系图 → 可以并行，双重性质建模依赖关系图 → 在 I-A 之后"。

---
七、输出前自检（3 秒清单）

- [x] 结论是在推理完成后才形成的，而非推理前就确定了？— 是。最终结论（四 初两轮的"6 个立即行动"有显著差异。
- [x] 我认真构建了反面论证，而非只是象征性提了一句？— 是。方向 B（"本体论概念对 Praxis 价值有限"）被认真构建了 4 条具体论据。
- [x] 推理中最薄弱的假设已被标注？— 是。最主要的假设是"为什么选 feature list 而不是 world model"（Why 4→Why 5），以及 Phase IV 整体标注为 [假设]。
- [x] 我没有在迎合问题中隐含的"期望答案"？—用户提示"不要仅局限于最值得立刻做的三件事"可能暗示期望一个更大的演化蓝图。但我的分析独立于这个期望——演化蓝图是从追问"根本问题是什么"推导出来的，不是从"用户想看到什么"开始的。

---
STATUS: DONE
REASON: 完成了从第一性原理出发的 Praxis 长期演化分析，包含四阶段路线图、可验证预测、反向论证
置信度: 中等（0.65）——Phase I 的优先级基于架构推理而非生产数据。生产数据