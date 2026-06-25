# M0 开发计划: 核心运行时

> 目标: 建立 session_start→session_end 的完整数据通道  
> 周期: 3-4 周  
> 架构参考: [praxis-architecture.md](../architech/praxis-architecture.md) §1-§2, §10, §9  
> 路线图参考: [ROADMAP.md](ROADMAP.md) M0 节

---

## 〇、Step 0: 现有代码审计 — 哪些能用，哪些要改

### 可直接复用 (架构一致的)

| 文件 | 原因 | 需要的微调 |
|------|------|-----------|
| `platform-adapter.ts` | Result\<T\> 模式 + 错误码定义与架构一致 | 无 |
| `logger.ts` | 纯工具，无架构冲突 | 无 |
| `agentmemory-client.ts` | REST API 客户端实现完整(slot/smart_search/lessons/livez) | API 方法名对齐架构 §9 映射表 |
| `constants.ts` | Slot 名称常量 | 仅确认 SLOTS 对象包含 M0 需要的 2 个 slot |
| `inmemory-client.ts` | 测试替身 | 无 |

### 需要重构 (结构对但耦合旧设计)

| 文件 | 问题 | 重构方向 |
|------|------|---------|
| `types.ts` | V1 时代定义，缺架构 §9 的完整字段 | 保留现有接口+新增 M0 需要的 CompetencyModel/Knowledge/LearningEvent 字段对齐架构 |
| `session-start.ts` | 硬编码 CognitiveCore 依赖，V1 注入格式 | 解耦为独立事件处理器，注入格式对齐 M0.3 |
| `session-end.ts` | 耦合 V1 learning-loop 逻辑 | 简化为 M0.4 的信号→lesson 直写 |
| `context.ts` | buildContextInjection 结构对但数据源旧 | 改造为从 AgentMemory slot 加载而非从 CognitiveCore 内部状态 |
| `cognitive-core.ts` | V1 的核心编排器—六层糅合在一个类 | 拆分为 event-orchestrator（简单事件路由，不做认知决策） |
| `learning-loop.ts` | V1 3-phase (assess→feedback→update) | M0 不需要 3-phase 编排。简化为: 捕获信号→session_end 写 lesson |
| `signal-detector.ts` | detectCorrection 函数签名可能过窄 | 评估是否可复用于 M0.4 的简化版信号捕获 |

### M0 不需要 (后续里程碑才启用)

`governor.ts`, `task-state-machine.ts`, `task-scheduler.ts`, `subagent-manager.ts`, `heartbeat-monitor.ts`, `proto-task.ts`, `scene-recognizer.ts`, `scenario-registry.ts`, `scenario-cache.ts`, `embedding.ts`, `transcript-analyzer.ts`, `transcript-analyzer-v2.ts`, `gap-detector.ts`, `strategy-registry.ts`, `cross-domain-analyzer.ts`, `memory-consolidator.ts`, `timing-controller.ts`, `execution-feedback.ts`, `learning-update.ts`, `task-assessment.ts`, `metacognitive-engine.ts`, `phase1a-bridge.ts`, `phase1a-bridge.test.ts`, `llm-client.ts`

这些文件**在 M0 期间不删除**——避免破坏已有测试。它们在 M1-M6 逐里程碑重新审视。

### M0 新增文件

`orchestrator.ts`, `message-received.ts`, `before-tool-call.ts`, `after-tool-call.ts`, `agent-end.ts`, `cron-tick.ts`, `local-cache.ts`

---

## 一、架构决策

### A1: 事件路由模型

架构文档 §10 定义了 7 个标准生命周期事件。M0 采用**简单函数路由**而非类层次:

```typescript
// orchestrator.ts — 纯函数事件路由器
export async function handleSessionStart(event: SessionStartEvent, deps: M0Deps): Promise<ContextInjection>;
export async function handleMessageReceived(event: MessageReceivedEvent, deps: M0Deps): Promise<void>;
export async function handleBeforeToolCall(event: BeforeToolCallEvent, deps: M0Deps): Promise<AutonomyDecision>;
export async function handleAfterToolCall(event: AfterToolCallEvent, deps: M0Deps): Promise<void>;
export async function handleAgentEnd(event: AgentEndEvent, deps: M0Deps): Promise<void>;
export async function handleSessionEnd(event: SessionEndEvent, deps: M0Deps): Promise<void>;
export async function handleCronTick(event: CronTickEvent, deps: M0Deps): Promise<void>;
```

选择纯函数而非类的原因是: (a) 每个事件处理器无共享可变状态, (b) 依赖通过 deps 注入便于测试, (c) 适配器层可以直接调用这些函数而不需要实例化对象。

### A2: 依赖注入

```typescript
interface M0Deps {
  // AgentMemory 通信 — 由 agentmemory-client 实现
  memory: {
    getSlot(name: string): Promise<Result<unknown>>;
    setSlot(name: string, value: unknown): Promise<Result<void>>;
    smartSearch(query: string, type?: string): Promise<Result<unknown[]>>;
    saveLesson(lesson: Record<string, unknown>): Promise<Result<void>>;
    isAvailable(): Promise<boolean>;
  };
  // 降级缓存 — AgentMemory 不可用时使用
  localCache: LocalCache;
  // 日志
  logger: Logger;
  // 自主性策略 — 从 autonomy_policy slot 加载
  autonomyPolicy?: AutonomyPolicy;
}
```

### A3: 现有 CognitiveCore 的处理

`cognitive-core.ts` 在 M0 期间**不被修改**——它仍有 482 个测试依赖它。新的 orchestrator 作为**并行入口**存在，不与 CognitiveCore 共享状态。在 M0 完成且 orchestrator 有足够测试覆盖后（预计 M1 中期），逐步将 CognitiveCore 的调用方迁移到 orchestrator，最终在 M2 移除 CognitiveCore。

### A4: 降级策略

AgentMemory 不可用时的行为:
- session_start: 注入空上下文（无记忆可用），不崩溃
- session_end: 学习事件写入 local-cache（7 天 TTL 文件缓存），下次 AgentMemory 恢复时批量同步
- 所有读操作: 返回空/默认值，不抛错

local-cache 复用架构 §11 中定义的 `memory/local-cache.ts` 的位置。

---

## 二、逐文件行动计划

### Step 1: 基础设施 (Day 1-2)

**1.1 扩展 `types.ts`** — 保留所有现有类型，追加 M0 需要的接口:

```typescript
// 新增: 标准生命周期事件类型 (对应架构 §10)
export interface SessionStartEvent { sessionId: string; projectScope?: string; }
export interface MessageReceivedEvent { sessionId: string; message: string; role: 'user' | 'assistant'; }
export interface BeforeToolCallEvent { sessionId: string; toolName: string; toolParams: Record<string, unknown>; }
export interface AfterToolCallEvent { sessionId: string; toolName: string; toolParams: Record<string, unknown>; result: unknown; error?: string; }
export interface AgentEndEvent { sessionId: string; toolCalls: ToolCallRecord[]; }
export interface SessionEndEvent { sessionId: string; transcript: string; }
export interface CronTickEvent { timestamp: number; }

// 新增: 自主性决策 (对应架构 §2 L6)
export type AutonomyAction = 'proceed' | 'inform' | 'confirm' | 'block';
export interface AutonomyDecision { action: AutonomyAction; reason?: string; }

// 新增: 上下文注入 (对应架构 §1)
export interface ContextInjection {
  competency: { overallProficiency: number; domainProficiencies: Record<string, number>; };
  knowledge: { title: string; content: string; confidence: number; }[];
  mentalState: string | null;
}

// 确认已有类型与架构 §9 对齐:
// CompetencyModel, Knowledge, LearningEvent — 在现有 types.ts 中已有基础版本,
// 确认字段与架构 §9 的数据模型一致。如果不一致, 以架构为准修改。
```

**验证**: `types.ts` 导出新增接口，TypeScript 编译通过。

**1.2 实现 `local-cache.ts`**

文件缓存，7 天 TTL。接口:

```typescript
export interface LocalCache {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  flush(): Promise<void>; // 批量同步到 AgentMemory
}
```

实现: JSON 文件 (`~/.praxis/cache/{key}.json`)，写入时记录 timestamp，读取时检查 TTL。

**验证**: 写入→读取→等待 TTL 过期→读取返回 null。flush() 将所有缓存条目写入 AgentMemory。

---

### Step 2: 七个事件处理器 (Day 3-8)

**2.1 `session-start.ts` — 重构**

当前 `session-start.ts` 强依赖 CognitiveCore。重构方向:

```
旧: CognitiveCore → MetacognitiveEngine(自评) → TaskAssessment(检索) → buildContextInjection
新: AgentMemory(slot_get competency_model) → AgentMemory(smart_search 相关知识) → buildContextInjection
```

注入格式对齐架构文档 M0.3 的模板: `## Praxis Context` → `### 能力概况` → `### 相关知识` → `### 上次停下的地方`。

CognitiveCore 依赖移除。如果用户传入了可选的 cognitiveCore 实例（向后兼容），走旧路径并输出 deprecation warning。

**验证**: AgentMemory 有 3 条 knowledge → session_start → 输出 ContextInjection 包含这 3 条。

**2.2 新建 `message-received.ts`**

M0 只做信号检测——调用 `signal-detector.ts` 的 `detectCorrection`。如果检测到纠正，将信号暂存到内存（session-scoped array）。更复杂的语义意图分析（教导模式/纠正模式/偏好表达）在 M4 的 Governor 实现。

**验证**: 用户消息"不对，应该用 X 而不是 Y" → 检测到 correction → 信号被追加到暂存区。

**2.3 新建 `before-tool-call.ts`**

M0 实现简化的自主性判断: 查询 autonomy_policy slot → 匹配操作风险级别 → 返回 proceed/inform/confirm/block。不涉及 ProtoConstraint 验证（那是 M3）。

**验证**: 高风险操作 + 低熟练度 → 返回 confirm。低风险操作 + 高熟练度 → 返回 proceed。

**2.4 新建 `after-tool-call.ts`**

记录工具调用结果到 session trace（内存）。后续可扩展为匹配 success/failure signals。

**验证**: tool call 完成 → session trace 记录包含 tool_name + result + error(如有)。

**2.5 新建 `agent-end.ts`**

汇总 session trace 中的所有工具调用。M0 不触发 Curiosity Engine 或统计验证器——仅作为 session 摘要的入口点。

**验证**: agent_end → 返回工具调用摘要（count + success/failure 分布）。

**2.6 `session-end.ts` — 重构**

当前 session-end 触发 learning-loop (extract→update→persist)。重构为 M0.4 的简化流程:

```
收集 session 中的所有待处理信号
  → 每个信号: 调用 memory.saveLesson()
  → 更新 competency_model (如果有变化)
  → memory.setSlot("competency_model", updated)
  → [可选] TaskScheduler 决策 (如果是 V13 相关的 session)
```

AgentMemory 不可用时 → local-cache.set("pending_lessons", signals)。

**验证**: session 中有 2 个纠正信号 → session_end → 2 个 lesson 被写入 AgentMemory。

**2.7 新建 `cron-tick.ts`**

M0 skeleton 实现——空函数，返回 void。后续里程碑填充 HeartbeatMonitor + 模式挖掘。

**验证**: 调用 handleCronTick → 不抛错。

---

### Step 3: EventOrchestrator (Day 9-10)

**3.1 新建 `orchestrator.ts`**

纯函数路由——将事件分发给对应的处理器。不包含业务逻辑。

```typescript
export async function routeEvent(
  eventType: 'session_start' | 'message_received' | 'before_tool_call' | 'after_tool_call' | 'agent_end' | 'session_end' | 'cron_tick',
  event: unknown,
  deps: M0Deps
): Promise<unknown> {
  switch (eventType) {
    case 'session_start': return handleSessionStart(event as SessionStartEvent, deps);
    case 'message_received': return handleMessageReceived(event as MessageReceivedEvent, deps);
    // ... etc
  }
}
```

**验证**: 模拟 session_start 事件 → orchestrator 路由 → session-start handler 被调用 → 返回 ContextInjection。

### Step 4: 与现有 CognitiveCore 共存 (Day 11-12)

**4.1 确认 482 个现有测试仍然通过**

M0 的新模块不修改任何现有文件（除 `types.ts`、`session-start.ts`、`session-end.ts` 的增量修改和 `context.ts` 的重构）。新增的 orchestrator 与 CognitiveCore 并行存在，零干扰。

**4.2 `CognitiveCore` deprecation 标记**

在 `cognitive-core.ts` 的 JSDoc 中添加:

```
@deprecated 自 M0 起, 使用 orchestrator.ts 的 routeEvent() 替代。
CognitiveCore 将在 M2 移除。迁移指南: [link to migration doc]
```

---

## 三、测试策略

### 测试金字塔

```
        ┌─────────┐
        │ 集成测试  │  1-2 个: 完整 session 生命周期
        ├───────────┤
        │  单元测试  │  每个事件处理器 3-5 个 test case
        ├───────────┤
        │  契约测试  │  agentmemory-client 的 mock 行为验证
        └───────────┘
```

### 具体测试用例

**session_start**:
1. AgentMemory 可用 → 注入正确内容
2. AgentMemory 不可用 → 降级注入（空上下文，不崩溃）
3. competency_model slot 格式错误 → 降级到默认值
4. smart_search 返回空 → 知识段为空

**message_received**:
1. 普通消息 → 无信号
2. "不对，应该是 X" → 检测到 correction
3. 空消息 → 无信号

**before_tool_call**:
1. 低风险 + 高熟练 → proceed
2. 高风险 + 低熟练 → confirm
3. 无 autonomy_policy → 使用默认策略（unknown_operation: confirm）

**after_tool_call**:
1. 成功调用 → 记录 success
2. 失败调用 → 记录 error
3. 无 result → 记录为空

**agent_end**:
1. 0 个 tool call → 摘要为空
2. 5 个 tool call (3 success, 2 fail) → 摘要正确

**session_end**:
1. 有 2 个 pending signals → 写入 2 个 lessons
2. 无 signals → 不写入
3. AgentMemory 不可用 → 写入 local-cache

**orchestrator**:
1. 正确路由所有 7 种事件类型
2. 未知事件类型 → 返回错误而非崩溃

### Mock 策略

所有 AgentMemory 交互通过 mock 的 `M0Deps.memory` 接口。测试不启动真实的 AgentMemory 服务。`InMemoryMemoryClient` (已有) 可用作 mock 实现。

---

## 四、性能预算

| 操作 | 预算 | 测量方式 |
|------|------|---------|
| message_received 处理 | < 10ms | 纯规则匹配 + 内存操作 |
| before_tool_call 处理 | < 10ms | policy 查询已在内存中 |
| session_start 处理 | < 500ms | AgentMemory 网络调用可能占主要时间 |
| session_end 处理 | < 2s | lesson 写入 + slot 更新 |

---

## 五、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/cognitive/types.ts` | **修改** | 追加 M0 事件类型 + 确认现有类型对齐架构 §9 |
| `src/session-start.ts` | **重构** | 移除 CognitiveCore 依赖，直连 AgentMemory |
| `src/session-end.ts` | **重构** | 简化为 M0.4 的信号→lesson 直写 |
| `src/cognitive/context.ts` | **重构** | 从 AgentMemory slot 加载，而非 CognitiveCore 内部状态 |
| `src/cognitive/cognitive-core.ts` | **标记** | 添加 @deprecated 注释 |
| `src/cognitive/signal-detector.ts` | **审查** | 确认 detectCorrection 适合 M0 |
| `src/orchestrator.ts` | **新建** | 纯函数事件路由器 |
| `src/message-received.ts` | **新建** | 信号检测 + 暂存 |
| `src/before-tool-call.ts` | **新建** | 简化版自主性判断 |
| `src/after-tool-call.ts` | **新建** | 工具调用记录 |
| `src/agent-end.ts` | **新建** | 工具调用摘要 |
| `src/cron-tick.ts` | **新建** | skeleton |
| `src/memory/local-cache.ts` | **新建** | 7 天 TTL 文件缓存 |
| `src/orchestrator.test.ts` | **新建** | 事件路由测试 |
| `src/message-received.test.ts` | **新建** | 信号检测测试 |
| `src/before-tool-call.test.ts` | **新建** | 自主性决策测试 |
| `src/agent-end.test.ts` | **新建** | 摘要测试 |
| `src/memory/local-cache.test.ts` | **新建** | 缓存测试 |

---

## 六、M0 完成标准 (Go/No-Go)

- [ ] 7 个标准生命周期事件全部可被 orchestrator 正确路由
- [ ] session_start → session_end 完整数据通道端到端测试通过
- [ ] AgentMemory 可用时: competency_model 加载 + knowledge 检索 + lesson 写入 全部正常
- [ ] AgentMemory 不可用时: 系统降级运行（不崩溃），数据写入 local-cache
- [ ] 用户纠正信号被正确捕获、暂存、session_end 写入 lesson
- [ ] 自主性决策: 4 级动作(proceed/inform/confirm/block) 基于 autonomy_policy 正确判断
- [ ] 所有新增文件有对应的测试文件，覆盖 happy path + 降级路径
- [ ] 482 个现有测试仍然全部通过（零回归）
- [ ] TypeScript 编译零错误

---

> **立即启动**: Step 1 (types.ts 扩展 + local-cache)。Day 1-2。  
> **下一步**: [M1 开发计划](M1-dev-plan.md) (ProtoStructure 数据模型)
