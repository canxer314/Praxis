/**
 * context-pressure-monitor 测试
 *
 * 覆盖: 四级压力测量、策略切换、边界条件
 */

import { describe, it, expect } from "vitest";
import {
  measurePressure,
  getInjectionStrategy,
  assessPressure,
  CRITICAL_FREE_THRESHOLD,
  HIGH_FREE_THRESHOLD,
  ELEVATED_FREE_THRESHOLD,
  DEFAULT_CONTEXT_WINDOW,
} from "./context-pressure-monitor";

// ══════════════════════════════════════════════════════════════════
// measurePressure — 四级压力测量
// ══════════════════════════════════════════════════════════════════

describe("measurePressure", () => {
  it("空上下文 → Normal 压力级别", () => {
    const reading = measurePressure(0);
    expect(reading.level).toBe("normal");
    expect(reading.utilizationPercent).toBe(0);
    expect(reading.freeTokens).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("50% 利用率 → Normal 压力级别", () => {
    const reading = measurePressure(500_000);
    expect(reading.level).toBe("normal");
    expect(reading.freeTokens).toBe(500_000);
    expect(reading.utilizationPercent).toBe(50);
  });

  it("~75% 利用率 → Elevated 压力级别", () => {
    // freeTokens between 100K and 250K → elevated
    const reading = measurePressure(800_000); // 200K free → elevated
    expect(reading.level).toBe("elevated");
    expect(reading.freeTokens).toBe(200_000);
  });

  it("~90% 利用率 → High 压力级别", () => {
    // freeTokens between 50K and 100K → high
    const reading = measurePressure(930_000); // 70K free → high
    expect(reading.level).toBe("high");
    expect(reading.freeTokens).toBe(70_000);
  });

  it("~95% 利用率 → Critical 压力级别 + Lazy Loading", () => {
    // freeTokens <= 50K → critical
    const reading = measurePressure(970_000); // 30K free → critical
    expect(reading.level).toBe("critical");
    expect(reading.freeTokens).toBe(30_000);
    expect(reading.utilizationPercent).toBe(97);
  });

  it("边界: Elevated/High 分界线 (250K free)", () => {
    // Exactly 250K free → still elevated (not normal)
    const usedAtBorder = DEFAULT_CONTEXT_WINDOW - ELEVATED_FREE_THRESHOLD;
    const reading = measurePressure(usedAtBorder);
    expect(reading.level).toBe("elevated");
    expect(reading.freeTokens).toBe(ELEVATED_FREE_THRESHOLD);
  });

  it("边界: High/Critical 分界线 (100K free)", () => {
    // Exactly 100K free → still high (not elevated)
    const usedAtBorder = DEFAULT_CONTEXT_WINDOW - HIGH_FREE_THRESHOLD;
    const reading = measurePressure(usedAtBorder);
    expect(reading.level).toBe("high");
    expect(reading.freeTokens).toBe(HIGH_FREE_THRESHOLD);
  });

  it("100% 利用率 → Critical", () => {
    const reading = measurePressure(DEFAULT_CONTEXT_WINDOW);
    expect(reading.level).toBe("critical");
    expect(reading.freeTokens).toBe(0);
    expect(reading.utilizationPercent).toBe(100);
  });

  it("超过窗口大小的使用量 → 不崩溃，freeTokens 为 0", () => {
    const reading = measurePressure(DEFAULT_CONTEXT_WINDOW + 100_000);
    expect(reading.level).toBe("critical");
    expect(reading.freeTokens).toBe(0);
    expect(reading.utilizationPercent).toBe(100);
  });

  it("自定义窗口大小正确计算", () => {
    // 200K window, 150K used → 50K free → critical
    const reading = measurePressure(150_000, 200_000);
    expect(reading.level).toBe("critical");
    expect(reading.windowSize).toBe(200_000);
  });
});

// ══════════════════════════════════════════════════════════════════
// getInjectionStrategy — 策略切换
// ══════════════════════════════════════════════════════════════════

describe("getInjectionStrategy", () => {
  it("Normal → 全量注入，无 Lazy Loading", () => {
    const strategy = getInjectionStrategy("normal");
    expect(strategy.tierARetention).toBe(1.0);
    expect(strategy.tierBRetention).toBe(1.0);
    expect(strategy.tierCRetention).toBe(1.0);
    expect(strategy.lazyLoading).toBe(false);
  });

  it("Elevated → Tier C 移除, Tier B 压缩 60%", () => {
    const strategy = getInjectionStrategy("elevated");
    expect(strategy.tierARetention).toBe(1.0);
    expect(strategy.tierBRetention).toBe(0.6);
    expect(strategy.tierCRetention).toBe(0.0);
    expect(strategy.lazyLoading).toBe(false);
  });

  it("High → 仅 Tier A + 极度压缩 Tier B", () => {
    const strategy = getInjectionStrategy("high");
    expect(strategy.tierARetention).toBe(1.0);
    expect(strategy.tierBRetention).toBe(0.3);
    expect(strategy.tierCRetention).toBe(0.0);
    expect(strategy.lazyLoading).toBe(false);
  });

  it("Critical → Tier A only + Lazy Loading 启用", () => {
    const strategy = getInjectionStrategy("critical");
    expect(strategy.tierARetention).toBe(1.0);
    expect(strategy.tierBRetention).toBe(0.0);
    expect(strategy.tierCRetention).toBe(0.0);
    expect(strategy.lazyLoading).toBe(true);
  });

  it("返回的策略是独立副本，修改不影响原始", () => {
    const s1 = getInjectionStrategy("normal");
    const s2 = getInjectionStrategy("normal");
    s1.tierBRetention = 0.5;
    expect(s2.tierBRetention).toBe(1.0);
  });
});

// ══════════════════════════════════════════════════════════════════
// assessPressure — 便捷组合
// ══════════════════════════════════════════════════════════════════

describe("assessPressure", () => {
  it("返回 reading + strategy", () => {
    // 800K used → 200K free → elevated
    const result = assessPressure(800_000);
    expect(result.reading.level).toBe("elevated");
    expect(result.strategy.lazyLoading).toBe(false);
    expect(result.strategy.tierCRetention).toBe(0.0);
  });

  it("Critical 模式下返回 Lazy Loading 策略", () => {
    const result = assessPressure(980_000);
    expect(result.reading.level).toBe("critical");
    expect(result.strategy.lazyLoading).toBe(true);
  });
});
