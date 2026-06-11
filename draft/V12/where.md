# Where does Praxis V12 sit?

> V12 在 V11 基础上的重构：+6 个新模块（任务编排核心），-3 个移除模块（V11 接口内部化），7 个修改模块。新增 `files/` 目录（计划文件持久化）。架构比 V11 更简单——外部接口从 4 减到 1。

---

## 一、完整模块树

```
openclaw/src/plugins/praxis-plugin/
├── index.ts
├── config.ts                              # [修改] +taskOrchestration +verification +pitfallTracking 配置段
│
├── orchestration/                         # [扩展] 任务编排核心层
│   ├── task-orchestrator.ts               # [新 V12] 两个嵌套 while() 循环状态机
│   ├── plan-generator.ts                  # [新 V12] ProtoTask → PlanDocument (接管 cognitive-guidance)
│   ├── verifier.ts                        # [新 V12] 5 种验收标准类型
│   ├── progress-tracker.ts                # [新 V12] Hook 驱动的进度事件管理
│   ├── context-pressure-monitor.ts        # 同 V9
│   ├── scene-recognizer.ts                # 同 V9
│   ├── context-organizer.ts               # 同 V10 (任务感知排序 + V12 计划优先级)
│   ├── task-context.ts                    # [修改] 从 orchestrator state 读取任务上下文
│   ├── confidence-fuser.ts                # [修改] +task_outcome 信号源
│   └── prediction-protocol.ts             # 同 V9
│
├── analysis/                              # 分析与学习层
│   ├── mid-session-learner.ts             # [修改] 增强: 完成信号 + orchestrator 事件订阅
│   ├── proto-task.ts                      # [修改] +pitfall-tracker 反馈集成
│   ├── pitfall-tracker.ts                 # [新 V12] 子任务失败 ↔ ProtoTask 陷阱匹配
│   ├── transcript-analyzer.ts             # [修改] +outcome-weighted 分析
│   ├── statistical-verifier.ts            # 同 V9
│   ├── role-verifier.ts                   # 同 V9
│   ├── concept-verifier.ts                # 同 V9
│   ├── attention-telemetry.ts             # 同 V9
│   ├── consistency-checker.ts             # 同 V9
│   ├── config-adapter.ts                  # 同 V9
│   ├── degradation-checker.ts             # 同 V9
│   ├── structure-lifecycle.ts             # 同 V9
│   └── architecture-auditor.ts            # 同 V9
│
├── files/                                 # [新 V12] 文件持久化层
│   └── plan-file-writer.ts                # [新] 创建/维护 task_plan.md, findings.md, progress.md
│
├── hooks/
│   ├── session-start.ts                  # [修改] 加载 orchestrator state + 调用 plan-generator
│   ├── message-received.ts               # [修改] 路由到 orchestrator 内层循环
│   ├── before-tool-call.ts               # [修改] 工具范围守卫
│   ├── after-tool-call.ts                # 同 V11
│   ├── agent-end.ts                      # [修改] 保存内层循环快照
│   └── session-end.ts                    # [修改] verifier + pitfall-tracker + 持久化 + 外循环推进
│
├── memory/
│   ├── client.ts
│   ├── recall-structure.ts
│   ├── local-cache.ts
│   ├── schemas.ts                        # [修改] +TaskOrchestrationState +PlanDocument +SubtaskDefinition +VerificationCriteria +ProgressEvent +PitfallMatch
│   ├── slots.ts                          # [修改] +task_orchestration_state +task_plan +progress_log slots
│   └── queries.ts                        # [修改] +orchestration 状态查询 +outcome 查询
│
├── prompts/
│   ├── system/
│   │   ├── memory-context.md             # [修改] +任务编排状态注入格式
│   │   ├── plan-injection.md             # [新 V12] 计划内容注入模板
│   │   ├── prediction-markers.md
│   │   └── critical-mode.md
│   ├── analysis/
│   │   ├── extract-and-update.md         # [修改] +outcome-weighted 分析指令
│   │   ├── construct-proto-task.md       # 同 V11 (+bootstrap 模式)
│   │   ├── generate-plan.md              # [新 V12] ProtoTask → PlanDocument 生成 prompt
│   │   ├── verify-progress.md            # [新 V12] 验收检查 prompt
│   │   ├── consistency-scan.md
│   │   └── audit-architecture.md
│   └── user/
│       ├── perception-summary.md
│       └── crystallization-proposal.md
│
├── types/
│   ├── memory.ts                         # [修改] +TaskOrchestrationState +SubtaskDefinition +VerificationCriteria +PlanDocument +PitfallMatch +ProgressEvent；-KnowledgeQuery -KnowledgeQueryResult -GuidanceSignal
│   ├── scene.ts                          # [修改] -KnowledgeQuery -KnowledgeQueryResult (内部化)
│   └── hooks.ts                          # [修改] +OrchestrationContext 传递
│
└── tests/
    ├── task-orchestrator.test.ts          # [新 V12]
    ├── plan-generator.test.ts             # [新 V12]
    ├── verifier.test.ts                   # [新 V12]
    ├── progress-tracker.test.ts           # [新 V12]
    ├── pitfall-tracker.test.ts            # [新 V12]
    ├── plan-file-writer.test.ts           # [新 V12]
    ├── mid-session-learner.test.ts        # [修改]
    └── proto-task.test.ts                # [修改]
```

---

## 二、V11 → V12 模块变化清单

### 新增模块（6 个）

| 模块 | 路径 | 职责 | 替代的 V11 模块 |
|------|------|------|---------------|
| task-orchestrator | `orchestration/task-orchestrator.ts` | 两个嵌套 while() 循环状态机、Hook 事件绑定、子任务生命周期管理 | — (新核心能力) |
| plan-generator | `orchestration/plan-generator.ts` | ProtoTask → PlanDocument 生成、阶段指导嵌入 | cognitive-guidance.ts + knowledge-query.ts 的认知部分 |
| verifier | `orchestration/verifier.ts` | 5 种验收标准类型、自动运行、结果判定 | — (新核心能力) |
| progress-tracker | `orchestration/progress-tracker.ts` | Hook 驱动的进度事件记录、摘要生成 | — (新核心能力) |
| plan-file-writer | `files/plan-file-writer.ts` | 兼容 planning-with-files 格式的文件生成 | — (planning-with-files 的模板生成职能) |
| pitfall-tracker | `analysis/pitfall-tracker.ts` | 子任务失败 ↔ ProtoTask 陷阱匹配 + 反馈学习 | — (新核心能力) |

### 移除模块（3 个）

| 模块 | V11 路径 | 移除原因 | 功能去向 |
|------|---------|---------|---------|
| knowledge-query | `api/knowledge-query.ts` | 不需要"查询自己" | → plan-generator 内部 `getProtoTaskTemplate()` |
| cognitive-guidance | `orchestration/cognitive-guidance.ts` | 指导信息嵌入计划本身 | → plan-generator 的 `generatePhaseGuidance()` |
| outcome-feedback | `analysis/outcome-feedback.ts` | 编排器自己接收结果 | → task-orchestrator 内部 `processSubtaskOutcome()` |

### 修改模块（7 个）

| 模块 | 改动量 | 说明 |
|------|--------|------|
| `hooks/session-start.ts` | ~30 行 | 加载 TaskOrchestrationState → 调用 plan-generator → 注入计划上下文 |
| `hooks/session-end.ts` | ~40 行 | 运行 verifier → pitfall-tracker → processSubtaskOutcome → 持久化 → 推进外循环 |
| `hooks/message-received.ts` | ~25 行 | 路由到 orchestrator.innerLoop.onMessageReceived() |
| `hooks/before-tool-call.ts` | ~15 行 | 工具范围守卫: tool.scope ⊆ subtask.allowed_operations |
| `hooks/agent-end.ts` | ~10 行 | 保存内层循环快照 (inner_loop snapshot) |
| `analysis/mid-session-learner.ts` | ~50 行 | +detectSubtaskCompletionSignal() + orchestrator 事件订阅 |
| `analysis/proto-task.ts` | ~30 行 | +pitfall 命中反馈: updatePitfallObservation() |
| `orchestration/confidence-fuser.ts` | ~15 行 | +task_outcome 信号源 (macro-level 成败信号) |
| `orchestration/task-context.ts` | ~15 行 | 从 TaskOrchestrationState 读取而非独立 slot |
| `types/memory.ts` | ~100 行 | +6 个新数据模型, -3 个 V11 模型 |
| `memory/schemas.ts` | ~40 行 | +3 个新 slot schemas + 5 个新 memory types |
| `memory/slots.ts` | ~20 行 | +task_orchestration_state +task_plan +progress_log |

---

## 三、新增 AgentMemory Slots / Types

### Slots

```
# task_orchestration_state slot (V12 核心)
# 存储: TaskOrchestrationState JSON
# 大小: < 10KB
# 索引: 按 task_id
# 读写: session_start 读取，session_end 写入
memory_slot_get: "task_orchestration_state"
memory_slot_set: "task_orchestration_state"

# task_plan slot
# 存储: PlanDocument JSON + 渲染后的 markdown
# 大小: < 20KB
# 读写: plan-generator 写入，session_start/context-organizer 读取
memory_slot_get: "task_plan"
memory_slot_set: "task_plan"

# progress_log slot
# 存储: ProgressEvent[] JSON (滚动窗口, 最近 100 条)
# 大小: < 5KB
# 读写: progress-tracker append，session_start 读取用于摘要
memory_slot_get: "progress_log"
memory_slot_append: "progress_log"
```

### Memory Types

| Type | 数据结构 | 查询方式 | 保存时机 |
|------|---------|---------|---------|
| `subtask_outcome` | SubtaskResult | `memory_smart_search(subtask_name, task_id)` | 子任务 VERIFIED 或 FAILED |
| `plan_snapshot` | PlanDocument (完整) | `memory_smart_search(task_type)` | plan 重新生成或 major update |
| `verification_report` | VerificationResult[] | `memory_smart_search(task_id)` | 每次验证运行 |
| `pitfall_observation` | { pitfall_id, subtask_id, evidence, resolved } | `memory_smart_search(pitfall_id, task_type)` | 每次陷阱命中 |
| `orchestration_event` | ProgressEvent | `memory_timeline(task_id)` | 每次显著状态迁移 |

### V11 memory types 保留

`task_outcomes`（现在由 orchestrator 管理而非外部）、`guidance_signals`（降格为内部遥测数据）、`proto_task`（保留 slot + memory type）

---

## 四、数据流（V12）

```
session_start (V12):
  1. 全量加载结构到内存
  2. 场景识别
  3. 【V12 核心】加载 TaskOrchestrationState:
     └─ memory_slot_get("task_orchestration_state")
     └─ 如不存在 + task_type 有值:
        ├─ plan-generator.generatePlan(protoTask, taskContext)
        ├─ memory_slot_set("task_plan", planDocument)
        └─ memory_slot_set("task_orchestration_state", newState)
     └─ 如存在: 恢复 outer_loop + inner_loop 状态
  4. 上下文压力测量
  5. 自适应注入:
     Layer 1 (任务编排状态):
       + "## 任务编排状态 [Praxis V12]"
       + 当前 Phase / 子任务 / 进度
       + ⚠ 活跃陷阱预警
       + 验收标准
     Layer 2 (结构注入):
       排序权重 = 场景匹配度 × 0.50 + 任务相关性 × 0.35 + 计划优先级 × 0.15

message_received (V12):
  1. mid-session-learner.monitorMessage(message, orchestrator.activeSubtask)
     ├─ detectUserCorrection() → orchestrator.innerLoop.flagCorrection()
     └─ detectSubtaskCompletionSignal() → orchestrator.innerLoop.markCompleting()
  2. (如检测到完成信号) 注入验证提醒到 LLM 上下文

before_tool_call (V12):
  1. orchestrator.innerLoop.guardToolScope(toolCall, activeSubtask.allowed_operations)
     └─ 违反 → 记录 violation + 注入警告到 prompt

after_tool_call (V12):
  1. progress-tracker.recordToolUsage(toolCall, result)
  2. orchestrator.innerLoop.incrementToolCount()

agent_end (V12):
  1. orchestrator.innerLoop.saveSnapshot() → 内存中的 inner_loop 状态快照

session_end (V12):
  1-6. (同 V11: 持久化结构、一致性检查、遥测等)
  7. 【V12 核心】验收 + 陷阱处理:
     ├─ 对所有 COMPLETING 子任务:
     │   └─ verifier.verifyCompletion(subtask, criteria)
     │       ├─ VERIFIED → processSubtaskOutcome(subtask, "success")
     │       └─ FAILED  → processSubtaskOutcome(subtask, "failure")
     │                    → pitfall-tracker.matchToKnownPitfalls(failure)
     │                    → proto-task.updatePitfallObservations(matches)
     ├─ progress-tracker.generateSummary() → memory_slot_append("progress_log")
     ├─ plan-file-writer.writeProgress(summary) → progress.md
     └─ orchestrator.advanceOuterLoop()
         ├─ 所有子任务 VERIFIED + 更多 phases → 推进到下一 phase
         ├─ 所有子任务 VERIFIED + 最后 phase → TASK_COMPLETE
         ├─ 有 FAILED 子任务 + gap → TASK_ITERATING (生成补救子任务)
         └─ memory_slot_set("task_orchestration_state", updatedState)
  8. TaskContext 自动更新 (同 V10)

子 Agent session_start (V12):
  子 Agent session_start hook:
    → 父 Agent 的 TaskOrchestrationState + 当前子任务定义
    → 注入子 Agent 的系统提示 (子任务 scope + 验收标准 + 陷阱预警)
    → 子 Agent 的 tool calls 受 mid-session-learner 监控
    → 子 Agent session_end → SubtaskOutcome → 父 Agent 的 orchestrator 处理
```

---

## 五、与 OpenClaw plugin API 的集成点（V13 预备）

```
V12 的 TaskOrchestrationState 与 OpenClaw plugin API 的解耦设计:

  advanceOuterLoop(triggerSource: TriggerSource, ctx: HookContext)
    ├── "hook:session_start"     ← V12: session_start hook 调用
    ├── "hook:session_end"       ← V12: session_end hook 调用
    ├── "cron:scheduled"         ← V13: scheduleSessionTurn() cron 触发
    ├── "subagent:completed"     ← V13: subagent_ended hook 调用
    └── "heartbeat:wake"         ← V13: requestHeartbeat() 唤醒

  activateSubtask(subtask, activationMode: ActivationMode)
    ├── "inline"                 ← V12: 当前 session 中内联执行
    └── "subagent"              ← V13: subagent.run() spawn 独立子 Agent
```

---

## 兄弟文件

- [What is Praxis V12?](what-is.md) — V12 的工程定义
- [Why Praxis V12?](why.md) — 第一性原理：为什么 V11 的边界是错的
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 六个模块的完整实现
- [When does it operate?](when.md) — 6 Phase 实现路线图
- [Architecture Design](design.md) — 技术规格与 API 契约
