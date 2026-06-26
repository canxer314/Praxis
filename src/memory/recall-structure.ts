/**
 * Recall Structure — M2 Step 2.2: Lazy Loading 结构召回
 *
 * 在 Critical 压力模式下，LLM 按需调用 recall_structure 拉取结构详情。
 * AgentMemory 不可用时降级到 local-cache。
 *
 * 架构参考: architech/praxis-architecture.md §7.2 (Critical 模式 Lazy Loading)
 */

import type { M0Deps } from "../m0-deps";
import type { Result } from "../platform-adapter";

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

/** 召回的结构详情 */
export interface RecalledStructure {
  id: string;
  tentativeName: string;
  protoType: string;
  confidence: number;
  scenarioId: string;
  summary: string;
  /** 从 AgentMemory 加载的原始数据 */
  raw: Record<string, unknown>;
}

/** 结构索引条目 — Critical 模式下注入的轻量索引 */
export interface StructureIndexEntry {
  id: string;
  tentativeName: string;
  protoType: string;
  /** 一行描述，供 LLM 判断是否需要召回 */
  hint: string;
}

// ══════════════════════════════════════════════════════════════════
// 公开 API
// ══════════════════════════════════════════════════════════════════

/**
 * 按名称或 ID 召回结构的完整详情。
 *
 * 查找顺序: 精确名称 → 精确 ID → 模糊名称包含匹配
 * AgentMemory 不可用时降级到 local-cache。
 *
 * @param deps   M0Deps（需要 memory 和 cache 子系统）
 * @param query  结构名称或 ID
 * @returns 结构详情，找不到时返回 null
 */
export async function recallStructure(
  deps: M0Deps,
  query: string,
): Promise<RecalledStructure | null> {
  const amAvailable = await deps.memory.isAvailable();

  if (amAvailable) {
    return recallFromAgentMemory(deps, query);
  }

  return recallFromLocalCache(deps, query);
}

/**
 * 构建 Critical 模式下注入的结构索引（轻量列表）。
 *
 * 每个条目仅包含 id + 名称 + 类型 + hint，~50 tokens/条。
 * LLM 看到索引后通过 recall_structure 按需拉取详情。
 *
 * @param structures  待索引的结构列表（来自 context-organizer 的 Tier A items）
 * @returns 结构索引条目列表
 */
export function buildStructureIndex(
  structures: { id: string; tentativeName: string; protoType: string; description: string }[],
): StructureIndexEntry[] {
  return structures.map((s) => ({
    id: s.id,
    tentativeName: s.tentativeName,
    protoType: s.protoType,
    // 取描述的第一行作 hint（~30 chars）
    hint: s.description.split("\n")[0]?.slice(0, 80) ?? s.tentativeName,
  }));
}

/**
 * 格式化结构索引为 LLM 可读文本。
 */
export function formatStructureIndex(index: StructureIndexEntry[]): string {
  if (index.length === 0) return "";

  const lines: string[] = [
    "## ProtoStructure 索引 (Critical 模式)",
    "以下结构可按需召回。使用 `recall_structure(\"名称或ID\")` 获取详情。",
    "",
  ];

  for (const entry of index) {
    const typeLabel = protoTypeLabel(entry.protoType);
    lines.push(`- [${typeLabel}] **${entry.tentativeName}** — ${entry.hint} (id: ${entry.id})`);
  }

  return lines.join("\n");
}

/**
 * 格式化召回的结构为 LLM 可读文本。
 */
export function formatRecalledStructure(struct: RecalledStructure): string {
  const typeLabel = protoTypeLabel(struct.protoType);
  const lines: string[] = [
    `## 结构召回: ${struct.tentativeName}`,
    "",
    `- **类型**: [${typeLabel}] ${struct.protoType}`,
    `- **置信度**: ${(struct.confidence * 100).toFixed(0)}%`,
    `- **场景**: ${struct.scenarioId || "未指定"}`,
    `- **摘要**: ${struct.summary}`,
    `- **ID**: ${struct.id}`,
  ];

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════
// 内部
// ══════════════════════════════════════════════════════════════════

async function recallFromAgentMemory(
  deps: M0Deps,
  query: string,
): Promise<RecalledStructure | null> {
  try {
    // 先尝试精确名称搜索
    const result: Result<unknown[]> = await deps.memory.smartSearch(query, "proto_structure");
    if (!result.ok || !Array.isArray(result.value) || result.value.length === 0) {
      return null;
    }

    // 取最佳匹配（按名称精确匹配优先）
    const items = result.value as Record<string, unknown>[];
    const exact = items.find(
      (item) => String(item.tentativeName ?? item.tentative_name ?? "") === query,
    );
    const match = exact ?? items[0];

    return {
      id: String(match.id ?? ""),
      tentativeName: String(match.tentativeName ?? match.tentative_name ?? ""),
      protoType: String(match.protoType ?? match.proto_type ?? ""),
      confidence: Number(match.confidence ?? 0),
      scenarioId: String(match.scenarioId ?? match.scenario_id ?? ""),
      summary: buildSummary(match),
      raw: match,
    };
  } catch {
    deps.logger?.warn("recallStructure: AgentMemory lookup failed", { query });
    return null;
  }
}

async function recallFromLocalCache(
  deps: M0Deps,
  query: string,
): Promise<RecalledStructure | null> {
  try {
    // 遍历 local-cache 查找匹配的结构
    const entries = deps.cache.list();
    for (const entry of entries) {
      if (!entry.key.startsWith("proto_structure_")) continue;
      const item = entry.value as Record<string, unknown> | undefined;
      if (!item) continue;

      const name = String(item.tentativeName ?? item.tentative_name ?? "");
      const id = String(item.id ?? "");
      if (name === query || id === query || name.includes(query)) {
        return {
          id,
          tentativeName: name,
          protoType: String(item.protoType ?? item.proto_type ?? ""),
          confidence: Number(item.confidence ?? 0),
          scenarioId: String(item.scenarioId ?? item.scenario_id ?? ""),
          summary: buildSummary(item),
          raw: item,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function buildSummary(item: Record<string, unknown>): string {
  const protoType = String(item.protoType ?? item.proto_type ?? "");
  switch (protoType) {
    case "sequence": {
      const structure = item.structure as { steps?: { action: string }[] } | undefined;
      if (structure?.steps?.length) {
        return structure.steps.map((s) => s.action).join(" → ");
      }
      return String(item.tentativeName ?? "");
    }
    case "constraint":
      return `[${String(item.severity ?? "warn")}] ${String(item.tentativeName ?? "")}`;
    default:
      return String(item.tentativeName ?? "");
  }
}

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
