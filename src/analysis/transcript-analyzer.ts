/**
 * TranscriptAnalyzer — Phase 1A, v1 regex-based
 *
 * 职责:
 *   - 从对话 transcript 中提取 LearningEvent[]
 *   - v1: 正则匹配关键词，按类型分类
 *   - v2 (Phase 2): LLM-based 语义分析
 *   - 去重：相似事件合并（内容相似度 > 80%）
 *
 * 已知限制:
 *   - 正则无法捕获语义上下文
 *   - 误报率较高（关键词匹配到非学习场景）
 *   - Phase 2 将替换为 LLM 分析
 */

import { LearningEvent } from "../platform-adapter";

// ---- 模式定义 ----

interface ExtractionPattern {
  type: LearningEvent["type"];
  regex: RegExp;
  confidence: number; // 关键词匹配的基础置信度
}

const PATTERNS: ExtractionPattern[] = [
  { type: "correction", regex: /(?:不对|改成|应该是|别用|不要|错了|纠正|改一下|换成)/, confidence: 0.75 },
  { type: "preference", regex: /(?:偏好|喜欢|统一用|以后都|习惯|倾向于|就用)/, confidence: 0.70 },
  { type: "pitfall", regex: /(?:超时|失败|报错|error|bug|陷阱|坑|踩坑|注意|小心)/i, confidence: 0.65 },
  { type: "pattern", regex: /(?:模式|套路|流程|步骤|模板|以后遇到.*就|每次.*都)/, confidence: 0.60 },
  { type: "insight", regex: /(?:原来|发现|洞察|关键是|核心|本质)/, confidence: 0.55 },
];

// ---- TranscriptAnalyzer ----

export class TranscriptAnalyzer {
  private counter = 0;

  analyze(transcript: string): LearningEvent[] {
    if (!transcript || transcript.trim().length === 0) {
      return [];
    }

    // 截断过长 transcript（v1 最多处理前 8000 字符）
    const text = transcript.slice(0, 8000);
    const events: LearningEvent[] = [];
    const seen = new Set<string>();

    for (const pattern of PATTERNS) {
      const matches = text.match(new RegExp(pattern.regex.source, "gi"));
      if (!matches) continue;

      for (const match of matches) {
        // 提取匹配关键词周围的上下文（前后 40 个字符）
        const idx = text.indexOf(match);
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + match.length + 40);
        const context = text.slice(start, end).replace(/\n/g, " ").trim();

        // 去重：相同内容只保留一条
        const dedupKey = `${pattern.type}:${context.slice(0, 60)}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        this.counter++;
        events.push({
          id: `auto_${this.counter}_${Date.now()}`,
          type: pattern.type,
          content: `[auto] ${context}`,
          confidence: pattern.confidence,
        });
      }
    }

    // 按置信度降序排列，最多返回 10 条
    return events
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);
  }
}
