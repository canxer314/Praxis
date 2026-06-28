/**
 * attention-telemetry 测试
 *
 * 覆盖: 标记解析、注意力更新、僵尸检测、低估检测、报告生成
 */

import { describe, it, expect } from "vitest";
import {
  extractUsageMarkers,
  updateAttention,
  detectZombies,
  detectUnderestimated,
  generateTelemetryReport,
  formatTelemetryReport,
} from "./attention-telemetry";
import type { AttentionRecord } from "./attention-telemetry";

// ══════════════════════════════════════════════════════════════════
// extractUsageMarkers
// ══════════════════════════════════════════════════════════════════

describe("extractUsageMarkers", () => {
  it("解析单个 [STRUCTURE_USED: id] 标记", () => {
    const output = "我使用了 [STRUCTURE_USED: proto-1] 来完成任务";
    const ids = extractUsageMarkers(output);
    expect(ids).toEqual(["proto-1"]);
  });

  it("解析多个标记（去重）", () => {
    const output = `
      首先参考 [STRUCTURE_USED: proto-1]
      然后应用 [STRUCTURE_USED: proto-2]
      再次确认 [STRUCTURE_USED: proto-1]
    `;
    const ids = extractUsageMarkers(output);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("proto-1");
    expect(ids).toContain("proto-2");
  });

  it("无标记 → 空数组", () => {
    expect(extractUsageMarkers("普通文本无标记")).toEqual([]);
  });

  it("空字符串 → 空数组", () => {
    expect(extractUsageMarkers("")).toEqual([]);
  });

  it("标记中 ID 含空格被 trim", () => {
    const output = "[STRUCTURE_USED:  proto-1  ]";
    const ids = extractUsageMarkers(output);
    expect(ids).toEqual(["proto-1"]);
  });

  it("大小写不敏感", () => {
    const output = "[structure_used: proto-1]";
    const ids = extractUsageMarkers(output);
    expect(ids).toEqual(["proto-1"]);
  });
});

// ══════════════════════════════════════════════════════════════════
// updateAttention
// ══════════════════════════════════════════════════════════════════

describe("updateAttention", () => {
  it("首次追踪 — 创建新记录", () => {
    const prev = new Map<string, AttentionRecord>();
    const next = updateAttention(prev, ["ps-1"], ["ps-1", "ps-2"], 1000);

    expect(next.size).toBe(2);
    expect(next.get("ps-1")!.useCount).toBe(1);
    expect(next.get("ps-1")!.injectionCount).toBe(1);
    expect(next.get("ps-1")!.adoptionRate).toBe(1.0);
    expect(next.get("ps-2")!.injectionCount).toBe(1);
    expect(next.get("ps-2")!.useCount).toBe(0);
    expect(next.get("ps-2")!.adoptionRate).toBe(0);
  });

  it("累积追踪 — 多 session 累加", () => {
    const prev = new Map<string, AttentionRecord>();
    const s1 = updateAttention(prev, ["ps-1"], ["ps-1"], 1000);
    const s2 = updateAttention(s1, ["ps-1"], ["ps-1"], 2000);
    const s3 = updateAttention(s2, [], ["ps-1"], 3000); // 注入但未使用

    const record = s3.get("ps-1")!;
    expect(record.injectionCount).toBe(3);
    expect(record.useCount).toBe(2);
    expect(record.adoptionRate).toBeCloseTo(2 / 3);
    expect(record.lastUsedAt).toBe(2000); // 最后一次使用是 session 2
  });

  it("通过 recall 使用但未注入的结构", () => {
    const prev = new Map<string, AttentionRecord>();
    const next = updateAttention(prev, ["recalled-1"], [], 1000);

    const record = next.get("recalled-1")!;
    expect(record.useCount).toBe(1);
    expect(record.injectionCount).toBe(0);
    expect(record.adoptionRate).toBe(1.0); // 未注入但被使用
  });
});

// ══════════════════════════════════════════════════════════════════
// detectZombies
// ══════════════════════════════════════════════════════════════════

describe("detectZombies", () => {
  it("高置信度 + 低采纳率 → 僵尸", () => {
    const records = new Map<string, AttentionRecord>();
    records.set("ps-1", {
      structureId: "ps-1", useCount: 0, injectionCount: 5,
      adoptionRate: 0, lastUsedAt: null,
    });
    const confidences = new Map([["ps-1", 0.9]]);

    const zombies = detectZombies(records, confidences);
    expect(zombies).toHaveLength(1);
    expect(zombies[0].structureId).toBe("ps-1");
    expect(zombies[0].adoptionRate).toBe(0);
  });

  it("高置信度 + 高采纳率 → 非僵尸", () => {
    const records = new Map<string, AttentionRecord>();
    records.set("ps-1", {
      structureId: "ps-1", useCount: 8, injectionCount: 10,
      adoptionRate: 0.8, lastUsedAt: 1000,
    });
    const confidences = new Map([["ps-1", 0.9]]);

    expect(detectZombies(records, confidences)).toHaveLength(0);
  });

  it("注入次数不足 → 跳过检测", () => {
    const records = new Map<string, AttentionRecord>();
    records.set("ps-1", {
      structureId: "ps-1", useCount: 0, injectionCount: 1,
      adoptionRate: 0, lastUsedAt: null,
    });
    const confidences = new Map([["ps-1", 0.9]]);

    // injectionCount=1 < MIN_INJECTIONS_FOR_DETECTION=3
    expect(detectZombies(records, confidences)).toHaveLength(0);
  });

  it("无置信度数据 → 跳过", () => {
    const records = new Map<string, AttentionRecord>();
    records.set("ps-1", {
      structureId: "ps-1", useCount: 0, injectionCount: 5,
      adoptionRate: 0, lastUsedAt: null,
    });

    expect(detectZombies(records, new Map())).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// detectUnderestimated
// ══════════════════════════════════════════════════════════════════

describe("detectUnderestimated", () => {
  it("低置信度 + 高采纳率 → 低估", () => {
    const records = new Map<string, AttentionRecord>();
    records.set("ps-1", {
      structureId: "ps-1", useCount: 8, injectionCount: 10,
      adoptionRate: 0.8, lastUsedAt: 1000,
    });
    const confidences = new Map([["ps-1", 0.3]]);

    const underestimated = detectUnderestimated(records, confidences);
    expect(underestimated).toHaveLength(1);
    expect(underestimated[0].structureId).toBe("ps-1");
    // suggestedConfidence = 0.3 × 0.3 + 0.8 × 0.7 = 0.65
    expect(underestimated[0].suggestedConfidence).toBeCloseTo(0.65);
  });

  it("低置信度 + 低采纳率 → 非低估", () => {
    const records = new Map<string, AttentionRecord>();
    records.set("ps-1", {
      structureId: "ps-1", useCount: 1, injectionCount: 10,
      adoptionRate: 0.1, lastUsedAt: 1000,
    });
    const confidences = new Map([["ps-1", 0.3]]);

    expect(detectUnderestimated(records, confidences)).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// generateTelemetryReport + formatTelemetryReport
// ══════════════════════════════════════════════════════════════════

describe("generateTelemetryReport", () => {
  it("生成完整报告", () => {
    const records = new Map<string, AttentionRecord>();
    records.set("ps-zombie", {
      structureId: "ps-zombie", useCount: 0, injectionCount: 5,
      adoptionRate: 0, lastUsedAt: null,
    });
    records.set("ps-under", {
      structureId: "ps-under", useCount: 8, injectionCount: 10,
      adoptionRate: 0.8, lastUsedAt: 1000,
    });
    const confidences = new Map([
      ["ps-zombie", 0.9],
      ["ps-under", 0.3],
    ]);

    const report = generateTelemetryReport(records, confidences);

    expect(report.totalTracked).toBe(2);
    expect(report.zombies).toHaveLength(1);
    expect(report.underestimated).toHaveLength(1);
  });

  it("空遥测 → 空报告", () => {
    const report = generateTelemetryReport(new Map(), new Map());
    expect(report.totalTracked).toBe(0);
    expect(report.zombies).toHaveLength(0);
  });
});

describe("formatTelemetryReport", () => {
  it("格式化含异常的报告", () => {
    const records = new Map<string, AttentionRecord>();
    records.set("ps-zombie", {
      structureId: "ps-zombie", useCount: 0, injectionCount: 5,
      adoptionRate: 0, lastUsedAt: null,
    });
    const confidences = new Map([["ps-zombie", 0.9]]);
    const report = generateTelemetryReport(records, confidences);

    const text = formatTelemetryReport(report);
    expect(text).toContain("注意力遥测报告");
    expect(text).toContain("僵尸结构");
    expect(text).toContain("ps-zombie");
  });

  it("格式化无异常的报告", () => {
    const report = generateTelemetryReport(new Map(), new Map());
    const text = formatTelemetryReport(report);
    expect(text).toContain("无异常检测");
  });
});
