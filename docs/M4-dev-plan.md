# M4 开发计划：置信度系统

> **目标**: ProtoStructure 的置信度从 M1 的简单观察计数，升级为 7 个独立信号源的加权融合。每个信号源可独立验证——打破 LLM 自评循环。
>
> **对应架构**: §4 (学习引擎——Governor + 多源置信度融合 + Curiosity Engine), §3 (结晶化条件)
>
> **原则**: 架构文档是唯一真理源。当前代码能用的用、不能用的改。架构优先于已实现代码。

---

## 当前代码现状审计

### 架构 §4 与 ROADMAP M4 要求 vs 当前实现

| 架构要求 | 当前实现文件 | 状态 | 判定 |
|---------|------------|------|------|
| **M4.1 Governor 4-stage**: classify(4粗类→15细类) → gate(去噪/去重/频次) → decide(置信度裁决) → dispatch | `governor.ts` | 4-stage 骨架存在，但 classify 仅 3 种信号类型，gate 仅 isRealExperience，decide 仅时序路由，dispatch 为 no-op | ⚠️ 需大幅改造 |
| **M4.2 7源置信度融合**: statistical×0.25 + llm_marker×0.25 + user_correction×0.12 + role_verifier×0.12 + concept_verifier×0.08 + outcome_feedback×0.10 + mid_session×0.08 | 无 | 不存在 | ❌ 全新模块 |
| **M4.3 statistical-verifier**: 工具序列匹配，独立于 LLM | 无 | 不存在 | ❌ 全新模块 |
| **M4.3 role-verifier**: ProtoRole 行为 vs 实际工具调用者 | 无 | 不存在 | ❌ 全新模块 |
| **M4.3 concept-verifier**: 对抗 prompt 反例搜索 | 无 | 不存在 | ❌ 全新模块 |
| **M4.4 奎因式结晶化**: necessity/sufficiency/parsimony | `structure-lifecycle.ts` | 接口 stub 已预留，setVerifier()/getVerifier() 已定义 | ⚠️ 实现需填充 |
| **M4.5 Curiosity Engine**: 4-stage (detect→prioritize→act→govern) | `gap-detector.ts` | 仅基础缺口检测，无 priority 排序/行动生成/提问治理 | ⚠️ 需大幅改造 |
| **M4.6 退役与亚存在**: superseded_by + key_lessons + reactivation | 无 | 不存在 | ❌ 全新模块 |
| **关系图传播**: constrains/precedes/alternative_to | `structure-graph.ts` | 已实现 depends_on/contradicts/specializes，缺 3 种 | ⚠️ 需补充 |
| **LearningEvent 15种细分类** | `types.ts` + `timing-controller.ts` | 仅 5 种 SignalType，缺 10 种细分类 | ⚠️ 需扩展 |

### 可用代码清单

| 文件 | 保留策略 | 说明 |
|------|---------|------|
| `governor.ts` | **改造** — 保留 4-stage 骨架，扩展每阶段的逻辑 | 架构正确但内容不完整 |
| `timing-controller.ts` | **保留** — 纯函数，架构正确 | 仅需扩展 SignalType 枚举 |
| `execution-feedback.ts` | **改造** — 补充 ProtoStructure 相关反馈收集 | 当前仅收集 Correction[] |
| `learning-update.ts` | **改造** — 增加置信度融合调用 | 当前仅处理 episodic memory |
| `structure-lifecycle.ts` | **保留** — 状态机+门控骨架正确，填充 verifier 实现 | 接口预留设计良好 |
| `structure-graph.ts` | **改造** — 补充 3 种缺失的传播函数 | 确定性传播逻辑正确 |
| `gap-detector.ts` | **重构** — 作为 CuriosityEngine 的 detect stage | 缺口检测逻辑可复用 |
| `signal-detector.ts` | **保留** — 修正检测逻辑不变 | 与 M4 无直接冲突 |
| `signal-quality.ts` | **保留** — isRealExperience 不变 | 纯函数，gate stage 复用 |
| `memory-consolidator.ts` | **保留** — 记忆提炼管道不变 | 与 M4 正交 |
| `metacognitive-engine.ts` | **保留** — 8D 能力模型不变 | 与 M4 正交 |
| `m0-deps.ts` | **扩展** — 需要新依赖注入接口 | 增加 Verifier/Fuser 依赖 |
| `orchestrator.ts` | **改造** — session_end 需集成融合+验证 | 事件路由骨架不变 |
| `session-end.ts` | **改造** — 增加 7源融合+验证器调用 | 当前仅做 signal→lesson |
| `cognitive/types.ts` | **扩展** — 新增 LearningEvent 细分类、融合权重等类型 | 基础 ProtoStructure 类型已完整 |
| `agentmemory-client.ts` | **保留** — AgentMemory 通信不变 | |
| `memory/local-cache.ts` | **保留** — 降级缓存不变 | |

---

## 依赖关系

```
M4.1 Governor 增强 (classify/gate/decide/dispatch 升级)
  │
  ├─→ M4.2 置信度融合引擎 (ConfidenceFuser)
  │     │
  │     └─→ M4.3 独立验证器 (3 个)
  │           ├─ statistical-verifier
  │           ├─ role-verifier
  │           └─ concept-verifier
  │
  ├─→ M4.4 奎因式结晶化门控
  │     依赖: M4.2 (融合置信度) + M4.3 (验证器) + M2.3 (注意力遥测)
  │
  ├─→ M4.5 Curiosity Engine
  │     依赖: M4.2 (置信度数据)
  │
  └─→ M4.6 退役与亚存在
        依赖: M4.4 (门控) + M4.2 (置信度)
```

**关键**: M4.2 和 M4.3 可以并行开发（Fuser 框架先建，验证器实现可并行）。

---

## M4.1: Governor 完整管道增强 `[P0]`

**目标**: 将 Governor 从 M0 的简化版升级为架构 §4 定义的完整 4-stage 管道。

### 改动范围

#### 步骤 1: 扩展 LearningEvent 类型系统

**文件**: `src/cognitive/types.ts`

在现有 5 种 SignalType 基础上，按照架构 §4 的 classify 映射表，新增完整的 15 种 LearningEvent 细分类：

```typescript
// 架构 §4 — 20 种 LearningEvent 细分类
export type LearningEventType =
  // correction 粗类 → 细类 (5)
  | "mistake_correction"
  | "action_decision_error"
  | "action_decision_oversight"
  | "role_routing_mismatch"
  | "role_routing_ambiguity"
  // insight 粗类 → 细类 (3)
  | "domain_insight"
  | "task_pattern_recognition"
  | "procedural_optimization"
  // preference 粗类 → 细类 (5)
  | "preference_discovery"
  | "communication_style"
  | "communication_detail_level"
  | "timing_preference"
  | "timing_pacing"
  // pattern 粗类 → 细类 (3)
  | "process_efficiency_bottleneck"
  | "process_efficiency_redundancy"
  | "structural_inadequacy_detected"
  // structure 粗类 → 细类 (3, M5/M6 激活)
  | "structure_constructed"
  | "structure_validated"
  | "structure_regression"
  // governance (1)
  | "governance_override";
```

同时扩展 `LearningEvent` 接口：

```typescript
export interface LearningEvent {
  id: string;
  type: LearningEventType;
  coarseType: "correction" | "insight" | "preference" | "pattern";
  sessionId: string;
  timestamp: number;
  source: "message_received" | "before_tool_call" | "after_tool_call" | "agent_end" | "session_end";
  detail: string;
  affectedStructureIds: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
}
```

#### 步骤 2: 重写 Governor classify stage

**文件**: `src/cognitive/governor.ts`

当前 `inferSignalType()` 仅做 3 种启发式分类。需替换为完整的粗→细分类：

```typescript
// 架构 §4 映射表 — 4 粗类 → 20 细类
const COARSE_TO_FINE: Record<string, LearningEventType[]> = {
  correction: ["mistake_correction", "action_decision_error", "action_decision_oversight",
               "role_routing_mismatch", "role_routing_ambiguity"],
  insight: ["domain_insight", "task_pattern_recognition", "procedural_optimization"],
  preference: ["preference_discovery", "communication_style", "communication_detail_level",
               "timing_preference", "timing_pacing"],
  pattern: ["process_efficiency_bottleneck", "process_efficiency_redundancy",
            "structural_inadequacy_detected", "structure_constructed",
            "structure_validated", "structure_regression"],
  governance: ["governance_override"],
};
```

**设计决策**: coarse 分类用纯规则（与当前 `inferSignalType` 类似），fine 分类用 LLM（一次调用完成）。LLM 不可用时降级为 coarse 分类的默认 fine 类型。**decide() 改为 async**——LLM 调用本质上是网络 I/O，同步包装是架构欺骗。所有调用方（cognitive-core.ts, session-end handler）加入 M4.1 变更列表。

#### 步骤 3: 增强 Governor gate stage

**文件**: `src/cognitive/governor.ts`

当前 gate 仅 `isRealExperience` 过滤。按架构 §4 增加：

- **去重**: 同一 (correction.what, correction.correctedTo) 在同一 session 中重复 → 取最新
- **频次限制**: 同一结构在单 session 中最多触发 3 次学习更新
- **噪声过滤**: 信号置信度 < 0.3 且 source 不是 user_correction → 丢弃

这些全部是纯规则匹配，不调 LLM，< 10ms。

#### 步骤 4: 升级 Governor decide stage

**文件**: `src/cognitive/governor.ts`

当前 decide 仅按 timing (IMMEDIATE/BATCH/DEFERRED) 路由。需升级为：

```
timing=IMMEDIATE + signalType=mistake_correction → LEARN (confidence=0.8, routeTo=execution_feedback)
timing=IMMEDIATE + signalType=other → LEARN (confidence=0.6, routeTo=execution_feedback)
timing=BATCH + 融合置信度 null (<2 源) → DEFER (routeTo=deferred_queue, reason=insufficient_sources)
timing=BATCH + 融合置信度≥0.5 → LEARN (confidence=fused, routeTo=learning_update)
timing=BATCH + 融合置信度<0.5 → DEFER (routeTo=deferred_queue)
timing=DEFERRED → DEFER (routeTo=deferred_queue)
```

decide() 改为 async——LLM fine 分类 + 置信度查询均为网络 I/O。coarse 分类保持纯规则同步。

增加对置信度融合结果的感知——decide 从 ConfidenceFuser 获取当前融合置信度作为裁决输入。

#### 步骤 5: Governor dispatch — 保持 "只负责决策"

**文件**: `src/cognitive/governor.ts`

`stage4Dispatch` 保持 no-op。**Governor 只负责决策，不负责执行。** 路由逻辑由调用方（cognitive-core.ts）根据 `decision.routeTo` 执行：

- `execution_feedback` → 调用方写入 ExecutionFeedbackCollector
- `learning_update` → 调用方暂存到 session-scoped 队列
- `deferred_queue` → 调用方写入 AgentMemory slot

这是已验证的设计原则——不逆转。

#### 步骤 6: 合并 LearningLoop → Governor

**文件**: `src/cognitive/cognitive-core.ts`

当前两条并行的修正管道：`captureCorrection()` → LearningLoop 和 `governorDecide()` → Governor。Governor 是 "统一学习决策中心"（Governor.ts 注释）。

- cognitive-core.ts: 停止向 LearningLoop 路由修正信号
- Governor.decide() 成为唯一的修正处理管道
- LearningLoop 类体保留（可能被其他路径引用），但不接收新信号

### 验证

- [ ] Governor 正确处理 20 种 LearningEventType 的粗分类路由
- [ ] 同一信号重复 3 次 → gate 去重生效
- [ ] gate 噪声过滤: confidence<0.3 + non-user-correction → 丢弃
- [ ] decide() 改为 async（LLM fine 分类 + 置信度查询均为异步）
- [ ] decide() null 分支: 融合置信度 null → DEFER (routeTo=deferred_queue)
- [ ] dispatch 保持 no-op（Governor 只负责决策）
- [ ] cognitive-core.ts 不再向 LearningLoop 路由修正——Governor 是唯一管道

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/cognitive/types.ts` | **扩展** | 新增 LearningEventType (20), LearningEvent 接口 |
| `src/cognitive/governor.ts` | **重写** | 4-stage 全部升级, decide() → async |
| `src/cognitive/governor.test.ts` | **重写** | 覆盖 20 种类型路由 + gate 规则 + null 路径 |
| `src/cognitive/timing-controller.ts` | **扩展** | SignalType 扩展到 20 种 + 时序映射表 |
| `src/cognitive/cognitive-core.ts` | **改造** | governorDecide() → async await, LearningLoop 路由迁移 |

---

## M4.2: 多源置信度融合 `[P0]`

**目标**: 实现 7 源加权融合算法。每个信号源独立计算，加权融合后决定 ProtoStructure 的最终置信度。信号源不可用时按比例重分配权重。

### 架构要求

| 信号源 | 权重 | 独立性 | M4 状态 | 说明 |
|--------|------|--------|---------|------|
| `statistical` | 0.28 | 独立于 LLM | ✅ M4.3.1 | 工具序列实际匹配 vs ProtoSequence 预测 (吸收 concept 降权的 0.03) |
| `llm_marker` | 0.25 | 来自 LLM | ✅ M4.2 (prediction-protocol) | [PREDICTION_CONFIRMED/FAILED/UNCERTAIN] 标记 |
| `user_correction` | 0.12 | 独立 | ✅ M0 已有, M4 增强 | 用户显式纠正 → 映射为 0-1 信号 |
| `role_verifier` | 0.12 | 独立 | ✅ M4.3.2 (缩减) | ProtoRole behaviors vs 实际工具名匹配 + DAG 循环检测 |
| `concept_verifier` | 0.05 | 半独立 (对抗 LLM) | ✅ M4.3.3 | 对抗 prompt 寻找反例 — 降权反映 LLM 依赖风险 |
| `outcome_feedback` | 0.10 | 独立 | ❌ M5 | 子任务成败 → 使用的结构表现 |
| `mid_session` | 0.08 | 独立 | ❌ M5 | 会话中实时矛盾检测 |

**M4 实际活跃源: 4-5 个** (statistical + llm_marker + user_correction + role_verifier + [concept_verifier])。
**Fuser 最小源数: 2** (低于 2 → 警告日志 + 跳过融合)。框架支持全部 7 个 Slot，M5/M6 补充剩余。

### 全新模块: `src/orchestration/confidence-fuser.ts`

```typescript
// ConfidenceFuser — 7 源加权融合引擎
export class ConfidenceFuser {
  private readonly weights: FusionWeights;
  
  // 融合多个信号源输出 → 单一置信度
  fuse(sources: SignalSourceOutputs): number;
  
  // 缺失信号源 → 按比例重分配权重
  redistributeWeights(availableSources: string[]): FusionWeights;
  
  // 返回各信号源的贡献分解 (可观测性)
  decompose(structureId: string): SourceContribution[];
}
```

**融合公式**:

```
confidence = Σ(wi × si) / Σ(wi)  // 仅对可用信号源求和
```

其中 wi = 原始权重，si = 信号源输出值 (0.0-1.0)。

**关键设计**:
- 纯函数核心 + 异步 I/O 外层（信号源读取是异步的）
- 至少需要 2 个活跃信号源才输出融合置信度，< 2 → 返回 null 并记录警告。M4 实际活跃源 4-5 个，<2 仅发生在多重故障时。
- 输出包含各源贡献度，用于审计 `/praxis audit`

**信号源输入接口**:

```typescript
export interface SignalSourceInput {
  structureId: string;
  sourceName: string;
  value: number;        // 0.0-1.0
  confidence: number;   // 信号源自身对输出的置信度 (0.0-1.0)
  evidence: string;     // 可读的证据描述
}
```

### 集成点

**session_end** (`src/session-end.ts`):
1. 收集所有信号源输出
2. 对每个受影响的 ProtoStructure 调用 ConfidenceFuser.fuse()
3. 更新 ProtoStructure.confidence
4. 写回 AgentMemory

**before_tool_call** (`src/before-tool-call.ts`):
- 读取当前结构的融合置信度 → 决定自主性级别

### 验证

- [ ] 7 个源全部可用 → 融合结果落于 [0, 1]
- [ ] 仅 1 个源可用 → 返回 null + 警告日志
- [ ] 4 个源 (权重 0.25, 0.12, 0.10, 0.08) → 权重归一化为 (0.455, 0.218, 0.182, 0.145)
- [ ] user_correction 源输出 1.0 → 融合结果 > 未包含时的结果
- [ ] 同一结构 3 次融合 → 每次 decompose() 显示各源贡献
- [ ] **集成测试**: 模拟完整 session (构造 3+ 信号源输出 → session_end → 验证 AgentMemory 中 ProtoStructure.confidence 被正确更新 + decompose 日志完整)

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/orchestration/confidence-fuser.ts` | **新建** | 7 源加权融合引擎 |
| `src/orchestration/confidence-fuser.test.ts` | **新建** | 融合算法 + 权重重分配 + decompose 测试 |
| `src/orchestration/confidence-fuser.integration.test.ts` | **新建** | 端到端集成测试: session_end → 信号收集 → 融合 → 持久化 |
| `src/orchestration/prediction-protocol.ts` | **新建** | [PREDICTION_*] 标记解析 — 架构 §11 指定 |
| `src/orchestration/prediction-protocol.test.ts` | **新建** | 标记解析 + 格式验证测试 |
| `src/session-end.ts` | **改造** | 集成融合调用 + 接线 attention-telemetry (updateAttention) |
| `src/session-start.ts` | **改造** | 注入 prediction marker 指令到 system prompt |
| `src/cognitive/types.ts` | **扩展** | FusionWeights, SignalSourceOutputs, SourceContribution 类型 |
| `src/structure-lifecycle.ts` | **改造** | 结晶化门控使用融合置信度替代简单 confidence |

---

## M4.3: 独立验证器 `[P1]`

**目标**: 实现三个独立于 LLM 的验证信号源，打破 LLM 自评循环。

### M4.3.1 StatisticalVerifier

**全新模块**: `src/analysis/statistical-verifier.ts`

**原理**: 从 ProtoSequence 提取预测的工具序列（步骤→工具映射），与 AgentMemory 中记录的实际工具调用序列做模糊匹配。一致 → 1.0，不一致 → 0.0。

```
Predicted: ProtoSequence "API 开发" → [read_file, write_file, npm_test]
Actual:    toolCallTrace → [read_file, edit_file, npm_test, npm_run_build]
Match:     read_file✓, (write_file~edit_file), npm_test✓ → 2.5/3 → 0.83
```

**模糊匹配策略**:
- 精确匹配: toolName 完全相同 → 1.0
- 语义匹配: 同类别工具 (read_file vs Glob → 0.6, write_file vs Edit → 0.7)
- 无匹配: 0.0

**数据来源**:
- ProtoSequence.structure.steps[].action → 映射到工具名
- AgentMemory 中 `after_tool_call` 记录的实际工具调用序列
- 匹配窗口: ProtoSequence 步骤的 ±1 位置容忍

**验证**: statistical-verifier 独立预测 ProtoSequence 适用性 vs 实际子任务成败（outcome）的准确率 ≥ 70%。LLM [PREDICTION_*] 标记仅作为开发期校准参考，不作为门控标准。

### M4.3.2 RoleVerifier

**全新模块**: `src/analysis/role-verifier.ts`

**M4 范围（缩减版）**:
1. **静态验证**: 检查 ProtoRole.dependsOn 是否形成 DAG（无循环依赖）
2. **行为匹配**: 将 toolCallTrace 中的 toolName[] 与 ProtoRole.behaviors[] 做模糊匹配，输出匹配比例
3. **依赖一致性**: 检查 dependsOn 列表中的角色是否有冲突的 behaviors 定义

**推迟到 M6**: 运行时越界检测（"Agent X 做了 Agent Y 的工作"）。需要在 ToolCallRecord 中新增 executorRole 字段，而该字段仅在多 Agent 模式下有意义——M4 的单一 LLM Agent 场景中无越界概念，所有工具调用者都是同一个 LLM。

**核心逻辑**: `ToolCallRecord.toolName` 天然记录了调用了什么工具。与 ProtoRole.behaviors 匹配即可——不依赖 "谁调用的"。

### M4.3.3 ConceptVerifier

**全新模块**: `src/analysis/concept-verifier.ts`

**原理**: 对抗 prompt——"尝试为这个概念的反例辩护"。如果 LLM 能构建合理的反例 → 概念置信度下调。

```
ProtoConcept "分诊":
  definition: "根据病情紧急程度分配就诊优先级"

对抗 prompt:
  "请尝试论证: 在以下场景中，「分诊」的概念不适用或定义有误。
   如果能构建 2+ 个合理反例 → 概念需要修正。"

LLM 输出:
  - 反例 1: 急诊场景中，分诊不是基于优先级而是基于生命体征 → 概念不完整
  - 反例 2: 线上问诊中，AI 预检替代了人工分诊 → 概念边界模糊
```

**设计要点**:
- 仅在置信度 0.4-0.7 的结构上运行（过高无需验证，过低不值得验证）
- 每次验证需消耗 1 次 LLM 调用 → 批处理 + 频次限制
- 输出: 反例数量 + 严重度 + 建议修正

### 验证器统一接口

```typescript
export interface Verifier {
  readonly name: string;
  readonly weight: number;  // 在 7 源融合中的权重
  verify(structure: ProtoStructure, context: VerificationContext): Promise<VerifierOutput>;
}

export interface VerifierOutput {
  value: number;       // 0.0-1.0
  confidence: number;  // 验证器对自身输出的置信度
  evidence: string;
  timestamp: number;
}
```

### 集成

三个验证器在 `session_end` 时按需运行:
- **statistical-verifier**: 每次 session_end 对所有活跃 ProtoSequence 运行（纯规则，便宜）
- **role-verifier**: 每 3 个 session 对活跃 ProtoRole 运行一次
- **concept-verifier**: 每 10 个 session 对置信度 0.4-0.7 的 ProtoConcept 运行一次（LLM 调用，贵）

### 验证

- [ ] statistical-verifier 在模拟 10 个 session 上准确率 ≥ 80%
- [ ] role-verifier 正确检测角色越界行为
- [ ] concept-verifier 至少生成 1 个有意义的反例
- [ ] 三个验证器输出格式兼容 ConfidenceFuser 的 SignalSourceInput

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/analysis/statistical-verifier.ts` | **新建** | 工具序列匹配 |
| `src/analysis/statistical-verifier.test.ts` | **新建** | 匹配算法 + 准确率测试 |
| `src/analysis/role-verifier.ts` | **新建** | 角色行为验证 |
| `src/analysis/role-verifier.test.ts` | **新建** | 越界检测测试 |
| `src/analysis/concept-verifier.ts` | **新建** | 对抗 prompt 验证 |
| `src/analysis/concept-verifier.test.ts` | **新建** | 反例生成测试 |
| `src/analysis/types.ts` | **新建** | Verifier 统一接口 |
| `src/analysis/index.ts` | **新建** | 导出聚合 |
| `src/session-end.ts` | **改造** | 集成验证器调度 |

---

## M4.4: 奎因式结晶化门控 `[P1]`

**目标**: 将 M1 预留的验证器接口 (`structure-lifecycle.ts` 中的 `CrystallizationVerifier`) 实现为具体逻辑。

### 实现方案

**文件**: `src/structure-lifecycle.ts` (改造) + `src/analysis/quinean-gating.ts` (新建)

三个门控基于遥测数据和统计验证器日志实现，不调新 LLM：

#### 必要性检验 (Necessity)

```
leave-one-out 方法:
  移除该结构的 session 预测准确率 vs 使用该结构的 session 预测准确率
  下降 ≥ 10% → 通过 (该结构是必要的)
  下降 < 10% → 失败 (该结构可能冗余)
```

数据来源: `attention-telemetry.ts` 的采纳率追踪 + `statistical-verifier` 的预测准确率日志。

#### 充分性检验 (Sufficiency)

```
结构被使用的 session 预测准确率 vs 不被使用的 session 预测准确率
前者 > 后者 + 0.1 → 通过 (结构有用)
前者 ≤ 后者 + 0.1 → 失败 (结构是"僵尸")
```

#### 奥卡姆剃刀 (Parsimony)

```
是否存在替代结构 (更少步骤/更少依赖) 且预测准确率 ≥ 当前结构？
是 → 失败 (存在更简单等价替代)
否 → 通过
```

**实现**: `src/analysis/quinean-gating.ts`

```typescript
export class QuineanGating implements CrystallizationVerifier {
  constructor(
    private readonly telemetry: AttentionTelemetry,  // M2.3
    private readonly statisticalVerifier: StatisticalVerifier,
  ) {}
  
  async checkNecessity(structure: ProtoStructure): Promise<boolean>;
  async checkSufficiency(structure: ProtoStructure): Promise<boolean>;
  async checkParsimony(structure: ProtoStructure): Promise<boolean>;
}
```

### 范围限制

**M4 仅对 ProtoSequence 应用奎因式门控。** ProtoRole/Concept/Purpose/Constraint 仅使用门控 1-2（置信度 + 观察次数）+ 门控 6（人类审批）。原因：statistical-verifier 仅对 ProtoSequence 产生预测准确率数据。

**Sample-size 阈值**: 至少 **10 个 session** 的遥测数据才启动必要性/充分性检验。5 次观察刚达到结晶化阈值但不足以做有意义的 leave-one-out。

### 集成

在 `structure-lifecycle.ts` 的 `canCrystallize()` 中调用 QuineanGating（仅 ProtoSequence 类型 + session ≥ 10）。QuineanGating 通过 M4Deps 注入，替代全局单例 `setVerifier()/getVerifier()`。`canCrystallize()` 改为 async（门控方法是异步的）。调用方加入 M4.4 变更列表。

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/analysis/quinean-gating.ts` | **新建** | 三个奎因式门控实现 |
| `src/analysis/quinean-gating.test.ts` | **新建** | 门控逻辑测试 |
| `src/structure-lifecycle.ts` | **改造** | canCrystallize() → async, DI 注入 QuineanGating, 仅 ProtoSequence + session≥10 |
| `src/m0-deps.ts` | **扩展** | M4Deps 增加 quineanGating 字段 |

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/analysis/quinean-gating.ts` | **新建** | 三个奎因式门控实现 |
| `src/analysis/quinean-gating.test.ts` | **新建** | 门控逻辑测试 |
| `src/structure-lifecycle.ts` | **改造** | 填充 canCrystallize 的门控 3-5 |

---

## M4.5: Curiosity Engine `[P2]`

**目标**: 实现架构 §4 定义的 4 阶段 Curiosity Engine，替代当前的简单 GapDetector。

### 当前代码分析

`gap-detector.ts` 的 `GapDetector.detect()` 实现了阶段 1（缺口检测）的子集——仅检测低 selfRating 领域。缺少:
- 阶段 1: 未知术语检测、反复纠正模式、长期不增长技能
- 阶段 2: priority 排序公式 (relevance × frequency × impact × urgency)
- 阶段 3: 行动生成 (静默标记/检索资源/生成提问/请求协助)
- 阶段 4: 提问治理 (频率限制 + 静默时段 + 批量合并 + 冗余检查)

### 实现方案

**文件**: `src/analysis/curiosity-engine.ts` (新建) + 重构 `src/cognitive/gap-detector.ts`

#### 阶段 1: 缺口检测

扩展 GapDetector 的 detect()，增加三个检测维度:

```typescript
export class CuriosityEngine {
  // 维度 1: 未知术语 (transcript 中出现但 ProtoConcept 中未定义的术语)
  detectUnknownTerms(transcript: string, knownConcepts: ProtoConcept[]): KnowledgeGap[];
  
  // 维度 2: 反复纠正模式 (同一 what 被纠正 3+ 次)
  detectRepeatedCorrections(corrections: Correction[]): KnowledgeGap[];
  
  // 维度 3: 长期不增长技能 (proficiency < 0.3 + 30 天无变化 + ≥ 5 sessions)
  detectStagnantSkills(profile: MetacognitiveProfile): KnowledgeGap[];
  
  // 维度 4: 原有的 low selfRating 检测 (复用)
  detectLowProficiency(profile: MetacognitiveProfile): KnowledgeGap[];
}
```

#### 阶段 2: 优先级排序

```
priority = relevance × 0.35 + frequency × 0.25 + impact × 0.25 + urgency × 0.15
```

- relevance: 缺口与当前 TaskContext 的相关度 (0-1)
- frequency: 缺口在过去 N 个 session 中出现的频率
- impact: 缺口对任务成功率的影响估计
- urgency: 缺口是否需要立即处理 (blocking→1.0, nice-to-have→0.1)

#### 阶段 3: 行动生成

```
priority < 0.3 → SILENT_MARK (静默标记，等待自然填充)
priority 0.3-0.6 → FETCH_RESOURCES (下次相关任务时检索外部资源)
priority 0.6-0.8 → DRAFT_QUESTION (生成提问草稿，等待合适时机)
priority > 0.8 → REQUEST_HELP (立即请求用户协助)
```

#### 阶段 4: 提问治理

```typescript
interface QuestionGovernance {
  maxQuestionsPerDay: number;       // 默认 3
  quietHours: string;               // "22:00-07:00"
  minIntervalBetweenQuestions: number; // 分钟
  batchMergeWindow: number;         // 分钟内合并相似问题
  redundancyCheck: boolean;         // 检查是否已有类似提问
}
```

### 集成

在 `agent_end` 和 `session_end` 时触发 Curiosity Engine，不依赖 Hook 触发。

### 验证

- [ ] 连续 3 个 session 遇到同一未知术语 → 自动标记 KnowledgeGap
- [ ] Mock 场景: relevance=1.0, frequency=0.8, impact=0.9, urgency=0.7 → priority > 0.8 → REQUEST_HELP
- [ ] 静默时段 (22:00-07:00) 内 priority=0.9 → 延迟到 07:00 后
- [ ] 同一问题 5 分钟内重复 → 批量合并

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/analysis/curiosity-engine.ts` | **新建** | 完整 4 阶段引擎 |
| `src/analysis/curiosity-engine.test.ts` | **新建** | 4 阶段测试 |
| `src/cognitive/gap-detector.ts` | **重构** | 提取低自评检测逻辑供 CuriosityEngine 复用 |
| `src/session-end.ts` | **改造** | agent_end 触发 CuriosityEngine |
| `src/orchestrator.ts` | **改造** | agent_end event 增加 curiosity 触发 |

---

## M4.6: 退役与亚存在 `[P2]`

**目标**: 被取代的结构不删除，进入"亚存在"状态——保留映射关系和关键教训，可重新激活。

### 架构要求

- 退役结构标记 `superseded_by` (指向新结构 ID)
- 保留 `key_lessons` (被取代的原因和经验)
- 定义 `reactivation_conditions` (什么情况下重新激活)
- `/praxis ontology` 中可见"亚存在结构"列表

### 全新模块: `src/analysis/structure-retirement.ts`

```typescript
export interface RetiredStructure {
  originalId: string;
  supersededBy: string[];
  retiredAt: number;
  keyLessons: string[];
  reactivationConditions: {
    newStructureConfidenceFallsBelow: number;
    oldScenarioReappears: boolean;
    manualReactivation: boolean;
  };
  originalVersionChain: VersionSnapshot[];
}

export class StructureRetirement {
  // 退役一个结构
  retire(structure: ProtoStructure, supersededBy: string[], lessons: string[]): RetiredStructure;
  
  // 检查是否需要重新激活
  checkReactivation(retired: RetiredStructure, currentContext: ReactivationContext): boolean;
  
  // 重新激活
  reactivate(retired: RetiredStructure): ProtoStructure;
}
```

### 集成

`structure-lifecycle.ts` 的 TRANSITIONS 已有 `crystallized→deprecated` 和 `deprecated→experimental` 路径。M4.6 **不修改 TRANSITIONS**。

- `StructureRetirement.retire()`: 写入 RetiredStructure 元数据到 AgentMemory slot `retired_structures`，然后调用现有的 `transition(structure, "deprecate")`
- `StructureRetirement.reactivate()`: 从 slot 读取元数据，恢复结构，调用现有的 `transition(structure, "reactivate")`
- `/praxis ontology` (M3.5): 查询 `retired_structures` slot 显示亚存在结构

### 验证

- [ ] 结构 A 被 B 取代 → A 标记为 retired + 保留 superseded_by
- [ ] B 置信度跌破 0.3 → checkReactivation 返回 true
- [ ] 手动重新激活 → A 回到 experimental 状态
- [ ] `/praxis ontology` 正确列出亚存在结构

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/analysis/structure-retirement.ts` | **新建** | 退役/亚存在管理 |
| `src/analysis/structure-retirement.test.ts` | **新建** | 退役+重激活测试 |
| `src/structure-lifecycle.ts` | **改造** | 增加 deprecate/reactivate 路径 |

---

## 补充: 关系图传播完善

### 目标

`structure-graph.ts` 的 `fullPropagation()` 当前仅处理 depends_on/contradicts/specializes。

### 分阶段实现

**Phase 1 (M4.1 同步): 纯置信度传播** — `constrains` + `alternative_to`

```typescript
// constrains: B 违反 A 的约束 → B 降级
export function propagateConstrains(
  changedId: string, allStructures: Map<string, ProtoStructure>,
): Map<string, number>;

// alternative_to: B 置信度上升 → 替代结构 A 可降级
export function propagateAlternative(
  changedId: string, delta: number, allStructures: Map<string, ProtoStructure>,
): Map<string, number>;
```

**Phase 2 (M4.3.1 之后): 时序违规检测** — `precedes`

`propagatePrecedes` 不是置信度传播——是违规检测。放在 Phase 2，直接消费 statistical-verifier 的 per-step 匹配结果 (`matchDetails`)，避免重复实现工具序列匹配。

```typescript
// precedes: 消费 statistical-verifier.matchDetails 输出
export function propagatePrecedes(
  matchDetails: StepMatch[], allStructures: Map<string, ProtoStructure>,
): Map<string, number>;
```

**更新后的 fullPropagation** (Phase 1 — 5 种，Phase 2 加 precedes = 6 种):

```typescript
export function fullPropagation(
  changedId: string, delta: number,
  allStructures: Map<string, ProtoStructure>,
): Map<string, number> {
  addTo(propagateConfidence(changedId, delta, allStructures));      // depends_on
  addTo(propagateContradiction(changedId, delta, allStructures));   // contradicts
  addTo(propagateSpecialization(changedId, delta, allStructures));  // specializes
  addTo(propagateConstrains(changedId, allStructures));             // constrains (NEW)
  addTo(propagateAlternative(changedId, delta, allStructures));     // alternative_to (NEW)
  // Phase 2: addTo(propagatePrecedes(matchDetails, allStructures)); // precedes (Phase 2)
}
```

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/structure-graph.ts` | **改造** | Phase 1: constrains + alternative_to; Phase 2: precedes |
| `src/structure-graph.test.ts` | **扩展** | 5+1 种关系类型传播测试 |

---

## 实施顺序

```
Phase 1 (Week 1-2): M4.1 Governor 增强 + 补充 constrains/alternative_to 传播 + LearningLoop 合并
  ↓ 交付: 20 种 LearningEvent 分类 + gate 规则 + decide() async + Governor 为唯一管道

Phase 2 (Week 2-3): M4.2 ConfidenceFuser + prediction-protocol + M4.3 验证器并行开发
  ↓ 交付: 5 源融合 + statistical/role/concept 验证器 + precedes 传播

Phase 3 (Week 3-4): M4.4 奎因式门控 (仅 ProtoSequence + session≥10)
  ↓ 交付: necessity/sufficiency/parsimony 实现

Phase 4 (Week 4-5): M4.5 Curiosity Engine
  ↓ 交付: 4 阶段主动缺口检测

Phase 5 (Week 5-6): M4.6 退役与亚存在 (元数据存储 + 复用现有 TRANSITIONS) + 端到端集成测试
  ↓ 交付: 完整 M4 置信度系统
```

**并行机会**: M4.2 (Fuser + prediction-protocol) 和 M4.3 (Verifiers) 可完全并行——Fuser 定义接口，Verifiers 实现接口。precedes 传播在 Phase 2（消费 statistical-verifier.matchDetails）。

---

## M4 完成标准 (对齐 ROADMAP)

- [ ] Governor 正确处理 ≥ 5 种信号类型（15 种框架 + 至少 5 种活跃触发）
- [ ] 置信度融合至少 3 个信号源活跃
- [ ] statistical-verifier 独立判断与 LLM 标记一致性 ≥ 80%
- [ ] 奎因式门控至少成功阻止 1 个"僵尸结构"结晶化
- [ ] Curiosity Engine 正确检测和排序知识缺口
- [ ] 退役结构保留映射并可重新激活
- [ ] 每个新模块有独立测试文件
- [ ] `npm test` 全量通过
- [ ] `npm run typecheck` 无错误

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| statistical-verifier 准确率不达标 (< 70%) | 中 | 验收标准改为任务成败而非 LLM 一致性。先用 LLM 标记作为开发期校准参考；如果仍不达标 → 降级为辅助信号（权重从 0.28 降到 0.10） |
| concept-verifier LLM 调用成本高 / 假阳性率高 | 低 | 频次限制 + 仅对 0.4-0.7 置信度结构运行 + 批处理。权重已降至 0.05。若 false positive rate > 40% → M6 移除 |
| outcome_feedback + mid_session 依赖 M5 | 低 | M4 激活 5 个源 (statistical + llm_marker + user_correction + role_verifier + concept_verifier)。outcome_feedback + mid_session 在 M5 激活，框架 Slot 已预留 |
| Governor 重写引入回归 | 低 | 保留现有测试，逐个 stage 替换（非大爆炸重写） |
| Curiosity Engine 提问骚扰用户 | 中 | 治理层默认严格（max 3/day + 静默时段），用户可调 |

---

> **下一步**: 按 Phase 1 顺序启动 M4.1 Governor 增强。所有开发以架构文档 §4 和 §3 为唯一真理源。
>
> **架构参考**: [§4 学习引擎](../architech/praxis-architecture.md), [§3 认知结构系统](../architech/praxis-architecture.md), [ROADMAP M4](../docs/ROADMAP.md)

---

## GSTACK REVIEW REPORT

| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| Eng Review (Plan) | `/plan-eng-review` | 1 | CLEAR | 3 issues → resolved (directory, test, integration) |
| Codex Review (Plan) | `/codex exec` | 1 | CLEAR | 17 findings → all resolved |
| **Eng Review (Phase 1)** | `/plan-eng-review` | **2** | **CLEAR** | **0 new issues** |
| **Codex Review (Phase 1)** | `/codex exec` | **2** | **CLEAR** | **19 findings → all fixed** |

### Plan Review (pre-implementation)
**CODEX:** 17 substantive findings covering signal feasibility, type system, contradictions, dependencies, structural issues. All resolved in plan v1.0.

### Phase 1 Implementation Review (post-code)
**CODEX (19 findings, all fixed):**
- Critical (#1-#3): missing `await` in phase1a-bridge (shadow telemetry dead), fusedConfidence never passed (BATCH always DEFERs), Governor.llm never wired (LLM fine classify dead)
- High (#4-#6): propagateConstrains ignores delta sign, captureCorrection pollutes feedback store, dedup comment/behavior mismatch
- Medium (#7-#12): CoarseType missing "structure", inferCoarseTypeFromCorrection limited to 3/5 types, frequencyTracker keys on text not IDs, gate ordering, noise filter placement, duplicate type unions
- Low (#13-#19): IMMEDIATE ignores fusedConfidence, propagateAlternative edge case, dual ExecutionFeedbackCollector, async race on Maps, timing change, isNewKnowledge strict equality, breaking API change

**Fixes applied:** await in bridge, llmClient wiring through CognitiveCoreDeps, propagateConstrains delta-aware, captureCorrection gate on routeTo, gate reordering (noise→unknown→dedup→frequency), SignalType=LearningEventType unified.

**VERDICT:** ENG + CODEX CLEARED — Phase 1 (M4.1 Governor) + Phase 2 (M4.2 Fusion + M4.3 Verifiers) ready. 719 tests pass, typecheck clean.

### Phase 2 Implementation Review (post-code)
**CODEX (14 findings, all fixed):**
- High: fusion redistribution math (equal→proportional), statistical-verifier missing positional constraint, role-verifier wrong default score, DAG cycle detection wiring
- Medium: markersToSignalSource incomplete, JSON parse fence stripping, dedup policy documentation
- All resolved. 719 tests, 0 failures.

NO UNRESOLVED DECISIONS
