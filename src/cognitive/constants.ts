/**
 * Slot name constants — 共享 slot 名称，避免跨模块字符串重复。
 *
 * 所有 AgentMemory slot 名称应引用此文件中的常量，不直接使用字符串字面量。
 */

export const SLOTS = {
  /** 元认知 profile (MetacognitiveEngine) */
  METACOGNITIVE_PROFILE: "metacognitive_profile",
  /** 策略注册表 (StrategyRegistry) */
  STRATEGY_REGISTRY: "strategy_registry",
  /** E4 回滚主快照 */
  STRATEGY_SNAPSHOT_PRIMARY: "strategy_snapshot_primary",
  /** E4 回滚备快照 */
  STRATEGY_SNAPSHOT_BACKUP: "strategy_snapshot_backup",
  /** E5 cron 健康检查 (CrossDomainAnalyzer) */
  CRON_HEALTH: "cron_health",
  /** E5 跨领域迁移追踪 (CrossDomainAnalyzer) */
  CROSS_DOMAIN_MIGRATIONS: "cross_domain_migrations",
  /** Phase 1A 学习记录 */
  PRAXIS_LEARNINGS: "praxis_learnings",
  /** 进度日志 (Phase 1A) */
  PROGRESS_LOG: "progress_log",
  /** V13: 任务调度状态 */
  TASK_SCHEDULE: "task_schedule",
  /** V13: 子 Agent 注册表 */
  SUBAGENT_REGISTRY: "subagent_registry",
  /** V13: 心跳监控状态 */
  HEARTBEAT_STATE: "heartbeat_state",
} as const;
