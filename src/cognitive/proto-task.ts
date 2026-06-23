/**
 * ProtoTask — 零样本任务模板引导
 *
 * 职责:
 *   - Bootstrap: 利用 LLM 通用知识生成任务阶段模板 (初始置信度 ~0.2)
 *   - TTL 缓存 (24h): 避免频繁 LLM 调用，同一 taskType 24h 内复用缓存
 *   - 指数退避重试: Timeout/429/malformed JSON → 最多 3 次重试
 *   - 安全降级: LLM 不可用 → 返回 null (调用方回退到串行)
 *
 * 设计来源: V11 ProtoTask 升格为 Phase 1 核心。
 * 累计学习 (0.2→0.8 over N projects) 推迟到 Phase 2。
 */

import type { Result } from "../platform-adapter";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** 任务阶段模板 */
export interface ProtoTaskPhase {
  name: string;
  description: string;
  subtasks: string[];
  criteria: string[];
}

/** 陷阱模板 */
export interface ProtoTaskPitfall {
  description: string;
  severity: "low" | "medium" | "high";
  mitigation: string;
  hitCount: number;
}

/** ProtoTask 模板 — 完整任务类型知识 */
export interface ProtoTask {
  taskType: string;
  confidence: number;
  /** 引导来源: LLM bootstrap vs 累计学习 */
  source: "bootstrap" | "cumulative";
  typicalPhases: ProtoTaskPhase[];
  commonPitfalls: ProtoTaskPitfall[];
  observations: number;
  generatedAt: number;
}

/** LLM 客户端接口 (最小依赖 — 只需 chat 方法) */
export interface ProtoTaskLLMClient {
  chat(
    messages: Array<{ role: string; content: string }>,
  ): Promise<{ content: string }>;
}

// ══════════════════════════════════════════════════════════════════
// TTL 缓存
// ══════════════════════════════════════════════════════════════════

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const cache = new Map<string, { protoTask: ProtoTask; cachedAt: number }>();

// ══════════════════════════════════════════════════════════════════
// 重试配置
// ══════════════════════════════════════════════════════════════════

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const JITTER_MAX_MS = 1000;

function backoff(attempt: number): number {
  const exponential = BASE_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
  return exponential + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ══════════════════════════════════════════════════════════════════
// Bootstrap — 零样本 LLM 通用知识
// ══════════════════════════════════════════════════════════════════

/**
 * 生成 bootstrap ProtoTask 模板。
 *
 * 使用 LLM 通用知识为给定 taskType 生成初始阶段模板。
 * 初始置信度固定在 0.2 (bootstrap 来源)。
 *
 * 重试策略:
 *   - Timeout → 指数退避 + jitter，最多 3 次
 *   - 429 (rate limit) → Retry-After 或 2s 退避，最多 3 次
 *   - Malformed JSON → 立即重试 1 次，仍失败则返回 null
 *   - LLM 不可用 → 返回 null (安全降级)
 *
 * @param taskType 任务类型 (e.g., "software_project", "bug_fix")
 * @param llmClient LLM 客户端
 * @param opts 可选配置
 * @returns ProtoTask 模板，或 null (降级)
 */
export async function bootstrapProtoTask(
  taskType: string,
  llmClient: ProtoTaskLLMClient,
  opts?: { skipCache?: boolean },
): Promise<ProtoTask | null> {
  if (!taskType || !llmClient) return null;

  // 检查 TTL 缓存
  if (!opts?.skipCache) {
    const cached = cache.get(taskType);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      log({
        ts: new Date().toISOString(),
        module: "proto-task",
        op: "bootstrap",
        duration_ms: 0,
        outcome: "success",
        error: `Cache hit for "${taskType}"`,
      });
      return cached.protoTask;
    }
  }

  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const raw = await llmClient.chat([
        {
          role: "system",
          content: BOOTSTRAP_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Generate a ProtoTask template for task type: "${taskType}". Return ONLY valid JSON.`,
        },
      ]);

      const parsed = parseProtoTaskResponse(taskType, raw.content);

      if (parsed) {
        // 写入缓存
        cache.set(taskType, { protoTask: parsed, cachedAt: Date.now() });

        log({
          ts: new Date().toISOString(),
          module: "proto-task",
          op: "bootstrap",
          duration_ms: 0,
          outcome: "success",
          error: `Generated bootstrap for "${taskType}" (attempt ${attempt + 1})`,
        });
        return parsed;
      }

      // Malformed JSON — 立即重试 1 次，然后放弃
      if (attempt < 1) {
        logDegraded("proto-task", "bootstrap",
          `Malformed JSON for "${taskType}", retrying (attempt ${attempt + 1})`);
        continue;
      }
      return null;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);

      // 429 / timeout → 退避重试
      if (attempt < MAX_RETRIES - 1) {
        const delay = backoff(attempt);
        logDegraded("proto-task", "bootstrap",
          `LLM error for "${taskType}" (attempt ${attempt + 1}): ${lastError} — retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }
    }
  }

  // 最终失败: 日志 + 安全降级
  logDegraded("proto-task", "bootstrap",
    `Failed to bootstrap "${taskType}" after ${MAX_RETRIES} attempts: ${lastError ?? "unknown"}`);
  return null;
}

// ══════════════════════════════════════════════════════════════════
// 查询
// ══════════════════════════════════════════════════════════════════

/**
 * 获取缓存的 ProtoTask 模板 (不触发 LLM 调用)。
 * 返回 null 如果缓存未命中或已过期。
 */
export function getCachedProtoTask(taskType: string): ProtoTask | null {
  const cached = cache.get(taskType);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.protoTask;
  }
  return null;
}

/**
 * 按 taskType 使缓存失效。
 */
export function invalidateProtoTaskCache(taskType: string): void {
  cache.delete(taskType);
}

/**
 * 清空所有缓存。
 */
export function clearProtoTaskCache(): void {
  cache.clear();
}

/**
 * 判断 ProtoTask 是否满足注入阈值 (confidence ≥ 0.5)。
 * 用于 context.ts 注入守卫 — bootstrap 阶段 confidence=0.2 不会注入。
 */
export function shouldInjectProtoTask(pt: ProtoTask | null): boolean {
  if (!pt) return false;
  return pt.confidence >= 0.5;
}

// ══════════════════════════════════════════════════════════════════
// 内部: Prompt + 解析
// ══════════════════════════════════════════════════════════════════

const BOOTSTRAP_SYSTEM_PROMPT = `You are a task structure knowledge base. Given a task type, generate a reusable task template.

Return a JSON object with this exact structure:
{
  "typicalPhases": [
    {
      "name": "string — phase name (e.g., Requirements Analysis)",
      "description": "string — 1-2 sentence summary",
      "subtasks": ["string — concrete subtask", ...],
      "criteria": ["string — completion criteria", ...]
    }
  ],
  "commonPitfalls": [
    {
      "description": "string — what goes wrong",
      "severity": "low" | "medium" | "high",
      "mitigation": "string — how to avoid it",
      "hitCount": 0
    }
  ]
}

Rules:
- Generate 3-5 typical phases
- Generate 2-4 common pitfalls
- All fields must be present
- Return ONLY the JSON object, no markdown, no explanation`;

function parseProtoTaskResponse(
  taskType: string,
  raw: string,
): ProtoTask | null {
  try {
    // 处理可能的 markdown 代码块包裹
    let json = raw.trim();
    const fenceMatch = json.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n\s*```\s*$/);
    if (fenceMatch) {
      json = fenceMatch[1];
    }

    const parsed = JSON.parse(json);

    // 结构验证
    if (!Array.isArray(parsed.typicalPhases)) return null;
    if (!Array.isArray(parsed.commonPitfalls)) return null;

    for (const phase of parsed.typicalPhases) {
      if (!phase.name || !Array.isArray(phase.subtasks) || !Array.isArray(phase.criteria)) {
        return null;
      }
    }

    for (const pitfall of parsed.commonPitfalls) {
      if (!pitfall.description || !pitfall.mitigation) return null;
      if (!["low", "medium", "high"].includes(pitfall.severity)) {
        pitfall.severity = "medium"; // 安全默认
      }
      pitfall.hitCount = pitfall.hitCount ?? 0;
    }

    return {
      taskType,
      confidence: 0.2, // bootstrap 初始置信度
      source: "bootstrap",
      typicalPhases: parsed.typicalPhases,
      commonPitfalls: parsed.commonPitfalls,
      observations: 0,
      generatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}
