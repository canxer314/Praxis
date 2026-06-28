# Praxis Specification v1.0.0.0

> 技术规格文档 — 架构、模块、API 参考。  
> 应用层文档: [README.md](../README.md) | 完整架构: [praxis-architecture.md](../architech/praxis-architecture.md)

---

## 架构

### 六层认知架构

```
L6: 自主决策层 — proficiency × risk → proceed/inform/confirm/block
L5: 能力模型层 — 8D 能力评估
L4: 学习闭环层 — 执行→评估→差距→更新→固化 + Curiosity Engine
L3: 知识管理层 — 5 类知识 + 缺口追踪 + 跨场景语义消歧
L2: 任务编排层 — 两层嵌套状态机 + plan-generator + verifier + pitfall-tracker
L1: 工具集成层 — 工具注册/发现/熟练度追踪
```

### 三层运行时拓扑

```
AgentMemory (持久存储) ←MCP→ Praxis (认知引擎) ←适配器→ Agent 运行时
```

支持的 Agent 运行时: OpenClaw / Claude Code / Hermes / Codex

---

## 核心概念

### ProtoStructure — 认知基本单元

5 种类型: ProtoSequence | ProtoRole | ProtoConcept | ProtoPurpose | ProtoConstraint

每个结构带: confidence (0-1) / lifecycle (6 states) / relations (6 types) / versionChain

### 7 源置信度融合

| 信号源 | 权重 | 独立性 |
|--------|------|--------|
| statistical | 0.25 | 独立于 LLM |
| llm_marker | 0.25 | 来自 LLM |
| user_correction | 0.12 | 独立 |
| role_verifier | 0.12 | 独立 |
| concept_verifier | 0.08 | 独立 |
| outcome_feedback | 0.10 | 独立 |
| mid_session | 0.08 | 独立 |

### 7 个生命周期事件

| 事件 | 触发时机 | Praxis 操作 |
|------|---------|------------|
| session_start | 会话开始 | 加载记忆 → 场景识别 → 压力测量 → 注入 context |
| message_received | 收到消息 | 语义分析 → 检测纠正 → MidSessionLearner |
| before_tool_call | 工具调用前 | 自主性决策 → 约束检查 → proceed/inform/confirm/block |
| after_tool_call | 工具调用后 | 追踪 → 信号匹配 → 暂存学习事件 |
| agent_end | Agent 停止 | 汇总 → 统计验证 → 任务反思 |
| session_end | 会话结束 | 全量分析 → 置信度融合 → 进度推断 → 持久化 |
| cron_tick | 定时触发 | 模式挖掘 + 停顿检测 + 自主学习 |

### Result\<T\> 模式

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
```

---

## 模块树

```
src/
├── adapters/              # Agent 运行时适配器
│   ├── adapter-interface.ts, base-adapter.ts
│   ├── openclaw-adapter.ts, claude-code-adapter.ts
│   └── hermes-adapter.ts, codex-adapter.ts
├── orchestration/          # 编排层
│   ├── orchestrator.ts     # EventOrchestrator — 7 事件入口
│   ├── plan-generator.ts   # ProtoTask → PlanDocument
│   ├── verifier.ts         # 5 种验收标准
│   ├── progress-tracker.ts, pitfall-matcher.ts
│   ├── context-organizer.ts, context-pressure-monitor.ts
│   ├── task-context.ts, confidence-fuser.ts
│   ├── constraint-injector.ts, constraint-validator.ts
│   └── maturity.ts, session-state-store.ts, prediction-protocol.ts
├── analysis/               # 分析层
│   ├── transcript-analyzer.ts, transcript-analyzer-v2.ts
│   ├── statistical-verifier.ts, role-verifier.ts, concept-verifier.ts
│   ├── mid-session-learner.ts, proto-task-learner.ts
│   ├── attention-telemetry.ts, semantic-disambiguator.ts
│   ├── structure-lifecycle.ts, structure-graph.ts, structure-version.ts
│   ├── consistency-checker.ts, degradation-checker.ts
│   ├── architecture-auditor.ts, category-auditor.ts
│   ├── config-adapter.ts, pitfall-learner.ts
│   └── curiosity-engine.ts, quinean-gating.ts, structure-retirement.ts
├── hooks/                  # 生命周期事件处理器
├── memory/                 # AgentMemory 接口
├── prompts/                # Prompt 模板 (13 .md files)
├── types/                  # 类型定义入口点
├── files/                  # 文件持久化
└── cognitive/              # 保留: types, constants, context, scene
```

---

## API 参考

### EventOrchestrator

```ts
import { EventOrchestrator, buildM0Deps } from "@praxis/cognitive-core";

const deps = buildM0Deps();
const orch = new EventOrchestrator(deps);

await orch.handleSessionStart("session-id");
await orch.handleMessageReceived("session-id", { role: "user", content: "..." });
await orch.handleSessionEnd("session-id", transcript);
```

### PlanGenerator

```ts
import { generatePlan, formatPlanForInjection } from "@praxis/cognitive-core";

const plan = generatePlan(protoTask, taskContext);
// → PlanDocument { phases, pitfalls, guidanceSignals }
```

### Verifier (5 验收标准)

```ts
import { createVerificationCriterion, evaluateCriterion } from "@praxis/cognitive-core";
// command_output | file_existence | test_pass | llm | user_approval
```

### PitfallMatcher

```ts
import { matchPitfalls } from "@praxis/cognitive-core";

const hits = matchPitfalls(pitfalls, "接口变更导致集成测试失败");
```

### ProgressTracker

```ts
import { createProgressTracker, recordProgressEvent, generateProgressSummary } from "@praxis/cognitive-core";
```

---

## GovernancePolicy 配置

```yaml
autonomy:
  default_policy: { unknown_operation: "confirm", low_risk_known: "inform", high_risk_known: "confirm" }
context_pressure:  { normal: 400K, elevated: 250K, high: 100K, critical: 50K }
task_context:      { auto_update_confidence_threshold: 0.7 }
pitfall_tracking:   { auto_downgrade_misrate: 0.3 }
curiosity:          { mode: "ask_when_confident" }
```

---

## 设计原则

1. **Context Orchestration Layer** — 唯一执行方式是注入 LLM 上下文
2. **LLM 不可靠** — 验证包含独立信号 (统计/角色/概念验证器)
3. **从原子化到关系化** — 置信度沿关系图传播 (≤3 跳，确定性逻辑)
4. **从事后检测到事前约束** — before_tool_call 拦截违规
5. **优雅降级** — 4 级压力自适应 + Lazy Loading
6. **知行闭环** — GuidanceSignal 驱动执行，OutcomeFeedback 反馈知识
7. **人类治理** — 新结构创建需审批，任何结构可回滚
8. **元认知自检** — Meta Layer 周期性审计框架缺陷

---

## 相关文档

- [架构设计](../architech/praxis-architecture.md) — 完整 §1-§13
- [路线图](ROADMAP.md) — M0-M6 里程碑
- [开发计划](remains-dev-plan.md) — Phase 5-11 实施记录
- [提示词模板](../src/prompts/) — 13 个 .md prompt 模板
