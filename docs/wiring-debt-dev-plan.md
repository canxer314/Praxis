# Praxis Wiring-Debt 开发计划

> 严格依据 `architech/praxis-architecture.md` + `docs/ROADMAP.md`。
> **原则**: 当前代码能用则用, 不能用就改; 代码与架构文档冲突时, **以架构文档为准**, 接受对现有代码的大幅度修改。
> 来源: `docs/REVIEWS/2026-06-27-m1-m6-eng-review.md` 的 T1–T20 + B6 接线债。已完成 14 项 (见 ROADMAP「接线债与修复状态」); 本计划覆盖剩余项: T1, T6, B6, T9, T10, T11, T12, T18, T14。

---

## 0. 载重决策: 生产运行时迁移 (A + OS 调度器 per-tick)

### 0.1 决策

**A + OS 调度器 per-tick** = per-hook `EventOrchestrator` (session 状态持久化到 AgentMemory) + **OS 调度器 (Windows Task Scheduler / cron) 调用 per-tick Praxis 命令**跑 §6/§8 定时工作, **无 Praxis 常驻进程**。

`before_tool_call` 热路径 = **A+D (per-hook, bun 运行时, 无 daemon)** — Phase 0.5 实测: tsx 冷启动 ~1s (不可接受), **bun ~59ms** (含 Praxis import + route) → 换 bun 即可, 无需 daemon, 保留安全门独立性。

不是纯 A (跑不了 §6/§8), 不是 B (保留 bridge 第二入口, 违反 §11), 不是 C (daemon 把热路径 SPOF 化)。

> **Review 修正 (2026-06-27, 见 §0.4)**: 原计划「praxis-scheduler 独立被监督常驻进程」已修正为 OS-cron-per-tick (无 Praxis daemon) —— §6/§8 模块 persisted-state + `handle()` 跑一次, OS 调度器足以触发, daemon 是过度工程。D1 `before_tool_call` 路径由实测 tsx 启动延迟决定 (原计划假设 per-hook 可接受, 未验证)。

### 0.2 第一性原理 + 验证证据 (2026-06-27)

**不可否认的约束**:
1. Claude Code hook 是多进程 (每 hook = 独立 `tsx` 进程, 跑完退出) — 宿主约束。
2. session 状态必须在消费点可达 (session_end 融合需要 session_start 加载的 structures + 会话累积的 midSessionSources)。
3. §6 (主动驱动) + §8 (Meta Layer) 需要 Praxis **主动发起**的定时工作 (cron_tick 30min / HeartbeatMonitor 5min / Meta Layer 168h·720h / TaskScheduler 调度下一动作) — 一个退出的进程无法调度未来工作。

**验证 (决定性)**: 读 §6/§8 全部模块确认它们的状态依赖:
| 模块 | 状态来源 | 调度 | 运行时绑定 |
|------|---------|------|-----------|
| `TaskScheduler` | `memory.getSlot(SLOTS.TASK_SCHEDULE)` + ctx 参数 | 平台层 TriggerAdapter | 不绑定 (doc 明示) |
| `HeartbeatMonitor` | `memory.getSlot(SLOTS.HEARTBEAT_STATE)` + activeTasks 参数 | 平台层 setInterval/cron | 不绑定 (doc 明示) |
| `SubagentManager` | `memory` (slot) + `SubagentExecutionAPI` 平台回调 | session_end 触发 | 不绑定 (doc 明示) |
| `CronTickHandler` | `this.deps.memory` (getSlot/smartSearch, 全部 slot) + `handle()` 无参 | 平台层调度 | 不绑定 |

→ **§6/§8 调度工作仅依赖持久化 slot + 调用方传入的 ctx, 不依赖内存 session 状态。** OS 调度器 per-tick 调用 `praxis cron-tick` 等命令 (每次新进程跑 `handle()` 一次) 即可运行全部 §6/§8 工作, **无需 Praxis 常驻进程**。C (daemon) 不必要。

**为什么不 C**: `before_tool_call` 是安全门 (§12 原则 4「事前约束」)。若它依赖 daemon, daemon 崩溃 = 约束失效 = LLM 可能跑危险操作。per-hook 模型里每次 `before_tool_call` 独立从约束 slot 读取, daemon 在不在都不影响安全门。C 把安全关键路径绑死在 SPOF 上, 是安全回退。

**可证伪预测**: 若 A+OS-cron 错, 应观察到 (a) `before_tool_call` 需要只有 daemon 内存才有的状态, 或 (b) §6/§8 工作需要活跃 session 内存状态。验证已排除 (b); (a) 由约束 slot 独立读取排除。若未来某 §6 模块被改为依赖内存 state, 本决策需重评 (翻转为 C, daemon 兼做调度)。

### 0.3 目标运行时拓扑

```
Claude Code (宿主, 多进程 hook)
  │
  ├─ SessionStart hook ─┐
  ├─ UserPromptSubmit ─ ┤   每个 hook = 独立进程:
  ├─ PreToolUse ─────── ┼─→ [ClaudeCodeAdapter] ─→ mapToPraxisEvent  (bun 运行, ~59ms/hook)
  ├─ PostToolUse ───── ─┤                       ─→ EventOrchestrator(deps).route(event)
  ├─ Stop (agent_end) ─┤                       ─→ 加载 praxis_session_state slot
  └─ SessionEnd ────── ┘                       ─→ 处理 + 写回 slot + 退出
                                                      │
                                                      ▼
                                          ┌──────────────────────┐
                                          │  AgentMemory (slot)  │  ← 唯一跨进程状态
                                          │  - proto_structure   │
                                          │  - praxis_session_state (NEW: structures/
                                          │    midSessionSources/corrections/toolCallTrace)
                                          │  - constraints / competency / task_context
                                          │  - audit_log / heartbeat_state / meta_layer_state
                                          └──────────────────────┘
                                                      ▲
                                                      │  仅读写 slot (无内存 session 状态)
          OS 调度器 (Task Scheduler / cron)  ← 无 Praxis daemon
            │  per-tick 调用: 每次新进程跑一次 handle() 后退出
            ├─ 30min → `praxis cron-tick`   (CronTickHandler.handle)
            ├─ 5min  → `praxis heartbeat`   (HeartbeatMonitor.runHeartbeatCheck)
            └─ daily → `praxis meta-audit`  (Meta Layer, 内部检查 168h/720h 间隔)
            │
            │  平台层适配器 (slot-stub 兜底, D3/§0.4):
            │    TriggerAdapter + StallInterventionCallback + SubagentExecutionAPI
```

**关键不变量**: 热路径 (7 生命周期事件, 含 `before_tool_call` 安全门) per-hook 独立, 不依赖任何常驻进程; 定时工作由 OS 调度器触发 per-tick 命令, 仅消费持久化 slot。两者解耦 —— **Praxis 无常驻进程**, 任一 tick/hook 崩溃不影响其他。`before_tool_call` 路径若 Phase 0.5 实测后改 warm daemon (D1), 则该 daemon 兼做调度 (D1-D2 耦合, 见 §0.4)。

### 0.4 Review 修正记录 (2026-06-27, 第一性原理 + 推理诚实性)

对 §0.1 决策做了 3 项 load-bearing 子决策的严格审查 (D1/D2/D3), 两项修正了原计划:

**D1 — before_tool_call 热路径 (测量门控, 修正原假设)**:
- 原计划假设 per-hook 启动可接受 (`[假设]` 未验证)。
- 第一性原理: §M3.3 <10ms 指约束逻辑 (可达), 但总延迟被 tsx 进程启动 (~100-500ms, 未实测) 主导。C (slot-cache) 不解决延迟 (仍 per-hook 进程)。真分叉是 A (per-hook) vs B (warm daemon)。
- 反向测试: 若 tsx ~500ms × 100 tool call = 50s 开销, 不可接受 → B+A-fallback (warm daemon 快 + per-hook 回退保安全门)。
- **结论 (Phase 0.5 实测 2026-06-27)**: tsx 冷启动 p50=1014ms (bare) / 1042ms (full) → 不可接受 (100 tool call = 100s)。**换 bun**: p50=48ms (bare) / 59ms (full) → 可接受 (100 tool call = 5.9s)。**D1 = A+D (per-hook bun, 无 daemon)** — 换运行时即可, 不需 daemon, 保留安全门独立性 (before_tool_call 仍 per-hook 独立, 无 SPOF)。D1-D2 耦合不触发 (无 daemon) → D2 维持 OS-cron-per-tick。
- `⚠️` 薄弱环节 (已基本解决): tsx 启动延迟实测 ~1s → 换 bun 解决。剩余: bun 生产稳定性 + Praxis 全模块在 bun 下兼容性 (bench 已验证 EventOrchestrator 路由, 全模块待 Phase 1 验证)。

**D2 — 调度方式 (修正: 删 daemon, 改 OS-cron-per-tick)**:
- 原计划: `praxis-scheduler` 独立被监督常驻进程。
- 第一性原理 5 why: 为什么调度需常驻 Praxis 进程? → OS 调度器 (Task Scheduler/cron) 可 per-tick 调 `praxis cron-tick` 命令, 每次新进程跑 `handle()` 一次 + 退出。§6/§8 已验证 persisted-state + 显式 "cron 有效"。**daemon 是过度工程。**
- 反向测试: 若调度需跨 tick 进程内状态 → 需 daemon; 但 §6/§8 已验证无进程内状态。→ 反驳失败, E (OS-cron-per-tick) 成立。
- **结论**: OS 调度器 → per-tick 命令, 无 Praxis daemon。与 per-hook 模型统一 (全 per-invocation + persisted-state)。安装脚本注册 OS 调度任务。
- `⚠️` 与 D1 耦合: 若 D1 实测需 warm daemon, 那个 daemon 可兼做调度 (D2 回退为 daemon); 否则 OS-cron 调度。

**D3 — §6 自主性范围 (A 成立, 无修正)**:
- §6 自主性与核心论点 (M4 验证器) 正交; 宿主 API (scheduleTurn/spawn) 不确定。
- **结论 A (stub + 不阻塞)**: 建运行时无关决策逻辑 (evaluateTrigger 可测), slot-stub 宿主依赖动作 (nudge/escalate 真实有效, wake 占位), 不阻塞核心。host API 就绪时只补 adapter。
- `⚠️` slot-stub wake 是占位 (不真唤醒 session)。

---

## 1. 依赖图与阶段划分

```
Phase 0.5: 实测 tsx 启动延迟 (D1 门控) ── 决定 before_tool_call 路径 + D1-D2 耦合
   │
Phase 0: B6 (完整结构) + session 状态持久化契约
   │
   ├─→ Phase 2: T1 (验证器) ── 需要 B6 (full structures) + toolCallTrace (Phase 0)
   ├─→ Phase 2: T6 (传播) ──── 需要 B6 (relations 字段)
   │
Phase 1: T9 (生产运行时: per-hook EventOrchestrator + OS-cron per-tick) ── 依赖 Phase 0 状态契约 + Phase 0.5 门控
   │
Phase 3: T10 (M2 接线) ── 依赖 Phase 1 (orchestrator 接线就绪)
   │
Phase 4: T11 / T18 / T12 / T14 (cleanup) ── 独立, 任何时候可做
```

**关键路径**: Phase 0 → Phase 2 (核心论点: 验证器 + 传播)。Phase 0.5 (实测 tsx 启动) 是 D1/D2 门控, 优先做。Phase 1 依赖 Phase 0 状态契约 + Phase 0.5 门控 (非完全并行)。Phase 3/4 收尾。

---

## Phase 0 — B6 完整结构 + session 状态持久化契约 `[基础, 阻塞 T1/T6]`

**对应架构**: §9 (ProtoStructure 完整数据模型), §10 (session_start/session_end 状态流)。

**能用 (复用)**: `loadProtoStructures` (session-start.ts:257, 已从 smartSearch 加载); `createVersion` 防御 guard (已加); `buildM0Deps` 已注入 `saveProtoStructure`。

**不能用 (改)**: `loadProtoStructures` 当前只返回 summary shape `{id, tentativeName, protoType, confidence, scenarioId, summary}` — 缺 `relations/versionChain/observationsCount/adoptionRate/lifecycle/structure/function/teleologicalMapping`。导致 fusion 操作 summary (createVersion 靠 guard 兜底, 验证器 NPE, 传播找不到 relations)。session 状态 (structures/midSessionSources/corrections/toolCallTrace) 仅存 EventOrchestrator 内存, 跨进程丢失。

**改法 (架构优先, §9 完整 ProtoStructure 胜出)**:
1. `loadProtoStructures` 返回**完整** ProtoStructure (§9 全字段, snake_case 回退归一) + 保留派生 `summary` (供 Tier A/B/C 展示)。
2. **SessionStateStore (per-session slot)**: 持久化到 `praxis_session_state_<sessionId>` slot (**每 session 独立 slot**, 非 single-map) — 持 `structures / injectedStructureIds / midSessionSources / corrections / toolCallTrace / currentTaskType / currentDomain / midSessionLearnerState`。`session_start` 加载, 每个 hook 读写, `session_end` 删 slot 清理。**带 schema version 字段** (防字段演进破坏旧 slot)。
3. EventOrchestrator 改为: 每个 handler 调用前从 store load session state, 调用后 save。`state.structures` 来源从「session_start 内存缓存」改为「store」。**注意 (codex)**: Phase 0 改 `session_end.handle()` 签名 — 当前接受 `structures/injectedStructureIds/midSessionSources` 参数, 持久化后从 slot 加载 (非 EventOrchestrator 传入); 须与 Phase 2 验证器调用协调。
4. **并发模型 (P0-1, 解决 codex 最大缺口)**:
   - **session 状态 → per-session slot** (改法 2): 每 session 只写自己的 slot → **无跨 session 竞态**, 无需 CAS。
   - **共享 slot (task_schedule / audit_log / competency_model) → 最终一致**: AgentMemory 经验证**无 CAS** (`agentmemory-client.ts` 纯 REST GET/POST, 无条件写原语) → 接受 lost-update (低影响, best-effort: audit_log 丢条目 / task_schedule 丢触发器 / competency 略陈旧)。`heartbeat_state` 单写者 (仅 cron-tick) → 无竞态。
   - **hook 顺序假设 (须验证)**: 假设 Claude Code 对同一 sessionId 的 hook **严格顺序**派发 (before_tool_call 完成后才 after_tool_call)。若假, per-session slot 隔离跨 session; 若不假 (同 session hook 重叠), 该 session 状态 lost-update 低影响 (融合用可用源跑)。**实施前验证 Claude Code hook 派发模型**。
   - `⚠️` 薄弱环节: AgentMemory 无 CAS → 共享 slot 接受 lost-update。若 AgentMemory 后续支持 CAS, 升级 task_schedule 等热共享 slot。
   - 可证伪: 若共享 slot lost-update 导致真实故障 (如 task_schedule 触发器丢 → 动作未调度), 须升级该 slot 到 CAS 或单写者。
5. **MidSessionLearner 序列化 (P0-2, 解决 codex 实现阻塞)**:
   - 当前 `MidSessionLearner` 内部用 `Map` (violationCounters) + `Set` (affectedStructures) → **不可 JSON 序列化**, 阻塞 SessionStateStore。
   - **改法**: 内部 `Map<string,number>` → `Record<string,number>`, `Set<string>` → `string[]` (均 JSON-serializable); 加 `toState(): MidSessionLearnerState` + `static fromState(state)`。`handleCorrection`/`handleConstraintViolation` API 不变 (操作转换后的集合)。SessionStateStore 持 `learner.toState()`, load 时 `MidSessionLearner.fromState(state)` 重建。
   - `⚠️` Map→Record 键序 (V8 string-key = 插入序, 等价); Set→string[] `.includes` O(n) (N 小, fine)。

**测试**: `loadProtoStructures` 返回 full 字段 (relations/versionChain/steps 非空); `SessionStateStore` round-trip (含 per-session slot 隔离 — 两 session 并发写不互扰); `MidSessionLearner.toState/fromState` round-trip (totalPenalty/correctionCount/violationCounters/affectedStructures/records 不丢); 既有 fusion e2e + mid-session-learner 测试在转换后仍通过; hook 顺序假设验证记录。

**验收**: fusion 循环操作完整结构; 验证器能读 `structure.steps`; 传播能读 `relations`; 跨 hook session 状态不丢; **per-session slot 隔离跨 session 竞态**; **MidSessionLearner 状态可序列化 round-trip**; 共享 slot lost-update 已文档化为接受债。

---

## Phase 0.5 — 实测 tsx 启动延迟 (D1 门控) `[已完成 2026-06-27]`

**实测结果** (`scripts/bench-bare.ts` + `scripts/bench-hook-latency.ts`, 10 runs, Windows):
| 运行时 | bare p50 | full p50 (含 Praxis import + before_tool_call route) |
|--------|---------|------|
| tsx | 1014ms | 1042ms |
| bun | 48ms | 59ms |

- tsx 冷启动 ~1s (Node + esbuild loader 主导, Praxis import 仅 +28ms) → per-hook tsx 不可接受 (100 tool call = 100s)。
- **bun** 冷启动 ~48ms, full ~59ms → per-hook bun 可接受 (100 tool call = 5.9s)。

**D1 决策**: **A+D (per-hook bun, 无 daemon)**。换运行时 (tsx→bun) 即可, 不需 daemon, 保留安全门独立性 (before_tool_call per-hook 独立, 无 SPOF)。D1-D2 耦合不触发 → D2 维持 OS-cron-per-tick。

**剩余待验证**: bun 生产稳定性 + Praxis 全模块在 bun 下兼容性 (bench 已验证 EventOrchestrator 路由; Phase 1 全模块验证); Claude Code hook 派发模型 (同 sessionId 是否顺序) 仍待验证。

---

## Phase 1 — T9 生产运行时: per-hook EventOrchestrator + OS-cron per-tick `[最大, 生产落地]`

**对应架构**: §1 (三层拓扑 + 适配器层), §10 (运行时无关生命周期), §11 (EventOrchestrator 模块树), §6 (主动驱动), §9 (cron_tick 30min / Meta Layer 168h·720h)。

**能用 (复用)**: `EventOrchestrator` + 7 handlers; `ClaudeCodeAdapter` (M6.3); `buildM0Deps` (已完整); `TaskScheduler`/`HeartbeatMonitor`/`SubagentManager`/`CronTickHandler` (全部 persisted-state, 已验证); `local-cache` (降级)。

**不能用 (改, 大幅修改)**: `phase1a-bridge.ts` 是与 §11 冲突的遗留多进程 CLI (partial deps, 直接调 handler, 跳过 EventOrchestrator)。`EventOrchestrator` 生产零引用。无调度器触发 cron_tick/Meta Layer。

**改法 (架构优先, §11 EventOrchestrator 胜出, 退役 bridge)**:
1. **Per-hook 入口**: `ClaudeCodeAdapter` 成为 hook 入口 — 映射 Claude Code hook → Praxis 生命周期事件 → 构造 `EventOrchestrator(deps)` → `route(event)` → 持久化 session state (Phase 0) → 退出。`phase1a-bridge.ts` 退役 (其命令: `inject/end/expand/message` 折进 adapter; 非 lifecycle 命令 `shadow-stats/scene-log/scene-stats/learn/show` 折进 `/praxis` CLI 子命令)。
2. **跨 hook 状态**: EventOrchestrator 每 hook 从 `praxis_session_state` slot load, 处理后 save。`before_tool_call` 从约束 slot 独立读 (无 daemon 依赖)。**D1 已决 (Phase 0.5)**: 换 bun 运行时 (tsx→bun), per-hook p50=59ms → 保持 per-hook, **无 daemon**。hook 入口用 `bun scripts/<adapter>.ts` (非 tsx)。
3. **定时工作 (OS-cron per-tick, 无 Praxis daemon — D2 修正)**: 安装脚本注册 OS 调度任务 (Windows Task Scheduler / cron): 30min → `praxis cron-tick` (新进程跑 `CronTickHandler.handle()` 一次); 5min → `praxis heartbeat` (`HeartbeatMonitor.runHeartbeatCheck`); daily → `praxis meta-audit` (Meta Layer, 内部检查 168h/720h)。每次新进程仅读写 slot, 退出。平台层适配器 (slot-stub 兜底, D3): `TriggerAdapter.scheduleTurn` (→ 注册 OS cron 任务), `StallInterventionCallback` (nudge → `pending_nudges` slot 供 session_start 注入; wake → 占位 slot 待宿主 API; escalate → `task_orchestration_state` slot 标 BLOCKED), `SubagentExecutionAPI` (→ 宿主 spawn, 待宿主 API)。

**测试**: 跨进程 e2e (process A session_start → process B session_end → 融合从持久化状态运行); OS 调度器按时触发 cron-tick; **before_tool_call 独立执行约束** (无 daemon 依赖 / daemon 下线时回退仍执行 — 安全门独立性测试); 并发 hook 竞态测试 (两个 hook 同时 read-modify-write `praxis_session_state` → 加锁/重试不丢更新)。

**验收**: 生产中融合 + 学习 + §6/§8 调度工作全部运行; `before_tool_call` 独立于任何常驻进程; `phase1a-bridge.ts` 退役; 无 Praxis 常驻进程 (OS 调度器触发 per-tick)。

⚠️ **集成风险**: 平台适配器 (scheduleTurn/wake/spawn) 需要宿主 API; 未就绪前用 slot-stub 兜底 (nudge/escalate 真实有效, wake 占位 — D3), 不阻塞认知主线。另: OS 调度任务注册 (Task Scheduler/cron) 是部署步骤, 需安装脚本。⚠️ **并发**: `praxis_session_state` slot 的 read-modify-write 需加锁或乐观并发 (防 hook 交错丢更新)。

---

## Phase 2 — T1 验证器 + T6 传播 (核心论点) `[Praxis 的存在意义]`

**对应架构**: §4 (7 源融合 + 3 独立验证器), §3 (关系图置信度传播 ≤3 跳, 确定性, 不调 LLM), §12 原则 2 (LLM 不可靠 → 需独立信号)。

**能用 (复用)**: `StatisticalVerifier`/`RoleVerifier`/`ConceptVerifier` (M4.3, 已二值化 + spec 权重); `ConfidenceFuser` (已 spec 权重); `fullPropagation` (M1.2); `QuineanGating` (T2 已接入 canCrystallize); `parsePredictionMarkers` (llm_marker 源)。

**不能用 (改)**: 验证器从未被实例化/喂给 fuser (生产融合只 llm_marker + mid_session); `fullPropagation` 是死代码; `precedes` 关系无传播函数; 非规 `1/hop` 衰减。

**改法**:
1. **T1 验证器接入**: session_end 融合前, 实例化 3 验证器, 对每个 `injectedStructure` (Phase 0 已 full) 用 `VerificationContext` (toolCallTrace 从 `praxis_session_state` slot 取) 运行, 收集输出为 `statistical/role_verifier/concept_verifier` 源, 加入 `allSources`。把 toolCallTrace 接到 session_end (从 store)。
2. **T6 传播接入**: 融合更新某结构 confidence 后, 调 `fullPropagation(structure.id, delta, allStructuresMap)` (`allStructuresMap` = injectedStructures, Phase 0 已含 relations), 把 delta 应用到关联结构 + 持久化。实现缺失的 `precedes` 传播 (§3: B 在 A 前出现 → 两者降级)。移除非规 `1/hop` 衰减 (或显式文档化为偏离)。

**测试**: e2e 断言 ≥3 源类型到达 fuser (llm_marker + mid_session + ≥1 验证器); 传播 e2e (A depends_on B → B 降 → A 降); 僵尸拒绝 (T2) 仍成立; 6 种关系 + ≤3 跳传播单元测试 (此前缺 3 种 + precedes)。

**验收**: 生产融合 ≥3 源类型; 关系传播在 confidence 变化时触发; **LLM 自评循环被打破** (独立验证器贡献信号)。

---

## Phase 3 — T10 M2 接线 `[上下文编排落地]`

**对应架构**: §7 (四级压力 × 三档成熟度双轴, Critical Lazy Loading, TaskContext 自动进度, 跨场景消歧)。

**能用 (复用)**: `context-pressure-monitor` (T17 已 400K); `recall-structure`; `task-context` (applyProgress, confidence<0.7 门控); `semantic-disambiguator`; `scene-recognizer`; `handleSessionStart` 已接受 `estimatedUsedTokens` (T3)。

**不能用 (改)**: maturity 恒 "competent" (无映射函数); recallStructure/applyProgress/disambiguate 全未接线。

**改法**:
1. **Maturity**: `deriveMaturity(sessionCount)` → Novice/Competent/Expert (0-10/10-50/50+)。session_count 从 slot (session_start 递增)。传 maturity 给 organizeContext。实现 §7 双轴交互 (Critical+Expert = 极少量极高密度)。
2. **recallStructure (Critical Lazy Loading)**: Critical 压力下, session_start 构建结构索引 + 通过 adapter/MCP 暴露 `recall_structure` 工具供 LLM 按需拉取 (§7 Push+Pull)。
3. **applyProgress**: session_end 加载 TaskContext (slot), LLM 推断进度 (confidence<0.7 不自动更新), applyProgress, 持久化。
4. **disambiguate**: message_received 调 disambiguate (用 session state 中的场景上下文) → 标注用户意图。

**测试**: Critical → recall_structure 可用; maturity 影响粒度 (Novice vs Expert); TaskContext 自动进度; disambiguation 跨场景。

**验收**: M2 特性在运行时全部 live; §7 双轴交互实现。

---

## Phase 4 — Cleanup `[T11 / T18 / T12 / T14]`

- **T11 CrossAgentSync**: key bug 已修 (prior); 本阶段把 `saveWithOptimisticLock` 接入 subagent session_end (子 Agent 回流)。需 MemorySubsystem 扩展 (roadmap M6.5 已注)。测试: first-wins / second-pending_merge / listPendingMerges 返回真实 merges。
- **T18 DRY adapters**: 两个适配器 ~90% 重复 → 抽共享 base (映射逻辑), 仅保留平台差异。
- **T12 降级约束缓存**: session_start 把活跃约束 write-through 到 local-cache, 使降级路径 (AgentMemory 不可用) 的 before_tool_call 仍能从 local-cache 读约束执行。修复「降级即丢约束」(§12 原则 5 优雅降级)。
- **T14 测试补全**: 9 个无测试模块 (role-verifier, concept-verifier, curiosity-engine, structure-retirement, proto-task-learner, gap-detector, praxis-audit, praxis-status, cross-agent-sync) + 接线集成测试 + 新部署单元 (per-hook 入口 / OS-cron tick / 并发 hook) 测试。

---

## NOT in scope

- **多模态记忆** (§9 imageRef + vision_search) — ROADMAP 明确排除。
- **GUI 查看器** — ROADMAP 排除 (文本报告优先)。
- **Process Engine** (V4 ProcessTemplate/Instance/Step) — ROADMAP 排除 (已被 TaskOrchestrator + HeartbeatMonitor 覆盖)。
- **§6 subagent 真实 spawn + scheduleTurn 真实调度** — 依赖宿主 API; 在宿主集成前用 slot-stub (D3), 不阻塞认知主线。
- **跨团队联邦学习** — ROADMAP 排除。

---

## 验证策略

- **每阶段**: `tsc --noEmit` clean + `vitest` 全绿 + 新接线补测。
- **回归守卫**: `src/orchestrator-fusion.integration.test.ts` (e2e 融合+持久化) 是核心守卫, 每阶段扩展 (Phase 0: full structures; Phase 1: 跨进程 + 并发; Phase 2: ≥3 源 + 传播)。
- **Phase 1 验收标准** (定义「done」): 一次真实的跨进程 session_start→session_end 运行产生一个 fused+persisted 的 ProtoStructure — 这是 review 识别的缺失「definition of done」测试, 跨进程版。
- **架构一致性检查**: 每阶段对照 §1-§13 确认无新偏离; 任何代码与文档冲突以文档为准 (本计划已对 phase1a-bridge vs §11、summary vs §9、scheduler daemon vs §6-cron 做出架构优先裁决)。

---

## 与 ROADMAP 的关系

本计划是 ROADMAP「接线债与修复状态」中 ⏳ 项的执行计划。完成后, ROADMAP 的 M0–M6 「✅」才名副其实 — 模块不仅存在且有单元测试, 而且**从生产入口可达、端到端运行**。建议每完成一个 Phase 更新 ROADMAP 接线债清单 + `praxis-changelog.md`。

---

## Codex 外部声音发现 (2026-06-27, 待纳入计划)

Codex (独立审查, 186k tokens, 读码验证) **确认了核心决策** A+OS-cron —— 逐个读 `TaskScheduler`/`HeartbeatMonitor`/`SubagentManager`/`CronTickHandler` 源码, 确认全部 persisted-state-only, **无 daemon 主张成立**。但标记 9 个 under-specified 缺口, 其中 2 个是 Phase 0/1 可行性的 load-bearing 阻塞:

**[P0] 并发模型未指定 (最大缺口)** — `MemorySubsystem` (`m0-deps.ts:18-23`) 只有 `getSlot/setSlot`, **无 version/CAS/锁原语**, 完全暴露 TOCTOU 竞态。场景: (A) 两个 session_end 并发写 `TASK_SCHEDULE` slot → 后写覆盖前写, 丢触发器; (B) `praxis_session_state` 键粒度未定 (per-session slot 无竞态但 slot 膨胀 / 单 map slot 需 slot 级乐观锁); (C) hook 重入假设未声明 (per-sessionId hook 是否严格顺序? 若否, per-hook 模型崩)。**计划需指定并发模型**: per-session slot (无竞态, 膨胀) 或单 map + `setSlotIfVersion(name, data, version)` (横切 MemorySubsystem 改动) 或 append-only (不适用 task_schedule)。原计划「加锁/乐观并发」是 hand-wave。

**[P0] MidSessionLearner 不可序列化 (Phase 0 实现阻塞)** — 当前 `SessionState` (`orchestrator.ts:45-64`) 含 `midSessionLearner: MidSessionLearner`, 是带 `Map` 字段 (`correctionCounts`/`violationCounts`) 的类实例, **无法 JSON 序列化**。SessionStateStore 要么把 MidSessionLearner 拆为纯数据 (可序列化) + load 时重建实例, 要么扁平化为 plain object。计划未提及此实现障碍。

**[P1] D1 Phase 0.5 循环依赖** — 测 before_tool_call 路径的 tsx 启动需该路径存在 (adapter → EventOrchestrator → BeforeToolCallHandler → 约束加载 = Phase 1)。Phase 0.5 只能用 minimal stub 测进程启动, 测不到完整约束加载路径。**计划需声明 Phase 0.5 的测量代理** (stub adapter)。

**[P1] B+A-fallback 框架** — 「回退保证安全门可执行」准确, 但 fallback 路径 = 500ms (你要避免的延迟)。**safety = 约束被执行 (是); latency = 降级 (是)**。应明确: 回退保安全不保交互延迟。

**[P2] TaskScheduler schedule 参数隐式假设** — `evaluateTrigger(ctx, time, schedule?)` 若 schedule=null 跳过每日上限 + 最小间隔检查; `executeTrigger` 在 evaluateTrigger **之后** 才 loadSchedule。调用方需显式传 schedule, 否则决策忽略限额。应显式化。

**[P2] cron-tick LLM 可用性** — `CronTickHandler.handle` 的 Meta Layer 审计调 `this.deps.llm?.analyze`。`praxis cron-tick` 作为裸进程时, LLM 客户端需独立初始化 (buildM0Deps 已注入 llm adapter, 但需验证 cron-tick 命令用 buildM0Deps 而非裸 deps)。

**[P2] Phase 0 改 session_end.handle 签名** — 当前 `handle(sessionId, transcript, pendingSignals, injectedStructures?, ...)` 接受 structures 等参数; 持久化后从 slot 加载, 非 EventOrchestrator 传入。Phase 0 迁移须与 Phase 2 验证器调用协调。

**[P2] 平台适配器未统一** — `TriggerAdapter` (task-scheduler.ts:22) / `StallInterventionCallback` (heartbeat-monitor.ts:31) / `SubagentExecutionAPI` (subagent-manager.ts:38) 是各模块私有类型。计划需统一 `PlatformAdapter` 接口或适配器层。

**[P2] bridge 退役输出格式迁移** — `shadow-stats`/`scene-log`/`scene-stats`/`learn`/`show` 有特定 ASCII 表格输出 (phase1a-bridge.ts:740-820), 非单纯重路由, 是用户可见输出格式迁移。计划需指定这些输出迁到哪。

**结论**: 计划架构方向正确 (核心决策双模型验证), 但 Phase 0/1 的并发模型 + MidSessionLearner 序列化是实施前必须解决的 load-bearing 细节。上述 P0/P1 项应纳入 Phase 0/1 设计后再开工。

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 4 | clean | Plan-stage (1): 8 findings, 2 corrections. Phase 1 impl (2): 4 findings, all resolved. Phase 3 impl (3): 1 code quality finding (criticalIndex guard). Phase 4 impl (4): all 4 sections clean — zero findings |
| Outside Voice | codex (plan challenge) | Independent 2nd opinion | 1 | issues_found | Plan-stage: 核心决策 (A+OS-cron) 经读码验证成立; 9 under-specified 缺口. Phase 4: codex pending |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a (no UI) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** Plan-stage: 逐个读源码, 确认全部 persisted-state-only → A+OS-cron 成立. 标记 9 个 under-specified 缺口, 2 P0 (并发模型 + MidSessionLearner 序列化) 已解决.
- **CROSS-MODEL:** Plan-stage: 一致 — 双模型验证核心决策成立.
- **PHASE 4 IMPL REVIEW (2026-06-28):** Architecture clean — T18 factory extraction eliminates ~90% adapter duplication; T12 constraint cache write-through reuses existing localCache infra; T11 CrossAgentSync wiring is optional injection with clean fallback. Code quality clean — all new code paths have try/catch error isolation. Tests: 91 new tests (26 base-adapter + 8 T12 + 5 T11 + 52 T14), 943 total tests across 66 files, all green, typecheck clean. Performance: all new paths O(1), negligible overhead.
- **VERDICT:** ENG REVIEW CLEARED — all 4 runs clean. Phase 4 implementation: architecture clean, zero code quality issues, 100% test coverage on new/changed code paths, no performance concerns. Wiring-debt plan: Phase 0-4 complete, remaining items are P2 deferred (concurrency model verification, platform adapter unification, bridge retirement).

NO UNRESOLVED DECISIONS
