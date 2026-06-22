/**
 * SessionStartHandler — Phase 1A + T8
 *
 * 职责:
 *   - 在 session_start 事件时加载 competency_model
 *   - 构建 ContextInjection（Tier A/B/C 取决于 AgentMemory 可用性）
 *   - 降级模式：AgentMemory 不可用时使用默认 competency model
 *   - 宽松 schema 检查：格式错误时降级
 *   - T8: 支持 CognitiveCore 可选依赖 → 使用缓存 profile 零延迟注入
 */

import { Result, ContextInjection } from "./platform-adapter";
import type { CognitiveCore } from "./cognitive/cognitive-core";

// ---- 依赖注入 ----

export interface SessionStartDeps {
  getSlot: (name: string) => Promise<Result<unknown>>;
  /** T8: 可选 — 提供时走认知核心快速路径 (缓存 profile，零网络延迟) */
  cognitiveCore?: CognitiveCore;
}

// ---- 内部类型 ----

interface Skill {
  id: string;
  name: string;
  proficiency: number;
  level: string;
}

interface CompetencyModel {
  skills: Skill[];
  best_practices: string[];
  anti_patterns: string[];
}

// ---- 默认值（降级用） ----

const DEFAULT_MODEL: CompetencyModel = {
  skills: [
    { id: "typescript", name: "TypeScript", proficiency: 0.6, level: "competent" },
    { id: "architecture", name: "系统架构设计", proficiency: 0.8, level: "proficient" },
    { id: "ai-agent", name: "AI Agent 系统", proficiency: 0.7, level: "competent" },
  ],
  best_practices: [],
  anti_patterns: [],
};

// ---- SessionStartHandler ----

export class SessionStartHandler {
  private readonly getSlot: SessionStartDeps["getSlot"];
  private readonly cognitiveCore?: CognitiveCore;

  constructor(deps: SessionStartDeps) {
    this.getSlot = deps.getSlot;
    this.cognitiveCore = deps.cognitiveCore;
  }

  async handle(sessionId: string): Promise<Result<ContextInjection>> {
    // T8: 有 CognitiveCore 时走快速路径 (缓存 profile，零网络延迟)
    if (this.cognitiveCore) {
      return this.handleWithCognitive(sessionId);
    }

    // 降级: 原 slot 读取路径 (Phase 1A 兼容)
    const slotResult = await this.getSlot("competency_model");
    const degraded = !slotResult.ok || !slotResult.value;

    let model: CompetencyModel | null;

    if (!degraded) {
      model = this.parseModel(slotResult.value!);
      if (!model) {
        return this.buildContext(DEFAULT_MODEL, "C", true);
      }
      return this.buildContext(model, "A", false);
    }

    return this.buildContext(DEFAULT_MODEL, "C", true);
  }

  // ---- T8 快速路径: CognitiveCore 缓存 profile ----

  private async handleWithCognitive(
    _sessionId: string,
  ): Promise<Result<ContextInjection>> {
    const profileResult = await this.cognitiveCore!.getProfile();

    if (!profileResult.ok) {
      // Profile 完全不可用 → 退化到默认值
      return this.buildContext(DEFAULT_MODEL, "C", true);
    }

    const profile = profileResult.value;
    const lines: string[] = ["## Praxis Context", ""];

    // 1. 领域熟练度
    const domains = Object.entries(profile.domainProficiencies);
    if (domains.length > 0) {
      lines.push("### 能力概况");
      for (const [domain, prof] of domains.sort(
        (a, b) => b[1].selfRating - a[1].selfRating,
      )) {
        const level =
          prof.selfRating >= 0.8 ? "proficient"
          : prof.selfRating >= 0.5 ? "competent"
          : "beginner";
        lines.push(`- ${domain}: ${prof.selfRating.toFixed(2)} (${level}, ${prof.taskCount} 次任务)`);
      }
      lines.push("");
    } else {
      // 无数据 → 默认 skills
      lines.push("### 能力概况");
      for (const s of DEFAULT_MODEL.skills) {
        lines.push(`- ${s.name}: ${s.proficiency.toFixed(2)} (${s.level})`);
      }
      lines.push("");
    }

    // 2. 知识缺口
    const openGaps = (profile.knowledgeGaps ?? []).filter((g) => !g.resolved);
    if (openGaps.length > 0) {
      lines.push("### 待解决的知识缺口");
      for (const gap of openGaps.slice(0, 8)) {
        lines.push(`- ${gap.topic}: ${gap.context}`);
      }
      lines.push("");
    }

    // 3. 校准摘要
    const history = profile.calibrationHistory ?? [];
    if (history.length > 0) {
      const recent = history.slice(-10);
      const accuracy =
        recent.filter((c) => c.actualOutcome === "success").length /
        recent.length;
      lines.push("### 校准状态");
      lines.push(
        `- 最近 ${recent.length} 次任务实际成功率: ${(accuracy * 100).toFixed(0)}%`,
      );
      lines.push("");
    }

    const systemPromptAddition = lines.join("\n");

    return {
      ok: true,
      value: {
        systemPromptAddition,
        tier: "A",
        tokenCount: Math.ceil(systemPromptAddition.length / 4),
      },
    };
  }

  // ---- 内部 ----

  private parseModel(raw: unknown): CompetencyModel | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;

    // 宽松解析：skills / best_practices / anti_patterns 可选
    const skills = Array.isArray(obj.skills) ? obj.skills as Skill[] : [];
    const best = Array.isArray(obj.best_practices) ? obj.best_practices as string[] : [];
    const anti = Array.isArray(obj.anti_patterns) ? obj.anti_patterns as string[] : [];

    return { skills, best_practices: best, anti_patterns: anti };
  }

  private buildContext(
    model: CompetencyModel,
    tier: "A" | "B" | "C",
    stale: boolean,
  ): Result<ContextInjection> {
    const skills = model.skills
      .map((s) => `- ${s.name}: ${s.proficiency.toFixed(2)} (${s.level})`)
      .join("\n");

    const sections: string[] = [
      "## Praxis Context",
      "",
      "### 能力概况",
      skills || "（无技能数据）",
    ];

    if (stale) {
      sections.push("", "⚠️ 使用缓存数据（AgentMemory 不可用）");
    }

    if (model.best_practices.length > 0) {
      sections.push("", "### 最佳实践", ...model.best_practices.map((p) => `- ${p}`));
    }

    if (model.anti_patterns.length > 0) {
      sections.push("", "### 已知陷阱", ...model.anti_patterns.map((a) => `- ${a}`));
    }

    const systemPromptAddition = sections.join("\n");
    const tokenCount = Math.ceil(systemPromptAddition.length / 4);

    return {
      ok: true,
      value: { systemPromptAddition, tier, tokenCount },
    };
  }
}
