/**
 * local-cache 测试 — M0 Step 1
 *
 * 测试文件缓存的基本操作: get/set/list/stats/delete/purgeExpired/clear
 * 以及 7 天 TTL 过期机制。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { localCache } from "./local-cache";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ══════════════════════════════════════════════════════════════════
// Setup: 使用临时目录避免污染真实缓存
// ══════════════════════════════════════════════════════════════════

const TMP_DIR = path.join(os.tmpdir(), `praxis-cache-test-${Date.now()}`);

beforeEach(() => {
  process.env.PRAXIS_CACHE_DIR = TMP_DIR;
  localCache.clear();
});

afterEach(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* noop */ }
});

// ══════════════════════════════════════════════════════════════════
// 基本读写
// ══════════════════════════════════════════════════════════════════

describe("localCache get/set", () => {
  it("写入后可以读取", () => {
    localCache.set("test-key", { hello: "world" });
    const result = localCache.get("test-key");
    expect(result).toEqual({ hello: "world" });
  });

  it("不存在的 key 返回 null", () => {
    const result = localCache.get("nonexistent");
    expect(result).toBeNull();
  });

  it("覆盖写入", () => {
    localCache.set("key", "v1");
    localCache.set("key", "v2");
    expect(localCache.get("key")).toBe("v2");
  });

  it("支持多种数据类型", () => {
    localCache.set("string", "hello");
    localCache.set("number", 42);
    localCache.set("array", [1, 2, 3]);
    localCache.set("object", { nested: { deep: true } });
    localCache.set("null", null);
    localCache.set("boolean", false);

    expect(localCache.get("string")).toBe("hello");
    expect(localCache.get("number")).toBe(42);
    expect(localCache.get("array")).toEqual([1, 2, 3]);
    expect(localCache.get("object")).toEqual({ nested: { deep: true } });
    expect(localCache.get("null")).toBeNull();
    expect(localCache.get("boolean")).toBe(false);
  });

  it("key 中的特殊字符被 sanitize", () => {
    localCache.set("test/key:with*special?chars", "value");
    // 应该能写入而不抛错
    const result = localCache.get("test/key:with*special?chars");
    expect(result).toBe("value");
  });
});

// ══════════════════════════════════════════════════════════════════
// 列表和统计
// ══════════════════════════════════════════════════════════════════

describe("localCache list/stats", () => {
  it("空缓存的 list 返回空数组", () => {
    expect(localCache.list()).toEqual([]);
  });

  it("写入 3 条后 list 返回 3 条", () => {
    localCache.set("a", 1);
    localCache.set("b", 2);
    localCache.set("c", 3);
    expect(localCache.list()).toHaveLength(3);
  });

  it("stats 返回正确的统计信息", () => {
    localCache.set("a", { data: "x".repeat(100) });
    localCache.set("b", { data: "y".repeat(50) });

    const stats = localCache.stats();
    expect(stats.entryCount).toBe(2);
    expect(stats.totalSizeBytes).toBeGreaterThan(0);
    expect(stats.oldestEntry).not.toBeNull();
    expect(stats.newestEntry).not.toBeNull();
    expect(stats.oldestEntry!).toBeLessThanOrEqual(stats.newestEntry!);
  });
});

// ══════════════════════════════════════════════════════════════════
// 删除
// ══════════════════════════════════════════════════════════════════

describe("localCache delete", () => {
  it("删除存在的条目后 get 返回 null", () => {
    localCache.set("to-delete", "value");
    localCache.delete("to-delete");
    expect(localCache.get("to-delete")).toBeNull();
  });

  it("删除不存在的条目不抛错", () => {
    expect(() => localCache.delete("nonexistent")).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════
// TTL 过期
// ══════════════════════════════════════════════════════════════════

describe("localCache TTL", () => {
  it("未过期条目可以读取", () => {
    localCache.set("fresh", "value");
    expect(localCache.get("fresh")).toBe("value");
  });

  it("过期条目 get 返回 null", () => {
    const dir = path.join(TMP_DIR, "expired-test");
    fs.mkdirSync(dir, { recursive: true });
    process.env.PRAXIS_CACHE_DIR = dir;

    const filePath = path.join(dir, "expired.json");
    const expiredEntry = {
      key: "expired",
      value: "old-value",
      writtenAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
    };
    fs.writeFileSync(filePath, JSON.stringify(expiredEntry), "utf-8");

    const result = localCache.get("expired");
    expect(result).toBeNull();
  });

  it("purgeExpired 清除过期条目", () => {
    const dir = path.join(TMP_DIR, "purge-test");
    fs.mkdirSync(dir, { recursive: true });
    process.env.PRAXIS_CACHE_DIR = dir;

    const filePath = path.join(dir, "stale.json");
    const expiredEntry = {
      key: "stale",
      value: "old",
      writtenAt: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days ago
    };
    fs.writeFileSync(filePath, JSON.stringify(expiredEntry), "utf-8");

    const purged = localCache.purgeExpired();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(localCache.get("stale")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// 清空
// ══════════════════════════════════════════════════════════════════

describe("localCache clear", () => {
  it("清空后 list 返回空数组", () => {
    localCache.set("a", 1);
    localCache.set("b", 2);
    localCache.clear();
    expect(localCache.list()).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
// 健壮性
// ══════════════════════════════════════════════════════════════════

describe("localCache resilience", () => {
  it("损坏的 JSON 文件 get 返回 null 不抛错", () => {
    const dir = path.join(TMP_DIR, "corrupt-test");
    fs.mkdirSync(dir, { recursive: true });
    process.env.PRAXIS_CACHE_DIR = dir;

    const filePath = path.join(dir, "corrupt.json");
    fs.writeFileSync(filePath, "not valid json {{{", "utf-8");

    expect(() => localCache.get("corrupt")).not.toThrow();
    expect(localCache.get("corrupt")).toBeNull();
  });

  it("缓存目录不存在时操作不抛错", () => {
    // 指向一个不存在的临时子目录
    process.env.PRAXIS_CACHE_DIR = path.join(TMP_DIR, "nonexistent-subdir");
    expect(() => localCache.get("any")).not.toThrow();
    expect(() => localCache.list()).not.toThrow();
    expect(() => localCache.stats()).not.toThrow();
  });
});
