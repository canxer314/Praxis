/**
 * analysis/config-adapter.ts — 配置自适应测试
 */

import { describe, it, expect } from "vitest";
import {
  adaptThreshold,
  adaptCuriosityMode,
  adaptMaxSubagents,
  type GovernancePolicy,
} from "./config-adapter";

const BASE_POLICY: GovernancePolicy = {
  autonomy: { defaultPolicy: { unknownOperation: "confirm", lowRiskKnown: "inform", highRiskKnown: "confirm", afterError: "downgrade_one" } },
  contextPressure: { normalThresholdK: 400, elevatedThresholdK: 250, highThresholdK: 100, criticalThresholdK: 50 },
  taskContext: { autoUpdateConfidenceThreshold: 0.7 },
  curiosity: { mode: "ask_when_confident", threshold: 0.6 },
  pitfallTracking: { autoDowngradeMisrate: 0.3 },
  maxSubagents: 3,
};

describe("adaptThreshold", () => {
  it("returns default when session count is low", () => {
    expect(adaptThreshold(0.7, 5, 50)).toBe(0.7);
  });

  it("lowers threshold for expert users (50+ sessions)", () => {
    const adapted = adaptThreshold(0.7, 60, 50);
    expect(adapted).toBeLessThan(0.7);
  });

  it("never goes below minimum bound", () => {
    const adapted = adaptThreshold(0.3, 200, 50);
    expect(adapted).toBeGreaterThanOrEqual(0.1);
  });
});

describe("adaptCuriosityMode", () => {
  it("keeps mode for low session counts", () => {
    expect(adaptCuriosityMode(BASE_POLICY, 5)).toBe("ask_when_confident");
  });

  it("upgrades to proactive for expert users", () => {
    expect(adaptCuriosityMode(BASE_POLICY, 60)).toBe("proactive");
  });
});

describe("adaptMaxSubagents", () => {
  it("keeps default for novice", () => {
    expect(adaptMaxSubagents(BASE_POLICY, 5)).toBe(3);
  });

  it("increases for expert", () => {
    expect(adaptMaxSubagents(BASE_POLICY, 60)).toBeGreaterThan(3);
  });
});
