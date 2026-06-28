# Praxis — AI 认知操作系统

赋予 LLM 跨会话记忆、学习和任务编排能力。Praxis 在无状态 LLM 与外部世界之间作为中间件运行，让 AI 不再每次都从零开始。

**当前版本**: `v1.0.0.0` | **873 tests, 71 files, typecheck clean**

---

## 一句话理解 Praxis

> Praxis 是 AI 的大脑皮层。它从对话和工具调用中自动提取结构化知识（ProtoStructure），赋予置信度，在下次任务前把相关经验注入 LLM 上下文窗口。学到的不仅是"怎么用工具"，还包括"任务怎么做"、"领域里有什么"、"自己还缺什么"。

---

## 核心能力

| 能力 | 说明 | 架构 |
|------|------|------|
| **认知结构系统** | 5 种 ProtoStructure 类型 + 关系图 + 版本链 + 生命周期状态机 | §3 |
| **多源置信度融合** | 7 个独立信号源加权融合 — 打破 LLM 自评循环 | §4 |
| **上下文编排** | 4 级压力自适应 + Tier A/B/C 分层注入 + Lazy Loading | §7 |
| **约束系统** | block/confirm/warn 三级约束 — before_tool_call 在 LLM 犯错前拦截 | §3 §10 |
| **任务编排** | ProtoTask 模板 → PlanDocument + 5 种验收标准 + 陷阱追踪 | §5 |
| **自主学习** | MidSessionLearner 实时修正 + Curiosity Engine 主动缺口检测 | §4 |
| **元认知** | Meta Layer 范畴审计 — 框架本身是否有盲区 | §8 |
| **多运行时适配** | 5 个适配器 (OpenClaw / Claude Code / Hermes / Codex / 基类) | §1 |

---

## 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│ L6: 自主决策层 — proficiency × risk → proceed/inform/confirm/block │
│ L5: 能力模型层 — 8D 能力评估 (工具/领域/任务/用户/过程/可靠性/原型/速度) │
│ L4: 学习闭环层 — 执行→评估→差距→更新→固化 + Curiosity Engine       │
│ L3: 知识管理层 — 5 类知识 + 缺口追踪 + 跨场景语义消歧              │
│ L2: 任务编排层 — 两层嵌套状态机 + plan-generator + verifier       │
│ L1: 工具集成层 — 工具注册/发现/熟练度追踪                          │
├──────────────────────────────────────────────────────────────┤
│ 横切: Meta Layer (范畴审计) + Context Orchestration (上下文编排)   │
└──────────────────────────────────────────────────────────────┘
```

Praxis 通过适配器层接入 5 种 Agent 运行时（OpenClaw / Claude Code / Hermes / Codex），适配器只做协议转换，不做认知处理。

---

## 快速开始

```bash
npm install
npm test              # vitest — 873 tests
npm run typecheck     # tsc --noEmit
```

### 基础用法

```ts
import { EventOrchestrator, buildM0Deps } from "@praxis/cognitive-core";

// 创建依赖注入容器 (AgentMemory + Cache + LLM + Fuser)
const deps = buildM0Deps({ memoryDir: "~/.praxis" });

// 创建编排器
const orchestrator = new EventOrchestrator(deps);

// 标准生命周期: session_start → message_received → session_end
await orchestrator.handleSessionStart("session-001");
await orchestrator.handleMessageReceived("session-001", {
  role: "user", content: "帮我部署 v2.1.0 到生产环境"
});
await orchestrator.handleSessionEnd("session-001", transcript);
```

### 任务计划生成 (Phase 9)

```ts
import { generatePlan, formatPlanForInjection } from "@praxis/cognitive-core";

const plan = generatePlan(protoTaskTemplate, taskContext);
const injectionText = formatPlanForInjection(plan);
// → "## Task Plan\n\n**Task**: 部署 v2.1.0\n### Phase 1: pre-deploy..."
```

### 验收标准 (Phase 9)

```ts
import { createVerificationCriterion, evaluateCriterion } from "@praxis/cognitive-core";

const c = createVerificationCriterion("test_pass", { command: "npm test" });
const result = evaluateCriterion(c, runCommand, undefined, parseTestOutput);
// → { passed: true, type: "test_pass", detail: "Tests passed: 873/873" }
```

---

## 项目结构

```
src/
├── adapters/              # Agent 运行时适配器 (协议转换, 不做认知)
│   ├── adapter-interface.ts, base-adapter.ts (共享工厂)
│   ├── openclaw-adapter.ts, claude-code-adapter.ts
│   ├── hermes-adapter.ts, codex-adapter.ts
├── orchestration/          # 编排层: 决定"什么信息何时进入 LLM"
│   ├── orchestrator.ts     # EventOrchestrator — 7 事件统一入口
│   ├── plan-generator.ts   # ProtoTask → PlanDocument
│   ├── verifier.ts         # 5 种验收标准执行
│   ├── progress-tracker.ts, pitfall-matcher.ts
│   ├── context-organizer.ts, context-pressure-monitor.ts
│   ├── task-context.ts, confidence-fuser.ts
│   ├── constraint-injector.ts, constraint-validator.ts
│   ├── maturity.ts, session-state-store.ts, prediction-protocol.ts
│   └── proto-constraint.ts
├── analysis/               # 分析层: 从原始数据提取认知结构
│   ├── transcript-analyzer.ts, transcript-analyzer-v2.ts
│   ├── statistical-verifier.ts, role-verifier.ts, concept-verifier.ts
│   ├── mid-session-learner.ts, proto-task-learner.ts
│   ├── attention-telemetry.ts, semantic-disambiguator.ts
│   ├── structure-lifecycle.ts, structure-graph.ts, structure-version.ts
│   ├── consistency-checker.ts, degradation-checker.ts
│   ├── architecture-auditor.ts, category-auditor.ts
│   ├── config-adapter.ts, pitfall-learner.ts
│   ├── curiosity-engine.ts, quinean-gating.ts, structure-retirement.ts
│   ├── cross-agent-sync.ts, teleological-judge.ts
│   ├── structural-gap-detector.ts, llm-adapter.ts
│   └── types.ts, index.ts
├── hooks/                  # 标准生命周期事件处理器
│   ├── session-start.ts, session-end.ts
│   ├── message-received.ts
│   ├── before-tool-call.ts, after-tool-call.ts
│   ├── agent-end.ts, cron-tick.ts
├── memory/                 # AgentMemory 接口
│   ├── client.ts, local-cache.ts, recall-structure.ts
│   ├── schemas.ts, slots.ts, queries.ts
├── prompts/                # Prompt 模板 (Handlebars {{variable}} 语法)
│   ├── system/ (5 files), analysis/ (6 files), user/ (2 files)
├── types/                  # TypeScript 类型定义入口点
│   ├── memory.ts, scene.ts, hooks.ts
├── files/                  # 文件持久化
│   └── plan-file-writer.ts
├── cognitive/              # 保留模块: 类型, 常量, 场景, 上下文, 嵌入
└── scripts/
    ├── praxis-hook.ts      # bun per-hook 生产入口 (~59ms/hook)
    └── praxis-cron.ts      # OS cron per-tick 入口
```

---

## 关键概念

### ProtoStructure — 认知基本单元

5 种类型: **ProtoSequence** (行为序列), **ProtoRole** (角色关系), **ProtoConcept** (概念定义), **ProtoPurpose** (目标意图), **ProtoConstraint** (约束公理)。每个结构带置信度、关系图、版本链、生命周期。

### Result\<T\> 模式

所有异步 API 返回 discriminated union，调用方通过 `result.ok` 分支：

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
```

### 7 源置信度融合

statistical (0.25) + llm_marker (0.25) + user_correction (0.12) + role_verifier (0.12) + concept_verifier (0.08) + outcome_feedback (0.10) + mid_session (0.08)

---

## 设计原则

1. **Context Orchestration Layer** — 唯一"执行"方式: 在正确时间以正确格式注入正确信息到 LLM 上下文
2. **LLM 不可靠** — 验证必须包含独立于 LLM 的信号 (统计/角色/概念验证器)
3. **从原子化到关系化** — 结构间有显式关系边，置信度沿依赖图传播 (≤3 跳，确定性逻辑)
4. **从事后检测到事前约束** — 已结晶约束在 LLM 调用前注入，before_tool_call 拦截违规
5. **优雅降级** — 4 级压力自适应，Critical 下仍保留结构索引 + Lazy Loading
6. **知行闭环** — 知识驱动执行 (GuidanceSignal)，执行反馈知识 (置信度调整)
7. **人类治理** — 新结构创建需审批；任何结构可回滚到任意历史版本
8. **元认知自检** — Meta Layer 周期性审计框架本身是否有缺陷

---

## 架构迭代 (V1 → V13)

| 版本 | 核心问题 | 关键引入 |
|------|---------|---------|
| V1-V6 | 认知架构基础 | 六层架构 + 4 记忆类型 + 能力模型 + ProtoStructure |
| V7-V9 | 工程落地 | Context Orchestration + Tier A/B/C + 4 级压力自适应 |
| V10-V12 | 任务闭环 | TaskContext + ProtoTask + 两层嵌套状态机 + 验收标准 |
| V13 | 主动驱动 | TaskScheduler + SubagentManager + HeartbeatMonitor |

完整设计: [`architech/praxis-architecture.md`](architech/praxis-architecture.md)

---

---

## 相关文档

- [架构设计](architech/praxis-architecture.md) — 完整六层架构 + ProtoStructure + 学习引擎 + 编排引擎
- [路线图](docs/ROADMAP.md) — M0-M6 里程碑完成状态
- [开发计划](docs/remains-dev-plan.md) — Phase 5-11 详细实施记录
- [架构演变史](architech/praxis-changelog.md) — V1→V13 完整演变
- [原始设计迭代](draft/) — 每版本 why/what/how
- [CLAUDE.md](CLAUDE.md) — AI 行为准则
