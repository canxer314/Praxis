/**
 * Scenario Registry — 种子场景注册表 (Phase 0)
 *
 * 职责:
 *   - 定义手动策划的场景分类法（"我在做什么"的认知分类）
 *   - 为 scene-recognizer 提供匹配目标
 *   - 生命周期: 手动种子 → LLM 自动发现（数据积累后演化）
 *
 * Phase 0 策略:
 *   手动定义核心场景（精度优先），每个场景有典型工具链和领域标签。
 *   LLM 场景识别用这些种子作为 1-vs-N 分类的候选集。
 *
 * 演化路径:
 *   当前: 手动定义 3-5 个场景
 *   未来: 数据积累后 LLM 自动发现新场景 → 补充到注册表
 */

import type { ProtoStructureSeed } from "./types";

/**
 * 种子场景注册表。
 *
 * 每个条目: { scenarioId, tentativeName, protoType, typicalTools, typicalDomains }
 *
 * 设计原则:
 *   - 场景按"用户在做什么"分类，不是按"学到了什么"分类
 *   - typicalTools 是此场景下最常使用的 Claude Code 工具/技能
 *   - typicalDomains 是此场景关联的业务/技术领域标签
 */
export const SEED_SCENARIOS: ProtoStructureSeed[] = [
  {
    scenarioId: "backend_api_development",
    tentativeName: "后端 API 开发",
    protoType: "sequence",
    typicalTools: ["Write", "Edit", "Read", "Grep", "PowerShell", "codegraph_explore"],
    typicalDomains: ["backend", "api", "typescript", "nodejs"],
  },
  {
    scenarioId: "architecture_design",
    tentativeName: "架构设计与技术决策",
    protoType: "concept",
    typicalTools: ["Read", "Grep", "codegraph_explore", "codegraph_impact", "Skill"],
    typicalDomains: ["architecture", "system-design", "technical-decision"],
  },
  {
    scenarioId: "bug_investigation",
    tentativeName: "Bug 排查与修复",
    protoType: "sequence",
    typicalTools: ["Grep", "Read", "Edit", "codegraph_callers", "codegraph_callees", "PowerShell"],
    typicalDomains: ["debugging", "bug-fix", "troubleshooting"],
  },
  {
    scenarioId: "ai_agent_development",
    tentativeName: "AI Agent / Praxis 开发",
    protoType: "purpose",
    typicalTools: ["Write", "Edit", "Read", "Agent", "Skill", "Glob", "Grep"],
    typicalDomains: ["ai-agent", "praxis", "claude-code", "cognitive-architecture"],
  },
  {
    scenarioId: "document_writing",
    tentativeName: "文档与报告撰写",
    protoType: "sequence",
    typicalTools: ["Write", "Read", "pptx", "docx", "pdf", "make-pdf"],
    typicalDomains: ["documentation", "report", "presentation"],
  },
];

/**
 * 按 scenarioId 查找种子场景。
 * @returns ProtoStructureSeed 或 undefined（未知场景 ID）
 */
export function getSeedScenario(scenarioId: string): ProtoStructureSeed | undefined {
  return SEED_SCENARIOS.find((s) => s.scenarioId === scenarioId);
}

/**
 * 验证种子场景的结构完整性。
 * 用于测试和启动时健康检查。
 */
export function validateSeedScenarios(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const s of SEED_SCENARIOS) {
    if (!s.scenarioId || typeof s.scenarioId !== "string") {
      errors.push(`场景缺少 scenarioId`);
      continue;
    }
    if (seenIds.has(s.scenarioId)) {
      errors.push(`重复的 scenarioId: ${s.scenarioId}`);
    }
    seenIds.add(s.scenarioId);

    if (!s.tentativeName) errors.push(`${s.scenarioId}: 缺少 tentativeName`);
    if (!["sequence", "role", "concept", "purpose"].includes(s.protoType)) {
      errors.push(`${s.scenarioId}: 无效的 protoType: ${s.protoType}`);
    }
    if (!Array.isArray(s.typicalTools) || s.typicalTools.length === 0) {
      errors.push(`${s.scenarioId}: typicalTools 为空`);
    }
    if (!Array.isArray(s.typicalDomains) || s.typicalDomains.length === 0) {
      errors.push(`${s.scenarioId}: typicalDomains 为空`);
    }
  }

  return { valid: errors.length === 0, errors };
}
