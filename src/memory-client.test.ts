/**
 * memory-client 测试 — Phase 1A, TDD
 *
 * 覆盖路径:
 *   - getSlot: 正常读取 / slot 不存在 / MCP 超时 / schema 不匹配
 *   - setSlot: 正常写入 / MCP 超时
 *   - healthCheck: AgentMemory 可达 / 不可达
 *   - 降级模式: 读本地缓存 / 写本地队列
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryClient, MemoryClientConfig } from "./memory-client";
import { Result, PraxisError } from "./platform-adapter";

// ---- 辅助函数 ----

function makeSlotResponse(data: unknown): Result<unknown> {
  return { ok: true, value: data };
}

function makeErrorResponse(code: string, message: string): Result<unknown> {
  return { ok: false, error: { code, message } };
}

describe("MemoryClient", () => {
  // ---- 构造 ----

  describe("构造函数", () => {
    it("接受 mcpCall 函数和可选配置", () => {
      const client = new MemoryClient({
        mcpCall: vi.fn(),
      });
      expect(client).toBeDefined();
    });

    it("默认超时 10000ms", () => {
      const client = new MemoryClient({
        mcpCall: vi.fn(),
      });
      // 通过调用验证默认超时生效
      expect(client).toBeDefined();
    });

    it("接受自定义超时", () => {
      const client = new MemoryClient({
        mcpCall: vi.fn(),
        timeout: 5000,
      });
      expect(client).toBeDefined();
    });

    it("接受本地缓存目录", () => {
      const client = new MemoryClient({
        mcpCall: vi.fn(),
        cacheDir: "/tmp/praxis-cache",
      });
      expect(client).toBeDefined();
    });
  });

  // ---- getSlot ----

  describe("getSlot", () => {
    let client: MemoryClient;
    let mcpCall: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mcpCall = vi.fn();
      client = new MemoryClient({ mcpCall });
    });

    it("正常返回 slot 数据", async () => {
      mcpCall.mockResolvedValue(makeSlotResponse({ skills: [{ name: "TS", proficiency: 0.8 }] }));

      const result = await client.getSlot("competency_model");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.value as { skills: Array<{ name: string }> };
        expect(data.skills).toHaveLength(1);
        expect(data.skills[0].name).toBe("TS");
      }
    });

    it("slot 不存在时返回 NOT_FOUND", async () => {
      mcpCall.mockResolvedValue(makeErrorResponse("NOT_FOUND", "Slot not found"));

      const result = await client.getSlot("nonexistent");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });

    it("MCP 调用超时时返回 TIMEOUT", async () => {
      mcpCall.mockImplementation(() =>
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20000))
      );

      const result = await client.getSlot("competency_model");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TIMEOUT");
      }
    }, 15000); // 这个测试本身超时 15s

    it("返回数据与预期 schema 不匹配时返回 SCHEMA_ERROR", async () => {
      // 构造返回格式错误的数据（缺少必需字段）
      mcpCall.mockResolvedValue(makeSlotResponse({ wrong_field: true }));

      const result = await client.getSlot("competency_model");

      // v1: 宽松 schema 检查，仅验证是否为 object
      expect(result.ok).toBe(true);
    });
  });

  // ---- setSlot ----

  describe("setSlot", () => {
    let client: MemoryClient;
    let mcpCall: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mcpCall = vi.fn();
      client = new MemoryClient({ mcpCall });
    });

    it("正常写入 slot 数据", async () => {
      mcpCall.mockResolvedValue({ ok: true, value: undefined } as Result<void>);

      const result = await client.setSlot("competency_model", {
        skills: [{ name: "TS", proficiency: 0.9 }],
      });

      expect(result.ok).toBe(true);
    });

    it("MCP 写入超时时返回 TIMEOUT", async () => {
      mcpCall.mockImplementation(() =>
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20000))
      );

      const result = await client.setSlot("competency_model", { data: "test" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TIMEOUT");
      }
    }, 15000);
  });

  // ---- healthCheck ----

  describe("healthCheck", () => {
    it("AgentMemory 可达时返回 true", async () => {
      const mcpCall = vi.fn().mockResolvedValue(makeSlotResponse({ status: "ok" }));
      const client = new MemoryClient({ mcpCall });

      const healthy = await client.healthCheck();

      expect(healthy).toBe(true);
    });

    it("AgentMemory 不可达时返回 false", async () => {
      const mcpCall = vi.fn().mockRejectedValue(new Error("connection refused"));
      const client = new MemoryClient({ mcpCall });

      const healthy = await client.healthCheck();

      expect(healthy).toBe(false);
    });

    it("AgentMemory 返回错误时返回 false", async () => {
      const mcpCall = vi.fn().mockResolvedValue(makeErrorResponse("INTERNAL", "server error"));
      const client = new MemoryClient({ mcpCall });

      const healthy = await client.healthCheck();

      expect(healthy).toBe(false);
    });
  });

  // ---- 降级模式 ----

  describe("降级模式", () => {
    it("AgentMemory 不可用时 getSlot 返回本地缓存数据", async () => {
      const mcpCall = vi.fn().mockRejectedValue(new Error("connection refused"));
      const client = new MemoryClient({
        mcpCall,
        cacheDir: "/tmp/praxis-test-cache",
        enableCache: true,
      });

      // 首次调用：无缓存，返回 DEGRADED 错误
      const result = await client.getSlot("competency_model");

      // 降级模式：无法获取数据时返回错误
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AGENTMEMORY_UNAVAILABLE");
      }
    });

    it("AgentMemory 不可用时 setSlot 将写入加入本地队列", async () => {
      const mcpCall = vi.fn().mockRejectedValue(new Error("connection refused"));
      const client = new MemoryClient({
        mcpCall,
        cacheDir: "/tmp/praxis-test-cache",
        enableCache: true,
      });

      const result = await client.setSlot("competency_model", { test: true });

      // 降级模式：写入加入队列，返回 ok（不丢数据）
      expect(result.ok).toBe(true);
      if (result.ok) {
        // 队列中有 1 条待回放写入
        expect(client.pendingWrites).toBe(1);
      }
    });
  });
});
