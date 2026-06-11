# Praxis V12 Architecture Design

> 版本：v12 (Active Cognitive Engine)
> 状态：设计阶段
> 基于：V11 + 第一性原理架构边界修正 (2026-06-11)

---

## 零、架构哲学：从"边界修正"到"认知引擎"

```
V11: Praxis 的知识通过四个结构化接口进入执行层
     → 问题: 其中三个接口存在是因为画错了 Praxis 和 planning-with-files 的边界

V12: 拆除不必要的边界，Praxis 直接做任务分解和编排
     → planning-with-files 降格为文件持久化工具
     → 三个外部接口变为内部函数调用
     → 架构更简单，功能更强

关键进化:
  V11 解决了 "知行之间怎么通信"（建立接口）
  V12 解决了 "知行本来就在同一个系统里"（拆除边界）
  
  Praxis 不做执行 — 但它现在管理任务的结构。
  就像项目经理管理任务结构（阶段、子任务、验收标准），
  工程师做具体的执行工作（写代码、运行测试）。
```

---

## 一、V12 核心数据模型

### 1.1 TaskOrchestrationState（任务编排状态）

```typescript
// types/memory.ts

type TaskState =
  | 'TASK_NOT_STARTED'
  | 'TASK_ASSESSING'
  | 'TASK_PLAN_GENERATING'
  | 'TASK_IN_PROGRESS'
  | 'TASK_VERIFYING'
  | 'TASK_ITERATING'
  | 'TASK_COMPLETE'
  | 'TASK_ABANDONED';

type SubtaskState =
  | 'SUBTASK_PENDING'
  | 'SUBTASK_ACTIVE'
  | 'SUBTASK_BLOCKED'
  | 'SUBTASK_COMPLETING'
  | 'SUBTASK_VERIFIED'
  | 'SUBTASK_FAILED';

interface TaskOrchestrationState {
  // Identity
  orchestrator_id: string;              // "orch_" + uuid
  task_id: string;
  created_at: number;
  last_updated_at: number;
  active_session_id: string | null;

  // State machine
  task_state: TaskState;
  current_phase_index: number;
  task_type: string | null;

  // Plan
  plan: PlanDocument | null;
  current_plan_version: number;

  // Subtasks
  subtasks: SubtaskDefinition[];
  active_subtask_id: string | null;
  completed_count: number;
  failed_count: number;

  // Pitfalls & learning
  active_pitfalls: ActivePitfall[];
  pitfall_hit_count: number;
  mid_session_adjustments: MidSessionAdjustment[];

  // Inner loop state (persisted across hook invocations)
  inner_loop: {
    current_subtask_started_at: number | null;
    tool_call_count: number;
    user_correction_count: number;
    last_tool_call_at: number | null;
  };

  // Verification
  verification_results: VerificationResult[];
  outstanding_criteria: string[];

  // File references
  plan_file_path: string;               // "task_plan.md"
  progress_file_path: string;           // "progress.md"
  findings_file_path: string;           // "findings.md"

  // V13 readiness
  trigger_source: 'hook:session_start' | 'hook:session_end' | 'cron:scheduled' | 'subagent:completed' | 'heartbeat:wake';
}
```

### 1.2 SubtaskDefinition（子任务定义）

```typescript
interface SubtaskDefinition {
  subtask_id: string;                   // "sub_" + uuid
  subtask_name: string;
  description: string;

  // From ProtoTask
  phase_name: string;
  phase_index: number;
  proto_task_id: string;

  // Execution context
  state: SubtaskState;
  allowed_operations: string[];         // ["Read", "Write", "Bash", "Grep", ...]
  relevant_structures: string[];        // ProtoStructure IDs
  dependencies: string[];               // subtask_ids

  // Verification
  completion_criteria: VerificationCriteria[];
  output_artifacts: ExpectedArtifact[];

  // Tracking
  assigned_session_id: string | null;
  started_at: number | null;
  completed_at: number | null;
  estimated_duration_minutes: number | null;
  actual_duration_minutes: number | null;

  // Learning
  pitfalls_warned: string[];            // pitfall_ids from ProtoTask
  pitfalls_hit: string[];               // actually encountered
  result: SubtaskResult | null;
}

interface SubtaskResult {
  outcome: 'success' | 'partial_success' | 'failure' | 'abandoned';
  criteria_met: string[];
  criteria_missed: string[];
  user_feedback?: string;
  rework_needed: boolean;
  lessons_learned: string[];
}

interface ExpectedArtifact {
  artifact_type: 'file' | 'directory' | 'test_output' | 'config' | 'other';
  path_pattern: string;
  description: string;
}
```

### 1.3 VerificationCriteria（验收标准）

```typescript
type VerificationType =
  | 'command_output'    // 运行命令 → 匹配输出
  | 'file_existence'    // 检查文件存在
  | 'test_pass'         // 运行测试套件
  | 'llm'               // LLM 评估
  | 'user_approval';    // 等待用户确认

interface VerificationCriteria {
  criterion_id: string;
  description: string;
  type: VerificationType;

  // Automated checks
  check_command?: string;               // "npm test -- --testPathPattern=appointments"
  expected_pattern?: string;

  // LLM-assisted
  llm_check_prompt?: string;

  // Status
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  checked_at: number | null;
  evidence: string;
  verified_by: 'auto_command' | 'file_check' | 'llm' | 'user' | null;
}
```

### 1.4 PlanDocument（计划文档）

```typescript
interface PlanDocument {
  plan_id: string;
  version: number;
  task_name: string;
  task_type: string;

  // Generated from ProtoTask
  source_proto_task_id: string;
  source_proto_task_confidence: number;

  phases: PlanPhase[];
  pitfalls: PlanPitfall[];
  global_criteria: VerificationCriteria[];

  created_at: number;
  updated_at: number;
  generated_by: 'bootstrap' | 'cumulative' | 'hybrid';
}

interface PlanPhase {
  phase_index: number;
  phase_name: string;
  description: string;
  expected_duration: string;
  subtasks: SubtaskDefinition[];
  entry_criteria: string[];
  exit_criteria: string[];
  relevant_structures: string[];
  common_challenges: string[];
  guidance: PhaseGuidance;              // [新 V12] 嵌入式指导 (原 cognitive-guidance)
}

interface PhaseGuidance {
  phase_suggestion: string;             // 当前阶段的行动建议
  structure_recommendations: string[];  // 推荐的 ProtoStructure IDs
  confidence_advisory: string;          // 置信度相关建议
}

interface PlanPitfall {
  pitfall_id: string;
  description: string;
  affected_phases: string[];
  mitigation: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  hit_count: number;
  last_hit_task_id: string | null;
}

// Removal note: V11 的 GuidanceSignal 类型被 PhaseGuidance 和 PlanPitfall 替代。
// 指导信息现在是计划文档的组成部分，而非独立的外部信号。
```

### 1.5 支持类型

```typescript
interface ActivePitfall {
  pitfall_id: string;
  triggered_at: number;
  subtask_id: string;
  evidence: string;
  resolved: boolean;
  mitigation_applied: string;
}

interface MidSessionAdjustment {
  adjusted_at: number;
  proto_structure_id: string;
  old_confidence: number;
  new_confidence: number;
  trigger: 'user_correction' | 'tool_mismatch' | 'sequence_violation';
  evidence: string;
}

interface VerificationResult {
  subtask_id: string;
  criteria_results: { criterion_id: string; status: string; evidence: string }[];
  overall: 'verified' | 'needs_rework' | 'failed';
  remediation: string[];
}

interface ProgressEvent {
  timestamp: number;
  event_type: 'phase_started' | 'phase_completed' | 'subtask_started' | 'subtask_completed'
            | 'subtask_failed' | 'subtask_recovered' | 'pitfall_hit' | 'pitfall_resolved'
            | 'task_complete' | 'task_abandoned' | 'verification_run';
  description: string;
  details: Record<string, unknown>;
}

interface PitfallMatch {
  pitfall_id: string;
  subtask_id: string;
  matched_keywords: string[];
  match_confidence: number;            // 0-1, 匹配置信度
  evidence: string;
  is_false_positive: boolean;
}
```

### 1.6 V11 移除的类型

```typescript
// 以下 V11 类型在 V12 中被移除（功能内部化）:
// - KnowledgeQuery          → 内部参数传递
// - KnowledgeQueryResult    → PlanDocument + getProtoTaskTemplate() 返回值
// - GuidanceSignal          → PhaseGuidance + PlanPitfall (嵌入 PlanDocument)
// - SubtaskOutcome          → SubtaskResult (合并入 SubtaskDefinition)
// - OutcomeFeedbackResult   → 内部 processSubtaskOutcome() 返回值

// 保留的 V11 类型:
// - MidSessionContradiction → 保留 (mid-session-learner 仍为外部 Hook)
```

---

## 二、AgentMemory 集成规格

### 2.1 Slot 定义

```yaml
# task_orchestration_state slot
# 存储: TaskOrchestrationState JSON
# 大小: < 10KB
# 索引: task_id (一个 task 一个 slot 实例)
memory_slot_get: "task_orchestration_state"     # session_start 读取
memory_slot_set: "task_orchestration_state"     # session_end + 状态变更时写入

# task_plan slot
# 存储: PlanDocument JSON + 渲染后的 markdown
# 大小: < 20KB
memory_slot_get: "task_plan"                    # session_start + context-organizer 读取
memory_slot_set: "task_plan"                    # plan-generator 写入

# progress_log slot (V12 新增)
# 存储: ProgressEvent[] JSON (滚动窗口)
# 大小: < 5KB
memory_slot_get: "progress_log"                 # session_start 读取（进度摘要）
memory_slot_append: "progress_log"              # progress-tracker 追加事件

# proto_task slot (V11 保留)
# 存储: ProtoTask 结构
memory_slot_get: "proto_task"
memory_slot_set: "proto_task"
```

### 2.2 API 调用频率估算（V12 增量 vs V11）

```
session_start (对比 V11):
  V11: memory_slot_get("proto_task") ×1 + generateGuidanceSignals()
  V12: memory_slot_get("task_orchestration_state") ×1   [替代 proto_task slot read]
       + memory_slot_get("task_plan") ×1                [新]
       + memory_slot_get("progress_log") ×1             [新]
       + plan-generator.generatePlan()                  [替代 knowledge-query + cognitive-guidance]
       + memory_slot_set("task_plan") ×0-1              [仅首次]
       + memory_slot_set("task_orchestration_state") ×0-1 [仅首次]
  增量: +2 reads, -1 external API call, 功能从"查知识"升级为"生成计划"

message_received (对比 V11):
  V11: detectUserCorrection() → 直接修改 ProtoStructure 置信度
  V12: mid-session-learner.monitorMessage() → orchestrator.innerLoop
       + detectSubtaskCompletionSignal()                 [新]
  增量: 功能从"独立修正"升级为"内层循环事件源"

before_tool_call (对比 V11):
  V11: detectToolPatternViolation() → 累计计数
  V12: orchestrator.innerLoop.guardToolScope()           [增强: 范围守卫]
  增量: 从"模式违反检测"升级为"子任务范围守卫"

session_end (对比 V11):
  V11: processOutcomeFeedback() + outcome-weighted 更新
  V12: verifier.verifyCompletion() ×N                    [新]
       + pitfall-tracker.matchToKnownPitfalls() ×N_failed [新]
       + processSubtaskOutcome() (内部)                   [替代 outcome-feedback]
       + memory_slot_set("task_orchestration_state") ×1
       + memory_slot_append("progress_log") ×1           [新]
       + plan-file-writer.writeProgress()                [新]
  增量: +2 个新操作, -1 个外部模块调用, 功能从"接收反馈"升级为"验收+陷阱+持久化"

总计 V12 增量 (vs V11):
  - 读操作: +2/session (orchestration_state + progress_log)
  - 写操作: +1-2/session (orchestration_state + progress_log)
  - LLM 调用: 同 V11 (plan generation ≈ old bootstrap + guidance generation)
  - 外部模块调用: -3 (knowledge-query, cognitive-guidance, outcome-feedback 移除)
  - 本地计算: +2 纯规则匹配 (工具范围守卫 + 陷阱匹配)
```

---

## 三、状态机规格

### 3.1 外层循环状态转移表

```
当前状态              | 事件                      | 新状态                | 副作用
─────────────────────┼──────────────────────────┼──────────────────────┼──────────────────
TASK_NOT_STARTED     | session_start            | TASK_ASSESSING        | 创建 orchestrator state
TASK_ASSESSING       | plan_exists              | TASK_IN_PROGRESS      | 激活当前子任务
TASK_ASSESSING       | no_plan + task_type      | TASK_PLAN_GENERATING  | 调用 plan-generator
TASK_PLAN_GENERATING | plan_generated           | TASK_IN_PROGRESS      | 激活第一个子任务
TASK_IN_PROGRESS     | session_end + all_done   | TASK_VERIFYING        | 运行 verifier
TASK_VERIFYING       | all_verified + more_phases | TASK_IN_PROGRESS    | 推进到下一 phase
TASK_VERIFYING       | all_verified + last_phase  | TASK_COMPLETE       | 任务完成
TASK_VERIFYING       | gaps_found               | TASK_ITERATING        | 生成补救子任务
TASK_ITERATING       | session_start            | TASK_IN_PROGRESS      | 激活补救子任务
任意                  | abandon_signal           | TASK_ABANDONED        | 保存最终状态
TASK_COMPLETE        | (终态)                    | -                     | -
TASK_ABANDONED       | (终态)                    | -                     | -
```

### 3.2 内层循环状态转移表

```
当前状态            | 事件                          | 新状态              | 副作用
───────────────────┼──────────────────────────────┼────────────────────┼──────────────────
SUBTASK_PENDING     | outer_loop.activateSubtask()  | SUBTASK_ACTIVE      | 注入上下文
SUBTASK_ACTIVE      | completion_signal_detected    | SUBTASK_COMPLETING  | 标记完成中
SUBTASK_ACTIVE      | user_correction (severe)      | SUBTASK_BLOCKED     | 记录矛盾
SUBTASK_ACTIVE      | tool_scope_violation (3+)     | SUBTASK_BLOCKED     | 累计阈值触发
SUBTASK_BLOCKED     | correction_resolved           | SUBTASK_ACTIVE      | 恢复执行
SUBTASK_COMPLETING  | verifier.verify() → pass      | SUBTASK_VERIFIED    | 记录结果, 推进外循环
SUBTASK_COMPLETING  | verifier.verify() → fail      | SUBTASK_FAILED      | 陷阱匹配, 生成补救
SUBTASK_FAILED      | remediation_created           | SUBTASK_ACTIVE      | rework
SUBTASK_VERIFIED    | (终态)                        | -                   | -
```

### 3.3 无效转移处理

```typescript
// 以下转移应抛出错误或被静默忽略:
// TASK_COMPLETE → 任何非终态          (已完成的任务不可重新激活)
// TASK_ABANDONED → 任何非终态         (已放弃的任务不可重新激活)
// SUBTASK_VERIFIED → SUBTASK_ACTIVE   (已验证的子任务不可直接重做, 需创建新子任务)
// 任何状态 → 自身 (无事件)             (空转移)
```

---

## 四、Layer 1 注入格式（V12）

```
V11 Layer 1:
  # Praxis 认知状态
  ## 当前任务
  任务: 构建医院管理系统
  阶段: Phase 2 — API 开发
  ProtoTask: 医院系统开发模式 (置信度 0.45, 3 次观察)
  ## ⚠ 认知指导 [V11]
  [阶段建议] ℹ 当前 Phase: API 开发 (通常 3-4 周)
  [陷阱预警] ⚠ 医保对接模块容易被低估工作量 (置信度 0.65)

V12 Layer 1 (任务编排状态):
  # Praxis 任务编排 [V12]

  ## 任务: 构建医院管理系统
  来源: ProtoTask "医院系统开发" (置信度 0.65, 5 次观察, 累积模式)
  状态: Phase 2/5 — API 开发
  当前子任务: 实现预约挂号 API (第 3/7 步)

  ## 进度
  ✅ 已完成: 2 个子任务 (数据模型设计, 项目脚手架)
  🔄 进行中: 实现预约挂号 API
  📋 待完成: 4 个子任务

  ## ⚠ 活跃陷阱
  - [高] 医保对接模块容易被低估工作量 (历史命中 3/5 次)
    → 缓解: 完成预约挂号 API 后优先锁定医保接口的外部依赖
  - [中] API 文档和实际行为不一致 (历史命中 2/5 次)
    → 缓解: 每个 API 完成后立即验证响应格式

  ## 验收标准 (当前子任务)
  - POST /appointments → 返回 201 + appointment JSON
  - GET /appointments/:id → 返回正确数据
  - 单元测试覆盖率 ≥ 80%
  - 集成测试: 挂号 → 查询 → 取消 全流程

  ## 已知场景
  - hospital_outpatient: 门诊流程 (原型: 3, 固化: 1)
  - api_design: REST API 设计模式 (原型: 2, 固化: 1)

与 V11 的关键区别:
  1. 不再是"Praxis 认知状态" + "认知指导"两个独立段
     → 统一的"任务编排状态"段，包含所有信息
  2. 指导信息（陷阱预警、阶段建议）嵌入在计划和子任务定义中
     → 不是外部"发送的信号"，而是计划的组成部分
  3. 多了"验收标准"段
     → LLM 明确知道"做到什么程度才算完成"
  4. 多了"进度"段
     → LLM 知道"已经做了什么，还需要做什么"
```

---

## 五、V10 → V11 → V12 完整差异矩阵

| 维度 | V10 | V11 | V12 |
|------|-----|-----|-----|
| 架构哲学 | 开环 prompt 注入 | 四个结构化接口 | **Praxis 直接做任务分解** |
| planning-with-files | 任务规划者 | 知识消费者 | **文件持久化工具** |
| 知行关系 | 知↛行 | 知⇄行（通过接口） | **知=行（同一系统内）** |
| 任务分解 | planning-with-files (空模板 + LLM) | planning-with-files (查询 ProtoTask + LLM) | **plan-generator (ProtoTask → PlanDocument)** |
| 知识输出 | prompt 文本 | prompt + GuidanceSignal 元数据 | **PlanDocument（结构化 + markdown）** |
| 外部接口数 | 0 | 4 (KQ, GS, OF, MSL) | **1 (仅 MSL)** |
| 学习时机 | session_end | session_end + mid-session | **session_end + mid-session (增强)** |
| 置信度信号源 | 5 源 | 7 源 (+outcome +mid_session) | **7 源 (+task_outcome macro)** |
| ProtoTask | Phase 2+ 可选 | Phase 1 核心 (bootstrap) | **Phase 1 核心 + pitfall 反馈闭环** |
| 验收机制 | 无 | 无 | **5 种验收标准** |
| 陷阱处理 | ProtoTask 存储 | GuidanceSignal 注入 | **主动监控 + 命中反馈 + 学习收敛** |
| 进度跟踪 | LLM 推断 | LLM 推断 | **状态机驱动 + 事件日志** |
| 会话中修正 | 无 | 即时削弱错误结构 | **即时削弱 + inner_loop 事件** |
| 主动能力 | 无 | 无 | **架构就绪 (V13 trigger 解耦)** |
| 模块数 | ~27 | ~32 (+5) | **~29 (+6, -3, net +2)** |
| 新 LLM 调用 | 1 (进度推断) | 2 (+ProtoTask bootstrap) | **2 (plan generation, bootstrap)** |
| 实现周期 | +2-3 周 | +10 周 | **~9 周** |
| AgentMemory Slots | 7 | 8 (+proto_task) | **10 (+orchestration_state, +task_plan, +progress_log)** |

---

## 六、置信度融合权重（V12 重新校准）

```typescript
// orchestration/confidence-fuser.ts (V12 权重)

const FUSION_WEIGHTS_V12 = {
  statistical:        0.25,  // 同 V11
  role_verifier:      0.12,  // 同 V11
  concept_verifier:   0.08,  // 同 V11
  llm_marker:         0.25,  // 同 V11
  user_correction:    0.12,  // 同 V11
  task_outcome:       0.10,  // [升级 V12] 从 outcome_feedback 重命名, 语义从"外部反馈"变为"内部结果"
  mid_session:        0.08,  // 同 V11
};

// V11 → V12 变化:
// - outcome_feedback → task_outcome (重命名, 语义升级)
// - 权重值不变 (V11 的权重校准仍然合理)
// - task_outcome 现在由 orchestrator 内部提供, 不再来自外部 API
```

---

## 七、架构边界图（V12）

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw (执行宿主)                       │
│                                                               │
│  tool execution: 工具调用执行 (Read, Write, Bash, Grep, ...) │
│  sub-agent spawning: 子 Agent 的 spawn / monitor / aggregate │
│  context compaction: 长会话的自动摘要                         │
│  session management: 会话生命周期                             │
│                                                               │
│  ┌─ V13 预留 ─────────────────────────────────────────┐     │
│  │ scheduleSessionTurn() → 主动触发下一 session         │     │
│  │ subagent.run()        → 程序化 spawn 子 Agent       │     │
│  │ requestHeartbeat()    → 主动唤醒                    │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
                              │
            Hook 事件 (session_start, session_end, 
            message_received, before_tool_call, 
            after_tool_call, agent_end, subagent_ended)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Praxis V12 (认知引擎)                    │
│                                                               │
│  orchestration/task-orchestrator.ts:                         │
│    两个嵌套 while() 循环状态机                                │
│    outer: TASK_NOT_STARTED → ... → TASK_COMPLETE             │
│    inner: SUBTASK_PENDING → ... → SUBTASK_VERIFIED           │
│                                                               │
│  orchestration/plan-generator.ts:                             │
│    ProtoTask → PlanDocument (接管 planning-with-files 认知)  │
│    嵌入 PhaseGuidance (原 cognitive-guidance)                 │
│                                                               │
│  orchestration/verifier.ts:                                   │
│    5 种验收标准: command_output, file_existence,             │
│    test_pass, llm, user_approval                             │
│                                                               │
│  orchestration/progress-tracker.ts:                           │
│    Hook 驱动的进度事件记录 + 摘要生成                         │
│                                                               │
│  analysis/pitfall-tracker.ts:                                 │
│    子任务失败 ↔ ProtoTask 陷阱匹配 → 反馈学习                │
│                                                               │
│  analysis/mid-session-learner.ts:                             │
│    实时矛盾检测 + 完成信号检测 → inner_loop 事件源            │
│    [唯一保留的外部交互 Hook]                                  │
│                                                               │
│  analysis/proto-task.ts:                                      │
│    ProtoTask 构造 (bootstrap + 累积 + pitfall 反馈)           │
│                                                               │
│  files/plan-file-writer.ts:                                   │
│    创建/维护 task_plan.md, findings.md, progress.md           │
│    (兼容 planning-with-files hook 脚本)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                    文件写入 (内容由 Praxis 生成)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│          planning-with-files (降格: 文件持久化工具)          │
│                                                               │
│  保留功能:                                                    │
│  • 创建 task_plan.md / findings.md / progress.md             │
│  • PreToolUse hook: 重读计划（内容由 Praxis 写入）          │
│  • PostToolUse hook: 提醒更新进度                            │
│  • Stop hook: 检查完成状态                                   │
│  • SHA-256 计划完整性验证 (attestation)                      │
│                                                               │
│  移除职能:                                                    │
│  • 任务分解 (→ plan-generator)                               │
│  • 计划模板 (→ ProtoTask 驱动)                               │
│  • 进度跟踪逻辑 (→ progress-tracker)                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、V11 → V12 接口内部化对照

```
V11 外部接口                    V12 内部实现
────────────────────────────────────────────────────
api/knowledge-query.ts         → plan-generator.getProtoTaskTemplate()
  queryKnowledge({              (同进程函数调用, 非 API)
    query_type: "proto_task",   
    task_type: "software"       
  })                            

orchestration/cognitive-       → plan-generator.generatePhaseGuidance()
  guidance.ts                    PhaseGuidance 嵌入 PlanDocument.phases[]
  generateGuidanceSignals()      Planning Pitfalls 嵌入 PlanDocument.pitfalls[]
                                 (计划本身包含指导, 不需要外部信号)

analysis/outcome-feedback.ts   → task-orchestrator.processSubtaskOutcome()
  processOutcomeFeedback()       (编排器内部处理子任务结果)
                                 (置信度调整由 confidence-fuser 直接调用)

analysis/mid-session-          → analysis/mid-session-learner.ts [保留]
  learner.ts                     LLM 交互在 Praxis 外部, Hook 是必要的
  detectUserCorrection()         增强: +detectSubtaskCompletionSignal()
                                 增强: +orchestrator 事件订阅
```

---

## 九、ProtoTask 置信度成长曲线（V12 增强）

```
置信度
1.0 ┤                                    ┌────────────────────
    │                                    │ 10+ 观察 → 0.8-0.95
0.8 ┤                              ┌─────┘ 陷阱预测可靠
    │                              │ 5-7 观察 → 0.65-0.7
0.6 ┤                        ┌─────┘ 阶段时长开始收敛
    │                        │ 3-4 观察 → 0.5-0.55
0.4 ┤                  ┌─────┘ 团队特定模式浮现
    │                  │ 1-2 观察 → 0.3-0.4
0.2 ┤────────┐         │ 开始与现实校准
    │bootstrap│         │
0.0 ┤─────────┴─────────┴────────────────────────────
    0    1    2    3    4    5    6    7    8    9   10
                        观察次数

V12 增强:
  - pitfall hit_count 随观察次数增长而增长 → ProtoTask.置信度加速上升
  - 陷阱预警准确率 (命中数/预警数) 作为额外的置信度信号
  - 阶段时长估计准确率 (实际/预估 偏差 < 20%) 作为额外的置信度信号
```

---

## 十、兄弟文件

- [What is Praxis V12?](what-is.md) — V12 的工程定义
- [Why Praxis V12?](why.md) — 第一性原理：为什么 V11 的边界是错的
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 六个模块的完整实现
- [When does it operate?](when.md) — 6 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V11 基础 + 6 新增 - 3 移除）
