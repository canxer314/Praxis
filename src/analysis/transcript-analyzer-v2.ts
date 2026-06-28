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

  return `你是一个 AI 学习事件提取器。分析以下对话片段，提取对未来会话有价值的学习事件。${scenarioSection}
什么是"有价值的学习事件"：任何在未来的对话中应该被记住的信息，例如：
- 用户纠正了你的错误或误解
- 用户表达了编码风格、工具选择、工作流程的偏好
- 发现了一个可复用的技术模式、架构原则或最佳实践
- 踩到了陷阱——某个方案行不通、某个工具有问题、某个做法导致了 bug
- 获得了领域洞察——对某个系统、项目、业务逻辑有了更深入的理解

提取原则：
- 提取你希望下个 session 的自己已经知道的信息，不需要在这次对话中重新发现
- 宁可多提——如果拿不准是否值得记住，提出来，用较低的 confidence 表达
- 每条 content 必须是完整句子，包含必要的上下文，让未来 session 能理解
- 纯问候、闲谈、单字确认等不提取

每条事件格式: { "type": "...", "content": "...", "confidence": 0.0-1.0, "protoStructureIds": [...] }

type 取值:
- correction  — 用户纠正了你的错误
- preference  — 用户表达了偏好（工具、风格、流程）
- pattern     — 可复用的技术模式或架构原则
- pitfall     — 踩到的陷阱，以后应该避免的做法
- insight     — 对项目/系统/领域的深入理解

protoStructureIds: 此学习事件关联的场景 ID 列表。如果提供了活跃场景列表，选择最相关的场景 ID 填入。不确定时填入空数组 []。

confidence 取值:
- 0.9-1.0  — 用户明确说出来（"以后都用 X"、"记住 X"）
- 0.7-0.8  — 从对话中推断出来的模式或偏好
- 0.5-0.6  — 合理的推断，但证据不够充分
- <0.5     — 不确定但仍值得标记的观察

返回格式: 纯 JSON 数组，不要 Markdown 代码块包裹，不要额外解释。
如果没有值得记录的学习事件，返回 []。

示例输入:
"用户: 别用 interface 了，这个项目统一用 type
AI: 好的，已改为 type
用户: AgentMemory MCP 调用经常超时，以后加个超时控制"

示例输出:
[{"type":"preference","content":"用户偏好使用 type 别名而非 interface 声明，要求项目统一使用 type","confidence":0.9,"protoStructureIds":[]},{"type":"pitfall","content":"AgentMemory MCP 调用默认超时过长，需要 10 秒超时控制","confidence":0.85,"protoStructureIds":[]}]

示例输入2（分析/设计对话）:
"用户: Phase 1B 的 context-organizer 现在还需要吗？
AI: AgentMemory 语义搜索返回的 score 本身就是质量分级。score > 0.5 的注入、< 0.1 的丢弃，不需要复杂的 Tier 系统。
用户: 合理，所以砍掉。"

示例输出2:
[{"type":"insight","content":"Phase 1B context-organizer 的 Tier A/B/C 分级可用 AgentMemory smartSearch 的 score 阈值替代，不需要独立模块","confidence":0.8,"protoStructureIds":[]}]

对话片段:
---
${transcript.slice(0, 8000)}
---`;
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
      const json = JSON.parse(raw.trim());
      if (!Array.isArray(json)) return null;

      const events: LearningEvent[] = [];

      const rawCount = json.length;

      for (const item of json) {
        // 类型校验：防止 LLM 返回非预期类型导致 NaN/崩溃
        if (!item.type || typeof item.type !== "string") continue;
        if (typeof item.content !== "string" || item.content.trim().length === 0) continue;
        if (typeof item.confidence !== "number" || isNaN(item.confidence)) continue;

        const validTypes = ["correction", "preference", "pattern", "pitfall", "insight"];
        if (!validTypes.includes(item.type)) continue;

        this.counter++;
        events.push({
          id: `llm_${this.counter}_${Date.now()}`,
          type: item.type as LearningEvent["type"],
          content: item.content,
          confidence: Math.min(1, Math.max(0, item.confidence)),
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
      // JSON 解析失败是正常降级路径；非 SyntaxError 说明解析器自身有 bug，需记录
      if (!(e instanceof SyntaxError)) {
        logDegraded("transcript-analyzer-v2", "parseResponse",
          `unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      }
      return null;
    }
  }
}
