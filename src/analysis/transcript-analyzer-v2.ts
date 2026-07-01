/**
 * TranscriptAnalyzerV2 — LLM-based 语义分析（活跃路径）
 *
 * v1 → v2 变化:
 *   - 关键词正则 → LLM 语义理解
 *   - 硬编码置信度 → LLM 自行判断置信度
 *   - 关键词截取 ±40 字符 → LLM 生成完整的学习描述
 *
 * 降级: LLM 调用失败或返回格式错误时返回空数组。
 * 不 fallback 到 v1——回测数据证明 v1 的 14/14 条提取均为关键词噪声，零有效学习事件。
 */

import { LlmClient, LearningEvent } from "../platform-adapter";
import { log, logDegraded } from "../logger";

// ---- LLM Prompt ----

function buildPrompt(transcript: string, activeScenarioIds?: string[]): string {
  const scenarioSection = activeScenarioIds && activeScenarioIds.length > 0
    ? `\n当前活跃场景: ${activeScenarioIds.join(", ")}\n每条事件可包含 "protoStructureIds": ["<匹配的场景ID>"] 字段标注此学习属于哪个场景。不确定时留空数组。\n`
    : "";

  return `从以下对话片段中提取值得在未来会话中记住的学习事件。
${scenarioSection}
事件类型: correction（用户纠错）、preference（用户偏好）、pattern（可复用模式）、pitfall（陷阱/教训）、insight（领域洞察）。
confidence: 0.9-1.0=明确表达, 0.7-0.8=推断, 0.5-0.6=合理猜测, <0.5=不确定。
提取原则: 宁可多提, 每条 content 是含上下文的完整句子, 无值得记录事件时返回 []。

对话片段:
---
${transcript.slice(0, 8000)}
---

输出格式（严格遵循，直接输出 JSON）:
[{"type":"correction|preference|pattern|pitfall|insight","content":"完整描述","confidence":0.X,"protoStructureIds":[]}]`;
}

// ---- TranscriptAnalyzerV2 ----

export class TranscriptAnalyzerV2 {
  private readonly llm: LlmClient;
  private counter = 0;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  async analyze(
    transcript: string,
    opts?: { activeScenarioIds?: string[] },
  ): Promise<LearningEvent[]> {
    if (!transcript || transcript.trim().length === 0) return [];

    const startMs = Date.now();

    // LLM 分析
    const prompt = buildPrompt(transcript, opts?.activeScenarioIds);
    const result = await this.llm.analyze(prompt);

    if (!result.ok) {
      logDegraded("transcript-analyzer-v2", "analyze", `LLM call failed: ${result.error?.message ?? "unknown"}`);
      return [];
    }

    const events = this.parseResponse(result.value);
    if (events === null) {
      logDegraded("transcript-analyzer-v2", "analyze", "LLM response parse failed");
      return [];
    }

    log({ ts: new Date().toISOString(), module: "transcript-analyzer-v2", op: "analyze", duration_ms: Date.now() - startMs, outcome: "success", error: `extracted ${events.length} events` });
    return events;
  }

  // ---- 内部 ----

  private parseResponse(raw: string): LearningEvent[] | null {
    try {
      // Phase 8: strip markdown code block wrapper (flash 模型偶尔忽略 "不要 Markdown" 指令)
      let cleaned = raw.trim();
      const codeBlockMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/);
      if (codeBlockMatch) cleaned = codeBlockMatch[1];

      const json = JSON.parse(cleaned);
      if (!Array.isArray(json)) return null;

      const events: LearningEvent[] = [];
      const rawCount = json.length;
      const validTypes = ["correction", "preference", "pattern", "pitfall", "insight"];

      for (const item of json) {
        // Phase 8: 字段归一化 — flash 模型可能用不同字段名返回等价的语义信息
        const normalized = this.normalizeItem(item);
        if (!normalized) continue;

        this.counter++;
        events.push({
          id: `llm_${this.counter}_${Date.now()}`,
          type: normalized.type as LearningEvent["type"],
          content: normalized.content,
          confidence: Math.min(1, Math.max(0, normalized.confidence)),
          protoStructureIds: Array.isArray(item.protoStructureIds)
            ? item.protoStructureIds.filter((s: unknown) => typeof s === "string")
            : [],
        });
      }

      // 防御性上限：单次 transcript 最多提取 15 条学习事件
      if (events.length > 15) {
        logDegraded("transcript-analyzer-v2", "parseResponse", `truncated ${rawCount}→15 events`);
      }
      return events.slice(0, 15);
    } catch (e) {
      if (!(e instanceof SyntaxError)) {
        logDegraded("transcript-analyzer-v2", "parseResponse",
          `unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      }
      return null;
    }
  }

  /**
   * Phase 8: 字段归一化。兼容 LLM 以非标准字段名返回有效语义信息的场景。
   * 标准格式: { type, content, confidence }
   * 兼容格式: { event, detail, value } 等 — 映射到 content，type 默认 insight
   */
  private normalizeItem(item: Record<string, unknown>): { type: string; content: string; confidence: number } | null {
    const validTypes = ["correction", "preference", "pattern", "pitfall", "insight"];

    // type: 优先标准字段，其次从 event 字段推断，最终默认 insight
    let type: string;
    if (typeof item.type === "string" && validTypes.includes(item.type)) {
      type = item.type;
    } else if (typeof item.event === "string") {
      const evt = item.event.toLowerCase();
      if (evt.includes("纠正") || evt.includes("correction")) type = "correction";
      else if (evt.includes("偏好") || evt.includes("preference")) type = "preference";
      else if (evt.includes("模式") || evt.includes("pattern")) type = "pattern";
      else if (evt.includes("陷阱") || evt.includes("pitfall") || evt.includes("失败")) type = "pitfall";
      else type = "insight";
    } else {
      type = "insight";
    }

    // content: 优先标准字段，其次 detail/value/event/description
    const content = (item.content ?? item.detail ?? item.value ?? item.event ?? item.description ?? "") as string;
    if (typeof content !== "string" || content.trim().length === 0) return null;

    // confidence: 优先标准字段，其次默认 0.5 (合理推断)
    const confidence = typeof item.confidence === "number" && !isNaN(item.confidence)
      ? item.confidence
      : 0.5;

    return { type, content: content.trim(), confidence };
  }
}
