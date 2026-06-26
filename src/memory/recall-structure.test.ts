/**
 * recall-structure 测试
 *
 * 覆盖: AgentMemory 召回、local-cache 降级、索引构建、格式化
 */

import { describe, it, expect, vi } from "vitest";
import {
  recallStructure,
  buildStructureIndex,
  formatStructureIndex,
  formatRecalledStructure,
} from "./recall-structure";
import type { M0Deps } from "../m0-deps";
import type { Result } from "../platform-adapter";

function makeDeps(overrides: Partial<M0Deps> = {}): M0Deps {
  return {
    memory: {
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null } as Result<unknown>),
      setSlot: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      smartSearch: vi.fn().mockResolvedValue({ ok: true, value: [] } as Result<unknown[]>),
      saveLesson: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      isAvailable: vi.fn().mockResolvedValue(true),
    },
    cache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    },
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// recallStructure — AgentMemory 路径
// ══════════════════════════════════════════════════════════════════

describe("recallStructure — AgentMemory", () => {
  it("按名称精确召回结构", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { id: "ps-1", tentativeName: "门诊流程", protoType: "sequence", confidence: 0.9, scenarioId: "medical", structure: { steps: [{ action: "挂号" }, { action: "就诊" }] } },
      ],
    } as Result<unknown[]>);

    const result = await recallStructure(deps, "门诊流程");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("ps-1");
    expect(result!.tentativeName).toBe("门诊流程");
    expect(result!.protoType).toBe("sequence");
    expect(result!.summary).toBe("挂号 → 就诊");
  });

  it("按 ID 召回结构（模糊匹配）", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { id: "ps-2", tentativeName: "API 设计规范", protoType: "constraint", confidence: 0.8, severity: "warn" },
      ],
    } as Result<unknown[]>);

    const result = await recallStructure(deps, "ps-2");

    expect(result).not.toBeNull();
    expect(result!.tentativeName).toBe("API 设计规范");
    expect(result!.summary).toContain("warn");
  });

  it("无匹配 → 返回 null", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockResolvedValue({
      ok: true,
      value: [],
    } as Result<unknown[]>);

    const result = await recallStructure(deps, "不存在的结构");

    expect(result).toBeNull();
  });

  it("AgentMemory 不可用 → 降级到 local-cache", async () => {
    const deps = makeDeps();
    deps.memory.isAvailable = vi.fn().mockResolvedValue(false);
    deps.cache.list = vi.fn().mockReturnValue([
      {
        key: "proto_structure_ps-1",
        value: { id: "ps-1", tentativeName: "缓存中的结构", protoType: "concept", confidence: 0.5 },
        writtenAt: Date.now(),
      },
    ]);

    const result = await recallStructure(deps, "缓存中的结构");

    expect(result).not.toBeNull();
    expect(result!.tentativeName).toBe("缓存中的结构");
  });

  it("AgentMemory 搜索抛出异常 → 安全返回 null", async () => {
    const deps = makeDeps();
    deps.memory.smartSearch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await recallStructure(deps, "anything");

    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// buildStructureIndex
// ══════════════════════════════════════════════════════════════════

describe("buildStructureIndex", () => {
  it("从 Tier items 构建轻量索引", () => {
    const items = [
      { id: "ps-1", tentativeName: "门诊流程", protoType: "sequence", description: "挂号→分诊→就诊→缴费→取药" },
      { id: "ps-2", tentativeName: "医疗数据隐私", protoType: "constraint", description: "[block] 患者数据不得在非加密通道传输" },
    ];

    const index = buildStructureIndex(items);

    expect(index).toHaveLength(2);
    expect(index[0].id).toBe("ps-1");
    expect(index[0].protoType).toBe("sequence");
    expect(index[0].hint).toBe("挂号→分诊→就诊→缴费→取药");
  });

  it("空列表 → 空索引", () => {
    expect(buildStructureIndex([])).toEqual([]);
  });

  it("多行描述只取第一行作 hint", () => {
    const items = [
      { id: "ps-1", tentativeName: "测试", protoType: "concept", description: "第一行描述\n第二行细节\n第三行" },
    ];

    const index = buildStructureIndex(items);

    expect(index[0].hint).toBe("第一行描述");
  });
});

// ══════════════════════════════════════════════════════════════════
// 格式化
// ══════════════════════════════════════════════════════════════════

describe("formatStructureIndex", () => {
  it("格式化索引为 LLM 可读文本", () => {
    const index = [
      { id: "ps-1", tentativeName: "门诊流程", protoType: "sequence", hint: "挂号→分诊→就诊" },
    ];

    const text = formatStructureIndex(index);

    expect(text).toContain("ProtoStructure 索引");
    expect(text).toContain("Critical 模式");
    expect(text).toContain("recall_structure");
    expect(text).toContain("[流程]");
    expect(text).toContain("门诊流程");
  });

  it("空索引返回空字符串", () => {
    expect(formatStructureIndex([])).toBe("");
  });
});

describe("formatRecalledStructure", () => {
  it("格式化召回结构为 LLM 可读文本", () => {
    const struct = {
      id: "ps-1",
      tentativeName: "门诊流程",
      protoType: "sequence",
      confidence: 0.9,
      scenarioId: "medical",
      summary: "挂号→就诊→缴费",
      raw: {},
    };

    const text = formatRecalledStructure(struct);

    expect(text).toContain("结构召回: 门诊流程");
    expect(text).toContain("[流程]");
    expect(text).toContain("90%");
    expect(text).toContain("medical");
    expect(text).toContain("ps-1");
  });
});
