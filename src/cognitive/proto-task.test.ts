/**
 * proto-task 测试 — Bootstrap + TTL 缓存 + 重试
 *
 * 覆盖:
 *   - 有效 LLM 响应 → ProtoTask (confidence=0.2)
 *   - LLM 不可用 → 返回 null
 *   - Malformed JSON → 重试 1 次, 仍失败返回 null
 *   - TTL 缓存命中 → 不调用 LLM
 *   - 缓存失效后 → 重新调用 LLM
 *   - 未知 taskType → 仍可 bootstrap (LLM 通用知识)
 *   - shouldInjectProtoTask (confidence >= 0.5)
 *   - 缓存操作 (getCached / invalidate / clear)
 */

import { describe, it, expect, vi } from "vitest";
import {
  bootstrapProtoTask,
  getCachedProtoTask,
  invalidateProtoTaskCache,
  clearProtoTaskCache,
  shouldInjectProtoTask,
} from "./proto-task";
import type { ProtoTaskLLMClient } from "./proto-task";

function makeValidPayload() {
  return {
    typicalPhases: [
      {
        name: "Requirements Analysis",
        description: "Understand what needs to be built",
        subtasks: ["Review spec", "Identify stakeholders"],
        criteria: ["All requirements documented"],
      },
      {
        name: "Implementation",
        description: "Build the solution",
        subtasks: ["Write code", "Write tests"],
        criteria: ["All tests pass"],
      },
    ],
    commonPitfalls: [
      {
        description: "Missing edge cases",
        severity: "medium",
        mitigation: "Write test cases first",
        hitCount: 0,
      },
    ],
  };
}

function makeLLMClient(
  behavior: "valid" | "unavailable" | "malformed" | "timeout",
  callCount?: { value: number },
): ProtoTaskLLMClient {
  return {
    chat: vi.fn().mockImplementation(async () => {
      if (callCount) callCount.value++;
      if (behavior === "unavailable") {
        throw new Error("Connection refused");
      }
      if (behavior === "timeout") {
        throw new Error("Request timeout");
      }
      if (behavior === "malformed") {
        return { content: "{ this is not valid json }" };
      }
      return { content: JSON.stringify(makeValidPayload()) };
    }),
  };
}

// ══════════════════════════════════════════════════════════════════
// Bootstrap
// ══════════════════════════════════════════════════════════════════

describe("bootstrapProtoTask — 有效响应", () => {
  it("生成 bootstrap ProtoTask (confidence=0.2)", async () => {
    // 清空缓存确保每次测试独立
    clearProtoTaskCache();
    const llm = makeLLMClient("valid");
    const pt = await bootstrapProtoTask("software_project", llm);

    expect(pt).not.toBeNull();
    expect(pt!.taskType).toBe("software_project");
    expect(pt!.confidence).toBe(0.2);
    expect(pt!.source).toBe("bootstrap");
    expect(pt!.observations).toBe(0);
    expect(pt!.typicalPhases).toHaveLength(2);
    expect(pt!.commonPitfalls).toHaveLength(1);
  });

  it("阶段包含完整结构", async () => {
    clearProtoTaskCache();
    const llm = makeLLMClient("valid");
    const pt = await bootstrapProtoTask("bug_fix", llm);

    for (const phase of pt!.typicalPhases) {
      expect(phase.name).toBeTruthy();
      expect(Array.isArray(phase.subtasks)).toBe(true);
      expect(Array.isArray(phase.criteria)).toBe(true);
    }
  });

  it("陷阱包含完整结构", async () => {
    clearProtoTaskCache();
    const llm = makeLLMClient("valid");
    const pt = await bootstrapProtoTask("bug_fix", llm);

    for (const pitfall of pt!.commonPitfalls) {
      expect(pitfall.description).toBeTruthy();
      expect(pitfall.mitigation).toBeTruthy();
      expect(["low", "medium", "high"]).toContain(pitfall.severity);
    }
  });
});

describe("bootstrapProtoTask — 降级路径", () => {
  it("LLM 不可用 → 返回 null", async () => {
    clearProtoTaskCache();
    const llm = makeLLMClient("unavailable");
    const pt = await bootstrapProtoTask("software_project", llm);
    expect(pt).toBeNull();
  });

  it("Malformed JSON → 返回到 null (重试耗尽)", async () => {
    clearProtoTaskCache();
    const llm = makeLLMClient("malformed");
    const pt = await bootstrapProtoTask("software_project", llm);
    expect(pt).toBeNull();
  });

  it("null taskType → 返回 null", async () => {
    clearProtoTaskCache();
    const llm = makeLLMClient("valid");
    const pt = await bootstrapProtoTask("", llm);
    expect(pt).toBeNull();
  });

  it("null llmClient → 返回 null", async () => {
    clearProtoTaskCache();
    const pt = await bootstrapProtoTask("software_project", null as unknown as ProtoTaskLLMClient);
    expect(pt).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// TTL 缓存
// ══════════════════════════════════════════════════════════════════

describe("TTL 缓存", () => {
  it("缓存命中 → 不调用 LLM", async () => {
    clearProtoTaskCache();
    const callCount = { value: 0 };
    const llm = makeLLMClient("valid", callCount);

    // 第一次: 调用 LLM
    const pt1 = await bootstrapProtoTask("cache_test_1", llm);
    expect(pt1).not.toBeNull();
    expect(callCount.value).toBe(1);

    // 第二次: 缓存命中
    const pt2 = await bootstrapProtoTask("cache_test_1", llm);
    expect(pt2).not.toBeNull();
    expect(callCount.value).toBe(1); // 未增加
  });

  it("不同 taskType 使用独立缓存", async () => {
    clearProtoTaskCache();
    const callCount = { value: 0 };
    const llm = makeLLMClient("valid", callCount);

    await bootstrapProtoTask("type_a", llm);
    await bootstrapProtoTask("type_b", llm);
    expect(callCount.value).toBe(2); // 两个不同的 taskType
  });

  it("skipCache=true 绕过缓存", async () => {
    clearProtoTaskCache();
    const callCount = { value: 0 };
    const llm = makeLLMClient("valid", callCount);

    await bootstrapProtoTask("cache_test_2", llm);
    await bootstrapProtoTask("cache_test_2", llm, { skipCache: true });
    expect(callCount.value).toBe(2); // 绕过缓存
  });
});

// ══════════════════════════════════════════════════════════════════
// 缓存操作
// ══════════════════════════════════════════════════════════════════

describe("缓存操作", () => {
  it("getCachedProtoTask 返回缓存值", async () => {
    clearProtoTaskCache();
    const llm = makeLLMClient("valid");

    await bootstrapProtoTask("query_test", llm);
    const cached = getCachedProtoTask("query_test");
    expect(cached).not.toBeNull();
    expect(cached!.taskType).toBe("query_test");
  });

  it("getCachedProtoTask 未缓存返回 null", () => {
    clearProtoTaskCache();
    const cached = getCachedProtoTask("never_cached");
    expect(cached).toBeNull();
  });

  it("invalidateProtoTaskCache 删除特定缓存", async () => {
    clearProtoTaskCache();
    const llm = makeLLMClient("valid");

    await bootstrapProtoTask("inval_test", llm);
    expect(getCachedProtoTask("inval_test")).not.toBeNull();

    invalidateProtoTaskCache("inval_test");
    expect(getCachedProtoTask("inval_test")).toBeNull();
  });

  it("clearProtoTaskCache 清空所有缓存", async () => {
    clearProtoTaskCache();
    const llm = makeLLMClient("valid");

    await bootstrapProtoTask("clear_a", llm);
    await bootstrapProtoTask("clear_b", llm);

    clearProtoTaskCache();
    expect(getCachedProtoTask("clear_a")).toBeNull();
    expect(getCachedProtoTask("clear_b")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// 注入守卫
// ══════════════════════════════════════════════════════════════════

describe("shouldInjectProtoTask", () => {
  it("confidence < 0.5 → 不注入", async () => {
    clearProtoTaskCache();
    const llm = makeLLMClient("valid");
    const pt = await bootstrapProtoTask("guard_test", llm);
    expect(shouldInjectProtoTask(pt)).toBe(false); // 初始 0.2
  });

  it("null → 不注入", () => {
    expect(shouldInjectProtoTask(null)).toBe(false);
  });

  it("confidence >= 0.5 → 注入", () => {
    const pt = {
      taskType: "test",
      confidence: 0.65,
      source: "cumulative" as const,
      typicalPhases: [],
      commonPitfalls: [],
      observations: 5,
      generatedAt: Date.now(),
    };
    expect(shouldInjectProtoTask(pt)).toBe(true);
  });
});
