# Praxis 剩余开发计划

> **制定依据**: `architech/praxis-architecture.md` (§1-§13) + `docs/ROADMAP.md`。
> **原则**: 当前代码能用则用, 不能用就改; 代码与架构文档冲突时, **以架构文档为准**, 接受对现有代码的大幅度修改。
> **审计日期**: 2026-06-28 | **当前版本**: v0.15.0.0 | **目标版本**: v1.0.0.0

---

## 0. 审计结果摘要

对 Praxis 代码库进行了全面审计 — 逐模块对比架构文档 §11 模块树、ROADMAP 接线债清单和实际代码实现。

### 0.1 已验证完成 (✅)

| 项目 | 状态 | 证据 |
|------|------|------|
| M0-M6 核心模块 | ✅ | 全部 7 个生命周期处理器 + 分析模块 + 适配器已实现并测试 |
| B6 完整结构加载 | ✅ | `session-start.ts:286-295` 返回 relations/versionChain/structure/function 等 10 字段 |
| T6 关系图传播 | ✅ | `session-end.ts:228-252` fullPropagation 接入 5 种关系 (precedes 按设计延后) |
| SessionStateStore | ✅ | `session-state-store.ts` per-session slot 持久化 + schema version |
| T10 模块实现 | ✅ | deriveMaturity 除外, recallStructure/applyProgress/disambiguate 模块均已实现并测试 |
| T11 CrossAgentSync | ✅ | 乐观锁 CAS 接入 session_end |
| T12 约束缓存 | ✅ | Write-through + cache fallback 接入 |
| T18 DRY 适配器 | ✅ | base-adapter.ts 共享工厂 |
| T14 测试补全 | ✅ | 8 个无测试模块已补测, 943 tests, 66 files |
| cron_tick 实现 | ✅ | `cron-tick.ts` 541 行完整实现 (ProtoTask 累积/衰退/StructuralGap/Meta Layer) |

### 0.2 部分完成 (⚠️)

| 项目 | 完成度 | 缺失 |
|------|--------|------|
| B6 teleologicalMapping | 90% | `loadProtoStructures` 未返回 `teleologicalMapping` 字段 |
| T1 验证器接入 | 67% | StatisticalVerifier + RoleVerifier 已接入; **ConceptVerifier 未接入** |

### 0.3 未完成 (❌)

| 项目 | 影响 | 说明 |
|------|------|------|
| **T9 生产运行时迁移** | 🔴 阻塞 | phase1a-bridge 仍是唯一生产入口, EventOrchestrator 零生产引用, 融合管线是死代码 |
| **T10 接线** | 🟡 高 | 4 个 M2 模块定义了但从未被调用 (deriveMaturity 甚至不存在) |
| **OS cron 调度器** | 🟡 高 | cron_tick 完全实现但无外部触发器 |

### 0.4 从未启动 (⭕)

- **15 个架构模块**: plan-generator, verifier, progress-tracker, pitfall-matcher, pitfall-learner, consistency-checker, degradation-checker, config-adapter, memory/schemas, memory/slots, memory/queries, hermes-adapter, codex-adapter, files/plan-file-writer
- **prompts/ 全部**: 13 个 .md prompt 模板 (system/ + analysis/ + user/)
- **types/ 全部**: 3 个类型定义文件 (memory.ts, scene.ts, hooks.ts)
- **模块重组**: 代码从平铺结构迁移到 §11 目标目录结构

---

## 1. 依赖图与阶段划分

```
Phase 5: T9 生产运行时 (bridge退役 + EventOrchestrator入口 + OS cron + 数据迁移)
   │  这是最大的单项 — 让 M0-M6 在生产中真正运行
   │
   ├─→ Phase 6: T1 完成 (ConceptVerifier 接线 + LlmClient 适配层)
   │     │
   │     └─→ Phase 7: T10 接线 (deriveMaturity + recallStructure + applyProgress + disambiguate)
   │           │
   │           └─→ Phase 8: 模块重组 (平铺 → §11 目录结构)  ← 先重组, 新模块直接在目标位置创建
   │                 │
   │                 ├─→ Phase 9: 缺失架构模块 (15 个新模块, 直接在目标目录中创建)
   │                 │
   │                 └─→ Phase 10: Prompts + Types + Files (17 个缺失文件)
   │                       │
   │                       └─→ Phase 11: 适配器补全 + cognitive/ 清理
```

**关键路径**: Phase 5 → Phase 6 → Phase 7。Phase 5 让生产可用, Phase 6-7 补全核心认知管线。Phase 8 先重组目录结构, Phase 9-10 的新模块/文件直接在目标位置创建, 避免二次移动。

---

## ✅ Phase 5 — T9 生产运行时迁移 `[已完成 2026-06-28]`

**对应架构**: §1 (三层拓扑 + 适配器), §10 (运行时无关生命周期), §11 (EventOrchestrator), §6 (主动驱动), §9 (cron_tick)

### 5.1 当前状态

```
生产路径 (当前):  phase1a-bridge.ts (1078 行 CLI)
                   ├─ 直接 new SessionStartHandler(buildM0Deps()) — 绕过 EventOrchestrator
                   ├─ 直接 new SessionEndHandler({ analyzeTranscript, setSlot }) — MINIMAL deps
                   ├─ 无 fuser → 融合管线永远不执行
                   ├─ 无 toolCallTrace → 验证器永远不运行
                   ├─ 无 midSessionSources → 会话学习永远不触发
                   └─ JSON 文件持久化 (~/.praxis-phase1a/) — 与 SessionStateStore 完全隔离

开发路径 (未激活): EventOrchestrator (orchestrator.ts)
                   ├─ 完整 M0Deps → 融合 + 验证器 + 传播 + 注意力遥测
                   ├─ SessionStateStore → AgentMemory slot 持久化
                   └─ 仅在测试中使用 (orchestrator.test.ts, orchestrator-fusion.integration.test.ts)
```

### 5.2 目标

```
Claude Code hooks (多进程, bun 运行, ~59ms/hook)
  │
  ├─ SessionStart ─→ [ClaudeCodeAdapter] ─→ EventOrchestrator(deps).route(event)
  ├─ UserPromptSubmit ─→                   ─→ load praxis_session_state slot
  ├─ PreToolUse ─→                         ─→ 处理 + save state + 退出
  ├─ PostToolUse ─→
  ├─ Stop (agent_end) ─→
  └─ SessionEnd ─→

OS 调度器 (Windows Task Scheduler / cron) — 无 Praxis daemon
  ├─ 30min → praxis cron-tick     (CronTickHandler.handle)
  ├─ 5min  → praxis heartbeat     (HeartbeatMonitor.check)
  └─ daily → praxis meta-audit    (Meta Layer 审计)
```

### 5.3 改法

1. **统一入口脚本** (`scripts/praxis-hook.ts`):
   - 用 bun 运行 (Phase 0.5 实测 p50=59ms)
   - 接收 hook 类型 + sessionId + payload → ClaudeCodeAdapter 映射 → EventOrchestrator.route()
   - 替代 phase1a-bridge.ts 的 `inject/end/expand/message` 命令

2. **Per-hook 状态流**:
   - EventOrchestrator 每 hook 从 SessionStateStore 加载 session state
   - 处理后 save state 回 AgentMemory slot
   - `before_tool_call` 独立从约束 slot 读 (无 daemon 依赖)

3. **Bridge 退役**:
   - `phase1a-bridge.ts` 删除或标记为 `@deprecated` 并保留 30 天
   - 其非生命周期命令迁到 `/praxis` CLI:
     - `shadow-stats` → `/praxis shadow-stats`
     - `scene-log/scene-stats` → `/praxis scene`
     - `learn/show` → `/praxis learn`
   - SignalDetector/SceneRecognizer 业务逻辑保留在 cognitive/ 中 (仍活跃, 见 Phase 11)

4. **OS 调度器注册**:
   - 安装脚本注册 Windows Task Scheduler 任务 (或在 Linux/macOS 上注册 cron)
   - 30min `bun scripts/praxis-cron.ts cron-tick`
   - 5min `bun scripts/praxis-cron.ts heartbeat`
   - daily `bun scripts/praxis-cron.ts meta-audit`

5. **数据迁移 — ~/.praxis-phase1a/ → AgentMemory slot**:
   - Bridge 使用 JSON 文件持久化 (~/.praxis-phase1a/ 目录), 迁移到 SessionStateStore (AgentMemory slot)
   - 迁移脚本: 一次性读取 bridge JSON 文件 → 转换为 SessionStateSnapshot → 写入 `praxis_session_state_<sessionId>` slot
   - 保留 bridge JSON 文件 30 天作为备份, 之后自动清理
   - 空目录或不可读 → 跳过 (graceful degrade)

6. **B6 收尾 — teleologicalMapping**:
   - `loadProtoStructures` 补充 `teleologicalMapping: Array.isArray(item.teleologicalMapping) ? item.teleologicalMapping : []`
   - 影响: teleological-judge.ts 当前从 summary 操作, 补全后可从完整字段操作

### 5.4 测试

- 跨进程 e2e: process A session_start → process B session_end → 融合从持久化状态运行
- `before_tool_call` 独立约束执行 (daemon 下线时仍执行)
- OS 调度器按时触发 cron-tick
- Bridge 输出格式迁移不丢数据

### 5.5 验收

- 生产融合 ≥3 源类型 (llm_marker + mid_session + ≥1 验证器)
- `before_tool_call` 独立于任何常驻进程
- `phase1a-bridge.ts` 退役
- OS 调度器触发定时工作
- 无 Praxis 常驻进程

---

## Phase 6 — T1 完成: ConceptVerifier 接线 `[打破 LLM 自评循环]`

**对应架构**: §4 (7 源融合), §12 原则 2 (LLM 不可靠 → 需独立信号)

### 6.1 当前状态

```typescript
// session-end.ts:181
const verifiers = [new StatisticalVerifier(), new RoleVerifier()];
// ConceptVerifier 未包含 — 需要 LlmClient 构造参数
```

### 6.2 改法

1. 在 session-end.ts 的验证器数组中添加 ConceptVerifier:
   ```typescript
   const verifiers: Verifier[] = [new StatisticalVerifier(), new RoleVerifier()];
   if (this.deps.llm) {
     verifiers.push(new ConceptVerifier(this.deps.llm));
   }
   ```

2. **LlmClient 适配层** (Codex 标记的设计阻塞):
   - `M0Deps.llm` 是 `LlmAdapter` (有 `analyzeTranscript()`/`extractProtoStructures()`)
   - `ConceptVerifier` 期望 `LlmClient` (有 `complete()` 方法)
   - 实现 `adaptLlmClient(adapter: LlmAdapter): LlmClient` — 将 `complete()` 委托给 LlmAdapter 的底层 LLM 调用
   - 或在 `M0Deps` 中增加可选的 `llmClient: LlmClient` 字段

3. VerificationContext 补充 `roleMap` 字段 — RoleVerifier 的 DAG 循环检测依赖此字段, 当前缺失导致该检查始终跳过。

### 6.3 测试

- e2e 断言 ≥3 源类型到达 fuser (llm_marker + mid_session + ≥1 验证器, 当 concept 结构存在时包括 concept_verifier)
- ConceptVerifier 仅对 protoType="concept" 结构产生非零 confidence
- LlmClient 不可用时 ConceptVerifier 不崩溃 (不加入 verifiers 数组)

### 6.4 验收

- 3 个独立验证器全部接入融合管线
- protoType="concept" 结构有来自 concept_verifier 的独立信号
- LLM 自评循环被更彻底地打破

---

## Phase 7 — T10 M2 接线 `[上下文编排落地]`

**对应架构**: §7 (四级压力 × 三档成熟度双轴, Critical Lazy Loading, TaskContext 自动进度, 跨场景消歧)

### 7.1 当前状态

| 模块 | 实现 | 接线 |
|------|------|------|
| `deriveMaturity` | ❌ 不存在 | — |
| `recallStructure` | ✅ `src/memory/recall-structure.ts` | ❌ 从未调用 |
| `applyProgress` | ✅ `src/task-context.ts:90` | ❌ 从未调用 |
| `disambiguate` | ✅ `src/semantic-disambiguator.ts:79` | ❌ 从未调用 |

Maturity 硬编码为 `"competent"` (`session-start.ts:123`)。Critical 压力下 Lazy Loading 未激活。TaskContext 进度从不在 session_end 自动推断。跨场景同形异义词从不在 message_received 消歧。

### 7.2 改法

1. **deriveMaturity(sessionCount: number): MaturityLevel**:
   - 0-10 → "novice", 10-50 → "competent", 50+ → "expert"
   - session_count 从 AgentMemory slot 读取 (session_start 递增)
   - 传入 `organizeContext` → 影响语义粒度 (§7 双轴交互)

2. **recallStructure 接线**:
   - Critical 压力下, `session_start` 构建结构索引 (仅名称+ID+一行描述)
   - 通过 adapter 暴露 `recall_structure` 工具供 LLM 按需拉取
   - 实现 §7 Push+Pull 混合模型

3. **applyProgress 接线**:
   - `session_end` 加载 TaskContext (slot `task_context`)
   - LLM 推断进度变化 (confidence < 0.7 不自动更新)
   - `applyProgress()` → 持久化回 slot

4. **disambiguate 接线**:
   - `message_received` 调用 `disambiguate(userMessage, scenarioContext)`
   - 标注消歧结果 (不修改用户消息, 追加到消息上下文)
   - 场景上下文从 session state 的 active scenarios 获取

### 7.3 测试

- deriveMaturity: 0→novice, 15→competent, 60→expert
- Critical 压力 → recall_structure 工具可用, LLM 按需拉取
- session_end → TaskContext 自动进度更新 (confidence 门控)
- 同形异义词在不同场景中被正确消歧

### 7.4 验收

- M2 全部特性在生产中 live
- §7 双轴交互 (压力 × 成熟度) 实现
- Push+Pull 混合注入模型可用

---

## Phase 8 — 模块重组 `[架构目录对齐, 先于新模块创建]`

**对应架构**: §11 完整模块树

### 8.1 当前 vs 目标

```
当前 (平铺结构):                    目标 (§11):
src/                                src/
├── session-start.ts                ├── index.ts
├── session-end.ts                  ├── config.ts
├── before-tool-call.ts             ├── adapters/
├── after-tool-call.ts              │   ├── adapter-interface.ts  ✅
├── agent-end.ts                    │   ├── base-adapter.ts       ✅
├── message-received.ts             │   ├── openclaw-adapter.ts   ✅
├── cron-tick.ts                    │   ├── claude-code-adapter.ts ✅
├── orchestrator.ts                 │   ├── hermes-adapter.ts     ⭕
├── context-organizer.ts            │   └── codex-adapter.ts      ⭕
├── context-pressure-monitor.ts     ├── orchestration/
├── task-context.ts                 │   ├── orchestrator.ts       ← src/orchestrator.ts
├── attention-telemetry.ts          │   ├── plan-generator.ts     ⭕
├── semantic-disambiguator.ts       │   ├── verifier.ts           ⭕
├── structure-lifecycle.ts          │   ├── progress-tracker.ts   ⭕
├── structure-graph.ts              │   ├── pitfall-matcher.ts    ⭕
├── structure-version.ts            │   ├── task-scheduler.ts     ← src/cognitive/task-scheduler.ts
├── transcript-analyzer.ts          │   ├── subagent-manager.ts   ← src/cognitive/subagent-manager.ts
├── transcript-analyzer-v2.ts       │   ├── heartbeat-monitor.ts  ← src/cognitive/heartbeat-monitor.ts
├── proto-constraint.ts             │   ├── context-pressure-monitor.ts ←
├── constraint-injector.ts          │   ├── scene-recognizer.ts   ← src/cognitive/scene-recognizer.ts
├── constraint-validator.ts         │   ├── context-organizer.ts  ←
├── platform-adapter.ts             │   ├── task-context.ts       ←
├── session-state-store.ts          │   ├── confidence-fuser.ts   ✅
├── m0-deps.ts                      │   └── prediction-protocol.ts ✅
├── llm-client.ts                   ├── analysis/
├── logger.ts                       │   ├── transcript-analyzer.ts ←
├── memory-client.ts                │   ├── statistical-verifier.ts ✅
├── agentmemory-client.ts           │   ├── proto-task.ts         ← src/cognitive/proto-task.ts
├── phase1a-bridge.ts (退役)       │   ├── mid-session-learner.ts ✅
├── analysis/                       │   ├── pitfall-learner.ts    ⭕
│   ├── (15 个文件, 部分正确)       │   ├── role-verifier.ts      ✅
├── orchestration/                  │   ├── concept-verifier.ts   ✅
│   └── (仅 2 个文件)               │   ├── attention-telemetry.ts ←
├── adapters/ ✅                    │   ├── consistency-checker.ts ⭕
├── memory/                         │   ├── degradation-checker.ts ⭕
│   ├── local-cache.ts ✅           │   ├── structure-lifecycle.ts ←
│   └── recall-structure.ts ✅      │   ├── architecture-auditor.ts ✅
├── commands/ (不在 §11 目标中)     │   ├── category-auditor.ts  ✅
└── cognitive/ (55 个文件, 旧代码)  │   ├── config-adapter.ts    ⭕
                                    │   └── semantic-disambiguator.ts ←
                                    ├── hooks/
                                    │   ├── session-start.ts ←
                                    │   ├── message-received.ts ←
                                    │   ├── before-tool-call.ts ←
                                    │   ├── after-tool-call.ts ←
                                    │   ├── agent-end.ts ←
                                    │   ├── session-end.ts ←
                                    │   └── cron-tick.ts ←
                                    ├── files/
                                    │   └── plan-file-writer.ts ⭕
                                    ├── memory/
                                    │   ├── client.ts ← src/memory-client.ts + src/agentmemory-client.ts
                                    │   ├── local-cache.ts ✅
                                    │   ├── recall-structure.ts ✅
                                    │   ├── schemas.ts ⭕
                                    │   ├── slots.ts ⭕
                                    │   └── queries.ts ⭕
                                    ├── prompts/ ⭕ (Phase 10)
                                    ├── types/ ⭕ (Phase 10)
                                    └── cognitive/ (保留: 学习环路核心 + V13 模块)
```

**图例**: ✅ 已在正确位置 | ← 需移动 | ⭕ 需新建

### 8.2 迁移策略

分 3 步, 每步不破坏现有测试:

1. **8A: 创建目标目录并移动文件** (hooks/ + orchestration/ + analysis/ + memory/ + files/ + types/ + prompts/)
   - 创建 `src/hooks/`, 移动 7 个 handler
   - 创建 `src/prompts/`, `src/types/`, `src/files/` 空目录 (内容在 Phase 9-10 填充)
   - 移动根目录 scattered 模块到对应子目录
   - 更新所有 import 路径
   - 验证: 全部 943 测试通过

2. **8B: cognitive/ 清理**
   - 保留活跃模块 (10 个, 见 Phase 11)
   - cognitive-core.ts → 标记 `@deprecated` (已是), 等 Phase 5 bridge 退役后删除
   - 删除 17 个零外部引用且已被取代的模块 (governor, learning-loop, task-assessment, execution-feedback, learning-update, memory-consolidator, metacognitive-engine, gap-detector, proto-task, heartbeat-monitor, timing-controller, strategy-registry, cross-domain-analyzer, subagent-manager, task-scheduler, task-state-machine, signal-quality)
   - 合并重复类型定义 (proto-task.ts ↔ analysis/proto-task-learner.ts)
   - 验证: 全部测试通过

3. **8C: 创建 index.ts 入口**
   - `src/index.ts` 作为公开 API 入口
   - `src/config.ts` 聚合 GovernancePolicy 配置
   - 验证: 外部消费者可通过 `import { EventOrchestrator } from "praxis"` 使用

### 8.3 验收

- 目录结构与 §11 模块树一致
- 全部 943+ 测试通过
- 外部 import 路径稳定

---

## Phase 9 — 缺失架构模块 `[架构完整性, 直接在目标目录中创建]`

**对应架构**: §11 模块树中 15 个无对应实现的模块

### 9.1 orchestration/ (4 个缺失)

| 模块 | 架构定义 | 优先级 | 说明 |
|------|---------|--------|------|
| **plan-generator.ts** | ProtoTask → PlanDocument | P0 | 任务计划生成器。从 ProtoTask 模板 + TaskContext 生成可执行计划 (phases/subtasks/criteria/guidance)。`proto-task-learner.ts` 已实现 ProtoTask 累积学习, plan-generator 是将学习成果转化为执行计划的关键环节 |
| **verifier.ts** | 5 种验收标准 | P1 | 统一验证器 — command_output/file_existence/test_pass/llm/user_approval。当前 3 个独立验证器 (statistical/role/concept) 验证的是 ProtoStructure 质量, 不是子任务验收。verifier.ts 是任务编排的验收层 |
| **progress-tracker.ts** | 进度事件收集 + 摘要 | P2 | 从 after_tool_call + agent_end 收集进度事件, 生成进度摘要 |
| **pitfall-matcher.ts** | 陷阱实时命中检测 | P2 | 子任务失败时匹配 ProtoTask.common_pitfalls, 命中反馈到 ProtoTask 置信度 |

### 9.2 analysis/ (4 个缺失)

| 模块 | 架构定义 | 优先级 | 说明 |
|------|---------|--------|------|
| **pitfall-learner.ts** | 陷阱反馈学习 | P1 | 陷阱命中 → 置信度更新 + ProtoTask 增强 + 误报率控制 (>30% 自动降 severity) |
| **consistency-checker.ts** | 跨结构一致性验证 | P2 | 检测 ProtoStructure 之间的逻辑矛盾 (如两个 ProtoConstraint 不能同时满足) |
| **degradation-checker.ts** | 衰退条件检测 | P2 | 补充 structure-lifecycle.ts — 检测结构是否满足衰退条件 (60 天未引用/置信度跌破阈值/被替代结构覆盖) |
| **config-adapter.ts** | 配置自适应 | P2 | 根据 GovernancePolicy 运行时调整模块行为 (如动态调整 curiosity 阈值) |

### 9.3 memory/ (3 个缺失)

| 模块 | 架构定义 | 优先级 | 说明 |
|------|---------|--------|------|
| **memory/schemas.ts** | JSON Schema 定义 | P1 | ProtoStructure/ProtoTask/CompetencyModel 等的 JSON Schema 定义, 用于 AgentMemory 验证和文档生成 |
| **memory/slots.ts** | Slot 名称+大小+版本 | P1 | 集中管理所有 AgentMemory slot 名称, 替代散落在 `cognitive/constants.ts` 中的定义 |
| **memory/queries.ts** | 复合查询封装 | P2 | 封装常见复合查询 (如"获取所有 crystallized 约束"、"按场景检索相关结构") |

### 9.4 files/ (1 个缺失)

| 模块 | 架构定义 | 优先级 |
|------|---------|--------|
| **files/plan-file-writer.ts** | task_plan.md / progress.md / findings.md | P2 |

### 9.5 实施策略

> **关键**: Phase 8 已完成目录重组, 新模块直接在目标目录 (`src/orchestration/`, `src/analysis/`, `src/memory/`, `src/files/`) 中创建, 无需后续移动。

Phase 9 的 15 个模块按优先级分两批:
- **9A (P0-P1)**: plan-generator, verifier, pitfall-learner, memory/schemas, memory/slots — 核心功能闭环
- **9B (P2)**: progress-tracker, pitfall-matcher, consistency-checker, degradation-checker, config-adapter, memory/queries, files/plan-file-writer — 完善和收尾

### 9.6 验收

- 每个新模块有独立测试文件
- plan-generator 能将 ProtoTask + TaskContext → 可执行 PlanDocument
- verifier 支持至少 3 种验收标准
- 不引入对已完成模块的回归

---

## Phase 10 — Prompts + Types + Files `[基础设施补全]`

**对应架构**: §11 (prompts/ + types/ + files/)

### 10.1 prompts/ (13 个文件)

当前 prompts 逻辑硬编码在 TypeScript 源码中 (如 `constraint-injector.ts` 生成约束段, `context-organizer.ts` 生成分层上下文)。架构文档要求将 prompt 模板提取为独立 .md 文件, 分离"逻辑"和"文本"。

| 文件 | 内容 | 优先级 |
|------|------|--------|
| `prompts/system/memory-context.md` | 认知状态概览 | P0 |
| `prompts/system/plan-injection.md` | 任务计划 + 认知指导 (GuidanceSignal) | P0 |
| `prompts/system/constraint-injection.md` | CRITICAL CONSTRAINTS 段 | P0 |
| `prompts/system/prediction-markers.md` | 预测协议说明 | P1 |
| `prompts/system/critical-mode.md` | Critical 压力下的极简格式 | P1 |
| `prompts/analysis/extract-and-update.md` | transcript → ProtoStructures + LearningEvents | P0 |
| `prompts/analysis/construct-proto-task.md` | task_history → ProtoTask | P1 |
| `prompts/analysis/generate-plan.md` | ProtoTask + TaskContext → PlanDocument | P1 |
| `prompts/analysis/verify-progress.md` | 自动进度推断 | P1 |
| `prompts/analysis/consistency-scan.md` | 结构一致性检查 | P2 |
| `prompts/analysis/audit-architecture.md` | 对抗性架构审计 | P2 |
| `prompts/user/perception-summary.md` | 会话感知摘要 | P2 |
| `prompts/user/crystallization-proposal.md` | 结晶化审批提案 | P2 |

**改法**:
- 将 `constraint-injector.ts` 中的 CRITICAL CONSTRAINTS 格式化逻辑提取到 `constraint-injection.md`
- 将 `transcript-analyzer.ts`/`transcript-analyzer-v2.ts` 中的 LLM prompt 提取到 `extract-and-update.md`
- 新增的 plan-generator (Phase 9) 直接使用 `generate-plan.md`

### 10.2 types/ (3 个文件)

当前类型定义散落在 `cognitive/types.ts` (730+ 行), `analysis/types.ts`, `orchestration/` 和各个模块中。

| 文件 | 内容 | 来源 |
|------|------|------|
| `types/memory.ts` | ProtoStructure, ProtoTask, LearningEvent, CompetencyModel... | 从 `cognitive/types.ts` 提取 |
| `types/scene.ts` | Scenario, TaskContext, GuidanceSignal... | 从 `cognitive/types.ts` 提取 |
| `types/hooks.ts` | Hook 上下文类型 | 从各 handler 文件中提取 |

**改法**: 非破坏性提取 — 保持原来的 `cognitive/types.ts` 重新导出新文件, 逐步迁移消费者。

### 10.3 验收

- 所有 prompt 模板可从 .md 文件独立编辑
- types/ 文件是单一真相源, 原有类型文件重新导出
- 现有测试全部通过

---

## Phase 11 — 适配器补全 + 收尾 `[低优先级, 生态完善]`

### 11.1 Hermes + Codex 适配器

基于 `base-adapter.ts` (T18) 的共享工厂, 实现两个新适配器:

- **hermes-adapter.ts**: Hermes Agent 运行时 → Praxis 标准事件
- **codex-adapter.ts**: OpenAI Codex CLI → Praxis 标准事件

每个适配器 ~20-50 行 (复用 base-adapter 的 90% 映射逻辑), 仅覆盖平台特定差异。

### 11.2 cognitive/ 最终清理

Phase 8 重组后, cognitive/ 保留以下模块:

| 保留原因 | 模块 |
|---------|------|
| 学习环路核心 | metacognitive-engine, governor, learning-loop, task-assessment, execution-feedback, learning-update, memory-consolidator, timing-controller, signal-detector, signal-quality |
| V13 主动驱动 | task-scheduler, heartbeat-monitor, subagent-manager |
| 场景识别 | scene-recognizer, scenario-registry, scenario-cache |
| 支持模块 | types, constants, context, sanitize, embedding, inmemory-client, proto-task, gap-detector, strategy-registry, cross-domain-analyzer, index |

**清理操作**:
- `cognitive-core.ts`: Phase 5 bridge 退役后删除 (当前仅被 phase1a-bridge 使用)
- 重复类型合并: `proto-task.ts` 的类型定义与 `analysis/proto-task-learner.ts` 合并到 `types/memory.ts`
- `index.ts`: 更新重导出路径, 指向重组后的模块位置

### 11.3 M3.4 约束自动提取 (继续延后)

依赖 M4 statistical-verifier 的生产数据积累。Phase 5 生产上线后, 积累 20+ session 数据再评估启动条件。

---

## 12. 不在此计划中的事项

与 ROADMAP.md "不在此路线图中的事项" 一致:

- **多模态记忆**: 架构 §9 imageRef + vision_search — 无实际需求驱动
- **GUI 查看器**: `/praxis status` 文本报告优先
- **跨团队联邦学习**: M6 完成后不考虑
- **Process Engine 完整实现**: 已被 TaskOrchestrator + HeartbeatMonitor 覆盖
- **§6 subagent 真实 spawn + scheduleTurn 真实调度**: 依赖宿主 API (D3 slot-stub 兜底)

---

## 13. 里程碑时间线

| 阶段 | 预计工作量 | 关键交付 |
|------|-----------|---------|
| **Phase 5** (T9) | ✅ 已完成 2026-06-28 | bridge 退役 + bun 入口脚本 + 共享 deps + B6 fix |
| **Phase 6** (T1 完成) | 小 (ConceptVerifier + LlmClient 适配层 + VerificationContext 修复) | 3 验证器全部接入 |
| **Phase 7** (T10) | 中 (deriveMaturity + 接线 3 个模块) | M2 上下文编排完整 |
| **Phase 8** (模块重组) | 大 (文件移动 + import 更新 + cognitive/ 17 模块删除) | 目录结构对齐 §11 |
| **Phase 9** (缺失模块) | 大 (15 个新模块, 直接在目标目录创建) | 架构模块完整 |
| **Phase 10** (Prompts+Types) | 中 (17 个文件) | 基础设施完整 |
| **Phase 11** (适配器+清理) | 小 (2 个适配器 + cognitive 最终清理) | v1.0.0.0 |

---

## 14. 架构一致性检查清单

每完成一个 Phase, 对照以下清单:

- [ ] 新代码的行为是否与架构文档 §1-§13 一致?
- [ ] 是否有代码与架构文档冲突但被保留? (必须文档化偏离理由)
- [ ] 是否引入了新的临时方案或硬编码? (必须标记 TODO + 指向对应 Phase)
- [ ] 测试是否覆盖了架构文档要求的行为 (不仅是实现细节)?
- [ ] CHANGELOG.md + ROADMAP.md 是否更新?

---

> **下一步**: Phase 6 开工 — ConceptVerifier 接线 + LlmClient 适配层。Phase 5 已完成: bun per-hook 入口就绪, bridge 已弃用, 共享 deps 工厂就位, B6 teleologicalMapping 补完。
> **架构参考**: [praxis-architecture.md](../architech/praxis-architecture.md)
> **当前状态参考**: [ROADMAP.md](../docs/ROADMAP.md), [wiring-debt-dev-plan.md](../docs/wiring-debt-dev-plan.md)

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 5 | clean | 4 sections: zero findings across Architecture, Code Quality, Tests, Performance |
| Outside Voice | codex (plan challenge) | Independent 2nd opinion | 1 | issues_found | 5 critiques resolved: (1) Phase 5 data migration added; (2) LlmClient adapter explicit in Phase 6; (3) Phase 9 15 modules confirmed per arch doc; (4) sequencing fixed — Phase 8 reorg before Phase 9 modules; (5) prompts loaded at import time, not per-hook disk I/O |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a (no UI) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** 5 findings — all addressed: data migration (§5.3.5), LlmClient adapter (§6.2.2), architecture modules confirmed per user decision, sequencing reversed (Phase 8 reorg first), prompts at import time.
- **CROSS-MODEL:** All 3 tensions resolved by user decisions: Phase 9 scope = full 15 modules per architecture doc; bun per-hook = Phase 0.5 59ms verified; sequencing = Phase 8 reorg → Phase 9 new modules in target layout.
- **VERDICT:** ENG REVIEW CLEARED — zero findings, all cross-model tensions resolved. Plan finalized: `remains-dev-plan.md` ready for Phase 5 implementation.

NO UNRESOLVED DECISIONS
