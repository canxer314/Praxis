/**
 * TeleologicalJudge 测试 — M5.2
 */
import { describe, it, expect } from "vitest";
import {
  quickCheck,
  updateTeleologicalMapping,
  isProtoSequence,
} from "./teleological-judge";
import type { ProtoSequence, ProtoStructure } from "../cognitive/types";

function makeSequence(overrides: Partial<ProtoSequence> = {}): ProtoSequence {
  return {
    id: "seq-1",
    protoType: "sequence",
    tentativeName: "门诊流程",
    scenarioId: "healthcare",
    confidence: 0.8,
    observationsCount: 10,
    adoptionRate: 0.7,
    lifecycle: "crystallized",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    structure: {
      steps: [
        { position: 1, action: "挂号", agent: "挂号员" },
        { position: 2, action: "分诊", agent: "分诊护士" },
        { position: 3, action: "问诊", agent: "门诊医生" },
      ],
    },
    function: {
      purpose: "建立医患关系并完成初步诊断",
      precondition: ["患者到达"],
      postcondition: ["建立法律关系", "确定优先级", "采集病史"],
      failureModes: ["未挂号直接就诊"],
    },
    teleologicalMapping: [
      { stepIndex: 0, contributesTo: "建立法律关系", criticality: "essential" },
      { stepIndex: 1, contributesTo: "确定优先级", criticality: "essential" },
    ],
    ...overrides,
  };
}

describe("quickCheck", () => {
  it("postcondition 关键词全覆盖 → 替代实现", () => {
    const seq = makeSequence();
    // 纠正文本包含所有 postcondition 关键词
    const result = quickCheck(seq, "自助挂号机仍建立法律关系，在线预检分诊确定优先级，采集病史不变");
    expect(result.isAltImpl).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("postcondition 关键词缺失 → 不是替代实现", () => {
    const seq = makeSequence();
    const result = quickCheck(seq, "问了三个问题就开药，没有体检");
    expect(result.isAltImpl).toBe(false);
  });

  it("无 postcondition → 默认真错误", () => {
    const seq = makeSequence({
      function: { purpose: "test", precondition: [], postcondition: [], failureModes: [] },
    });
    const result = quickCheck(seq, "任何纠正文本");
    expect(result.isAltImpl).toBe(false);
    expect(result.confidence).toBe(0.3);
  });

  it("部分覆盖 → 不达阈值", () => {
    const seq = makeSequence();
    // 只有"确定优先级"部分命中，覆盖率 < 70%
    const result = quickCheck(seq, "分诊改为自动分诊系统，确定优先级更快");
    expect(result.confidence).toBeLessThan(0.7);
  });
});

describe("updateTeleologicalMapping", () => {
  it("替代实现 → 保留原有映射, 添加新目的", () => {
    const seq = makeSequence();
    const judgment = {
      isAlternativeImpl: true,
      preservedPurposes: ["建立法律关系", "确定优先级"],
      lostPurposes: [],
      newPurposes: ["自动化处理"],
      confidence: 0.85,
    };
    const updated = updateTeleologicalMapping(seq, judgment);
    expect(updated.teleologicalMapping.length).toBe(3);
    // 原有 2 条 + 1 新目的
    expect(updated.teleologicalMapping.some(m => m.contributesTo === "自动化处理")).toBe(true);
  });

  it("丢失目的 → 移除对应映射", () => {
    const seq = makeSequence();
    const judgment = {
      isAlternativeImpl: false,
      preservedPurposes: [],
      lostPurposes: ["建立法律关系"],
      newPurposes: [],
      confidence: 0.7,
    };
    const updated = updateTeleologicalMapping(seq, judgment);
    expect(updated.teleologicalMapping.every(m => m.contributesTo !== "建立法律关系")).toBe(true);
    // "确定优先级" 的映射应保留
    expect(updated.teleologicalMapping.some(m => m.contributesTo === "确定优先级")).toBe(true);
  });
});

describe("isProtoSequence", () => {
  it("sequence 类型 → true", () => {
    const seq = makeSequence();
    expect(isProtoSequence(seq as ProtoStructure)).toBe(true);
  });

  it("非 sequence 类型 → false", () => {
    const role: ProtoStructure = {
      id: "r1",
      protoType: "role",
      tentativeName: "Doctor",
      scenarioId: "healthcare",
      confidence: 0.8,
      observationsCount: 5,
      adoptionRate: 0.5,
      lifecycle: "crystallized",
      relations: [],
      versionChain: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(isProtoSequence(role)).toBe(false);
  });
});
