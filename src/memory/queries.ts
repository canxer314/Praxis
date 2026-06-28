/**
 * memory/queries.ts — 复合查询封装
 *
 * 封装常见复合查询，替代散落在各模块中的 query 字符串拼接:
 *   - 获取所有 crystallized 结构
 *   - 按场景检索相关结构
 *   - 获取最近 N 天的 lessons
 *   - 获取 stale 结构
 *
 * 这些查询字符串供 AgentMemory smart_search 使用。
 *
 * 架构参考: §11 memory/queries.ts
 */

/**
 * 查询所有已结晶的结构，可选场景过滤。
 */
export function buildCrystallizedStructuresQuery(scenarioId?: string): string {
  let q = "crystallized proto_structures with high confidence";
  if (scenarioId) {
    q += ` related to ${scenarioId}`;
  }
  return q;
}

/**
 * 查询特定场景下的特定类型结构。
 */
export function buildScenarioStructuresQuery(
  scenarioId: string,
  protoType?: string,
): string {
  let q = `proto_structures for scenario ${scenarioId}`;
  if (protoType) {
    q += ` of type ${protoType}`;
  }
  return q;
}

/**
 * 查询最近 N 天的学习经验。
 */
export function buildRecentLessonsQuery(days: number): string {
  return `lessons from the last ${days} days`;
}

/**
 * 查询 stale 结构（N 天未引用）。
 */
export function buildStaleStructuresQuery(days: number): string {
  return `proto_structures not referenced for ${days} days — stale candidates`;
}
