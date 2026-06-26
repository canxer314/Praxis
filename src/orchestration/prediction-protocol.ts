/**
 * PredictionProtocol — [PREDICTION_*] 标记解析 (M4.2)
 *
 * 职责:
 *   - 解析 LLM 输出中的 [PREDICTION_CONFIRMED/FAILED/UNCERTAIN] 标记
 *   - 生成 llm_marker 信号源输入
 *   - 注入标记说明到 system prompt
 *
 * 架构参考: §4 llm_marker 信号源, §11 prediction-protocol.ts
 */

// ══════════════════════════════════════════════════════════════════
// 标记常量
// ══════════════════════════════════════════════════════════════════

export type PredictionMarker = "PREDICTION_CONFIRMED" | "PREDICTION_FAILED" | "PREDICTION_UNCERTAIN";

export interface ParsedPrediction {
  structureId: string;
  marker: PredictionMarker;
  context: string;
}

const MARKER_REGEX = /\[(PREDICTION_CONFIRMED|PREDICTION_FAILED|PREDICTION_UNCERTAIN):\s*([^\]]+)\]/gi;

// ══════════════════════════════════════════════════════════════════
// 解析
// ══════════════════════════════════════════════════════════════════

/**
 * 从 transcript 中提取所有 [PREDICTION_*: structureId] 标记。
 */
export function parsePredictionMarkers(transcript: string): ParsedPrediction[] {
  const results: ParsedPrediction[] = [];
  let match: RegExpExecArray | null;

  MARKER_REGEX.lastIndex = 0;
  while ((match = MARKER_REGEX.exec(transcript)) !== null) {
    results.push({
      marker: match[1] as PredictionMarker,
      structureId: match[2].trim(),
      context: transcript.slice(Math.max(0, match.index - 50), match.index + match[0].length + 50),
    });
  }

  return results;
}

/**
 * 将解析的标记转换为 SignalSourceInput (llm_marker 源)。
 */
export function markersToSignalSource(
  predictions: ParsedPrediction[],
  structureId: string,
): { structureId: string; sourceName: string; value: number; confidence: number; evidence: string } | null {
  const relevant = predictions.filter((p) => p.structureId === structureId);
  if (relevant.length === 0) return null;

  // 取最新的标记
  const latest = relevant[relevant.length - 1];

  let value: number;
  let confidence: number;
  switch (latest.marker) {
    case "PREDICTION_CONFIRMED": value = 1.0; confidence = 0.8; break;
    case "PREDICTION_FAILED":   value = 0.0; confidence = 0.8; break;
    case "PREDICTION_UNCERTAIN": value = 0.5; confidence = 0.3; break;
  }

  return {
    structureId,
    sourceName: "llm_marker",
    value,
    confidence,
    evidence: `LLM marker: ${latest.marker} for ${structureId}`,
  };
}

// ══════════════════════════════════════════════════════════════════
// System Prompt 注入
// ══════════════════════════════════════════════════════════════════

/**
 * 生成注入到 system prompt 的预测标记说明。
 */
export function predictionMarkerPrompt(): string {
  return `## Prediction Markers
When Praxis provides you with ProtoSequence predictions (expected tool sequences),
mark each prediction as it completes:
- [PREDICTION_CONFIRMED: structure_id] — the predicted sequence matched
- [PREDICTION_FAILED: structure_id] — the predicted sequence did not match
- [PREDICTION_UNCERTAIN: structure_id] — unclear whether it matched

Use these markers at agent_end when summarizing results.`;
}

/**
 * 为 session_start 构建包含预测标记的 prompt 段。
 */
export function buildPredictionInjection(structureIds: string[]): string {
  if (structureIds.length === 0) return "";
  const idList = structureIds.map((id) => `  - ${id}`).join("\n");
  return `## Expected Sequences\nMonitor the following ProtoSequences and mark completion:\n${idList}\n\nUse markers: [PREDICTION_CONFIRMED:id], [PREDICTION_FAILED:id], [PREDICTION_UNCERTAIN:id]\n`;
}
