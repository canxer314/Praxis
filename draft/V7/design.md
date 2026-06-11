# Praxis V7 Architecture Design

> 版本：v7 (Engineering Implementation)
> 状态：设计阶段
> 基于：V6 Proto-Cognitive Engine + 第一性原理工程分析 (2026-06-11)

---

## 零、架构哲学：设计概念 ≠ 代码模块

V1-V6 用"六层架构"（L1-L6）划分功能域。这是有效的概念设计。但 V7 的代码不按层组织——它按职责组织：

```
设计概念（V1-V6 的语言）         代码模块（V7 的组织）
─────────────────────────       ────────────────────
L1 Tool & Integration    →      分布在整个 codebase 中
L2 Task Orchestration    →      orchestration/ + prompts/
L3 Knowledge Management  →      memory/ + prompts/
L4 Learning Loop         →      analysis/ + hooks/session-end.ts
L5 Competency Model      →      orchestration/confidence-updater.ts
L6 Autonomy Decision     →      hooks/ + config.ts
Meta Layer (V5)          →      analysis/architecture-auditor.ts
Proto-Cognitive (V6)     →      analysis/proto-constructor.ts + hooks/
```

**推论**：V6 的"修改层定义"（Level 4）在工程上的等价物不是"修改一个叫 L3.ts 的文件"（不存在），而是"修改散布在多个模块中的行为约定"。当这些行为约定是数据驱动的（prompt 模板在 AgentMemory 中、信号检测规则可配置、流程类型是 type field 的 switch），那么"修改层"就自动降级为修改数据——这正是 Level 1-3 已经覆盖的操作。需要改动代码的极端情况才构成真正的架构变更，此时 Praxis 的角色是"提出建议"，人类开发者决定是否实施。

---

## 一、V7 工程数据模型（精简版）

V6 定义了 7 种数据模型。V7 将其合并和精简，只保留工程实现必要的数据结构。

### 1.1 SalientElement（存储格式）

```typescript
// types/memory.ts

interface SalientElement {
  element_id: string;               // "se_a1b2c3d4"
  scenario_id: string;              // "hospital_visit"
  session_id: string;               // 首次观察到的会话
  
  raw_observation: string;          // "穿白衣服的人让奶奶张开嘴"
  element_type: 'entity' | 'action' | 'place' | 'relation' | 'attribute' | 'unknown';
  
  salience_signals: {
    type: 'repetition' | 'user_emphasis' | 'sequence_position' | 'novelty' | 'user_correction';
    detail: string;
    weight: number;                 // 0.0 - 1.0
  }[];
  
  tentative_label: string | null;   // "挂号?"（带? = 未确认）
  label_confidence: number;         // 0.0 - 1.0（标签置信度）
  
  occurrence_timestamps: number[];  // 每次出现的时间戳
  
  // 关联
  cooccurring_elements: string[];   // 频繁共现的其他 element_id
  contradiction_of: string | null;  // 如果这个元素与某个已有结构矛盾
  
  // 元数据
  first_observed_at: number;
  last_observed_at: number;
  observation_count: number;
  source: 'auto_marker' | 'llm_extraction' | 'user_marked';
}
```

### 1.2 ProtoStructure（统一模型）

V6 定义了 ProtoSequence、ProtoRole、ProtoConcept、ProtoPurpose 四种类型。V7 将它们统一为一个 ProtoStructure 模型（通过 `proto_type` 区分）。

```typescript
interface ProtoStructure {
  proto_id: string;                 // "ps_hospital_outpatient_flow"
  scenario_id: string;              // "hospital_visit"
  proto_type: 'sequence' | 'role' | 'concept' | 'purpose';
  
  // 核心数据
  tentative_name: string;           // "门诊标准流程"
  confidence: number;               // 0.0 - 1.0（综合置信度）
  
  // ── 类型特定数据 ──
  
  // proto_type = 'sequence'
  sequence_steps?: {
    position: number;
    element_ref: string;            // SalientElement.element_id
    tentative_label: string;
    confidence: number;            // 这个位置是这个元素的置信度
    alternatives?: string[];        // 此位置的其他可能元素
  }[];
  sequence_variants?: {             // 发现的变体
    variant_name: string;
    differences: string;
    occurrence_count: number;
    confidence: number;
  }[];
  
  // proto_type = 'role'
  role_behaviors?: {
    behavior: string;
    confidence: number;
  }[];
  role_distinctions?: {             // 与类似 ProtoRole 的区别
    other_proto_id: string;
    differences: string[];
    boundary_clarity: number;       // 0.0 - 1.0
  }[];
  role_communication?: {
    formality: string;
    typical_phrases: string[];
  };
  
  // proto_type = 'concept'
  concept_features?: {
    feature: string;
    confidence: number;
  }[];
  concept_categories?: {           // 多个类别假设可共存
    label: string;
    confidence: number;
  }[];
  concept_differentiations?: {
    similar_concept: string;
    difference: string;
    confidence: number;
  }[];
  
  // proto_type = 'purpose'
  purpose_hypothesis?: string;
  purpose_alternatives?: {
    hypothesis: string;
    confidence: number;
  }[];
  
  // ── 共同数据 ──
  
  // 证据
  observations_count: number;
  confirming_observations: number;
  contradicting_observations: number;
  contradictions: string[];          // 反例描述
  
  // 置信度演变
  confidence_trend: {
    after_observation: number;
    confidence: number;
    timestamp: number;
  }[];
  
  // 待验证
  open_questions: {
    question: string;
    priority: number;               // 1-5
    asked_count: number;            // 已经向用户提问的次数
    last_asked_at: number | null;
  }[];
  
  // 元数据
  created_at: number;
  last_updated_at: number;
  last_activated_at: number | null;
  status: 'active' | 'stable' | 'declining' | 'crystallization_proposed' | 'degraded';
  
  // 固化候选（当 status = 'crystallization_proposed'）
  crystallization_candidate?: {
    proposed_at: number;
    target_structure_type: string;  // 映射到 CognitiveStructure 的类型
    user_approved: boolean | null;
    user_feedback: string | null;
  };
}
```

### 1.3 SceneContext（会话级场景状态）

```typescript
// types/scene.ts

interface SceneContext {
  session_key: string;
  scenario_id: string | null;        // 匹配到的场景 ID（null = 未匹配）
  
  match_result: {
    best_match_structure_id: string | null;
    adaptation_score: number;        // 0.0 = 零先验
    match_type: 'exact' | 'fuzzy' | 'weak' | 'zero_prior';
    matched_structures: string[];    // 所有适配度 > 0.1 的结构
  };
  
  active_protos: string[];           // 本场景的活跃 ProtoStructure ID 列表
  cognitive_mode: 'standard' | 'vigilant' | 'open_perception';
  // standard: 确定场景，使用固化结构
  // vigilant: 弱匹配，保持警惕
  // open_perception: 零先验，开放感知
  
  session_buffer: {
    candidate_elements: SalientElement[];  // 会话内累积的候选
    tool_call_sequence: { tool: string; timestamp: number; result_summary: string }[];
    prediction_results: PredictionResult[];
    user_feedback_events: { type: string; detail: string; timestamp: number }[];
    questions_asked: string[];
  };
}
```

### 1.4 PredictionResult

```typescript
interface PredictionResult {
  proto_id: string;
  outcome: 'matched' | 'failed' | 'uncertain' | 'user_correction';
  predicted: string;
  actual: string;
  detail: string;
  correctionApplied?: boolean;
  correctedValue?: string;
  timestamp: number;
}
```

---

## 二、AgentMemory 集成规格

### 2.1 Slot 设计

```yaml
# active_proto_structures slot
# 存储: 所有活跃（非固化）的 ProtoStructure
# 大小: < 100KB
# 格式: JSON 数组
memory_slot_get: "active_proto_structures"
memory_slot_replace: "active_proto_structures"  # 全量替换（每次 session_end）
# 更新频率: session_end 写入, session_start 读取

# structure_registry slot
# 存储: 所有固化的 CognitiveStructure
# 大小: < 500KB
# 格式: JSON 对象 { structure_id: CognitiveStructure }
memory_slot_get: "structure_registry"
memory_slot_replace: "structure_registry"  # 固化/退化时替换
# 更新频率: 固化/退化事件时

# governance_policy slot
# 存储: 治理策略配置
# 大小: < 10KB
# 格式: GovernancePolicy 对象
memory_slot_get: "governance_policy"
# 更新: 运维者手动编辑

# pending_crystallizations slot
# 存储: 待审批的固化提案
# 大小: < 50KB
# 格式: JSON 数组 [CrystallizationProposal]
memory_slot_append: "pending_crystallizations"  # 追加新提案
memory_slot_replace: "pending_crystallizations"  # 审批后清理
# 更新频率: session_end 追加, 用户审批后清理

# architecture_version slot
# 存储: 当前架构版本
# 大小: < 1KB
# 格式: "2.1.3"
memory_slot_get: "architecture_version"
memory_slot_set: "architecture_version"  # 架构变更时
# 更新频率: 架构变更事件时

# pending_questions slot
# 存储: 待向用户提问的问题
# 大小: < 20KB
# 格式: JSON 数组 [{question, priority, proto_id}]
memory_slot_replace: "pending_questions"
# 更新频率: session_end 更新, 提问后移除
```

### 2.2 Memory 类型映射

| AgentMemory type | 数据结构 | 查询方式 | 保存时机 |
|-----------------|---------|---------|---------|
| `salient_element` | SalientElement | `memory_smart_search(scenario_id, type="salient_element")` | session_end 批量 |
| `proto_structure` | ProtoStructure (快照) | `memory_recall(proto_id)` | ProtoStructure 变更时 |
| `cognitive_structure` | CognitiveStructure (版本) | `memory_smart_search(scene_keywords, type="cognitive_structure")` | 固化时 |
| `structure_evolution` | StructureEvolution (演化记录) | `memory_timeline(structure_id)` | 固化/退化时 |
| `architecture_audit` | 审计报告 | `memory_timeline(type="architecture_audit")` | 每月 cron |
| `lesson` | 学习事件 | `memory_lesson_recall(type, time_range)` | 事件发生时 |
| `scene_profile` | 场景摘要 | `memory_smart_search(scenario_id)` | session_end |

### 2.3 AgentMemory API 调用频率估算

```
每个会话的典型 API 调用次数（Phase 2+）:

session_start:
  ├─ memory_slot_get("active_proto_structures")  [1 次]
  ├─ memory_slot_get("structure_registry")       [1 次]
  ├─ memory_slot_get("governance_policy")        [1 次]
  ├─ memory_slot_get("pending_questions")        [1 次]
  └─ memory_recall(scenario_id)                  [0-2 次]

session_end:
  ├─ memory_save(type="salient_element")         [0-10 次, 批量并行]
  ├─ memory_slot_replace("active_proto_structures") [1 次]
  ├─ memory_save(type="proto_structure")         [0-5 次, 批量并行]
  ├─ memory_save(type="lesson")                  [0-5 次, 批量并行]
  └─ memory_slot_append("pending_crystallizations") [0-1 次]

agent_end (可选轻量操作):
  └─ 仅更新内存中的置信度，不写 AgentMemory

总计: 每会话 5-15 次读 + 2-22 次写
```

---

## 三、完整 API 契约

### 3.1 插件配置

```typescript
// config.ts

interface PraxisConfig {
  // ── 核心开关 ──
  enabled: boolean;                          // 默认 true
  proto_cognitive_enabled: boolean;          // 默认 true（Phase 1 设为 false）
  auto_crystallization_enabled: boolean;     // 默认 false（Phase 3 设为 true）
  
  // ── 阈值 ──
  sceneMatchThresholds: {
    exact: number;          // 默认 0.7
    fuzzy: number;          // 默认 0.3
    // < 0.3 = weak, = 0 = zero_prior
  };
  salienceThresholds: {
    min_repetition_count: number;    // 默认 3
    min_emphasis_confidence: number; // 默认 0.4
    min_pmi: number;                 // 默认 1.0
  };
  crystallizationThresholds: {
    min_confidence: number;          // 默认 0.8
    min_observations: number;        // 默认 5
    min_recent_stability: number;    // 默认 3（连续 3 次变化 < 0.05）
  };
  degradationThresholds: {
    max_accuracy_drop: number;       // 默认 0.7（准确率 < 0.7 → 退化）
    max_contradictions: number;      // 默认 3
  };
  
  // ── 频率限制 ──
  questionLimits: {
    max_per_session: number;         // 默认 2
    min_interval_minutes: number;    // 默认 30（同问题最小间隔）
  };
  analysisLimits: {
    proto_construction_min_observations: number; // 默认 2
    session_end_llm_timeout_ms: number;          // 默认 15000
  };
  
  // ── 性能约束 ──
  performanceBudgets: {
    message_received_max_latency_ms: number;   // 默认 50
    session_end_max_latency_ms: number;         // 默认 20000
    system_prompt_max_tokens: number;           // 默认 1000
  };
  
  // ── AgentMemory 连接 ──
  agentMemory: {
    mcpServerName: string;           // "agentmemory"
    retryOnFailure: boolean;
    maxRetries: number;              // 默认 3
  };
}
```

### 3.2 用户命令 API

```typescript
// 命令处理函数签名

// /praxis perceive [scenario_id?]
async function handlePerceive(
  scenarioId?: string
): Promise<PerceptionReport>;

// /praxis proto <proto_id>
async function handleProtoDetail(
  protoId: string
): Promise<ProtoDetail>;

// /praxis proto <proto_id> correct <description>
async function handleProtoCorrect(
  protoId: string,
  correction: string
): Promise<CorrectionResult>;

// /praxis crystallize
async function handleCrystallizeList(): Promise<CrystallizationProposal[]>;

// /praxis crystallize approve <proposal_id>
async function handleCrystallizeApprove(
  proposalId: string
): Promise<ApprovalResult>;

// /praxis crystallize reject <proposal_id> [reason]
async function handleCrystallizeReject(
  proposalId: string,
  reason?: string
): Promise<ApprovalResult>;

// /praxis architecture status
async function handleArchitectureStatus(): Promise<ArchitectureStatus>;

// /praxis architecture freeze
async function handleArchitectureFreeze(): Promise<FreezeResult>;

// /praxis architecture unfreeze
async function handleArchitectureUnfreeze(): Promise<FreezeResult>;
```

### 3.3 内部编排 API

```typescript
// orchestration/context-builder.ts

function buildSystemPromptSupplement(
  scene: SceneContext,
  structures: (CognitiveStructure | ProtoStructure)[],
  config: PraxisConfig
): string;
// 返回值: 不超过 config.performanceBudgets.system_prompt_max_tokens 的 prompt 文本

// orchestration/scene-matcher.ts

function matchScene(
  messages: Message[],
  registry: CognitiveStructure[],
  activeProtos: ProtoStructure[]
): SceneContext['match_result'];

// orchestration/salience-marker.ts

function markSalientElements(
  message: string,
  historyBuffer: SalientElement[],
  sessionContext: SessionContext
): SalientElement[];

// orchestration/confidence-updater.ts

function updateConfidence(
  proto: ProtoStructure,
  predictionResult: PredictionResult,
  observationCount: number
): ConfidenceUpdate;

// analysis/proto-constructor.ts

async function constructProtoStructures(
  scenarioId: string,
  elements: SalientElement[],
  pairs: CooccurrencePair[],
  observationCount: number
): Promise<ProtoStructure[]>;

// analysis/degradation-checker.ts

async function checkDegradation(
  structures: CognitiveStructure[],
  recentSessions: SessionTrace[]
): Promise<DegradationReport>;
```

---

## 四、性能预算

### 4.1 延迟预算

```
┌─────────────────────────────────────────────────────────┐
│                    延迟预算分配                           │
│                                                           │
│  message_received Hook:                                   │
│  ├─ 预算: 50ms                                           │
│  ├─ 实际: 正则匹配 < 10ms + 词频统计 < 10ms + 内存写 < 5ms │
│  └─ 余量: 25ms                                           │
│                                                           │
│  agent_end Hook:                                          │
│  ├─ 预算: 500ms                                          │
│  ├─ 实际: 解析预测标记 < 50ms + 置信度计算 < 1ms +       │
│  │        更新内存结构 < 10ms                             │
│  └─ 余量: 439ms                                          │
│                                                           │
│  session_end Hook:                                        │
│  ├─ 预算: 20s (会话结束后用户无感知，但需有限制)           │
│  ├─ 实际: 本地处理 < 2s + AgentMemory 写 < 3s +          │
│  │        LLM 分析 < 15s (Phase 2+)                      │
│  └─ 如果超时 → 降级: 跳过 LLM 分析，直接持久化原始数据   │
│                                                           │
│  session_start Hook:                                      │
│  ├─ 预算: 1s                                             │
│  ├─ 实际: AgentMemory 读 < 500ms + 场景匹配 < 200ms      │
│  └─ 余量: 300ms                                          │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Token 预算

```
┌─────────────────────────────────────────────────────────┐
│                    Token 预算分配                          │
│                                                           │
│  系统提示总量 (LLM 上下文窗口的 20% 预留):                 │
│                                                           │
│  确定场景 (exact match):                                  │
│  ├─ 场景结构注入: 200-400 tokens                         │
│  ├─ 角色定义注入: 50-150 tokens                          │
│  └─ 总计: < 500 tokens                                   │
│                                                           │
│  弱匹配场景 (weak match):                                 │
│  ├─ 警惕指令: 50 tokens                                  │
│  ├─ 参考结构注入: 150-300 tokens                         │
│  └─ 总计: < 400 tokens                                   │
│                                                           │
│  零先验场景 (zero prior):                                 │
│  ├─ 开放感知指令: 150 tokens                             │
│  ├─ ProtoStructure 注入: 300-600 tokens                  │
│  ├─ 预测标记协议: 100 tokens                             │
│  └─ 总计: < 1000 tokens                                  │
│                                                           │
│  LLM 分析任务 (session_end, 独立调用):                    │
│  ├─ ProtoStructure 构造: 2000-4000 tokens (一次性)       │
│  └─ 不计入用户会话的 token 预算                          │
└─────────────────────────────────────────────────────────┘
```

---

## 五、错误处理与降级策略

```typescript
// 每个 Hook 回调必须包含降级路径

// 示例: session_end 降级策略
async function sessionEndHandler(sessionKey: string, context: SessionContext) {
  try {
    // Step 1: 本地处理（必须成功）
    const elements = await processSalientElements(context.session_buffer);
    await persistSalientElements(elements);
    
    // Step 2: LLM 分析（可降级）
    try {
      const protos = await constructProtoStructuresWithTimeout(
        elements, { timeout: config.analysisLimits.session_end_llm_timeout_ms }
      );
      await updateProtoStructures(protos);
    } catch (llmError) {
      // 降级: 跳过 LLM 分析，仅记录失败
      await logAnalysisFailure(llmError, sessionKey);
      // ProtoStructure 不变（下次 session_end 再试）
    }
    
    // Step 3: 固化检查（可降级）
    try {
      await checkCrystallizationCandidates();
    } catch (crystError) {
      // 降级: 跳过固化检查
      await logCrystallizationFailure(crystError, sessionKey);
    }
    
  } catch (fatalError) {
    // 最终降级: 持久化原始 buffer 数据（不处理），下次 session_start 再处理
    await persistRawBuffer(context.session_buffer, sessionKey);
    // 不抛出异常——session_end 失败不应该影响 OpenClaw 的正常关闭
  }
}

// 超时保护
async function constructProtoStructuresWithTimeout(
  elements: SalientElement[],
  opts: { timeout: number }
): Promise<ProtoStructure[]> {
  const result = await Promise.race([
    constructProtoStructures(elements),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), opts.timeout)),
  ]);
  
  if (result === null) {
    console.warn('[Praxis] Proto construction timed out. Using cached structures.');
    return [];  // 返回空，不更新——保留上次的结果
  }
  
  return result;
}
```

---

## 六、监控指标

```typescript
// Praxis 自监控（通过 memory_save(type="praxis_telemetry") 记录）

interface PraxisTelemetry {
  timestamp: number;
  
  // 使用指标
  sessions_with_praxis: number;
  sessions_with_proto_cognitive: number; // 触发了零先验模式的会话数
  total_proto_structures: number;
  total_crystallized_structures: number;
  
  // 质量指标
  avg_scene_match_adaptation_score: number;
  zero_prior_scene_count: number;
  salient_element_acceptance_rate: number;  // 用户 review 后的接受率
  
  // 学习指标
  proto_confidence_gain_per_session: number;  // 平均每会话的置信度增长
  crystallizations_approved: number;
  crystallizations_rejected: number;
  degradations_triggered: number;
  
  // 性能指标
  avg_message_received_latency_ms: number;
  avg_session_end_latency_ms: number;
  avg_llm_analysis_time_ms: number;
  llm_analysis_timeout_rate: number;
  
  // 用户交互指标
  questions_asked: number;
  questions_answered_by_user: number;
  user_corrections_processed: number;
  
  // 错误指标
  hook_errors: { hook: string; count: number; last_error: string }[];
  agentmemory_write_failures: number;
  degradation_events: number;
}
```

---

## 七、V1 → V7 完整差异矩阵

| 维度 | V1 | V2 | V3 | V4 | V5 | V6 | V7 |
|------|----|----|----|----|----|----|-----|
| 运行环境 | Claude Harness | OpenClaw Plugin | 同 V2 | 同 V2 | 同 V2 | 同 V2 | 同 V2 |
| 任务模型 | 工具链 | 工具链 | 工具链 | 过程网络 | 过程+结构演化 | 过程+结构演化+零先验 | **工程实现** |
| 角色认知 | 无 | 隐式 | UserModel | RoleRegistry | RoleRegistry | RoleRegistry+ProtoRole | **同上 + 工程落地** |
| 能力维度 | 1D | 1D | 4D | 6D | 7D(+元认知) | 8D(+原型认知) | **8D + 工程质量维度** |
| 知识形式 | 无分类 | 无分类 | 5类 | 5类 | 5类+结构 | 5类+结构+原型 | **同上（工程实现）** |
| 学习事件 | 1 | 1 | 5 | 10 | 15 | 23 | **23 (事件采集工程化)** |
| Hook 数 | 自建 | 5 | 6 | 7 | 7 | 7 | **6 (精简合并)** |
| 认知结构 | 固定6层 | 固定6层 | 固定6层 | 固定6层+4子系统 | 动态+Meta Layer | 动态+层可修改 | **工程中 Level 1-3 可操作** |
| 架构可改？ | ❌ | ❌ | ❌ | ❌ | 结构可增改 | 层可改（设计） | **Level 1-3 可实现, 4-6 defer** |
| 零先验？ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (设计) | **✅ (工程实现)** |
| 人类角色 | 设计者 | 设计者 | 设计者 | 设计者 | 治理者 | 递归终止 | **用户+运维者+开发者三角** |
| **代码结构** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 完整模块划分** |
| **Prompt 工程** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 4 类 prompt 模板** |
| **性能预算** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 延迟 + Token 预算** |
| **测试策略** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 单元/集成/性能测试** |
| **分阶段交付** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 4 Phase x 2-3 周** |

---

## 八、兄弟文件

- [What is Praxis V7?](what-is.md) — V7 的工程定义
- [Why Praxis V7?](why.md) — 第一性原理工程可行性分析
- [Who is it for?](who.md) — 开发者、运维者、用户三角色
- [How does it work?](how.md) — Hook 编排、Prompt 工程、数据流详解
- [When does it operate?](when.md) — 实现路线图与分阶段交付
- [Where does it sit?](where.md) — 工程架构与模块划分
