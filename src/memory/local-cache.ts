/**
 * LocalCache — AgentMemory 降级文件缓存
 *
 * 职责:
 *   - AgentMemory 不可用时，学习事件和 slot 更新写入本地文件
 *   - AgentMemory 恢复时，flush() 批量同步
 *   - 7 天 TTL — 超过 7 天未同步的缓存条目过期
 *
 * M0 实现。后续里程碑 (M2) 可能增加压缩和增量同步。
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface CacheEntry {
  key: string;
  value: unknown;
  writtenAt: number; // Unix ms
}

export interface CacheStats {
  entryCount: number;
  totalSizeBytes: number;
  oldestEntry: number | null;
  newestEntry: number | null;
  expiredCount: number;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_CACHE_DIR = path.resolve(
  path.join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".praxis", "cache")
);

// ══════════════════════════════════════════════════════════════════
// 文件系统工具
// ══════════════════════════════════════════════════════════════════

/** 获取缓存目录 — 延迟读取环境变量以支持测试覆盖 */
function getCacheDir(): string {
  return path.resolve(process.env.PRAXIS_CACHE_DIR || DEFAULT_CACHE_DIR);
}

function ensureCacheDir(): void {
  const dir = getCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cachePath(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getCacheDir(), `${safeKey}.json`);
}

function isExpired(entry: CacheEntry, now: number = Date.now()): boolean {
  return now - entry.writtenAt > TTL_MS;
}

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

export const localCache = {
  /**
   * 读取缓存条目。返回 null 如果不存在或已过期。
   */
  get(key: string): unknown | null {
    try {
      const filePath = cachePath(key);
      if (!fs.existsSync(filePath)) return null;

      const raw = fs.readFileSync(filePath, "utf-8");
      const entry: CacheEntry = JSON.parse(raw);

      if (isExpired(entry)) {
        // Clean up expired entry
        try { fs.unlinkSync(filePath); } catch { /* best effort */ }
        return null;
      }

      return entry.value;
    } catch {
      return null; // Corrupted file → treat as missing
    }
  },

  /**
   * 写入缓存条目。
   */
  set(key: string, value: unknown): void {
    try {
      ensureCacheDir();
      const entry: CacheEntry = {
        key,
        value,
        writtenAt: Date.now(),
      };
      const filePath = cachePath(key);
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
    } catch {
      // Cache write failures should never crash the caller.
      // If we can't write to disk, we silently skip — this is a best-effort cache.
    }
  },

  /**
   * 列出所有未过期的缓存条目。
   */
  list(): CacheEntry[] {
    try {
      ensureCacheDir();
      const files = fs.readdirSync(getCacheDir()).filter(f => f.endsWith(".json"));
      const now = Date.now();
      const entries: CacheEntry[] = [];

      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(getCacheDir(), file), "utf-8");
          const entry: CacheEntry = JSON.parse(raw);
          if (!isExpired(entry, now)) {
            entries.push(entry);
          }
        } catch {
          // Skip corrupted files
        }
      }

      return entries;
    } catch {
      return [];
    }
  },

  /**
   * 获取缓存统计信息。
   */
  stats(): CacheStats {
    const entries = this.list();
    const now = Date.now();

    let totalSize = 0;
    let oldest: number | null = null;
    let newest: number | null = null;
    let expiredCount = 0;

    try {
      ensureCacheDir();
      const files = fs.readdirSync(getCacheDir()).filter(f => f.endsWith(".json"));

      for (const file of files) {
        try {
          const filePath = path.join(getCacheDir(), file);
          const stat = fs.statSync(filePath);
          totalSize += stat.size;

          const raw = fs.readFileSync(filePath, "utf-8");
          const entry: CacheEntry = JSON.parse(raw);

          if (isExpired(entry, now)) {
            expiredCount++;
          }

          if (oldest === null || entry.writtenAt < oldest) oldest = entry.writtenAt;
          if (newest === null || entry.writtenAt > newest) newest = entry.writtenAt;
        } catch {
          // Skip
        }
      }
    } catch {
      // Dir doesn't exist → all zeros
    }

    return {
      entryCount: entries.length,
      totalSizeBytes: totalSize,
      oldestEntry: oldest,
      newestEntry: newest,
      expiredCount,
    };
  },

  /**
   * 删除指定缓存条目。
   */
  delete(key: string): void {
    try {
      const filePath = cachePath(key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Best effort
    }
  },

  /**
   * 清除所有过期条目。
   */
  purgeExpired(): number {
    let purged = 0;
    try {
      ensureCacheDir();
      const files = fs.readdirSync(getCacheDir()).filter(f => f.endsWith(".json"));
      const now = Date.now();

      for (const file of files) {
        try {
          const filePath = path.join(getCacheDir(), file);
          const raw = fs.readFileSync(filePath, "utf-8");
          const entry: CacheEntry = JSON.parse(raw);
          if (isExpired(entry, now)) {
            fs.unlinkSync(filePath);
            purged++;
          }
        } catch {
          // Corrupted → delete
          try { fs.unlinkSync(path.join(getCacheDir(), file)); purged++; } catch { /* skip */ }
        }
      }
    } catch {
      // Dir doesn't exist
    }
    return purged;
  },

  /**
   * 清空所有缓存（包括未过期的）。
   */
  clear(): void {
    try {
      ensureCacheDir();
      const files = fs.readdirSync(getCacheDir()).filter(f => f.endsWith(".json"));
      for (const file of files) {
        try { fs.unlinkSync(path.join(getCacheDir(), file)); } catch { /* skip */ }
      }
    } catch {
      // Dir doesn't exist
    }
  },
};
