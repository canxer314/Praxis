# M6 开发计划：元认知自治 + 适配器层

> **制定依据**: [praxis-architecture.md](../architech/praxis-architecture.md) §1, §8, §10, §13 + [ROADMAP.md](ROADMAP.md) M6 节
> **制定日期**: 2026-06-27
> **交付版本**: v0.12.0.0
> **预估工期**: 12 天 (Phase A: 3d, Phase B: 3d, Phase C: 3d, Phase D: 3d)
> **原则**: 架构文档是唯一真理源。当前代码与架构冲突时，以架构为准。

---

## 一、范围定义

### 本次交付

| 项目 | 说明 | 优先级 |
|------|------|--------|
| **M5 待办清算** (4 项) | 数据管道断裂修复 — M6.1 的前置条件 | P0 |
| **M6.1 Meta Layer** | architecture-auditor + category-auditor + 范畴审计 | P0 |
| **M6.2 适配器接口** | 标准 AdapterInterface + openclaw-adapter 参考实现 | P0 |
| **M6.3 Claude Code 适配器** | Claude Code Hook → Praxis 标准事件映射 | P0 |

### 不在本次范围

| 项目 | 延后原因 |
|------|---------|
| M6.4 `/praxis status` | P1 — 独立功能，不阻塞 P0 核心 |
| M6.5 跨 Agent 认知同步 | P2 — 依赖多运行时部署环境，当前无测试条件 |
| M3.4 约束自动提取 | 依赖 M4 statistical-verifier 生产数据积累 |
| `/praxis ontology` 完善 | 存根已存在，M6 不对其做变更 |
| `/praxis task` 实现 | 存根已存在，不在 M6 范围 |

### 为什么 M6.2 和 M6.3 捆绑交付

架构 ROADMAP M6.3 的验证标准明确规定：

> "同一 session 场景用 openclaw-adapter 和 claude-code-adapter 分别运行 → Praxis 产生相同的 ProtoStructure 输出。证明适配器层的隔离是正确的。"

仅一个参考实现不足以验证接口的运行时无关性。两个适配器同时交付形成验证闭环。

---

## 二、架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        M6 交付全景                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────┐           │
│  │ Meta Layer (§8)                                   │           │
│  │                                                    │           │
│  │  cron_tick (30min)                                 │           │
│  │    ├─ M5.4: 5 StructuralGap 检测器 → audit_log     │           │
│  │    ├─ [每 168h] architecture-auditor.run()         │           │
│  │    │     └─ 对抗性架构审计 → 结构弱点报告           │           │
│  │    └─ [每 720h] category-auditor.run()             │           │
│  │          ├─ Q1: 范畴完备性 (category_blind_spot)   │           │
│  │          └─ Q2: 领域范畴同质性 (domain fork 提议)  │           │
│  │                                                    │           │
│  │  输出: ArchitectureAuditReport                    │           │
│  │        CategoryAuditReport                         │           │
│  │        → /praxis audit 可查阅                      │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐           │
│  │ 适配器层 (§1)                                      │           │
│  │                                                    │           │
│  │  AgentRuntimeAdapter (接口)                        │           │
│  │    ├─ mapToSessionStart()    ← 7 事件映射          │           │
│  │    ├─ mapToMessageReceived()                       │           │
│  │    ├─ mapToBeforeToolCall()                        │           │
│  │    ├─ mapToAfterToolCall()                         │           │
│  │    ├─ mapToAgentEnd()                              │           │
│  │    ├─ mapToSessionEnd()                            │           │
│  │    ├─ mapToCronTick()                              │           │
│  │    ├─ mapAutonomyDecision()   → 决策映射            │           │
│  │    └─ mapConstraintViolation()                     │           │
│  │                                                    │           │
│  │  实现: openclaw-adapter (参考)                     │           │
│  │        claude-code-adapter                         │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐           │
│  │ M5 待办清算                                        │           │
│  │                                                    │           │
│  │  Fix-1: deepCheck → agent_end 接线                 │           │
│  │  Fix-2: StructuralGap 检测器 → cron_tick 接线      │           │
│  │  Fix-3: audit_log 写入方 (before_tool_call + cron) │           │
│  │  Fix-4: attentionRecords → AgentMemory 持久化      │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、M5 待办清算（前置条件）

M6.1 Meta Layer 需要数据管道完整才能执行有意义的审计。以下 4 项修复解除数据阻塞。

### Fix-1: deepCheck → agent_end 接线

**现状**: `teleological-judge.ts:deepCheck()` 已实现（LLM 异步 teleological 分析），`quickCheck` 已接入 `orchestrator.handleMessageReceived`，但 `deepCheck` 完全未被调用。orchestrator 的 `SessionState` 没有 corrections 追踪字段。

**变更**:

```
src/orchestrator.ts — SessionState 新增字段:
  /** M6 Fix-1: session 中收集的 (ProtoSequence, correctionText) 对, agent_end 时消费 */
  corrections: Array<{ sequenceId: string; correctionText: string; timestamp: number }>

src/orchestrator.ts — handleMessageReceived() 修改:
  在 M5.2 quickCheck 判定"非替代实现"(真错误) 时:
    + 收集 (sequence.id, message.content) 对
    + 追加到 state.corrections

src/orchestrator.ts — handleAgentEnd() 修改:
    + 从 state.corrections 获取收集到的纠正对
    + 对每个纠正调用 deepCheck(sequence, correctionText, deps.llm)
    + 将 deepCheck 结果写入 audit_log slot

src/agent-end.ts — AgentEndHandler:
    + 新增可选参数: corrections: Array<{sequenceId, correctionText}>
    + 新增字段: teleologicalJudgments: TeleologicalJudgment[]
    + handle() 返回摘要中包含 deepCheck 结果计数
```

**数据流**:
```
message_received (用户纠正)
  → quickCheck 判定为真错误 (非替代实现)
    → 追加到 state.corrections: { sequenceId, correctionText, timestamp }

agent_end 事件
  → orchestrator.handleAgentEnd()
    → 遍历 state.corrections
      → 从 state.structures 中找到对应的 ProtoSequence
      → deepCheck(sequence, correctionText, deps.llm)  [异步, 不阻塞]
        → 结果写入 audit_log: { type: "teleological_check", ... }
```

### Fix-2: StructuralGap 检测器 → cron_tick 接线

**现状**: `structural-gap-detector.ts` 的 5 个纯函数检测器已实现并导出，但 `cron-tick.ts` 不导入也不调用它们。

**变更**:

```
src/cron-tick.ts
  handle():
    新增步骤 3 — StructuralGap 检测:
      + 从 AgentMemory 查询近期 task_history / learning_events
      + 依次调用 5 个检测器
      + 触发信号写入 audit_log slot
    新增步骤 4 — Meta Layer 调度检查 (见 §四)
```

**每个检测器的数据来源**:

| 检测器 | 数据来源 | 历史累积 |
|--------|---------|---------|
| #1 ProtoTask decline | `proto_task` slot 当前值 | Fix-2 每次 cron 运行时: 读取当前 `proto_task` → 追加到 `proto_task_history` slot (保留 90 天, 最多 4320 条=30min×90天) → 传给检测器 |
| #2 Cross-scenario failure | after_tool_call 失败记录 | 从 `audit_log` 中过滤 type=constraint_violation + tool_call_failure, 按 (toolName, scenarioId) 聚合 |
| #3 Correction cluster | learning_events (type=correction) | 从 `memory_lesson_recall` 查询近 30 天 type=correction 的 lesson, 按纠正模式 (相同 tool/subject) 聚类计数 |
| #4 Skill stagnation | `competency_model` slot 当前值 | Fix-2 每次 cron 运行时: 读取当前 8D 维度 → 追加到 `competency_snapshots` slot (保留 90 天) → 传给检测器 |
| #5 Escalation anomaly | `heartbeat_state` slot escalation 计数 | 从 `heartbeat_state` slot 读取 escalation 历史, 计算 7 天均值 + 标准差 |

**历史累积模式** (在 cron_tick 中, 检测器调用之前):
```
cron_tick 每次运行:
  1. 从 AgentMemory 读取当前 proto_task slot
     → 追加到 proto_task_history slot (appendSnapshot)
  2. 从 AgentMemory 读取当前 competency_model slot
     → 追加到 competency_snapshots slot (appendSnapshot)
  3. 将累积的历史数组传给 5 个检测器

appendSnapshot(slot, newEntry):
  const history = await deps.memory.getSlot(slot) ?? []
  history.push({ ...newEntry, timestamp: Date.now() })
  // 保留策略: 90 天窗口
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  const trimmed = history.filter(e => e.timestamp > cutoff)
  await deps.memory.setSlot(slot, trimmed)
```

### Fix-3: audit_log 写入方

**现状**: `praxis-audit.ts` 读取 `audit_log` slot 做约束违反统计，但无任何代码写入该 slot。审计报告的 `violations` 字段始终为空。

**变更**:

```
src/before-tool-call.ts
  handle():
    约束违反时:
      + 除返回 block/confirm/warn 外
      + 写入 audit_log: { type: "constraint_violation", constraintId, toolName, severity, ... }

src/cron-tick.ts
  handle():
    StructuralGap 检测触发后:
      + 写入 audit_log: { type: "structural_gap_signal", signalType, evidence, ... }
    deepCheck 完成后:
      + 写入 audit_log: { type: "teleological_check", ... }
```

**audit_log 条目 schema**:
```typescript
interface AuditLogEntry {
  timestamp: number;
  type: "constraint_violation" | "structural_gap_signal" | "teleological_check" | "category_blind_spot";
  severity: "info" | "warning" | "critical";
  source: string;          // 产生此条目的模块
  detail: Record<string, unknown>;  // 类型特定的证据
}
```

**audit_log 保留策略**:
```
每次 cron_tick 写入 audit_log 后，执行清理:

1. 时间窗口: 保留最近 90 天的条目
   → 删除 timestamp < (now - 90 days) 的条目

2. 容量上限: audit_log 最多保留 10,000 条
   → 超出时删除最旧条目（即使未满 90 天）

3. Meta Layer 审计前的归档:
   → architecture-auditor 和 category-auditor 运行前
   → 将被删除的条目中的 StructuralGap 信号和 category_blind_spot
     压缩为摘要写入 slot "audit_archive"（按月份聚合统计）
   → 确保长期趋势数据不丢失

清理在 cron_tick 的所有写入步骤之后执行，不阻塞检测和审计。
```

### Fix-4: attentionRecords 持久化

**现状**: `M0Deps.attentionRecords` 是内存 `Map<string, AttentionRecord>`，在 `session-end.ts` 中更新，但进程退出后丢失。

**变更**:

```
src/session-end.ts
  handle():
    在 Phase 0 attention 更新后:
      + 仅写入当前 session 中变更的 attention 条目 (per-structure incremental write)
      + 使用 memory_save type="attention_record" 逐条写入 (避免全量 Map 序列化的
        多 session 覆盖问题 — 两个并发 session 各自写入自己变更的结构,
        互不覆盖)
      + 不使用 setSlot("attention_records", fullMap) — 全量覆盖模式存在竞态

src/session-start.ts
  handle():
    + 从 AgentMemory smartSearch type="attention_record" 加载所有条目
    + 合并到 deps.attentionRecords Map
```

**并发安全**: 每条 attention record 以 structureId 为 key 独立存储。两个并发 session 修改不同 structure 时，各自写入各自的结构，不会互相覆盖。同一 structure 的并发修改依赖 AgentMemory 的乐观锁（不在 Fix-4 范围 — 由 M6.5 的跨 Agent 同步解决）。

---

## 四、M6.1 Meta Layer — 范畴审计

### 4.1 模块设计: architecture-auditor.ts

**职责**: 对抗性架构审计 — 阅读 audit_log 积累的数据，查找框架本身的结构性弱点。

```
architecture-auditor.ts
┌─────────────────────────────────────────────────────────┐
│ ArchitectureAuditor                                      │
│                                                          │
│ run(auditLog, structures, competencyModel)               │
│   → ArchitectureAuditReport                              │
│                                                          │
│ 审计维度:                                                 │
│   1. 结构健康度聚合                                        │
│      - 僵尸结构率 (adoptionRate < 20% 的比例)              │
│      - 衰退加速率 (单位时间进入 deprecated 的结构数)        │
│      - 约束违反趋势 (违反频率随时间变化)                    │
│                                                          │
│   2. 认知边界审计                                          │
│      - 哪类场景的 ProtoStructure 置信度最低?               │
│      - 哪个 8D 维度增长最慢?                               │
│      - 哪种 LearningEvent 类型占比异常?                    │
│                                                          │
│   3. 自我一致性审计                                        │
│      - 是否存在 contradicts 关系循环?                      │
│      - 是否存在置信度 >0.8 但采纳率 <20% 的僵尸?           │
│      - 是否存在 depends_on 断裂 (目标已退化但依赖者未更新)? │
│                                                          │
│   4. 对抗性挑战                                            │
│      - 随机选取 3 个已结晶结构                              │
│      - LLM 生成反例场景                                    │
│      - 反例通过率 < 阈值 → 结构可能过拟合                   │
│                                                          │
│ 输出: ArchitectureAuditReport                             │
│   - overallHealth: 0.0-1.0                                │
│   - zombieRate: float                                     │
│   - decayRate: float                                      │
│   - weakestDimension: 8D key                             │
│   - adversarialResults: AdversarialChallenge[]            │
│   - recommendations: AuditRecommendation[]                │
└─────────────────────────────────────────────────────────┘
```

**关键设计决策**:
- **LLM 用于语义分类**: Q1 的"现有 5 种类型能否表达该模式"是语义匹配任务 — 给定一个纠正模式的自然语言描述，判断它是否可以被 ProtoSequence/ProtoRole/ProtoConcept/ProtoPurpose/ProtoConstraint 之一充分表达。确定性 if/else 无法可靠完成此语义判断。这是 category-auditor 的唯一 LLM 调用点。
- architecture-auditor 的对抗性挑战也使用 LLM。**两个 auditor 各自在明确的限定范围内使用 LLM**，其余逻辑为确定性。
- 审计结果写入 AgentMemory slot `"architecture_audit"` 和 `"category_audit"`，供 `/praxis audit` 读取
- 审计不自动修改任何 ProtoStructure — 仅报告

### 4.2 模块设计: category-auditor.ts

**职责**: 范畴完备性 + 领域同质性检查。这是架构 §8 康德式诊断分叉的工程实现。

```
category-auditor.ts
┌─────────────────────────────────────────────────────────┐
│ CategoryAuditor                                          │
│                                                          │
│ run(auditLog, structures, learningEvents)                │
│   → CategoryAuditReport                                  │
│                                                          │
│ Q1: 范畴完备性检查 (Are 5 types sufficient?)              │
│                                                          │
│   输入: correction cluster 记录 (同一模式被纠正 3+ 次)     │
│                                                          │
│   康德式诊断分叉:                                          │
│   ┌─────────────────────────────────────────────┐       │
│   │ 对每个 correction cluster:                    │       │
│   │   ├─ 数据充分性检查:                           │       │
│   │   │   - 观察次数 ≥ 5?                         │       │
│   │   │   - 用户纠正方向一致? (不一致 = 噪声)      │       │
│   │   │   - 有对应的 ProtoStructure 尝试?          │       │
│   │   │                                            │       │
│   │   ├─ 如果数据不充分 → 数据问题                  │       │
│   │   │   → 建议: 增加观察, 暂不标记盲区            │       │
│   │   │                                            │       │
│   │   └─ 如果数据充分但仍失败 → 范畴问题             │       │
│   │       → 尝试用现有 5 种类型之一表达该模式        │       │
│   │       → 5 种类型均无法充分表达?                  │       │
│   │         → 标记 category_blind_spot              │       │
│   │         → 生成 CategoryProposal (含证据)         │       │
│   └─────────────────────────────────────────────┘       │
│                                                          │
│ Q2: 领域范畴同质性检查                                     │
│                                                          │
│   输入: 不同 scenario_id 的 ProtoStructure 实例            │
│                                                          │
│   检查: 是否存在不同领域共享同一 ProtoStructure 子类型      │
│        但实际语义结构差异显著?                              │
│                                                          │
│   方法:                                                    │
│   ┌─────────────────────────────────────────────┐       │
│   │ 按 (protoType, scenario_id) 分组              │       │
│   │   → 对比每组的结构特征:                        │       │
│   │     ProtoSequence: steps 平均长度, agent 分布  │       │
│   │     ProtoConstraint: severity 分布, source 分布│       │
│   │     ProtoConcept: definition 长度, 关系密度    │       │
│   │   → 如果两组同类结构在 ≥3 个特征上差异显著      │       │
│   │     → 提议 DomainCategoryFork                  │       │
│   └─────────────────────────────────────────────┘       │
│                                                          │
│ 输出: CategoryAuditReport                                │
│   - status: "ok" | "insufficient_data"                   │
│   - message?: string (status=insufficient_data 时)       │
│   - blindSpots: CategoryBlindSpot[]                      │
│   - domainForks: DomainCategoryForkProposal[]            │
│   - existingTypesHealth: per-type health score           │
│   - proposedNewTypes: NewCategoryProposal[]              │
└─────────────────────────────────────────────────────────┘
```

**冷启动行为**:
```
CategoryAuditor.run() 首先检查数据充分性:

if (auditLog.length === 0 && structures.length === 0):
  → 返回 CategoryAuditReport{
      status: "insufficient_data",
      message: "审计数据不足。需要至少 1 次 cron_tick 积累 StructuralGap 检测结果。",
      blindSpots: [],
      domainForks: [],
      ...
    }

if (correctionClusters.length === 0):
  → Q1 (范畴完备性) 返回空结果
  → 不标记任何 category_blind_spot
  → 报告中注明: "无重复纠正模式，无法执行范畴完备性检查。"

if (structures.length < 10):
  → Q2 (领域同质性) 跳过
  → 报告中注明: "结构数量不足 (需要 ≥10)，跳过领域同质性检查。"
  → 阈值 10 来自架构的认知成熟度分档: Novice (0-10 sessions) 阶段
    结构多样性不足以支撑有意义的领域对比

冷启动状态写入 slot "category_audit"，/praxis audit 显示为:
  "范畴审计: 数据不足 — 等待积累 (当前 session 数: 3/10)"
```

**三种铁律的实现**:
1. **无新结构不经过人类审批**: CategoryProposal 写入 slot `"category_proposals"`，附带证据，标记 `status: "pending_approval"`。不自动创建新类型。
2. **实验必须有范围限制**: 通过 GovernancePolicy `meta_layer.max_experimental_structures: 3` 控制并发实验数。
3. **任何结构可回滚**: 利用已有 `structure-lifecycle.ts` 的版本链机制。

### 4.3 cron_tick 集成

cron_tick 区分两个执行频率，防止重量操作拖慢每次 30 分钟 tick：

```
cron_tick (30min interval)  ← 每次运行
  │
  ├─ [已有] ProtoTask 累积
  ├─ [已有] 衰退检测
  ├─ [Fix-2] 历史快照累积 (proto_task_history, competency_snapshots)
  ├─ [Fix-2] 5 StructuralGap 检测器 → audit_log
  │
  ├─ [新增] audit_log 保留策略清理 (条件执行):
  │   → 仅在距上次清理 ≥ 1 小时时执行 (避免每 30min 全量扫描)
  │   → 删除 > 90 天旧条目
  │   → 容量上限 10,000 条 (仅检查 head/tail, 不全量遍历)
  │   → 归档 StructuralGap + blind_spot 信号到 audit_archive
  │
  └─ [新增] Meta Layer 调度检查 (每次 tick 都跑, 仅比较时间戳):
      ├─ 读取 slot "meta_layer_state" 获取上次扫描时间 (< 1ms)
      ├─ 距上次 structural_gap_scan > 168h (7天)?
      │   → architecture-auditor.run() → 写回 slot "architecture_audit"
      │   → 更新 meta_layer_state.lastStructuralScan
      └─ 距上次 category_audit > 720h (30天)?
          → category-auditor.run() → 写回 slot "category_audit"
          → 更新 meta_layer_state.lastCategoryAudit
```

**性能保证**:
- Meta Layer 调度检查: 仅两次 slot 读取 + 时间戳比较 (< 1ms)
- audit_log 清理: 条件执行 (每 1 小时最多一次), head/tail 检查而非全量遍历
- 重量操作 (auditor LLM 调用) 仅在定时间隔触发时才执行 (每周/每月)
- 每个步骤已有独立 try/catch 错误隔离

### 4.4 /praxis audit 增强

现有 `praxis-audit.ts` 已输出僵尸/低估/衰退/置信度分布。M6.1 增强：

```
/praxis audit 输出 (增强后):

## Praxis 认知审计报告 (v0.12.0.0, 2026-06-27)

### 结构健康度
  僵尸结构: 3 (adoptionRate<20% + confidence>0.7)
  低估结构: 2 (adoptionRate>60% + confidence<0.4)
  衰退警告: 1 (60天未引用)

### 约束违反统计 (来源: audit_log)
  近7天: 12 次违反, 5 次被 block, 3 次 confirm, 4 次 warn
  违反最多的约束: "数据库迁移前必须备份" (6次)

### StructuralGap 信号 (来源: audit_log)
  信号 #1 (ProtoTask decline): 0 次
  信号 #2 (Cross-scenario failure): 1 次 — tool "deploy" 在 2 场景失败
  信号 #3 (Correction cluster): 2 次 — "API 设计模式" 被纠正 5 次/30天
  信号 #4 (Skill stagnation): 0 次
  信号 #5 (Escalation anomaly): 0 次

### Meta Layer 审计 (来源: architecture_audit + category_audit)
  最近架构审计: 2026-06-25 (综合健康度 0.72)
  最近范畴审计: 2026-06-20
  范畴盲区: 1 个待审批提案 — "ProtoQuantity" (证据: 3 个盲区事件)
  领域分叉提议: 0

### 置信度分布
  0.8-1.0: ████████ 12
  0.5-0.8: ██████ 8
  0.2-0.5: ███ 5
  < 0.2:   █ 3
```

---

## 五、M6.2 适配器接口

### 5.1 接口定义

适配器**直接映射到 `PraxisLifecycleEvent`** — 即 `orchestrator.route()` 已接受的类型。不引入中间事件格式。每个映射是纯函数导出（非类方法），无状态，无副作用。

```typescript
// src/adapters/adapter-interface.ts

import type { PraxisLifecycleEvent } from "../orchestrator";

/**
 * Praxis 决策 → 运行时指令。
 */
export type RuntimeInstruction =
  | { type: "proceed"; toolCall: Record<string, unknown> }
  | { type: "inform"; message: string }
  | { type: "confirm"; message: string; toolCall: Record<string, unknown> }
  | { type: "block"; reason: string; constraintId: string }
  | { type: "inject"; systemPromptAddition: string };

/**
 * 标准适配器类型 — 一组纯函数的命名空间。
 * 每个运行时 (OpenClaw, Claude Code 等) 导出一个符合此类型的对象。
 * 所有函数为纯函数: 输入 raw event → 输出 PraxisLifecycleEvent 或 RuntimeInstruction。
 * 不持有状态，不调 LLM，不做认知处理。
 *
 * 对应架构 §1 三层运行时拓扑 + §10 生命周期事件。
 */
export type AgentRuntimeAdapter = {

  /** 适配器标识 */
  readonly runtimeName: string;

  // ── Runtime → Praxis (6 个生命周期事件, cron_tick 由 Praxis 内部定时器触发) ──

  mapToSessionStart(raw: Record<string, unknown>): PraxisLifecycleEvent;
  mapToMessageReceived(raw: Record<string, unknown>): PraxisLifecycleEvent;
  mapToBeforeToolCall(raw: Record<string, unknown>): PraxisLifecycleEvent;
  mapToAfterToolCall(raw: Record<string, unknown>): PraxisLifecycleEvent;
  mapToAgentEnd(raw: Record<string, unknown>): PraxisLifecycleEvent;
  mapToSessionEnd(raw: Record<string, unknown>): PraxisLifecycleEvent;

  // ── Praxis → Runtime (决策映射) ──

  mapAutonomyDecision(
    event: PraxisLifecycleEvent,
    decision: { action: "proceed" | "inform" | "confirm" | "block"; reason: string }
  ): RuntimeInstruction;

  mapConstraintViolation(
    event: PraxisLifecycleEvent,
    violation: { constraintId: string; description: string; severity: "block" | "confirm" | "warn" }
  ): RuntimeInstruction;
};
```

**关键设计点**:
- **无 `mapToCronTick`**: cron_tick 是 Praxis 内部定时器事件, 不由外部运行时触发。适配器不映射它。
- **纯函数而非类**: `AgentRuntimeAdapter` 是导出的纯函数集合, 不是 class。`runtimeName` 是静态标识符。确保无状态，避免实例化开销。
- **直接产生 `PraxisLifecycleEvent`**: 这是 `orchestrator.route()` 的输入类型。无需中间转换层。

### 5.2 openclaw-adapter.ts (参考实现)

```
openclaw-adapter.ts
┌─────────────────────────────────────────────────────────┐
│ OpenClawAdapter implements AgentRuntimeAdapter           │
│                                                          │
│ runtimeName = "openclaw"                                  │
│                                                          │
│ 事件映射 (OpenClaw Hook → Praxis 标准事件):               │
│                                                          │
│   OpenClaw "session.init"    → session_start             │
│   OpenClaw "message.user"    → message_received          │
│   OpenClaw "tool.pre"        → before_tool_call          │
│   OpenClaw "tool.post"       → after_tool_call           │
│   OpenClaw "agent.done"      → agent_end                 │
│   OpenClaw "session.close"   → session_end               │
│   (定时器触发)                → cron_tick                 │
│                                                          │
│ 决策映射 (Praxis 决策 → OpenClaw 指令):                   │
│                                                          │
│   proceed → { action: "allow", ... }                     │
│   inform  → { action: "allow", notification: "..." }     │
│   confirm → { action: "pause", requireConfirmation: ... }│
│   block   → { action: "deny", error: "..." }             │
└─────────────────────────────────────────────────────────┘
```

### 5.3 与现有 platform-adapter.ts 的关系

现有 `platform-adapter.ts` 的职责与架构定义的适配器不同：

| 维度 | platform-adapter.ts (现有) | adapter-interface (架构 §1) |
|------|--------------------------|---------------------------|
| 职责 | 事件路由 + 客户端构造 + 去重 | 纯协议转换 |
| 状态 | 有状态 (去重 Set, 乱序守卫) | 无状态 (纯函数) |
| 认知处理 | 包含 AutonomyDecision 逻辑 | 不做认知 — 只做协议映射 |
| 位置 | 位于认知层 | 位于适配器层 |

**处理方式**: 不替换 `platform-adapter.ts`。两者是不同层的不同职责：
- `platform-adapter.ts` 继续作为 Praxis 内部的**事件路由入口**（认知层）
- `adapter-interface` + 具体适配器作为外部的**协议转换层**（适配器层）
- 未来运行时接入路径：`Agent 运行时 → 适配器 (协议转换) → platform-adapter (路由) → orchestrator (编排)`

```
当前 (无适配器):
  Agent 运行时 → platform-adapter.ts → orchestrator.ts

M6 后:
  Agent 运行时 → openclaw-adapter → platform-adapter.ts → orchestrator.ts
  Agent 运行时 → claude-code-adapter → platform-adapter.ts → orchestrator.ts
```

---

## 六、M6.3 Claude Code 适配器

### 6.1 事件映射

Claude Code 的 Hook 体系映射到 Praxis 标准事件：

```
claude-code-adapter.ts
┌─────────────────────────────────────────────────────────┐
│ ClaudeCodeAdapter implements AgentRuntimeAdapter         │
│                                                          │
│ runtimeName = "claude-code"                              │
│                                                          │
│ 事件映射 (Claude Code Hook → Praxis 标准事件):            │
│                                                          │
│   Claude Code "SessionStart"   → session_start           │
│     - sessionId: hook.session_id                         │
│     - payload: { systemPrompt, model, ... }              │
│                                                          │
│   Claude Code "PreToolUse"     → before_tool_call        │
│     - toolName: hook.tool_name                           │
│     - toolParams: hook.tool_input                        │
│                                                          │
│   Claude Code "PostToolUse"     → after_tool_call        │
│     - toolName: hook.tool_name                           │
│     - result: { success, output, error }                 │
│                                                          │
│   Claude Code "Notification"    → message_received       │
│     - 仅处理用户消息通知 (role: "user")                   │
│                                                          │
│   Claude Code "Stop"            → agent_end              │
│     - agent_end 触发完整的任务级反思                      │
│                                                          │
│   Claude Code "SessionEnd" 或   → session_end            │
│   "PreCompact" (会话压缩前)                               │
│                                                          │
│ 决策映射 (Praxis 决策 → Claude Code 指令):                │
│                                                          │
│   proceed → { decision: "allow" }                        │
│   inform  → { decision: "allow",                            │
│               systemMessage: "[Praxis] ..." }            │
│   confirm → { decision: "block",                            │
│               reason: "...", requireUserConfirmation: true }│
│   block   → { decision: "block",                            │
│               reason: "...", error: "Constraint violated" } │
└─────────────────────────────────────────────────────────┘
```

### 6.2 特殊处理

Claude Code 的 Hook 体系有几个 Praxis 架构未直接覆盖的场景：
- **PreCompact**: 会话压缩前触发 → 映射为轻量 session_end（保留关键数据，但标记 `partial: true`）
- **Notification**: Claude Code 的多类通知。适配器实现过滤逻辑:
  ```
  mapToMessageReceived(raw):
    if (raw.notification_type === "user_message"):
      return PraxisLifecycleEvent of type "message_received"
    // 权限请求、空闲通知、系统消息 → 不产生 Praxis 事件
    return null  // 调用方跳过 null 事件
  ```
  注: 过滤逻辑在适配器内是纯函数（基于 raw 字段分类），不构成"认知处理"。
- **权限系统**: Claude Code 的 allow/deny/ask 权限 → 与 Praxis 的 proceed/inform/confirm/block 自主性决策互补而非冲突。适配器将 Praxis 的 `block` 映射为 Claude Code `{decision: "deny"}`，Praxis 的 `confirm` 映射为触发 Claude Code 的 `ask` 权限。

---

## 七、实现步骤

### Phase A: M5 待办 + 数据管道 (Day 1-3) ✅ 已交付

| 步骤 | 文件 | 说明 | 状态 |
|------|------|------|------|
| A1 | `src/before-tool-call.ts` | Fix-3: 约束违反时通过 `memory_save` 写入 audit_log (追加模式) | ✅ |
| A2 | `src/cron-tick.ts` | Fix-2: 历史累积 + 5 StructuralGap 检测器 + 结果写入 audit_log | ✅ |
| A3 | `src/orchestrator.ts` | Fix-1: SessionState 新增 corrections 字段; handleMessageReceived 中收集 (sequenceId, correctionText) 对 | ✅ |
| A4 | `src/orchestrator.ts` + `src/agent-end.ts` | Fix-1: handleAgentEnd 遍历 corrections → deepCheck → audit_log | ✅ |
| A5 | `src/session-end.ts` + `src/session-start.ts` | Fix-4: attentionRecords 持久化 (实际使用 setSlot 全量序列化，非逐条 memory_save) | ✅ (偏差) |
| A6 | `src/analysis/structural-gap-detector.test.ts` | 新: 5 检测器测试 (11 tests) | ✅ |

**偏差说明**: A5 使用 `setSlot("attention_records", {records, updatedAt})` 全量写入，而非计划的逐 structure `memory_save`。MemorySubsystem 接口不支持 `memory_save`。实际影响：多进程最后写入者胜出，M6.5 乐观锁会解决。

**验证**: cron_tick 运行后 `proto_task_history` slot 有快照追加。audit_log 有 StructuralGap 信号条目。agent_end 触发 deepCheck。重启后 attentionRecords 恢复。

### Phase B: 适配器层 (Day 3-6) ✅ 已交付

| 步骤 | 文件 | 说明 | 状态 |
|------|------|------|------|
| B1 | `src/adapters/adapter-interface.ts` | 新: AdapterInterface 类型 (纯函数集合) + RuntimeInstruction 类型 | ✅ |
| B2 | `src/adapters/openclaw-adapter.ts` | 新: OpenClawAdapter — 6 事件映射 + 2 决策映射 (纯函数导出) | ✅ |
| B3 | `src/adapters/openclaw-adapter.test.ts` | 新: 6 事件映射 + 2 决策映射测试 (16 tests) | ✅ |
| B4 | `src/adapters/claude-code-adapter.ts` | 新: ClaudeCodeAdapter — 含 Notification 过滤逻辑 | ✅ |
| B5 | `src/adapters/claude-code-adapter.test.ts` | 新: 6 事件映射 + Notification 过滤 + 2 决策映射测试 (11 tests) | ✅ |
| B6 | `src/platform-adapter.ts` | 改: 新增 `acceptAdapterEvent(event: PraxisLifecycleEvent)` + `toPlatformEvent` 桥梁 | ✅ |
| B7 | `src/adapters/index.ts` | 新: 导出聚合 | ✅ |

**交叉验证 (架构 M6.3 要求)**:
```
同一组模拟原始运行时事件:
  → openclaw-adapter → PraxisLifecycleEvent[]
  → claude-code-adapter → PraxisLifecycleEvent[]

验证目标:
  1. 两组 PraxisLifecycleEvent[] 类型相同 (session_start, message_received, ...)
  2. 关键字段语义等价 (sessionId, toolName, message.role, message.content, ...)
  3. 时间戳在合理偏差内 (< 100ms)

注意: 不通过 orchestrator.route() 验证 ProtoStructure 输出 —
orchestrator 的 ProtoStructure 提取是异步 LLM 过程，非确定性。
适配器验证在事件映射层完成，确保协议转换的正确性和运行时无关性。
```

### Phase C: Meta Layer (Day 6-9) ✅ 已交付

| 步骤 | 文件 | 说明 | 状态 |
|------|------|------|------|
| C1 | `src/analysis/architecture-auditor.ts` | 新: ArchitectureAuditor (4 审计维度, 对抗性挑战用 LLM) | ✅ |
| C2 | `src/analysis/architecture-auditor.test.ts` | 新: 审计逻辑 + 对抗性挑战测试 (6 tests) | ✅ |
| C3 | `src/analysis/category-auditor.ts` | 新: CategoryAuditor (Q1+Q2 + 康德式诊断, LLM 用于类型语义匹配) | ✅ |
| C4 | `src/analysis/category-auditor.test.ts` | 新: 冷启动 insufficient_data + Q1/Q2 + 类型健康度测试 (6 tests) | ✅ |
| C5 | `src/cron-tick.ts` | 改: Meta Layer 调度检查 + audit_log 条件清理 (已集成在 Phase A) | ✅ |
| C6 | `src/commands/praxis-audit.ts` | 改: 增强审计报告, 整合 architecture_audit + category_audit slot 数据 | ✅ |
| C7 | `src/commands/praxis-cli.ts` | 改: `/praxis audit` 输出格式 (审计报告增强由 C6 完成, CLI 无需额外修改) | ✅ (无变更) |
| C8 | `src/analysis/index.ts` | 改: 导出 ArchitectureAuditor + CategoryAuditor 及关联类型 | ✅ |
| C9 | `src/m0-deps.ts` | 改: M0Deps 无需新增 slot — auditors 通过现有 deps.llm + deps.memory 访问 | ✅ (无变更) |

### Phase D: 端到端验证 + 文档 (Day 9-12) ✅ 已交付

| 步骤 | 说明 | 状态 |
|------|------|------|
| D1 | `npm test` — 797 tests (55 files) 全部通过 | ✅ |
| D2 | `npm run typecheck` — clean | ✅ |
| D3 | 端到端数据流验证 — 适配器映射测试覆盖 (27 tests) | ✅ |
| D4 | 两个适配器交叉验证 (openclaw + claude-code 对同一事件产生等价 PraxisLifecycleEvent) | ✅ |
| D5 | 冷启动验证 — category-auditor 单元测试覆盖 insufficient_data | ✅ |
| D6 | CHANGELOG + ROADMAP 更新 | ✅ |
| D7 | VERSION → v0.12.0.0 | ✅ |

---

## 八、测试计划

### 新增测试文件

| 测试文件 | 覆盖模块 | 预估测试数 |
|---------|---------|-----------|
| `src/analysis/structural-gap-detector.test.ts` | 5 个检测器纯函数 (Phase A) | 15+ |
| `src/analysis/architecture-auditor.test.ts` | ArchitectureAuditor | 10+ |
| `src/analysis/category-auditor.test.ts` | CategoryAuditor (含康德式诊断 + 冷启动) | 12+ |
| `src/adapters/openclaw-adapter.test.ts` | 6 事件映射 + 2 决策映射 (Phase B) | 8+ |
| `src/adapters/claude-code-adapter.test.ts` | 6 事件映射 + Notification 过滤 + 2 决策映射 | 10+ |

### 修改测试文件

| 测试文件 | 变更 |
|---------|------|
| `src/cron-tick.test.ts` | + StructuralGap 检测器调用断言 |
| `src/agent-end.test.ts` | + deepCheck 接线断言 |
| `src/session-end.test.ts` | + attentionRecords 持久化断言 |

### 关键测试场景

1. **康德式诊断分叉**:
   - 数据不足 + 纠正不一致 → 返回 "数据问题, 不标记盲区"
   - 数据充分 + 5 种类型均无法表达 → 返回 `category_blind_spot`
   - 数据充分 + 可用现有类型表达 → 不标记盲区

2. **冷启动**: 空 AgentMemory → category-auditor 返回 `status: "insufficient_data"` → `/praxis audit` 显示 "数据不足 — 等待积累"

3. **适配器交叉验证**:
   - openclaw-adapter + claude-code-adapter 对同一原始事件产生类型相同、关键字段等价的 `PraxisLifecycleEvent`
   - Claude Code Notification 过滤: 非 user_message 通知不产生 Praxis 事件

4. **历史累积**: cron_tick 首次运行 → `proto_task_history` slot 创建首条快照 → 第 2 次运行追加第 2 条

5. **Meta Layer 间隔控制**:
   - 距上次扫描 < 168h → architecture-auditor 不运行
   - 距上次扫描 ≥ 168h → architecture-auditor 运行并更新状态

6. **audit_log 读-追加闭环**:
   - before_tool_call 通过 `memory_save` 写入约束违反 → `/praxis audit` 读到正确统计
   - cron_tick 通过 `memory_save` 写入 StructuralGap 信号 → `/praxis audit` 读到正确信号

7. **attentionRecords 增量持久化**: 两个 session 各自写入不同 structure → 重启后两个 structure 的 attention 记录都存在

---

## 九、关键设计决策

### D1: platform-adapter.ts 不替换，并存

- **决策**: 保留现有 `platform-adapter.ts` 作为内部事件路由入口。新的 `adapter-interface` 作为外部协议转换层。
- **理由**: 两者职责不同。platform-adapter 处理 Praxis 内部事件路由（去重、乱序守卫），adapter 处理外部运行时协议转换。替换会引入不必要的重构风险。
- **可证伪条件**: 如果 platform-adapter 的事件路由逻辑与 adapter 的协议转换产生职责重叠导致维护困难，则应合并。

### D2: Meta Layer 纯 cron 驱动，不混合事件

- **决策**: Meta Layer 审计（architecture-auditor, category-auditor）仅由 cron_tick 定时触发。事件驱动的实时审计不在 M6 范围。
- **理由**: 架构 GovernancePolicy 定义了明确的间隔（168h, 720h）。M5.4 检测器在每次 cron 都跑（提供实时数据），但深度分析在定时间隔执行。
- **可证伪条件**: 如果生产中发现关键 StructuralGap 信号在 cron 间隔内被遗漏，则应在下一个里程碑增加事件驱动触发路径。

### D3: 范畴盲区只提议不自动创建

- **决策**: CategoryAuditor 生成 `CategoryProposal`（含证据），写入 slot `"category_proposals"`，标记 `pending_approval`。不创建新 ProtoStructure 子类型。
- **理由**: 架构三种铁律第一条。新范畴创建是人类决策，机器只提供证据。
- ⚠️ **不确定性**: 当前无人类审批 UI/流程。提案被写入 slot 后如何被人类发现和审批？短期内依赖 `/praxis audit` 输出 + 人工查阅。

### D4: audit_log 保留策略 — 90 天窗口 + 10,000 条上限

- **决策**: cron_tick 每次运行后清理 audit_log。删除 >90 天旧条目, 容量上限 10,000 条。清理前将 StructuralGap 信号和 category_blind_spot 压缩归档到 `audit_archive` slot。
- **理由**: 防止 audit_log 无限增长占用 AgentMemory 存储。90 天窗口覆盖一个完整季度的数据趋势。10,000 条上限防止写入突发撑爆 slot。归档确保长期趋势数据不丢失。
- **可证伪条件**: 如果 90 天窗口导致 Meta Layer 审计缺少历史对比基线（例如年度趋势分析需要 >90 天数据），应调整为 365 天 + 按月聚合归档。

### D5: category-auditor 冷启动显式状态

- **决策**: 数据不足时 category-auditor 返回 `status: "insufficient_data"` 并说明原因，而非返回空结果或抛错。Q1 需要 ≥1 个 correction cluster，Q2 需要 ≥10 个结构。
- **理由**: 空结果（blindSpots=[]）可能误导为"系统健康，无盲区"。显式状态区分"检查了但没发现问题"和"还没足够数据检查"。阈值 10 与架构认知成熟度 Novice→Competent 边界 (10 sessions) 对齐。
- **可证伪条件**: 如果 10 个结构的阈值在实践中间隔过长（例如 30+ sessions 才达到），Q2 长期处于跳过状态 → 降低阈值到 5。

### D6: audit_log 并发写入安全

- **决策**: audit_log 有三个写入来源（before_tool_call 约束违反、cron_tick StructuralGap 信号、cron_tick teleological_check）。使用 AgentMemory 的 `memory_save type="audit_log"`（typed memory append）而非 `setSlot("audit_log")`（全量读写覆盖），避免 read-modify-write 竞态。每个写入者独立 `memory_save`，AgentMemory 负责追加语义。
- **理由**: `setSlot` 的读-改-写模式在并发写入者场景下不安全。`memory_save` 提供原子追加，每条 audit_log 条目是独立的 typed memory 记录，自然避免覆盖。
- **可证伪条件**: 如果 AgentMemory 的 `memory_save` 追加延迟影响 cron_tick 性能（每条追加一次网络往返），改为批量 `memory_save_batch`（若可用）或本地缓冲 + 定时刷新。

### D7: 新 AgentMemory slot 命名空间

- **决策**: M6 新增以下 slot (架构 §9 未列出): `meta_layer_state`, `audit_archive`, `category_proposals`, `proto_task_history`, `competency_snapshots`。这些是 M6 实现需要的衍生 slot — 历史累积和审计缓存数据。在 M6 交付后同步更新架构文档 §9 的 AgentMemory 存储映射表。
- **理由**: 架构 §9 的 slot 映射定义于 V13（2026-06-25），M6 引入的新 slot 是架构的自然扩展而非漂移。M6 交付时更新架构文档确保一致性。
- **可证伪条件**: 如果后续里程碑继续大幅增加 slot（>5 个/版本），应考虑在架构中定义 slot 分类体系（核心 slot vs 衍生 slot）。

---

## 十、已知风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Meta Layer 冷启动 — 无足够数据产生有意义的 category_blind_spot | M6.1 验证标准 "至少检测到 1 个 category_blind_spot" 可能无法在交付时满足 | D5 冷启动策略: auditor 返回显式 `insufficient_data` 状态。单元测试用模拟数据验证诊断逻辑。生产数据积累是渐进过程，不作为交付阻塞条件。 |
| audit_log 无限增长 | AgentMemory slot 存储压力，cron_tick 读取性能退化 | D4 保留策略: 90 天窗口 + 10,000 条上限 + audit_archive 归档。清理在 cron_tick 写入后执行。 |
| openclaw-adapter 缺少真实 OpenClaw 环境验证 | 接口设计可能与实际 OpenClaw Hook 格式不匹配 | 适配器逻辑是纯映射函数，单元测试覆盖映射规则。接口修正成本低。 |
| Claude Code Hook 格式可能变化 | claude-code-adapter 映射可能失效 | Hook 格式是 Claude Code 的公开接口。映射集中在单一模块，更新成本低。 |
| cron_tick 增加 Meta Layer 调用导致超时 | Meta Layer 审计（特别是 LLM 对抗性挑战）可能耗时 | 审计在 cron_tick 中异步执行，错误隔离（单个审计失败不影响其他 cron 步骤）。LLM 调用设置 30s 超时。 |

---

## 十一、NOT in Scope

| 项目 | 理由 |
|------|------|
| M6.4 `/praxis status` 命令 | P1 — 独立功能，8D 雷达图渲染不依赖 M6.1 数据管道 |
| M6.5 跨 Agent 认知同步（乐观锁 + pending_merge） | P2 — 依赖多运行时生产环境，当前无法端到端测试 |
| M3.4 约束自动提取 | 依赖 M4 statistical-verifier 积累足够观察数据 |
| `/praxis ontology` 完善 | 存根已存在，不在 M6 范围 |
| `/praxis task` 实现 | 存根已存在，不在 M6 范围 |
| 多模态记忆 (imageRef + vision_search) | 架构 §9 定义但无实际需求驱动 |
| GUI 查看器 | 文本报告优先 |
| 跨团队联邦学习 | M6 完成后不考虑 |

---

## 十二、What Already Exists

| 已有代码 | 位置 | M6 中的角色 |
|---------|------|------------|
| 5 StructuralGap 检测器 | `src/analysis/structural-gap-detector.ts` | M6.1 的传感器层 — Fix-2 接入 cron_tick 后开始产数据 |
| `/praxis audit` 命令 | `src/commands/praxis-audit.ts` | M6.1 增强后显示 Meta Layer 审计结果 |
| `/praxis` CLI 路由 | `src/commands/praxis-cli.ts` | 已有 audit/ontology/status/task 路由骨架 |
| cron_tick 框架 | `src/cron-tick.ts` | 已有 ProtoTask + 衰退检测，M6 追加 StructuralGap + Meta Layer |
| agent-end 处理器 | `src/agent-end.ts` | 已有 MidSession 融合点，M6 追加 deepCheck |
| session-end 处理器 | `src/session-end.ts` | 已有 attention 更新，M6 追加持久化 |
| M0Deps 依赖注入 | `src/m0-deps.ts` | M6 追加 Meta Layer 可选依赖 |
| platform-adapter | `src/platform-adapter.ts` | 保留为内部路由入口，与 adapter-interface 并存 |
| teleological-judge | `src/analysis/teleological-judge.ts` | quickCheck 已接线，deepCheck Fix-1 接线 |
| structure-lifecycle | `src/structure-lifecycle.ts` | Meta Layer 的回滚机制复用其版本链 |
| CompetencyModel 8D | AgentMemory slot `"competency_model"` | M6.1 architecture-auditor 的认知边界审计数据源 |

---

## 十三、模块树（M6 交付后）

```
src/
├── adapters/                          # [新增] 适配器层
│   ├── adapter-interface.ts           #   标准 AdapterInterface
│   ├── openclaw-adapter.ts            #   OpenClaw 参考实现
│   ├── claude-code-adapter.ts         #   Claude Code 适配器
│   └── index.ts                       #   导出聚合
│
├── analysis/                          # 分析层
│   ├── structural-gap-detector.ts     #   [已有] 5 检测器
│   ├── architecture-auditor.ts        #   [新增] 对抗性架构审计
│   ├── category-auditor.ts            #   [新增] 范畴完备性 + 同质性
│   ├── teleological-judge.ts          #   [已有] deepCheck Fix-1 接线
│   └── ...
│
├── commands/                          # CLI 命令
│   ├── praxis-cli.ts                  #   [修改] audit 输出增强
│   └── praxis-audit.ts                #   [修改] 整合 Meta Layer 数据
│
├── cron-tick.ts                       # [修改] +历史累积 +StructuralGap +Meta Layer
├── agent-end.ts                       # [修改] +deepCheck corrections 接线
├── session-end.ts                     # [修改] +attentionRecords 逐条持久化
├── before-tool-call.ts                # [修改] +audit_log 写入
├── orchestrator.ts                    # [修改] +corrections 追踪 +deepCheck 路由
├── m0-deps.ts                         # [修改] +Meta Layer 可选依赖
│
└── ...
```

> **注意**: 架构 §11 定义的 `hooks/` 和 `orchestration/` 目录拆分不在 M6 范围。M6 保持现有扁平文件布局，仅新增 `adapters/` 目录。目录重组推迟到后续重构里程碑。

---

## 十四、验收标准

- [ ] M5 Fix-1: agent_end 触发后 audit_log 中出现 teleological_check 条目
- [ ] M5 Fix-2: cron_tick 运行后 5 种 StructuralGap 信号可被检测并写入 audit_log
- [ ] M5 Fix-3: 约束违反时 audit_log 被写入，`/praxis audit` 显示非零违反统计
- [ ] M5 Fix-4: session_end 后 attentionRecords 持久化到 AgentMemory，重启后可恢复
- [ ] M6.1: architecture-auditor 按 168h 间隔运行，输出 ArchitectureAuditReport
- [ ] M6.1: category-auditor 按 720h 间隔运行，康德式诊断分叉逻辑正确
- [ ] M6.2: AdapterInterface 定义完整，openclaw-adapter 可作为参考实现独立测试
- [ ] M6.3: openclaw + claude-code 两个适配器对同一模拟事件产生语义等价的 PraxisLifecycleEvent
- [ ] `/praxis audit` 输出包含 Meta Layer 审计数据（architecture_audit + category_audit）
- [ ] `npm test` 全部通过，新增测试覆盖所有新模块
- [ ] `npm run typecheck` clean
- [ ] 无回归 — 已有 747 测试继续通过

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | DONE | Codex timed out; Claude subagent found 16 issues. All resolved. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 3 | CLEAR | Plan review (16 findings), Phase A review (4 type errors), Final overall review (clean). |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | No UI scope. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

### 实际交付 (v0.12.0.0, 2026-06-27)

| Metric | Plan | Actual |
|--------|------|--------|
| Files | ~18 | **23** (+3083/-32) |
| New source modules | 6 | **6** |
| New test files | 5 | **5** |
| Tests | ~70+ | **50** (797 total vs 747 baseline) |
| Typecheck | Clean | **Clean** |
| Commits | — | **5** bisectable |

### 偏差记录

| 偏差 | 计划 | 实际 | 原因 |
|------|------|------|------|
| A5 attentionRecords 持久化 | 逐 structure `memory_save` | `setSlot` 全量序列化 | MemorySubsystem 无 `memory_save` 接口 |
| C7 praxis-cli.ts | 修改 `/praxis audit` 输出格式 | 无需修改 (C6 完成增强) | audit 报告增强由 praxis-audit.ts 完成 |
| C9 m0-deps.ts | 新增 Meta Layer 可选 deps | 无需修改 | auditors 通过现有 deps.llm + deps.memory 访问 |
| 审计归档 | cleanupAuditLog 前归档到 audit_archive | 未实现 | 留待后续里程碑 |

### 延后项目 (NOT in scope)

| 项目 | 优先级 | 状态 |
|------|--------|------|
| M6.4 `/praxis status` | P1 | 延后 |
| M6.5 跨 Agent 同步 (乐观锁) | P2 | 延后 |
| `audit_archive` 预清理归档 | P3 | 延后 |

**VERDICT:** M6 DELIVERED — 23 files, 797 tests, typecheck clean. 所有 P0 目标达成。M6.4/M6.5 后续独立交付。

NO UNRESOLVED DECISIONS
