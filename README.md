# Praxis Cognitive Core

AI 认知操作系统核心 — 赋予 LLM 人类般的记忆和学习能力。

## 架构

Praxis 模拟"大学毕业生"的认知模型，包含 **4 种记忆类型** 和 **3 阶段学习环路**。

### 四种记忆

| 记忆类型 | 说明 | 示例 |
|---------|------|------|
| **Episodic** (情景) | 某次任务中发生了什么 | "修 bug #42 时用了旧 API，被用户修正" |
| **Procedural** (程序) | 做 X 时应该先 A 后 B | "改 config 前先读 schema" |
| **Semantic** (语义) | X 与 Y 的关系 | "TypeORM 的 migration 和 Prisma 的 migrate 不可互换" |
| **Metacognitive** (元认知) | 我擅长 X，不擅长 Y | "TypeScript selfRating: 0.75，Python selfRating: 0.4" |

### 学习环路

```
task_receive → task_execute → session_end
     ↑                            |
     └────── WAL 重放 ────────────┘
```

- **task_receive**: 任务前自评 + 检索相关记忆 → 上下文注入
- **task_execute**: 捕获用户修正信号 + 执行异常
- **session_end**: 提取学习更新 + 元认知校准 + 持久化

## 快速开始

```bash
npm install
npm test
```

```ts
import { CognitiveCore, InMemoryMemoryClient } from "@praxis/cognitive-core";

// 开发/测试用纯内存后端
const core = new CognitiveCore({
  memoryClient: new InMemoryMemoryClient(),
});

// 每个 session 创建隔离实例
const session = core.createSession("session_001");

// 任务前评估
const assessment = await session.assessTask("bug_fix", "typescript");
// => { ok: true, value: { metacognitive: { selfRating: 0.75, ... } } }

// 捕获用户修正
session.captureCorrection(
  { what: "used old API", correctedTo: "use new API v2",
    likelyRootCause: "API migration", isNewKnowledge: true },
  { sessionId: "session_001", hasExplicitRejection: true,
    taskType: "bug_fix", domain: "typescript" }
);

// Session 结束 → 学习 + 持久化
await session.finalizeLearning(
  { sessionId: "session_001", hasExplicitRejection: false,
    taskType: "bug_fix", domain: "typescript" },
  "typescript"
);
```

## API

| 模块 | 职责 |
|------|------|
| `CognitiveCore` | 主入口 — 构造注入 + session 隔离 |
| `MetacognitiveEngine` | 元认知自评 + 回顾性校准 |
| `LearningLoop` | 3 阶段学习环路编排 |
| `TaskAssessmentBuilder` | Phase 1: 任务前评估 |
| `ExecutionFeedbackCollector` | Phase 2: 修正信号收集 |
| `LearningUpdateBuilder` | Phase 3: 学习提取 + WAL 保护 |
| `buildContextInjection` | 记忆 → LLM 上下文注入 |
| `InMemoryMemoryClient` | 纯内存后端（开发/测试用） |
| `GapDetector` | E6: 知识缺口检测 |
| `StrategyRegistry` | E4: 策略生命周期管理 |
| `CrossDomainAnalyzer` | E5: 跨领域分析 |

## Result\<T\> 模式

所有异步 API 返回 discriminated union：

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
```

## 测试

```bash
npm test              # vitest run (134 tests)
npm run typecheck     # tsc --noEmit
```
