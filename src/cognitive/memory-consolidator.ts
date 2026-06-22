/**
 * MemoryConsolidator — Phase 2.3: 记忆间一致性
 *
 * 将低级情景记忆提炼为高级语义和程序记忆。
 *
 * 管道:
 *   1. Episodic → Semantic: 3+ 条相同修正模式的情景记忆 → 语义关系
 *   2. Semantic → Procedural: 3+ 条同领域语义记忆 → 程序步骤
 *
 * 设计原则:
 *   - 所有 consolidate 方法为纯函数（不依赖外部 I/O）
 *   - 去重: 不创建与已有记忆重复的条目
 *   - 阈值可配置
 */

import type { EpisodicMemory, ProceduralMemory, SemanticMemory } from "./types";

// ══════════════════════════════════════════════════════════════════
// 阈值常量
// ══════════════════════════════════════════════════════════════════

const MIN_EPISODIC_FOR_SEMANTIC = 3;
const MIN_SEMANTIC_FOR_PROCEDURAL = 3;
const MIN_CONFIDENCE_FOR_EXTRACTION = 0.6;

// ══════════════════════════════════════════════════════════════════
// MemoryConsolidator
// ══════════════════════════════════════════════════════════════════

export class MemoryConsolidator {
  /**
   * Phase 1: Episodic → Semantic
   *
   * 当同一 (taskType, domain) 组合下有 3+ 条情景记忆
   * 共享相同的修正模式时，提取语义关系。
   *
   * 示例:
   *   3 条 "used old API" → "use new API" 的修正
   *   → SemanticMemory: "old API" → obsolete → "new API"
   */
  consolidateEpisodicToSemantic(
    episodic: EpisodicMemory[],
    existingSemantic: SemanticMemory[],
  ): SemanticMemory[] {
    if (episodic.length < MIN_EPISODIC_FOR_SEMANTIC) return [];

    // 按 (taskType, domain) 分组
    const groups = new Map<string, EpisodicMemory[]>();
    for (const ep of episodic) {
      const ctx = ep.context || {};
      const key = `${ctx.taskType || "unknown"}::${ctx.domain || "unknown"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ep);
    }

    const newSemantic: SemanticMemory[] = [];
    const existingKeys = new Set(
      existingSemantic.map((s) => `${s.subject}::${s.relation}::${s.object}`),
    );

    for (const [, group] of groups) {
      if (group.length < MIN_EPISODIC_FOR_SEMANTIC) continue;

      // 寻找重复出现的修正模式
      const correctionPatterns = new Map<string, { count: number; episodes: EpisodicMemory[] }>();
      for (const ep of group) {
        // 模式: "what → correctedTo"
        const pattern = `${ep.observation.action} → ${ep.observation.outcome}`;
        if (!correctionPatterns.has(pattern)) {
          correctionPatterns.set(pattern, { count: 0, episodes: [] });
        }
        const entry = correctionPatterns.get(pattern)!;
        entry.count++;
        entry.episodes.push(ep);
      }

      // 出现 3+ 次的模式 → 语义记忆
      // 领域名从第一组 episode 中获取
      const groupDomain = group[0]?.context.domain ?? "unknown";

      for (const [pattern, { count, episodes }] of correctionPatterns) {
        if (count < MIN_EPISODIC_FOR_SEMANTIC) continue;

        const [action, outcome] = this.parsePattern(pattern);
        // subject 包含领域名以便后续 Semantic→Procedural 分组
        const subject = `${groupDomain}: ${action}`;
        const object = outcome;
        const relation = this.inferRelation(episodes);
        const key = `${subject}::${relation}::${object}`;

        // 去重
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);

        newSemantic.push({
          memoryId: `sem_${Date.now()}_${newSemantic.length}`,
          subject,
          relation,
          object,
          confidence: Math.min(1.0, count / (MIN_EPISODIC_FOR_SEMANTIC + 2)),
          evidence: episodes.map((e) => e.memoryId),
          source: "self_derived",
        });
      }
    }

    return newSemantic;
  }

  /**
   * Phase 2: Semantic → Procedural
   *
   * 当同一领域有 3+ 条语义记忆时，将它们编排为程序步骤。
   *
   * 示例:
   *   3 条关于 "typescript API" 的语义记忆
   *   → ProceduralMemory: "在 typescript 开发中，先检查 X，再使用 Y..."
   */
  consolidateSemanticToProcedural(
    semantic: SemanticMemory[],
    existingProcedural: ProceduralMemory[],
  ): ProceduralMemory[] {
    if (semantic.length < MIN_SEMANTIC_FOR_PROCEDURAL) return [];

    // 按 subject 领域分组
    const bySubject = new Map<string, SemanticMemory[]>();
    for (const s of semantic) {
      const domain = this.extractDomain(s.subject);
      if (!bySubject.has(domain)) bySubject.set(domain, []);
      bySubject.get(domain)!.push(s);
    }

    const newProcedural: ProceduralMemory[] = [];
    const existingTasks = new Set(existingProcedural.map((p) => p.taskType));

    for (const [domain, group] of bySubject) {
      if (group.length < MIN_SEMANTIC_FOR_PROCEDURAL) continue;

      const taskType = `use_${domain.replace(/\s+/g, "_").toLowerCase()}`;
      if (existingTasks.has(taskType)) continue;
      existingTasks.add(taskType);

      // 将语义关系转换为程序步骤
      const steps = group.map((s, i) => ({
        order: i + 1,
        description: `${s.subject}: ${s.relation} → ${s.object}`,
        critical: s.confidence >= 0.8,
        commonPitfalls: [],
      }));

      // 从语义记忆中提取反模式
      const antiPatterns = group
        .filter((s) => s.confidence < MIN_CONFIDENCE_FOR_EXTRACTION)
        .map((s) => ({
          pattern: `${s.subject} ≠ ${s.object}`,
          consequence: `关系置信度低 (${s.confidence.toFixed(2)})`,
          occurrences: 1,
        }));

      newProcedural.push({
        memoryId: `proc_${Date.now()}_${newProcedural.length}`,
        taskType,
        domain,
        steps,
        antiPatterns,
        confidence: this.averageConfidence(group.map((s) => s.confidence)),
        observationCount: group.length,
        derivedFrom: group.map((s) => s.memoryId),
      });
    }

    return newProcedural;
  }

  /**
   * Full consolidation pipeline.
   *
   * @returns 新提取的语义和程序记忆
   */
  consolidate(
    episodic: EpisodicMemory[],
    existingSemantic: SemanticMemory[],
    existingProcedural: ProceduralMemory[],
  ): { newSemantic: SemanticMemory[]; newProcedural: ProceduralMemory[] } {
    const newSemantic = this.consolidateEpisodicToSemantic(episodic, existingSemantic);
    const allSemantic = [...existingSemantic, ...newSemantic];
    const newProcedural = this.consolidateSemanticToProcedural(allSemantic, existingProcedural);

    return { newSemantic, newProcedural };
  }

  // ---- 内部 ----

  /** 解析 "what → correctedTo" 模式为 (subject, object) */
  private parsePattern(pattern: string): [string, string] {
    const parts = pattern.split(" → ");
    return [
      parts[0]?.trim() ?? pattern,
      parts[1]?.trim() ?? "alternative",
    ];
  }

  /** 基于情景记忆推断语义关系类型 */
  private inferRelation(episodes: EpisodicMemory[]): string {
    const allCorrected = episodes.every((e) => e.signals?.wasCorrected === true);
    if (allCorrected) return "should_be_replaced_by";

    const anyNewKnowledge = episodes.some(
      (e) => e.signals?.deviationFromExpected === "isNewKnowledge",
    );
    if (anyNewKnowledge) return "is_equivalent_to";

    return "relates_to";
  }

  /** 从语义主体中提取领域名 */
  private extractDomain(subject: string): string {
    // 启发式: 取冒号前的部分，或整个字符串
    const colonIdx = subject.indexOf(":");
    if (colonIdx !== -1) return subject.slice(0, colonIdx).trim();
    // 取前 3 个词
    const words = subject.split(/\s+/).slice(0, 3);
    return words.join(" ");
  }

  private averageConfidence(values: number[]): number {
    if (values.length === 0) return 0.5;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}
