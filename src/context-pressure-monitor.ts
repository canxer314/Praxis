/**
 * Context Pressure Monitor — M2 Step 2.1: 四级压力自适应
 *
 * 纯函数模块。在 session_start 时估计上下文利用率，按阈值分类为
 * Normal / Elevated / High / Critical 四级，驱动注入策略切换。
 *
 * 架构参考: architech/praxis-architecture.md §7.2 (四级压力自适应)
 */

import type { PressureLevel } from "./context-organizer";

// ══════════════════════════════════════════════════════════════════
// 阈值常量
// ══════════════════════════════════════════════════════════════════

/** 上下文窗口大小低于此值 → Critical */
const CRITICAL_FREE_THRESHOLD = 50_000;
/** 上下文窗口大小低于此值 → High */
const HIGH_FREE_THRESHOLD = 100_000;
/** 上下文窗口大小低于此值 → Elevated */
const ELEVATED_FREE_THRESHOLD = 250_000;
/** 高于此值 → Normal */
// (> ELEVATED_FREE_THRESHOLD is Normal)

/** 默认上下文窗口大小 (1M token 模型) */
const DEFAULT_CONTEXT_WINDOW = 1_000_000;

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** 压力测量结果 */
export interface PressureReading {
  level: PressureLevel;
  /** 估计的空闲 token 数 */
  freeTokens: number;
  /** 利用率百分比 (0-100) */
  utilizationPercent: number;
  /** 上下文窗口总大小 */
  windowSize: number;
  /** 估计已使用的 token 数 */
  estimatedUsed: number;
}

/** 注入策略 — 每种压力级别对应的注入行为 */
export interface InjectionStrategy {
  /** Tier A 保留比例 */
  tierARetention: number;
  /** Tier B 保留比例 */
  tierBRetention: number;
  /** Tier C 保留比例 */
  tierCRetention: number;
  /** 是否启用 Lazy Loading (recall_structure) */
  lazyLoading: boolean;
  /** 策略的人类可读描述 */
  description: string;
}

// ══════════════════════════════════════════════════════════════════
// 注入策略表
// ══════════════════════════════════════════════════════════════════

const STRATEGIES: Record<PressureLevel, InjectionStrategy> = {
  normal: {
    tierARetention: 1.0,
    tierBRetention: 1.0,
    tierCRetention: 1.0,
    lazyLoading: false,
    description: "Tier A/B/C 全量注入 (~30K tokens)",
  },
  elevated: {
    tierARetention: 1.0,
    tierBRetention: 0.6,
    tierCRetention: 0.0,
    lazyLoading: false,
    description: "Tier A 全量 + Tier B 压缩 + Tier C 移除 (~16K tokens)",
  },
  high: {
    tierARetention: 1.0,
    tierBRetention: 0.3,
    tierCRetention: 0.0,
    lazyLoading: false,
    description: "仅 Tier A 摘要 (~3.5K tokens)",
  },
  critical: {
    tierARetention: 1.0,
    tierBRetention: 0.0,
    tierCRetention: 0.0,
    lazyLoading: true,
    description: "结构索引 + recall_structure Lazy Loading (~1K tokens)",
  },
};

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 测量当前上下文压力级别。
 *
 * 纯函数 — 基于估计的 token 使用量计算压力级别。
 *
 * @param estimatedUsed  估计已使用的 token 数（来自 LLM 的 usage 反馈或保守估算）
 * @param windowSize     上下文窗口总大小（默认 1M）
 * @returns PressureReading — 压力级别 + 详细指标
 */
export function measurePressure(
  estimatedUsed: number,
  windowSize: number = DEFAULT_CONTEXT_WINDOW,
): PressureReading {
  const freeTokens = Math.max(0, windowSize - estimatedUsed);
  const utilizationPercent = Math.min(100, Math.round((estimatedUsed / windowSize) * 100));

  let level: PressureLevel;
  if (freeTokens <= CRITICAL_FREE_THRESHOLD) {
    level = "critical";
  } else if (freeTokens <= HIGH_FREE_THRESHOLD) {
    level = "high";
  } else if (freeTokens <= ELEVATED_FREE_THRESHOLD) {
    level = "elevated";
  } else {
    level = "normal";
  }

  return { level, freeTokens, utilizationPercent, windowSize, estimatedUsed };
}

/**
 * 获取指定压力级别的注入策略。
 *
 * @param level 压力级别
 * @returns InjectionStrategy — 该级别的 Tier 保留比例 + Lazy Loading 开关
 */
export function getInjectionStrategy(level: PressureLevel): InjectionStrategy {
  return { ...STRATEGIES[level] };
}

/**
 * 便捷方法: 根据估计使用量直接获取注入策略。
 *
 * @param estimatedUsed  估计已使用的 token 数
 * @param windowSize     上下文窗口总大小（默认 1M）
 * @returns { reading: PressureReading; strategy: InjectionStrategy }
 */
export function assessPressure(
  estimatedUsed: number,
  windowSize: number = DEFAULT_CONTEXT_WINDOW,
): { reading: PressureReading; strategy: InjectionStrategy } {
  const reading = measurePressure(estimatedUsed, windowSize);
  const strategy = getInjectionStrategy(reading.level);
  return { reading, strategy };
}

// ══════════════════════════════════════════════════════════════════
// Re-export 便捷常量
// ══════════════════════════════════════════════════════════════════

export {
  CRITICAL_FREE_THRESHOLD,
  HIGH_FREE_THRESHOLD,
  ELEVATED_FREE_THRESHOLD,
  DEFAULT_CONTEXT_WINDOW,
};
