/**
 * Embedding Utility — 本地文本向量化 (Phase 0)
 *
 * 职责:
 *   - 管理 Transformers.js pipeline 的单例（懒加载，模型仅加载一次）
 *   - 从 .env 读取模型配置（PRAXIS_EMBEDDING_MODEL / PRAXIS_EMBEDDING_MODEL_PATH）
 *   - 提供 embed() 函数：文本 → 归一化 384 维向量
 *
 * 配置:
 *   .env 中设置:
 *     PRAXIS_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2        # HuggingFace 模型 ID
 *     PRAXIS_EMBEDDING_MODEL_PATH=D:\WorkSpace\Xenova\...   # 本地模型路径（可选，跳过下载）
 *
 * 降级:
 *   模型加载失败 → embed() 返回 null（调用方应回退到 TTL-only 缓存模式）
 */

import * as fs from "fs";
import * as path from "path";

// ══════════════════════════════════════════════════════════════════
// 配置（从 .env 读取）
// ══════════════════════════════════════════════════════════════════

function loadEnv(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

const env = loadEnv();

/** HuggingFace 模型 ID */
const MODEL_NAME = env.PRAXIS_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";

/** 本地模型路径（设置后跳过自动下载，直接从本地加载 ONNX 文件） */
const MODEL_PATH = env.PRAXIS_EMBEDDING_MODEL_PATH || undefined;

// ══════════════════════════════════════════════════════════════════
// 单例 Pipeline
// ══════════════════════════════════════════════════════════════════

/** Pipeline 实例 — 懒加载，首次调用 embed() 时初始化 */
let _pipeline: Promise<EmbeddingPipeline | null> | null = null;

interface EmbeddingPipeline {
  extractor: {
    (text: string, opts: { pooling: "mean"; normalize: boolean }): Promise<{ data: Float32Array }>;
  };
}

/**
 * 获取（或初始化）embedding pipeline 单例。
 * 模型仅加载一次，后续调用复用已加载实例。
 */
function getPipeline(): Promise<EmbeddingPipeline | null> {
  if (_pipeline) return _pipeline;

  _pipeline = (async () => {
    try {
      // 动态 import — Transformers.js 是可选依赖，仅在调用 embed() 时加载
      const { pipeline, env: transformersEnv } = await import("@huggingface/transformers");

      // 配置本地模型路径
      if (MODEL_PATH) {
        transformersEnv.allowLocalModels = true;
        transformersEnv.localModelPath = path.dirname(MODEL_PATH);
      }

      // 使用本地路径或 HuggingFace 模型 ID
      const modelRef = MODEL_PATH || MODEL_NAME;
      const extractor = await pipeline("feature-extraction", modelRef);

      return { extractor } as EmbeddingPipeline;
    } catch (e) {
      console.error(
        "[Praxis] Embedding model load failed:",
        e instanceof Error ? e.message : String(e),
      );
      _pipeline = null; // 允许重试
      return null;
    }
  })();

  return _pipeline;
}

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 将文本转换为归一化 embedding 向量。
 *
 * @param text  输入文本（用户消息、场景描述等）
 * @returns 384 维归一化向量 (all-MiniLM-L6-v2)，或 null（模型未加载 / 加载失败）
 */
export async function embed(text: string): Promise<number[] | null> {
  if (!text || text.trim().length === 0) return null;

  const pl = await getPipeline();
  if (!pl) return null;

  try {
    const result = await pl.extractor(text, { pooling: "mean", normalize: true });
    return Array.from(result.data);
  } catch (e) {
    console.error(
      "[Praxis] Embedding inference failed:",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * 检查 embedding 模型是否可用（不触发加载）。
 * 用于 session_start 的快速路径判断——如果模型之前加载失败过，跳过 embedding 检查。
 */
export function isEmbeddingAvailable(): boolean {
  // 已成功加载过
  return _pipeline !== null;
}

/**
 * 获取模型配置信息（用于日志/调试）。
 */
export function getEmbeddingConfig(): { modelName: string; modelPath?: string } {
  return { modelName: MODEL_NAME, modelPath: MODEL_PATH };
}
