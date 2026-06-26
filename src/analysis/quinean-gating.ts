/**
 * QuineanGating — 奎因式结晶化门控 (M4.4)
 *
 * 三重门控: necessity / sufficiency / parsimony
 * 基于遥测数据和统计验证器日志, 不调 LLM。
 *
 * M4 范围: 仅对 ProtoSequence 应用, session ≥ 10 才启动。
 *
 * 架构参考: §3 结晶化条件 (五重门控 3-5)
 */

import type { ProtoStructure, ProtoSequence, StepMatch } from "../cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 阈值常量
// ══════════════════════════════════════════════════════════════════

const MIN_SESSIONS_FOR_GATING = 10;
const NECESSITY_THRESHOLD = 0.10;   // 预测准确率下降 ≥ 10% → 必要
const SUFFICIENCY_THRESHOLD = 0.10; // 使用 vs 不使用差异 > 0.1 → 充分
const PARSIMONY_ACCURACY_TOLERANCE = 0.05; // 替代结构准确率可比容差

// ══════════════════════════════════════════════════════════════════
// 接口
// ══════════════════════════════════════════════════════════════════

export interface GatingContext {
  /** 结构被使用的 session 数 */
  sessionsWithStructure: number;
  /** 结构未被使用的 session 数 */
  sessionsWithoutStructure: number;
  /** 使用该结构时的平均预测准确率 */
  accuracyWithStructure: number;
  /** 不使用该结构时的平均预测准确率 */
  accuracyWithoutStructure: number;
  /** 所有已知替代结构的 ID 列表 */
  alternativeStructureIds: string[];
  /** 替代结构的平均准确率 (id → accuracy) */
  alternativeAccuracies: Map<string, number>;
}

export interface GatingResult {
  necessity: boolean;
  sufficiency: boolean;
  parsimony: boolean;
  passed: boolean;
  blockedBy: string[];
  details: {
    necessity: string;
    sufficiency: string;
    parsimony: string;
  };
}

// ══════════════════════════════════════════════════════════════════
// QuineanGating
// ══════════════════════════════════════════════════════════════════

export class QuineanGating {
  /**
   * 检查三重门控。仅对 ProtoSequence 应用。
   */
  check(structure: ProtoStructure, context: GatingContext): GatingResult {
    const blockedBy: string[] = [];
    const details: GatingResult["details"] = {
      necessity: "not applicable",
      sufficiency: "not applicable",
      parsimony: "not applicable",
    };

    // Pre-gate: ProtoType check
    if (structure.protoType !== "sequence") {
      return {
        necessity: false, sufficiency: false, parsimony: false,
        passed: false,
        blockedBy: ["Not a ProtoSequence — gating only applies to ProtoSequence"],
        details,
      };
    }

    // Pre-gate: Sample size
    const totalSessions = context.sessionsWithStructure + context.sessionsWithoutStructure;
    if (totalSessions < MIN_SESSIONS_FOR_GATING) {
      return {
        necessity: false, sufficiency: false, parsimony: false,
        passed: false,
        blockedBy: [`Insufficient sessions: ${totalSessions} < ${MIN_SESSIONS_FOR_GATING}`],
        details: {
          necessity: `Need ≥${MIN_SESSIONS_FOR_GATING} sessions, have ${totalSessions}`,
          sufficiency: `Need ≥${MIN_SESSIONS_FOR_GATING} sessions, have ${totalSessions}`,
          parsimony: `Need ≥${MIN_SESSIONS_FOR_GATING} sessions, have ${totalSessions}`,
        },
      };
    }

    // Gate 3: Necessity
    const necessityDrop = context.accuracyWithStructure - context.accuracyWithoutStructure;
    const necessity = necessityDrop >= NECESSITY_THRESHOLD;
    details.necessity = `Drop without structure: ${(necessityDrop * 100).toFixed(1)}% (threshold: ${(NECESSITY_THRESHOLD * 100).toFixed(0)}%)`;
    if (!necessity) {
      blockedBy.push(`Necessity failed: accuracy drop ${(necessityDrop * 100).toFixed(1)}% < ${(NECESSITY_THRESHOLD * 100).toFixed(0)}%`);
    }

    // Gate 4: Sufficiency — structure must achieve meaningful absolute accuracy
    const sufficiency = context.accuracyWithStructure >= 0.65;
    details.sufficiency = `Absolute accuracy with structure: ${(context.accuracyWithStructure * 100).toFixed(1)}% (threshold: ≥65%)`;
    if (!sufficiency) {
      blockedBy.push(`Sufficiency failed: accuracy ${(context.accuracyWithStructure * 100).toFixed(1)}% < 65%`);
    }

    // Gate 5: Parsimony — check if simpler alternatives achieve comparable accuracy
    let parsimony = true;
    for (const altId of context.alternativeStructureIds) {
      const altAcc = context.alternativeAccuracies.get(altId);
      if (altAcc !== undefined && altAcc >= context.accuracyWithStructure - PARSIMONY_ACCURACY_TOLERANCE) {
        details.parsimony = `Alternative ${altId} accuracy (${(altAcc * 100).toFixed(1)}%) ≥ current (${(context.accuracyWithStructure * 100).toFixed(1)}%) — potentially simpler`;
        parsimony = false;
        blockedBy.push(`Parsimony: ${altId} achieves comparable accuracy with potentially simpler structure`);
        break;
      }
    }
    if (parsimony) {
      details.parsimony = "No alternative with comparable accuracy found";
    }

    const passed = necessity && sufficiency && parsimony;
    return { necessity, sufficiency, parsimony, passed, blockedBy, details };
  }
}
