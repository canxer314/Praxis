/**
 * scenario-cache 测试 — TTL + 本地 Embedding 场景缓存 (Phase 0)
 *
 * 覆盖:
 *   - 读/写缓存
 *   - TTL 命中（4 小时内）
 *   - TTL 过期但 embedding 相似 → 命中
 *   - TTL 过期且 embedding 不相似 → 未命中
 *   - 缓存文件不存在 → null
 *   - embedding 为 null 时 TTL 过期 → 未命中
 *   - clearCache 删除
 *   - 损坏的 JSON → null
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  readCache,
  writeCache,
  checkCache,
  clearCache,
  type ScenarioCacheEntry,
} from "./scenario-cache";

const CACHE_FILE = path.join(os.homedir(), ".praxis-phase1a", "scenario-cache.json");

// 384 维归一化向量 — 模拟 all-MiniLM-L6-v2 输出
function mockEmbedding(seed: number): number[] {
  // 伪随机但确定性的向量，归一化
  const v: number[] = [];
  let norm = 0;
  for (let i = 0; i < 384; i++) {
    const val = Math.sin(seed * 1000 + i * 0.1);
    v.push(val);
    norm += val * val;
  }
  const scale = 1 / Math.sqrt(norm);
  return v.map((x) => x * scale);
}

function makeEntry(overrides: Partial<ScenarioCacheEntry> = {}): ScenarioCacheEntry {
  return {
    scenarioIds: ["backend_api_development"],
    primaryScenarioId: "backend_api_development",
    confidence: 0.7,
    contextualSnapshot: "用户正在开发后端 API 接口",
    embedding: mockEmbedding(42),
    cachedAt: Date.now(),
    sourceSessionId: "test-session-1",
    ...overrides,
  };
}

describe("readCache / writeCache", () => {
  beforeEach(() => clearCache());
  afterEach(() => clearCache());

  it("无缓存文件 → null", () => {
    expect(readCache()).toBeNull();
  });

  it("写入后读取成功", () => {
    const entry = makeEntry();
    writeCache(entry);
    const read = readCache();
    expect(read).not.toBeNull();
    expect(read!.primaryScenarioId).toBe("backend_api_development");
    expect(read!.scenarioIds).toEqual(["backend_api_development"]);
  });

  it("损坏的 JSON → null", () => {
    const dir = path.join(os.homedir(), ".praxis-phase1a");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, "not valid json{{{", "utf-8");
    expect(readCache()).toBeNull();
  });

  it("clearCache 删除文件", () => {
    writeCache(makeEntry());
    expect(readCache()).not.toBeNull();
    clearCache();
    expect(readCache()).toBeNull();
  });
});

describe("checkCache", () => {
  it("4 小时内 → TTL 直接命中", () => {
    const entry = makeEntry({ cachedAt: Date.now() - 1000 }); // 1 秒前
    const result = checkCache(entry, null);
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("ttl");
  });

  it("超过 4 小时但 embedding 相似 → 命中", () => {
    const embedding = mockEmbedding(42); // same seed as entry
    const entry = makeEntry({
      cachedAt: Date.now() - 5 * 60 * 60 * 1000, // 5 小时前
      embedding,
    });
    const result = checkCache(entry, embedding); // same embedding
    expect(result.hit).toBe(true);
    expect(result.reason).toBe("embedding_similarity");
    expect(result.similarity).toBeGreaterThan(0.99);
  });

  it("超过 4 小时且 embedding 不相似 → 未命中", () => {
    const entry = makeEntry({
      cachedAt: Date.now() - 5 * 60 * 60 * 1000,
      embedding: mockEmbedding(42),
    });
    const result = checkCache(entry, mockEmbedding(999)); // different seed
    expect(result.hit).toBe(false);
    expect(result.reason).toBe("miss");
  });

  it("TTL 过期但当前 embedding 为 null → 未命中（无 embedding 可用）", () => {
    const entry = makeEntry({
      cachedAt: Date.now() - 5 * 60 * 60 * 1000,
    });
    const result = checkCache(entry, null);
    expect(result.hit).toBe(false);
    expect(result.reason).toBe("miss");
  });

  it("TTL 过期但缓存 embedding 为 null → 未命中", () => {
    const entry = makeEntry({
      cachedAt: Date.now() - 5 * 60 * 60 * 1000,
      embedding: null,
    });
    const result = checkCache(entry, mockEmbedding(42));
    expect(result.hit).toBe(false);
    expect(result.reason).toBe("miss");
  });
});
