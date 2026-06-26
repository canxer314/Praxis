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
import type { SessionContextInjection, ScenarioMatch } from "./cognitive/types";
import { organizeContext } from "./context-organizer";
import type { PressureLevel, MaturityLevel } from "./context-organizer";

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
}

// ---- SessionStartHandler ----

export class SessionStartHandler {
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
          pressure: opts.pressure ?? "normal",
          maturity: opts.maturity ?? "competent",
        })
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
        } : undefined,
      },
    };
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
      if (!result.ok || !Array.isArray(result.value)) return [];

      return (result.value as Record<string, unknown>[]).slice(0, 20).map((item) => ({
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
