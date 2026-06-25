# Praxis — AI 认知操作系统

赋予 LLM 人类般的记忆、学习和任务编排能力。Praxis 在 AI 推理引擎与外部世界之间作为中间件运行，将无状态的 LLM 升级为跨会话持续成长的认知代理。

**当前版本**: `v0.7.2.0` | **架构迭代**: V13 (完整认知引擎) | **阶段**: Phase 3 (主动驱动)

---

## 一句话理解 Praxis

> Praxis 是 AI 的"大脑皮层"——它记住每次任务中学到的东西，在下次任务前把相关经验注入 LLM 的上下文窗口，让 AI 不再每次都从零开始。

## 核心能力

| 能力 | 说明 | 版本 |
|------|------|------|
| **记忆与学习** | 4 种记忆类型(情景/程序/语义/元认知) + 跨会话学习闭环 | V1 |
| **能力模型** | 8 维能力评估(工具/领域/任务/用户/过程/可靠性/原型认知/学习速度) | V1-V6 |
| **场景感知** | 识别当前交互场景，匹配已有认知结构，注入相关经验 | V7 |
| **任务编排** | 两层嵌套状态机 + ProtoTask 模板 + 5 种验收标准 + 陷阱追踪 | V12 |
| **主动驱动** | TaskScheduler + SubagentManager + HeartbeatMonitor — 自主推进任务 | V13 |
| **上下文自适应** | 4 级压力感知 + Tier A/B/C 分层注入 + Lazy Loading | V9 |
| **零先验学习** | 在完全陌生的场景中从零构建认知结构(ProtoStructure) | V6 |
| **统计验证** | 独立于 LLM 的工具序列验证 — 打破"LLM 自己验证自己"的闭环 | V8 |

---

## 架构概览

```
┌────────────────────────────────────────────┐
│              用户 (User)                    │
└────────────────┬───────────────────────────┘
                 │ 对话、任务分配、反馈
                 ▼
┌────────────────────────────────────────────┐
│         AI 推理引擎 (LLM)                   │
│         • 通用推理能力                      │
│         • 无状态、无记忆                     │
└────────────────┬───────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
    ▼                         ▼
┌──────────────┐    ┌────────────────────────┐
│   Praxis     │◀──▶│    AgentMemory         │
│  (Harness)   │    │    (持久存储)           │
│              │    │                        │
│ • 能力模型   │    │ • 记忆存储/检索         │
│ • 学习闭环   │    │ • Slot 状态管理         │
│ • 任务编排   │    │ • 知识图谱              │
│ • 自主决策   │    │ • 版本链/衰减/治理      │
│ • 主动调度   │    │                        │
└──────┬───────┘    └────────────────────────┘
       │
       │ MCP / REST / WebSocket
       ▼
┌────────────────────────────────────────────┐
│            外部世界 (The World)             │
│  • OpenClaw / Claude Code (计算机操作)      │
│  • MCP Servers (工具集成)                  │
│  • IoT 设备 / API / 数据库                 │
└────────────────────────────────────────────┘
```

### 六层架构 (V1)

```
L6: 自主决策层 — proficiency × risk → 自主执行/通知/确认/阻止
L5: 能力模型层 — 8D 能力评估 (工具/领域/任务/用户/过程/可靠性/原型/速度)
L4: 学习闭环层 — 执行→评估→差距→更新→固化 + Curiosity Engine
L3: 知识管理层 — 5 类知识(领域/任务/用户/流程/工具) + 缺口追踪
L2: 任务编排层 — 两层嵌套状态机 + ProtoTask + 验收 + 陷阱追踪
L1: 工具集成层 — 工具注册/发现/熟练度追踪
```

---

## 快速开始

```bash
npm install
npm test              # vitest 运行全部测试
npm run typecheck     # TypeScript 类型检查
```

### 基础用法

```ts
import { CognitiveCore, InMemoryMemoryClient } from "@praxis/cognitive-core";

// 创建核心实例
const core = new CognitiveCore({
  memoryClient: new InMemoryMemoryClient(),
});

// 每个 session 创建隔离实例
const session = core.createSession("session_001");

// 任务前评估 — 检索相关记忆，评估自身能力
const assessment = await session.assessTask("bug_fix", "typescript");
// => { ok: true, value: { metacognitive: { selfRating: 0.75, ... }, episodic: [...] } }

// 捕获用户修正 — 实时学习
session.captureCorrection(
  { what: "used old API", correctedTo: "use new API v2",
    likelyRootCause: "API migration", isNewKnowledge: true },
  { sessionId: "session_001", hasExplicitRejection: true,
    taskType: "bug_fix", domain: "typescript" }
);

// Session 结束 — 学习提取 + 持久化
await session.finalizeLearning(
  { sessionId: "session_001", hasExplicitRejection: false,
    taskType: "bug_fix", domain: "typescript" },
  "typescript"
);
```

### 任务编排 (V12-V13)

```ts
import { advanceTask, advanceSubtask, isTaskTerminal } from "@praxis/cognitive-core";

// 任务状态机: TASK_NOT_STARTED → TASK_IN_PROGRESS → TASK_COMPLETE
const result = advanceTask("TASK_NOT_STARTED", "TASK_ASSESSING");
// => { ok: true, value: { newState: "TASK_ASSESSING" } }

// ProtoTask: 零样本任务模板
import { bootstrapProtoTask } from "@praxis/cognitive-core";
const protoTask = await bootstrapProtoTask({ taskType: "software_project", llmClient });
// => { phases: [...], pitfalls: [...], confidence: 0.2 }
```

### 主动驱动 (V13)

```ts
import { TaskScheduler, SubagentManager, HeartbeatMonitor } from "@praxis/cognitive-core";

// 任务调度 — 决定何时触发/调度/委派
const scheduler = new TaskScheduler({ memoryClient });
const decision = await scheduler.evaluate(taskContext);

// 子 Agent 管理 — 并行子任务 + 失败隔离
const manager = new SubagentManager({ memoryClient, executionAPI });
const run = await manager.spawnSubagent({ subtask, pitfalls, criteria });

// 心跳监控 — 停顿检测 + 升级
const monitor = new HeartbeatMonitor({ memoryClient, onStall });
const check = await monitor.check(taskId);
```

---

## API 模块

| 模块 | 职责 | 版本 |
|------|------|------|
| `CognitiveCore` | 主入口 — 构造注入 + session 隔离 | V1 |
| `SessionCognitiveCore` | 会话级认知实例 | V1 |
| `MetacognitiveEngine` | 元认知自评 + 回顾性校准 | V1 |
| `LearningLoop` | 3 阶段学习环路编排(评估→执行→更新) | V1 |
| `Governor` | 学习决策编排器 — 4 阶段管道(检测→分类→门控→更新) | Phase 1 |
| `ProtoTask` | 零样本任务模板 — bootstrap + 累积成长 | V11 |
| `task-state-machine` | 两层嵌套状态机(任务级+子任务级) | V12 |
| `TaskScheduler` | 主动调度决策(触发条件×调度策略) | V13 |
| `SubagentManager` | 子 Agent 生命周期管理 + 并行控制 | V13 |
| `HeartbeatMonitor` | 心跳停顿检测(3 级: 提醒→唤醒→升级) | V13 |
| `SceneRecognizer` | 场景识别 — LLM 驱动的场景分类 | Phase 2 |
| `TranscriptAnalyzer` | 会话 transcript → 结构化学习事件 | V8 |
| `SignalDetector` | 用户修正信号检测 | Phase 1 |
| `ScenarioRegistry` | 场景模板注册表 + 种子场景 | Phase 0 |
| `MemoryConsolidator` | 跨会话记忆巩固 | Phase 2.3 |
| `GapDetector` | 知识缺口检测 | E6 |
| `StrategyRegistry` | 策略生命周期管理(提出→验证→应用) | E4 |
| `CrossDomainAnalyzer` | 跨领域技能迁移分析 | E5 |
| `Embedding` | 文本向量化(HuggingFace Transformers) | Phase 2 |

### Result\<T\> 模式

所有异步 API 返回 discriminated union，无需 try-catch：

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
```

---

## 架构迭代历程 (V1 → V13)

Praxis 的架构经历了 13 个迭代版本，每个版本解决一个核心问题：

| 版本 | 核心问题 | 关键引入 |
|------|---------|---------|
| **V1** | AI 需要什么认知架构？ | 六层架构 + 4 记忆类型 + 能力模型 + 学习闭环 |
| **V2** | 架构载体是什么？ | OpenClaw Memory Plugin + 三层模型(AgentMemory↔Praxis↔OpenClaw) |
| **V3** | 学什么、谁发起？ | 4D 能力模型 + Curiosity Engine + 主动提问 |
| **V4** | 下一步该干什么？ | Process Engine + Role Model + Momentum Engine |
| **V5** | 框架本身有问题怎么办？ | Meta Layer + StructuralGap + 认知结构注册表 |
| **V6** | 完全陌生场景怎么办？ | Proto-Cognitive Engine + ProtoStructure + 预测协议 |
| **V7** | 怎么工程落地？ | Context Orchestration Layer + 第一个具体模块树 |
| **V8** | 1M 上下文改变什么？ | 统计验证器 + Tier A/B/C + 删除 token 妥协模块 |
| **V9** | 上下文不够用怎么办？ | 4 级压力自适应 + Lazy Loading + 注意力遥测 |
| **V10** | 当前在做什么任务？ | TaskContext + 任务感知优先级排序 |
| **V11** | 知识和行动如何闭环？ | 4 个结构化接口 + ProtoTask 升格为 Phase 1 核心 |
| **V12** | 任务怎么编排？ | 两层嵌套状态机 + plan-generator + verifier + pitfall-tracker |
| **V13** | 怎么主动驱动？ | TaskScheduler + SubagentManager + HeartbeatMonitor + 自主学习触发 |

完整架构设计详见 [`architech/praxis-architecture.md`](architech/praxis-architecture.md)。原始思考过程见 [`draft/`](draft/) 目录(V1-V13 完整迭代)。

---

## 项目结构

```
Praxis/
├── src/
│   ├── cognitive/           # 认知架构核心
│   │   ├── index.ts         # 公共 API 导出
│   │   ├── cognitive-core.ts  # 主入口 + Session 隔离
│   │   ├── governor.ts      # 学习决策编排器(Phase 1)
│   │   ├── task-state-machine.ts  # 两层嵌套状态机(V12)
│   │   ├── proto-task.ts    # 零样本任务模板(V11)
│   │   ├── task-scheduler.ts   # 主动任务调度(V13)
│   │   ├── subagent-manager.ts # 子Agent管理(V13)
│   │   ├── heartbeat-monitor.ts # 心跳监控(V13)
│   │   ├── scene-recognizer.ts  # 场景识别(Phase 2)
│   │   ├── signal-detector.ts   # 信号检测(Phase 1)
│   │   ├── embedding.ts      # 文本向量化(Phase 2)
│   │   ├── scenario-registry.ts # 场景注册表(Phase 0)
│   │   ├── scenario-cache.ts    # 场景缓存(Phase 0)
│   │   ├── types.ts          # 类型系统
│   │   └── ...
│   ├── transcript-analyzer.ts   # Transcript→学习事件(V8)
│   ├── transcript-analyzer-v2.ts # Transcript 分析器 v2
│   ├── session-start.ts     # Session 启动 Hook
│   ├── session-end.ts       # Session 结束 Hook
│   ├── agentmemory-client.ts  # AgentMemory MCP 客户端
│   ├── memory-client.ts     # 通用记忆客户端接口
│   └── platform-adapter.ts  # 平台适配层
├── architech/
│   └── praxis-architecture.md  # 完整架构设计文档(V1-V13)
├── draft/                   # 原始设计迭代(V1-V13)
│   ├── V1/  (6 files: what/why/who/when/where/how + design)
│   ├── V2/  (7 files)
│   ├── ...
│   └── V13/ (6 files)
├── package.json
└── README.md
```

---

## 设计原则

1. **Context Orchestration Layer** — Praxis 的本质是在正确时间、以正确格式、将正确的结构化记忆注入 LLM 上下文窗口
2. **零先验学习** — 在完全陌生的场景中从原始观察构建认知，而非依赖预设模板
3. **统计验证独立性** — 置信度不依赖 LLM 自评；工具序列的实际匹配提供独立验证信号
4. **优雅降级** — 4 级压力自适应保证在上下文紧张时仍保留核心功能
5. **知行闭环** — 知识结构化地驱动执行，执行结果结构化地反馈知识
6. **人类治理** — 新认知结构的创建需人类审批；任何结构可回滚

---

## 相关文档

- [演化路线图](docs/ROADMAP.md) — Phase I-IV: 从 Feature List 到 World Model 的四阶段演化
- [完整架构设计](architech/praxis-architecture.md) — 合成架构（六层+ProtoStructure+学习引擎+编排引擎+主动驱动+上下文编排+元认知）
- [架构演变史](architech/praxis-changelog.md) — V1→V13 完整演变过程（增删对照+跨版本设计主题）
- [原始设计迭代](draft/) — 每个版本的 why/what/how/when/where/who + design
- [CLAUDE.md](CLAUDE.md) — 行为准则和 skill 路由
