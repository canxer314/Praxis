# Changelog

## [0.6.1.0] - 2026-06-23

### Added
- **Governor:** 4-stage learning decision pipeline (classify→gate→decide→dispatch) — unified decision center for "what/when to learn"
  - `LearningDecision` struct: action (LEARN/DEFER/SKIP) + confidence + routeTo
  - Catch-all degradation: pipeline failure → signal bypassed to ExecutionFeedback
  - Structured logging per decide() call
- **TimingController:** signal classifier mapping 5 signal types to IMMEDIATE/BATCH/DEFERRED timing
- **TaskStateMachine:** pure-function two-level state machine (9 task + 7 subtask edges)
- **ProtoTask:** zero-shot task template bootstrap with 24h TTL cache and exponential backoff retry
- New types: `TaskState`, `SubtaskState` enums, `ConfidenceView` interface

### Changed
- Extracted `isRealExperience` to `utils/signal-quality.ts` (pure function, no behavior change)
- Governor wired into `SessionCognitiveCore` as `governorDecide()` method (Phase 1 shadow mode)

### Removed
- Dead code `editDistance` function (zero production callers)
- `heuristics.ts` module (consolidated into `utils/signal-quality.ts`)

## [0.6.0.1] - 2026-06-23

### Fixed
- **C1:** TaskScheduler 首次触发死锁 — `first_trigger_of_task` 确认检查基于 `confirmed_at` 而非 trigger count，添加 `confirmTask()` 方法
- **C2:** SubagentManager retrySubagent spawn 失败时数据丢失 — 旧 run 现在保存到 completed_runs
- **C3:** StrategyApplier backup 快照从未写入 — `activate()` 现在同时写 primary + backup 双快照
- **C4:** StrategyApplier rollback() 吞掉 transition() 失败 — 现在检查 transition + persist 结果
- **C5:** StrategyRegistry reactivateDormant() 忽略 persist() 失败 — 现在传播错误
- **C7:** StrategyRegistry transition() 硬编码 source="auto_proposed" — 添加 `source` 参数
- **H1:** isRealExperience 规则 2 死代码（永不可达）— 已移除
- **H4:** GapDetector 无 null guard — 添加 `??` 默认值防护
- **H7:** cachedAssess 后台刷新从不更新缓存 — 添加 `getProfile(forceReload)` 参数并在后台刷新中跳过缓存
- **M5:** rollbackMigration() 不捕获 rollbackFn 异常 — 添加 try/catch
- **M8:** metacognitive-engine 使用硬编码 slot 字符串 — 改用 SLOTS.METACOGNITIVE_PROFILE 常量
- **M9:** estimateTokens() 未导出 — 添加 public export

### Added
- StrategyApplier 测试 (4 个): activate 双快照、rollback 主快照恢复、backup 降级、双快照不可用
- 修复 subagent-manager 无效测试 (canSpawn max_parallel 现在实际 spawn agent)

## [0.6.0.0] - 2026-06-23

### Added
- **Phase 3c Heartbeat Monitor — Active Driving 停滞检测 + 分级介入**
  - `HeartbeatMonitor` 类: runHeartbeatCheck (正常/运行超时/停滞) + handleStalledTasks (3 级响应)
  - NUDGE (活跃 session 注入提醒) → WAKE (创建新 session) → ESCALATE (>24h 标记 BLOCKED)
  - 防重复介入: 1h 内已有 nudge → 自动跳过
  - `StallInterventionCallback` 接口: 抽象平台层介入实现
  - `HeartbeatTaskContext` 精简接口: 心跳检查不依赖完整任务编排器
  - Persistence: loadHeartbeatState / saveHeartbeatState / saveIntervention

## [0.5.0.0] - 2026-06-23

### Added
- **Phase 3b SubagentManager — 并行子 Agent 生命周期管理**
  - `SubagentManager` 类: spawnSubagent / waitForCompletion / retrySubagent / aggregateResults
  - 并行上限控制: canSpawn() 检查 max_parallel（默认 3）
  - `SubagentExecutionAPI` 接口: 抽象平台层子 Agent 执行（run / waitForRun）
  - `buildSubagentContext()` 纯函数: 构建精简子 Agent 上下文（任务名 + 验收标准 + 陷阱预警）
  - Persistence: loadRegistry / persistRegistry / clear
  - retry_count 跨重试继承（修复 spawnSubagent 重置计数的问题）

### Fixed
- retrySubagent 现在正确将 retry_count 从旧 run 继承到新 spawn 的 run

## [0.4.0.0] - 2026-06-23

### Added
- **Phase 3 Task Scheduling 模块：** 主动触发决策引擎——Praxis 从被动响应 Hook 进化为主动调度任务
  - `TaskScheduler` 类：10 分支决策矩阵（静默时段 + 每日上限 + 最小间隔 + 并行化 + 按估计时间选择机制）
  - `isInQuietHours()` 纯函数：支持跨午夜静默时段检测
  - `canParallelize()` 纯函数：基于 depends_on 判断子任务并行可行性
  - `countTodayTriggers()` 纯函数：基于持久化 schedule 的每日触发计数
  - `evaluateTrigger()` 现在接受可选 `TaskSchedule` 参数以启用基于持久化数据的 guard（每日上限 + 最小间隔）
  - Schedule 生命周期管理：loadSchedule / saveTrigger / markTriggerFired / cancelTrigger / cleanupExpiredTriggers
  - `DEFAULT_TRIGGERING_CONFIG`：保守默认配置（enabled=false, max_triggers_per_day=8, quiet_hours=22:00-08:00）
- V13 类型定义：`TaskSchedule`, `ScheduledTrigger`, `TriggerDecision`, `TriggerAdapter`, `SubagentRun`, `SubagentResult`, `SubagentRegistry`, `HeartbeatState`, `HeartbeatIntervention`, `ActiveTriggeringConfig`
- Slot 常量：`TASK_SCHEDULE`, `SUBAGENT_REGISTRY`, `HEARTBEAT_STATE`
- 55 个单元测试覆盖全部决策分支 + 边界条件 + schedule-aware guard

## [0.3.0.2] - 2026-06-23

### Fixed
- 语义/程序性记忆保存失败现在入队到 WAL（与 episodic 一致），WAL 重放支持 semantic/procedural 类型（#M8）
- `getMigrations()` 在 slot 值损坏时记录 `logDegraded`（#M7）
- `reactivateDormant()` / `rollbackMigration()` 返回值在 `finalizeLearning()` 中被检查（#M5）
- `StrategyApplier.rollback()` 双快照不可用时拒绝破坏性工厂重置——返回错误而非销毁所有策略（#L1）
- 字符串 error code `"NOT_FOUND"` / `"ROLLBACK_FAILED"` 替换为集中 `ErrorCode` 常量（#L2）
- `GapDetector` 依赖窄 `ProfileProvider` 接口，不再导入完整 `MetacognitiveEngine` 类（#L3）

## [0.3.0.1] - 2026-06-23

### Fixed
- **CRITICAL:** `StrategyRegistry.load()` 现在在 `applyCrossDomainMigrations()` 和 `finalizeLearning()` 中被调用——修复了 E4 策略重新激活在运行时为死代码的问题（autoplan Phase 2 审查 #C1）
- `transition()` 现在先克隆 Strategy 对象再修改状态，防止 persist 失败导致内存/持久化不一致（#H1）
- 5 个空 catch 块现在记录 `logDegraded` 日志，提供错误可见性（#H2）
- `CognitiveCore` 构造函数现在检查 `deps` 本身是否为 null/undefined（#H4）
- `selectAutoApplyCandidates()` 添加 null/undefined 防护（#H5）
- `MemoryConsolidator` 使用可选链处理丢失的 `context`/`signals` 字段（#H6）
- `finalizeLearning()` 在学习更新失败时提前返回，不再错误地执行 E4/E5（#M4）
- `applyCrossDomainMigrations()` 在保存迁移记录前检查 persist 结果（#M1）
- `Date.now()` 策略 ID 现在包含循环索引以防止碰撞（#M2）
- E4/E5 循环改为逐条目 try/catch，单个条目失败不影响其他（#M6）

## [0.3.0.0] - 2026-06-22

### Added
- **E4 策略完整生命周期：** DORMANT 策略在检测到 PERSISTENT_GAP 时自动重新激活为 PROPOSED。策略不再永久休眠——系统会在相同困境重现时重新评估之前搁置的方案。
- **E5 跨领域自动迁移：** CrossDomainAnalyzer 自动将高相似度（≥0.7）的跨领域模式创建为目标领域策略提案。含迁移回滚机制——目标领域退步时自动撤回。
- **记忆间一致性管道：** MemoryConsolidator 实现 Episodic → Semantic → Procedural 三层记忆提炼。3+ 条相同修正模式的情景记忆自动提取为语义关系，3+ 条同领域语义记忆自动编排为程序步骤。

### Fixed
- memory-client `classifyError` 中变量引用错误：`message` 改为 `msg`。

## [0.2.0.0] - 2026-06-22

### Added
- 认知架构核心模块 (@praxis/cognitive-core)：CognitiveCore、MetacognitiveEngine、LearningLoop
- Session 隔离：`createSession()` 为每个 session 创建独立的认知实例
- WAL（Write-Ahead Log）持久化：进程重启后恢复未写入的记忆
- 上下文注入：按优先级（陷阱 > 缺口 > 情景记忆）组装 LLM prompt 注入
- E4 策略注册表（6 状态机）+ 双快照回滚
- E5 跨领域分析器 + 健康检查
- E6 缺口猎取 + PERSISTENT_GAP 升级
- InMemoryMemoryClient：纯内存实现用于无 AgentMemory 环境的开发和测试
- 提示注入防御：sanitizePromptFragment()
- CJK token 估算：字符级分析替代 length/4
- PraxisErrorThrowable + ErrorCode（17 错误码）
