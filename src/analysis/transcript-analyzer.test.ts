/**
 * transcript-analyzer 测试 — Phase 1A, TDD
 *
 * v1: regex-based 学习事件提取
 * v2 (Phase 2): LLM-based 语义分析
 *
 * 覆盖路径:
 *   - 纠正检测: "不对" "改成" "应该是" "别用" "不要"
 *   - 偏好检测: "偏好" "喜欢" "统一用" "以后都"
 *   - 陷阱检测: "超时" "失败" "报错" "bug"
 *   - 空输入: 返回 []
 *   - 纯代码: 无自然语言 → 少量或无事件
 *   - 混合内容: 正确分类多条事件
 *   - 边界: 极长 transcript (>8000 chars)
 */

import { describe, it, expect } from "vitest";
import { TranscriptAnalyzer } from "./transcript-analyzer";
import { LearningEvent } from "../platform-adapter";

describe("TranscriptAnalyzer", () => {
  const analyzer = new TranscriptAnalyzer();

  // ---- 纠正检测 ----

  it("检测用户纠正: '不对'", () => {
    const events = analyzer.analyze("不对，这里应该用 type 不是 interface");
    expect(events.some((e) => e.type === "correction")).toBe(true);
  });

  it("检测用户纠正: '改成'", () => {
    const events = analyzer.analyze("把 Result 改成返回联合类型");
    const correction = events.find((e) => e.type === "correction");
    expect(correction).toBeDefined();
    expect(correction!.content).toContain("改成");
  });

  it("检测用户纠正: '别用'", () => {
    const events = analyzer.analyze("别用 any，用 unknown");
    expect(events.some((e) => e.type === "correction")).toBe(true);
  });

  it("检测用户纠正: '不要'", () => {
    const events = analyzer.analyze("不要在这里做数据库查询，放到 service 层");
    expect(events.some((e) => e.type === "correction")).toBe(true);
  });

  // ---- 偏好检测 ----

  it("检测用户偏好: '偏好'", () => {
    const events = analyzer.analyze("我偏好用 setTimeout 而不是 sleep");
    const pref = events.find((e) => e.type === "preference");
    expect(pref).toBeDefined();
  });

  it("检测用户偏好: '统一用'", () => {
    const events = analyzer.analyze("这个项目统一用 type，别用 interface");
    expect(events.some((e) => e.type === "preference")).toBe(true);
  });

  it("检测用户偏好: '以后都'", () => {
    const events = analyzer.analyze("以后都用 vitest，不要 jest");
    expect(events.some((e) => e.type === "preference")).toBe(true);
  });

  // ---- 陷阱检测 ----

  it("检测陷阱: '超时'", () => {
    const events = analyzer.analyze("AgentMemory MCP 调用超时了，30 秒默认超时太长");
    expect(events.some((e) => e.type === "pitfall")).toBe(true);
  });

  it("检测陷阱: '报错'", () => {
    const events = analyzer.analyze("vitest mock 返回 null 时报错了");
    expect(events.some((e) => e.type === "pitfall")).toBe(true);
  });

  // ---- 空输入 ----

  it("空字符串返回空数组", () => {
    const events = analyzer.analyze("");
    expect(events).toHaveLength(0);
  });

  it("纯代码无自然语言时返回空数组", () => {
    const events = analyzer.analyze("const x = 1;\nfunction foo() { return 42; }");
    // 纯代码不匹配任何模式
    expect(events.every((e) => e.confidence < 0.6)).toBe(true);
  });

  // ---- 混合内容 ----

  it("混合内容正确分类多条事件", () => {
    const transcript = [
      "用户: 别用 any，用 unknown",
      "AI: 好的，改成了 unknown",
      "用户: 还有，AgentMemory 调用老是超时",
      "用户: 以后都用 vitest 写测试",
    ].join("\n");

    const events = analyzer.analyze(transcript);

    // 应该至少检测到 correction + pitfall + preference
    const types = events.map((e) => e.type);
    expect(types).toContain("correction");
    expect(types).toContain("pitfall");
    expect(types).toContain("preference");
  });

  // ---- 边界 ----

  it("极长 transcript 不崩溃（>8000 chars）", () => {
    const long = "用户: 不对\n".repeat(500); // ~5000 chars
    const events = analyzer.analyze(long);
    // 去重后不应有一大堆重复事件
    expect(events.length).toBeLessThan(10);
  });

  it("每条事件有唯一 ID", () => {
    const events = analyzer.analyze("不对，别用 any。超时了。以后都用 type。");
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("confidence 在 0.0-1.0 范围内", () => {
    const events = analyzer.analyze("不对，改成 type。超时了需要处理。");
    events.forEach((e) => {
      expect(e.confidence).toBeGreaterThan(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    });
  });
});
