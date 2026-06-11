# AgentOS V9 Architecture Design

> 版本：v9 (Context-Pressure-Adaptive Engineering)
> 状态：设计阶段
> 基于：V8 + token 爆炸第一性原理分析 (2026-06-11)

---

## 零、架构哲学：从"全量公民"到"自适应公民"

```
V8: AgentOS 是上下文空间的固定租户 — 每次注入 ~30K, 不关心上下文还剩下多少空间
V9: AgentOS 是自适应公民 — 空间充裕时充分利用, 空间紧张时主动压缩, 空间枯竭时退化为索引服务

核心洞察: 
  "全量注入"在 90% 场景中是最优策略。
  但一个在 10% 场景中会崩溃的系统, 用户感知 = 不稳定。
  V9 保证 AgentOS 在这 10% 中优雅降级而非崩溃。
```

---

## 一、V9 新增数据模型

### 1.1 ContextPressure

```typescript
// types/scene.ts

enum PressureLevel {
  Normal   = 'normal',
  Elevated = 'elevated',
  High     = 'high',
  Critical = 'critical',
}

interface ContextPressure {
  level: PressureLevel;
  usageRatio: number;          // 0.0 - 1.0
  totalEstimated: number;      // 估算的总 token 消耗
  availableTokens: number;     // 剩余可用
  agentOSBudget: number;       // 分配给 AgentOS 注入的预算
  breakdown: {
    systemAndTools: number;
    conversationHistory: number;
    userData: number;
    agentOSPrevious: number;
    outputBuffer: number;
  };
}
```

### 1.2 StructureUsageRecord

```typescript
// types/memory.ts

interface StructureUsageRecord {
  proto_id: string;
  session_id: string;
  used: boolean;
  manually_invoked: boolean;     // 是否通过 recall_structure 主动拉取
  pressure_level: PressureLevel; // 注入时的上下文压力等级
  timestamp: number;
}

interface UsageStats {
  proto_id: string;
  adoption_rate: number;         // 结构被 LLM 实际使用的会话比例
  manual_recall_rate: number;    // 被主动拉取的比例
  is_zombie: boolean;            // 采用率 < zombie_threshold
  confidence_usage_gap: number;  // 置信度 - 采用率 (越大越可疑, 可能过度自信)
  trend: 'rising' | 'stable' | 'declining';
}
```

### 1.3 RoleVerificationResult & ConceptVerificationResult

```typescript
interface RoleVerificationResult {
  role_proto_id: string;
  source: 'role_verifier';
  match_rate: number;
  behaviors_observed: string[];
  behaviors_missing: string[];
  behaviors_by_other_roles: {
    behavior: string;
    executed_by: string;
  }[];
  confidence_impact: number;
  is_conclusive: boolean;
}

interface ConceptVerificationResult {
  concept_proto_id: string;
  source: 'concept_verifier';
  weak_features: string[];
  missing_edge_cases: string[];
  overlap_concerns: string[];
  verdict: 'reliable' | 'needs_revision' | 'unreliable';
  confidence_adjustment: number;
}
```

### 1.4 ConsistencyReport

```typescript
interface ConsistencyReport {
  scenario_id: string;
  contradictions: {
    structure_a: string;
    structure_b: string;
    contradiction: string;
    severity: 'high' | 'medium' | 'low';
  }[];
  recommended_actions: string[];
  is_consistent: boolean;
}
```

### 1.5 ConfigAdjustment

```typescript
interface ConfigAdjustment {
  param: string;
  old_value: number;
  new_value: number;
  reason: string;
  auto_applied: boolean;
  timestamp: number;
}
```

---

## 二、GovernancePolicy 完整接口（V9 修订）

```typescript
interface GovernancePolicy {
  // ── V7 保留 ──
  crystallizationThresholds: { min_confidence: number; min_observations: number; min_recent_stability: number; };
  degradationThresholds: {
    manual_approved: { max_accuracy_drop: number; max_contradictions: number; };
    auto_crystallized: { max_accuracy_drop: number; max_contradictions: number; };
  };
  questionLimits: { max_per_session: number; min_interval_minutes: number; };

  // ── V8 新增 ──
  autoCrystallization: { /* 同 V8 */ };
  contextOrganization: { /* 同 V8 */ };
  analysisBudget: { /* 同 V8 */ };
  realTimeDegradation: { /* 同 V8 */ };
  statisticalVerifier: { /* 同 V8 */ };
  localCache: { /* 同 V8 */ };
  structureLifecycle: { /* 同 V8 */ };
  sceneRecognition: { /* 同 V8 */ };

  // ── V9 新增 ──
  contextPressure: {
    enabled: boolean;                          // 默认 true (Phase 0)
    levels: {
      normal_threshold: number;                // 默认 0.60
      elevated_threshold: number;              // 默认 0.75
      high_threshold: number;                  // 默认 0.90
    };
    compression_strategy: 'aggressive' | 'balanced' | 'conservative';  // 默认 'balanced'
    token_estimation_mode: 'chars' | 'tokenize';  // 默认 'chars'
    safety_margin: number;                     // 默认 0.10
  };

  lazyLoading: {
    enabled: boolean;                          // 默认 true
    max_results_per_recall: number;            // 默认 3
    embedding_fallback: boolean;               // 默认 false (Phase 1+)
  };

  attentionTelemetry: {
    enabled: boolean;                          // 默认 true (Phase 1)
    structure_used_marker: string;             // 默认 '[STRUCTURE_USED: <proto_id>]'
    zombie_threshold: number;                  // 默认 0.1
    report_frequency: 'weekly' | 'monthly';
  };

  adaptiveConfig: {
    enabled: boolean;                          // 默认 false (Phase 3)
    adjustment_range: number;                  // 默认 0.20 (±20%)
    locked_params: string[];                   // 默认 []
    calibration_min_samples: number;           // 默认 20
  };

  roleVerifier: {
    enabled: boolean;                          // 默认 true (Phase 2)
    confidence_weight: number;                 // 默认 0.2 (初始低权重)
    min_behaviors_for_conclusive: number;      // 默认 3
  };

  conceptVerifier: {
    enabled: boolean;                          // 默认 true (Phase 2)
    model: string;                             // 默认 'claude-sonnet-4-6'
    confidence_weight: number;                 // 默认 0.15 (对抗性, 更保守)
  };

  consistencyChecker: {
    enabled: boolean;                          // 默认 true (Phase 2)
    min_structures_to_check: number;           // 默认 2
    high_severity_penalty: number;             // 默认 0.15
  };
}
```

---

## 三、性能预算（修订）

### 3.1 延迟预算

```
session_start Hook (V9 修订):
  ├─ 预算: 2s (不变)
  ├─ 新增: 压力测量 < 5ms (字符估算) 或 < 50ms (tokenize)
  ├─ 新增: 四级注入变体选择 < 1ms
  └─ Critical 模式: recall_structure tool 注册 < 5ms

message_received Hook:
  ├─ 不变 (< 10ms)

agent_end Hook:
  ├─ 预算: 500ms (不变)
  ├─ 新增: [STRUCTURE_USED] 解析 < 50ms
  ├─ 新增: role-verifier (本地算法) < 50ms
  └─ 其他不变

session_end Hook:
  ├─ 预算: 30s (不变)
  ├─ 新增: concept-verifier LLM 调用 < 10s
  ├─ 新增: consistency-checker LLM 调用 < 10s
  ├─ 新增: config-adapter (本地统计) < 100ms
  └─ 如果超时 → 优先保证 transcript 持久化 + 退化检测, 新功能降级
```

### 3.2 Token 预算（四级动态）

```
Normal (< 60% 使用率):
  AgentOS 注入: ~30K tokens (同 V8)

Elevated (60-75%):
  AgentOS 注入: ~16K tokens (Tier A 完整 + Tier B 压缩 + Tier C 移除)

High (75-90%):
  AgentOS 注入: ~3.5K tokens (Tier A 摘要, 其他移除)

Critical (> 90%):
  AgentOS 注入: ~1K tokens (索引 + recall_structure tool)
  + LLM 按需拉取: 每次 recall_structure < 2K tokens
```

---

## 四、置信度融合（五源）

```typescript
// V9: 五源融合权重

const SIGNAL_WEIGHTS = {
  statistical:     0.30,  // 统计验证 (ProtoSequence, 独立信号, 最可靠)
  role_verifier:   0.15,  // 角色验证 (ProtoRole, 独立信号, 较可靠)
  concept_verifier:0.10,  // 概念验证 (ProtoConcept, 对抗性 LLM, 较保守)
  llm_marker:      0.30,  // LLM 自报告标记 (辅助, 但覆盖面广)
  user_correction: 0.15,  // 用户纠正 (外部真值, 权重高但稀疏)
};

// 权重总和 = 1.0
// 每个信号独立贡献其权重 × 该信号的 confidence_impact
// 最终置信度变化 = Σ(weight × impact) / Σ(active_weights)
```

---

## 五、错误处理与降级策略（修订）

```typescript
// V9: 新增压力感知相关的降级路径

async function sessionStartHandler(sessionKey, context, config) {
  try {
    // Step 1-2: 加载 + 场景识别 (不变)

    // Step 3: 压力测量 (可降级)
    let pressure: ContextPressure;
    try {
      pressure = measureContextPressure(context, config);
    } catch (pressureError) {
      // 降级: 测量失败 → 默认 Normal (不做压缩)
      console.warn('[AgentOS] Pressure measurement failed, defaulting to Normal');
      pressure = {
        level: PressureLevel.Normal,
        usageRatio: 0, totalEstimated: 0,
        availableTokens: config.contextWindow,
        agentOSBudget: 80000,
        breakdown: { systemAndTools: 0, conversationHistory: 0,
                     userData: 0, agentOSPrevious: 0, outputBuffer: 0 },
      };
    }

    // Step 4: 自适应注入
    const result = organizeContextAdaptive(
      sceneRecognition, protoStructures, cognitiveStructures,
      pendingQuestions, pressure, config
    );

    // Step 5: 注册 recall_structure (如果 Critical)
    if (result.registeredTool) {
      context.registerTool(result.registeredTool.definition,
                          result.registeredTool.handler);
    }

    // Step 6: 遥测
    await recordPressureTelemetry(pressure, result.injection);

    return result.injection;

  } catch (fatalError) {
    // 最终降级: 零先验模式 (不注入任何结构)
    return buildZeroPriorContext();
  }
}
```

---

## 六、V7 → V8 → V9 完整差异矩阵

| 维度 | V7 | V8 | V9 |
|------|----|----|-----|
| 上下文约束 | Token 稀缺 | Token 充裕 (假设) | **Token 充裕时全量, 紧张时压缩** |
| 注入策略 | 选择性 (场景匹配) | 全量 (固定) | **自适应 (四级压缩)** |
| Token 爆炸保护 | 无 | 无 | **四级降级 + Lazy Loading** |
| 注意力管理 | 无 | Tier A/B/C 排序 | **排序 + 利用率追踪** |
| 统计验证 | 无 | ProtoSequence | **ProtoSequence + Role + Concept** |
| 工具映射 | 无 | 字符重叠率 | **LLM 预标注映射** |
| 一致性检查 | 无 | 无 | **跨结构矛盾扫描** |
| 配置管理 | ~15 参数 | ~46 参数 | **~55 参数 + 自适应调优** |
| 代码模块 | ~20 | ~19 | **~26 (新增 7)** |
| 实现周期 | 4-5 个月 | 3 个月 | **~4 个月** |
| 认知结构 | 同 V6 | 同 V6/V7 | 同 V6/V7 (无新增认知能力) |

---

## 兄弟文件

- [What is AgentOS V9?](what-is.md) — V9 的工程定义
- [Why AgentOS V9?](why.md) — 第一性原理：为什么 token 爆炸需要压力感知
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 压力监测器、四级压缩、按需检索等
- [When does it operate?](when.md) — 4 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V8 基础 + 7 新增）
