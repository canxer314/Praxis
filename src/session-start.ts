/**
 * SessionStartHandler — M0 重构 + M2 分层注入
 *
 * 职责:
 *   - 从 AgentMemory 加载 competency_model + 相关知识
 *   - 从 AgentMemory 加载 ProtoStructures → 通过 context-organizer 分层编排
 *   - 构建 SessionContextInjection（结构化上下文，对齐架构文档 M0.3 + M2 §7）
 *   - AgentMemory 不可用时降级（空上下文，不崩溃）
 *   - 已移除 CognitiveCore 依赖 — 直连 AgentMemory
 */

import type { Result } from "./platform-adapter";
import type { M0Deps } from "./m0-deps";
import type { SessionContextInjection, ScenarioMatch, ProtoConstraint } from "./cognitive/types";
import { organizeContext } from "./context-organizer";
import { measurePressure } from "./context-pressure-monitor";
import type { PressureLevel, MaturityLevel } from "./context-pressure-monitor";
import { getActiveConstraints } from "./proto-constraint";
import { injectConstraints } from "./constraint-injector";

// ---- 默认值（降级用） ----

const DEFAULT_COMPETENCY: SessionContextInjection["competency"] = {
  overallProficiency: 0.5,
  domainProficiencies: {
    "TypeScript": 0.6,
    "系统架构设计": 0.8,
    "AI Agent 系统": 0.7,
  },
  strongestDomains: ["系统架构设计"],
  weakestDomains: ["TypeScript"],
  currentLearningFocus: null,
};

// ---- 类型 ----

export interface SessionStartOptions {
  /** 当前活跃场景（scene-recognizer 输出） */
  scenarios?: ScenarioMatch[];
  /** 当前任务上下文（M2 Step 4 将完善） */
  taskContext?: {
    taskId?: string;
    name?: string;
    currentPhase?: string;
    relevantScenarios?: string[];
  } | null;
  /** 上下文压力级别（M2 Step 2 将独立测量） */
  pressure?: PressureLevel;
  /** 认知成熟度 */
  maturity?: MaturityLevel;
  /** M2 Step 2: 估计已使用的上下文 token 数（用于自动测量压力级别） */
  estimatedUsedTokens?: number;
  /** M2 Step 2: 上下文窗口总大小（默认 1M） */
  contextWindowSize?: number;
}

/** 规范化 severity 值 — 防御从 AgentMemory 读取的无效数据 */
function normalizeSeverity(raw: string): ProtoConstraint["severity"] {
  const valid = ["block", "confirm", "warn"];
  return valid.includes(raw) ? (raw as ProtoConstraint["severity"]) : "warn";
}

// ---- SessionStartHandler ----

export class SessionStartHandler {
  /** M3: 从 AgentMemory 加载的原始 ProtoStructure 数据（供约束提取复用，避免二次 API 调用） */
  private rawStructures: Record<string, unknown>[] = [];

  constructor(private readonly deps: M0Deps) {}

  /**
   * 处理 session_start 事件。返回要注入 system prompt 的上下文。
   *
   * @param sessionId 会话 ID
   * @param opts      可选 — 场景、TaskContext、压力级别、成熟度
   */
  async handle(
    sessionId: string,
    opts: SessionStartOptions = {},
  ): Promise<Result<SessionContextInjection>> {
    const amAvailable = await this.deps.memory.isAvailable();

    // 加载能力模型
    const competency = amAvailable
      ? await this.loadCompetency()
      : { ...DEFAULT_COMPETENCY };

    // 检索相关知识
    const knowledge: SessionContextInjection["knowledge"] = amAvailable
      ? await this.loadKnowledge()
      : [];

    // 加载思维状态
    const mentalState = amAvailable
      ? await this.loadMentalState()
      : null;

    // 加载 ProtoStructures (M1) → 分层编排 (M2)
    const protoStructures = amAvailable
      ? await this.loadProtoStructures()
      : [];

    // M2 Step 2: 自动测量压力级别（如果提供了 token 使用量）
    const pressure = opts.pressure
      ?? (opts.estimatedUsedTokens !== undefined
        ? measurePressure(opts.estimatedUsedTokens, opts.contextWindowSize).level
        : "normal");

    // M2: 通过 context-organizer 分层编排
    const tieredContext = amAvailable && protoStructures.length > 0
      ? organizeContext({
          structures: protoStructures.map((s) => ({
            id: s.id,
            tentativeName: s.tentativeName,
            protoType: s.protoType,
            confidence: s.confidence,
            scenarioId: s.scenarioId,
            summary: s.summary,
          })),
          scenarios: opts.scenarios ?? [],
          taskContext: opts.taskContext ?? null,
          pressure,
          maturity: opts.maturity ?? "competent",
        })
      : undefined;

    // M3: 从原始 ProtoStructure 数据中提取已结晶约束 → 生成注入段
    const criticalConstraints = amAvailable
      ? this.buildCriticalConstraints(pressure)
      : undefined;

    return {
      ok: true,
      value: {
        protoStructures,
        competency,
        knowledge,
        mentalState,
        tieredContext: tieredContext ? {
          tierA: tieredContext.tierA,
          tierB: tieredContext.tierB,
          tierC: tieredContext.tierC,
          meta: tieredContext.meta,
          criticalConstraints,
        } : undefined,
      },
    };
  }

  /**
   * M3: 从原始 ProtoStructure 数据中提取已结晶约束并格式化为注入段。
   * 复用 loadProtoStructures 中已缓存的 rawStructures，避免额外 API 调用。
   */
  private buildCriticalConstraints(pressure: PressureLevel = "normal"): { injectionText: string; tokenCount: number; constraintIds: string[]; constraints: ProtoConstraint[] } | undefined {
    const constraints = this.loadConstraints();
    if (constraints.length === 0) return undefined;

    const active = getActiveConstraints(constraints);
    if (active.length === 0) return undefined;

    const result = injectConstraints({ constraints: active, maxTokens: pressure === "critical" ? 100 : 150 });
    if (result.injectionText === "") return undefined;

    return {
      injectionText: result.injectionText,
      tokenCount: result.tokenCount,
      constraintIds: result.constraintIds,
      constraints: active,
    };
  }

  /** M3: 从缓存的原始 AgentMemory 数据中提取 ProtoConstraint 字段 */
  private loadConstraints(): ProtoConstraint[] {
    return this.rawStructures
      .filter((item) => String(item.protoType ?? item.proto_type ?? "") === "constraint")
      .map((item) => ({
        id: String(item.id ?? ""),
        protoType: "constraint" as const,
        tentativeName: String(item.tentativeName ?? item.tentative_name ?? ""),
        scenarioId: String(item.scenarioId ?? item.scenario_id ?? ""),
        confidence: Number(item.confidence ?? 0),
        observationsCount: Number(item.observationsCount ?? item.observations_count ?? 0),
        adoptionRate: Number(item.adoptionRate ?? item.adoption_rate ?? 0),
        lifecycle: String(item.lifecycle ?? "hypothesized") as ProtoConstraint["lifecycle"],
        relations: (item.relations as ProtoConstraint["relations"]) ?? [],
        versionChain: (item.versionChain as ProtoConstraint["versionChain"]) ?? [],
        createdAt: Number(item.createdAt ?? item.created_at ?? 0),
        updatedAt: Number(item.updatedAt ?? item.updated_at ?? 0),
        severity: normalizeSeverity(String(item.severity ?? "warn")),
        source: (String(item.source ?? "user_taught")) as ProtoConstraint["source"],
        rulePatterns: (Array.isArray(item.rulePatterns ?? item.rule_patterns)
          ? (item.rulePatterns ?? item.rule_patterns) as string[]
          : []),
      }));
  }

  // ---- 内部 ----

  private async loadCompetency(): Promise<SessionContextInjection["competency"]> {
    const slotResult = await this.deps.memory.getSlot("competency_model");
    if (!slotResult.ok || !slotResult.value) {
      return { ...DEFAULT_COMPETENCY };
    }

    try {
      const model = slotResult.value as Record<string, unknown>;
      const profs = model.domainProficiencies as Record<string, { selfRating: number; taskCount: number }> | undefined;

      if (!profs || Object.keys(profs).length === 0) {
        return { ...DEFAULT_COMPETENCY };
      }

      const domainProficiencies: Record<string, number> = {};
      let totalRating = 0;
      const entries = Object.entries(profs);

      for (const [domain, prof] of entries) {
        const rating = typeof prof.selfRating === "number" ? prof.selfRating : 0.5;
        domainProficiencies[domain] = rating;
        totalRating += rating;
      }

      const sorted = entries.sort((a, b) => {
        const ra = typeof a[1].selfRating === "number" ? a[1].selfRating : 0.5;
        const rb = typeof b[1].selfRating === "number" ? b[1].selfRating : 0.5;
        return rb - ra;
      });

      return {
        overallProficiency: entries.length > 0 ? totalRating / entries.length : 0.5,
        domainProficiencies,
        strongestDomains: sorted.slice(0, 2).map(([d]) => d),
        weakestDomains: sorted.slice(-2).map(([d]) => d),
        currentLearningFocus: null,
      };
    } catch {
      return { ...DEFAULT_COMPETENCY };
    }
  }

  private async loadKnowledge(): Promise<SessionContextInjection["knowledge"]> {
    try {
      const result = await this.deps.memory.smartSearch("", "knowledge");
      if (!result.ok || !Array.isArray(result.value)) return [];

      return (result.value as Record<string, unknown>[]).slice(0, 10).map((item) => ({
        title: String(item.title ?? ""),
        content: String(item.content ?? ""),
        confidence: typeof item.confidence === "number" ? item.confidence : 0.5,
        source: String(item.source ?? "unknown"),
      }));
    } catch {
      return [];
    }
  }

  private async loadProtoStructures(): Promise<SessionContextInjection["protoStructures"]> {
    try {
      const result = await this.deps.memory.smartSearch("*", "proto_structure");
      if (!result.ok || !Array.isArray(result.value)) {
        this.rawStructures = [];
        return [];
      }

      // 保存原始数据供 M3 约束提取复用
      this.rawStructures = result.value as Record<string, unknown>[];

      return this.rawStructures.slice(0, 20).map((item) => ({
        id: String(item.id ?? ""),
        tentativeName: String(item.tentativeName ?? item.tentative_name ?? ""),
        protoType: String(item.protoType ?? item.proto_type ?? ""),
        confidence: Number(item.confidence ?? 0),
        scenarioId: String(item.scenarioId ?? item.scenario_id ?? ""),
        summary: this.formatProtoStructureSummary(item),
      }));
    } catch {
      return [];
    }
  }

  private formatProtoStructureSummary(item: Record<string, unknown>): string {
    const protoType = String(item.protoType ?? item.proto_type ?? "");
    switch (protoType) {
      case "sequence": {
        const steps = item.structure as { steps?: { action: string }[] } | undefined;
        if (steps?.steps?.length) return steps.steps.map((s) => s.action).join(" → ");
        return String(item.tentativeName ?? "");
      }
      case "constraint":
        return `[${String(item.severity ?? "warn")}] ${String(item.tentativeName ?? "")}`;
      default:
        return String(item.tentativeName ?? "");
    }
  }

  private async loadMentalState(): Promise<string | null> {
    try {
      const result = await this.deps.memory.smartSearch("mental_state", undefined);
      if (!result.ok || !Array.isArray(result.value) || result.value.length === 0) return null;
      const state = result.value[0] as Record<string, unknown>;
      return String(state.content ?? state.summary ?? null);
    } catch {
      return null;
    }
  }
}
