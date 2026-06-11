# Why Praxis V12?

> 从第一性原理出发，分析为什么 V11 的四个结构化接口是"在错误边界上建造的桥梁"，为什么 Praxis 应该直接接管 planning-with-files 的认知职能。

---

## 一、不可否认的工程基础

```
事实 1: planning-with-files 不是一个架构组件。
        它是一个 SKILL — 一个 SKILL.md 文件包含 prompt 指令模板 +
        几个 Bash/PowerShell hook 脚本 + 三个 markdown 文件模板。
        它没有任何自己的推理、学习或决策能力。
        它的所有"智能行为"来自 LLM 阅读 SKILL.md 后遵循指令。

事实 2: Praxis 的 ProtoTask 是天然的任务分解引擎。
        ProtoTask 包含 typical_phases（阶段划分）、common_pitfalls（陷阱）、
        key_scenarios（关键场景）、relevant_structure_ids（相关认知结构）。
        这些都是从真实项目历史中学习的任务分解知识。

事实 3: V11 的四个结构化接口中，有三个是为了跨越一个本不必要存在的边界。
        KnowledgeQuery 让 planning-with-files "查询" Praxis 的 ProtoTask。
        GuidanceSignal 让 Praxis 向 OpenClaw "发送" 认知指导。
        OutcomeFeedback 让 OpenClaw 向 Praxis "反馈" 任务结果。
        如果 Praxis 自己做任务分解，这三个"接口"都是内部函数调用。

事实 4: planning-with-files 的任务分解质量完全依赖 LLM 的通用知识。
        做了 10 次同类项目后，planning-with-files 仍然从零开始生成计划——
        因为它是无状态的 prompt 模板，不学习。

事实 5: OpenClaw 的 plugin API 完全支持 Praxis 作为"主动"引擎运行。
        scheduleSessionTurn() 定时触发 session、subagent.run() 程序化
        spawn 子 Agent、requestHeartbeat() 主动唤醒、registerService()
        常驻后台——所有机制都已就绪。
```

---

## 二、为什么 V11 的边界是画错了的

### 2.1 分类错误：把 prompt 模板当作架构组件

V11 的架构图展示了一个整齐的对称结构：

```
Praxis (知)  ←──四个结构化接口──→  planning-with-files / OpenClaw (行)
```

这个对称性是美学驱动的，不是工程驱动的。planning-with-files 不是一个"执行系统"——它不执行任何东西。它是一个 SKILL.md 文件，里面写着：

> "Create a task_plan.md with phases and checkboxes. Track progress. Log errors."

这不是一个引擎。这是一段 prompt。真正的认知工作（"这个任务应该分解为哪些阶段？每个阶段有什么风险？"）是 LLM 读了这段 prompt 后做的。

如果把 planning-with-files 的 SKILL.md 内容直接嵌入 Praxis 的 prompt 模板中——功能上没有任何区别。但架构图会变得"不对称"，因为少了一个"层"。

**V11 的边界是为了架构图的对称性而画的，不是为了工程必要性。**

### 2.2 接口膨胀：三个接口是为错误边界建造的桥梁

```
V11 的四个接口:

接口 1 (KnowledgeQuery):
  planning-with-files → 查询 → Praxis → 返回 ProtoTask
  问题: 为什么 planning-with-files 需要"查询" Praxis？
        因为 planning-with-files 负责"任务分解"，但它没有知识。
        所以它必须向有知识的一方（Praxis）查询。
        如果让有知识的一方直接做任务分解，这个查询就不需要了。

接口 2 (GuidanceSignal):
  Praxis → 生成信号 → OpenClaw → 解析信号 → 调整调度
  问题: 为什么 Praxis 不直接把指导信息嵌入它生成的计划中？
        因为 Praxis 不生成计划——planning-with-files 生成。
        所以 Praxis 只能"发送信号"给执行层。
        如果 Praxis 自己生成计划，指导信息就是计划的一部分。

接口 3 (OutcomeFeedback):
  OpenClaw → 发送结果 → Praxis → 调整置信度
  问题: 如果 Praxis 自己在编排子任务，它天然就知道子任务的结果。
        不需要外部"发送"——结果在内部循环中直接可用。

接口 4 (MidSessionLearner):
  保留 — LLM 交互在 Praxis 外部，监控它确实需要跨越边界。
```

**三个接口是为了绕过 V11 自己画的那条线。拆除那条线，接口就消失了。**

### 2.3 知识错配：有知识的不做，没知识的在做

V11 的职责分配：

| 职能 | 谁在做 | 它有什么知识 |
|------|--------|------------|
| 任务分解 | planning-with-files | 空模板（"创建 task_plan.md，列出 phases"） |
| 陷阱预警 | Praxis → GuidanceSignal | ProtoTask.common_pitfalls（从历史学习） |
| 阶段规划 | planning-with-files + LLM | 通用知识（每次从零开始） |
| 进度跟踪 | planning-with-files | 文件中的 checkbox 状态 |
| 结果学习 | Praxis ← OutcomeFeedback | 置信度调整算法 |

有历史知识的一方（Praxis）在做"辅助"——提供素材、发送信号、接收反馈。
没有历史知识的一方（planning-with-files）在做"核心"——任务分解、计划生成、进度跟踪。

这是知识错配。

---

## 三、V12 修正了什么

### 3.1 正确的职责分配

| 职能 | V11 归属 | V12 归属 | 原因 |
|------|---------|---------|------|
| 任务类型识别 | Praxis | Praxis | 已有 TaskContext |
| 任务分解 | planning-with-files | **Praxis (plan-generator)** | ProtoTask 是天然分解引擎 |
| 计划生成 | planning-with-files | **Praxis (plan-generator)** | 从历史学习 > 从零生成 |
| 陷阱预警 | Praxis (GuidanceSignal) | **Praxis (嵌入计划)** | 计划本身包含陷阱信息 |
| 子任务编排 | OpenClaw | **Praxis (task-orchestrator)** | 嵌套 while() 循环 |
| 验收检查 | 无系统化机制 | **Praxis (verifier)** | 5 种验收标准 |
| 陷阱监控 | 无 | **Praxis (pitfall-tracker)** | 主动匹配 + 反馈学习 |
| 进度跟踪 | planning-with-files | **Praxis (progress-tracker)** | 状态机驱动 |
| 文件持久化 | planning-with-files | planning-with-files（降格） | 仍然需要文件 |
| 结果学习 | Praxis (OutcomeFeedback) | **Praxis (内部闭环)** | 不需要外部反馈 |
| LLM 交互监控 | Praxis (MidSessionLearner) | Praxis (MidSessionLearner) | 保留——LLM 在外部 |
| 工具执行 | OpenClaw | OpenClaw | 不变 |

### 3.2 简化度量

```
V11: 32 个模块，4 个外部接口，3 个对等架构组件
V12: 29 个模块，1 个外部接口，2 个架构组件（Praxis + OpenClaw）

+6 新模块（task-orchestrator, plan-generator, verifier, 
         progress-tracker, plan-file-writer, pitfall-tracker）
-3 移除模块（knowledge-query, cognitive-guidance, outcome-feedback）
+2 net 模块，但功能显著增强（+任务分解 +验收 +陷阱监控）
```

---

## 四、两个嵌套 while() 循环的独立论证

### 外层循环 — 必要性论证

**如果没有**：任务状态是扁平的——TaskContext 只知道"当前在做什么任务"，不知道任务的结构（几个阶段、哪些子任务、依赖关系）。任务跨 session 时，Praxis 无法判断"上次做到哪了，接下来该做什么"。

**有了之后**：TaskOrchestrationState 维护完整的任务结构。session_start 时恢复状态，session_end 时验收并推进。跨 session 的任务连续性是确定的，不是靠 LLM "回忆"。

### 内层循环 — 必要性论证

**如果没有**：子任务执行是黑盒。Praxis 注入了上下文后就"旁观"——不知道子任务在进行中还是已完成，不知道用户是否纠正了错误，不知道工具调用是否偏离了子任务范围。

**有了之后**：内层循环在 message_received / before_tool_call / after_tool_call 中监控执行。检测完成信号（"这个接口写好了"），检测用户纠正（"不对，应该是..."），守卫工具范围（"你在做 API 开发，为什么要改数据库 schema？"）。子任务的状态是结构化的，不是靠猜测。

### "主动"能力 — 两个循环的 V13 升级

**V12**：外层循环由 session_start / session_end Hook 驱动。用户每次开始新会话 → Praxis 推进任务状态。这是"被动推进"——但状态机本身是完整的。

**V13**：外层循环可以由 `scheduleSessionTurn()` 主动触发。Praxis 在 session_end 时计算"下一个子任务需要启动"，设置定时触发。不需要等用户手动开始下一个 session。

内层循环也可以升级——`subagent.run()` 让 Praxis 对独立的子任务 spawn 子 Agent 并行执行，而不是在当前 session 中串行。

---

## 五、反向论证

**反方论点**："planning-with-files 经过了充分验证（benchmark 96.7% pass rate）。Praxis 接管后引入的复杂度（6 个新模块、状态机、验收标准）可能降低可靠性。V11 的四个接口方案更保守、更安全——保持 planning-with-files 不变，只增强接口。"

**回应**：

1. planning-with-files 的 96.7% benchmark 是在**没有 Praxis 知识加持**的情况下测的。Praxis 接管后，计划生成质量应该更高（ProtoTask 提供基于历史的阶段划分和陷阱预警），不是更低。

2. "保守 = 安全"在这个场景下不成立。planning-with-files 的无状态性意味着它会在每次新任务中重复同样的错误——因为它不学习。V12 的 ProtoTask 会随着项目积累而成长。保守方案在短期内"更安全"（不改动 planning-with-files），在长期内"更危险"（认知引擎的能力被架构边界锁死）。

3. V12 的净模块增量只有 +2（6 新 - 3 移除 - 1 外部接口消除）。复杂度没有显著增加——只是重新分配了职责。

**什么证据会推翻当前结论？**

- 如果 plan-generator 基于 bootstrap ProtoTask 生成的计划质量显著低于 planning-with-files + LLM 从零生成（在盲评 A/B 测试中，planning-with-files 胜出 > 60%）→ Praxis 不应接管计划生成
- 如果 task-orchestrator 状态机的 bug 率在 50 session 内 > 5%（2.5 次无效状态转换）→ 状态机设计有问题
- 如果 V12 的实际代码量是 V11 的 2 倍以上 → 复杂度声明显著为假
- 如果 pitfall-tracker 的误报率 > 30%（错误地将正常行为标记为陷阱命中）→ 陷阱监控带来负面体验

---

## 六、可证伪预测

1. **架构简化**: V12 模块数（~29）< V11（~32），同时功能增强（+任务分解 +验收 +陷阱监控）。如果 V12 模块数 > 35，简化声明不成立。

2. **ProtoTask 计划质量**: Bootstrap ProtoTask 生成的 PlanDocument 在盲评中 ≥ 80% 优于 planning-with-files 空模板 + LLM 从零生成的计划。比较维度：阶段划分合理性、子任务粒度、风险覆盖。

3. **状态机正确性**: 50 个 session 内，TaskOrchestrationState 零无效状态转换（如 TASK_VERIFYING 但没有 COMPLETING 子任务）。

4. **自动验收率**: ≥ 60% 的 VerificationCriteria 自动完成（command_output / file_existence / test_pass），无需 LLM 评估或用户确认。

5. **陷阱学习收敛**: 同一 task_type 的第 5 次任务的 pitfall 命中数 ≤ 第 1 次的 1/3。即陷阱预警在 5 次任务后显著减少了意外。

6. **V13 迁移成本**: V13 添加 scheduleSessionTurn() 驱动的代码变更 < 200 行，且不需要修改 TaskOrchestrationState 状态机本身。

7. **计划返工减少**: ProtoTask 驱动的计划比 planning-with-files 空模板计划减少 ≥ 40% 的用户纠正事件（"这个阶段不对"、"少了一个子任务"、"这个陷阱没说"）。

---

## 兄弟文件

- [What is Praxis V12?](what-is.md) — V12 的工程定义
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 六个模块的完整实现
- [When does it operate?](when.md) — 6 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V11 基础 + 6 新增 - 3 移除）
- [Architecture Design](design.md) — 技术规格与 API 契约
