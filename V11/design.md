# AgentOS V11 Architecture Design

> 版本：v11 (Closed-Loop Cognitive Engine)
> 状态：设计阶段
> 基于：V10 + 知行合一第一性原理分析 (2026-06-11)

---

## 零、架构哲学：从"开环注入"到"闭环认知"

```
V10: AgentOS 理解任务中的场景（"在构建医院系统 Phase 2 的上下文中，
     哪些认知结构最相关"），但知识只能以 prompt 文本形式注入。

V11: AgentOS 的知识可以结构化地进入执行层（planning-with-files 查询
     ProtoTask、OpenClaw 解析 GuidanceSignal），执行层的结果可以结构化地
     反馈给 AgentOS（SubtaskOutcome 驱动置信度更新）。

关键进化:
  V10 解决了 "AgentOS 知道什么"（任务级认知感知）
  V11 解决了 "知道的东西怎么用"（知行合一闭环）
  
  不做执行 — 但知识不再被锁在 prompt 文本中。
```

---

## 一、V11 新增数据模型

### 1.1 KnowledgeQuery 与 KnowledgeQueryResult

```typescript
// types/scene.ts

interface KnowledgeQuery {
  query_type: 'proto_task' | 'relevant_structures' | 'pitfalls' | 'phase_guidance';
  task_type?: string;
  task_name?: string;
  current_phase?: string;
  scenario_ids?: string[];
  max_results?: number;
}

interface KnowledgeQueryResult {
  query_type: string;
  results: any[];
  result_count: number;
  confidence: number;
  source: 'proto_task' | 'proto_structures' | 'llm_general' | 'none';
  note?: string;
  cached_at?: number;
}
```

### 1.2 GuidanceSignal

```typescript
// types/memory.ts

type GuidanceSignalType =
  | 'phase_suggestion'
  | 'pitfall_warning'
  | 'structure_recommendation'
  | 'contradiction_alert'
  | 'confidence_advisory';

interface GuidanceSignal {
  signal_id: string;
  signal_type: GuidanceSignalType;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  detail?: string;
  source_structures: string[];
  confidence: number;
  suggested_action?: string;
  created_at: number;
}
```

### 1.3 SubtaskOutcome

```typescript
interface SubtaskOutcome {
  subtask_id: string;
  subtask_name: string;
  outcome: 'success' | 'partial_success' | 'failure' | 'abandoned';

  proto_structures_used: string[];
  proto_task_id?: string;
  task_id: string;

  completion_criteria_met: string[];
  completion_criteria_missed: string[];
  user_feedback?: string;
  rework_needed: boolean;

  started_at: number;
  completed_at: number;
  actual_duration_minutes: number;
  estimated_duration_minutes?: number;
}
```

### 1.4 MidSessionContradiction

```typescript
interface MidSessionContradiction {
  type: 'user_correction' | 'tool_mismatch' | 'sequence_violation' | 'role_inconsistency';
  detected_at: number;
  proto_id: string;
  evidence: string;
  severity: 'minor' | 'moderate' | 'critical';
}
```

### 1.5 ProtoTask（V11 增强 — Phase 1 核心）

```typescript
interface ProtoTask {
  task_id: string;
  task_type: string;
  tentative_name: string;
  confidence: number;
  source: 'llm_general' | 'observation' | 'cumulative';  // [新 V11] 来源标记

  typical_phases: {
    name: string;
    typical_duration: string;
    key_scenarios: string[];
    relevant_structure_ids: string[];
    common_challenges: string[];
  }[];

  common_pitfalls: {
    description: string;
    affected_phases: string[];
    mitigation: string;
  }[];

  observations_count: number;
  source_tasks: string[];
  confidence_trend: { after_observation: number; confidence: number; timestamp: number }[];
  created_at: number;
  last_updated_at: number;
}
```

### 1.6 OutcomeFeedbackResult

```typescript
interface OutcomeFeedbackResult {
  confidence_adjustments: {
    proto_id: string;
    old_confidence: number;
    new_confidence: number;
    reason: string;
  }[];
  proto_task_updates?: {
    phase_name?: string;
    duration_correction?: number;
    pitfall_id?: string;
    pitfall_observed: boolean;
    new_challenge?: string;
  };
  processed_at: number;
}
```

---

## 二、AgentMemory 集成规格

### 2.1 新增 Slot

```yaml
# proto_task slot (V11 核心)
# 存储: 当前 task_type 的 ProtoTask 结构
# 大小: < 5KB
# 格式: ProtoTask JSON
memory_slot_get: "proto_task"         # session_start / knowledge_query 读取
memory_slot_set: "proto_task"         # ProtoTask 构造/更新/outcome 反馈时写入
```

### 2.2 新增 / 升格 Memory Type

| Type | 数据结构 | 查询方式 | 保存时机 | V10→V11 变化 |
|------|---------|---------|---------|-------------|
| `task_outcomes` | SubtaskOutcome | `memory_smart_search(subtask_name, task_id)` | 子任务完成 / 用户手动反馈 | **新增** |
| `guidance_signals` | GuidanceSignal | `memory_smart_search(signal_type, session_id)` | session_start | **新增** |
| `proto_task` | ProtoTask | `memory_smart_search(task_type)` | ProtoTask 构造/更新 | **从 memory type 升格为 slot + memory type** |

### 2.3 API 调用频率估算（V11 增量）

```
session_start (新增):
  ├─ memory_slot_get("proto_task")                  [1 次]
  ├─ generateGuidanceSignals()                       [本地计算]
  └─ memory_save("guidance_signals", signals)        [1 次 (批量)]

message_received (新增):
  └─ detectUserCorrection()                          [本地计算 < 10ms]

before_tool_call (新增):
  └─ detectToolPatternViolation()                    [本地计算 < 5ms]

session_end (新增):
  ├─ processSessionOutcomes()                        [0-N 次 confidence 调整]
  └─ memory_slot_set("proto_task", updated)          [0-1 次]

knowledge_query (新端点):
  ├─ memory_slot_get("proto_task")                   [0-1 次]
  ├─ bootstrapProtoTask() (仅首次)                   [0-1 次 LLM 调用]
  └─ memory_slot_set("proto_task") (仅首次)          [0-1 次]

总计增量:
  - 读操作: +1 次 / session
  - 写操作: +1-2 次 / session
  - LLM 调用: +0-1 次 / 新 task_type (bootstrap, ~2K + 1K tokens)
  - 本地计算: +3 次纯规则匹配 / session (< 20ms 总开销)
```

---

## 三、GovernancePolicy 新增配置

```typescript
interface GovernancePolicy {
  // ... (V7 + V8 + V9 + V10 所有字段保持不变)

  // V11 新增
  cognitiveGuidance: {
    enabled: boolean;                            // 默认 true
    maxSignalsPerInjection: number;              // 默认 5
    minConfidenceForWarning: number;             // 默认 0.5
    minConfidenceForSuggestion: number;          // 默认 0.3
    injectInCriticalMode: boolean;               // 默认 true
  };

  outcomeFeedback: {
    enabled: boolean;                            // 默认 true
    successBoost: number;                        // 默认 0.05
    failurePenalty: number;                      // 默认 0.05
    partialSuccessBoost: number;                 // 默认 0.02
    abandonedPenalty: number;                    // 默认 0.03
    pitfallMatchBoost: number;                   // 默认 0.1
    durationAccuracyBoost: number;               // 默认 0.03
    minOutcomesForAdjustment: number;            // 默认 1
  };

  midSessionLearning: {
    enabled: boolean;                            // 默认 true
    contradictionThreshold: number;              // 默认 3
    criticalSeverityImmediatePenalty: number;    // 默认 0.1
    moderateSeverityImmediatePenalty: number;    // 默认 0.08
    maxImmediatePenaltyPerSession: number;       // 默认 0.2
  };

  knowledgeQuery: {
    enabled: boolean;                            // 默认 true
    allowBootstrap: boolean;                     // 默认 true
    bootstrapConfidence: number;                 // 默认 0.2
    maxQueryResults: number;                     // 默认 10
    cacheTtlSeconds: number;                     // 默认 3600
  };

  protoTask: {
    enabled: boolean;                            // 默认 true (V10 默认 false)
    bootstrapOnTaskStart: boolean;               // 默认 true
    minObservationsForUpdate: number;            // 默认 1 (V10 默认 3)
    constructOnCron: string;                     // 默认 "0 6 * * 0" (每周日)
  };
}
```

---

## 四、Layer 1 注入格式（V11）

```
V10 Layer 1:
  # AgentOS 认知状态
  ## 当前任务
  任务: 构建医院管理系统
  阶段: Phase 2 — API 开发
  进度: 数据模型完成, API 60%
  ## 已知场景
  - hospital_outpatient: 门诊流程
  - api_design: REST API 设计模式

V11 Layer 1 (新增认知指导段):
  # AgentOS 认知状态

  ## 当前任务
  任务: 构建医院管理系统
  阶段: Phase 2 — API 开发
  进度: 数据模型完成, API 60% (预约挂号进行中)
  ProtoTask: 医院系统开发模式 (置信度 0.45, 3 次观察)  [V11]

  ## ⚠ 认知指导 [V11]
  [阶段建议] ℹ 当前 Phase: API 开发 (通常 3-4 周)
           关键场景: api_design, rest_patterns, outpatient_flow
           
  [陷阱预警] ⚠ 医保对接模块容易被低估工作量 (置信度 0.65)
           影响阶段: API 开发, 集成测试
           → 完成预约挂号 API 后优先锁定医保接口的外部依赖
           
  [结构推荐] ℹ 推荐关注: api_design (0.75), rest_patterns (0.82), outpatient_flow (0.70)
  [置信度提醒] ℹ ProtoTask 置信度 0.45，阶段建议仅供参考 (基于 3 次观察)

  ## 已知场景
  - hospital_outpatient: 门诊流程 (原型: 3, 固化: 1) [任务相关]
  - api_design: REST API 设计模式 (原型: 2, 固化: 1) [任务相关]
  ## 当前场景: api_design
  ## 架构版本: 2.1.3
```

---

## 五、V7 → V8 → V9 → V10 → V11 完整差异矩阵

| 维度 | V10 | V11 | 增量 |
|------|-----|-----|------|
| 知行关系 | 开环（知→行是软性 prompt） | **闭环（四个结构化接口）** | 知行合一 |
| 知识输出 | 仅 prompt 文本 | **prompt 文本 + GuidanceSignal 元数据** | 类型化信号 |
| 学习时机 | 仅 session_end | **session_end + mid-session 实时** | 会话中学习 |
| 置信度信号源 | 5 源 (统计+角色+概念+LLM+用户) | **7 源 (+outcome +mid_session)** | 结果驱动 |
| ProtoTask | Phase 2+ 可选 | **Phase 1 核心 (含 bootstrap)** | 零样本可用 |
| 对执行层影响 | 软性（LLM 可能忽略） | **结构化（OpenClaw 可解析 GuidanceSignal）** | 可验证的影响 |
| 会话中修正 | 无 | **即时削弱错误结构** | 不等到 session_end |
| 知识查询 | 无 | **4 种查询类型** | 外部可消费 |
| AgentMemory Slots | 7 | **8 (+proto_task)** | 1 个新 slot |
| 代码模块 | ~27 | **~32 (+5)** | 5 个新模块 |
| 新 LLM 调用 | 1 (进度推断) | **2 (+bootstrap)** | 轻量 |
| 实现周期 | +2-3 周 (Phase 1) | **+10 周 (Phase 1+2)** | 显著但非架构重构 |

---

## 六、置信度融合权重（V11 重新校准）

```typescript
// orchestration/confidence-fuser.ts (V11 权重)

const FUSION_WEIGHTS_V11 = {
  statistical:        0.25,  // V9: 0.30 → V11: 0.25 (引入新信号, 相对权重调整)
  role_verifier:      0.12,  // V9: 0.15 → V11: 0.12
  concept_verifier:   0.08,  // V9: 0.10 → V11: 0.08
  llm_marker:         0.25,  // V9: 0.30 → V11: 0.25
  user_correction:    0.12,  // V9: 0.15 → V11: 0.12
  outcome_feedback:   0.10,  // [新 V11] 任务成败信号
  mid_session:        0.08,  // [新 V11] 实时矛盾检测信号
};

// 融合函数不变，但增加两个信号源
function fuseConfidence(
  structure: ProtoStructure | CognitiveStructure,
  signals: ConfidenceSignals  // 现在包含 outcome_feedback 和 mid_session
): number {
  // ... (同 V9 逻辑, 扩展为 7 源加权平均)
}
```

---

## 七、与 OpenClaw / planning-with-files 的接口（V11 增强）

```
架构边界（V11 增强）:

  ┌─────────────────────────────────────────────────────────────┐
  │                     OpenClaw                                  │
  │                                                               │
  │  planning-with-files skill:                                   │
  │    职责: 任务计划的文件持久化                                   │
  │    【新 V11】创建计划前: 查询 AgentOS 知识库                     │
  │      → queryKnowledge({query_type: "proto_task"})             │
  │      → 将 ProtoTask 模板纳入计划骨架                           │
  │      → queryKnowledge({query_type: "pitfalls"})               │
  │      → 将陷阱预警纳入计划的风险部分                              │
  │                                                               │
  │  sub-agent orchestration:                                     │
  │    职责: 子 Agent 的 spawn / monitor / aggregate               │
  │    【新 V11】接收 GuidanceSignal 结构化元数据                    │
  │      → 解析 phase_suggestion → 调整子 Agent 配置               │
  │      → 解析 pitfall_warning → 增加子 Agent 的检查步骤           │
  │    【新 V11】子 Agent 完成时:                                   │
  │      → 发送 SubtaskOutcome → AgentOS                          │
  │                                                               │
  │  context compaction:                                          │
  │    职责: 长会话的自动摘要                                      │
  │    (同 V10)                                                    │
  └─────────────────────────────────────────────────────────────┘
                              │
    ┌─────────────────────────┼─────────────────────────┐
    │                         │                         │
    │  KnowledgeQuery         │  GuidanceSignal         │  SubtaskOutcome
    │  (知→行, 结构化JSON)    │  (知→行, 类型化元数据)   │  (行→知, 结构化反馈)
    │                         │                         │
  ┌─────────────────────────────────────────────────────────────┐
  │                     AgentOS V11                               │
  │                                                               │
  │  api/knowledge-query.ts:                                     │
  │    职责: 响应 planning-with-files 的知识查询                   │
  │    输出: KnowledgeQueryResult (ProtoTask/Pitfalls/Structures) │
  │                                                               │
  │  orchestration/cognitive-guidance.ts:                         │
  │    职责: 生成类型化 GuidanceSignal                             │
  │    输出: prompt 文本 + 结构化元数据 (供 OpenClaw 解析)          │
  │                                                               │
  │  analysis/outcome-feedback.ts:                                │
  │    职责: 处理 SubtaskOutcome → 调整置信度 + 更新 ProtoTask     │
  │    输入: OpenClaw 发送的结构化结果报告                          │
  │                                                               │
  │  analysis/mid-session-learner.ts:                             │
  │    职责: 实时检测认知矛盾 → 即时置信度下调                      │
  │    输入: 用户消息 + 工具调用 + active ProtoStructures           │
  │                                                               │
  │  analysis/proto-task.ts:                                     │
  │    职责: ProtoTask 构造 (bootstrap + 累积) — Phase 1 核心      │
  │    输出: 带置信度的任务模式结构                                 │
  └─────────────────────────────────────────────────────────────┘
```

---

## 八、ProtoTask 置信度成长曲线

```
置信度
1.0 ┤                                    ┌────────────────────
    │                                    │  10+ 观察 → 0.8-0.95
0.8 ┤                              ┌─────┘
    │                              │ 5-7 观察 → 0.65-0.7
0.6 ┤                        ┌─────┘
    │                        │ 3-4 观察 → 0.5-0.55
0.4 ┤                  ┌─────┘
    │                  │ 1-2 观察 → 0.3-0.4
0.2 ┤────────┐         │
    │bootstrap│         │
0.0 ┤─────────┴─────────┴────────────────────────────
    0    1    2    3    4    5    6    7    8    9   10
                        观察次数

关键:
  bootstrap (0 观察): 0.2 — LLM 通用知识，不含团队特定模式
  1-2 观察: 0.3-0.4 — 开始与现实校准
  3-5 观察: 0.5-0.65 — 团队模式开始浮现
  5-10 观察: 0.65-0.8 — 阶段时长和陷阱开始可靠
  10+ 观察: 0.8-0.95 — 高度可靠（但永远不会到 1.0）
```

---

## 九、兄弟文件

- [What is AgentOS V11?](what-is.md) — V11 的工程定义
- [Why AgentOS V11?](why.md) — 第一性原理：为什么需要知行合一闭环
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 四个接口的完整实现
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V10 基础 + 5 新增）
