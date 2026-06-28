# Changelog

## [0.20.1.0] - 2026-06-28

### Added
- **Phase 10 Prompts + Types — 16 new files completing §11 infrastructure:**
  - **prompts/system/ (5 files):** memory-context.md, plan-injection.md, constraint-injection.md, prediction-markers.md, critical-mode.md — extracted from constraint-injector.ts, context-organizer.ts, prediction-protocol.ts
  - **prompts/analysis/ (6 files):** extract-and-update.md, construct-proto-task.md, generate-plan.md, verify-progress.md, consistency-scan.md, audit-architecture.md — extracted from transcript-analyzer.ts, proto-task-learner.ts, plan-generator.ts, consistency-checker.ts, architecture-auditor.ts
  - **prompts/user/ (2 files):** perception-summary.md, crystallization-proposal.md — session perception + structure crystallization approval
  - **types/memory.ts:** Re-export entry for ProtoStructure, ProtoTask, LearningEvent, CompetencyModel, confidence/fusion types from cognitive/types.ts
  - **types/scene.ts:** Re-export entry for ScenarioMatch, GuidanceSignal, AutonomyPolicy from cognitive/types.ts + TaskContext from orchestration/task-context.ts
  - **types/hooks.ts:** Re-export entry for 7 lifecycle event types from cognitive/types.ts

### Changed
- **cognitive/types.ts:** Added Phase 10 re-export documentation comment — backward compatible; all original type definitions preserved

### Notes
- All 13 prompt .md files use Handlebars-style `{{variable}}` template syntax, independently editable without touching TypeScript source
- types/ files are organized entry points; original type definitions remain in cognitive/types.ts for backward compatibility
- 855 tests, 69 files, zero regressions. Typecheck clean.

## [0.20.0.0] - 2026-06-28

### Added
- **Phase 9 Missing Architecture Modules — 12 new modules completing §11 module tree:**
  - **orchestration/plan-generator.ts (P0):** ProtoTask + TaskContext → PlanDocument. Generates executable plans with phases, subtasks, criteria, guidance signals, and pitfalls. 12 tests.
  - **orchestration/verifier.ts (P1):** 5 verification criteria (command_output, file_existence, test_pass, llm, user_approval). Command whitelist. 21 tests.
  - **orchestration/progress-tracker.ts (P2):** Progress event collection from after_tool_call + agent_end. Summary generation. 11 tests.
  - **orchestration/pitfall-matcher.ts (P2):** CJK 2-gram keyword matching for real-time pitfall detection. Minimum 2-keyword threshold to avoid false positives. 7 tests.
  - **analysis/pitfall-learner.ts (P1):** Pitfall hit recording + false-positive rate control (>30% auto-downgrade severity). 14 tests.
  - **analysis/consistency-checker.ts (P2):** Cross-structure contradiction detection (known_contradiction, constraint_paradox, name_collision). 6 tests.
  - **analysis/degradation-checker.ts (P2):** Degradation condition detection (stale, low_confidence, superseded). 12 tests.
  - **analysis/config-adapter.ts (P2):** GovernancePolicy runtime adaptation based on session maturity (threshold, curiosity mode, max subagents). 7 tests.
  - **memory/slots.ts (P1):** Centralized AgentMemory slot names + metadata (description, maxSize, schemaVersion). resolveSlotName() for dynamic slots. 14 tests.
  - **memory/schemas.ts (P1):** JSON Schema definitions for ProtoStructure, ProtoTask, CompetencyModel, TaskContext. Lightweight validation (zero deps). 18 tests.
  - **memory/queries.ts (P2):** Composite query builders for AgentMemory smart_search. 4 tests.
  - **files/plan-file-writer.ts (P2):** Planning-with-files compatible markdown formatters (task_plan.md, progress.md, findings.md). 7 tests.

### Notes
- All 12 modules created directly in target directories per Phase 8 reorganization (`src/orchestration/`, `src/analysis/`, `src/memory/`, `src/files/`).
- Strict TDD: every module has a test file written first, watched it fail (module not found), then implemented.
- Zero regressions: all 815 existing tests continue to pass.
- `src/files/` directory created as new top-level module directory.

## [0.19.0.0] - 2026-06-28

### Changed
- **Phase 8 Module Reorganization — 平铺 → §11 目录结构:**
  - `src/hooks/`: 7 handlers moved (session-start, session-end, before-tool-call, after-tool-call, agent-end, message-received, cron-tick)
  - `src/orchestration/`: 9 modules consolidated (orchestrator, context-organizer, context-pressure-monitor, task-context, session-state-store, maturity, proto-constraint, constraint-injector, constraint-validator)
  - `src/analysis/`: 8 modules consolidated (transcript-analyzer, transcript-analyzer-v2, attention-telemetry, semantic-disambiguator, structure-lifecycle, structure-graph, structure-version, llm-adapter)
  - `src/cognitive/`: 17 dead modules deleted (governor, gap-detector, heartbeat-monitor, proto-task, metacognitive-engine, learning-loop, task-assessment, execution-feedback, learning-update, memory-consolidator, cross-domain-analyzer, strategy-registry, subagent-manager, task-scheduler, task-state-machine, timing-controller + tests)
  - `cognitive-core.ts`: reduced to minimal bridge stub
  - `scripts/`: import paths updated for new module locations
- 682 tests, 55 files, typecheck clean. No behavioral changes.

## [0.18.0.0] - 2026-06-28

### Added
- **Phase 7 M2 Context Orchestration Wiring:**
  - **deriveMaturity:** Session-count-based maturity derivation (novice/competent/expert). 8 tests. (`src/maturity.ts`)
  - **Maturity in session_start:** deriveMaturity wired into EventOrchestrator.handleSessionStart — reads `session_count` from AgentMemory slot, passes to context organizer. (`src/orchestrator.ts`)
  - **Semantic Disambiguation:** `disambiguateText()` wired into handleMessageReceived — user messages are analyzed for cross-scenario homographs. (`src/orchestrator.ts`)
  - **TaskContext Progress:** `applyProgress()` wired into handleSessionEnd — LLM infers task progress, confidence <0.7 gates auto-update. (`src/orchestrator.ts`)

### Changed
- **orchestrator.ts:** handleSessionStart reads/increments session_count slot, passes maturity to SessionStartHandler. handleMessageReceived runs disambiguation. handleSessionEnd loads TaskContext and applies LLM-inferred progress.

### Notes
- `recallStructure` (Critical Lazy Loading): core logic ready in `src/memory/recall-structure.ts`; full MCP tool registration deferred to deployment phase.

### Tests
- 10 new tests: maturity (8), session-start Phase 7 (2)
- 995 total tests, 70 files, all green. Typecheck clean.

## [0.17.0.0] - 2026-06-28

### Added
- **Phase 6 ConceptVerifier Wiring:**
  - **LlmClient Adapter:** `adaptLlmClient()` — bridges `LLMSubsystem` → `LlmClient` for ConceptVerifier consumption (`src/llm-adapter.ts`). 5 tests.
  - **ConceptVerifier Integration:** 3rd independent verifier wired into session-end fusion pipeline. LlmClient unavailable → gracefully omitted (no crash). 3 tests. (`src/session-end.ts`)
  - **VerificationContext roleMap:** Constructed from injected role structures, passed to RoleVerifier for DAG cycle detection — previously always skipped. (`src/session-end.ts`)

### Changed
- **session-end.ts:** Verifier array widened to `Verifier[]`. ConceptVerifier conditionally added when `LLMSubsystem.analyze` available.
- **session-end.ts:** VerificationContext enriched with `roleMap` from injected role structures.

### Tests
- 8 new tests: adaptLlmClient (5), session-end Phase 6 (3)
- 985 total tests, 69 files, all green. Typecheck clean.

## [0.16.0.0] - 2026-06-28

### Added
- **Phase 5 Production Wiring — bun per-hook 入口 + 共享 deps:**
  - **M0 Builder:** 从 `phase1a-bridge.ts` 提取共享 `buildM0Deps()` 工厂 (`src/m0-builder.ts`). 17 tests.
  - **Praxis Hook Entry:** bun per-hook 统一入口 (`scripts/praxis-hook.ts`). 14 tests.
  - **Praxis Cron Entry:** OS-cron per-tick 入口 (`scripts/praxis-cron.ts`).
  - **Bridge Data Migration:** `~/.praxis-phase1a/` → AgentMemory slot (`src/bridge-migration.ts`).
  - **B6 TeleologicalMapping Fix:** `session_start.loadProtoStructures` 补充字段. 3 tests.

### Changed
- **phase1a-bridge.ts:** @deprecated, 委托给共享 buildM0Deps (71→1 行).
- **session-start.ts:** loadProtoStructures 增加 teleologicalMapping.

### Tests
- 34 new tests: m0-builder (17), praxis-hook (14), B6 teleologicalMapping (3)
- 977 total tests, 68 files, all green. Typecheck clean.

## [0.15.0.0] - 2026-06-28

### Added
- **Phase 4 Cleanup — 接线债清零:**
  - **T18 DRY Adapters:** 共享 `base-adapter.ts` 工厂函数 (`createBaseAdapter`) — 提取 openclaw/claude-code 适配器 ~90% 重复映射逻辑. 27 tests. (`src/adapters/base-adapter.ts`)
  - **T12 Degraded Constraint Cache:** session_start write-through 活跃约束到 local-cache → before_tool_call `loadConstraintsFromCache()` 降级读取. AgentMemory 不可用时约束仍可执行 (§12 优雅降级). 8 tests. (`src/before-tool-call.ts`, `src/session-start.ts`, `src/orchestrator.ts`)
  - **T11 CrossAgentSync Wiring:** session-end 集成 `CrossAgentSync.saveWithOptimisticLock` (CAS version-check) 替代直接 `saveProtoStructure`. 冲突 → pending_merge staging. EventOrchestrator 自动实例化并注入. 5 tests. (`src/session-end.ts`, `src/orchestrator.ts`)
  - **T14 Test Completion:** 8 个此前无测试模块补齐测试 (role-verifier, concept-verifier, curiosity-engine, structure-retirement, proto-task-learner, cross-agent-sync, praxis-audit, praxis-status). 52 new tests.

### Changed
- **adapters/openclaw-adapter.ts:** 126→19 lines — 使用 base-adapter 工厂, OpenClaw 无覆盖
- **adapters/claude-code-adapter.ts:** 141→68 lines — 仅覆盖 Notification 过滤 + 额外 result 字段
- **session-end.ts:** 新增 `saveStructureSafe()` helper — CrossAgentSync 优先, 不可用时降级 saveProtoStructure
- **before-tool-call.ts:** 新增 `loadConstraintsFromCache()` — local-cache 降级路径
- **orchestrator.ts:** CrossAgentSync 实例化 + session_end 注入 + cache fallback 接线

### Tests
- 91 new tests: base-adapter (26), T12 constraint cache (8), T11 CrossAgentSync wiring (5), T14 module tests (52)
- 943 total tests, 66 files, all green. Typecheck clean.
- Outside voice review: 3 findings fixed (CrossAgentSync dead-code wiring, mock exhaustion, vacuous test)

## [0.12.0.1] - 2026-06-27

### Added
- **M6.4 `/praxis status` command:** 8D 能力雷达图 (文本渲染) + 成长轨迹 (ASCII 图表) + 学习时间线. 从 competency_model、competency_snapshots、lessons 加载数据 (`src/commands/praxis-status.ts`)
- **M6.5 CrossAgentSync:** 跨 Agent 认知同步 + 乐观锁写入 (CAS version-check). 冲突检测 → pending_merge (置信度差异 >15% 需人类审批). LLM 辅助合并接口预留 (`src/analysis/cross-agent-sync.ts`)

### Changed
- **praxis-cli.ts:** `/praxis status` 从存根切换为 handleStatus (8D 雷达 + 成长轨迹 + 时间线)
- **analysis/index.ts:** 导出 CrossAgentSync + OptimisticLockResult + PendingMerge

## [0.12.0.0] - 2026-06-27

### Added
- **M6 Meta Layer + Adapter Layer:** 元认知自治系统 + 多运行时适配器
- **M5 Fix-1 deepCheck wiring:** teleological-judge deepCheck 接入 agent_end — orchestrator 收集 (sequence, correction) 对, AgentEndHandler 异步调用 deepCheck, 结果写入 audit_log (`src/orchestrator.ts`, `src/agent-end.ts`)
- **M5 Fix-2 StructuralGap → cron_tick:** 5 检测器接入 cron_tick 定时扫描, 历史快照累积 (proto_task_history + competency_snapshots, 90天保留), 检测信号写入 audit_log (`src/cron-tick.ts`)
- **M5 Fix-3 audit_log writer:** before_tool_call 约束违反时写入 audit_log entries, 10K 条上限 + violations 向后兼容字段 (`src/before-tool-call.ts`)
- **M5 Fix-4 attentionRecords persistence:** session_end 持久化 attentionRecords 到 AgentMemory slot, orchestrator session_start 恢复 (`src/session-end.ts`, `src/orchestrator.ts`)
- **M6.1 ArchitectureAuditor:** 4 维度对抗性架构审计 — 结构健康度聚合/认知边界/自我一致性/对抗性挑战(LLM), 输出 ArchitectureAuditReport → `architecture_audit` slot (`src/analysis/architecture-auditor.ts`)
- **M6.1 CategoryAuditor:** 范畴完备性检查(Q1) + 领域同质性检查(Q2) + 康德式诊断分叉(data vs category) + 冷启动 insufficient_data 状态 + 新范畴提案 → `category_proposals` slot (`src/analysis/category-auditor.ts`)
- **M6.1 Meta Layer cron scheduling:** cron_tick 按间隔调度 (structural_gap 168h, category_audit 720h), audit_log 保留策略 (90天窗口 + 10K 上限, 条件执行每小时一次) (`src/cron-tick.ts`)
- **M6.2 Adapter Interface:** 标准 AgentRuntimeAdapter 类型 — 纯函数集合, 6 事件映射 + 2 决策映射, 无 PraxisStandardEvent 中间格式 (`src/adapters/adapter-interface.ts`)
- **M6.2 OpenClaw Adapter:** 参考实现 — OpenClaw Hook → PraxisLifecycleEvent 映射, 纯函数 (`src/adapters/openclaw-adapter.ts`, 16 tests)
- **M6.3 Claude Code Adapter:** Claude Code Hook → PraxisLifecycleEvent 映射, Notification 过滤 (仅 user_message), PreToolUse/PostToolUse/Stop/SessionEnd/PreCompact 映射 (`src/adapters/claude-code-adapter.ts`, 11 tests)
- **M6 Platform Adapter Bridge:** platform-adapter.ts 新增 acceptAdapterEvent 入口 + toPlatformEvent 转换, 适配器 → 平台管线桥梁 (`src/platform-adapter.ts`)
- **M6 /praxis audit enhanced:** 审计报告读取 architecture_audit + category_audit slot, audit_log entries 中解析 constraint_violation + structural_gap_signal (`src/commands/praxis-audit.ts`)

### Changed
- **cron-tick.ts:** 从 M5.3 两步骤 (ProtoTask + decay) 扩展到 6 步骤 (+历史累积 + StructuralGap 检测 + Meta Layer 调度 + audit_log 清理 + 健康状态), ~500 行
- **orchestrator.ts:** SessionState 新增 corrections 字段, handleMessageReceived 收集纠正对, handleAgentEnd 传递 deepCheck 数据, loadAttentionRecords 恢复
- **agent-end.ts:** AgentEndHandler 接受 corrections + ProtoSequences + LLM, handle() 中异步 deepCheck, AgentEndSummary 含 teleologicalChecks 计数
- **session-end.ts:** Phase 0 attention 更新后调用 persistAttentionRecords, 新增 persistAttentionRecords 和 writeLesson 方法
- **before-tool-call.ts:** handle() 新增 writeAuditLog 步骤, audit_log entries 格式 + violations 向后兼容
- **analysis/index.ts:** 导出 ArchitectureAuditor, CategoryAuditor 及关联类型
- **praxis-audit.ts:** AuditReport 新增 structuralGapSignals/architectureAudit/categoryAudit, ViolationEntry/StructuralGapSignalEntry 类型

### Docs
- **M6-dev-plan.md:** 923 行开发计划, 14 章节, 7 设计决策, Outside Voice 审查 (16 发现全部解决)

## [0.11.0.1] - 2026-06-27

### Added
- **M5 Autonomous Learning System:** 5 sub-milestones delivering real-time correction, dual-nature judgment, cross-session mining, structural gap detection, and cognitive health auditing
- **M5.1 MidSessionLearner:** session-scoped real-time learning — user corrections and constraint violations produce `mid_session` SignalSourceInput consumed at agent_end/session_end fusion. Chinese + English keyword extraction, relevance-weighted penalty (BASE 0.05 × confidence × relevance), 0.2 per-session hard cap (`src/analysis/mid-session-learner.ts`, 16 tests)
- **M5.2 TeleologicalJudge:** dual-nature ProtoSequence judgment — `quickCheck()` (postcondition keyword coverage ≥ 70% → alternative implementation, zero-penalty) and `deepCheck()` (LLM async teleological analysis). Correction that preserves function ≠ error (`src/analysis/teleological-judge.ts`, 8 tests)
- **M5.3 ProtoTask accumulation:** log2 confidence growth formula (`0.2 + 0.15 × log2(N+1)`, clamped to [0.2, 0.95]), <3 observations → stats-only, confidence delta >0.15 → human review flag (`src/analysis/proto-task-learner.ts`)
- **M5.3 Decay detection:** reuses existing `shouldMarkInactive(structure, daysSinceLastUsed, 60)` + `transition()` with return-value assignment — structures inactive ≥60 days auto-degrade unless confidence >0.85. CronTick fully implemented with 30-min guard (`src/cron-tick.ts`)
- **M5.4 StructuralGap detection:** 5 pure-function detectors — ProtoTask decline (≥3 consecutive confidence drops), cross-scenario failure (same toolName failing across ≥2 scenarios with >50% failure rate), correction cluster (≥5 corrections per cluster in 30d), skill stagnation (≥30d with <0.05 proficiency change, ≥5 sessions), escalation anomaly (recent count > mean + 2σ) (`src/analysis/structural-gap-detector.ts`)
- **M5.5 `/praxis audit` command:** zombie detection (adoptionRate <20% + confidence >0.7), underestimated (adoptionRate >60% + confidence <0.4), decay warnings, constraint violations, confidence distribution histogram (`src/commands/praxis-audit.ts`, `src/commands/praxis-cli.ts`)
- **Phase 0: M4 runtime wiring** — ConfidenceFuser, updateAttention, and createVersion wired to live EventOrchestrator pipeline. 7-source fusion executes at session_end; attention records capture real injectedStructureIds; version snapshots persist through AgentMemory

### Changed
- **orchestrator.ts:** SessionState expanded (structures, injectedStructureIds, midSessionSources, currentTaskType, currentDomain, midSessionLearner). handleMessageReceived integrates teleological quickCheck filtering + MidSessionLearner correction + `/praxis` command routing. handleSessionEnd passes injected structures + midSessionSources to session-end fusion. handleAgentEnd creates AgentEndHandler with accumulated toolCallTrace + midSessionSources. handleBeforeToolCall accepts (sessionId, toolName) with constraint violation → MidSessionLearner counting
- **session-end.ts:** Phase 0 fusion — merges llmMarkerSources + midSessionSources, fuses per-structure, creates version snapshots, persists via saveProtoStructure. updateAttention() return captured and reassigned. persistSignals/writeLesson enriched with taskType/domain fields
- **agent-end.ts:** midSessionSources array with addMidSessionSources()/drainMidSessionSources(). AgentEndSummary includes fusedCount
- **before-tool-call.ts:** handle(sessionId, toolName) — signature changed adding sessionId. Return type includes optional constraintId. mergeResults passes constraintId to MidSessionLearner
- **cron-tick.ts:** rewritten from skeleton to full implementation — ProtoTask accumulation, decay detection, cron_tick_health slot, 30-min guard
- **message-received.ts:** `/praxis` command detection and routing via parsePraxisCommand()/handlePraxisCommand()
- **m0-deps.ts:** MemorySubsystem extended (saveProtoStructure, searchProtoStructures). M0Deps extended (fuser, attentionRecords, currentTaskType, currentDomain, LLMSubsystem.analyze)

### Docs
- **M5-dev-plan.md:** 781-line development plan covering Phase 0 + 5 sub-milestones with dependency graph, implementation phases, and test requirements

### Added
- **M4 Confidence System:** 7-source weighted fusion engine — break the LLM self-assessment loop with independent verification
- **M4.1 Governor M4 Upgrade:** 4-stage pipeline (classify→gate→decide→dispatch) with 20 LearningEvent types, async LLM fine classification, dedup/frequency/noise gates, null confidence path
- **M4.2 ConfidenceFuser:** 7-source weighted fusion with proportional weight redistribution, source dedup, per-contribution audit decomposition (`src/orchestration/confidence-fuser.ts`)
- **M4.2 Prediction Protocol:** [PREDICTION_CONFIRMED/FAILED/UNCERTAIN] marker parsing, llm_marker signal source, system prompt injection (`src/orchestration/prediction-protocol.ts`)
- **M4.3 StatisticalVerifier:** Tool sequence fuzzy matching with positional window and semantic tool categories — independent of LLM (`src/analysis/statistical-verifier.ts`)
- **M4.3 RoleVerifier:** DAG cycle detection + behavior matching against ProtoRole definitions (`src/analysis/role-verifier.ts`)
- **M4.3 ConceptVerifier:** Adversarial prompt counter-example search for ProtoConcept validation (`src/analysis/concept-verifier.ts`)
- **M4.4 Quinean Gating:** Triple gate (necessity/sufficiency/parsimony) for ProtoSequence crystallization, session≥10 threshold, data-driven no LLM (`src/analysis/quinean-gating.ts`)
- **M4.5 Curiosity Engine:** 4-stage gap detection (detect→prioritize→act→govern) with unknown terms, repeated corrections, stagnant skills (`src/analysis/curiosity-engine.ts`)
- **M4.6 Structure Retirement:** RetiredStructure metadata with superseded_by, key_lessons, reactivation_conditions — reuses existing TRANSITIONS (`src/analysis/structure-retirement.ts`)
- **Relation Graph Propagation:** constrains + alternative_to deterministic confidence propagation (Phase 1)
- **LearningLoop → Governor Merge:** Governor is the sole correction pipeline; LearningLoop preserved but no longer receives new signals
- **Phase1A Bridge:** async governorDecide with shadow telemetry wiring (`src/phase1a-bridge.ts`)

### Changed
- `governor.ts`: decide() → async (LLM fine classify + confidence query), COARSE_TO_FINE 4→20 type mapping, 5-stage gate (isRealExperience→noise→unknown→dedup→frequency)
- `types.ts`: Added LearningEventType (20), LearningEvent, FusionWeights, SignalSourceInput, FusedConfidence, StepMatch, VerifierOutput, VerificationContext, RetiredStructure
- `timing-controller.ts`: SignalType = LearningEventType (unified), TIMING_MAP extended to 20 types
- `cognitive-core.ts`: captureCorrection → async, Governor wired with LlmClient through CognitiveCoreDeps, getFeedback from loop
- `session-end.ts`: Added prediction marker parsing and persistence
- `structure-graph.ts`: fullPropagation extended to 5 relation types (adds constrains + alternative_to)

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
