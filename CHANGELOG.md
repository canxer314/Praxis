# Changelog

## [0.10.0.0] - 2026-06-26

### Added
- **M3 Constraint System:** ProtoConstraint upgraded from passive storage to active interception — stop LLM before it makes mistakes
- **M3 ProtoConstraint Management:** getActiveConstraints filtering by crystallized lifecycle, sortBySeverity (block > confirm > warn), deprecateConstraint with gated side effects
- **M3 CRITICAL CONSTRAINTS Injection:** formatted constraint section injected before Tier A/B/C in session_start, survives Critical pressure (~100 tokens)
- **M3 Constraint Validation in before_tool_call:** collect-all + max-severity matching, mergeResults with constraint ≥ autonomy priority, orchestrator wiring for session-scoped constraint loading
- **M3 Severity Normalization:** defensive severity validation in AgentMemory field extraction (normalizeSeverity helper)
- **before-tool-call.test.ts:** M0 test debt resolved — autonomy decision tests + constraint validation integration tests

### Changed
- **before-tool-call.ts:** added loadConstraints() + constraint-aware handle() + mergeResults for combined autonomy/constraint decisions
- **session-start.ts:** rawStructures caching for constraint extraction, buildCriticalConstraints() for injection text generation
- **orchestrator.ts:** handleSessionStart now loads crystallized constraints into BeforeToolCallHandler, clears stale constraints on new session
- **cognitive/types.ts:** SessionContextInjection.tieredContext extended with criticalConstraints field (injectionText + constraints array)

## [0.9.0.0] - 2026-06-26

### Added
- **M2 Context Orchestration:** Tier A/B/C layered ProtoStructure injection with scoring (scene × 0.55 + task × 0.35 + signal × 0.10)
- **M2 Pressure Adaptation:** 4-level context pressure monitor (Normal/Elevated/High/Critical) with automatic tier compression
- **M2 Lazy Loading:** recall-structure module for Critical-mode on-demand structure detail retrieval
- **M2 Attention Telemetry:** [STRUCTURE_USED] marker parsing, cross-session adoption tracking, zombie detection, underestimated detection
- **M2 TaskContext:** 8-field task context structure with confidence-gated auto-progress inference
- **M2 Semantic Disambiguation:** homograph registry with scenario-context-driven sense selection
- **M2 session-start integration:** automatic pressure measurement from estimated token usage, scenarioId propagation from AgentMemory

### Changed
- **session-start.ts:** ProtoStructure injection refactored from flat list to tiered context via context-organizer
- **session-end.ts:** added attention telemetry [STRUCTURE_USED] extraction

## [0.8.4.0] - 2026-06-26

### Added
- **M1 ProtoStructure extraction:** session_end LLM analysis for ProtoStructure candidates


## [0.8.3.0] - 2026-06-26

### Added
- **M1 storage + injection:** ProtoStructure save/search in agentmemory-client + session_start injection


## [0.8.2.0] - 2026-06-25

### Added
- **M1 version chain:** createVersion, rollback, diffVersions, versionSummary per architecture sect3


## [0.8.1.0] - 2026-06-25

### Added
- **M1 ProtoStructure type system:** complete interface family (ProtoStructure base + 5 subtypes: ProtoSequence, ProtoRole, ProtoConcept, ProtoPurpose, ProtoConstraint) per architecture §3+§9
- **StructureGraph:** relation graph with 6 relation types + deterministic confidence propagation (BFS, ≤3 hops) + cycle detection
- **StructureLifecycle:** 6-stage lifecycle state machine + crystallization/degradation gates + M4 verifier interface stub

## [0.8.0.1] - 2026-06-25

### Added
- **M0 module exports:** EventOrchestrator, 7 event handlers, M0Deps, localCache exported from `@praxis/cognitive-core`
- **CognitiveCore deprecation:** `@deprecated` JSDoc tag referencing EventOrchestrator as replacement

### Changed
- **tsconfig:** exclude legacy `phase1a-bridge.ts` from typecheck

## [0.8.0.0] - 2026-06-25

### Added
- **M0 EventOrchestrator:** pure-function event router for 7 standard lifecycle events (session_start, message_received, before_tool_call, after_tool_call, agent_end, session_end, cron_tick). Session-scoped state management (pendingSignals, toolCallTrace). Independent of CognitiveCore — runs in parallel.
- **M0Deps interface:** standardized dependency injection (MemorySubsystem, CacheSubsystem, LLMSubsystem) for all M0 event handlers. Includes DEFAULT_AUTONOMY_POLICY and assessRiskLevel().
- **MessageReceivedHandler:** user correction detection with 9 regex patterns. Signals stashed to session-scoped array for session_end processing.
- **BeforeToolCallHandler:** autonomy decision engine (proceed/inform/confirm/block) based on risk level × policy matching.
- **AfterToolCallHandler:** tool call trace recording with failure signal capture.
- **AgentEndHandler:** tool call summary (count, success/failure distribution, duration).
- **CronTickHandler:** M0 skeleton (noop, deferred to M2/M5).
- **LocalCache:** 7-day TTL file-based degradation cache for AgentMemory unavailability. get/set/list/stats/delete/purgeExpired/clear operations. All operations silently catch errors.
- **M0 event types:** SessionStartEvent, MessageReceivedEvent, BeforeToolCallEvent, AfterToolCallEvent, AgentEndEvent, SessionEndEvent, CronTickEvent, SessionContextInjection, PendingSignal, AutonomyPolicy.

### Changed
- **SessionStartHandler:** refactored to use M0Deps (removed CognitiveCore dependency). Returns structured SessionContextInjection instead of flat string prompt.
- **SessionEndHandler:** simplified to signal→lesson direct write with AgentMemory degradation to local-cache. Optional LLM transcript analysis.

### Docs
- **Architecture document:** complete rewrite as synthesized World Model blueprint (13 sections). Extracted V1→V13 evolution history to praxis-changelog.md.
- **ROADMAP:** rewritten as 6-milestone implementation plan (M0→M6, 26-36 weeks).
- **M0 dev plan:** file-by-file implementation plan for core runtime (Step 1-4, 12 days).

## [0.7.2.0] - 2026-06-25

### Added
- **Expand hook scene context injection:** `searchRelevant()` results now include active scenario label when available — LLM can weight relevance by scenario context without a blind boost formula. Reads `session-state.json` (populated by message hook), looks up human-readable `tentativeName` from seed scenarios. Degrades gracefully: no state → no label, unknown scenarioId → raw ID.

## [0.7.1.0] - 2026-06-24

### Added
- **Scene Recognizer (Phase 2):** `recognizeScene()` — 1-layer LLM scene classification against seed scenario registry. Returns `ScenarioMatch[]` sorted by confidence. `getPrimaryScenarioId()` and `getActiveScenarioIds()` helpers. Defense-in-depth: unregistered scenario IDs filtered, confidence clamped to [0,1], NaN guarding, 5-match cap. 24 tests.
- **Session-State IPC:** `~/.praxis-phase1a/session-state.json` for cross-hook scenario context sharing. `inject` writes (cache-first), `message` reads/writes (lazy recognition on first message), `end` reads + writes cache + cleans up. Corruption fallback via JSON.parse catch.
- **Offline scene validation:** `scene-classifications.jsonl` logs every scene recognition result (timestamp, sessionId, input preview, matched scenario, confidence, duration, cache status). `scene-stats` command for accuracy tracking.
- **`scene-log` command:** Manual scene recognition testing — pipe or pass text, get classification results + logging.
- **`extractFirstUserMessage()`:** Transcript parser for "用户:" / "User:" prefixed lines, used by offline validation in `end <file>` mode.

### Changed
- **`message` hook:** Now passes `activeScenarioIds` to `TranscriptAnalyzerV2.analyze()` when scenario context is available — learning events get `protoStructureIds` populated.
- **`end --summary` hook:** Writes scenario cache on session end for cross-session TTL reuse. Reports scene classification statistics.
- **`inject` hook:** Attempts scenario cache hit at session start, initializes session-state.json.

## [0.7.0.0] - 2026-06-24

### Added
- **Scenario Registry (Phase 0):** 5 manual seed scenarios (backend API dev, architecture design, bug investigation, AI agent dev, document writing) with typical tool chains and domain tags. `validateSeedScenarios()` for structural health checks.
- **Scenario Cache (Phase 0):** TTL-based (4h) cross-session scenario cache with local embedding verification (all-MiniLM-L6-v2 via Transformers.js). `checkCache()` two-stage: TTL fast path → embedding similarity fallback.
- **ProtoStructure types:** `ProtoStructure`, `ScenarioMatch`, `ProtoStructureSeed` interfaces in the cognitive type system. `scenarioId` field added to `EpisodicMemory.context`.
- **LearningEvent scenario binding:** `protoStructureIds?: string[]` field on `LearningEvent` and `StoredLearning` — allows learnings to carry scenario context for future precision retrieval.

### Changed
- **SignalDetector v1→v2:** Upgraded from keyword matching (5 Chinese negation keywords) to LLM-based semantic detection (`detectCorrectionLLM()`). LLM prompt explicitly lists 5 false-positive patterns (rhetorical, rules text, opinion, fact, self-correction) observed in shadow data. Active path in `phase1a-bridge.ts` message hook. Original `detectCorrection()` preserved for backward compat.
- **TranscriptAnalyzerV2 signature:** `analyze()` now accepts optional `opts?: { activeScenarioIds?: string[] }` for scenario-aware learning extraction. Backward compatible — all 11 existing call sites unchanged.

## [0.6.2.0] - 2026-06-23

### Changed
- **TranscriptAnalyzer v1→v2:** Switched learning event extraction from regex-based (v1, ~30 keywords) to LLM-based semantic analysis (v2, DeepSeek V4 Flash). Removed v1 fallback — backtest data proves v1 produces 0/14 effective learnings (all keyword noise) while v2 produces semantically meaningful events. Non-thinking mode reduces latency 75% (6,454ms→1,645ms, P95=2.1s).
- **LLM output type validation:** Added typeof guards on content (string), confidence (number, not NaN) to prevent NaN propagation and TypeError crashes from malformed LLM responses.
- **Error resilience:** `loadLearnings()` JSON.parse now crash-protected with try-catch. `parseResponse` catch narrowed to log non-SyntaxError exceptions. Surrogate-pair-safe string slicing for CJK/emoji content previews.

## [0.6.1.3] - 2026-06-23

### Added
- **Shadow decision persistence (T12):** Governor shadow mode decisions now persisted to `~/.praxis-phase1a/shadow-decisions.jsonl` instead of ephemeral stderr. Each JSONL record includes session ID, action, confidence, route, signal type, timing, isNewKnowledge, matched keyword, and content preview.
- **`shadow-stats` CLI command:** `npx tsx src/phase1a-bridge.ts shadow-stats` prints session count, decision distribution (LEARN/DEFER/SKIP), signal type distribution, isNewKnowledge distribution, and routeTo distribution. Per-line JSON parse resilience handles corrupted lines.
- **`computeShadowStats()` pure function:** Extracted for testability with 4 unit tests covering normal data, empty input, corrupted lines, and all-corrupted scenarios.

### Changed
- **Shadow session ID** now uses `CLAUDE_SESSION_ID` environment variable (Claude Code's real session ID) instead of synthetic counter.
- **Error visibility preserved** — degradation and error shadow paths still log to stderr.

## [0.6.1.2] - 2026-06-23

### Changed
- **SignalDetector v1.1:** `isNewKnowledge` now derived from message context via correction-signal words (应该/改成/需要/试试 etc.) instead of always `true`. Pure negations without alternatives produce `isNewKnowledge=false`, routing to `preference_discovery` instead of `mistake_correction`. Makes Phase 2 gate falsifiable by producing 2 distinct decision paths.

## [0.6.1.1] - 2026-06-23

### Added
- **SignalDetector:** keyword-based correction signal detection (5 Chinese negation keywords)
- **Shadow mode:** Governor pipeline runs on every `message` hook call, logs decisions via stderr, does not intercept LearningLoop

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
