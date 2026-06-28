/**
 * semantic-disambiguator 测试
 */

import { describe, it, expect } from "vitest";
import {
  disambiguate,
  disambiguateText,
  formatDisambiguationHint,
} from "./semantic-disambiguator";
import type { ScenarioMatch } from "../cognitive/types";

function makeScenario(id: string, conf = 0.9): ScenarioMatch {
  return { scenarioId: id, confidence: conf, source: "llm_inference" };
}

describe("disambiguate", () => {
  it("API 场景下 '对接' → 系统集成", () => {
    const result = disambiguate("对接", [makeScenario("api_design")]);
    expect(result.resolved).toBe(true);
    expect(result.matchedScenario).toBe("api_design");
    expect(result.meaning).toContain("集成");
  });

  it("无场景匹配 → 使用默认含义", () => {
    const result = disambiguate("对接", [makeScenario("unknown_scenario")]);
    expect(result.resolved).toBe(false);
    expect(result.meaning).toContain("连接与协调");
  });

  it("未知词 → 返回空含义", () => {
    const result = disambiguate("不存在的词", [makeScenario("api_design")]);
    expect(result.resolved).toBe(false);
    expect(result.meaning).toBe("");
  });

  it("多场景按置信度优先匹配", () => {
    // api_design 置信度更高 → 应匹配 api_design 的含义
    const result = disambiguate("对接", [
      makeScenario("api_design", 0.9),
      makeScenario("stakeholder_communication", 0.5),
    ]);
    expect(result.matchedScenario).toBe("api_design");
    expect(result.meaning).toContain("集成");
  });
});

describe("disambiguateText", () => {
  it("在文本中查找所有同形异义词", () => {
    const text = "我们需要对接第三方API，下周上线";
    const results = disambiguateText(text, [makeScenario("api_design")]);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const duijie = results.find((r) => r.term === "对接");
    expect(duijie).toBeDefined();
    expect(duijie!.resolved).toBe(true);
  });

  it("文本中无歧义词 → 空结果", () => {
    const results = disambiguateText("普通文本", [makeScenario("api_design")]);
    expect(results).toHaveLength(0);
  });
});

describe("formatDisambiguationHint", () => {
  it("格式化已消歧的词", () => {
    const results = [
      { term: "对接", meaning: "系统集成", matchedScenario: "api_design", resolved: true },
      { term: "上线", meaning: "默认含义", matchedScenario: null, resolved: false },
    ];

    const hint = formatDisambiguationHint(results);
    expect(hint).toContain("语义消歧");
    expect(hint).toContain("对接");
    expect(hint).toContain("系统集成");
    expect(hint).not.toContain("上线"); // 未消歧的词不显示
  });

  it("无已消歧词 → 空字符串", () => {
    expect(formatDisambiguationHint([])).toBe("");
  });
});
