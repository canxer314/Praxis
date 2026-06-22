# Changelog

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
