/**
 * memory/slots.ts — Slot 名称常量测试
 *
 * 架构参考: §11 memory/slots.ts, §9 AgentMemory 存储映射
 */

import { describe, it, expect } from "vitest";
import {
  SLOT_NAMES,
  SLOT_METADATA,
  SLOT_MAX_SIZES,
  SLOT_SCHEMA_VERSIONS,
  resolveSlotName,
  getSlotMeta,
  type SlotName,
} from "./slots";

describe("SLOT_NAMES", () => {
  it("defines all required AgentMemory slot names", () => {
    expect(SLOT_NAMES.COMPETENCY_MODEL).toBe("competency_model");
    expect(SLOT_NAMES.AUTONOMY_POLICY).toBe("autonomy_policy");
    expect(SLOT_NAMES.TOOL_REGISTRY).toBe("tool_registry");
    expect(SLOT_NAMES.TASK_CONTEXT).toBe("task_context");
    expect(SLOT_NAMES.TASK_ORCHESTRATION_STATE).toBe("task_orchestration_state");
    expect(SLOT_NAMES.TASK_PLAN).toBe("task_plan");
    expect(SLOT_NAMES.PROGRESS_LOG).toBe("progress_log");
    expect(SLOT_NAMES.PROTO_TASK).toBe("proto_task");
    expect(SLOT_NAMES.SESSION_STATE_PREFIX).toBe("praxis_session_state_");
    expect(SLOT_NAMES.AUDIT_LOG).toBe("audit_log");
    expect(SLOT_NAMES.PROTO_STRUCT_PREFIX).toBe("proto_struct_");
    expect(SLOT_NAMES.SESSION_COUNT).toBe("session_count");
    expect(SLOT_NAMES.PROTO_TASK_HISTORY).toBe("proto_task_history");
    expect(SLOT_NAMES.COMPETENCY_SNAPSHOTS).toBe("competency_snapshots");
  });

  it("has no duplicate values", () => {
    const values = Object.values(SLOT_NAMES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("all values are non-empty strings", () => {
    for (const [key, value] of Object.entries(SLOT_NAMES)) {
      expect(value, `${key} should be non-empty`).toBeTruthy();
      expect(typeof value, `${key} should be string`).toBe("string");
    }
  });
});

describe("SLOT_METADATA", () => {
  it("has metadata for every slot name", () => {
    for (const name of Object.values(SLOT_NAMES)) {
      // PREFIX slots don't need metadata (they're templates)
      if (name.endsWith("_")) continue;
      expect(SLOT_METADATA[name], `missing metadata for ${name}`).toBeTruthy();
    }
  });

  it("provides description, maxSize, and schemaVersion for each slot", () => {
    const meta = SLOT_METADATA["competency_model"];
    expect(meta.description).toBeTruthy();
    expect(meta.maxSize).toBeGreaterThan(0);
    expect(meta.schemaVersion).toBeGreaterThan(0);
  });

  it("session_count has a reasonable maxSize", () => {
    expect(SLOT_METADATA["session_count"].maxSize).toBeGreaterThanOrEqual(8);
  });
});

describe("SLOT_MAX_SIZES", () => {
  it("exposes max sizes for every slot", () => {
    for (const name of Object.values(SLOT_NAMES)) {
      if (name.endsWith("_")) continue;
      expect(SLOT_MAX_SIZES[name], `missing maxSize for ${name}`).toBeGreaterThan(0);
    }
  });
});

describe("SLOT_SCHEMA_VERSIONS", () => {
  it("exposes schema versions for every slot", () => {
    for (const name of Object.values(SLOT_NAMES)) {
      if (name.endsWith("_")) continue;
      expect(SLOT_SCHEMA_VERSIONS[name], `missing schemaVersion for ${name}`).toBeGreaterThan(0);
    }
  });
});

describe("resolveSlotName", () => {
  it("resolves session state slot name from session ID", () => {
    const result = resolveSlotName("session", "abc-123");
    expect(result).toBe("praxis_session_state_abc-123");
  });

  it("resolves proto structure slot name from structure ID", () => {
    const result = resolveSlotName("proto_struct", "ps-clinic-flow");
    expect(result).toBe("proto_struct_ps-clinic-flow");
  });

  it("throws for unknown slot categories", () => {
    expect(() => resolveSlotName("unknown" as SlotName, "x")).toThrow();
  });
});

describe("getSlotMeta", () => {
  it("returns metadata for a known slot", () => {
    const meta = getSlotMeta("competency_model");
    expect(meta).toBeTruthy();
    expect(meta!.description).toBeTruthy();
  });

  it("returns undefined for unknown slot", () => {
    expect(getSlotMeta("nonexistent_slot")).toBeUndefined();
  });

  it("returns undefined for prefix-only slots", () => {
    expect(getSlotMeta("praxis_session_state_")).toBeUndefined();
  });
});
