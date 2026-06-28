/**
 * context-organizer 测试
 *
 * 覆盖: Tier A/B/C 分层、权重排序、压力压缩、成熟度粒度
 */

import { describe, it, expect } from "vitest";
import { organizeContext } from "./context-organizer";
import type { ContextStructure, OrganizeContextInput } from "./context-organizer";
import type { ScenarioMatch } from "../cognitive/types";

// ---- 测试辅助 ----

function makeStructure(overrides: Partial<ContextStructure> = {}): ContextStructure {
  return {
    id: overrides.id ?? "struct-1",
    tentativeName: overrides.tentativeName ?? "测试结构",
    protoType: overrides.protoType ?? "concept",
    confidence: overrides.confidence ?? 0.5,
    scenarioId: overrides.scenarioId ?? "default",
    summary: overrides.summary ?? "这是一个测试结构",
    adoptionRate: overrides.adoptionRate,
  };
}

function makeScenario(scenarioId: string, confidence = 0.8): ScenarioMatch {
  return { scenarioId, confidence, source: "llm_inference" };
}

// 10 个结构，横跨 3 个场景
function makeTenStructures(): ContextStructure[] {
  return [
    makeStructure({ id: "s1", tentativeName: "门诊流程", protoType: "sequence", scenarioId: "medical", confidence: 0.9, summary: "门诊挂号→分诊→就诊→缴费→取药" }),
    makeStructure({ id: "s2", tentativeName: "住院流程", protoType: "sequence", scenarioId: "medical", confidence: 0.85, summary: "入院登记→病房分配→日常查房→出院结算" }),
    makeStructure({ id: "s3", tentativeName: "医生角色", protoType: "role", scenarioId: "medical", confidence: 0.8, summary: "负责诊断和开具处方" }),
    makeStructure({ id: "s4", tentativeName: "医疗数据隐私", protoType: "constraint", scenarioId: "medical", confidence: 0.95, summary: "患者数据不得在非加密通道传输" }),
    makeStructure({ id: "s5", tentativeName: "API 设计规范", protoType: "constraint", scenarioId: "api_design", confidence: 0.9, summary: "RESTful 命名约定和版本控制" }),
    makeStructure({ id: "s6", tentativeName: "数据库迁移", protoType: "sequence", scenarioId: "api_design", confidence: 0.7, summary: "generate→review→apply→verify" }),
    makeStructure({ id: "s7", tentativeName: "Code Review 流程", protoType: "sequence", scenarioId: "code_review", confidence: 0.85, summary: "diff→lint→review→approve→merge" }),
    makeStructure({ id: "s8", tentativeName: "审查者角色", protoType: "role", scenarioId: "code_review", confidence: 0.75, summary: "检查代码质量和安全性" }),
    makeStructure({ id: "s9", tentativeName: "部署约束", protoType: "constraint", scenarioId: "api_design", confidence: 0.6, summary: "生产部署需经过 Staging 验证" }),
    makeStructure({ id: "s10", tentativeName: "通用编码概念", protoType: "concept", scenarioId: "general", confidence: 0.4, summary: "适用于所有场景的基础编码原则" }),
  ];
}

// ══════════════════════════════════════════════════════════════════
// Tier A/B/C 分层
// ══════════════════════════════════════════════════════════════════

describe("organizeContext — Tier A/B/C 分层", () => {
  it("10 结构 3 场景 → Tier A 全部与当前场景匹配", () => {
    const structures = makeTenStructures();
    const scenarios = [makeScenario("medical", 0.9)];

    const result = organizeContext({ structures, scenarios });

    // 与 medical 场景匹配的结构应该在 Tier A
    const medicalIds = ["s1", "s2", "s3", "s4"];
    for (const item of result.tierA.items) {
      expect(medicalIds).toContain(item.id);
    }
    expect(result.tierA.items.length).toBeGreaterThanOrEqual(4);
  });

  it("所有结构正确分配到三个层", () => {
    const structures = makeTenStructures();
    const scenarios = [makeScenario("medical", 0.9)];

    const result = organizeContext({ structures, scenarios });

    // 三个层的条目总和应等于输入总数
    const totalItems =
      result.tierA.items.length +
      result.tierB.items.length +
      result.tierC.items.length;

    expect(totalItems).toBe(10);
  });

  it("Tier A 按分数降序排列", () => {
    const structures = makeTenStructures();
    const scenarios = [makeScenario("medical", 0.9)];

    const result = organizeContext({ structures, scenarios });

    // Tier A 内的结构应按 confidence 降序（在场景匹配前提下）
    for (let i = 1; i < result.tierA.items.length; i++) {
      // 同场景的结构按 confidence 排序
      const prev = result.tierA.items[i - 1];
      const curr = result.tierA.items[i];
      if (prev.scenarioId === curr.scenarioId) {
        expect(prev.confidence).toBeGreaterThanOrEqual(curr.confidence);
      }
    }
  });

  it("无场景信息时仍然分层 (中性分数)", () => {
    const structures = makeTenStructures();

    const result = organizeContext({ structures, scenarios: [] });

    // 无场景时给 sceneMatch = 0.3，taskRelevance = 0.3，signal ≈ confidence
    // 高分结构仍应进入 Tier A
    const totalItems =
      result.tierA.items.length +
      result.tierB.items.length +
      result.tierC.items.length;
    expect(totalItems).toBe(10);
    // 不应崩溃
    expect(result.meta.pressure).toBe("normal");
  });

  it("空结构列表 → 所有 Tier 为空", () => {
    const result = organizeContext({ structures: [], scenarios: [] });

    expect(result.tierA.items).toHaveLength(0);
    expect(result.tierB.items).toHaveLength(0);
    expect(result.tierC.items).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// 权重排序
// ══════════════════════════════════════════════════════════════════

describe("organizeContext — 权重排序验证", () => {
  it("场景匹配的结构得分远高于不匹配的", () => {
    const structures = [
      makeStructure({ id: "matched", scenarioId: "medical", confidence: 0.5 }),
      makeStructure({ id: "unmatched", scenarioId: "other", confidence: 0.9 }),
    ];
    const scenarios = [makeScenario("medical", 0.9)];

    const result = organizeContext({ structures, scenarios });

    // matched 应在 Tier A，unmatched 在 Tier B 或 C
    const tierAIds = result.tierA.items.map((i) => i.id);
    expect(tierAIds).toContain("matched");
    expect(tierAIds).not.toContain("unmatched");
  });

  it("TaskContext.relevantScenarios 提升任务相关结构的分数", () => {
    const structures = [
      makeStructure({ id: "task-related", scenarioId: "api_design", confidence: 0.5 }),
      makeStructure({ id: "unrelated", scenarioId: "other", confidence: 0.9 }),
    ];
    const taskContext = { relevantScenarios: ["api_design"] };

    const result = organizeContext({ structures, scenarios: [], taskContext });

    // task-related 应排在前面
    const allIds = [
      ...result.tierA.items,
      ...result.tierB.items,
      ...result.tierC.items,
    ].map((i) => i.id);
    const taskIdx = allIds.indexOf("task-related");
    const unrelatedIdx = allIds.indexOf("unrelated");
    expect(taskIdx).toBeLessThan(unrelatedIdx);
  });

  it("高 confidence 的结构在同等场景匹配下排名更靠前", () => {
    const structures = [
      makeStructure({ id: "low-conf", scenarioId: "medical", confidence: 0.3 }),
      makeStructure({ id: "high-conf", scenarioId: "medical", confidence: 0.9 }),
    ];
    const scenarios = [makeScenario("medical", 0.8)];

    const result = organizeContext({ structures, scenarios });

    const tierAIds = result.tierA.items.map((i) => i.id);
    expect(tierAIds[0]).toBe("high-conf");
    expect(tierAIds[1]).toBe("low-conf");
  });
});

// ══════════════════════════════════════════════════════════════════
// 成熟度驱动语义粒度
// ══════════════════════════════════════════════════════════════════

describe("organizeContext — 认知成熟度", () => {
  const structures = [makeStructure({
    id: "s1",
    tentativeName: "测试流程",
    protoType: "sequence",
    scenarioId: "medical",
    confidence: 0.9,
    summary: "步骤A→步骤B→步骤C→步骤D→步骤E",
  })];
  const scenarios = [makeScenario("medical", 0.9)];

  it("Expert 比 Novice 输出更详细", () => {
    const expertResult = organizeContext({ structures, scenarios, maturity: "expert" });
    const noviceResult = organizeContext({ structures, scenarios, maturity: "novice" });

    const expertDesc = expertResult.tierA.items[0]?.description ?? "";
    const noviceDesc = noviceResult.tierA.items[0]?.description ?? "";

    // Expert 应包含更多细节（confidence 数值、id 等）
    expect(expertDesc.length).toBeGreaterThanOrEqual(noviceDesc.length);
    // Expert 应包含 confidence 百分比
    expect(expertDesc).toMatch(/90%/);
  });

  it("Novice 描述更简洁", () => {
    const result = organizeContext({ structures, scenarios, maturity: "novice" });

    const desc = result.tierA.items[0]?.description ?? "";
    // Novice 不应包含 id 引用（那是 Expert 级别的细节）
    expect(desc).not.toContain("id:");
  });

  it("默认成熟度为 competent", () => {
    const result = organizeContext({ structures, scenarios });

    expect(result.meta.maturity).toBe("competent");
  });
});

// ══════════════════════════════════════════════════════════════════
// 压力级别压缩
// ══════════════════════════════════════════════════════════════════

describe("organizeContext — 压力级别压缩", () => {
  const structures = makeTenStructures();
  const scenarios = [makeScenario("medical", 0.9)];

  it("Normal 压力 → 不截断任何 Tier", () => {
    const result = organizeContext({ structures, scenarios, pressure: "normal" });

    // Normal 下不应有截断 — 每个 Tier 保持其自然分配
    expect(result.tierA.items.length).toBeGreaterThanOrEqual(4);
    // Tier B/C 的数量取决于分数分布，但总和应等于输入数
    const total = result.tierA.items.length + result.tierB.items.length + result.tierC.items.length;
    expect(total).toBe(10);
  });

  it("Elevated 压力 → Tier C 移除", () => {
    const elevatedResult = organizeContext({ structures, scenarios, pressure: "elevated" });

    // Tier C 应被移除（Elevated 下 Tier C retention = 0）
    expect(elevatedResult.tierC.items.length).toBe(0);
    // Tier A 不受影响
    expect(elevatedResult.tierA.items.length).toBeGreaterThanOrEqual(4);
  });

  it("High 压力 → 仅 Tier A 保留 (Tier B 极度压缩)", () => {
    const result = organizeContext({ structures, scenarios, pressure: "high" });

    // Tier A 不变
    expect(result.tierA.items.length).toBeGreaterThanOrEqual(4);
    // Tier B 被大幅压缩
    expect(result.tierB.items.length).toBeLessThanOrEqual(2);
    // Tier C 移除
    expect(result.tierC.items.length).toBe(0);
  });

  it("Critical 压力 → 仅 Tier A + Tier B 完全移除", () => {
    const result = organizeContext({ structures, scenarios, pressure: "critical" });

    // Tier A 保留
    expect(result.tierA.items.length).toBeGreaterThanOrEqual(4);
    // Tier B 和 Tier C 移除
    expect(result.tierB.items.length).toBe(0);
    expect(result.tierC.items.length).toBe(0);
  });

  it("默认压力为 normal", () => {
    const result = organizeContext({ structures, scenarios });

    expect(result.meta.pressure).toBe("normal");
  });
});

// ══════════════════════════════════════════════════════════════════
// Tier 描述格式
// ══════════════════════════════════════════════════════════════════

describe("organizeContext — Tier 描述格式", () => {
  const structures = [makeStructure({
    id: "s1",
    tentativeName: "测试序列",
    protoType: "sequence",
    scenarioId: "test",
    confidence: 0.85,
    summary: "第一步→第二步→第三步→第四步→第五步→第六步→第七步→第八步→第九步→第十步",
  })];
  const scenarios = [makeScenario("test", 0.9)];

  it("Tier A 包含完整摘要 + ProtoType 中文标签", () => {
    const result = organizeContext({ structures, scenarios });
    const desc = result.tierA.items[0]?.description ?? "";

    expect(desc).toContain("[流程]");
    expect(desc).toContain("测试序列");
  });

  it("Tier B 包含引用 ID", () => {
    // 构造一个分数落在 Tier B 范围的结构 (score 0.2-0.5)
    // sceneMatch = 0 (前缀不匹配), taskRelevance = 0.3, signal ≈ 0.8
    // score = 0*0.55 + 0.3*0.35 + 0.8*0.10 = 0.105 + 0.08 = 0.185 — 还在 Tier C
    // 需要更高 taskRelevance: 使用 taskContext 提升
    const struct = makeStructure({
      id: "s-b",
      tentativeName: "部分相关结构",
      protoType: "concept",
      scenarioId: "related_api",
      confidence: 0.8,
      summary: "这是一个部分相关结构",
    });

    const result = organizeContext({
      structures: [struct],
      scenarios: [makeScenario("test", 0.9)],
      taskContext: { relevantScenarios: ["related_api"] },
    });

    const tierBItem = result.tierB.items[0];
    // 场景不匹配 (0), 任务匹配 (1.0), 信号高 (0.8)
    // score = 0 + 0.35 + 0.08 = 0.43 → Tier B ✓

    expect(tierBItem).toBeDefined();
    expect(tierBItem.description).toContain("ref:");
    expect(tierBItem.description).toContain("s-b");
  });

  it("Tier C 仅包含名称 + 一行描述", () => {
    const lowConfStruct = makeStructure({
      id: "s-c",
      tentativeName: "远相关结构",
      protoType: "concept",
      scenarioId: "far_away",
      confidence: 0.1,
      summary: "这是一个远相关结构的长描述文本",
    });

    const result = organizeContext({ structures: [lowConfStruct], scenarios });
    const tierCItem = result.tierC.items[0];

    if (tierCItem) {
      // Tier C 应简洁 — 不含换行
      expect(tierCItem.description).not.toContain("\n");
    }
  });

  it("每个 Tier 报告 token 估算", () => {
    const result = organizeContext({ structures, scenarios });

    expect(result.tierA.totalTokens).toBeGreaterThan(0);
    expect(typeof result.tierB.totalTokens).toBe("number");
    expect(typeof result.tierC.totalTokens).toBe("number");
  });
});

// ══════════════════════════════════════════════════════════════════
// 元信息
// ══════════════════════════════════════════════════════════════════

describe("organizeContext — 元信息", () => {
  it("报告 totalStructures", () => {
    const structures = makeTenStructures();

    const result = organizeContext({ structures, scenarios: [] });

    expect(result.meta.totalStructures).toBe(10);
  });

  it("报告使用的压力级别和成熟度", () => {
    const result = organizeContext({
      structures: [],
      scenarios: [],
      pressure: "high",
      maturity: "expert",
    });

    expect(result.meta.pressure).toBe("high");
    expect(result.meta.maturity).toBe("expert");
  });
});
