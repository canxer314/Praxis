/**
 * SessionStartHandler — Phase 1A
 *
 * 职责:
 *   - 在 session_start 事件时加载 competency_model
 *   - 构建 ContextInjection（Tier A/B/C 取决于 AgentMemory 可用性）
 *   - 降级模式：AgentMemory 不可用时使用默认 competency model
 *   - 宽松 schema 检查：格式错误时降级
 */

import { Result, ContextInjection } from "./platform-adapter";

// ---- 依赖注入 ----

export interface SessionStartDeps {
  getSlot: (name: string) => Promise<Result<unknown>>;
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

  constructor(deps: SessionStartDeps) {
    this.getSlot = deps.getSlot;
  }

  async handle(sessionId: string): Promise<Result<ContextInjection>> {
    const slotResult = await this.getSlot("competency_model");
    const degraded = !slotResult.ok || !slotResult.value;

    let model: CompetencyModel;

    if (!degraded) {
      model = this.parseModel(slotResult.value!);
      if (!model) {
        // 格式错误 → 降级
        model = DEFAULT_MODEL;
        return this.buildContext(model, "C", true);
      }
      return this.buildContext(model, "A", false);
    }

    return this.buildContext(DEFAULT_MODEL, "C", true);
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
