/**
 * Scenario Cache — TTL + 本地 Embedding 场景缓存 (Phase 0)
 *
 * 职责:
 *   - 跨 session 缓存场景识别结果，避免每次 session_start 都调 LLM
 *   - TTL 检查（快速路径）: 4 小时内缓存直接命中
 *   - Embedding 验证（语义路径）: TTL 过期时比较当前上下文与缓存的 embedding 相似度
 *
 * 缓存 key: 最近一次 session 的场景上下文 + 时间戳
 * 缓存存储: ~/.praxis-phase1a/scenario-cache.json（单条记录，非列表）
 *
 * 降级:
 *   模型未加载 → TTL-only 模式（embedding 检查跳过，仅依赖时间）
 *   缓存文件损坏 → 视为未命中 → LLM 场景识别 → 覆盖写入新缓存
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CACHE_DIR = path.join(os.homedir(), ".praxis-phase1a");
const CACHE_FILE = path.join(CACHE_DIR, "scenario-cache.json");

/** 4 小时 TTL（毫秒） */
const TTL_MS = 4 * 60 * 60 * 1000;

/** Embedding 余弦相似度阈值 — 超过此值视为同一场景 */
const EMBEDDING_SIMILARITY_THRESHOLD = 0.75;

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface ScenarioCacheEntry {
  /** 场景 ID 列表（按置信度降序） */
  scenarioIds: string[];
  /** 主场景 ID（最高置信度） */
  primaryScenarioId: string;
  /** 场景识别置信度 (0-1) */
  confidence: number;
  /** 缓存时的上下文文本（用户第一条消息或 TaskContext 摘要），用于 embedding 比较 */
  contextualSnapshot: string;
  /** 上下文文本的 embedding 向量（384 维，all-MiniLM-L6-v2）。模型未加载时为 null */
  embedding: number[] | null;
  /** 缓存写入时间 (Unix ms) */
  cachedAt: number;
  /** 来源 session ID（审计追踪，不参与匹配） */
  sourceSessionId: string;
}

export interface CacheCheckResult {
  hit: boolean;
  /** 命中原因 */
  reason: "ttl" | "embedding_similarity" | "miss";
  /** embedding 相似度（仅当 reason === "embedding_similarity" 时有效） */
  similarity?: number;
}

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 读取场景缓存。
 * @returns ScenarioCacheEntry 或 null（无缓存 / 文件损坏）
 */
export function readCache(): ScenarioCacheEntry | null {
  try {
    ensureDir();
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    const entry: ScenarioCacheEntry = JSON.parse(raw);
    if (!entry.scenarioIds || !entry.cachedAt) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * 写入场景缓存（覆盖）。
 * 调用时机: session_end — 每次会话结束时更新缓存为当前场景。
 */
export function writeCache(entry: ScenarioCacheEntry): void {
  ensureDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(entry, null, 2), "utf-8");
}

/**
 * 检查缓存是否命中。
 *
 * 两阶段检查:
 *   1. TTL 检查: cachedAt + 4h > now → 直接命中（零计算，零 IO 之外零开销）
 *   2. Embedding 检查: TTL 过期但 embedding 可用时，比较相似度
 *   3. 未命中: 返回 miss → 调用方应触发 LLM 场景识别
 *
 * @param cacheEntry  缓存的场景条目
 * @param currentContextEmbedding  当前上下文的 embedding 向量（模型未加载时传 null）
 * @returns CacheCheckResult
 */
export function checkCache(
  cacheEntry: ScenarioCacheEntry,
  currentContextEmbedding: number[] | null,
): CacheCheckResult {
  const age = Date.now() - cacheEntry.cachedAt;

  // 阶段 1: TTL 检查
  if (age < TTL_MS) {
    return { hit: true, reason: "ttl" };
  }

  // 阶段 2: Embedding 相似度检查
  if (currentContextEmbedding && cacheEntry.embedding) {
    const similarity = cosineSimilarity(currentContextEmbedding, cacheEntry.embedding);
    if (similarity > EMBEDDING_SIMILARITY_THRESHOLD) {
      return { hit: true, reason: "embedding_similarity", similarity };
    }
  }

  return { hit: false, reason: "miss" };
}

/**
 * 删除缓存文件（用于测试和手动重置）。
 */
export function clearCache(): void {
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {
    // 删除失败不影响正常运行
  }
}

// ══════════════════════════════════════════════════════════════════
// 内部
// ══════════════════════════════════════════════════════════════════

function ensureDir(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * 余弦相似度。
 * 两个向量必须长度相同。假设向量已归一化（all-MiniLM-L6-v2 输出默认归一化）。
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
