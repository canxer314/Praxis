# When does Praxis V12 operate?

> V12 的增量比 V11 略小（净 +2 模块 vs +5），但功能变化更大（从"加接口"到"接管任务分解"）。6 Phase，~9 周。

---

## 一、实现路线图总览

```
Phase 0: 基础 (周 1-2)
│  • 数据模型 + AgentMemory slots
│  • task-orchestrator 状态机骨架
│  • Hook 集成（加载/持久化状态）
│  目标: 状态机 transitions 全部通过单元测试
│
├── Phase 1: 计划生成 (周 2-3)
│   • plan-generator: ProtoTask → PlanDocument
│   • 移除 knowledge-query + cognitive-guidance（合并入 plan-generator）
│   • 计划注入格式（prompt 模板）
│   目标: Bootstrap ProtoTask → 可用计划
│
├── Phase 2: 内层循环 (周 3-4)
│   • 内层循环状态管理
│   • mid-session-learner 增强（完成信号检测 + orchestrator 事件订阅）
│   • 工具范围守卫
│   目标: 子任务 PENDING→ACTIVE→COMPLETING→VERIFIED 完整流程
│
├── Phase 3: 验收 + 陷阱 (周 4-6)
│   • verifier: 5 种验收标准类型
│   • pitfall-tracker: 失败匹配 + ProtoTask 反馈
│   • 移除 outcome-feedback（合并入 task-orchestrator）
│   目标: 命令/文件/测试验收自动通过，陷阱命中反馈正常
│
├── Phase 4: 文件持久化 (周 6-7)
│   • plan-file-writer: 兼容 planning-with-files 格式
│   • 集成测试: 完整 session 生命周期
│   目标: task_plan.md/findings.md/progress.md 正常生成
│
├── Phase 5: 完整性 (周 7-8)
│   • 外循环完整推进（阶段转换 + TASK_COMPLETE）
│   • 恢复/重启逻辑
│   目标: 3 阶段任务端到端完成
│
└── Phase 6: V13 预备 (周 8-9)
    • V13 集成点审查 + 文档
    目标: 状态机设计确认无 V13 架构阻塞

总计: ~9 周（Phase 0-5: 8 周 + Phase 6: 1 周）
```

---

## 二、Phase 0: 基础（周 1-2）

**目标**: 数据模型存在，状态机骨架编译通过，Hook 能加载/持久化状态。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| 数据模型定义 | TaskOrchestrationState, SubtaskDefinition, VerificationCriteria, PlanDocument, ProgressEvent, PitfallMatch 类型 + AgentMemory schemas | P0 | 中 |
| AgentMemory slots | 创建 task_orchestration_state, task_plan, progress_log 三个 slot | P0 | 小 |
| task-orchestrator 骨架 | 8 种任务状态 + 5 种子任务状态 + transition() 函数 | P0 | 中 (~80 行) |
| progress-tracker 骨架 | recordEvent() + generateSummary() | P0 | 小 (~40 行) |
| session-start 修改 | 加载 TaskOrchestrationState + 无计划时标记 TASK_ASSESSING | P0 | 小 (~15 行) |
| session-end 修改 | 持久化 TaskOrchestrationState | P0 | 小 (~10 行) |
| 单元测试 | 所有状态机 transitions 的测试 | P0 | 中 |

**验证标准**:
```
✅ TaskOrchestrationState 完整 round-trip 通过 AgentMemory slot
✅ 所有 8 种任务状态 → transition() → 正确的后续状态
✅ 所有 5 种子任务状态 → transition() → 正确的后续状态
✅ 无效 transition 抛出明确错误（如 TASK_COMPLETE → TASK_IN_PROGRESS）
✅ session_start 正确加载已有状态
✅ session_end 正确持久化修改后的状态
```

---

## 三、Phase 1: 计划生成（周 2-3）

**目标**: ProtoTask 驱动计划生成，计划可注入 LLM 上下文。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **plan-generator.ts** | `getProtoTaskTemplate()` + `generatePlan()` + `generatePhaseGuidance()` | P0 | 中 (~150 行) |
| 移除 knowledge-query | 将查询逻辑内部化到 plan-generator | P0 | 小 |
| 移除 cognitive-guidance | 将 GuidanceSignal 生成嵌入 PlanDocument.phases | P0 | 小 |
| proto-task.ts 修改 | +bootstrapPlan() — bootstrap ProtoTask 时同时生成初始 PlanDocument | P1 | 中 (~30 行) |
| plan-injection.md | 计划注入 LLM 上下文的 prompt 模板 | P0 | 小 |
| session-start 增强 | 检测 task_type → 调用 plan-generator → 注入计划 | P0 | 中 (~15 行) |
| context-organizer 集成 | PlanPhase.relevant_structures → Tier A 优先级 | P1 | 小 (~10 行) |

**验证标准**:
```
✅ Bootstrap ProtoTask (0 观察) → PlanDocument (≥1 phase, ≥1 subtask, 置信度 0.2)
✅ 累积 ProtoTask (5 观察) → PlanDocument (≥3 phases, ≥3 subtasks/phase, 置信度 ≥0.65)
✅ PlanDocument 渲染为有效的 planning-with-files 兼容 markdown
✅ 计划内容正确注入到 session_start 的 LLM 上下文（在 ## 任务编排状态 段）
✅ getProtoTaskTemplate("software_project") → 正确返回 ProtoTask（原 knowledge-query 功能）
```

---

## 四、Phase 2: 内层循环（周 3-4）

**目标**: 子任务执行被跟踪；用户纠正和完成信号被检测。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| 内层循环状态管理 | task-orchestrator 中的 activateSubtask(), detectCompletion(), flagBlocked() | P0 | 中 (~60 行) |
| mid-session-learner 增强 | +detectSubtaskCompletionSignal() + orchestrator 事件订阅 | P0 | 中 (~50 行) |
| message-received 修改 | 路由用户消息到 orchestrator.innerLoop + 完成信号检测 | P0 | 小 (~15 行) |
| before-tool-call 修改 | 工具范围守卫: 检查 tool.operation ⊆ subtask.allowed_operations | P0 | 小 (~10 行) |
| after-tool-call 修改 | 记录工具结果到 inner_loop 状态 | P1 | 小 (~10 行) |
| inner loop 测试 | 子任务状态 transitions 的完整测试 | P0 | 中 |

**验证标准**:
```
✅ 子任务 PENDING → ACTIVATED (session_start 注入上下文)
✅ 子任务 ACTIVE → COMPLETING (message_received 检测到完成信号)
✅ 用户说"这个接口写好了" → detectSubtaskCompletionSignal() 返回 true
✅ 用户说"不对，应该是 POST 不是 GET" → detectUserCorrection() 触发 (保留 V11 功能)
✅ 工具调用偏离子任务 allowed_operations → 守卫标记 violation
✅ mid-session-learner 检测结果正确传递到 orchestrator 内层循环
```

---

## 五、Phase 3: 验收 + 陷阱（周 4-6）

**目标**: 子任务完成时自动验收；失败时匹配陷阱并反馈学习。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **verifier.ts** | `verifyCompletion()` — 5 种验收标准类型 + 自动运行 | P0 | 中 (~120 行) |
| **pitfall-tracker.ts** | `matchToKnownPitfalls()` + `updateProtoTaskObservations()` + 误报控制 | P0 | 中 (~100 行) |
| 移除 outcome-feedback | 将 `processSubtaskOutcome()` 合并入 task-orchestrator | P0 | 小 |
| confidence-fuser 修改 | +task_outcome 信号源 (macro-level 成败信号, 权重 0.10) | P1 | 小 (~15 行) |
| session-end 增强 | 运行 verifier → pitfall-tracker → 持久化 → 推进外循环 | P0 | 中 (~25 行) |
| verifier 测试 | 每种验收标准类型的测试 | P0 | 中 |
| pitfall-tracker 测试 | 陷阱匹配 + 误报过滤 + ProtoTask 反馈 | P0 | 中 |

**验证标准**:
```
✅ command_output: npm test -- --testPathPattern=X → 输出包含 "PASS" → 验收通过
✅ file_existence: src/api/appointments/index.ts 存在 → 验收通过
✅ test_pass: 测试套件全部通过 → 验收通过
✅ llm: LLM 审查代码质量 → 返回评分 + 建议
✅ user_approval: 暂停等待用户输入 "approved"
✅ 子任务 VERIFIED → active_subtask_id 切换到下一个 PENDING 子任务
✅ 子任务 FAILED → pitfall-tracker 匹配 ProtoTask.pitfalls → 命中反馈
✅ ProtoTask.pitfall.hit_count 正确递增
✅ 同一子任务 2+ 次陷阱匹配才标记 (误报控制)
✅ 误报率 > 30% 的陷阱自动降 severity
```

---

## 六、Phase 4: 文件持久化（周 6-7）

**目标**: plan-file-writer 生成 planning-with-files 兼容的文件。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **plan-file-writer.ts** | `writePlan()` + `writeProgress()` + `appendFindings()` | P0 | 中 (~100 行) |
| session-start 集成 | 计划生成后 → writePlan() → task_plan.md | P0 | 小 (~5 行) |
| session-end 集成 | 验收完成后 → writeProgress() → progress.md | P0 | 小 (~5 行) |
| 兼容性测试 | 生成的 task_plan.md 被 planning-with-files hook 脚本正确读取 | P0 | 中 |
| 集成测试 | 完整 session 生命周期 + 文件输出验证 | P0 | 中 |

**验证标准**:
```
✅ task_plan.md 结构与 planning-with-files 模板兼容
✅ task_plan.md 包含: phases (含 Status 标记), pitfalls 段, 验收标准段
✅ progress.md 包含: 阶段完成百分比, 子任务状态, 错误日志
✅ findings.md 包含: 每个子任务的关键发现
✅ planning-with-files 的 PreToolUse hook 正确读取并注入 task_plan.md 内容
✅ planning-with-files 的 Stop hook 正确检测 plan 完成状态
✅ plan-attest 的 SHA-256 验证正常工作
```

---

## 七、Phase 5: 完整性（周 7-8）

**目标**: 外循环完整周期闭合；所有边界情况处理。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| 外循环完整推进 | 阶段转换检测 + TASK_COMPLETE/TASK_ITERATING 逻辑 | P0 | 中 (~60 行) |
| 恢复/重启逻辑 | session_start 加载中断状态 → 正确恢复 | P0 | 中 (~40 行) |
| 边界情况 | 放弃任务、阶段全部失败、验证无限重试、空计划 | P0 | 中 (~30 行) |
| GovernancePolicy | 所有新增配置段的集成 + 默认值 | P0 | 小 (~20 行) |
| 端到端测试 | 3 阶段任务完整生命周期 | P0 | 中 |
| 用户命令 | /praxis task status/plan/verify/abandon/replan | P1 | 中 (~50 行) |

**验证标准**:
```
✅ 3 阶段任务完成完整外循环: Phase 1 → 2 → 3 → TASK_COMPLETE
✅ Phase 转换: 当前 Phase 所有子任务 VERIFIED → 自动推进到下一 Phase
✅ TASK_ITERATING: verifier 发现 gap → 创建补救子任务 → 回到 TASK_IN_PROGRESS
✅ 中断恢复: 任务在 Phase 2 中断 → session_start 正确恢复到 Phase 2 的子任务
✅ TASK_ABANDONED: /praxis task abandon → 状态正确标记 + 数据保留
✅ 所有 GovernancePolicy 字段被正确读取和遵循
```

---

## 八、Phase 6: V13 预备（周 8-9）

**目标**: V13 主动触发机制的集成点就绪。

| 任务 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| V13 集成点审查 | 确认 advanceOuterLoop() 的 trigger_source 参数设计 | P1 | 小 |
| 子 Agent 点标注 | 代码中标注 TODO V13: 此处可用 subagent.run() 并行化 | P1 | 小 |
| 性能优化 | Hook 开销 < 50ms（orchestrator 操作，不含 LLM 调用） | P1 | 中 |
| 文档 | 开发者指南 + 架构决策记录 (ADR) | P1 | 中 |

**验证标准**:
```
✅ advanceOuterLoop(trigger_source) 接受 "hook:session_start" | "hook:session_end" 
   | "cron:scheduled" | "subagent:completed" | "heartbeat:wake"
✅ 所有独立子任务点标注了 TODO V13
✅ orchestrator 操作在 Hook 中的开销 < 50ms (不含 LLM 调用)
✅ 文档完整: 开发者能在 30 分钟内理解任务分解流程
```

---

## 九、V11 → V12 路线图对比

| 维度 | V11 Phase 1 | V12 全部 | 差异 |
|------|------------|---------|------|
| 交付模块 | 4 个接口 + ProtoTask | **6 个新模块 + 状态机** | 更多模块但更少外部接口 |
| 工作量 | 6 周 | **9 周** | 略多但功能跨度更大 |
| Hook 改动 | 4 个 hook 增强 | **6 个 hook 修改** | +agent_end |
| 新 slot | 1 个 (proto_task) | **3 个** | +orchestration_state, +task_plan |
| 新 LLM 调用 | 2 个 (进度 + bootstrap) | **2 个** (plan generation + bootstrap) | 相同数量 |
| 移除的模块 | 0 | **3 个** | 净简化 |
| 外部接口 | 4 个 (新增) | **1 个** (净 -3) | 架构简化 |
| V13 预备 | 无 | **完整** | 架构前瞻 |

---

## 兄弟文件

- [What is Praxis V12?](what-is.md) — V12 的工程定义
- [Why Praxis V12?](why.md) — 第一性原理：为什么 V11 的边界是错的
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 六个模块的完整实现
- [Where does it sit?](where.md) — 模块树（V11 基础 + 6 新增 - 3 移除）
- [Architecture Design](design.md) — 技术规格与 API 契约
