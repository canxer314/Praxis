/**
 * Semantic Disambiguator — M2 Step 5: 跨场景语义消歧 (P2)
 *
 * 维护同形异义词注册表，在 message_received 时用场景上下文消歧。
 * 例如"对接": API 场景→系统集成, 干系人场景→会议确认。
 *
 * 架构参考: architech/praxis-architecture.md §7.5 (跨场景语义消歧)
 */

import type { ScenarioMatch } from "./cognitive/types";

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** 同形异义词条目 */
export interface HomographEntry {
  /** 歧义词 */
  term: string;
  /** 场景 → 含义映射 */
  meanings: Record<string, string>;
  /** 默认含义（无场景匹配时使用） */
  defaultMeaning: string;
}

/** 消歧结果 */
export interface DisambiguationResult {
  term: string;
  meaning: string;
  matchedScenario: string | null;
  /** 是否成功匹配到场景 */
  resolved: boolean;
}

// ══════════════════════════════════════════════════════════════════
// 内置注册表
// ══════════════════════════════════════════════════════════════════

const BUILTIN_HOMOGRAPHS: HomographEntry[] = [
  {
    term: "对接",
    meanings: {
      api_design: "系统/API 之间的集成连接",
      stakeholder_communication: "与干系人的会议确认或需求对齐",
      code_review: "代码模块之间的接口对接",
    },
    defaultMeaning: "两个系统或人员之间的连接与协调",
  },
  {
    term: "上线",
    meanings: {
      deployment: "将代码部署到生产环境",
      product_launch: "产品/功能正式对外发布",
    },
    defaultMeaning: "将系统或功能投入正式运行",
  },
  {
    term: "review",
    meanings: {
      code_review: "代码审查（检查代码质量和安全性）",
      stakeholder_communication: "需求评审或设计评审",
    },
    defaultMeaning: "审查、检查",
  },
];

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 在给定场景下消歧一个词。
 *
 * @param term      待消歧的词
 * @param scenarios 当前活跃场景列表（按置信度降序）
 * @param custom    额外的自定义同形异义词注册表（追加到内置）
 * @returns 消歧结果
 */
export function disambiguate(
  term: string,
  scenarios: ScenarioMatch[],
  custom: HomographEntry[] = [],
): DisambiguationResult {
  const registry = [...BUILTIN_HOMOGRAPHS, ...custom];
  const entry = registry.find(
    (e) => e.term.toLowerCase() === term.toLowerCase(),
  );

  if (!entry) {
    return { term, meaning: "", matchedScenario: null, resolved: false };
  }

  // 按场景置信度降序遍历，找第一个匹配的含义
  for (const sc of scenarios) {
    const meaning = entry.meanings[sc.scenarioId];
    if (meaning) {
      return { term, meaning, matchedScenario: sc.scenarioId, resolved: true };
    }
  }

  // 无场景匹配 → 使用默认含义
  return {
    term,
    meaning: entry.defaultMeaning,
    matchedScenario: null,
    resolved: false,
  };
}

/**
 * 在文本中查找所有同形异义词并消歧。
 *
 * @param text      用户消息文本
 * @param scenarios 当前活跃场景
 * @param custom    自定义注册表
 * @returns 消歧结果列表（仅包含在文本中出现的词）
 */
export function disambiguateText(
  text: string,
  scenarios: ScenarioMatch[],
  custom: HomographEntry[] = [],
): DisambiguationResult[] {
  const registry = [...BUILTIN_HOMOGRAPHS, ...custom];
  const results: DisambiguationResult[] = [];

  for (const entry of registry) {
    if (text.toLowerCase().includes(entry.term.toLowerCase())) {
      results.push(disambiguate(entry.term, scenarios, custom));
    }
  }

  return results;
}

/**
 * 注册自定义同形异义词。
 */
export function registerHomographs(
  custom: HomographEntry[],
): HomographEntry[] {
  return [...BUILTIN_HOMOGRAPHS, ...custom];
}

/**
 * 格式化消歧提示为 LLM 上下文注入文本。
 */
export function formatDisambiguationHint(results: DisambiguationResult[]): string {
  if (results.length === 0) return "";

  const resolved = results.filter((r) => r.resolved);
  if (resolved.length === 0) return "";

  const lines: string[] = [
    "## 语义消歧",
    "当前场景下以下术语具有特定含义:",
    "",
  ];

  for (const r of resolved) {
    lines.push(`- **${r.term}**: ${r.meaning} (场景: ${r.matchedScenario})`);
  }

  return lines.join("\n");
}
