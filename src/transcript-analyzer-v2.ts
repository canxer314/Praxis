/**
 * TranscriptAnalyzerV2 — Phase 2, LLM-based 语义分析
 *
 * v1 → v2 变化:
 *   - 关键词正则 → LLM 语义理解
 *   - 硬编码置信度 → LLM 自行判断置信度
 *   - 关键词截取 ±40 字符 → LLM 生成完整的学习描述
 *
 * 降级: LLM 调用失败或返回格式错误时, fallback 到 v1 正则分析。
 */

import { LlmClient, Result, LearningEvent } from "./platform-adapter";
import { TranscriptAnalyzer } from "./transcript-analyzer";

// ---- LLM Prompt ----

function buildPrompt(transcript: string): string {
  return `你是一个 AI 学习事件提取器。分析以下对话片段，提取值得记录的学习事件。

规则:
1. 只在对话中包含"学到了什么"时才提取。普通闲聊、简单问答不提取。
2. 每条事件包含: type, content, confidence
3. type 必须是以下之一: correction(用户纠正)、preference(用户偏好)、pattern(可复用模式)、pitfall(陷阱/坑)、insight(领域洞察)
4. content 是完整、有意义的描述，包含上下文信息
5. confidence 是 0.0-1.0 的浮点数，表示你对这条学习正确性的置信度

返回格式: 纯 JSON 数组。不要 Markdown 代码块包裹。不要额外解释。
如果没有值得记录的学习事件，返回空数组 []。

示例输入:
"用户: 别用 interface 了，这个项目统一用 type
AI: 好的，已改为 type
用户: 还有，AgentMemory MCP 调用经常超时 30 秒，以后加个 10 秒超时控制"

示例输出:
[{"type":"preference","content":"用户偏好使用 type 别名而非 interface 声明，要求项目统一使用 type","confidence":0.9},{"type":"pitfall","content":"AgentMemory MCP 调用默认 30 秒超时过长，需要 10 秒超时控制","confidence":0.85}]

对话片段:
---
${transcript.slice(0, 6000)}
---`;
}

// ---- TranscriptAnalyzerV2 ----

export class TranscriptAnalyzerV2 {
  private readonly llm: LlmClient;
  private readonly v1: TranscriptAnalyzer = new TranscriptAnalyzer();
  private counter = 0;

  constructor(llm: LlmClient) {
    this.llm = llm;
  }

  async analyze(transcript: string): Promise<LearningEvent[]> {
    if (!transcript || transcript.trim().length === 0) return [];

    // LLM 分析
    const prompt = buildPrompt(transcript);
    const result = await this.llm.analyze(prompt);

    if (!result.ok) {
      // LLM 调用失败 → fallback 到 v1
      return this.v1.analyze(transcript);
    }

    const events = this.parseResponse(result.value);
    if (events === null) {
      // JSON 解析失败 → fallback 到 v1
      return this.v1.analyze(transcript);
    }

    return events;
  }

  // ---- 内部 ----

  private parseResponse(raw: string): LearningEvent[] | null {
    try {
      const json = JSON.parse(raw.trim());
      if (!Array.isArray(json)) return null;

      const events: LearningEvent[] = [];

      for (const item of json) {
        if (!item.type || !item.content || item.confidence === undefined) continue;

        const validTypes = ["correction", "preference", "pattern", "pitfall", "insight"];
        if (!validTypes.includes(item.type)) continue;

        this.counter++;
        events.push({
          id: `llm_${this.counter}_${Date.now()}`,
          type: item.type as LearningEvent["type"],
          content: item.content,
          confidence: Math.min(1, Math.max(0, item.confidence)),
        });
      }

      return events;
    } catch {
      return null;
    }
  }
}
