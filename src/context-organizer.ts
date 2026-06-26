/**
 * Context Organizer — M2 Step 1: Tier A/B/C 分层上下文编排
 *
 * 纯函数模块。接收 ProtoStructures + 场景 + TaskContext → 返回排序分层的 Tier 列表。
 * 不调用外部服务，不做 I/O。
 *
 * 排序权重: 场景匹配度 × 0.55 + 任务相关性 × 0.35 + 信号推荐 × 0.10
 *
 * 架构参考: architech/praxis-architecture.md §7 (上下文编排系统)
 */

import type { ScenarioMatch } from "./cognitive/types";
import { estimateTokens } from "./cognitive/context";
import { getInjectionStrategy } from "./context-pressure-monitor";
import type { PressureLevel, MaturityLevel } from "./context-pressure-monitor";

// Re-export for backward compatibility
export type { PressureLevel, MaturityLevel };

/** 单个待编排的结构条目（从 AgentMemory 加载后的简化形式） */
export interface ContextStructure {
  id: string;
  tentativeName: string;
  protoType: string;
  confidence: number;
  scenarioId: string;
  summary: string;
  /** 注意力遥测 — M2 Step 3 将填充，当前使用 confidence 作代理 */
  adoptionRate?: number;
}

/** 单个分层中的条目 */
export interface TierEntry {
  id: string;
  tentativeName: string;
  protoType: string;
  confidence: number;
  scenarioId: string;
  /** Tier A: 完整摘要; Tier B: 压缩摘要; Tier C: 一行描述 */
  description: string;
}

/** 一个上下文分层 */
export interface ContextTier {
  items: TierEntry[];
  /** 估算 token 数 */
  totalTokens: number;
}

/** organizeContext 输入 */
export interface OrganizeContextInput {
  structures: ContextStructure[];
  scenarios: ScenarioMatch[];
  taskContext?: {
    taskId?: string;
    name?: string;
    currentPhase?: string;
    relevantScenarios?: string[];
  } | null;
  pressure?: PressureLevel;
  maturity?: MaturityLevel;
}

/** organizeContext 输出 */
export interface OrganizeContextOutput {
  tierA: ContextTier;
  tierB: ContextTier;
  tierC: ContextTier;
  /** 元信息：使用的压力级别和成熟度 */
  meta: {
    pressure: PressureLevel;
    maturity: MaturityLevel;
    totalStructures: number;
  };
}

// ══════════════════════════════════════════════════════════════════
// 权重常量
// ══════════════════════════════════════════════════════════════════

const W_SCENE = 0.55;
const W_TASK = 0.35;
const W_SIGNAL = 0.10;

/** Tier A 最低分数阈值 */
const TIER_A_THRESHOLD = 0.5;
/** Tier B 最低分数阈值 */
const TIER_B_THRESHOLD = 0.2;

/** 认知成熟度 → 描述详细程度乘数 */
const MATURITY_DETAIL_MULTIPLIER: Record<MaturityLevel, number> = {
  novice: 0.6,
  competent: 1.0,
  expert: 1.4,
};

// 压力压缩率由 context-pressure-monitor.ts 的 getInjectionStrategy() 统一管理
// — 此处不再重复定义，避免双源头分歧

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 将 ProtoStructure 列表编排为 Tier A/B/C 分层。
 *
 * 纯函数 — 无副作用，无 I/O。
 *
 * @returns 排序分层的上下文 Tier，包含每个 Tier 的条目和估算 token 数
 */
export function organizeContext(input: OrganizeContextInput): OrganizeContextOutput {
  const pressure = input.pressure ?? "normal";
  const maturity = input.maturity ?? "competent";
  const scenarios = input.scenarios ?? [];
  const taskContext = input.taskContext ?? null;

  // 1. 为每个结构计算相关性分数
  const scored = input.structures.map((s) => ({
    structure: s,
    score: calculateScore(s, scenarios, taskContext),
  }));

  // 2. 按分数降序排序
  scored.sort((a, b) => b.score - a.score);

  // 3. 分配到 Tier
  const tierAItems: (typeof scored)[0][] = [];
  const tierBItems: (typeof scored)[0][] = [];
  const tierCItems: (typeof scored)[0][] = [];

  for (const item of scored) {
    if (item.score >= TIER_A_THRESHOLD) {
      tierAItems.push(item);
    } else if (item.score >= TIER_B_THRESHOLD) {
      tierBItems.push(item);
    } else {
      tierCItems.push(item);
    }
  }

  // 4. 按压力级别压缩 Tier B 和 Tier C（策略由 context-pressure-monitor 统一管理）
  const strategy = getInjectionStrategy(pressure);
  const tierBRetention = strategy.tierBRetention;
  const tierCRetention = strategy.tierCRetention;

  const retainedTierB = tierBRetention < 1
    ? tierBItems.slice(0, Math.max(1, Math.ceil(tierBItems.length * tierBRetention)))
    : tierBItems;

  const retainedTierC = tierCRetention < 1
    ? tierCItems.slice(0, Math.max(0, Math.ceil(tierCItems.length * tierCRetention)))
    : tierCItems;

  // 5. 格式化每个 Tier 的描述（按成熟度调整详细程度）
  const detailMult = MATURITY_DETAIL_MULTIPLIER[maturity];

  return {
    tierA: formatTier(tierAItems.map((x) => x.structure), "full", detailMult),
    tierB: formatTier(retainedTierB.map((x) => x.structure), "summary", detailMult),
    tierC: formatTier(retainedTierC.map((x) => x.structure), "oneliner", detailMult),
    meta: {
      pressure,
      maturity,
      totalStructures: input.structures.length,
    },
  };
}

// ══════════════════════════════════════════════════════════════════
// 评分算法
// ══════════════════════════════════════════════════════════════════

/**
 * 计算单个结构的相关性分数。
 *
 * score = sceneMatch × 0.55 + taskRelevance × 0.35 + signalRecommend × 0.10
 */
function calculateScore(
  structure: ContextStructure,
  scenarios: ScenarioMatch[],
  taskContext: OrganizeContextInput["taskContext"],
): number {
  const sceneMatch = calcSceneMatch(structure, scenarios);
  const taskRelevance = calcTaskRelevance(structure, taskContext);
  const signalRecommend = calcSignalRecommend(structure);

  return sceneMatch * W_SCENE + taskRelevance * W_TASK + signalRecommend * W_SIGNAL;
}

/**
 * 场景匹配度: 结构所属场景与当前活跃场景的重合度。
 *
 * - 精确匹配活跃场景 → 1.0
 * - 结构 scenarioId 与某个活跃场景的 scenarioId 前缀匹配 → 0.6
 * - 无匹配 → 0.0
 */
function calcSceneMatch(structure: ContextStructure, scenarios: ScenarioMatch[]): number {
  if (scenarios.length === 0) return 0.3; // 无场景信息时给予中性分数

  for (const sc of scenarios) {
    if (structure.scenarioId === sc.scenarioId) {
      return sc.confidence; // 使用场景识别置信度作为匹配强度
    }
  }

  // 前缀匹配（例如 "api_design" 匹配 "api_design_v2"）
  for (const sc of scenarios) {
    if (structure.scenarioId.startsWith(sc.scenarioId) || sc.scenarioId.startsWith(structure.scenarioId)) {
      return sc.confidence * 0.6;
    }
  }

  return 0.0;
}

/**
 * 任务相关性: 结构与当前任务上下文的关联度。
 *
 * - 结构的 scenarioId 在 TaskContext.relevantScenarios 中 → 1.0
 * - TaskContext 未提供 → 0.3（中性分数）
 * - 无关联 → 0.0
 */
function calcTaskRelevance(
  structure: ContextStructure,
  taskContext: OrganizeContextInput["taskContext"],
): number {
  if (!taskContext) return 0.3; // 无 TaskContext 时中性分数

  const relevant = taskContext.relevantScenarios;
  if (!relevant || relevant.length === 0) return 0.3;

  if (relevant.includes(structure.scenarioId)) return 1.0;

  // 前缀匹配
  for (const rs of relevant) {
    if (structure.scenarioId.startsWith(rs) || rs.startsWith(structure.scenarioId)) {
      return 0.6;
    }
  }

  return 0.0;
}

/**
 * 信号推荐度: 结构被"推荐"的强度。
 *
 * M2 Step 1 简化版: 使用 confidence 作代理。
 * M2 Step 3 将替换为 attention-telemetry 的真实 adoptionRate + 僵尸检测信号。
 */
function calcSignalRecommend(structure: ContextStructure): number {
  // 使用 adoptionRate（如果可用），否则用 confidence 作代理
  if (typeof structure.adoptionRate === "number") {
    return Math.min(1, Math.max(0, structure.adoptionRate));
  }
  // confidence 作代理: 高置信度的结构更"值得推荐"
  return Math.min(1, Math.max(0, structure.confidence));
}

// ══════════════════════════════════════════════════════════════════
// Tier 格式化
// ══════════════════════════════════════════════════════════════════

type FormatLevel = "full" | "summary" | "oneliner";

/**
 * 将结构列表格式化为 ContextTier。
 *
 * @param structures 该 Tier 的结构列表
 * @param level      详细程度
 * @param detailMult 成熟度乘数（>1 = 更详细，<1 = 更简洁）
 */
function formatTier(
  structures: ContextStructure[],
  level: FormatLevel,
  detailMult: number,
): ContextTier {
  const items: TierEntry[] = structures.map((s) => ({
    id: s.id,
    tentativeName: s.tentativeName,
    protoType: s.protoType,
    confidence: s.confidence,
    scenarioId: s.scenarioId,
    description: formatDescription(s, level, detailMult),
  }));

  return {
    items,
    totalTokens: estimateTierTokens(items),
  };
}

/**
 * 按详细级别 + 成熟度格式化单个结构的描述文本。
 */
function formatDescription(s: ContextStructure, level: FormatLevel, detailMult: number): string {
  switch (level) {
    case "full":
      return formatFull(s, detailMult);
    case "summary":
      return formatSummary(s);
    case "oneliner":
      return formatOneliner(s);
  }
}

/** Tier A: 全量详情 */
function formatFull(s: ContextStructure, detailMult: number): string {
  const parts: string[] = [];

  // 名称 + 类型标签
  const typeLabel = protoTypeLabel(s.protoType);
  parts.push(`[${typeLabel}] ${s.tentativeName}`);

  // 置信度（Expert 模式下展示数值）
  if (detailMult >= 1.0) {
    parts.push(`  confidence: ${(s.confidence * 100).toFixed(0)}%`);
  }

  // 摘要
  if (s.summary) {
    parts.push(`  ${s.summary}`);
  }

  // Expert 模式: 附加元数据
  if (detailMult >= 1.4) {
    parts.push(`  id: ${s.id}`);
    if (typeof s.adoptionRate === "number") {
      parts.push(`  adoption: ${(s.adoptionRate * 100).toFixed(0)}%`);
    }
  }

  return parts.join("\n");
}

/** Tier B: 摘要 + 引用 ID */
function formatSummary(s: ContextStructure): string {
  const typeLabel = protoTypeLabel(s.protoType);
  const summary = s.summary
    ? s.summary.length > 80
      ? s.summary.slice(0, 80) + "…"
      : s.summary
    : s.tentativeName;
  return `[${typeLabel}] ${s.tentativeName}: ${summary} (ref: ${s.id})`;
}

/** Tier C: 名称 + 一行描述 */
function formatOneliner(s: ContextStructure): string {
  const typeLabel = protoTypeLabel(s.protoType);
  return `[${typeLabel}] ${s.tentativeName} — ${s.summary.slice(0, 60) || s.protoType}`;
}

/** ProtoType → 中文标签 */
function protoTypeLabel(protoType: string): string {
  switch (protoType) {
    case "sequence":   return "流程";
    case "role":       return "角色";
    case "concept":    return "概念";
    case "purpose":    return "目标";
    case "constraint": return "约束";
    default:           return protoType;
  }
}

// ══════════════════════════════════════════════════════════════════
// Token 估算
// ══════════════════════════════════════════════════════════════════

/**
 * 估算一个 Tier 的总 token 数。
 * 使用 context.ts 的 estimateTokens（CJK 感知）。
 */
function estimateTierTokens(items: TierEntry[]): number {
  let total = 0;
  for (const item of items) {
    total += estimateTokens(item.description);
    // 每个条目额外 ~5 token 的结构开销
    total += 5;
  }
  return Math.ceil(total);
}
