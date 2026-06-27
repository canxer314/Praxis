/**
 * CategoryAuditor — M6.1 范畴完备性 + 领域同质性检查
 *
 * 职责:
 *   - Q1: 范畴完备性 — 现有 5 种 ProtoStructure 类型是否足够?
 *   - Q2: 领域范畴同质性 — 不同领域的同类结构是否被强行统一?
 *   - 康德式诊断分叉: 数据问题 vs 范畴问题
 *   - LLM 用于"现有类型能否表达此模式"的语义判断
 *   - 冷启动: 数据不足时返回显式 insufficient_data 状态
 *   - 仅报告，不自动创建新范畴 (三种铁律)
 *
 * 架构参考: §8 元认知系统 — 范畴审计
 */

import type { ProtoStructure } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface CategoryAuditReport {
  generatedAt: number;
  status: "ok" | "insufficient_data";
  message?: string;
  blindSpots: CategoryBlindSpot[];
  domainForks: DomainCategoryForkProposal[];
  existingTypesHealth: Array<{ protoType: string; health: number }>;
  proposedNewTypes: NewCategoryProposal[];
}

export interface CategoryBlindSpot {
  pattern: string;
  evidenceCount: number;
  suggestedCategory: string;
  diagnosis: "data_insufficient" | "category_insufficient";
}

export interface DomainCategoryForkProposal {
  protoType: string;
  domainA: string;
  domainB: string;
  divergentFeatures: string[];
}

export interface NewCategoryProposal {
  proposedName: string;
  description: string;
  evidence: CategoryBlindSpot[];
  status: "pending_approval";
}

// 现有 5 种 ProtoStructure 类型
const EXISTING_TYPES = ["ProtoSequence", "ProtoRole", "ProtoConcept", "ProtoPurpose", "ProtoConstraint"];

// Q2 同质性检查最小结构数
const MIN_STRUCTURES_FOR_Q2 = 10;

// ══════════════════════════════════════════════════════════════════
// CategoryAuditor
// ══════════════════════════════════════════════════════════════════

export class CategoryAuditor {
  /**
   * 运行范畴审计。
   * @param correctionClusters 从 audit_log 和 lessons 中聚合的纠正聚类
   * @param structures 所有 ProtoStructure
   * @param llm 可选的 LLM 客户端 (Q1 语义类型匹配需要)
   */
  async run(
    correctionClusters: Array<{ pattern: string; count: number; last30Days: number }>,
    structures: ProtoStructure[],
    llm?: { analyze: (prompt: string) => Promise<{ ok: boolean; value?: string }> },
  ): Promise<CategoryAuditReport> {
    const now = Date.now();

    // 冷启动检查
    if (correctionClusters.length === 0 && structures.length === 0) {
      return {
        generatedAt: now,
        status: "insufficient_data",
        message: "审计数据不足。需要至少 1 次 cron_tick 积累 StructuralGap 检测结果。",
        blindSpots: [],
        domainForks: [],
        existingTypesHealth: EXISTING_TYPES.map(t => ({ protoType: t, health: 1 })),
        proposedNewTypes: [],
      };
    }

    // Q1: 范畴完备性
    const blindSpots: CategoryBlindSpot[] = [];
    if (correctionClusters.length > 0) {
      for (const cluster of correctionClusters) {
        const diagnosis = await this.kantianDiagnosisFork(cluster, structures, llm);
        if (diagnosis) blindSpots.push(diagnosis);
      }
    }

    // Q2: 领域同质性 (需要 ≥10 个结构)
    const domainForks: DomainCategoryForkProposal[] = [];
    if (structures.length >= MIN_STRUCTURES_FOR_Q2) {
      domainForks.push(...this.checkDomainHomogeneity(structures));
    }

    // 现有类型健康度
    const existingTypesHealth = EXISTING_TYPES.map(protoType => {
      const typed = structures.filter(s => s.protoType === protoType);
      if (typed.length === 0) return { protoType, health: 1 };
      const avgConf = typed.reduce((sum, s) => sum + s.confidence, 0) / typed.length;
      return { protoType, health: Math.round(avgConf * 100) / 100 };
    });

    // 生成新范畴提案
    const proposedNewTypes = this.generateProposals(blindSpots);

    const statusMessage = correctionClusters.length === 0
      ? "无重复纠正模式，无法执行范畴完备性检查。"
      : structures.length < MIN_STRUCTURES_FOR_Q2
        ? `结构数量不足 (需要 ≥${MIN_STRUCTURES_FOR_Q2})，跳过领域同质性检查。当前: ${structures.length}`
        : undefined;

    return {
      generatedAt: now,
      status: "ok",
      message: statusMessage,
      blindSpots,
      domainForks,
      existingTypesHealth,
      proposedNewTypes,
    };
  }

  // ── Q1: 康德式诊断分叉 ──

  private async kantianDiagnosisFork(
    cluster: { pattern: string; count: number; last30Days: number },
    structures: ProtoStructure[],
    llm?: { analyze: (prompt: string) => Promise<{ ok: boolean; value?: string }> },
  ): Promise<CategoryBlindSpot | null> {
    // Step 1: 数据充分性检查
    const totalObservations = structures.filter(s =>
      s.protoType && s.observationsCount >= 1,
    ).length;

    if (cluster.count < 3 && totalObservations < 5) {
      // 数据不充分 → 不标记盲区
      return {
        pattern: cluster.pattern,
        evidenceCount: cluster.count,
        suggestedCategory: "none",
        diagnosis: "data_insufficient",
      };
    }

    // Step 2: 范畴充分性 — LLM 判断现有 5 种类型能否表达此模式
    if (llm) {
      const canExpress = await this.canExistingTypesExpress(cluster.pattern, llm);
      if (canExpress) {
        return null; // 可用现有类型表达 → 不标记盲区
      }
    }

    // Step 3: 范畴不足 → 标记 blind spot
    return {
      pattern: cluster.pattern,
      evidenceCount: cluster.count,
      suggestedCategory: this.suggestCategoryName(cluster.pattern),
      diagnosis: "category_insufficient",
    };
  }

  /** LLM 语义判断: 现有 5 种类型能否充分表达此模式? */
  private async canExistingTypesExpress(
    pattern: string,
    llm: { analyze: (prompt: string) => Promise<{ ok: boolean; value?: string }> },
  ): Promise<boolean> {
    const prompt = `You are classifying whether a recurring correction pattern can be adequately expressed by one of Praxis's 5 existing ProtoStructure types:

1. ProtoSequence — behavioral sequence patterns (steps in order)
2. ProtoRole — role relationships and responsibilities
3. ProtoConcept — concept definitions and relationships
4. ProtoPurpose — goal intentions and success criteria
5. ProtoConstraint — constraint axioms and prohibitions

Correction pattern: "${pattern}"

Can this pattern be adequately expressed by one of the 5 types above? Answer with JSON:
{"expressible": true, "bestType": "<type name>", "reason": "<one sentence>"}
or
{"expressible": false, "reason": "<why no existing type fits>"}`;

    try {
      const result = await llm.analyze(prompt);
      if (!result.ok || !result.value) return true; // LLM 不可用时保守假定可表达
      const json = JSON.parse(result.value.replace(/^```json\s*\n?/, "").replace(/\n?```$/, ""));
      return Boolean(json.expressible);
    } catch {
      return true; // 解析失败 → 保守假定可表达
    }
  }

  /** 为新范畴建议名称 */
  private suggestCategoryName(pattern: string): string {
    const words = pattern.split(/\s+/).slice(0, 2);
    return `Proto${words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("")}`;
  }

  // ── Q2: 领域范畴同质性检查 ──

  private checkDomainHomogeneity(structures: ProtoStructure[]): DomainCategoryForkProposal[] {
    const forks: DomainCategoryForkProposal[] = [];

    // 按 (protoType, scenarioId) 分组
    const groups = new Map<string, ProtoStructure[]>();
    for (const s of structures) {
      if (!s.scenarioId) continue;
      const key = `${s.protoType}:${s.scenarioId}`;
      const group = groups.get(key) ?? [];
      group.push(s);
      groups.set(key, group);
    }

    // 对每种 protoType，检查组间差异
    const types = [...new Set(structures.map(s => s.protoType))];
    for (const protoType of types) {
      const typedGroups = [...groups.entries()]
        .filter(([key]) => key.startsWith(`${protoType}:`));

      if (typedGroups.length < 2) continue;

      // 比较每对领域组
      for (let i = 0; i < typedGroups.length; i++) {
        for (let j = i + 1; j < typedGroups.length; j++) {
          const [keyA, groupA] = typedGroups[i];
          const [keyB, groupB] = typedGroups[j];
          const domainA = keyA.split(":")[1];
          const domainB = keyB.split(":")[1];

          const divergentFeatures = this.findDivergentFeatures(protoType, groupA, groupB);
          if (divergentFeatures.length >= 3) {
            forks.push({ protoType, domainA, domainB, divergentFeatures });
          }
        }
      }
    }

    return forks;
  }

  /** 检测两组结构的特征差异 */
  private findDivergentFeatures(
    protoType: string,
    groupA: ProtoStructure[],
    groupB: ProtoStructure[],
  ): string[] {
    const features: string[] = [];

    switch (protoType) {
      case "sequence": {
        const avgStepsA = groupA.reduce((s, g) => s + (g.observationsCount ?? 1), 0) / groupA.length;
        const avgStepsB = groupB.reduce((s, g) => s + (g.observationsCount ?? 1), 0) / groupB.length;
        if (Math.abs(avgStepsA - avgStepsB) > 2) features.push("observations_count_diff");
        break;
      }
      case "constraint": {
        // 约束严重度分布差异
        const severityA = groupA.map(s => (s as unknown as Record<string, unknown>).severity ?? "warn");
        const severityB = groupB.map(s => (s as unknown as Record<string, unknown>).severity ?? "warn");
        if (severityA.filter(s => s === "block").length !== severityB.filter(s => s === "block").length) {
          features.push("severity_distribution_diff");
        }
        break;
      }
      default: {
        // 通用: 平均置信度差异
        const avgConfA = groupA.reduce((s, g) => s + g.confidence, 0) / groupA.length;
        const avgConfB = groupB.reduce((s, g) => s + g.confidence, 0) / groupB.length;
        if (Math.abs(avgConfA - avgConfB) > 0.3) features.push("confidence_diff");
        break;
      }
    }

    // 通用: 关系密度差异
    const relsA = groupA.reduce((s, g) => s + (g.relations?.length ?? 0), 0) / groupA.length;
    const relsB = groupB.reduce((s, g) => s + (g.relations?.length ?? 0), 0) / groupB.length;
    if (Math.abs(relsA - relsB) > 1) features.push("relation_density_diff");

    if (groupA.length / Math.max(1, groupB.length) > 3) features.push("size_asymmetry");

    return features;
  }

  // ── 新范畴提案 ──

  private generateProposals(blindSpots: CategoryBlindSpot[]): NewCategoryProposal[] {
    const categoryInsufficient = blindSpots.filter(b => b.diagnosis === "category_insufficient");
    if (categoryInsufficient.length === 0) return [];

    return [{
      proposedName: categoryInsufficient[0].suggestedCategory,
      description: `从 ${categoryInsufficient.length} 个范畴盲区事件推断的新结构类型`,
      evidence: categoryInsufficient,
      status: "pending_approval",
    }];
  }
}
