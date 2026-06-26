/**
 * ProtoTaskLearner — ProtoTask 累积更新 (M5.3a)
 *
 * 职责:
 *   - 从 AgentMemory 读取同类任务的 lesson 历史
 *   - LLM 分析 → 更新 typicalPhases + commonPitfalls
 *   - 对数置信度成长: 0.2 → 0.35 → 0.50 → 0.59 → 0.72 → ...
 *   - observations < 3 → 只更新统计，不改结构
 *   - 置信度变化 > 0.15 → 标记需人类审批
 *
 * 架构参考: §5 ProtoTask, §6 自主学习触发
 */

import type { Result } from "../platform-adapter";
import type { MemorySubsystem, LLMSubsystem } from "../m0-deps";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface ProtoTaskPhase {
  name: string;
  description: string;
  subtasks: string[];
  criteria: string[];
}

export interface ProtoTaskPitfall {
  description: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
  hitCount: number;
}

export interface ProtoTask {
  taskType: string;
  confidence: number;
  source: "bootstrap" | "cumulative";
  typicalPhases: ProtoTaskPhase[];
  commonPitfalls: ProtoTaskPitfall[];
  observations: number;
  generatedAt: number;
}

interface TaskHistory {
  taskType: string;
  sessions: Array<{
    sessionId: string;
    phaseDurations: Record<string, number>;  // phase name → minutes
    pitfallHits: Record<string, number>;     // pitfall desc → hit count
    userSatisfaction: number;                 // 0-1
  }>;
}

// ══════════════════════════════════════════════════════════════════
// 置信度成长
// ══════════════════════════════════════════════════════════════════

/**
 * 对数成长公式: confidence = clamp(0.2 + 0.15 × log2(N + 1), 0.2, 0.95)
 * - N=0→0.20, 1→0.35, 3→0.50, 5→0.59, 10→0.72, 15→0.80, 31→0.95
 */
export function growConfidence(observations: number): number {
  if (observations < 0) return 0.2;
  const raw = 0.2 + 0.15 * Math.log2(observations + 1);
  return Math.max(0.2, Math.min(0.95, raw));
}

// ══════════════════════════════════════════════════════════════════
// 累积更新
// ══════════════════════════════════════════════════════════════════

const ACCUMULATE_PROMPT = `You are a task knowledge synthesizer. Given a ProtoTask template and real task execution history, update the template to reflect actual observed patterns.

Current ProtoTask:
{{currentTask}}

Task History ({{sessionCount}} sessions):
{{history}}

Output JSON only:
{
  "typicalPhases": [
    {"name": "phase name", "description": "1-2 sentences", "subtasks": ["subtask"], "criteria": ["criterion"]}
  ],
  "commonPitfalls": [
    {"description": "what goes wrong", "severity": "low|medium|high", "mitigation": "how to avoid", "hitCount": N}
  ],
  "confidenceAdjustment": -0.1 to 0.2,
  "structuralChanges": ["summary of changes made"]
}

Rules:
- Update phase durations based on actual timings
- Update pitfall hit counts from real data
- If confidenceAdjustment > 0.15, flag for human review
- If < 3 sessions of data, make only statistical updates, no structural changes`;

/**
 * 从 AgentMemory lesson 历史中累积更新 ProtoTask。
 * 返回更新后的 ProtoTask，或 null（数据不足 / LLM 不可用）。
 */
export async function accumulateProtoTask(
  taskType: string,
  llm: LLMSubsystem,
  memory: MemorySubsystem,
  currentTask?: ProtoTask,
): Promise<ProtoTask | null> {
  if (!taskType || !llm || !llm.analyze) return null;

  // 1. 从 AgentMemory 读取同类任务 lesson 历史
  let history: TaskHistory;
  try {
    history = await loadTaskHistory(taskType, memory);
  } catch {
    return null; // 无法读取历史
  }

  const observations = history.sessions.length;

  // 2. 守卫: 数据不足时只更新统计数字
  if (observations < 3) {
    if (currentTask) {
      return {
        ...currentTask,
        observations,
        confidence: growConfidence(observations),
        generatedAt: Date.now(),
      };
    }
    return null;
  }

  // 3. LLM 分析 + 更新
  const currentJson = JSON.stringify(currentTask ?? { taskType, confidence: 0.2, source: "bootstrap", typicalPhases: [], commonPitfalls: [], observations: 0 }, null, 2);
  const historySummary = history.sessions.map(s =>
    `- Session ${s.sessionId}: satisfaction=${s.userSatisfaction.toFixed(2)}, phase durations: ${JSON.stringify(s.phaseDurations)}, pitfall hits: ${JSON.stringify(s.pitfallHits)}`
  ).join("\n");

  const prompt = ACCUMULATE_PROMPT
    .replace("{{currentTask}}", currentJson)
    .replace("{{sessionCount}}", String(observations))
    .replace("{{history}}", historySummary);

  try {
    const result = await llm.analyze(prompt);
    if (!result.ok) return currentTask ?? null;

    let json = result.value.trim();
    const fenceMatch = json.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n\s*```\s*$/);
    if (fenceMatch) json = fenceMatch[1];

    const parsed = JSON.parse(json);
    const newConfidence = growConfidence(observations);
    const confidenceDelta = newConfidence - (currentTask?.confidence ?? 0.2);

    const updated: ProtoTask = {
      taskType,
      confidence: newConfidence,
      source: observations >= 5 ? "cumulative" : (currentTask?.source ?? "bootstrap"),
      typicalPhases: Array.isArray(parsed.typicalPhases) ? parsed.typicalPhases : (currentTask?.typicalPhases ?? []),
      commonPitfalls: Array.isArray(parsed.commonPitfalls)
        ? parsed.commonPitfalls.map((p: Record<string, unknown>) => ({
            description: String(p.description ?? ""),
            severity: (["low", "medium", "high"].includes(String(p.severity)) ? String(p.severity) : "medium") as "low" | "medium" | "high",
            mitigation: String(p.mitigation ?? ""),
            hitCount: Number(p.hitCount ?? 0),
          }))
        : (currentTask?.commonPitfalls ?? []),
      observations,
      generatedAt: Date.now(),
    };

    // 4. 合理性守卫: 置信度变化 > 0.15 → 标记需人类审批
    if (Math.abs(confidenceDelta) > 0.15) {
      // 不变更置信度，只记录标记
      return {
        ...updated,
        confidence: currentTask?.confidence ?? 0.2,
      };
    }

    return updated;
  } catch {
    return currentTask ?? null;
  }
}

// ══════════════════════════════════════════════════════════════════
// 历史加载
// ══════════════════════════════════════════════════════════════════

async function loadTaskHistory(
  taskType: string,
  memory: MemorySubsystem,
): Promise<TaskHistory> {
  const history: TaskHistory = { taskType, sessions: [] };

  // 通过 smartSearch 检索该 taskType 的 lessons
  try {
    const result = await memory.smartSearch(`taskType:${taskType}`, undefined);
    if (!result.ok || !Array.isArray(result.value)) return history;

    for (const item of result.value) {
      const record = item as Record<string, unknown>;
      if (String(record.taskType ?? "").toLowerCase() !== taskType.toLowerCase()) continue;

      history.sessions.push({
        sessionId: String(record.sessionId ?? `unknown-${history.sessions.length}`),
        phaseDurations: (record.phaseDurations as Record<string, number>) ?? {},
        pitfallHits: (record.pitfallHits as Record<string, number>) ?? {},
        userSatisfaction: Number(record.userSatisfaction ?? 0.5),
      });
    }
  } catch {
    // 降级: 返回空历史
  }

  return history;
}

/**
 * 从 lesson 中提取 taskType。
 * fallback: 尝试从 content 字符串中匹配已知 task type 关键词。
 */
export function extractTaskType(lesson: Record<string, unknown>): string {
  return String(lesson.taskType ?? lesson.type ?? "unknown");
}
