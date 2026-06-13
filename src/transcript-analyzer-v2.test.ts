/**
 * TranscriptAnalyzer V2 测试 — Phase 2, LLM-based 语义分析
 *
 * v1 局限: 关键词正则 → 误报高、无语义理解
 * v2: LLM 分析 → 理解上下文、区分"真的学到了"和"碰巧匹配"
 *
 * 覆盖路径:
 *   - LLM 正常返回 JSON → 解析为 LearningEvent[]
 *   - LLM 返回格式错误 → fallback 到 v1 regex
 *   - LLM 超时 → fallback
 *   - 空 transcript → 返回 []
 *   - LLM 返回的 JSON 缺少必需字段 → 跳过该条
 *   - 置信度从 LLM 获取（非硬编码）
 *   - 学习内容包含上下文（非关键词截取）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TranscriptAnalyzerV2 } from "./transcript-analyzer-v2";
import { LlmClient, Result, LearningEvent } from "./platform-adapter";

// ---- Mock LLM ----

function mockLlm(jsonResponse: string): LlmClient {
  return {
    analyze: vi.fn().mockResolvedValue({
      ok: true,
      value: jsonResponse,
    } as Result<string>),
  };
}

function mockLlmError(code: string): LlmClient {
  return {
    analyze: vi.fn().mockResolvedValue({
      ok: false,
      error: { code, message: "LLM error" },
    } as Result<string>),
  };
}

// ---- 测试 ----

describe("TranscriptAnalyzerV2", () => {
  // ---- LLM 正常返回 ----

  it("解析 LLM 返回的 JSON 学习事件", async () => {
    const llm = mockLlm(JSON.stringify([
      { type: "correction", content: "用户要求使用 type 而非 interface", confidence: 0.9 },
      { type: "preference", content: "用户偏好简洁的错误处理", confidence: 0.8 },
    ]));

    const analyzer = new TranscriptAnalyzerV2(llm);
    const events = await analyzer.analyze("用户: 别用 interface，用 type。还有错误处理简单点。");

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("correction");
    expect(events[0].confidence).toBe(0.9);
    expect(events[1].type).toBe("preference");
    expect(events[1].confidence).toBe(0.8);
  });

  it("LLM 提取的事件有唯一 ID", async () => {
    const llm = mockLlm(JSON.stringify([
      { type: "insight", content: "项目使用 Result 类型统一错误处理", confidence: 0.85 },
    ]));

    const analyzer = new TranscriptAnalyzerV2(llm);
    const events = await analyzer.analyze("test");

    expect(events).toHaveLength(1);
    expect(events[0].id).toBeTruthy();
    expect(events[0].id).toMatch(/^llm_/);
  });

  // ---- 置信度从 LLM 获取 ----

  it("置信度从 LLM 返回（非硬编码）", async () => {
    const llm = mockLlm(JSON.stringify([
      { type: "pattern", content: "test", confidence: 0.65 },
    ]));

    const analyzer = new TranscriptAnalyzerV2(llm);
    const events = await analyzer.analyze("test");

    // 不使用硬编码的 0.7-0.75，使用 LLM 判断的 0.65
    expect(events[0].confidence).toBe(0.65);
  });

  it("LLM 返回的 confidence 超出范围时修正", async () => {
    const llm = mockLlm(JSON.stringify([
      { type: "pattern", content: "test", confidence: 1.5 },
    ]));

    const analyzer = new TranscriptAnalyzerV2(llm);
    const events = await analyzer.analyze("test");

    // 修正到 [0, 1] 范围
    expect(events[0].confidence).toBeLessThanOrEqual(1);
    expect(events[0].confidence).toBeGreaterThanOrEqual(0);
  });

  // ---- 内容质量 ----

  it("学习内容包含上下文（非纯关键词匹配）", async () => {
    const llm = mockLlm(JSON.stringify([
      { type: "correction", content: "用户纠正了 TypeScript 类型定义的方式，要求使用 type 别名而非 interface 声明", confidence: 0.9 },
    ]));

    const analyzer = new TranscriptAnalyzerV2(llm);
    const events = await analyzer.analyze("用户: 这个不要用 interface，全都用 type");

    // v2 输出是 LLM 写的完整句子，不是正则截取的 ±40 字符
    expect(events[0].content.length).toBeGreaterThan(20);
    expect(events[0].content).not.toContain("[auto]");
  });

  // ---- 降级 fallback ----

  it("LLM 返回格式错误时 fallback 到 v1 regex", async () => {
    const llm = mockLlm("not valid json {{{");

    const analyzer = new TranscriptAnalyzerV2(llm);
    const events = await analyzer.analyze("不对，这里应该改成 type");

    // fallback 到 v1: 应该检测到 "改成" 关键词
    expect(events.some((e) => e.type === "correction")).toBe(true);
    expect(events.some((e) => e.content.includes("[auto]"))).toBe(true);
  });

  it("LLM 调用失败时 fallback 到 v1", async () => {
    const llm = mockLlmError("TIMEOUT");

    const analyzer = new TranscriptAnalyzerV2(llm);
    const events = await analyzer.analyze("别用 any 类型");

    // fallback 到 v1
    expect(events.some((e) => e.type === "correction")).toBe(true);
  });

  it("LLM 返回空数组时不 fallback（LLM 判断无学习内容）", async () => {
    const llm = mockLlm("[]");

    const analyzer = new TranscriptAnalyzerV2(llm);
    const events = await analyzer.analyze("今天天气不错");

    // LLM 判断不需要学习 → 不 fallback 到 v1
    expect(events).toHaveLength(0);
  });

  // ---- 验证 ----

  it("LLM 返回的 JSON 缺少 type 字段时跳过该条", async () => {
    const llm = mockLlm(JSON.stringify([
      { type: "correction", content: "ok", confidence: 0.9 },
      { content: "missing type field", confidence: 0.8 },
      { type: "pitfall", content: "also ok", confidence: 0.7 },
    ]));

    const analyzer = new TranscriptAnalyzerV2(llm);
    const events = await analyzer.analyze("test");

    // 3 条中 1 条无效，应返回 2 条
    expect(events).toHaveLength(2);
  });

  // ---- 空输入 ----

  it("空 transcript 返回空数组（不调用 LLM）", async () => {
    const llm = mockLlm("[]");
    const analyzer = new TranscriptAnalyzerV2(llm);

    const events = await analyzer.analyze("");

    expect(events).toHaveLength(0);
    expect(llm.analyze).not.toHaveBeenCalled();
  });
});
