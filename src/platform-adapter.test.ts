/**
 * platform-adapter 测试 — Phase 1A, TDD
 *
 * 覆盖路径:
 *   - 构造注入: 必须提供 AgentMemory 和 LLM 客户端
 *   - 事件路由: 根据事件类型分发到对应 handler
 *   - 事件乱序守卫: session_start 完成前拒绝非 session_start 事件
 *   - 幂等去重: 同一 sessionId+eventType 不重复处理
 *   - Result 类型: 所有 handler 返回 Result<T, PraxisError>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PlatformAdapter,
  AgentMemoryClient,
  LlmClient,
  Result,
  PraxisError,
} from "./platform-adapter";

// --- 类型定义（从设计文档附录 C 提取）---

type AutonomyAction = "proceed" | "inform" | "confirm" | "block";

interface AutonomyDecision {
  action: AutonomyAction;
  reason: string;
  proficiency: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

interface ContextInjection {
  systemPromptAddition: string;
  tier: "A" | "B" | "C";
  tokenCount: number;
}

interface LearningEvent {
  id: string;
  type: "correction" | "preference" | "pattern" | "insight" | "pitfall";
  content: string;
  confidence: number;
}

type PraxisEvent =
  | { type: "session_start"; sessionId: string; timestamp: string }
  | { type: "message_received"; sessionId: string; message: { role: "user" | "assistant"; content: string }; timestamp: string }
  | { type: "before_tool_call"; sessionId: string; toolName: string; toolArgs: Record<string, unknown>; taskId?: string }
  | { type: "after_tool_call"; sessionId: string; toolName: string; toolResult: { success: boolean; output?: unknown; error?: string }; taskId?: string }
  | { type: "agent_end"; sessionId: string }
  | { type: "session_end"; sessionId: string; timestamp: string };

type Result<T, E = PraxisError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

interface PraxisError {
  code: string;
  message: string;
}

// --- Mock 依赖 ---

interface AgentMemoryClient {
  getSlot(name: string): Promise<Result<unknown>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
  healthCheck(): Promise<boolean>;
}

interface LlmClient {
  analyze(prompt: string): Promise<Result<string>>;
}

function createMockAgentMemory(overrides?: Partial<AgentMemoryClient>): AgentMemoryClient {
  return {
    getSlot: vi.fn().mockResolvedValue({ ok: true, value: null }),
    setSlot: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    healthCheck: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function createMockLlm(): LlmClient {
  return {
    analyze: vi.fn().mockResolvedValue({ ok: true, value: "" }),
  };
}

// --- 被测试的模块（先写测试，实现稍后） ---

// 这里先 import 一个尚不存在的模块 — TDD 的标准流程
// 实际文件: src/platform-adapter.ts

// ============================================================
// 测试用例
// ============================================================

describe("PlatformAdapter", () => {
  // ---- 构造注入 ----

  describe("构造函数", () => {
    it("接受 AgentMemory 和 LLM 客户端作为构造参数", () => {
      // TDD: 这个测试驱动 PlatformAdapter 的构造函数签名
      const am = createMockAgentMemory();
      const llm = createMockLlm();

      // 如果 PlatformAdapter 导出正确，这行不会报类型错误
      const adapter = new PlatformAdapter(am, llm);

      expect(adapter).toBeDefined();
    });

    it("拒绝 null AgentMemory 客户端", () => {
      const llm = createMockLlm();

      expect(() => new PlatformAdapter(null as unknown as AgentMemoryClient, llm)).toThrow();
    });

    it("拒绝 null LLM 客户端", () => {
      const am = createMockAgentMemory();

      expect(() => new PlatformAdapter(am, null as unknown as LlmClient)).toThrow();
    });
  });

  // ---- 事件路由 ----

  describe("onEvent", () => {
    let am: AgentMemoryClient;
    let llm: LlmClient;
    let adapter: PlatformAdapter;

    beforeEach(() => {
      am = createMockAgentMemory();
      llm = createMockLlm();
      adapter = new PlatformAdapter(am, llm);
    });

    it("session_start 返回 ContextInjection", async () => {
      am.getSlot = vi.fn().mockResolvedValue({
        ok: true,
        value: { skills: [], best_practices: [], anti_patterns: [] },
      } as Result<unknown>);

      const result = await adapter.onEvent({
        type: "session_start",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contextInjection).toBeDefined();
        expect(result.value.contextInjection!.systemPromptAddition).toContain("Praxis");
      }
    });

    it("session_end 返回 LearningEvent[]", async () => {
      // session_start 必须先完成（乱序守卫）
      am.getSlot = vi.fn().mockResolvedValue({
        ok: true,
        value: { skills: [], best_practices: [], anti_patterns: [] },
      } as Result<unknown>);
      await adapter.onEvent({
        type: "session_start",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
      });

      const result = await adapter.onEvent({
        type: "session_end",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Array.isArray(result.value.learningEvents)).toBe(true);
      }
    });

    it("before_tool_call 返回 AutonomyDecision", async () => {
      am.getSlot = vi.fn().mockResolvedValue({
        ok: true,
        value: { skills: [{ id: "test", name: "Test", proficiency: 0.9, level: "proficient" }] },
      } as Result<unknown>);
      await adapter.onEvent({
        type: "session_start",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
      });

      const result = await adapter.onEvent({
        type: "before_tool_call",
        sessionId: "s1",
        toolName: "test_tool",
        toolArgs: {},
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.autonomyDecision).toBeDefined();
        expect(["proceed", "inform", "confirm", "block"]).toContain(
          result.value.autonomyDecision!.action,
        );
      }
    });
  });

  // ---- 事件乱序守卫 ----

  describe("事件乱序守卫", () => {
    it("session_start 完成前拒绝 before_tool_call", async () => {
      const am = createMockAgentMemory();
      const llm = createMockLlm();
      const adapter = new PlatformAdapter(am, llm);

      // 不先调 session_start，直接调 before_tool_call
      const result = await adapter.onEvent({
        type: "before_tool_call",
        sessionId: "s1",
        toolName: "test",
        toolArgs: {},
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("SESSION_NOT_STARTED");
      }
    });

    it("session_start 完成前拒绝 session_end", async () => {
      const adapter = new PlatformAdapter(createMockAgentMemory(), createMockLlm());

      const result = await adapter.onEvent({
        type: "session_end",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("SESSION_NOT_STARTED");
      }
    });

    it("session_start 完成后允许其他事件", async () => {
      const am = createMockAgentMemory();
      const adapter = new PlatformAdapter(am, createMockLlm());

      await adapter.onEvent({
        type: "session_start",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
      });

      const result = await adapter.onEvent({
        type: "before_tool_call",
        sessionId: "s1",
        toolName: "test",
        toolArgs: {},
      });

      expect(result.ok).toBe(true);
    });
  });

  // ---- 幂等去重 ----

  describe("幂等去重", () => {
    it("同一 sessionId 的 session_end 只处理一次", async () => {
      const am = createMockAgentMemory();
      const adapter = new PlatformAdapter(am, createMockLlm());

      await adapter.onEvent({
        type: "session_start",
        sessionId: "dup_test",
        timestamp: new Date().toISOString(),
      });

      // 第一次 session_end — 正常处理
      const result1 = await adapter.onEvent({
        type: "session_end",
        sessionId: "dup_test",
        timestamp: new Date().toISOString(),
      });
      expect(result1.ok).toBe(true);

      // 第二次 session_end — 幂等跳过
      const result2 = await adapter.onEvent({
        type: "session_end",
        sessionId: "dup_test",
        timestamp: new Date().toISOString(),
      });
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        // 幂等响应：learningEvents 为空（已处理过）
        expect(result2.value.learningEvents).toEqual([]);
      }
    });

    it("同一 sessionId 的 session_start 只处理一次", async () => {
      const am = createMockAgentMemory();
      const adapter = new PlatformAdapter(am, createMockLlm());

      await adapter.onEvent({
        type: "session_start",
        sessionId: "dup_start",
        timestamp: new Date().toISOString(),
      });

      const result = await adapter.onEvent({
        type: "session_start",
        sessionId: "dup_start",
        timestamp: new Date().toISOString(),
      });

      // 重复 session_start 应该被拒绝或跳过
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("SESSION_ALREADY_STARTED");
      }
    });

    it("不同 sessionId 独立去重", async () => {
      const am = createMockAgentMemory();
      const adapter = new PlatformAdapter(am, createMockLlm());

      // session A
      await adapter.onEvent({
        type: "session_start",
        sessionId: "sa",
        timestamp: new Date().toISOString(),
      });
      const rA = await adapter.onEvent({
        type: "session_end",
        sessionId: "sa",
        timestamp: new Date().toISOString(),
      });
      expect(rA.ok).toBe(true);

      // session B — 独立的去重空间
      await adapter.onEvent({
        type: "session_start",
        sessionId: "sb",
        timestamp: new Date().toISOString(),
      });
      const rB = await adapter.onEvent({
        type: "session_end",
        sessionId: "sb",
        timestamp: new Date().toISOString(),
      });
      expect(rB.ok).toBe(true);
      if (rB.ok) {
        // B 的 session_end 正常处理（不受 A 的去重影响）
        expect(rB.value.learningEvents).toBeDefined();
      }
    });
  });

  // ---- 实时学习提取（message_received + TranscriptAnalyzer） ----

  describe("message_received 实时学习", () => {
    it("注入 TranscriptAnalyzer 后在 message_received 时提取学习事件", async () => {
      const am = createMockAgentMemory();
      const mockAnalyzer = {
        analyze: vi.fn().mockReturnValue([
          { id: "e1", type: "correction" as const, content: "用户纠正了错误", confidence: 0.8 },
        ]),
      };

      const adapter = new PlatformAdapter(am, createMockLlm(), mockAnalyzer);

      // session_start 必须先完成
      am.getSlot = vi.fn().mockResolvedValue({
        ok: true,
        value: { skills: [], best_practices: [], anti_patterns: [] },
      } as Result<unknown>);
      await adapter.onEvent({
        type: "session_start",
        sessionId: "realtime",
        timestamp: new Date().toISOString(),
      });

      const result = await adapter.onEvent({
        type: "message_received",
        sessionId: "realtime",
        message: { role: "user", content: "不对，这里应该用 type" },
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.learningEvents).toHaveLength(1);
        expect(result.value.learningEvents![0].type).toBe("correction");
      }
      // 验证 setSlot 被调用保存学习事件
      expect(am.setSlot).toHaveBeenCalledWith(
        "progress_log",
        expect.objectContaining({
          sessionId: "realtime",
          events: expect.arrayContaining([
            expect.objectContaining({ type: "correction" }),
          ]),
        }),
      );
    });

    it("未注入 TranscriptAnalyzer 时 message_received 返回空（向后兼容）", async () => {
      const am = createMockAgentMemory();
      const adapter = new PlatformAdapter(am, createMockLlm()); // 无第三个参数

      await adapter.onEvent({
        type: "session_start",
        sessionId: "nop",
        timestamp: new Date().toISOString(),
      });

      const result = await adapter.onEvent({
        type: "message_received",
        sessionId: "nop",
        message: { role: "user", content: "hello" },
        timestamp: new Date().toISOString(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.learningEvents).toBeUndefined();
      }
    });

    it("analyzer 未发现事件时不写入 AgentMemory", async () => {
      const am = createMockAgentMemory();
      const mockAnalyzer = { analyze: vi.fn().mockReturnValue([]) };
      const adapter = new PlatformAdapter(am, createMockLlm(), mockAnalyzer);

      await adapter.onEvent({
        type: "session_start",
        sessionId: "no-events",
        timestamp: new Date().toISOString(),
      });

      await adapter.onEvent({
        type: "message_received",
        sessionId: "no-events",
        message: { role: "user", content: "普通对话，无学习内容" },
        timestamp: new Date().toISOString(),
      });

      // 无事件时不调用 setSlot
      expect(am.setSlot).not.toHaveBeenCalled();
    });
  });

  // ---- 降级模式 ----

  describe("降级模式", () => {
    it("AgentMemory 不可用时 session_start 使用本地缓存", async () => {
      const am = createMockAgentMemory({
        healthCheck: vi.fn().mockResolvedValue(false),
        getSlot: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "AGENTMEMORY_UNAVAILABLE", message: "MCP timeout" },
        } as Result<unknown>),
      });
      const adapter = new PlatformAdapter(am, createMockLlm());

      const result = await adapter.onEvent({
        type: "session_start",
        sessionId: "degraded_test",
        timestamp: new Date().toISOString(),
      });

      // 降级模式：仍然返回 ok，但使用缓存数据
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contextInjection!.systemPromptAddition).toContain("缓存数据");
      }
    });

    it("AgentMemory 不可用时 before_tool_call 返回保守决策", async () => {
      const am = createMockAgentMemory({
        getSlot: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: "AGENTMEMORY_UNAVAILABLE", message: "MCP timeout" },
        } as Result<unknown>),
      });
      const adapter = new PlatformAdapter(am, createMockLlm());

      await adapter.onEvent({
        type: "session_start",
        sessionId: "degraded_tool",
        timestamp: new Date().toISOString(),
      });

      const result = await adapter.onEvent({
        type: "before_tool_call",
        sessionId: "degraded_tool",
        toolName: "unknown_tool",
        toolArgs: {},
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // 无 competency 数据时，保守决策 = confirm
        expect(result.value.autonomyDecision!.action).toBe("confirm");
      }
    });
  });
});
