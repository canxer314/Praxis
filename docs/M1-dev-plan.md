# M1 开发计划: 认知数据结构 (ProtoStructure)

> 目标: ProtoStructure 从概念变为代码——5 种类型、关系图、版本链、生命周期状态机  
> 周期: 4-6 周  
> 前置: M0 完成 (EventOrchestrator + M0Deps 已就绪)  
> 架构参考: [praxis-architecture.md](../architech/praxis-architecture.md) §3 (认知结构系统), §9 (数据模型)  
> 路线图参考: [ROADMAP.md](ROADMAP.md) M1 节

---

## 〇、Step 0: 现有代码审计

### 可直接复用

| 文件 | 原因 | 微调 |
|------|------|------|
| `platform-adapter.ts` | Result\<T\> 模式 | 无 |
| `m0-deps.ts` | M0Deps 已提供 memory/cache 子系统接口 | 可能需要增加 AgentMemory proto_structure 存取方法 |
| `agentmemory-client.ts` | REST API 客户端已有 save/smart_search | 新增 `saveProtoStructure()` / `searchProtoStructures()` |
| `orchestrator.ts` | EventOrchestrator 已能路由 session_end | 无 |
| `transcript-analyzer.ts` | 已有 transcript → learning events 的 LLM 分析链路 | M1.5 复用此链路提取 ProtoStructure |

### 需要大幅修改

| 文件 | 问题 | 重构方向 |
|------|------|---------|
| `types.ts` | 已有 V6 时代简化版 `ProtoStructure` 接口 (protoId/ scenarioId/ tentativeName/ protoType/ typicalTools/ typicalDomains/ confidence/ observationCount/ lifecycleStage) — 不含关系图/版本链/双重性质 | 完全重写为架构 §3+§9 定义的完整接口族 |
| `session-end.ts` | 当前只写 learning_events — 无 ProtoStructure 提取 | 增加 session_end → LLM 分析 → 提取 ProtoStructure 候选的逻辑 |

### M1 不需要 (后续里程碑)

`orchestrator.ts` 其余部分、`session-start.ts` ProtoStructure 注入段 (M1.6 仅做基本注入，M2 实现 Tier A/B/C)、`scene-recognizer.ts` (M2)、所有 analysis/ 下的文件。

### M1 新增文件

`structure-graph.ts`, `structure-lifecycle.ts`, `structure-version.ts`

---

## 一、架构决策

### A1: ProtoStructure 基础布局

架构 §9 定义的 ProtoStructure 基础字段:

```
ProtoStructure (抽象基础)
  id: string
  proto_type: "sequence" | "role" | "concept" | "purpose" | "constraint"
  tentative_name: string
  scenario_id: string
  confidence: 0.0-1.0
  observations_count: int
  adoption_rate: float
  lifecycle: hypothesized | candidate | experimental | crystallized | deprecated | rejected
  created_at: number
  updated_at: number

relations: [
  { target_id, type: RelationType, strength: 0.0-1.0,
    evidence: string[], established_at, last_validated_at }
]

version_chain: [
  { version_id, parent_version, merge_sources, created_at, created_by,
    diff: [{ type, path, old_value, new_value }],
    rationale, evidence, performance }
]
```

### A2: 五种子类型继承关系

使用 TypeScript 的 discriminated union / interface extension:

```
ProtoStructure (基础)
  ├─ ProtoSequence extends ProtoStructure
  │   proto_type: "sequence"
  │   structure: { steps: [...] }
  │   function: { purpose, precondition, postcondition, failure_modes }
  │   teleological_mapping: [...]  ← 双重性质
  ├─ ProtoRole extends ProtoStructure
  │   proto_type: "role"
  │   behaviors: string[]
  │   depends_on: string[]  (role IDs)
  ├─ ProtoConcept extends ProtoStructure
  │   proto_type: "concept"
  │   definition: string
  │   related_concepts: string[]
  ├─ ProtoPurpose extends ProtoStructure
  │   proto_type: "purpose"
  │   goal: string
  │   success_criteria: string[]
  └─ ProtoConstraint extends ProtoStructure
      proto_type: "constraint"
      severity: "block" | "confirm" | "warn"
      source: "user_taught" | "auto_derived"
```

### A3: 关系图与置信度传播

6 种关系类型，确定性传播逻辑，不调 LLM:

```
depends_on:    B↓Δ → A↓Δ×strength
contradicts:   A↑Δ → B↓Δ×strength
specializes:   BΔ → AΔ×factor
precedes:      违反 → 两者降级
constrains:    违反 → 被约束方降级
alternative_to: B↑ → A 可降级
```

传播深度 ≤ 3 跳。初次实现 1 跳。

### A4: 生命周期状态机

```
hypothesized → candidate → experimental → crystallized
                                          ↑        ↓
                                          └─ deprecated/rejected
```

结晶化条件 (五重门控, M4 才真正生效):
1. 置信度 > 0.8
2. 观察次数 ≥ 5
3. 必要性 (M4)
4. 充分性 (M4)
5. 奥卡姆剃刀 (M4)
6. 人类审批

M1 实现状态机框架 + 转换逻辑。条件 3-5 预留验证器接口。

---

## 二、逐步骤行动计划

### Step 1: ProtoStructure 类型系统 (Week 1-2)

**1.1 重写 `types.ts` 中的 ProtoStructure 接口族 `[P0]`**

删除 V6 时代简化版 ProtoStructure，替换为架构 §3+§9 的完整定义:
- `ProtoStructure` 基础接口 (id, proto_type, confidence, lifecycle 等)
- 5 个子类型: `ProtoSequence`, `ProtoRole`, `ProtoConcept`, `ProtoPurpose`, `ProtoConstraint`
- `Relation` 接口 (6 种关系类型 + strength + evidence)
- `VersionSnapshot` 接口 (version_id, parent_version, diff, rationale, evidence, performance)
- `LifecycleStage` 类型

**验证**: 每种类型创建一个实例 → `ProtoSequence` 包含 structure/function/teleological_mapping 完整字段 → TypeScript 类型检查通过

**1.2 实现 `structure-graph.ts` — 关系图 + 置信度传播 `[P0]`**

纯函数模块:
- `addRelation(from, to, type, strength)` → 建立关系边
- `removeRelation(from, to)` → 删除边
- `propagateConfidence(structureId, delta, allStructures)` → 沿 `depends_on` 边传播 Δ (BFS, ≤3 跳)
- `findCycles(graph)` → 检测循环依赖 (DFS, 环检测)


**验证**: A depends_on B (strength 0.8) → B 置信度 -0.4 → A 置信度 -0.32。循环检测拒绝 A→B→C→A。

**1.3 实现 `structure-lifecycle.ts` — 生命周期状态机 `[P1]`**

纯函数模块:
- `transition(structure, event)` → 新的 lifecycle 状态
- `canCrystallize(structure)` → 检查条件 1+2 (置信度 > 0.8 AND 观察 ≥ 5)
- `canDegrade(structure)` → 检查条件 (≥3 个反例 OR conf < 0.2 + 60 天)
- 条件 3-5 预留接口: `needsVerifier?: boolean`

**验证**: hypothesized → candidate → experimental → crystallized → deprecated → rejected 全链路

### Step 2: 版本链 (Week 3)

**2.1 实现 `structure-version.ts` `[P1]`**

- `createVersion(structure, changeType, diff, rationale)` → 新版本快照
- `rollback(structure, targetVersionId)` → 恢复到指定版本
- `diffVersions(v1, v2)` → 两个版本的结构化差异

**验证**: 修改 3 次 → 3 个版本 → rollback 到 v1 → 恢复 v1 状态

### Step 3: ProtoStructure 存储与基本注入 (Week 3-4)

**3.1 AgentMemory 存取 `[P0]`**

在 `agentmemory-client.ts` 中新增:
- `saveProtoStructure(structure)` → `memory_save type="proto_structure"`
- `searchProtoStructures(query, scenarioId?)` → `memory_smart_search`

**验证**: 创建 5 个 ProtoStructure(不同 scenario) → 按 scenario_id 检索 → 返回 2 个匹配

**3.2 session_start 基本注入 `[P0]`**

在 `session-start.ts` 的 `handle()` 中:
- 按当前场景检索 ProtoStructures
- 追加到 `SessionContextInjection` (新增字段或格式化到现有 competency/knowledge 段)
- M1 不做 Tier 分层 (M2 实现)

**验证**: 提前写入 3 个 ProtoSequence → session_start → system prompt 中包含它们的名称+置信度+关键步骤

### Step 4: ProtoStructure 提取 (Week 5-6)

**4.1 LLM Prompt 模板 `[P1]`**

创建 `prompts/analysis/extract-structures.md`:
- 输入: session transcript
- 输出: ProtoStructure 候选 (JSON 格式)
- 先只提取 ProtoSequence (一种类型验证链路)

**4.2 session_end 集成 `[P1]`**

在 `session-end.ts` 中:
- transcript → LLM 分析 → 提取 ProtoStructure 候选 (置信度 0.3-0.5, lifecycle=hypothesized)
- 与现有 lesson 写入并行执行

**验证**: 模拟一次门诊流程对话 → session_end → AgentMemory 中出现 ProtoSequence "挂号→分诊→问诊" (置信度 0.3-0.5)

### Step 5: 集成测试 + 文档 (Week 6)

**5.1 端到端集成测试**

完整链路: session_start → message_received (用户教流程) → session_end → AgentMemory 出现 ProtoSequence → 下次 session_start → system prompt 包含该结构

**5.2 类型检查 + 零回归**

- TypeScript 编译零错误
- 所有现有测试 (498 tests) 仍然通过

---

## 三、测试策略

### 单元测试 (每个模块 3-5 个)

**ProtoStructure 类型**:
1. ProtoSequence 完整字段创建 → 序列化 → 反序列化
2. ProtoConstraint severity 必须为 block/confirm/warn 之一
3. 每种类型独立创建 → 字段完整性

**关系图**:
1. A depends_on B → B↓ → A↓
2. A contradicts B → A↑ → B↓
3. 循环检测拒绝 A→B→C→A
4. 传播深度 = 3 跳截断

**生命周期**:
1. hypothesized → candidate → experimental → crystallized
2. crystallized → degraded (≥3 反例)
3. rejected 不可逆

**版本链**:
1. 创建 3 版本 → rollback v1
2. diff 两个版本 → 正确差异

### 集成测试 (2-3 个)

1. 完整 session → ProtoSequence 提取 → 存储 → 注入
2. 关系图传播跨 3 个结构
3. 版本链 + 生命周期联动

### Mock 策略

AgentMemory 通过 M0Deps.memory mock。LLM 通过 M0Deps.llm mock。不需要真实 AgentMemory 服务。

---

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/cognitive/types.ts` | **重写 ProtoStructure 区域** | 删除 V6 简化版, 替换为架构 §3+§9 完整接口族 |
| `src/structure-graph.ts` | **新建** | 关系图 + 确定性置信度传播 |
| `src/structure-lifecycle.ts` | **新建** | 生命周期状态机 + 结晶化/退化门控 |
| `src/structure-version.ts` | **新建** | 版本链 (创建/回滚/diff) |
| `src/agentmemory-client.ts` | **修改** | 新增 saveProtoStructure/searchProtoStructures |
| `src/session-start.ts` | **修改** | 追加 ProtoStructure 基本注入 |
| `src/session-end.ts` | **修改** | 增加 ProtoStructure 提取逻辑 |
| `prompts/analysis/extract-structures.md` | **新建** | LLM transcript → ProtoStructure 的 prompt 模板 |
| `src/structure-graph.test.ts` | **新建** | 关系图测试 |
| `src/structure-lifecycle.test.ts` | **新建** | 生命周期测试 |
| `src/structure-version.test.ts` | **新建** | 版本链测试 |

---

## 五、M1 完成标准 (Go/No-Go)

- [ ] 5 种 ProtoStructure 类型可创建、序列化、存储、检索、修改
- [ ] 关系图传播在所有 6 种关系类型 + 传播深度限制下通过单元测试
- [ ] 生命周期状态机覆盖全部 6 个状态和转换
- [ ] 版本链支持回滚到任意历史版本
- [ ] ProtoSequence 可从 session transcript 自动提取 (端到端)
- [ ] session_start 时 ProtoStructures 被注入 system prompt
- [ ] 每个新模块有独立测试文件
- [ ] TypeScript 编译零错误
- [ ] 498 existing tests 全部通过

---

> **立即启动**: Step 1.1 (types.ts ProtoStructure 重写)  
> **预计工期**: 4-6 周  
> **架构参考**: [§3 认知结构系统](../architech/praxis-architecture.md), [§9 数据模型](../architech/praxis-architecture.md)
