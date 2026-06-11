# AgentOS V8 Architecture Design

> 版本：v8 (1M Context Engineering)
> 状态：设计阶段
> 基于：V7 + 1M 上下文第一性原理分析 (2026-06-11)

---

## 零、架构哲学：从"选择"到"组织"

V7 的核心架构问题："在 token 稀缺约束下，如何选择注入什么？"
V8 的核心架构问题："在注意力稀缺约束下，如何组织全部注入的内容？"

这不是渐进优化——这是约束的质变。它导致约 40% 的 V7 模块被删除或替换。

---

## 一、V8 工程数据模型（与 V7 几乎相同）

V8 的数据模型与 V7 高度兼容。核心类型（SalientElement, ProtoStructure, SceneContext, PredictionResult）保持不变。以下仅列出差异。

### 1.1 新增：SessionTranscript

```typescript
// types/memory.ts

interface SessionTranscript {
  session_key: string;
  scenario_id: string;
  messages: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }[];
  tool_trace: {
    tool: string;
    params_summary: string;
    result_summary: string;
    timestamp: number;
  }[];
  started_at: number;
  ended_at: number;
}
```

### 1.2 新增：StatisticalVerificationResult

```typescript
interface StatisticalVerificationResult {
  proto_id: string;
  source: 'statistical';          // 区分于 LLM 标记信号
  match_rate: number;             // 0.0 - 1.0
  matched_steps: string[];
  misaligned_steps: {
    predicted_position: number;
    predicted_label: string;
    found_at_position: number | null;
  }[];
  missing_steps: string[];
  extra_steps: string[];
  confidence_impact: number;
  is_conclusive: boolean;
}
```

### 1.3 修改：PredictionResult — 增加 source 字段

```typescript
interface PredictionResult {
  proto_id: string;
  source: 'llm_marker' | 'statistical' | 'user_correction';  // ← 新增
  outcome: 'matched' | 'failed' | 'uncertain' | 'user_correction';
  predicted: string;
  actual: string;
  detail: string;
  timestamp: number;
}
```

### 1.4 新增：SceneRecognitionResult

```typescript
// types/scene.ts

interface SceneRecognitionResult {
  scenario_id: string;
  recognition_confidence: number;        // 0.0 - 1.0
  is_new_scenario: boolean;
  matched_scenarios: {
    scenario_id: string;
    adaptation_score: number;
    reason: string;
  }[];
}
```

### 1.5 新增：StructureLifecyclePolicy

```typescript
interface GovernancePolicy {
  // ... (V7 原有字段保持不变)

  auto_crystallization: {
    enabled: boolean;                    // 默认 false（Phase 2 设为 true）
    tier_1: {
      min_confidence: number;            // 默认 0.9
      min_observations: number;          // 默认 10
      require_zero_user_correction: boolean; // 默认 true
    };
    tier_2: {
      min_confidence: number;            // 默认 0.95
      min_observations: number;          // 默认 20
      require_cross_scene_consistency: boolean; // 默认 true
    };
    max_auto_per_month: number;          // 默认 3
    auto_rollback_enabled: boolean;      // 默认 true
    auto_rollback_threshold: number;     // 默认 0.6（自动固化的退化阈值更低）
  };

  context_organization: {
    mode: 'flat' | 'hierarchical';       // 默认 'flat'（Phase 1）
    relevance_pre_ranking: boolean;      // 默认 true: 按场景相关性预排序 Layer 2
    confidence_calibration: boolean;     // 默认 true: 每个结构附带置信度校准指令
    tierB_max_scenarios: number;         // 默认 5: Tier B 最多包含几个相关场景
    tierC_max_structures: number;        // 默认 30: Tier C 最多展示多少个不相关结构
  };

  analysis_budget: {
    max_history_sessions: number;        // 默认 5
    max_tokens_per_session: number;      // 默认 20000
    llm_timeout_ms: number;              // 默认 30000
    max_monthly_cost_usd: number;        // 默认 100
  };

  real_time_degradation: {
    enabled: boolean;                    // 默认 true
    single_session_threshold: number;    // 默认 0.3
    consecutive_failures: number;        // 默认 3
  };

  structure_lifecycle: {
    archive_after_inactive_days: number;   // 默认 90: 超过此天数未激活 → 归档
    cleanup_confidence_threshold: number;  // 默认 0.2: 低于此置信度 + 停滞 → 建议清理
    downgrade_monthly_usage_threshold: number; // 默认 1: 月使用 < 此值 → 降级
    lifecycle_cron: string;                // 默认 "0 5 * * 0" (每周执行)
  };

  scene_recognition: {
    new_scenario_threshold: number;      // 默认 0.2: 最高适配度 < 此值 → 零先验
    related_scenario_threshold: number;  // 默认 0.15: 适配度 > 此值 → Tier B 相关场景
  };
}
```

---

## 二、AgentMemory 集成规格

### 2.1 Slot 设计（与 V7 相同）

无新增 slot。V8 所有新数据使用 memory type 存储。

### 2.2 Memory 类型映射（新增 1 个类型）

| Type | 数据结构 | 查询方式 | 保存时机 | V7→V8 |
|------|---------|---------|---------|--------|
| `salient_element` | SalientElement | `memory_smart_search(scenario_id)` | session_end | 不变 |
| `proto_structure` | ProtoStructure 快照 | `memory_recall(proto_id)` | ProtoStructure 变更时 | 不变 |
| `cognitive_structure` | CognitiveStructure | `memory_smart_search(scene)` | 固化时 | 不变 |
| `structure_evolution` | StructureEvolution | `memory_timeline(id)` | 固化/退化时 | 不变 |
| `architecture_audit` | 审计报告 | `memory_timeline(type)` | 每月 cron | 不变 |
| `lesson` | 学习事件 | `memory_lesson_recall(type)` | 事件发生时 | 不变 |
| **`session_transcript`** | SessionTranscript | `memory_smart_search(scenario_id)` + 时间范围 | 每次 session_end | 🆕 新增 |

### 2.3 API 调用频率估算（修订）

```
每会话典型 API 调用次数 (V8 Phase 2+):

session_start:
  ├─ memory_slot_get("active_proto_structures")   [1 次]
  ├─ memory_slot_get("structure_registry")        [1 次]
  ├─ memory_slot_get("governance_policy")         [1 次]
  └─ memory_slot_get("pending_questions")         [1 次]

session_end:
  ├─ memory_save(type="session_transcript")       [1 次]  ← 新增
  ├─ memory_smart_search(type="session_transcript")[0-1 次] ← 新增（加载历史）
  ├─ memory_save(type="salient_element")          [0-8 次] ← 减少（LLM 直接从 transcript 提取，更精准）
  ├─ memory_slot_replace("active_proto_structures")[1 次]
  ├─ memory_save(type="proto_structure")          [0-3 次]
  └─ memory_slot_append("pending_crystallizations")[0-1 次]

总计: 每会话 5-13 次读 + 2-14 次写
(vs V7: 5-15 读 + 2-22 写 — SalientElement 写入减少)
```

---

## 三、性能预算（修订）

### 3.1 延迟预算

```
message_received Hook:
  ├─ 预算: 10ms  (vs V7 的 50ms — 不需要 regex 和词频统计)
  ├─ 实际: 归档到 buffer < 1ms
  └─ 简化后几乎无延迟

agent_end Hook:
  ├─ 预算: 500ms (不变)
  ├─ 实际: 统计验证 < 50ms + LLM标记解析 < 50ms + 融合 < 1ms + 内存更新 < 10ms
  └─ 统计验证计算量: O(steps × tool_calls) — 通常 < 100 次字符串比对

session_end Hook:
  ├─ 预算: 30s (vs V7 的 20s — 累积 transcript 分析需要更多时间)
  ├─ 实际: transcript 加载 < 2s + LLM 分析 < 25s + 持久化 < 3s
  ├─ 超时降级: 如果 LLM 超时 → 跳过分析，仅持久化 raw transcript
  └─ 异步化: 如果延迟持续超标 → 分析改为异步任务，结果在下下个 session_start 生效

session_start Hook:
  ├─ 预算: 2s (vs V7 的 1s — 全量加载可能涉及更多数据)
  ├─ 实际: AgentMemory 读 < 500ms + 上下文组织 < 100ms (flat) / < 200ms (hierarchical)
  └─ 降级: AgentMemory 超时 → local-cache (Phase 3)
```

### 3.2 Token / 注意力预算（替代 V7 的 Token 预算）

```
V7: 注入 token 数必须 < 1000
V8: 注入 token 数可以到 50000+，但需要管理注意力分布

注意力预算 (session_start 注入):

  Layer 1 (Primacy, 绝对注意力最高):
  ├─ 场景索引: < 500 tokens
  ├─ 当前场景摘要: < 200 tokens
  └─ 小计: < 700 tokens

  Layer 2 (Detail, 注意力随位置下降):
  ├─ ProtoStructure 详情: < 5000 tokens
  ├─ CognitiveStructure 详情: < 5000 tokens
  └─ 小计: < 10000 tokens

  Layer 3 (Recency, 用户消息前 — 注意力回升):
  ├─ 待验证问题: < 300 tokens
  ├─ 预测标记协议: < 200 tokens
  └─ 小计: < 500 tokens

  总计: < 11200 tokens

  LLM 分析任务 (session_end, 独立调用):
  ├─ 累积 transcript 分析: 20000 - 100000 tokens (一次性)
  └─ 不计入用户会话的注意力预算
```

---

## 四、AgentOSConfig 完整接口（修订）

```typescript
interface AgentOSConfig {
  // ── 核心开关 ──
  enabled: boolean;                           // 默认 true
  proto_cognitive_enabled: boolean;           // 默认 true
  auto_crystallization_enabled: boolean;      // 默认 false (Phase 2 设 true)

  // ── V7 保留的阈值 ──
  crystallizationThresholds: {
    min_confidence: number;                   // 默认 0.8
    min_observations: number;                 // 默认 5
    min_recent_stability: number;             // 默认 3
  };
  degradationThresholds: {
    manual_approved: {
      max_accuracy_drop: number;              // 默认 0.7
      max_contradictions: number;             // 默认 3
    };
    auto_crystallized: {
      max_accuracy_drop: number;              // 默认 0.6 (更低)
      max_contradictions: number;             // 默认 2 (更敏感)
    };
  };
  questionLimits: {
    max_per_session: number;                  // 默认 2
    min_interval_minutes: number;             // 默认 30
  };

  // ── V8 新增配置 ──
  contextOrganization: {
    mode: 'flat' | 'hierarchical';            // 默认 'flat'
    maxLayer1Tokens: number;                  // 默认 700
    maxLayer2Tokens: number;                  // 默认 10000
    maxLayer3Tokens: number;                  // 默认 500
  };
  autoCrystallization: {
    enabled: boolean;                         // 默认 false
    tier1: {
      minConfidence: number;                  // 默认 0.9
      minObservations: number;                // 默认 10
      requireZeroUserCorrection: boolean;     // 默认 true
    };
    tier2: {
      minConfidence: number;                  // 默认 0.95
      minObservations: number;                // 默认 20
      requireCrossSceneConsistency: boolean;  // 默认 true
    };
    maxAutoPerMonth: number;                  // 默认 3
  };
  analysisBudget: {
    maxHistorySessions: number;               // 默认 5
    maxTokensPerSession: number;              // 默认 20000
    llmTimeoutMs: number;                     // 默认 30000
    maxMonthlyCostUsd: number;                // 默认 100
  };
  realTimeDegradation: {
    enabled: boolean;                         // 默认 true
    singleSessionThreshold: number;           // 默认 0.3
    consecutiveFailuresThreshold: number;     // 默认 3
  };
  statisticalVerifier: {
    enabled: boolean;                         // 默认 true (Phase 2)
    matchMode: 'fuzzy' | 'embedding';         // 默认 'fuzzy'
    confidenceWeight: number;                 // 默认 0.5 (vs LLM 标记的 0.5)
  };
  localCache: {
    enabled: boolean;                         // 默认 false (Phase 3)
    ttlDays: number;                          // 默认 7
    syncRetryIntervalMs: number;              // 默认 60000
  };

  // ── 性能约束 ──
  performanceBudgets: {
    messageReceivedMaxLatencyMs: number;       // 默认 10 (vs V7 的 50)
    sessionEndMaxLatencyMs: number;            // 默认 30000
    sessionStartMaxLatencyMs: number;          // 默认 2000
  };

  // ── AgentMemory 连接 ──
  agentMemory: {
    mcpServerName: string;                    // "agentmemory"
    retryOnFailure: boolean;
    maxRetries: number;                       // 默认 3
    fallbackToLocalCache: boolean;            // 默认 true (Phase 3)
  };
}
```

---

## 五、错误处理与降级策略（修订）

```typescript
// V8 的降级路径比 V7 更多层

async function sessionEndHandler(sessionKey: string, context: SessionContext) {
  try {
    // Step 1: 持久化 transcript（必须成功）
    await persistTranscript(context);

    // Step 2: LLM 累积分析（可降级）
    let analysisResult = null;
    try {
      analysisResult = await analyzeTranscriptsWithTimeout(
        context.scenarioId,
        context.transcript,
        await loadHistoricalTranscripts(context.scenarioId),
        context.activeProtos,
        { timeout: config.analysisBudget.llmTimeoutMs }
      );
    } catch (llmError) {
      // 降级 1: LLM 超时/失败 → 跳过分析，仅记录
      await logAnalysisFailure(llmError, sessionKey);
      // 下次 session_end 会加载本次的 raw transcript 一起分析
    }

    // Step 3: 持久化分析结果（可降级 — AgentMemory 故障）
    if (analysisResult) {
      try {
        await persistAnalysisResult(analysisResult);
      } catch (memoryError) {
        // 降级 2: AgentMemory 不可用 → local-cache
        if (config.localCache.enabled) {
          await localCache.set(`analysis_${sessionKey}`, analysisResult);
          await localCache.markPendingSync(sessionKey);
        }
      }
    }

    // Step 4: 退化 + 固化检查
    await checkDegradationRealtime(context);
    await checkCrystallization(context.activeProtos);

  } catch (fatalError) {
    // 降级 3: 最终兜底 — 持久化 raw buffer
    await persistRawBuffer(context);
  }
}

// session_start 降级
async function sessionStartHandler(sessionKey: string, context: SessionContext) {
  try {
    return await loadAndOrganizeContext(context);
  } catch (memoryError) {
    if (config.localCache.enabled) {
      console.warn('[AgentOS] AgentMemory unavailable, using local cache');
      return await loadFromLocalCache(context);
    }
    // 降级: 零先验模式（无任何结构注入）
    console.warn('[AgentOS] No memory available, starting in zero-prior mode');
    return buildZeroPriorContext();
  }
}
```

---

## 六、V7 → V8 完整差异矩阵

| 维度 | V7 | V8 | 差异原因 |
|------|----|----|---------|
| 运行环境 | OpenClaw Plugin | 同 V7 | 不变 |
| 上下文约束 | Token 稀缺 (< 1000 tokens 注入) | 注意力稀缺 (全量注入 + 层级组织) | 1M 上下文 |
| SalientElement 提取 | regex 预标记 + session_end LLM | **仅 session_end LLM (完整 transcript)** | 删除 token 妥协 |
| ProtoStructure 构造 | PMI 预筛选 + LLM 归纳 (两步) | **LLM 一步 (累积 transcript)** | 删除 PMI 信息损失 |
| 置信度更新 | 单一 LLM 标记信号 | **统计 + LLM + 用户 三源融合** | 打破 LLM 自引用 |
| 场景匹配 | 选择性匹配 (决定注入哪些) | **场景识别 (不决定注入) + 相关性预排序** | 全量注入 + 注意力引导 |
| 上下文注入 | 三种策略 (exact/fuzzy/zero_prior) | **全量注入 + 层级组织 + 置信度校准** | Token 不再稀缺, 保留校准信号 |
| 结构生命周期 | 无 (依赖退化检测) | **自动归档/清理/降级** | 长期运行的结构爆炸风险 |
| 退化检测 | 仅每周 cron | **session_end 实时 + cron 深度** | 实时检测实现成本低 |
| 固化审批 | 必须用户手动操作 | **自动推进阶梯 + 可回滚** | 减少人类依赖 |
| AgentMemory 降级 | 无 | **local-cache 7 天 TTL** | 消除单点故障 |
| 代码模块数 | ~20 | ~19 (删除 5 + 新增 4) | 删除 token 妥协, 新增独立验证 |
| 实现周期 | 4-5 个月 (4 phases) | **3 个月 (3 phases)** | 删除 ~5 个模块的实现和测试 |
| 认知结构 | 同 V6/V7 | 同 V6/V7 (无新增认知能力) | V8 是工程增强, 不是认知设计 |

---

## 七、兄弟文件

- [What is AgentOS V8?](what-is.md) — V8 的工程定义
- [Why AgentOS V8?](why.md) — 第一性原理：为什么 1M 上下文改变了架构
- [Who is it for?](who.md) — 角色职责的变化
- [How does it work?](how.md) — 层级化组织、统计验证、双信号融合
- [When does it operate?](when.md) — 简化的实现路线图
- [Where does it sit?](where.md) — 模块树（删除 + 新增 + 修改）
