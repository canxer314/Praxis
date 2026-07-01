/**
 * Praxis Bootstrap — Phase 1B, 从 agentmemory raw data 合成初始认知模型
 *
 * 职责:
 *   - 检测 competency_model 是否存在（sentinel: praxis_bootstrap_done）
 *   - 从 agentmemory lessons + semantic memories 收集原始数据
 *   - 通过词袋关键词→8D 映射合成初始 competency_model
 *   - 可选 LLM 增强路径
 *   - 通过 sentinel 保证写入幂等（最后写 sentinel 标记全部完成）
 *   - 部分写入恢复：下次运行时若 sentinel 缺失但 model 存在 → 补写缺失 slot
 *
 * 入口: bootstrapIfNeeded(deps: M0Deps) → BootResult
 * 调用方: CronTickHandler.handle() (每次 cron_tick)，或手动 npm run praxis:bootstrap
 */

import type { M0Deps } from "../m0-deps";
import type { Result } from "../platform-adapter";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface BootResult {
  bootstrapped: boolean;
  skipped?: boolean;
  dimensions?: number;
  error?: string;
}

interface LessonItem {
  content: string;
  confidence: number;
  tags: string[];
  source: string;
}

interface CompetencyDimension {
  selfRating: number;
  taskCount: number;
}

interface CompetencyModel {
  domainProficiencies: Record<string, CompetencyDimension>;
  strongestDomains: string[];
  weakestDomains: string[];
  currentLearningFocus: string | null;
  source: string;
  generatedAt: number;
}

// ══════════════════════════════════════════════════════════════════
// 8D 关键词映射表
// ══════════════════════════════════════════════════════════════════

const KEYWORD_TO_8D: Array<{ dimension: string; patterns: RegExp[] }> = [
  {
    dimension: "tool_skills",
    patterns: [
      /typescript|javascript|python|rust|go|bash|powershell/i,
      /build|bundle|compile|transpile/i,
      /test|vitest|jest|mocha/i,
      /tool|工具|cli|command/i,
    ],
  },
  {
    dimension: "domain_familiarity",
    patterns: [
      /架构|architecture|系统设计|system.design/i,
      /agent|智能体|ai.agent|llm/i,
      /obsidian|vault|note|笔记/i,
      /认知|cognitive|ontology|本体/i,
    ],
  },
  {
    dimension: "task_type_proficiency",
    patterns: [
      /任务|task|schedule|计划|todo/i,
      /项目管理|project/i,
      /评审|review|audit|审计/i,
      /研究|research|调研|分析/i,
    ],
  },
  {
    dimension: "user_model_confidence",
    patterns: [
      /用户|user|偏好|preference/i,
      /纠正|correction|fix|修复/i,
      /反馈|feedback|采纳|adopt/i,
    ],
  },
  {
    dimension: "process_management",
    patterns: [
      /流程|process|workflow|工作流/i,
      /审批|approval|gate/i,
      /部署|deploy|ship|发布/i,
      /分支|branch|merge|合并/i,
    ],
  },
  {
    dimension: "action_reliability",
    patterns: [
      /执行|execute|action|操作/i,
      /工具调用|tool.call|mcp/i,
      /读取|read|写入|write|编辑|edit/i,
      /文件|file|搜索|search/i,
    ],
  },
  {
    dimension: "proto_cognition",
    patterns: [
      /学习|learn|pattern|模式/i,
      /lesson|insight|发现/i,
      /结构|structure|proto/i,
      /记忆|memory|知识|knowledge/i,
    ],
  },
  {
    dimension: "learning_velocity",
    patterns: [
      /迭代|iterate|improve|优化/i,
      /成长|growth|进化|evolve/i,
      /速度|velocity|效率|efficiency/i,
      /重构|refactor|版本|version/i,
    ],
  },
];

// 8D dimension key → Chinese label (与 praxis-status.ts DIMENSION_LABELS 对齐)
const DIMENSION_LABELS: Record<string, string> = {
  tool_skills: "工具熟练度",
  domain_familiarity: "领域熟悉度",
  task_type_proficiency: "任务熟练度",
  user_model_confidence: "用户模型",
  process_management: "流程管理",
  action_reliability: "行动可靠性",
  proto_cognition: "原型认知",
  learning_velocity: "学习速度",
};

// ══════════════════════════════════════════════════════════════════
// 中文停用词
// ══════════════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
  "自己", "这", "他", "她", "它", "们", "那", "些", "所", "为", "所以", "因为",
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with",
  "at", "by", "from", "as", "into", "through", "during", "before", "after",
  "this", "that", "these", "those", "it", "its", "and", "but", "or", "not",
  "no", "if", "then", "else", "when", "where", "which", "who", "whom",
  "what", "how", "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "only", "own", "same", "so", "than", "too",
  "very", "just", "about", "also", "now", "here", "there",
]);

// ══════════════════════════════════════════════════════════════════
// 公开入口
// ══════════════════════════════════════════════════════════════════

/**
 * 从 agentmemory raw data 合成初始 competency_model。
 * 幂等：通过 praxis_bootstrap_done sentinel 保证。
 * 仅在 cron_tick 首次运行时自动触发，也可手动调用。
 */
export async function bootstrapIfNeeded(deps: M0Deps): Promise<BootResult> {
  // 1. 检查是否需要 bootstrap
  const checkResult = await checkIfNeeded(deps);
  if (checkResult.skipped) return checkResult;

  try {
    // 2. 收集原始数据
    const rawData = await collectRawData(deps);

    // 3. 合成 competency model
    const competencyModel = synthesizeCompetencyModel(rawData, deps);

    // 4-5. 写入 slots（sentinel 最后写）
    await writeSlotsWithSentinel(deps, competencyModel, rawData.lessonCount);

    return {
      bootstrapped: true,
      dimensions: Object.keys(competencyModel.domainProficiencies).length,
    };
  } catch (err) {
    return {
      bootstrapped: false,
      error: String(err),
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// Step 1: checkIfNeeded
// ══════════════════════════════════════════════════════════════════

async function checkIfNeeded(deps: M0Deps): Promise<BootResult> {
  // 检查 sentinel
  try {
    const sentinelResult = await deps.memory.getSlot("praxis_bootstrap_done");
    if (sentinelResult.ok && sentinelResult.value === true) {
      return { bootstrapped: false, skipped: true };
    }
  } catch {
    // 读取失败 → 继续尝试 bootstrap
  }

  // 兜底: sentinel 缺失但 competency_model 存在 → 部分写入恢复
  try {
    const modelResult = await deps.memory.getSlot("competency_model");
    if (modelResult.ok && modelResult.value) {
      // 部分写入恢复: 补写缺失的 slot
      await recoverPartialWrite(deps, modelResult.value as CompetencyModel);
      return { bootstrapped: false, skipped: true };
    }
  } catch {
    // 继续正常 bootstrap
  }

  return { bootstrapped: false };
}

/**
 * 部分写入恢复: sentinel 缺失但 competency_model 存在 →
 * 补写 snapshots + audit_log + sentinel
 */
async function recoverPartialWrite(
  deps: M0Deps,
  competencyModel: CompetencyModel,
): Promise<void> {
  const now = Date.now();
  try {
    await deps.memory.setSlot("competency_snapshots", [
      { ...competencyModel, timestamp: now },
    ]);
  } catch { /* best-effort */ }
  try {
    await deps.memory.setSlot("audit_log", {
      entries: [{
        timestamp: now,
        type: "bootstrap_recovery",
        severity: "info",
        detail: { source: "partial_write_recovery" },
      }],
    });
  } catch { /* best-effort */ }
  try {
    await deps.memory.setSlot("praxis_bootstrap_done", true);
  } catch { /* best-effort */ }
}

// ══════════════════════════════════════════════════════════════════
// Step 2: collectRawData
// ══════════════════════════════════════════════════════════════════

interface RawData {
  lessons: LessonItem[];
  lessonCount: number;
}

async function collectRawData(deps: M0Deps): Promise<RawData> {
  const lessons: LessonItem[] = [];

  // 优先使用 searchLessons (专用 lessons 端点)
  if (deps.memory.searchLessons) {
    try {
      const result = await deps.memory.searchLessons("*", 50, 0.3);
      if (result.ok && result.value) {
        lessons.push(...result.value);
      }
    } catch {
      // 降级到 smartSearch
    }
  }

  // 降级: smartSearch 语义搜索
  if (lessons.length === 0) {
    try {
      const result = await deps.memory.smartSearch(
        "praxis preference correction pattern architecture",
      );
      if (result.ok && Array.isArray(result.value)) {
        for (const item of result.value as Array<Record<string, unknown>>) {
          lessons.push({
            content: String(item.content ?? ""),
            confidence: Number(item.confidence ?? 0.5),
            tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
            source: String(item.source ?? "smartsearch"),
          });
        }
      }
    } catch {
      // 两个路径都失败，lessonCount=0，使用 DEFAULT_COMPETENCY
    }
  }

  return { lessons, lessonCount: lessons.length };
}

// ══════════════════════════════════════════════════════════════════
// Step 3: synthesizeCompetencyModel
// ══════════════════════════════════════════════════════════════════

function synthesizeCompetencyModel(
  rawData: RawData,
  deps: M0Deps,
): CompetencyModel {
  const { lessons } = rawData;

  if (lessons.length === 0) {
    return DEFAULT_COMPETENCY();
  }

  // 词袋关键词 → 8D 维度评分
  return wordBagSynthesis(lessons);
}

/** 默认 competency (数据不足时的 fallback) */
function DEFAULT_COMPETENCY(): CompetencyModel {
  const dims: Record<string, CompetencyDimension> = {};
  for (const key of Object.keys(DIMENSION_LABELS)) {
    dims[key] = { selfRating: 0.5, taskCount: 0 };
  }
  return {
    domainProficiencies: dims,
    strongestDomains: [],
    weakestDomains: [],
    currentLearningFocus: null,
    source: "bootstrap_v1_default",
    generatedAt: Date.now(),
  };
}

/** 词袋关键词合成 */
function wordBagSynthesis(lessons: LessonItem[]): CompetencyModel {
  // 收集所有 lesson 文本
  const allText = lessons
    .map(l => `${l.content} ${l.tags.join(" ")}`)
    .join(" ");

  // 提取关键词（移除停用词，保留中英文单词）
  const keywords = allText
    .toLowerCase()
    .split(/[\s,，。、；;:：！!？?()（）\[\]【】"“”'‘’\-—/\\|@#$%^&*+=<>{}~`]+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

  // 匹配 8D 维度
  const dimensionScores: Record<string, { totalScore: number; count: number }> = {};
  for (const key of Object.keys(DIMENSION_LABELS)) {
    dimensionScores[key] = { totalScore: 0, count: 0 };
  }

  for (const lesson of lessons) {
    const text = `${lesson.content} ${lesson.tags.join(" ")}`.toLowerCase();
    const lessonWeight = lesson.confidence * 0.5 + 0.5; // 归一化到 0.5-1.0

    for (const { dimension, patterns } of KEYWORD_TO_8D) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          dimensionScores[dimension].totalScore += lessonWeight;
          dimensionScores[dimension].count++;
          break; // 每 lesson 每个维度只计一次
        }
      }
    }
  }

  // 生成 domainProficiencies
  const dims: Record<string, CompetencyDimension> = {};
  const entries: Array<{ key: string; rating: number }> = [];

  for (const [key, score] of Object.entries(dimensionScores)) {
    const rating = score.count > 0
      ? Math.min(1, Math.max(0.2, score.totalScore / Math.max(1, lessons.length)))
      : 0.5;
    dims[key] = { selfRating: rating, taskCount: score.count };
    entries.push({ key, rating });
  }

  entries.sort((a, b) => b.rating - a.rating);

  return {
    domainProficiencies: dims,
    strongestDomains: entries.slice(0, 2).map(e => DIMENSION_LABELS[e.key] ?? e.key),
    weakestDomains: entries.slice(-2).map(e => DIMENSION_LABELS[e.key] ?? e.key),
    currentLearningFocus: entries.length > 0
      ? entries[entries.length - 1].key // 最弱维度为学习重点
      : null,
    source: "bootstrap_v1_wordbag",
    generatedAt: Date.now(),
  };
}

// ══════════════════════════════════════════════════════════════════
// Step 4: writeSlotsWithSentinel (sentinel last = idempotency)
// ══════════════════════════════════════════════════════════════════

async function writeSlotsWithSentinel(
  deps: M0Deps,
  competencyModel: CompetencyModel,
  lessonCount: number,
): Promise<void> {
  const now = Date.now();

  // a) audit_log 先写
  await deps.memory.setSlot("audit_log", {
    entries: [{
      timestamp: now,
      type: "bootstrap",
      severity: "info",
      detail: {
        source: "initial_synthesis",
        lessonCount,
        dimensions: Object.keys(competencyModel.domainProficiencies).length,
      },
    }],
  });

  // b) competency_snapshots 初始快照
  await deps.memory.setSlot("competency_snapshots", [
    { ...competencyModel, timestamp: now },
  ]);

  // c) competency_model
  await deps.memory.setSlot("competency_model", competencyModel);

  // d) sentinel — 全部完成标记（最后写入，保证幂等）
  await deps.memory.setSlot("praxis_bootstrap_done", true);
}
