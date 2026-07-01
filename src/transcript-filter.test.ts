/**
 * Transcript Filter 测试 — Phase 8
 *
 * 覆盖:
 *   - JSONL 正常 → 提取 user/assistant text
 *   - tool_result → [工具结果: N 字符] 摘要
 *   - thinking/tool_use → 跳过
 *   - 非 JSONL (纯文本) → 原样返回
 *   - 空输入 → 空字符串
 *   - 全是系统事件 → 空字符串
 *   - malformed JSON → 跳过
 *   - maxChars 截断
 *   - system role 包含
 */

import { describe, it, expect } from "vitest";
import { convertTranscriptToDialogue } from "./transcript-filter";

describe("convertTranscriptToDialogue", () => {
  it("提取 user/assistant 的 text 块", () => {
    const jsonl = [
      '{"type":"mode","mode":"normal"}',
      '{"type":"user","message":{"content":[{"type":"text","text":"帮我重构这个函数"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"好的，我看一下代码"}]}}',
    ].join("\n");

    const result = convertTranscriptToDialogue(jsonl);
    expect(result).toContain("帮我重构这个函数");
    expect(result).toContain("好的，我看一下代码");
  });

  it("跳过 mode/file-history-snapshot 等系统事件", () => {
    const jsonl = [
      '{"type":"mode","mode":"normal"}',
      '{"type":"file-history-snapshot","snapshot":{}}',
      '{"type":"user","message":{"content":[{"type":"text","text":"用户消息"}]}}',
    ].join("\n");

    const result = convertTranscriptToDialogue(jsonl);
    expect(result).toBe("用户消息");
  });

  it("tool_result → [工具结果: N 字符] 摘要", () => {
    const longContent = "a".repeat(500);
    const jsonl = [
      `{"type":"user","message":{"content":[{"type":"tool_result","content":"${longContent}"}]}}`,
      '{"type":"assistant","message":{"content":[{"type":"text","text":"已执行完成"}]}}',
    ].join("\n");

    const result = convertTranscriptToDialogue(jsonl);
    expect(result).toContain("[工具结果: 500 字符]");
    expect(result).toContain("已执行完成");
  });

  it("跳过 thinking 和 tool_use 块", () => {
    const jsonl = [
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"long internal reasoning..."},{"type":"text","text":"最终回答"}]}}',
    ].join("\n");

    const result = convertTranscriptToDialogue(jsonl);
    expect(result).not.toContain("thinking");
    expect(result).not.toContain("internal reasoning");
    expect(result).toBe("最终回答");
  });

  it("非 JSONL 纯文本 → 原样返回", () => {
    const text = "用户: 帮我重构\nAI: 好的";
    const result = convertTranscriptToDialogue(text);
    expect(result).toBe(text);
  });

  it("空输入 → 空字符串", () => {
    expect(convertTranscriptToDialogue("")).toBe("");
    expect(convertTranscriptToDialogue("  ")).toBe("");
  });

  it("全是系统事件 → 空字符串", () => {
    const jsonl = [
      '{"type":"mode","mode":"normal"}',
      '{"type":"file-history-snapshot","snapshot":{}}',
      '{"type":"attachment","attachment":{"type":"hook_success"}}',
    ].join("\n");

    const result = convertTranscriptToDialogue(jsonl);
    expect(result).toBe("");
  });

  it("malformed JSON → 优雅跳过", () => {
    const jsonl = [
      '{"type":"user","message":{"content":[{"type":"text","text":"正常消息"}]}}',
      "这不是 JSON",
      '{"type":"assistant","message":{"content":[{"type":"text","text":"正常回复"}]}}',
    ].join("\n");

    const result = convertTranscriptToDialogue(jsonl);
    expect(result).toContain("正常消息");
    expect(result).toContain("正常回复");
  });

  it("maxChars 截断", () => {
    const longReply = "这是一个很长的回复 " + "x".repeat(200);
    const jsonl = [
      '{"type":"user","message":{"content":[{"type":"text","text":"你好"}]}}',
      `{"type":"assistant","message":{"content":[{"type":"text","text":"${longReply}"}]}}`,
    ].join("\n");

    const result = convertTranscriptToDialogue(jsonl, 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("包含 system role 消息", () => {
    const jsonl = [
      '{"type":"system","message":{"content":[{"type":"text","text":"你是一个有帮助的助手"}]}}',
      '{"type":"user","message":{"content":[{"type":"text","text":"你好"}]}}',
    ].join("\n");

    const result = convertTranscriptToDialogue(jsonl);
    expect(result).toContain("你是一个有帮助的助手");
    expect(result).toContain("你好");
  });
});
