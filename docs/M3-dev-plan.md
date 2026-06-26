# M3 开发计划: 约束系统

> 目标: ProtoConstraint 从被动存储升级为主动拦截——在 LLM 犯错之前阻止它  
> 周期: 3-4 周  
> 前置: M1 Step 1 (ProtoStructure 类型/关系图/生命周期/版本链), M2 (上下文编排)  
> 架构参考: [praxis-architecture.md](../architech/praxis-architecture.md) §3 (ProtoConstraint), §7 (约束注入段), §10 (before_tool_call)  
> 路线图参考: [ROADMAP.md](ROADMAP.md) M3 节

---

## 〇、Step 0: 现有代码审计

### 可直接复用

| 文件 | 复用什么 | 状态 |
|------|---------|------|
| `cognitive/types.ts:627-633` | `ProtoConstraint` 类型完整定义（severity: block/confirm/warn, source: user_taught/auto_derived, rulePatterns: string[]） | ✅ 无需修改 |
| `structure-lifecycle.ts` | 6 状态生命周期状态机 — 结晶化/退化门控 | ✅ 无需修改 |
| `structure-graph.ts` | 6 种关系类型 + 确定性置信度传播（≤3 跳） | ✅ 无需修改 |
| `structure-version.ts` | 版本链 — 每次修改产生新快照 + 回滚 | ✅ 无需修改 |
| `context-organizer.ts` | Tier A/B/C 分层 + 排序 + 压缩 | ✅ 无需修改（约束段独立于 Tier 系统） |
| `m0-deps.ts` | M0Deps 接口（memory/cache） | ✅ 无需修改 |

### 需要修改

| 文件 | 当前状态 | M3 变更 |
|------|---------|--------|
| `session-start.ts` | M2 tieredContext 注入（Tier A/B/C + meta） | 新增：提取已结晶约束 → 注入 CRITICAL CONSTRAINTS 段 → 暴露给 orchestrator |
| `before-tool-call.ts` | M0 自主性决策（proceed/inform/confirm/block），无测试 | 新增：`loadConstraints()` 方法 + handle() 中合并约束验证结果 |
| `orchestrator.ts` | M0 事件路由 | 新增：session_start 后将约束加载到 BeforeToolCallHandler |
| `cognitive/index.ts` | 导出 15+ 模块 | 新增：导出 proto-constraint / constraint-injector / constraint-validator |

### M3 新增文件

| 文件 | 对应 ROADMAP | 职责 |
|------|-------------|------|
| `src/proto-constraint.ts` | M3.1 | 约束管理纯函数：创建、废弃、severity 获取、活跃约束过滤 |
| `src/constraint-injector.ts` | M3.2 | CRITICAL CONSTRAINTS 段格式化：按 severity 排序 + token 预算控制 |
| `src/constraint-validator.ts` | M3.3 | before_tool_call 约束检查：toolName → rulePattern substring 匹配 |

### 不在 M3 范围

| 子步骤 | 原因 | 目标 Milestone |
|--------|------|---------------|
| M3.4 约束自动提取 | 依赖 M4.3 statistical-verifier 检测步骤顺序差异。无独立统计验证器 = 无输入信号。硬依赖，不可 bypass。 | M4-dev-plan |
| M3.5 `/praxis ontology` | 架构 §13 定义了 4 命令系统（ontology/status/audit/task）。单独实现一个命令 = 一次性框架后被替换。应在 M5 统一实现完整命令系统。 | M5-dev-plan |

---

## 一、架构决策

### A1: 约束注入流程

```
session_start
  ↓
scene-recognizer → 场景识别
  ↓
task-context → 加载 TaskContext
  ↓
context-pressure-monitor → 测量上下文利用率
  ↓
context-organizer → ProtoStructures 排序 → Tier A/B/C
  ↓
proto-constraint → 过滤已结晶约束 (lifecycle === "crystallized")
  ↓
constraint-injector → 格式化为 CRITICAL CONSTRAINTS 段 (~100 tokens)
  ↓
system prompt 注入:
  ⛔ CRITICAL CONSTRAINTS (不可违反)
  ├─ Tier A: 当前场景全量详情
  ├─ Tier B: 间接相关摘要
  └─ Tier C: 其他索引
```

**约束段在 Tier A/B/C 之前注入**，且在 Critical 压力下仍保留（~100 tokens）。架构 §7 原文："约束段在 Critical 压力下仍然注入"。

### A2: before_tool_call 拦截流程

```
before_tool_call(toolName)
  ↓
autonomy decision (现有 M0 逻辑)
  ↓
constraint-validator.checkConstraints(toolName, activeConstraints)
  ↓
merge results:
  - constraint severity "block" > autonomy decision → return block
  - constraint severity "confirm" > autonomy "inform" → upgrade to confirm
  - constraint severity "warn" → 记录警告但不改变 autonomy 决策
  ↓
return { action, reason }
```

**合并规则**: 最严格的结果优先。block > confirm > autonomy decision > warn。

### A3: 模块依赖图

```
orchestrator.ts
  ├── session-start.ts
  │     ├── context-organizer.ts (M2, 已有)
  │     ├── constraint-injector.ts (M3.2, 新增)
  │     └── proto-constraint.ts (M3.1, 新增)
  └── before-tool-call.ts
        └── constraint-validator.ts (M3.3, 新增)
```

所有新增模块为纯函数。orchestrator 只做连线（在 session_start 后调用 `beforeToolCall.loadConstraints()`），不做业务逻辑。

### A4: 约束验证算法

```
checkConstraints(toolName, constraints):
  matches = []
  for each constraint ∈ constraints:
    for each pattern ∈ constraint.rulePatterns:
      if toolName.toLowerCase().includes(pattern.toLowerCase()):
        matches.push({ constraint, severity, pattern })
  if matches.length === 0:
    return { violated: false }
  // Collect ALL matches, take max severity (block > confirm > warn)
  return matches.reduce((worst, m) =>
    severityRank[m.severity] > severityRank[worst.severity] ? m : worst
  )
```

Collect-all + max-severity。O(n) n=约束数量（M3 阶段预计 < 10 条）。延迟 < 0.1ms。不引入 regex 语法错误风险。

---

## 二、逐步骤行动计划

### Step 1: ProtoConstraint 管理模块 (Week 1)

**1.1 实现 `proto-constraint.ts` `[P0]`**

纯函数模块，操作已由 `cognitive/types.ts` 定义的 ProtoConstraint 类型:

```typescript
// 提取活跃约束 — 已结晶 + 有 rulePatterns
function getActiveConstraints(structures: ProtoStructure[]): ProtoConstraint[]

// 按 severity 排序: block → confirm → warn
function sortBySeverity(constraints: ProtoConstraint[]): ProtoConstraint[]

// 废弃约束 — 推进到 deprecated 生命周期状态
function deprecateConstraint(constraint: ProtoConstraint, reason: string): ProtoConstraint

// 计算约束段 token 预算（~100 tokens，Critical 下不减）
function estimateConstraintTokens(constraints: ProtoConstraint[]): number
```

**验证**: 10 个 ProtoStructure（含 3 个 constraint 类型，2 个 crystallized + 1 个 experimental）→ `getActiveConstraints` 返回 2 个已结晶约束。

**约束创建路径**（M3 阶段）:

约束的创建走与所有 ProtoStructure 相同的路径——不特殊：
1. 运营商通过 AgentMemory 外部工具预置：`memory_save type="proto_structure" protoType="constraint"`，设置 `lifecycle` 和 `rulePatterns`
2. session_start 的 `loadProtoStructures()` 加载所有类型（已验证于 M2——测试中使用了 `protoType: "constraint"` 的结构）
3. `getActiveConstraints()` 过滤出 `lifecycle === "crystallized"` 的约束

M3 不提供编程化的 `createConstraint()` 函数——这与 M1-M2 一致（没有 `createSequence()` / `createConcept()` 等工厂函数）。约束创建是 M1 存储管道 + 运营商操作的问题。
- M3.4 (M4): 自动提取路径（从 statistical-verifier 检测步骤顺序差异）
- M3.5 (M5): 交互式路径（`/praxis ontology` 命令 + 约束管理界面）

**1.2 测试 `[P0]`**

- `proto-constraint.test.ts` — 覆盖: 活跃过滤（crystallized 通过、experimental/candidate/hypothesized 被过滤）、severity 排序、废弃操作、token 估算、空结构列表、无约束类型结构

---

### Step 2: CRITICAL CONSTRAINTS 注入 (Week 1-2)

**2.1 实现 `constraint-injector.ts` `[P0]`**

纯函数模块:

```typescript
interface InjectConstraintsInput {
  constraints: ProtoConstraint[];
  pressure: PressureLevel; // 用于 token 预算控制
}

interface InjectConstraintsOutput {
  injectionText: string;    // 格式化的 CRITICAL CONSTRAINTS 段
  tokenCount: number;       // 实际 token 数
  constraintIds: string[];  // 注入的约束 ID 列表 (供遥测)
}

function injectConstraints(input: InjectConstraintsInput): InjectConstraintsOutput
```

注入格式（架构 §7 原文）:

```
⛔ CRITICAL CONSTRAINTS (不可违反):
1. 处方开具必须在诊断完成之后 [置信度 0.82, 23次观察]
2. 数据库迁移操作前必须完成备份 [用户明确教导]

[约束与流程冲突时，约束优先]
```

注：`[N次观察]` 使用 ProtoStructure 基类的 `observationsCount` 字段（已存在）。`[置信度 X.XX]` 使用 `confidence` 字段。移除了 `violationCount`（不存在）和 `ProtoSequence` 占位符（M3 范围外）。

**2.2 集成到 `session-start.ts` `[P0]`**

在 `handle()` 中调用 context-organizer 后:
1. 从加载的 ProtoStructures 中调用 `getActiveConstraints()`
2. 调用 `injectConstraints()` 生成注入段
3. 在 tieredContext 输出中新增 `criticalConstraints` 字段

**2.3 测试 `[P0]`**

- `constraint-injector.test.ts` — 覆盖: block > confirm > warn 排序、空约束返回空字符串、Critical 压力下仍注入、token 计数准确、格式符合架构 §7
- `session-start.test.ts` 新增测试 — 已结晶约束出现在注入段中

---

### Step 3: before_tool_call 约束验证 (Week 2)

**3.1 实现 `constraint-validator.ts` `[P0]`**

纯函数模块:

```typescript
interface ConstraintCheckResult {
  violated: boolean;
  constraintId?: string;
  severity?: "block" | "confirm" | "warn";
  matchedPattern?: string;
}

function checkConstraints(
  toolName: string,
  activeConstraints: ProtoConstraint[]
): ConstraintCheckResult
```

Substring 匹配: `toolName.toLowerCase().includes(pattern.toLowerCase())`

**3.2 增强 `before-tool-call.ts` `[P0]`**

新增:
```typescript
class BeforeToolCallHandler {
  private activeConstraints: ProtoConstraint[] = [];

  loadConstraints(constraints: ProtoConstraint[]): void {
    this.activeConstraints = [...constraints]; // 防御性拷贝
  }

  async handle(toolName: string): Promise<Result<...>> {
    // 1. 现有 M0 自主性决策
    const autonomyResult = ...;

    // 2. M3 约束验证
    const constraintResult = checkConstraints(toolName, this.activeConstraints);

    // 3. 合并: 取最严格结果
    return mergeResults(autonomyResult, constraintResult);
  }
}
```

**合并优先级**: constraint block > autonomy block > constraint confirm > autonomy confirm > autonomy inform > autonomy proceed > constraint warn

（constraint warn 不改变 autonomy 决策——它只记录警告日志）

**3.3 集成到 `orchestrator.ts` `[P0]`**

```typescript
async handleSessionStart(sessionId: string) {
  const result = await this.sessionStart.handle(sessionId);
  if (result.ok && result.value.tieredContext?.criticalConstraints) {
    this.beforeToolCall.loadConstraints(
      result.value.tieredContext.criticalConstraints.constraints
    );
  }
  return result;
}
```

**3.4 测试 `[P0]`**

- `constraint-validator.test.ts` — 覆盖: substring 匹配（精确/部分/大小写）、多 pattern 全部匹配取最大 severity、首个匹配返回、无匹配、空约束列表、空 toolName、block/confirm/warn severity、一个 toolName 同时匹配 warn + block → 返回 block
- `before-tool-call.test.ts` **(新文件，补 M0 债务)** — 覆盖: 4 级风险决策（existing M0 logic）、loadConstraints + 约束命中 block、约束命中 confirm 升级 inform → confirm、warn 不改变决策、约束 + autonomy 均为 block、无约束时行为不变

---

## 三、类型变更

### cognitive/types.ts — SessionContextInjection 扩展

```typescript
export interface SessionContextInjection {
  // ... 现有字段
  tieredContext?: {
    // ... 现有字段
    /** M3: 已结晶约束注入段 */
    criticalConstraints?: {
      injectionText: string;
      tokenCount: number;
      constraintIds: string[];
      constraints: ProtoConstraint[]; // 供 orchestrator 传递给 before_tool_call
    };
  };
}
```

### cognitive/index.ts — 新增导出

```typescript
export { getActiveConstraints, sortBySeverity, deprecateConstraint } from "../proto-constraint";
export { injectConstraints } from "../constraint-injector";
export { checkConstraints } from "../constraint-validator";
```

---

## 四、验证标准

- [ ] `getActiveConstraints()` 正确过滤非 crystallized 的 constraint 类型结构
- [ ] `constraint-injector` 输出格式与架构 §7 一致（⛔ 标记 + severity 排序 + 观察/违规计数）
- [ ] Critical 压力下约束段仍注入（不受 Tier C 裁减影响）
- [ ] `checkConstraints` substring 匹配正确（精确/部分/大小写不敏感）
- [ ] `before_tool_call` 合并结果：constraint block 覆盖 autonomy proceed
- [ ] `before_tool_call` 拦截延迟 < 1ms（纯内存 + substring，物理上远低于 10ms 要求）
- [ ] 无约束加载时 before_tool_call 行为与 M0 完全一致（回归）
- [ ] 所有新模块有对应测试文件
- [ ] `before-tool-call.test.ts` 补全 M0 遗留的 autonomy 测试缺口

---

## 五、文件清单

| 文件 | 类型 | 预估行数 |
|------|------|---------|
| `src/proto-constraint.ts` | 新增 | ~80 |
| `src/proto-constraint.test.ts` | 新增 | ~130 |
| `src/constraint-injector.ts` | 新增 | ~70 |
| `src/constraint-injector.test.ts` | 新增 | ~110 |
| `src/constraint-validator.ts` | 新增 | ~50 |
| `src/constraint-validator.test.ts` | 新增 | ~100 |
| `src/before-tool-call.ts` | 修改 | +30 |
| `src/before-tool-call.test.ts` | 新增 | ~140 |
| `src/session-start.ts` | 修改 | +20 |
| `src/session-start.test.ts` | 修改 | +40 |
| `src/orchestrator.ts` | 修改 | +5 |
| `src/cognitive/types.ts` | 修改 | +15 |
| `src/cognitive/index.ts` | 修改 | +5 |

**总计**: 6 新文件 + 6 修改 + 3 新测试文件 ≈ +790 行

---

## 六、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| M1 存储/检索管道不完整 | ProtoConstraint 无法从 AgentMemory 存取 | `proto-constraint.ts` 是纯函数——接收已加载的 ProtoStructure[]。存取由 session-start 的现有 `loadProtoStructures()` 管道处理（已验证于 M2） |
| AgentMemory 不可用 | 约束无法加载 | 降级：空约束列表 → constraint-injector 返回空字符串 → before_tool_call 行为与 M0 一致 |
| rulePattern 过宽匹配 | 误拦截正常操作 | severity=warn 不阻断操作；confirm 允许用户放行。只有 block 级别才真正拒绝。初期建议只使用 warn/confirm，积累信心后再设 block |
| 约束数量增长 > 20 | 注入段超过 ~100 token 预算 | `constraint-injector` 内置 `maxTokens` 参数（默认 150），超出时按 severity 优先级截断 |

---

> **下一步**: 切分支 → Step 1 实现 → 两轮 /plan-eng-review → Step 2 → ... → Step 3 → 全盘 review → /ship

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 4 issues found, 4 resolved |
| CEO Review | — | Scope & strategy | 0 | — | — |
| Design Review | — | UI/UX gaps | 0 | — | — |
| Outside Voice | Codex v0.141.0 | Independent 2nd opinion | 1 | CLEAR | 22 findings, 4 incorporated, 18 acknowledged/deferred |

**CODEX:** 22 findings across 5 categories. 4 incorporated: collect-all matching, merge priority fix, injection format cleanup, constraint pre-seeding documentation. 18 acknowledged: tool-name matching weakness (per architecture design), stale constraints (M5 scope), evaluation harness (deferred to M4), module count (architecturally dictated), schedule (per M2 precedent).

**CROSS-MODEL:** Broad agreement on architecture. Codex highlighted 4 design bugs the review missed (first-match-wins, missing proceed, untracked metadata, no input path) — all now fixed. Codex pushed for parameter-level enforcement and evaluation harness; both are valid but belong in M4 (confidence system + statistical verifier enable these).

**VERDICT:** ENG + CODEX CLEARED — ready to implement.

**IMPLEMENTATION:** All 3 steps implemented, 6 rounds of per-step review + Codex, 14 bugs found and fixed. Final holistic cross-step integration verified. 691 tests (44 files), 0 regressions. Ready to /ship.

NO UNRESOLVED DECISIONS

NO UNRESOLVED DECISIONS
