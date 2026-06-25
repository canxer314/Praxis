# Praxis RoadMap

> 从 Feature List 认知系统到 World Model 认知引擎的演化路线图  
> 起点: v0.7.2.0 (V13 架构, Phase 3 实现中) | 2026-06-25  
> 架构设计: [praxis-architecture.md](../architech/praxis-architecture.md) (World Model 完整蓝图, §1-§13)  
> 核心张力: Feature List → World Model (架构文档 §1 header 显式命名)

---

## 〇、Why This RoadMap

Praxis V1-V13 建立了一个完整的认知架构概念——六层结构、多维能力模型、Proto-Cognitive Engine、任务编排状态机、主动驱动。但在迭代 13 个版本后，底层数据模型从 V1 起没有本质改变：**ProtoStructure 是原子化的概率标签**——独立实体 + 独立置信度。没有关系图，没有因果结构，没有约束传播。

所有已知缺口——置信度虚高、结构间无影响传播、LLM 只能在事后检测错误、范畴系统从未被审计——追溯到同一个根因：**当前数据模型是 Feature List，不是 World Model**。

这条路线图规划了从 Feature List 到 World Model 的四个阶段。每个阶段建立在上一阶段的基础上，每阶段有可验证的完成标准。

### 不可否认的约束

1. LLM 是概率引擎——任何依赖 LLM 做唯一判断源的环节最终会崩
2. Praxis 唯一的"执行"方式是 prompt 注入——不能执行代码、不能调用工具
3. 人类反馈稀缺且不可靠——明确纠正 < 10% 的交互
4. 上下文窗口有限且存在注意力衰减——注入的每个 token 都有机会成本

---

## 一、演化全貌

> 以下四个 Phase 的目标是实现架构文档 [§3 认知结构系统](../architech/praxis-architecture.md) 中定义的 ProtoStructure 完整能力。  
> 架构文档 §3 已经定义了关系图、双重性质、版本链、五重结晶化门控、亚存在退役——这些是**设计目标**。本路线图定义的是**实现的先后顺序**。

```
Phase I: 认知基础设施 (数据模型升级)
  I-A: ProtoStructure 关系图        [P0] ← 架构 §3 关系图 + 关系类型表
  I-B: 双重性质建模                 [P1] ← 架构 §3 结构面+功能面+teleological mapping
  I-C: 版本链                       [P1] ← 架构 §3 版本链 + 生命周期状态机
  I-D: 反事实检验                   [P2] ← 架构 §3 奎因式五重门控 (条件 3-5)

Phase II: 约束系统 (从检测到预防)
  II-A: 上下文约束注入               [P0] ← 架构 §7 Tier A/B/C + §10 before_tool_call
  II-B: before_tool_call 约束验证   [P1] ← 架构 §3 ProtoConstraint 类型 + §10
  II-C: 约束自动提取                 [P2] ← 架构 §4 统计验证器 + §8 范畴审计

Phase III: 自主学习闭环
  III-A: 注意力遥测驱动的结构审计    [P1] ← 架构 §7 注意力遥测 + §13 /praxis audit
  III-B: 跨 session 模式挖掘         [P1] ← 架构 §6 自主学习触发 + §10 cron_tick
  III-C: 主动澄清请求               [P2] ← 架构 §13 /praxis audit 报告

Phase IV: 元认知自治 [假设]
  IV-A: 范畴盲区检测                 [P3] ← 架构 §8 范畴审计 + 康德式诊断分叉
  IV-B: 新范畴提议                   [P3] ← 架构 §8 领域范畴同质性检查 + 三种铁律
  IV-C: 范畴合并/废弃               [P3] ← 架构 §8 范畴审计
```

---

## 二、Phase I: 认知基础设施（数据模型升级）

**解决什么**: ProtoStructure 从"原子化概率标签"升级为"结构化概率网络"。  
**为什么先做**: 后续所有能力（约束传播、反事实检验、范畴演化）都依赖结构间的关系图。

### I-A: ProtoStructure 关系图 `[P0]`

**是什么**: 在 ProtoStructure 之间增加显式的关系边。置信度变化可以沿依赖链传播。

**新增关系类型**:

| 关系 | 语义 | 传播规则 |
|------|------|---------|
| `depends_on` | A 的正确性依赖 B | B 置信度下降 Δ → A 下降 Δ × 依赖强度 |
| `contradicts` | A 和 B 不能同时为真 | A 上升 Δ → B 下降 Δ × 矛盾强度 |
| `specializes` | A 是 B 的子类型 | B 变化 Δ → A 变化 Δ × 特化因子 |
| `precedes` | A 必须在 B 之前发生（时序约束） | 违反时 → 降级两个结构 |
| `constrains` | A 对 B 施加约束 | B 违反约束 → 降级 B |
| `alternative_to` | A 和 B 是实现同一功能的不同方式 | B 置信度上升 → A 可降级（功能覆盖） |

**传播约束**:
- 传播深度上限: 3 跳（防止噪声震荡）
- 传播需加权: `dependency_strength` 由 LLM 初始估计 + 统计验证器校准
- 确定性逻辑执行——不调 LLM

**数据模型变更**:
```typescript
interface ProtoStructureV2 {
  // ... 现有字段保持不变
  relations: {
    target_id: string;
    relation_type: 'depends_on' | 'contradicts' | 'specializes' | 'precedes' | 'constrains' | 'alternative_to';
    strength: number;              // 0.0-1.0
    evidence: string[];            // 支持该关系存在的观察
    established_at: number;
    last_validated_at: number;
  }[];
  // 反向索引在加载时构建（不持久化）
}
```

**工程风险**: 引入依赖图后，单次置信度更新从 O(n) 变为 O(n+e)。需限制传播深度；建议初次实现只传播 1 跳，生产验证后扩展。

**验证标准**:
- 一个结构被用户纠正（置信度 -0.4）→ 直接依赖它的结构置信度同步下调
- 传播幅度与依赖强度成正比（单元测试可验证）
- 传播深度 > 3 跳时自动截断（避免远距离弱依赖噪声）

---

### I-B: 双重性质建模 `[P1]`

**是什么**: 将 ProtoStructure 拆分为结构面（发生了什么）和功能面（为什么这么做）。

**为什么必须在 I-A 后**: teleological mapping（结构→功能的对应关系）本身是 I-A 关系图中的 `constrains` 边变体。

**核心洞察**: 用户纠正步骤序列时，~30%+ 的情况是"结构变了但功能不变"（如"挂号窗口→自助挂号机"）。当前 Praxis 将此类纠正与"功能真的错了"同等处理（统一下调置信度），造成不必要的重新学习。

**数据模型扩展**:
```typescript
interface ProtoSequenceV2 extends ProtoStructureV2 {
  // 结构面: 可观察的行为序列
  structure: {
    steps: {
      position: number;
      action: string;
      agent: string;
      observed_duration?: string;
    }[];
    observed_timing: string;
  };
  
  // 功能面: 为什么每一步存在
  function: {
    purpose: string;              // 整个序列的意图
    precondition: string[];       // 进入条件
    postcondition: string[];      // 退出条件
    failure_modes: string[];      // 已知失败模式
  };
  
  // 结构→功能映射
  teleological_mapping: {
    step_index: number;
    contributes_to: string;       // 指向 function 中的条款
    criticality: 'essential' | 'supporting' | 'optional';
  }[];
}
```

**验证标准**:
- 用户纠正一个步骤 → 先检查功能是否改变:
  - 功能不变（替代实现）→ 只更新 teleological_mapping，结构置信度不受影响
  - 功能改变（真的错了）→ 按现有规则下调置信度
- 在 20 个测试 session 中，替代实现类纠正的处理与真错误纠正的处理有显著差异

---

### I-C: 版本链 `[P1]`

**是什么**: 每个 ProtoStructure 保留完整的时间切片序列，支持 diff/回滚/分支融合。

**为什么必须在 I-A 后**: 版本间的 change_rationale 需要引用关系图中的依赖结构。

**数据模型**:
```typescript
interface StructureVersionChain {
  structure_id: string;
  head_version: string;
  
  versions: {
    version_id: string;
    parent_version: string | null;
    merge_sources?: string[];
    created_at: number;
    created_by: 'user_correction' | 'auto_refinement' | 'crystallization' | 'degradation' | 'fusion';
    
    diff: {
      type: 'step_added' | 'step_removed' | 'step_reordered' | 'confidence_changed' | 'purpose_refined' | 'relation_changed';
      path: string;
      old_value: unknown;
      new_value: unknown;
    }[];
    
    rationale: string;
    evidence: string[];    // 支持该变更的观察
    
    performance: {
      prediction_accuracy: number;
      user_satisfaction: number;
      active_duration_days: number;
    };
  }[];
  
  // 回滚
  rollback_to(version_id: string): ProtoStructure;
  // 差异对比
  diff_versions(v1: string, v2: string): VersionDiff;
}
```

**实现 V5 的设计承诺**: "任何结构可回滚"——从 V5 起就写入了架构文档，但无工程实现。

**验证标准**:
- 用户问"我上次教你的 X 怎么又忘了"→ Praxis 可展示变更历史
- 回滚到旧版本后，所有依赖结构的置信度恢复为当时状态
- 分支融合后，保留两个分支的 diff 记录

---

### I-D: 反事实检验 `[P2]`

**是什么**: 结晶化条件增加"移除该结构后，预测准确率是否下降"的检验。

**当前问题**: 一个被观察 100 次但 LLM 从不使用的"僵尸结构"（置信度 0.85），按当前条件可以结晶化——尽管它对系统没有任何实际贡献。

**奎因式重构**: 
- 结构 S 应结晶化当且仅当:
  1. 如果不假设 S 存在，无法解释观察到的行为模式（必要性）
  2. 假设 S 存在后，预测成功率显著高于不假设（充分性）
  3. 没有更简单的替代结构能同等解释观察（奥卡姆剃刀）

**实现方案**（不依赖新 LLM 调用）:
- 利用 V8 统计验证器的预测日志
- Leave-one-out 分析: 对比"S 被注入的 session"和"S 未被注入的 session"的预测准确率
- 差值 < 某个阈值 → S 不配结晶化（不管置信度多高）

**验证标准**:
- 置信度 > 0.8 但 LLM 采纳率 < 20% 的结构 → 反事实检验失败 → 拒绝结晶化
- 置信度 > 0.8 且 LLM 采纳率 > 60% 的结构 → 反事实检验通过 → 可结晶化

---

## 三、Phase II: 约束系统（从检测到预防）

**解决什么**: 当前 Praxis 只能在 LLM 犯错后检测（事后），不能阻止 LLM 犯错（事前）。  
**前置条件**: Phase I-A 完成（约束的定义依赖关系图）。Phase II-A 可在 Phase I 期间并行开发。

### II-A: 上下文约束注入 `[P0]`

**是什么**: 在 session_start 时，将已结晶的 ProtoConstraint 作为 hard constraint 注入 system prompt。

**关键洞察**: LLM 在"不得违反"框架下的行为与"可以参考"框架下显著不同。这不是推测——是 prompt engineering 的实测结果。

**注入格式**:
```
⛔ CRITICAL CONSTRAINTS (不可违反):
1. 处方开具必须在诊断完成之后 [来源: 3次观察, 0/15次违规]
2. 数据库迁移操作前必须完成备份 [来源: 用户明确教导]

📋 推荐流程: 挂号→问诊→检查→开药
[如果约束与流程冲突，约束优先]
```

**与当前 session_start 注入的关系**: 在现有 Tier A/B/C 层级化注入之前插入约束层。约束层在 Critical 压力下仍然注入（~100 tokens，几乎无成本）。

**工程风险**: hard constraint 格式过度使用可能导致 LLM 过度保守（拒绝合理操作以避免违规）。需要:
- 每 session 最多注入 5 个约束
- A/B 测试约束/建议的最佳比例

**验证标准**:
- 约束注入后，违反已结晶约束的 LLM 行为减少 70%+
- 如果减少 < 30% → 约束格式无效，需要更强的约束机制（如 before_tool_call 拦截）

---

### II-B: before_tool_call 约束验证 `[P1]`

**是什么**: 在 `before_tool_call` hook 中检查即将执行的操作是否违反已结晶约束。

**实现**:
```typescript
// hooks/before-tool-call.ts 增强
async function validateConstraints(
  toolCall: ToolCall,
  activeConstraints: ProtoConstraint[],
  sessionHistory: ToolCall[]
): Promise<ConstraintDecision> {
  for (const constraint of activeConstraints) {
    const violation = constraint.check(toolCall, sessionHistory);
    if (violation) {
      return {
        allowed: false,
        constraint_id: constraint.id,
        reason: violation.description,
        severity: constraint.severity  // 'block' | 'confirm' | 'warn'
      };
    }
  }
  return { allowed: true };
}
```

**严重度分级**:
- `block`: 绝对禁止（如 "数据库迁移前必须备份"）
- `confirm`: 暂停等待用户确认（如 "发送邮件给全组前确认"）
- `warn`: 执行但记录警告（如 "推荐使用新 API，旧 API 已弃用"）

**验证标准**:
- `block` 级别约束被违反时 → hook 返回 `block`，LLM 收到拒绝理由
- `confirm` 级别约束被违反时 → hook 返回 `confirm`，用户看到确认请求
- 拦截延迟 < 10ms（纯规则匹配，不调 LLM）

---

### II-C: 约束自动提取 `[P2]`

**是什么**: 当 V8 统计验证器检测到"A 步骤在 B 步骤之前执行时，失败率显著更低"→ 自动生成 ProtoConstraint。

**触发条件**:
- 同一任务类型的 session 中，步骤顺序 X→Y 的成功率 > Y→X 的成功率，差值 > 30%
- 观察次数 >= 5
- 没有用户纠正过"必须先 Y 后 X"

**生成约束**:
```typescript
{
  constraint_type: 'sequence',
  description: '在数据库迁移前执行备份，失败率从 35% 降至 5%',
  severity: 'warn',          // 自动提取的约束默认为 warn
  confidence: 0.3,           // 低初始置信度
  source: 'auto_derived',
  derivation: {
    evidence_sessions: ['s1', 's2', 's3', 's4', 's5'],
    success_rate_ordered: 0.95,
    success_rate_unordered: 0.65,
  }
}
```

**为什么优先级低**: 自动提取的约束可靠性未知，需要 II-A/B 的基础设施来交叉验证。不宜在基础设施未验证时引入自动生成的约束进入拦截路径。

---

## 四、Phase III: 自主学习闭环

**解决什么**: 当前认知结构的维护依赖 session_end 的批量 LLM 分析。存在三个问题：(a) 分析质量依赖 transcript 完整性，(b) 修正延迟一个完整会话，(c) 不会主动识别结构衰退。

**前置条件**: Phase I-A 完成（需要关系图判断影响范围）。V9 的注意力遥测基础设施已有（`[STRUCTURE_USED: proto_id]` 标记）。

### III-A: 注意力遥测驱动的结构审计 `[P1]`

**是什么**: 利用 V9 已有的注意力遥测数据，主动审计结构的健康度。

**两类自动化操作**:

| 检测模式 | 条件 | 自动操作 | 用户可见 |
|---------|------|---------|---------|
| **僵尸结构** | confidence > 0.7 AND 最近 10 个相关 session 中采纳率 < 20% | 标记 `needs_review`, 降级置信度 10% | session_end 报告中列出 |
| **低估结构** | confidence < 0.4 AND 最近 10 个相关 session 中采纳率 > 60% | 标记 `confidence_suspect`, 提议重新评估 | session_end 报告中列出 |

**不自动执行的操作**（需人类确认）:
- 降级 > 20% → 需要用户审批
- 结晶化/退化 → 需要用户审批（保持 V5 铁律）

**验证标准**:
- 生产环境中检测到至少 1 个"僵尸结构"（置信度高但无人使用）
- 生产环境中检测到至少 1 个"低估结构"（被频繁使用但置信度低）
- 如果两者都没检测到 → 要么遥测数据不足，要么结构质量极高——都不算失败

---

### III-B: 跨 session 模式挖掘 `[P1]`

**是什么**: 通过 cron 定期任务（建议每周），对积累的 task_history 做模式挖掘。

**三类挖掘任务**:

1. **ProtoTask 自动更新**: 同 task_type 的多个项目积累 → 自动更新 ProtoTask 的阶段时长估计、陷阱命中率、置信度成长
2. **跨场景纠错模式**: 同一类用户纠正在不同场景中反复出现 → 检测可能的范畴盲区
3. **衰退检测**: 结构在 N 天内未被任何 session 引用 → 提议标记为 `inactive`

**为什么是 cron 而非实时**: 跨 session 模式挖掘需要 LLM 分析大量历史数据（单次 ~5K-10K tokens），不适合在 session_end 的 20s 预算内同步执行。

**验证标准**:
- ProtoTask 置信度随同类项目积累而成长（1 个项目: 0.2 → 3 个: 0.5 → 5 个: 0.65）
- 衰退检测能发现超过 60 天未被引用的结构

---

### III-C: 主动澄清请求 `[P2]`

**是什么**: 当 III-A/III-B 积累到阈值时，在 session 结束时主动提一个简洁的问题。

**触发阈值**:
- 累计 >= 3 个 "僵尸结构" 或 >= 3 个 "低估结构" 且滞留 > 7 天
- 仅在 Normal 压力下触发（Elevated 及以上跳过）
- 每周最多 1 次

**示例**:
```
session_end:
  "📊 本周认知审计: 3 个结构疑似过时（平均 8 个 session 未被使用），
   1 个结构可能被低估。查看详情: /praxis audit"
```

**为什么不是"主动提问"**: V3 设计了 Curiosity Engine 的主动提问能力，但在没有充足生产数据的情况下，主动提问的风险（打扰用户）大于收益。Phase III-C 使用"被动报告"替代"主动提问"——信息仍然传递给用户，但不打断工作流。

---

## 五、Phase IV: 元认知自治 [假设]

**解决什么**: 架构文档已定义了 5 种 ProtoStructure 类型（Sequence/Role/Concept/Purpose/Constraint）。但它们是 V6 定义的，从未被生产数据验证过是否足够。如果 Praxis 需要在不熟悉领域中运行，范畴系统本身可能需要演化。

**为什么是"假设"而非"计划"**: 这个阶段的价值依赖于 Phase I-III 完成后是否确实观察到范畴盲区。可能 5 种类型已经足够。标记为 [假设] 意味着我们承诺在 Phase III 完成后重新评估此阶段的必要性。

**前置条件**: Phase I-III 充分生产验证 + 充足的跨领域数据。

### IV-A: 范畴盲区检测 `[P3]`

**是什么**: Meta Layer 分析"被反复纠正但无法被现有 4 种类型捕获的模式"。

**检测信号**: 同一模式被纠正 >= 5 次，但始终未形成任何 ProtoStructure → 标记为 `category_blind_spot`。

### IV-B: 新范畴提议 `[P3]`

**是什么**: 盲区检测触发 → Meta Layer 提议一个新范畴类型（如 ProtoQuantity / ProtoRelation / ProtoAxiom），附带支持证据 → 等待人类审批。

### IV-C: 范畴合并/废弃 `[P3]`

**是什么**: 某种 ProtoStructure 类型的使用率长期趋近于 0 → Meta Layer 提议合并或废弃。

---

## 六、优先级汇总

| ID | 任务 | 优先级 | 依赖 | 预计周期 | 可并行 |
|----|------|--------|------|---------|--------|
| I-A | ProtoStructure 关系图 | **P0** | 无 | 3-4 周 | — |
| II-A | 上下文约束注入 | **P0** | 无（效果依赖 I-A） | 2-3 周 | 可与 I-A 并行 |
| I-B | 双重性质建模 | **P1** | I-A | 2-3 周 | — |
| I-C | 版本链 | **P1** | I-A | 2-3 周 | 可与 I-B 并行 |
| III-A | 遥测驱动结构审计 | **P1** | V9 遥测(已有) | 1-2 周 | 可与 I 并行 |
| III-B | 跨 session 模式挖掘 | **P1** | I-A | 2-3 周 | — |
| II-B | before_tool_call 约束验证 | **P1** | II-A | 1-2 周 | — |
| I-D | 反事实检验 | **P2** | I-A | 2-3 周 | — |
| II-C | 约束自动提取 | **P2** | I-A + II-A/B | 2-3 周 | — |
| III-C | 主动澄清报告 | **P2** | III-A/B | 1 周 | — |
| IV-A | 范畴盲区检测 | **P3** | I-III | 待评估 | — |
| IV-B | 新范畴提议 | **P3** | IV-A | 待评估 | — |
| IV-C | 范畴合并/废弃 | **P3** | IV-A | 待评估 | — |

**关键路径**: I-A → I-B/I-C → II-B → II-C → III-B → IV (约 16-20 周，含测试)

---

## 七、可验证预测

每条路线图决策附带可证伪的预测。如果预测被证伪，路线图应调整。

1. **如果 I-A（关系图）是正确的优先事项**: 生产环境中，当一个高置信度结构被用户推翻时，依赖它的结构应在后续 session 中表现出预测准确率下降。引入关系图后，关联结构在 3 个 session 内恢复准确率。

2. **如果 I-B（双重性质建模）有价值**: 用户纠正中，>= 25% 的步骤纠正属于"结构变但功能不变"。双重性质建模能将此类纠正的置信度不必要的下调减少 50%+。

3. **如果 II-A（约束注入）有效**: hard constraint 注入后，违反已结晶约束的行为减少 70%+。如果减少 < 30% → 需要更强的约束机制。

4. **如果 III-A（僵尸结构检测）有意义**: 生产数据中存在置信度 > 0.7 但采纳率 < 20% 的结构。如果不存在 → 结构审计的优先级可下调。

5. **如果 IV（范畴演化）不必要**: 在 Phase I-III 完成后，>= 95% 的用户纠正能被现有 5 种 ProtoStructure 类型处理。如果成立 → Phase IV 可以无限期推迟。

---

## 八、与当前实现的关系

当前代码库（`src/cognitive/`, v0.7.2.0）实现了架构文档定义的 ~20% 模块。此路线图中的 Phase I 直接修改 `src/cognitive/types.ts` 中的 ProtoStructure 接口——这是影响面最大的变更。架构文档 §11 定义了目标模块树（含 `adapters/` + `orchestration/` + `analysis/` + `hooks/` + `memory/` + `prompts/` + `types/` + `tests/`）。

| 路线图项 | 影响现有代码 | 新增文件 | 架构参考 |
|---------|------------|---------|---------|
| I-A 关系图 | `types.ts` (+relations 字段), `confidence-fuser.ts` (+传播逻辑) | `structure-graph.ts` | §3 关系图 |
| I-B 双重性质 | `types.ts` (+structure/function/teleological_mapping) | — | §3 双重性质 |
| I-C 版本链 | `types.ts` (+versions[]), session-end/agent-end (写版本) | `structure-version.ts` | §3 版本链 |
| I-D 反事实检验 | `confidence-fuser.ts` (+leave-one-out 对比) | `counterfactual.ts` | §3 结晶化条件 |
| II-A 约束注入 | `session-start.ts` (+约束注入段) | `constraint-injector.ts` | §7 Tier A/B/C, §10 |
| II-B 工具前验证 | `before-tool-call` 事件处理器 (+约束检查) | `constraint-validator.ts` | §3 ProtoConstraint, §10 |
| II-C 约束提取 | `statistical-verifier.ts` (+约束生成) | `constraint-extractor.ts` | §4 统计验证器 |
| III-A 结构审计 | `session-end.ts` (+遥测报告) | `structure-auditor.ts` | §7 注意力遥测, §13 |
| III-B 模式挖掘 | — | `pattern-miner.ts` (+cron 入口) | §6 自主学习触发 |
| — 适配器层 | `platform-adapter.ts` (改造) | `adapters/` 目录 (5 文件) | §1 三层拓扑, §10 |

---

## 九、不在此路线图中的事项

以下事项被明确排除或推迟，附原因:

- **多 Agent 协作中的认知同步优化** — 当前 SubagentManager 已支持基础同步（通过 AgentMemory slot）。深度优化需要先有生产数据。
- **端到端自主任务分解** — 当前由 plan-generator + ProtoTask 驱动。完全自主的任务分解需要 Phase III 的模式挖掘成熟后才有足够的数据基础。
- **多模态（图像/音频/视频）记忆** — V1 定义了多模态支持但工程上不可行。当前 LLM 的视觉能力受限于模型本身，Praxis 的存储不是瓶颈。
- **GUI 能力模型查看器** — V1 定义了但从未实现。信息密度远不如 `/praxis status` 的文本报告。在文本报告不满足需求之前不值得投资。
- **跨团队 Praxis 实例联邦学习** — 隐私和治理问题未解决。Phase IV 完成后重新评估。

---

> **下一迭代目标 (双轨并行)**:
> - **轨道 1 — 快速价值**: II-A 上下文约束注入 + III-A 注意力遥测。这两项不依赖 I-A，可在 3-4 周内交付用户可感知的价值（LLM 违规减少 + 僵尸结构可见）。同时积累生产数据来验证架构假设。
> - **轨道 2 — 深层基础**: I-A ProtoStructure 关系图。3-4 周。为 I-B/C/D 和 III-B 提供数据模型基础。
> - **设计参考**: 架构文档 §3（ProtoStructure 完整设计）、§7（上下文编排）、§9（数据模型）、§11（目标模块树）。
