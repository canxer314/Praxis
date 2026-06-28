/**
 * memory/slots.ts — AgentMemory Slot 名称 + 元数据集中管理
 *
 * 替代散落在 cognitive/constants.ts 和各模块中的硬编码 slot 名称。
 * 架构参考: §11 memory/slots.ts, §9 AgentMemory 存储映射
 */

// ══════════════════════════════════════════════════════════════════
// Slot 名称常量
// ══════════════════════════════════════════════════════════════════

/** 所有 AgentMemory slot 名称的单一真相源 */
export const SLOT_NAMES = {
  COMPETENCY_MODEL: "competency_model",
  AUTONOMY_POLICY: "autonomy_policy",
  TOOL_REGISTRY: "tool_registry",
  TASK_CONTEXT: "task_context",
  TASK_ORCHESTRATION_STATE: "task_orchestration_state",
  TASK_PLAN: "task_plan",
  PROGRESS_LOG: "progress_log",
  PROTO_TASK: "proto_task",
  /** Per-session state — resolved via resolveSlotName("session", sessionId) */
  SESSION_STATE_PREFIX: "praxis_session_state_",
  AUDIT_LOG: "audit_log",
  /** Per-structure state — resolved via resolveSlotName("proto_struct", structureId) */
  PROTO_STRUCT_PREFIX: "proto_struct_",
  SESSION_COUNT: "session_count",
  PROTO_TASK_HISTORY: "proto_task_history",
  COMPETENCY_SNAPSHOTS: "competency_snapshots",
} as const;

export type SlotName = (typeof SLOT_NAMES)[keyof typeof SLOT_NAMES];

// ══════════════════════════════════════════════════════════════════
// Slot 元数据
// ══════════════════════════════════════════════════════════════════

export interface SlotMeta {
  /** Human-readable description of what this slot stores */
  description: string;
  /** Approximate max size in bytes (for quota awareness) */
  maxSize: number;
  /** Current schema version for migration compatibility */
  schemaVersion: number;
}

/** Per-slot metadata keyed by slot name */
export const SLOT_METADATA: Record<string, SlotMeta> = {
  competency_model: {
    description: "8D competency model — tool/domain/task/user/process/action/proto/learning proficiency",
    maxSize: 16_384,
    schemaVersion: 1,
  },
  autonomy_policy: {
    description: "Autonomy decision policy — default actions per risk level",
    maxSize: 4_096,
    schemaVersion: 1,
  },
  tool_registry: {
    description: "Tool registry with proficiency tracking per tool",
    maxSize: 32_768,
    schemaVersion: 1,
  },
  task_context: {
    description: "Current task context — phase, progress, active subtasks, scenarios",
    maxSize: 8_192,
    schemaVersion: 1,
  },
  task_orchestration_state: {
    description: "Two-level nested state machine state (task + subtask)",
    maxSize: 4_096,
    schemaVersion: 1,
  },
  task_plan: {
    description: "Executable plan document derived from ProtoTask + TaskContext",
    maxSize: 32_768,
    schemaVersion: 1,
  },
  progress_log: {
    description: "Progress events collected from after_tool_call + agent_end",
    maxSize: 65_536,
    schemaVersion: 1,
  },
  proto_task: {
    description: "ProtoTask — cross-project task pattern knowledge",
    maxSize: 16_384,
    schemaVersion: 1,
  },
  audit_log: {
    description: "Audit log — constraint violations, structural gaps, architecture findings",
    maxSize: 131_072,
    schemaVersion: 1,
  },
  session_count: {
    description: "Monotonically increasing session counter for maturity derivation",
    maxSize: 16,
    schemaVersion: 1,
  },
  proto_task_history: {
    description: "ProtoTask historical snapshots (90-day rolling window)",
    maxSize: 262_144,
    schemaVersion: 1,
  },
  competency_snapshots: {
    description: "Competency model historical snapshots (90-day rolling window)",
    maxSize: 262_144,
    schemaVersion: 1,
  },
};

// ══════════════════════════════════════════════════════════════════
// 派生映射
// ══════════════════════════════════════════════════════════════════

/** Slot → maxSize lookup (derived from SLOT_METADATA) */
export const SLOT_MAX_SIZES: Record<string, number> = Object.fromEntries(
  Object.entries(SLOT_METADATA).map(([name, meta]) => [name, meta.maxSize]),
);

/** Slot → schemaVersion lookup (derived from SLOT_METADATA) */
export const SLOT_SCHEMA_VERSIONS: Record<string, number> = Object.fromEntries(
  Object.entries(SLOT_METADATA).map(([name, meta]) => [name, meta.schemaVersion]),
);

// ══════════════════════════════════════════════════════════════════
// Slot 名称解析
// ══════════════════════════════════════════════════════════════════

const PREFIX_SLOTS: Record<string, string> = {
  session: SLOT_NAMES.SESSION_STATE_PREFIX,
  proto_struct: SLOT_NAMES.PROTO_STRUCT_PREFIX,
};

/**
 * 从类别 + ID 解析实际 slot 名称。
 *
 * @example resolveSlotName("session", "abc-123") → "praxis_session_state_abc-123"
 * @example resolveSlotName("proto_struct", "ps-clinic-flow") → "proto_struct_ps-clinic-flow"
 */
export function resolveSlotName(category: "session" | "proto_struct", id: string): string {
  const prefix = PREFIX_SLOTS[category];
  if (!prefix) {
    throw new Error(`Unknown slot category: ${category}`);
  }
  return `${prefix}${id}`;
}

/**
 * 获取 slot 的元数据。prefix slot 返回 undefined。
 */
export function getSlotMeta(name: string): SlotMeta | undefined {
  return SLOT_METADATA[name];
}
