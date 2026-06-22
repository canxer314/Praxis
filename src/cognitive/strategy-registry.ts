/**
 * StrategyRegistry — E4: 策略生命周期管理 (CEO Review)
 *
 * 职责:
 *   - StrategyRegistry: 策略 CRUD + 状态机转换
 *   - StrategyProposer: 基于效能数据提议新策略
 *   - StrategyApplier: 策略激活/回滚 (双快照保护)
 *
 * 状态机: PROPOSED → PENDING_REVIEW → APPROVED → ACTIVE → ROLLED_BACK → DORMANT
 * 回滚: primary snapshot → backup snapshot → factory reset
 */

import type { Result } from "../platform-adapter";
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  Strategy,
  StrategyProposal,
  StrategyState,
  StrategyAuditEntry,
} from "./types";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 依赖接口
// ══════════════════════════════════════════════════════════════════

export interface StrategyMemoryClient {
  getSlot(name: string): Promise<Result<unknown>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
}

// ══════════════════════════════════════════════════════════════════
// 默认策略 (factory reset 回退)
// ══════════════════════════════════════════════════════════════════

const FACTORY_DEFAULT_STRATEGIES: Strategy[] = [
  {
    id: "default_calibration",
    name: "默认校准策略",
    description: "基于显式修正信号的回顾性校准",
    state: "ACTIVE",
    domain: "*",
    taskType: "*",
    config: {
      calibrationThreshold: 5,
      selfRatingFloor: 0.1,
      selfRatingCeiling: 0.95,
    },
    metrics: {
      activatedAt: 0,
      rollbackCount: 0,
      successRate: 1.0,
      lastEvaluated: 0,
    },
    auditLog: [],
  },
  {
    id: "default_learning",
    name: "默认学习策略",
    description: "仅从显式修正中学习，3 次重复 → 程序记忆候选",
    state: "ACTIVE",
    domain: "*",
    taskType: "*",
    config: {
      minObservationsForProcedure: 3,
      maxEpisodicPerSession: 10,
    },
    metrics: {
      activatedAt: 0,
      rollbackCount: 0,
      successRate: 1.0,
      lastEvaluated: 0,
    },
    auditLog: [],
  },
];

// ══════════════════════════════════════════════════════════════════
// StrategyRegistry
// ══════════════════════════════════════════════════════════════════

export class StrategyRegistry {
  private readonly memory: StrategyMemoryClient;
  private strategies: Map<string, Strategy> = new Map();
  private readonly slotName = "strategy_registry";

  constructor(memory: StrategyMemoryClient) {
    if (!memory) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP,"StrategyMemoryClient is required");
    this.memory = memory;
  }

  /** 从 AgentMemory 加载策略注册表 */
  async load(): Promise<Result<void>> {
    const result = await this.memory.getSlot(this.slotName);

    if (!result.ok) {
      // 降级: 使用工厂默认策略
      logDegraded("strategy-registry", "load", "slot read failed, using factory defaults");
      this.loadDefaults();
      return { ok: true, value: undefined };
    }

    const stored = result.value as { strategies?: Strategy[] } | undefined;
    if (stored?.strategies && stored.strategies.length > 0) {
      this.strategies = new Map(stored.strategies.map((s) => [s.id, s]));
    } else {
      this.loadDefaults();
    }

    return { ok: true, value: undefined };
  }

  /** 获取某状态下所有策略 */
  getByState(state: StrategyState): Strategy[] {
    return [...this.strategies.values()].filter((s) => s.state === state);
  }

  /** 获取某领域的活跃策略 */
  getActiveForDomain(domain: string): Strategy[] {
    return [...this.strategies.values()].filter(
      (s) => s.state === "ACTIVE" && (s.domain === domain || s.domain === "*"),
    );
  }

  /** 状态转换 */
  async transition(
    strategyId: string,
    toState: StrategyState,
    reason: string,
  ): Promise<Result<Strategy>> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      return {
        ok: false,
        error: { code: "STRATEGY_NOT_FOUND", message: `Strategy ${strategyId} not found` },
      };
    }

    const fromState = strategy.state;
    const valid = this.isValidTransition(fromState, toState);
    if (!valid) {
      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: `Cannot transition ${fromState} → ${toState}`,
        },
      };
    }

    strategy.state = toState;
    strategy.auditLog.push({
      timestamp: Date.now(),
      fromState,
      toState,
      reason,
      source: "auto_proposed",
    });

    this.strategies.set(strategyId, strategy);

    log({
      ts: new Date().toISOString(),
      module: "strategy-registry",
      op: "transition",
      duration_ms: 0,
      outcome: "success",
    });

    return { ok: true, value: strategy };
  }

  /** 新增 proposal */
  addProposal(strategy: Strategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  /** 持久化 */
  async persist(): Promise<Result<void>> {
    const data = { strategies: [...this.strategies.values()] };
    return this.memory.setSlot(this.slotName, data);
  }

  /** 获取所有策略 (只读) */
  getAll(): Strategy[] {
    return [...this.strategies.values()];
  }

  /** 清除所有策略 (rollback/factoryReset 使用) */
  clear(): void {
    this.strategies.clear();
  }

  /**
   * E4: 重新激活 DORMANT 策略 (Phase 2.1)
   *
   * 当 GapDetector 在某个领域检测到 PERSISTENT_GAP 时，
   * 将匹配领域（含通配符 "*"）的 DORMANT 策略转回 PROPOSED。
   *
   * 设计意图: 缺口复现说明之前被搁置的策略可能需要重新评估——
   * 系统不应"忘记"自己曾经尝试过什么，而应在类似困境中重新提出。
   *
   * @returns 成功重新激活的策略列表（可能为空）
   */
  async reactivateDormant(domain: string, reason: string): Promise<Result<Strategy[]>> {
    const dormant = this.getByState("DORMANT");
    const matching = dormant.filter(
      (s) => s.domain === domain || s.domain === "*",
    );

    const reactivated: Strategy[] = [];
    for (const strategy of matching) {
      const result = await this.transition(
        strategy.id,
        "PROPOSED",
        `Gap-triggered reactivation (domain: ${domain}): ${reason}`,
      );
      if (result.ok) {
        reactivated.push(result.value);
      }
    }

    if (reactivated.length > 0) {
      await this.persist();

      log({
        ts: new Date().toISOString(),
        module: "strategy-registry",
        op: "reactivateDormant",
        duration_ms: 0,
        outcome: "success",
        error: `Reactivated ${reactivated.length} DORMANT strategies: ${reactivated.map((s) => s.id).join(", ")}`,
      });
    }

    return { ok: true, value: reactivated };
  }

  // ---- 内部 ----

  private loadDefaults(): void {
    this.strategies.clear();
    for (const s of FACTORY_DEFAULT_STRATEGIES) {
      this.strategies.set(s.id, { ...s });
    }
  }

  private isValidTransition(from: StrategyState, to: StrategyState): boolean {
    // 状态机转换规则
    const validTransitions: Record<StrategyState, StrategyState[]> = {
      PROPOSED: ["PENDING_REVIEW", "REJECTED"],
      PENDING_REVIEW: ["APPROVED", "REJECTED"],
      APPROVED: ["ACTIVE", "REJECTED"],
      ACTIVE: ["ROLLED_BACK", "DORMANT"],
      ROLLED_BACK: ["PROPOSED", "DORMANT"],
      REJECTED: ["PROPOSED"],
      DORMANT: ["PROPOSED"],
    };
    return validTransitions[from]?.includes(to) ?? false;
  }
}

// ══════════════════════════════════════════════════════════════════
// StrategyProposer — E4
// ══════════════════════════════════════════════════════════════════

export class StrategyProposer {
  private readonly registry: StrategyRegistry;

  constructor(registry: StrategyRegistry) {
    if (!registry) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP,"StrategyRegistry is required");
    this.registry = registry;
  }

  /**
   * 基于效能数据提议新策略。
   * TODO: LLM 驱动的策略生成 — Phase 1 仅 stub。
   */
  async propose(
    domain: string,
    _metrics: Record<string, number>,
  ): Promise<Result<StrategyProposal>> {
    const activeStrategies = this.registry.getActiveForDomain(domain);
    const conflicts = activeStrategies.map((s) => s.id);

    // Stub proposal — Phase 1 实现时接入 LLM
    const proposal: StrategyProposal = {
      id: `prop_${domain}_${Date.now()}`,
      strategy: {
        name: `auto_strategy_${domain}`,
        description: `Auto-generated strategy for ${domain}`,
        domain,
        taskType: "*",
        config: {},
      },
      rationale: "基于效能数据自动生成",
      expectedImprovement: "待评估",
      conflicts,
    };

    return { ok: true, value: proposal };
  }
}

// ══════════════════════════════════════════════════════════════════
// StrategyApplier — E4
// ══════════════════════════════════════════════════════════════════

export class StrategyApplier {
  private readonly registry: StrategyRegistry;
  private readonly memory: StrategyMemoryClient;

  constructor(registry: StrategyRegistry, memory: StrategyMemoryClient) {
    if (!registry) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP,"StrategyRegistry is required");
    if (!memory) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP,"StrategyMemoryClient is required");
    this.registry = registry;
    this.memory = memory;
  }

  /**
   * 激活策略 — 先保存 primary + backup 快照。
   * 回滚时可用双快照恢复。
   */
  async activate(strategyId: string): Promise<Result<Strategy>> {
    // 保存快照
    const snapshot = this.registry.getAll();
    await this.memory.setSlot("strategy_snapshot_primary", { strategies: snapshot });

    const result = await this.registry.transition(strategyId, "ACTIVE", "Manual activation");
    if (result.ok) {
      await this.registry.persist();
    }
    return result;
  }

  /**
   * 回滚策略 — 从快照恢复。
   * primary 不可用 → backup → factory reset。
   */
  async rollback(strategyId: string, reason: string): Promise<Result<void>> {
    // 尝试 primary snapshot
    let snapshotResult = await this.memory.getSlot("strategy_snapshot_primary");

    if (!snapshotResult.ok) {
      // 尝试 backup
      snapshotResult = await this.memory.getSlot("strategy_snapshot_backup");
    }

    if (!snapshotResult.ok) {
      // Factory reset
      logDegraded("strategy-applier", "rollback", "both snapshots unavailable, factory reset");
      await this.factoryReset();
      return { ok: true, value: undefined };
    }

    // 恢复快照: 先清空再写入 (E5 fix — rollback is restore, not merge)
    const snapshot = snapshotResult.value as { strategies?: Strategy[] };
    this.registry.clear();
    if (snapshot?.strategies) {
      for (const s of snapshot.strategies) {
        this.registry.addProposal(s);
      }
    }

    await this.registry.transition(strategyId, "ROLLED_BACK", reason);
    await this.registry.persist();

    log({
      ts: new Date().toISOString(),
      module: "strategy-applier",
      op: "rollback",
      duration_ms: 0,
      outcome: "success",
      error: reason,
    });

    return { ok: true, value: undefined };
  }

  /** Factory reset — 使用硬编码默认值，不从 slot 读取 */
  private async factoryReset(): Promise<void> {
    this.registry.clear();
    for (const s of FACTORY_DEFAULT_STRATEGIES) {
      this.registry.addProposal({ ...s, auditLog: [...s.auditLog] });
    }
    await this.registry.persist();

    log({
      ts: new Date().toISOString(),
      module: "strategy-applier",
      op: "factoryReset",
      duration_ms: 0,
      outcome: "degraded",
      error: "FACTORY RESET — all custom strategies cleared",
    });
  }
}
