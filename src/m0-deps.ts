/**
 * M0Deps — M0 标准依赖注入接口
 *
 * 所有 M0 事件处理器共享此依赖集。每个 Agent 运行时的适配器
 * 负责组装 M0Deps 实例（注入真实的 AgentMemory 客户端、localCache 等）。
 * 测试时替换为 mock 实现。
 */

import type { Result } from "./platform-adapter";
import type { AutonomyPolicy, PendingSignal } from "./cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 记忆子系统
// ══════════════════════════════════════════════════════════════════

export interface MemorySubsystem {
  /** 读取 slot */
  getSlot(name: string): Promise<Result<unknown>>;
  /** 写入 slot */
  setSlot(name: string, value: unknown): Promise<Result<void>>;
  /** 语义搜索 */
  smartSearch(query: string, type?: string): Promise<Result<unknown[]>>;
  /** 保存 lesson */
  saveLesson(lesson: Record<string, unknown>): Promise<Result<void>>;
  /** AgentMemory 是否可用 */
  isAvailable(): Promise<boolean>;
}

// ══════════════════════════════════════════════════════════════════
// 降级缓存子系统
// ══════════════════════════════════════════════════════════════════

export interface CacheSubsystem {
  get(key: string): unknown | null;
  set(key: string, value: unknown): void;
  list(): { key: string; value: unknown; writtenAt: number }[];
  delete(key: string): void;
}

// ══════════════════════════════════════════════════════════════════
// LLM 客户端 (最小依赖)
// ══════════════════════════════════════════════════════════════════

export interface LLMSubsystem {
  /** 分析 transcript → 提取学习事件 (session_end 使用) */
  analyzeTranscript(transcript: string): Promise<{ id: string; type: string; content: string; confidence: number }[]>;
  /** M1: 分析 transcript → 提取 ProtoStructure 候选 */
  extractProtoStructures(transcript: string): Promise<ProtoStructureCandidate[]>;
}

/** M1: LLM 提取的 ProtoStructure 候选 */
export interface ProtoStructureCandidate {
  protoType: "sequence" | "role" | "concept" | "purpose" | "constraint";
  tentativeName: string;
  scenarioId: string;
  confidence: number;
  // ProtoSequence specific
  steps?: { position: number; action: string; agent?: string }[];
  purpose?: string;
  // ProtoConstraint specific
  severity?: string;
  // ProtoConcept specific
  definition?: string;
  // ProtoRole specific
  behaviors?: string[];
}

// ══════════════════════════════════════════════════════════════════
// M0Deps — 组合所有子系统
// ══════════════════════════════════════════════════════════════════

export interface M0Deps {
  memory: MemorySubsystem;
  cache: CacheSubsystem;
  llm?: LLMSubsystem;
  /** 可选: 自主性策略覆盖 */
  autonomyPolicy?: AutonomyPolicy;
  /** 可选: 日志器 */
  logger?: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
}

// ══════════════════════════════════════════════════════════════════
// 默认自主性策略 (M0.2 — 降级用)
// ══════════════════════════════════════════════════════════════════

export const DEFAULT_AUTONOMY_POLICY: AutonomyPolicy = {
  defaultPolicy: {
    unknownOperation: "confirm",
    lowRiskKnown: "inform",
    highRiskKnown: "confirm",
    afterError: "downgrade_one",
  },
  operationPolicies: [],
  riskLevels: {
    low: ["reading_files", "searching", "summarizing"],
    medium: ["code_refactoring", "document_generation"],
    high: ["database_changes", "email_sending", "physical_device_control"],
    critical: ["production_deploy", "financial_operations", "privacy_sensitive"],
  },
};

// ══════════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════════

/**
 * 评估操作风险级别。匹配 policy 中定义的 riskLevels 关键词。
 */
export function assessRiskLevel(
  toolName: string,
  policy: AutonomyPolicy = DEFAULT_AUTONOMY_POLICY,
): "low" | "medium" | "high" | "critical" {
  for (const level of ["critical", "high", "medium", "low"] as const) {
    for (const pattern of policy.riskLevels[level]) {
      if (toolName.toLowerCase().includes(pattern.toLowerCase())) {
        return level;
      }
    }
  }
  return "low"; // Unknown operations default to low risk (policy handles via defaultPolicy.unknownOperation)
}
