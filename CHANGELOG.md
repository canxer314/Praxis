# Changelog

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
