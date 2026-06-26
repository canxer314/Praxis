/**
 * PredictionProtocol 测试 — 标记解析
 */

import { describe, it, expect } from "vitest";
import { parsePredictionMarkers, markersToSignalSource, predictionMarkerPrompt, buildPredictionInjection } from "./prediction-protocol";

describe("parsePredictionMarkers", () => {
  it("解析 CONFIRMED 标记", () => {
    const text = "[PREDICTION_CONFIRMED: hospital_outpatient_flow] Task completed as expected";
    const result = parsePredictionMarkers(text);
    expect(result).toHaveLength(1);
    expect(result[0].marker).toBe("PREDICTION_CONFIRMED");
    expect(result[0].structureId).toBe("hospital_outpatient_flow");
  });

  it("解析 FAILED 标记", () => {
    const text = "The sequence didn't match [PREDICTION_FAILED: api_design] because API changed";
    const result = parsePredictionMarkers(text);
    expect(result).toHaveLength(1);
    expect(result[0].marker).toBe("PREDICTION_FAILED");
  });

  it("解析 UNCERTAIN 标记", () => {
    const text = "[PREDICTION_UNCERTAIN: meeting_cadence] Not sure if this pattern applies";
    const result = parsePredictionMarkers(text);
    expect(result).toHaveLength(1);
    expect(result[0].marker).toBe("PREDICTION_UNCERTAIN");
  });

  it("解析多个标记", () => {
    const text = `
      [PREDICTION_CONFIRMED: flow_a] First sequence matched
      [PREDICTION_FAILED: flow_b] Second did not
      [PREDICTION_UNCERTAIN: flow_c] Third unclear
    `;
    const result = parsePredictionMarkers(text);
    expect(result).toHaveLength(3);
  });

  it("无标记 → 空数组", () => {
    expect(parsePredictionMarkers("no markers here")).toHaveLength(0);
    expect(parsePredictionMarkers("")).toHaveLength(0);
  });
});

describe("markersToSignalSource", () => {
  it("CONFIRMED → value 1.0", () => {
    const predictions = [{ marker: "PREDICTION_CONFIRMED" as const, structureId: "s1", context: "" }];
    const result = markersToSignalSource(predictions, "s1");
    expect(result!.value).toBe(1.0);
  });

  it("FAILED → value 0.0", () => {
    const predictions = [{ marker: "PREDICTION_FAILED" as const, structureId: "s1", context: "" }];
    const result = markersToSignalSource(predictions, "s1");
    expect(result!.value).toBe(0.0);
  });

  it("UNCERTAIN → value 0.5", () => {
    const predictions = [{ marker: "PREDICTION_UNCERTAIN" as const, structureId: "s1", context: "" }];
    const result = markersToSignalSource(predictions, "s1");
    expect(result!.value).toBe(0.5);
  });

  it("不匹配的 structureId → null", () => {
    const predictions = [{ marker: "PREDICTION_CONFIRMED" as const, structureId: "s1", context: "" }];
    const result = markersToSignalSource(predictions, "s2");
    expect(result).toBeNull();
  });
});

describe("predictionMarkerPrompt", () => {
  it("生成非空 prompt", () => {
    const prompt = predictionMarkerPrompt();
    expect(prompt).toContain("PREDICTION_CONFIRMED");
    expect(prompt).toContain("PREDICTION_FAILED");
    expect(prompt).toContain("PREDICTION_UNCERTAIN");
  });
});

describe("buildPredictionInjection", () => {
  it("空列表 → 空字符串", () => {
    expect(buildPredictionInjection([])).toBe("");
  });

  it("包含 structure IDs", () => {
    const injection = buildPredictionInjection(["flow_a", "flow_b"]);
    expect(injection).toContain("flow_a");
    expect(injection).toContain("flow_b");
    expect(injection).toContain("PREDICTION_CONFIRMED");
  });
});
