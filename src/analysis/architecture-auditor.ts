/**
 * ArchitectureAuditor — M6.1 对抗性架构审计
 *
 * 职责:
 *   - 阅读 audit_log 积累的数据，查找框架本身的结构性弱点
 *   - 4 审计维度: 健康度聚合 / 认知边界 / 自我一致性 / 对抗性挑战
 *   - 对抗性挑战使用 LLM（唯一 LLM 调用点），其余确定性逻辑
 *   - 仅报告，不自动修改任何 ProtoStructure
 *
 * 架构参考: §8 元认知系统
 */

import type { ProtoStructure } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface ArchitectureAuditReport {
  generatedAt: number;
  overallHealth: number;
  zombieRate: number;
  decayRate: number;
  weakestDimension: string;
  adversarialResults: AdversarialChallenge[];
  recommendations: AuditRecommendation[];
}

export interface AdversarialChallenge {
  structureId: string;
  structureName: string;
  challenge: string;
  passed: boolean;
  llmConfidence: number;
}

export interface AuditRecommendation {
  severity: "low" | "medium" | "high";
  category: string;
  description: string;
  affectedStructures: string[];
}

// ══════════════════════════════════════════════════════════════════
// ArchitectureAuditor
// ══════════════════════════════════════════════════════════════════

export class ArchitectureAuditor {
  /**
   * 运行完整架构审计。
   * @param auditLog audit_log slot 中的条目数组
   * @param structures 所有 ProtoStructure
   * @param competencyModel competency_model slot 的内容
   * @param llm 可选的 LLM 客户端 (对抗性挑战需要)
   */
  async run(
    auditLog: Array<Record<string, unknown>>,
    structures: ProtoStructure[],
    competencyModel: Record<string, unknown> | null,
    llm?: { analyze: (prompt: string) => Promise<{ ok: boolean; value?: string }> },
  ): Promise<ArchitectureAuditReport> {
    const now = Date.now();
    const recommendations: AuditRecommendation[] = [];

    // 1. 结构健康度聚合
    const zombieRate = this.calcZombieRate(structures);
    const decayRate = this.calcDecayRate(auditLog, structures);
    if (zombieRate > 0.3) {
      recommendations.push({
        severity: "high",
        category: "structure_health",
        description: `僵尸结构率 ${(zombieRate * 100).toFixed(0)}% 超过 30% 阈值`,
        affectedStructures: this.findZombies(structures).map(s => s.id),
      });
    }

    // 2. 认知边界审计
    const weakestDimension = this.findWeakestDimension(competencyModel);
    if (weakestDimension.proficiency < 0.3) {
      recommendations.push({
        severity: "medium",
        category: "cognitive_boundary",
        description: `8D 维度 "${weakestDimension.name}" 熟练度 ${weakestDimension.proficiency.toFixed(2)} 偏低`,
        affectedStructures: [],
      });
    }

    // 3. 自我一致性审计
    const zombieIds = this.findZombies(structures).map(s => s.id);
    if (zombieIds.length > 0) {
      recommendations.push({
        severity: "medium",
        category: "self_consistency",
        description: `${zombieIds.length} 个高置信低采纳结构 (僵尸)`,
        affectedStructures: zombieIds,
      });
    }

    // 4. 对抗性挑战 (需要 LLM)
    const adversarialResults: AdversarialChallenge[] = [];
    if (llm) {
      const crystallized = structures.filter(s => s.lifecycle === "crystallized");
      const sample = crystallized.slice(0, 3); // 取样最多 3 个
      for (const s of sample) {
        try {
          const result = await this.runAdversarialChallenge(s, llm);
          adversarialResults.push(result);
          if (!result.passed) {
            recommendations.push({
              severity: "medium",
              category: "adversarial",
              description: `结构 "${s.tentativeName}" 未通过对抗性挑战`,
              affectedStructures: [s.id],
            });
          }
        } catch {
          // 单个挑战失败不影响整体审计
        }
      }
    }

    // 综合健康度 (加权)
    const overallHealth = this.calcOverallHealth(zombieRate, decayRate, adversarialResults);

    return { generatedAt: now, overallHealth, zombieRate, decayRate, weakestDimension: weakestDimension.name, adversarialResults, recommendations };
  }

  // ── 私有 ──

  private calcZombieRate(structures: ProtoStructure[]): number {
    if (structures.length === 0) return 0;
    const zombies = structures.filter(s => s.confidence > 0.7 && s.adoptionRate < 0.2);
    return zombies.length / structures.length;
  }

  private calcDecayRate(auditLog: Array<Record<string, unknown>>, structures: ProtoStructure[]): number {
    const activeCount = structures.filter(s =>
      s.lifecycle !== "deprecated" && s.lifecycle !== "rejected",
    ).length;
    if (activeCount === 0) return 0;
    const decayEntries = auditLog.filter(e => e.type === "structural_gap_signal").length;
    // 归一化: 每 100 个活跃结构每 30 天的信号数
    return Math.min(1, decayEntries / Math.max(1, activeCount) / 10);
  }

  private findZombies(structures: ProtoStructure[]): ProtoStructure[] {
    return structures.filter(s => s.confidence > 0.7 && s.adoptionRate < 0.2);
  }

  private findWeakestDimension(model: Record<string, unknown> | null): { name: string; proficiency: number } {
    const dims = (model?.dimensions ?? model?.domainProficiencies ?? {}) as Record<string, number>;
    if (Object.keys(dims).length === 0) return { name: "unknown", proficiency: 0 };
    let minDim = "unknown";
    let minVal = Infinity;
    for (const [k, v] of Object.entries(dims)) {
      if (typeof v === "number" && v < minVal) { minVal = v; minDim = k; }
    }
    return { name: minDim, proficiency: minVal === Infinity ? 0 : minVal };
  }

  private async runAdversarialChallenge(
    structure: ProtoStructure,
    llm: { analyze: (prompt: string) => Promise<{ ok: boolean; value?: string }> },
  ): Promise<AdversarialChallenge> {
    const prompt = `You are testing the robustness of a cognitive structure called "${structure.tentativeName}" (type: ${structure.protoType}, confidence: ${structure.confidence}).

Try to construct a realistic scenario where this structure would FAIL or produce wrong guidance. Be specific and concrete.

If you can construct such a counterexample, respond with:
{"counterexampleFound": true, "scenario": "<description>", "whyItFails": "<reason>"}

If you cannot find a plausible counterexample, respond with:
{"counterexampleFound": false}`;

    const result = await llm.analyze(prompt);
    if (!result.ok || !result.value) {
      return { structureId: structure.id, structureName: structure.tentativeName, challenge: "LLM unavailable", passed: true, llmConfidence: 0.5 };
    }

    try {
      const json = JSON.parse(result.value.replace(/^```json\s*\n?/, "").replace(/\n?```$/, ""));
      return {
        structureId: structure.id,
        structureName: structure.tentativeName,
        challenge: json.scenario ?? "no counterexample",
        passed: !json.counterexampleFound,
        llmConfidence: 0.8,
      };
    } catch {
      return { structureId: structure.id, structureName: structure.tentativeName, challenge: "parse error", passed: true, llmConfidence: 0.3 };
    }
  }

  private calcOverallHealth(
    zombieRate: number,
    decayRate: number,
    adversarialResults: AdversarialChallenge[],
  ): number {
    const zombieScore = 1 - zombieRate;
    const decayScore = 1 - decayRate;
    const advPassRate = adversarialResults.length > 0
      ? adversarialResults.filter(a => a.passed).length / adversarialResults.length
      : 1;
    return Math.round((zombieScore * 0.4 + decayScore * 0.3 + advPassRate * 0.3) * 100) / 100;
  }
}
