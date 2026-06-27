import { describe, it, expect } from "vitest";
import {
  detectProtoTaskDecline,
  detectCrossScenarioFailure,
  detectCorrectionCluster,
  detectSkillStagnation,
  detectEscalationAnomaly,
} from "./structural-gap-detector";

describe("detectProtoTaskDecline", () => {
  it("detects 3 consecutive confidence drops", () => {
    const history = [
      { taskType: "build", confidence: 0.9, timestamp: 1000 },
      { taskType: "build", confidence: 0.7, timestamp: 2000 },
      { taskType: "build", confidence: 0.5, timestamp: 3000 },
      { taskType: "build", confidence: 0.3, timestamp: 4000 },
    ];
    const signal = detectProtoTaskDecline(history);
    expect(signal).not.toBeNull();
    expect(signal!.signalType).toBe(1);
  });

  it("returns null for insufficient history", () => {
    expect(detectProtoTaskDecline([])).toBeNull();
    expect(detectProtoTaskDecline([{ taskType: "a", confidence: 0.5, timestamp: 1 }])).toBeNull();
  });

  it("returns null for stable confidence", () => {
    const history = [
      { taskType: "build", confidence: 0.8, timestamp: 1000 },
      { taskType: "build", confidence: 0.8, timestamp: 2000 },
      { taskType: "build", confidence: 0.8, timestamp: 3000 },
      { taskType: "build", confidence: 0.8, timestamp: 4000 },
    ];
    expect(detectProtoTaskDecline(history)).toBeNull();
  });
});

describe("detectCrossScenarioFailure", () => {
  it("detects same tool failing across 2+ scenarios with >50% failure rate", () => {
    const records = [
      { toolName: "deploy", scenarioId: "scen-a", failureCount: 3, totalCalls: 4 },
      { toolName: "deploy", scenarioId: "scen-b", failureCount: 2, totalCalls: 3 },
    ];
    const signal = detectCrossScenarioFailure(records);
    expect(signal).not.toBeNull();
    expect(signal!.signalType).toBe(2);
  });

  it("returns null for single scenario", () => {
    const records = [{ toolName: "deploy", scenarioId: "scen-a", failureCount: 3, totalCalls: 4 }];
    expect(detectCrossScenarioFailure(records)).toBeNull();
  });
});

describe("detectCorrectionCluster", () => {
  it("detects correction cluster with >=5 in 30 days", () => {
    const records = [{ clusterId: "api_pattern", count: 7, last30Days: 6 }];
    const signal = detectCorrectionCluster(records);
    expect(signal).not.toBeNull();
    expect(signal!.signalType).toBe(3);
  });

  it("returns null for below threshold", () => {
    const records = [{ clusterId: "api_pattern", count: 3, last30Days: 2 }];
    expect(detectCorrectionCluster(records)).toBeNull();
  });
});

describe("detectSkillStagnation", () => {
  it("returns null for insufficient history", () => {
    expect(detectSkillStagnation([])).toBeNull();
    expect(detectSkillStagnation([{ dimension: "x", proficiency: 0.5, timestamp: 1 }])).toBeNull();
  });

  it("returns null for improving skill with large delta", () => {
    const now = Date.now();
    const history = [
      { dimension: "tool_proficiency", proficiency: 0.3, timestamp: now - 40 * 86400000 },
      { dimension: "tool_proficiency", proficiency: 0.7, timestamp: now - 10 * 86400000 },
    ];
    expect(detectSkillStagnation(history)).toBeNull();
  });
});

describe("detectEscalationAnomaly", () => {
  it("returns null for single record", () => {
    expect(detectEscalationAnomaly([{ count: 5, timestamp: 1 }])).toBeNull();
  });

  it("returns null for normal escalation pattern", () => {
    const records = [
      { count: 2, timestamp: 1000 },
      { count: 3, timestamp: 2000 },
      { count: 2, timestamp: 3000 },
    ];
    expect(detectEscalationAnomaly(records)).toBeNull();
  });
});
