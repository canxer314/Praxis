/**
 * m0-builder 测试 — Phase 5: 提取 buildM0Deps 到共享模块
 *
 * 覆盖:
 *   - MemorySubsystem 的正确组装 (getSlot/setSlot/smartSearch/saveLesson/isAvailable/saveProtoStructure)
 *   - CacheSubsystem 基于文件系统的 CRUD
 *   - LLMSubsystem 封装 TranscriptAnalyzerV2 + extractProtoStructures
 *   - ConfidenceFuser 注入
 *   - attentionRecords Map 初始化
 *   - AgentMemory 不可用时 MemorySubsystem 降级
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { buildM0Deps } from "./m0-builder";

// 不 mock agentmemory, 而是验证 buildM0Deps 产出的 M0Deps 结构完整性

const testDir = path.join(os.tmpdir(), `praxis-m0-builder-test-${Date.now()}`);

beforeEach(() => {
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
});

describe("buildM0Deps (Phase 5)", () => {
  it("返回完整 M0Deps 结构 — memory/cache/llm/fuser/attentionRecords", () => {
    const deps = buildM0Deps({ memoryDir: testDir });

    expect(deps.memory).toBeDefined();
    expect(deps.cache).toBeDefined();
    expect(deps.llm).toBeDefined();
    expect(deps.fuser).toBeDefined();
    expect(deps.attentionRecords).toBeDefined();
  });

  it("MemorySubsystem.isAvailable 返回 boolean", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    const available = await deps.memory.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("MemorySubsystem.getSlot 返回 Result<unknown>", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    const result = await deps.memory.getSlot("test_slot");
    expect(result.ok !== undefined).toBe(true);
    if (result.ok) {
      expect(result.value !== undefined).toBe(true);
    } else {
      expect(result.error).toBeDefined();
    }
  });

  it("MemorySubsystem.setSlot 返回 Result<void>", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    const result = await deps.memory.setSlot("test_write", { data: 42 });
    expect(result.ok !== undefined).toBe(true);
  });

  it("MemorySubsystem.smartSearch 返回 Result<unknown[]>", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    const result = await deps.memory.smartSearch("test query");
    expect(result.ok !== undefined).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
    }
  });

  it("MemorySubsystem.smartSearch 支持 proto_structure type 参数", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    const result = await deps.memory.smartSearch("*", "proto_structure");
    expect(result.ok !== undefined).toBe(true);
  });

  it("MemorySubsystem.saveLesson 返回 Result<void>", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    const result = await deps.memory.saveLesson({
      type: "correction",
      content: "测试学习",
      confidence: 0.8,
    });
    expect(result.ok !== undefined).toBe(true);
  });

  it("MemorySubsystem.saveProtoStructure 已注入 (Phase 0)", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    expect(deps.memory.saveProtoStructure).toBeDefined();
    expect(typeof deps.memory.saveProtoStructure).toBe("function");
  });

  it("CacheSubsystem CRUD 完整", () => {
    const deps = buildM0Deps({ memoryDir: testDir });

    // set
    deps.cache.set("test_key", { value: "hello" });

    // get
    const cached = deps.cache.get("test_key");
    expect(cached).toBeDefined();

    // list
    const list = deps.cache.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((e) => e.key === "test_key")).toBe(true);

    // delete
    deps.cache.delete("test_key");
    const afterDelete = deps.cache.get("test_key");
    expect(afterDelete).toBeNull();
  });

  it("CacheSubsystem 写入 JSON 文件 (文件系统后端)", () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    deps.cache.set("persist_test", { persisted: true });

    // 验证文件存在
    const cacheFile = path.join(testDir, "cache-persist_test.json");
    expect(fs.existsSync(cacheFile)).toBe(true);

    // 验证 JSON 内容
    const raw = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    expect(raw.persisted).toBe(true);
  });

  it("CacheSubsystem.get 对不存在的 key 返回 null", () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    const result = deps.cache.get("nonexistent_key_xyz");
    expect(result).toBeNull();
  });

  it("LLMSubsystem 已注入 — analyzeTranscript", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    expect(deps.llm).toBeDefined();
    expect(typeof deps.llm!.analyzeTranscript).toBe("function");
  });

  it("LLMSubsystem 已注入 — extractProtoStructures", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    expect(deps.llm).toBeDefined();
    expect(typeof deps.llm!.extractProtoStructures).toBe("function");
  });

  it("LLMSubsystem 已注入 — analyze (generic)", async () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    expect(deps.llm).toBeDefined();
    expect(typeof deps.llm!.analyze).toBe("function");
  });

  it("fuser 是 ConfidenceFuser 实例", () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    expect(deps.fuser).toBeDefined();
    expect(typeof deps.fuser!.fuse).toBe("function");
  });

  it("attentionRecords 是空 Map", () => {
    const deps = buildM0Deps({ memoryDir: testDir });
    expect(deps.attentionRecords).toBeInstanceOf(Map);
    expect(deps.attentionRecords!.size).toBe(0);
  });

  it("AgentMemory 不可用时所有 memory 方法不抛异常 (graceful degrade)", async () => {
    // 用一个不存在/不可达的路径模拟 AM 不可用场景
    const deps = buildM0Deps({ memoryDir: "/nonexistent/path/xyz" });

    // 这些调用不应崩溃
    const available = await deps.memory.isAvailable();
    expect(typeof available).toBe("boolean");

    const slotResult = await deps.memory.getSlot("any");
    expect(slotResult.ok !== undefined).toBe(true);

    const searchResult = await deps.memory.smartSearch("any");
    expect(searchResult.ok !== undefined).toBe(true);

    const lessonResult = await deps.memory.saveLesson({ content: "test" });
    expect(lessonResult.ok !== undefined).toBe(true);

    const setResult = await deps.memory.setSlot("any", {});
    expect(setResult.ok !== undefined).toBe(true);
  });
});
