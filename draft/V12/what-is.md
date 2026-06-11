# What is Praxis V12?

> V12 = 从"被动记忆系统"到"主动认知引擎"。V11 修复了知行闭环，但画错了一条边界。V12 修正了它。

## 一句话定义

**Praxis V12 接管了 planning-with-files 的认知职能（任务分解、计划生成、进度跟踪、完成验证），将其降格为文件持久化工具。两个嵌套 while() 循环——外层管理任务级阶段推进，内层管理子任务级执行验证——构成 Praxis 的任务编排状态机。V11 的四个结构化接口中有三个变为内部函数调用。架构更简单，功能更强。**

---

## V11 → V12 演进

```
V1-V6: 认知概念设计 — Praxis 应该表现出什么行为
V7:     场景级工程落地 — 所有认知操作 = Hook + LLM + AgentMemory
V8:     1M 上下文简化 — 删除 token 妥协，全量注入 + 独立验证
V9:     上下文压力自适应 — 四级压缩 + Lazy Loading + 注意力遥测
V10:    任务级认知感知 — TaskContext (~200 tokens)，知道"在做什么任务"
V11:    知行合一闭环 — 四个结构化接口（KnowledgeQuery, GuidanceSignal,
        OutcomeFeedback, MidSessionLearner）

V12:    从"被动记忆"到"主动认知引擎" — 任务编排状态机
        从 "Praxis 与 planning-with-files 通过四个接口协作"
        到 "Praxis 直接做任务分解，planning-with-files 降格为文件工具"

关键洞察:
  V11 画错了一条架构边界。planning-with-files 不是 Praxis 的"对等层"——
  它是一段 SKILL.md prompt 模板，自己的所有"智能"都来自 LLM 阅读它。
  把一段 prompt 模板和 Praxis（拥有 ProtoTask 学习能力的认知引擎）并列为
  架构中的两个"层"，是一个分类错误。

  Praxis 拥有 ProtoTask——从真实项目历史中学习的任务模式结构，包含
  typical_phases、common_pitfalls、key_scenarios、relevant_structures。
  这是天然的任务分解引擎。却让一个空模板（planning-with-files）来做
  任务分解，让有知识的一方站在旁边"提供素材"——这是架构的自我限制。

  V12 拆除了这个不必要的边界。Praxis 自己生成任务计划（基于 ProtoTask），
  自己跟踪进度，自己验证完成。planning-with-files 仍然存在——
  但它的角色从"任务规划者"降格为"文件持久化工具"（创建/维护
  task_plan.md、findings.md、progress.md，但文件内容由 Praxis 生成）。
```

---

## V12 的六个工程命题

### 命题 1：任务编排状态机 — 两个嵌套 while() 循环

```
外层循环（任务级）:
  while task.state != TASK_COMPLETE:
    assess_progress()
    if no plan: generate_plan_from_ProtoTask()
    identify_next_subtask()
    spawn_or_resume_subtask()

内层循环（子任务级）:
  while subtask.state != SUBTASK_VERIFIED:
    inject_subtask_context()
    monitor_llm_interaction()    # 工具守卫 + 错误检测 + 用户纠正
    detect_completion_signal()
    verify_completion_criteria()

V12: Hook 驱动 — 每个 Hook 调用推进状态机一步
V13: 主动驱动 — scheduleSessionTurn() + subagent.run() + requestHeartbeat()
```

### 命题 2：plan-generator — ProtoTask 驱动的计划生成

```
V11: planning-with-files 创建空模板 → LLM 从零填内容
     → Praxis 站在旁边通过 KnowledgeQuery 提供 ProtoTask（可能不被采纳）

V12: plan-generator 从 ProtoTask 生成 PlanDocument:
     typical_phases → PlanPhase[] (含 subtasks, entry_criteria, exit_criteria)
     common_pitfalls → PlanPitfall[] (含 severity, mitigation, hit_count)
     key_scenarios → relevant_structures (注入到每个 phase 的 LLM 上下文)
     
     不是"建议"LLM 怎么做——而是直接生成计划结构。
     LLM 仍然做具体的代码/内容工作，但计划的骨架来自 Praxis 的学习。
```

### 命题 3：verifier — 五种验收标准

```
V10/V11: 无系统化验收机制。用户手动判断"完成了没有"。

V12: verifier 支持五种验收标准类型:
  command_output  — 运行命令 → 匹配输出（如 npm test -- --testPathPattern=X）
  file_existence  — 检查文件是否存在（如 src/api/appointments/index.ts）
  test_pass       — 运行测试套件
  llm             — LLM 评估（prompt 驱动的代码/文档审查）
  user_approval   — 等待用户手动确认（安全/部署类操作）
  
  预期 ≥60% 的验收标准自动完成，无需 LLM 或用户介入。
```

### 命题 4：pitfall-tracker — 陷阱主动监控 + 反馈学习

```
V10: ProtoTask 存储陷阱，但不主动监控
V11: 陷阱作为 GuidanceSignal 注入 prompt（LLM 可能忽略）

V12: pitfall-tracker 主动监控每个子任务的执行:
  - 子任务失败 → 匹配 ProtoTask.common_pitfalls
  - 匹配命中 → 标记 PITFALL_IDENTIFIED，记录证据
  - 反馈到 ProtoTask: pitfall.hit_count++, pitfall.last_hit_task_id
  - 第 N 次同类任务 → ProtoTask 的陷阱预测更准确
  
  预期: 第 5 次同类任务的 pitfall 命中数 ≤ 第 1 次的 1/3
```

### 命题 5：planning-with-files 降格 — 从规划者到文件工具

```
V11: planning-with-files = "执行层"的一部分，负责任务分解
V12: planning-with-files = 文件持久化工具

保留的功能:
  ✅ 创建 task_plan.md / findings.md / progress.md
  ✅ Hook 脚本（PreToolUse 重读计划、PostToolUse 提醒更新、Stop 检查完成）
  ✅ 文件格式兼容（planning-with-files 的 hook 脚本不需要修改）
  ✅ SHA-256 计划完整性验证（attestation）

变化:
  ❌ 不再提供"空模板让 LLM 填" → Praxis 的 plan-generator 生成内容
  ❌ 不再做"任务分解" → Praxis 的 ProtoTask 驱动分解
  ❌ 不再做"进度跟踪" → Praxis 的 progress-tracker 管理状态
```

### 命题 6：V13 就绪架构

```
V12 的状态机 transitions 与驱动方式完全解耦:

  ┌──────────────────────────────────────┐
  │  TaskOrchestrationState              │
  │  .transition(event) → new state      │  ← 与驱动方式无关
  └──────────┬───────────────────────────┘
             │
     ┌───────┴────────┐
     │                │
  V12 (Hook 驱动)   V13 (主动驱动)
  session_start      scheduleSessionTurn()
  session_end        subagent.run()
  message_received   requestHeartbeat()
  before_tool_call   registerService()
```

---

## V12 Is / Is-not

| Is | Is-not |
|----|--------|
| Praxis 直接分解任务（ProtoTask 驱动） | Praxis 替代 LLM 推理 |
| planning-with-files 降格为文件工具 | 移除 planning-with-files |
| 两个嵌套 while() 循环（Hook 驱动状态机） | 阻塞式 while() 循环 |
| V11 的三个接口内部化（更简单） | 功能降级（更强：+任务分解 +验收 +陷阱） |
| 五种验收标准（command/file/test/llm/user） | 完整 CI/CD 系统 |
| 陷阱主动监控 + 命中反馈到 ProtoTask | 替代人工风险判断 |
| V13 就绪架构（trigger 解耦） | V12 实现 scheduleSessionTurn() |
| MidSessionLearner 保留为外部 Hook | MidSessionLearner 独立运行 |
| 架构比 V11 更简单（29 模块 vs 32） | 功能比 V11 少 |

---

## V11 → V12 模块变化

| 维度 | V11 | V12 | 变化 |
|------|-----|-----|------|
| 架构哲学 | 四个结构化接口连接两层 | **Praxis 直接做任务分解** | 边界修正 |
| planning-with-files 角色 | 执行层（知识消费者） | **文件持久化工具** | 降格 |
| 任务分解 | planning-with-files 查询 ProtoTask | **plan-generator 从 ProtoTask 生成** | 内部化 |
| 外部接口数 | 4（KQ + GS + OF + MSL） | **1（仅 MSL）** | -3 |
| 模块数 | ~32 | **~29** | +6 新, -3 移除 |
| 新 slots | 1 (+proto_task) | **3 (+orchestration_state, +task_plan, +progress_log)** | +2 |
| 验收机制 | 无 | **5 种类型** | 新核心能力 |
| 陷阱处理 | 静态注入 prompt | **主动监控 + 命中反馈** | 从静态到动态 |
| 主动能力 | 无 | **架构就绪（V13 激活）** | V13-ready |

---

## 兄弟文件

- [Why Praxis V12?](why.md) — 第一性原理：为什么 V11 的边界是错的
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 六个模块的完整实现
- [When does it operate?](when.md) — 6 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V11 基础 + 6 新增 - 3 移除）
- [Architecture Design](design.md) — 技术规格与 API 契约
