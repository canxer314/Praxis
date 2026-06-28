/**
 * Phase 1A Bridge — 将 5 个模块接入 Claude Code hook 系统
 *
 * @deprecated 自 Phase 5 (v0.16.0.0) 起, 请使用 bun scripts/praxis-hook.ts 替代。
 *   本文件保留 30 天作为回退路径 (至 2026-07-28), 之后将被删除。
 *   迁移指南: 将 Claude Code hook 配置中的 `tsx src/phase1a-bridge.ts <cmd>`
 *   替换为 `bun scripts/praxis-hook.ts <hook_type> <sessionId> [options]`。
 *   详见 docs/remains-dev-plan.md Phase 5。
 *
 * 用法 (已弃用):
 *   tsx src/phase1a-bridge.ts inject        — SessionStart: 输出上下文注入
 *   tsx src/phase1a-bridge.ts end <file>    — SessionEnd: 分析 transcript 并保存学习
 *   tsx src/phase1a-bridge.ts show          — 查看学习状态
 *   tsx src/phase1a-bridge.ts learn "<内容>" — 手动保存学习
 *   tsx src/phase1a-bridge.ts expand        — UserPromptExpansion: 语义搜索注入
 *   tsx src/phase1a-bridge.ts message       — UserPromptSubmit: 实时学习提取
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionStartHandler } from "./session-start";
import { SessionEndHandler } from "./session-end";
import { TranscriptAnalyzerV2 } from "./transcript-analyzer-v2";
import { llmClient } from "./llm-client";
import { agentmemory } from "./agentmemory-client";
import { Result, LearningEvent } from "./platform-adapter";
import { CognitiveCore } from "./cognitive/cognitive-core";
import type { CognitiveCoreMemoryClient } from "./cognitive/cognitive-core";
import { SLOTS } from "./cognitive/constants";
import { detectCorrection, detectCorrectionLLM } from "./cognitive/signal-detector";
import { recognizeScene, getActiveScenarioIds, getPrimaryScenarioId } from "./cognitive/scene-recognizer";
import { readCache, writeCache, checkCache } from "./cognitive/scenario-cache";
import { embed } from "./cognitive/embedding";
import { SEED_SCENARIOS } from "./cognitive/scenario-registry";
import type { ScenarioCacheEntry } from "./cognitive/scenario-cache";
import type { M0Deps, ProtoStructureCandidate } from "./m0-deps";
import { ConfidenceFuser } from "./orchestration/confidence-fuser";
import { buildM0Deps } from "./m0-builder";

// ---- Deprecation warning ----
console.error("[Praxis] ⚠ phase1a-bridge.ts 已弃用。请迁移到 bun scripts/praxis-hook.ts。详见 docs/remains-dev-plan.md Phase 5。");

// ---- CognitiveCore 工厂 (T8) ----

function createCognitiveCore(): CognitiveCore {
  const memoryClient: CognitiveCoreMemoryClient = {
    // Phase 1A agentmemory 直接满足 MetacognitiveMemoryClient
    getSlot: (name: string) => agentmemory.getSlot(name),
    setSlot: (name: string, data: unknown) => agentmemory.setSlot(name, data),
    // smartSearch: agentmemory 返回裸数组，包装为 Result
    smartSearch: async (query: string, opts?: { limit?: number }) => {
      const results = await agentmemory.smartSearch(query, opts?.limit ?? 5);
      return { ok: true as const, value: results as unknown[] };
    },
    // lessonSave: agentmemory 返回 Result<void>，映射为 Result<unknown>
    lessonSave: async (data: Record<string, unknown>) => {
      const content = String(data.content || "");
      const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
      const confidence = Number(data.confidence ?? 0.8);
      const result = await agentmemory.saveLesson(content, tags, confidence);
      if (result.ok) return { ok: true, value: undefined };
      return result as unknown as Result<unknown>;
    },
    // E5: lessonRecall — 批量召回（供 CrossDomainAnalyzer 使用）
    lessonRecall: async (_query: Record<string, unknown>) => {
      const result = await agentmemory.smartSearch("", 100);
      return { ok: true as const, value: result.map((r: Record<string, unknown>) => ({
        content: r.content,
        type: r.source ?? "lesson",
        tags: r.tags ?? [],
        domain: r.domain ?? "unknown",
      })) };
    },
  };

  // E10: WAL 落盘路径 — 进程重启后恢复未写入的记忆
  const walFilePath = path.join(MEMORY_DIR, "wal.json");
  return new CognitiveCore({ memoryClient, walFilePath });
}

// ---- 搜索（AgentMemory 语义搜索） ----

async function searchRelevant(prompt: string, limit: number): Promise<StoredLearning[]> {
  const amAvailable = await agentmemory.isAvailable();

  if (amAvailable) {
    // 主要路径：AgentMemory 语义搜索（观察 + lessons）
    const results = await agentmemory.smartSearch(prompt, limit);
    if (results.length > 0) {
      return results.map((r) => ({
        session: 0,
        timestamp: "",
        type: r.source === "lesson" ? "insight" : "observation",
        content: r.content,
        confidence: r.score,
        source: "auto" as const,
      }));
    }
  }

  // 降级：从 slot 读取 learnings 做本地匹配
  const stored = loadLearnings();
  if (stored.length === 0) return [];

  // 中文 n-gram 兜底（AgentMemory 不可用时）
  const grams = new Set<string>();
  for (let i = 0; i < prompt.length - 1; i++) grams.add(prompt.slice(i, i + 2));
  for (let i = 0; i < prompt.length - 2; i++) grams.add(prompt.slice(i, i + 3));
  const keywords = [...grams].filter((g: string) => /[一-鿿]/.test(g));

  const seen = new Set<string>();
  return stored
    .map((l: StoredLearning) => {
      const lower = l.content.toLowerCase();
      const hits = keywords.filter((kw: string) => lower.includes(kw)).length;
      return { ...l, _score: hits > 0 ? hits * l.confidence : 0 };
    })
    .filter((l: StoredLearning & { _score: number }) => {
      if (l._score === 0) return false;
      const key = l.content.slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b as { _score: number })._score - (a as { _score: number })._score)
    .slice(0, limit);
}

// ---- 持久化（AgentMemory slot + lessons） ----

async function appendLearnings(events: LearningEvent[], session: number, source: "auto" | "manual"): Promise<void> {
  const stored = loadLearnings();
  for (const e of events) {
    // Slot 层内容去重：相同 content（忽略首尾空白）只保留第一条
    const exists = stored.some(
      (s) => s.content.trim().toLowerCase() === e.content.trim().toLowerCase()
    );
    if (exists) continue;
    stored.push({
      session, timestamp: new Date().toISOString(),
      type: e.type, content: e.content, confidence: e.confidence, source,
      protoStructureIds: e.protoStructureIds ?? [],
    });
  }

  const amAvailable = await agentmemory.isAvailable();

  if (amAvailable) {
    // 存入 slot（结构化全量）
    const r = await agentmemory.setSlot("praxis_learnings", stored);
    if (!r.ok) {
      console.error("[Praxis] AgentMemory slot 写入失败，降级到本地 JSON:", r.error?.message);
      saveLearnings(stored);
    }
    // 每条学习同时存为 lesson（语义可检索，带去重）
    for (const e of events) {
      const lr = await agentmemory.saveLessonDeduped(e.content, [e.type], e.confidence);
      if (!lr.ok) {
        console.error(`[Praxis] lesson 保存失败: ${lr.error?.message} — ${e.content.slice(0, 50)}`);
      }
    }
  } else {
    saveLearnings(stored);
  }
}

const MEMORY_DIR = path.join(os.homedir(), ".praxis-phase1a");
const LEARNINGS_FILE = path.join(MEMORY_DIR, "learnings.json");
const SESSION_LOG_FILE = path.join(MEMORY_DIR, "session-log.jsonl");
const SHADOW_DECISIONS_FILE = path.join(MEMORY_DIR, "shadow-decisions.jsonl");
const SESSION_STATE_FILE = path.join(MEMORY_DIR, "session-state.json");
const SCENE_CLASSIFICATION_LOG = path.join(MEMORY_DIR, "scene-classifications.jsonl");

function ensureDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// ══════════════════════════════════════════════════════════════════
// Session-State IPC (跨 Hook 状态共享)
// ══════════════════════════════════════════════════════════════════

interface SessionState {
  activeScenarioIds: string[];
  primaryScenarioId: string | null;
  evaluatedAt: number; // Unix ms
}

function readSessionState(): SessionState | null {
  try {
    if (!fs.existsSync(SESSION_STATE_FILE)) return null;
    const raw = fs.readFileSync(SESSION_STATE_FILE, "utf-8");
    const state: SessionState = JSON.parse(raw);
    // 有效性校验: 必须有 evaluatedAt
    if (typeof state.evaluatedAt !== "number") return null;
    return state;
  } catch {
    return null; // 损坏文件 → 视为不存在
  }
}

function writeSessionState(state: SessionState): void {
  ensureDir();
  fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify(state), "utf-8");
}

function deleteSessionState(): void {
  try {
    if (fs.existsSync(SESSION_STATE_FILE)) fs.unlinkSync(SESSION_STATE_FILE);
  } catch {
    // 删除失败不影响正常运行
  }
}

// ══════════════════════════════════════════════════════════════════
// Scene Classification Logging (离��验证)
// ══════════════════════════════════════════════════════════════════

interface SceneClassificationRecord {
  timestamp: string;
  sessionId: string;
  inputPreview: string;       // 用户首条消息前 200 字符
  primaryScenarioId: string | null;
  activeScenarioIds: string[];
  confidence: number;          // 主场景置信度
  llmDurationMs: number;
  cacheHit: boolean;
}

function appendSceneClassification(record: SceneClassificationRecord): void {
  ensureDir();
  const line = JSON.stringify(record) + "\n";
  fs.appendFileSync(SCENE_CLASSIFICATION_LOG, line, "utf-8");
}

interface StoredLearning {
  session: number;
  timestamp: string;
  type: string;
  content: string;
  confidence: number;
  source: "auto" | "manual";
  /** 关联的场景 ID 列表 — Phase 0 实现后由 TranscriptAnalyzerV2 填充 */
  protoStructureIds?: string[];
}

function loadLearnings(): StoredLearning[] {
  ensureDir();
  if (!fs.existsSync(LEARNINGS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEARNINGS_FILE, "utf-8"));
  } catch {
    console.error("[Praxis] learnings.json 已损坏，重置为空");
    return [];
  }
}

function saveLearnings(learnings: StoredLearning[]): void {
  ensureDir();
  fs.writeFileSync(LEARNINGS_FILE, JSON.stringify(learnings, null, 2), "utf-8");
}

function getSessionCount(): number {
  const stored = loadLearnings();
  if (stored.length === 0) return 1;
  return (new Set(stored.map((s) => s.session))).size + 1;
}

// 记录 session 日志
function logSession(session: number, event: string): void {
  ensureDir();
  const line = JSON.stringify({ ts: new Date().toISOString(), session, event }) + "\n";
  fs.appendFileSync(SESSION_LOG_FILE, line, "utf-8");
}

/**
 * 从 transcript 中提取首条用户消息（用于离线场景验证）。
 * 匹配模式: "用户:" 或 "User:" 开头的行。
 */
function extractFirstUserMessage(transcript: string): string | null {
  const lines = transcript.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // 匹配 "用户:" 或 "User:" 或 "user:" 前缀
    const match = trimmed.match(/^(?:用户|User|user):\s*(.+)/);
    if (match && match[1].trim().length > 0) {
      return match[1].trim();
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// Shadow Decision Persistence (T12)
// ══════════════════════════════════════════════════════════════════

interface ShadowDecisionRecord {
  sessionId: string;
  timestamp: string;
  action: string;
  confidence: number;
  routeTo: string;
  signalType: string;
  timing: string;
  isNewKnowledge: boolean;
  matchedKeyword: string;
  contentPreview: string;
}

export interface ShadowStats {
  totalDecisions: number;
  sessionCount: number;
  skippedLines: number;
  byAction: Record<string, number>;
  bySignal: Record<string, number>;
  byIsNewKnowledge: { true: number; false: number };
  byRouteTo: Record<string, number>;
}

/**
 * 纯函数 — 从 JSONL 行数组计算影子决策统计。
 * 逐行解析，损坏行跳过并计入 skippedLines。
 */
export function computeShadowStats(lines: string[]): ShadowStats {
  const stats: ShadowStats = {
    totalDecisions: 0,
    sessionCount: 0,
    skippedLines: 0,
    byAction: {},
    bySignal: {},
    byIsNewKnowledge: { true: 0, false: 0 },
    byRouteTo: {},
  };

  const sessions = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const record: ShadowDecisionRecord = JSON.parse(trimmed);
      stats.totalDecisions++;
      sessions.add(record.sessionId);

      stats.byAction[record.action] = (stats.byAction[record.action] || 0) + 1;
      stats.bySignal[record.signalType] = (stats.bySignal[record.signalType] || 0) + 1;
      stats.byRouteTo[record.routeTo] = (stats.byRouteTo[record.routeTo] || 0) + 1;

      if (record.isNewKnowledge) {
        stats.byIsNewKnowledge.true++;
      } else {
        stats.byIsNewKnowledge.false++;
      }
    } catch (e) {
      // JSON parse failure → skip corrupted line; unexpected errors propagate
      if (e instanceof SyntaxError) {
        stats.skippedLines++;
      } else {
        throw e;
      }
    }
  }

  stats.sessionCount = sessions.size;
  return stats;
}

/** 追加一条影子决策到 JSONL 文件。 */
function appendShadowDecision(record: ShadowDecisionRecord): void {
  ensureDir();
  const line = JSON.stringify(record) + "\n";
  fs.appendFileSync(SHADOW_DECISIONS_FILE, line, "utf-8");
}

// ---- M0Deps 适配器 — 将 agentmemory 包装为 M0 标准接口 ----

/**
 * M1.5: LLM-backed ProtoStructure extraction (partial impl — full T7 follow-up).
 * Prompts the LLM for candidates as strict JSON, validates protoType, and falls
 * back to [] on ANY parse/shape failure — never emits garbage structures.
 */
async function extractProtoStructuresViaLLM(transcript: string): Promise<ProtoStructureCandidate[]> {
  if (!transcript || transcript.trim().length === 0) return [];
  const prompt =
    "Analyze the following session transcript and extract ProtoStructure candidates. " +
    "Return ONLY a JSON array (no prose, no markdown fences). Each element must have: " +
    '{"protoType":"sequence"|"role"|"concept"|"purpose"|"constraint","tentativeName":string,' +
    '"scenarioId":string,"confidence":0.0-1.0}. Optional: steps:[{position,action,agent?}], ' +
    "purpose, severity, definition, behaviors:[string]. Focus on ProtoSequence first. " +
    "Omit fields that don't apply.\n\nTranscript:\n" + transcript.slice(0, 12000);
  const result = await llmClient.analyze(prompt);
  if (!result.ok || !result.value) return [];
  try {
    const parsed: unknown = JSON.parse(result.value);
    if (!Array.isArray(parsed)) return [];
    const validTypes = new Set(["sequence", "role", "concept", "purpose", "constraint"]);
    return parsed
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .filter((c) => validTypes.has(String(c.protoType)))
      .map((c) => ({
        protoType: String(c.protoType) as ProtoStructureCandidate["protoType"],
        tentativeName: String(c.tentativeName ?? ""),
        scenarioId: String(c.scenarioId ?? ""),
        confidence: typeof c.confidence === "number" ? c.confidence : 0.3,
        steps: Array.isArray(c.steps) ? (c.steps as ProtoStructureCandidate["steps"]) : undefined,
        purpose: c.purpose !== undefined ? String(c.purpose) : undefined,
        severity: c.severity !== undefined ? String(c.severity) : undefined,
        definition: c.definition !== undefined ? String(c.definition) : undefined,
        behaviors: Array.isArray(c.behaviors) ? c.behaviors.map(String) : undefined,
      }))
      .filter((c) => c.tentativeName.length > 0);
  } catch {
    return []; // LLM returned non-JSON — no garbage.
  }
}

/**
 * @deprecated 委托给共享的 buildM0Deps (src/m0-builder.ts)。
 *   保留此包装以维持 bridge 的向后兼容 (30 天过渡期)。
 */
function buildM0Deps(): M0Deps {
  return buildM0Deps({ memoryDir: MEMORY_DIR });
}

/**
 * 将 M0 SessionContextInjection 格式化为 System Prompt 注入文本。
 * 顺序: Critical Constraints → 能力 → Tier A/B/C → 知识 → 思维状态
 */
function formatSessionContextInjection(
  ctx: import("./cognitive/types").SessionContextInjection,
  cronWarning: string,
): string {
  const sections: string[] = [];
  sections.push("## Praxis Context");

  // M3: Critical Constraints (最高优先级，不可压缩)
  if (ctx.tieredContext?.criticalConstraints?.injectionText) {
    sections.push("");
    sections.push(ctx.tieredContext.criticalConstraints.injectionText);
  }

  // 能力概况 (compact)
  const c = ctx.competency;
  sections.push("");
  sections.push("### Capability");
  sections.push(`- Overall: ${c.overallProficiency.toFixed(2)} | Strongest: ${c.strongestDomains.join(", ") || "—"} | Weakest: ${c.weakestDomains.join(", ") || "—"}`);
  if (c.currentLearningFocus) {
    sections.push(`- Learning Focus: ${c.currentLearningFocus}`);
  }

  // M2: 分层上下文 (Tier A/B)
  const tc = ctx.tieredContext;
  if (tc && (tc.tierA.items.length > 0 || tc.tierB.items.length > 0)) {
    const pressureTag = tc.meta.pressure !== "normal" ? ` [压力: ${tc.meta.pressure}]` : "";
    sections.push("");
    sections.push(`### Active Context (${tc.meta.totalStructures} structures, maturity: ${tc.meta.maturity}${pressureTag})`);

    if (tc.tierA.items.length > 0) {
      sections.push(`**Tier A** (${tc.tierA.items.length} items, ~${tc.tierA.totalTokens} tokens):`);
      for (const item of tc.tierA.items) {
        sections.push(`- [${item.protoType}] ${item.tentativeName}: ${item.description.slice(0, 120)}`);
      }
    }
    if (tc.tierB.items.length > 0) {
      sections.push(`**Tier B** (${tc.tierB.items.length} items, ~${tc.tierB.totalTokens} tokens):`);
      for (const item of tc.tierB.items) {
        sections.push(`- [${item.protoType}] ${item.tentativeName}`);
      }
    }
  }

  // 相关经验 (最多 5 条)
  if (ctx.knowledge.length > 0) {
    sections.push("");
    sections.push("### Related Experience");
    for (const k of ctx.knowledge.slice(0, 5)) {
      const title = k.title || k.content.slice(0, 60);
      sections.push(`- [${k.source}] ${title} (${k.confidence.toFixed(2)})`);
    }
  }

  // 思维状态
  if (ctx.mentalState) {
    sections.push("");
    sections.push(`### Previous State\n${ctx.mentalState.slice(0, 200)}`);
  }

  // Cron 警告
  if (cronWarning) {
    sections.push("");
    sections.push(cronWarning.trim());
  }

  sections.push(""); // trailing newline
  return sections.join("\n");
}

async function setSlotForSessionEnd(name: string, data: unknown): Promise<Result<void>> {
  const amAvailable = await agentmemory.isAvailable();
  if (amAvailable) {
    return agentmemory.setSlot(name, data);
  }
  // 降级：本地文件
  ensureDir();
  const file = path.join(MEMORY_DIR, `slot-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  return { ok: true, value: undefined };
}

// ---- 命令 ----

const cmd = process.argv[2];

if (cmd === "inject") {
  (async () => {
    // T8: 创建 CognitiveCore 实例（缓存 profile，零网络延迟快速注入）
    const core = createCognitiveCore();

    // T1: WAL 重放 — 恢复上次 session 写入失败的记忆
    const walResult = await core.replayPendingWrites();
    if (walResult.ok && walResult.value > 0) {
      console.error(`[Praxis] WAL 重放: ${walResult.value} 条记忆恢复`);
    }

    // T1: E5 cron 健康检查 — 检测跨领域分析 cron 是否静默失败
    let cronWarning = "";
    const healthResult = await agentmemory.getSlot(SLOTS.CRON_HEALTH);
    if (healthResult.ok && healthResult.value) {
      const health = healthResult.value as Record<string, unknown>;
      const lastStatus = health.lastRunStatus as string | undefined;
      const lastError = health.lastError as string | undefined;
      const lastRunAt = health.lastRunAt as number | undefined;
      if (lastStatus === "FAILED") {
        const ago = lastRunAt ? Math.round((Date.now() - lastRunAt) / 3600_000) : "?";
        cronWarning = `\n⚠️ E5 跨领域分析 cron 异常 (${ago}h 前): ${lastError || "unknown error"}\n`;
        console.error(`[Praxis] ${cronWarning.trim()}`);
      }
    }

    // Phase 2: 场景缓存检查 — 尝试从上次 session 恢复场景上下文
    const cacheEntry = readCache();
    let sessionState: SessionState = {
      activeScenarioIds: [],
      primaryScenarioId: null,
      evaluatedAt: Date.now(),
    };

    if (cacheEntry) {
      // 尝试生成当前上下文的 embedding 用于缓存验证
      let contextEmbedding: number[] | null = null;
      try {
        contextEmbedding = await embed(cacheEntry.contextualSnapshot);
      } catch {
        // embedding 不可用 → TTL-only 模式
      }

      const cacheResult = checkCache(cacheEntry, contextEmbedding);
      if (cacheResult.hit) {
        sessionState = {
          activeScenarioIds: cacheEntry.scenarioIds,
          primaryScenarioId: cacheEntry.primaryScenarioId,
          evaluatedAt: Date.now(),
        };
        console.error(`[Praxis] 场景缓存命中 (${cacheResult.reason}): ${cacheEntry.primaryScenarioId}`);
      } else {
        console.error(`[Praxis] 场景缓存未命中 (TTL过期 + embedding不匹配)，等待首条消息识别`);
      }
    }

    writeSessionState(sessionState);

    const handler = new SessionStartHandler(buildM0Deps());
    const result = await handler.handle(`session-${getSessionCount()}`);
    if (result.ok) {
      const injection = formatSessionContextInjection(result.value, cronWarning);
      console.log(injection);
      console.log("\n[Praxis Phase1A] 注入验证码: PRAXIS-1A-OK-8f3a");
      logSession(getSessionCount(), "context_injected");
    } else {
      console.error("inject failed:", result.error.message);
      process.exit(1);
    }
  })();
} else if (cmd === "end") {
  // --summary 模式: 无需 transcript 文件，输出 session 摘要 (Stop hook 用)
  if (process.argv[3] === "--summary") {
    const stored = loadLearnings();
    const recentSessions = new Set(stored.map((s) => s.session));
    const shadowCount = (() => {
      try {
        if (!fs.existsSync(SHADOW_DECISIONS_FILE)) return 0;
        const raw = fs.readFileSync(SHADOW_DECISIONS_FILE, "utf-8");
        return raw.split("\n").filter((l) => l.trim()).length;
      } catch { return 0; }
    })();

    // Phase 2: 读 session-state，写场景缓存，清理
    const sessionState = readSessionState();
    let sceneInfo = "";
    if (sessionState && sessionState.primaryScenarioId) {
      sceneInfo = `, 场景: ${sessionState.primaryScenarioId}`;
      // 写入场景缓存（下次 session_start 可命中）
      // 注: Stop hook 需快速返回，不在此计算 embedding。embedding=null 退化为 TTL-only 缓存。
      writeCache({
        scenarioIds: sessionState.activeScenarioIds,
        primaryScenarioId: sessionState.primaryScenarioId,
        confidence: 0.8,
        contextualSnapshot: sessionState.primaryScenarioId,
        embedding: null,
        cachedAt: Date.now(),
        sourceSessionId: process.env.CLAUDE_SESSION_ID || `s${getSessionCount()}`,
      });
    }
    // 清理 session-state（本 session 已结束）
    deleteSessionState();

    console.log(`\n[Praxis] session 结束 — ${stored.length} 条学习, ${recentSessions.size} session, ${shadowCount} 条影子决策${sceneInfo}`);
    if (shadowCount > 0) console.log("[Praxis] 运行 npx tsx src/phase1a-bridge.ts shadow-stats 查看 Phase 2 gate 进度");
    // 显示场景分类日志统计
    if (fs.existsSync(SCENE_CLASSIFICATION_LOG)) {
      const classLines = fs.readFileSync(SCENE_CLASSIFICATION_LOG, "utf-8").split("\n").filter((l) => l.trim());
      console.log(`[Praxis] 场景分类记录: ${classLines.length} 条 — 运行 npx tsx src/phase1a-bridge.ts scene-stats 查看详情`);
    }
  } else {
  const transcriptFile = process.argv[3];
  if (!transcriptFile) {
    console.error("用法: tsx src/phase1a-bridge.ts end <transcript-file>  或  tsx src/phase1a-bridge.ts end --summary");
    process.exit(1);
  }
  (async () => {
    const analyzer = new TranscriptAnalyzerV2(llmClient);
    const analyzeTranscript = async (t: string) => await analyzer.analyze(t);
    const handler = new SessionEndHandler({
      analyzeTranscript,
      setSlot: setSlotForSessionEnd,
    });

    const transcript = fs.readFileSync(transcriptFile, "utf-8");
    const session = getSessionCount();
    const result = await handler.handle(`session-${session}`, transcript);

    if (result.ok && result.value.learningEvents && result.value.learningEvents.length > 0) {
      await appendLearnings(result.value.learningEvents, session, "auto");
      console.log(`[Praxis Phase1A] session ${session} 自动提取 ${result.value.learningEvents.length} 条学习`);
      for (const e of result.value.learningEvents.slice(0, 5)) {
        console.log(`  [${e.type}] ${e.content.slice(0, 80)}`);
      }
      logSession(session, `auto_learned:${result.value.learningEvents.length}`);
    } else {
      console.log(`[Praxis Phase1A] session ${session} 无新学习`);
      logSession(session, "no_new_learnings");
    }

    // Phase 2 离线验证: 从 transcript 提取首条用户消息，运行场景识别，记录到分类日志
    try {
      // 如果 message hook 已经做了场景识别（session-state.json 存在且有场景），跳过
      const existingState = readSessionState();
      const hasScene = existingState && existingState.activeScenarioIds.length > 0;

      if (!hasScene) {
        // 从 transcript 中提取首条 "用户:" 消息
        const firstUserMsg = extractFirstUserMessage(transcript);
        if (firstUserMsg) {
          const startMs = Date.now();
          const matches = await recognizeScene(llmClient, firstUserMsg);
          const primaryId = getPrimaryScenarioId(matches);
          const activeIds = getActiveScenarioIds(matches);

          const sessionId = process.env.CLAUDE_SESSION_ID || `s${session}`;
          appendSceneClassification({
            timestamp: new Date().toISOString(),
            sessionId,
            inputPreview: [...firstUserMsg].slice(0, 200).join(""),
            primaryScenarioId: primaryId,
            activeScenarioIds: activeIds,
            confidence: matches.length > 0 ? matches[0].confidence : 0,
            llmDurationMs: Date.now() - startMs,
            cacheHit: false,
          });

          if (primaryId) {
            console.error(`[Praxis] 离线场景验证: ${primaryId} (${Date.now() - startMs}ms)`);
          } else {
            console.error(`[Praxis] 离线场景验证: 无匹配 (${Date.now() - startMs}ms)`);
          }
        }
      }
    } catch {
      // 离线验证失败不影响主流程
    }

    // 清理 session-state
    deleteSessionState();
  })();
  } // end else (transcript mode)
} else if (cmd === "learn") {
  (async () => {
    const content = process.argv[3];
    if (!content) {
      console.error("用法: tsx src/phase1a-bridge.ts learn <内容>");
      process.exit(1);
    }
    const session = getSessionCount();
    const event: LearningEvent = {
      id: `manual_${Date.now()}`,
      type: "insight",
      content,
      confidence: 0.85,
    };
    await appendLearnings([event], session, "manual");
    console.log(`[Praxis Phase1A] 已保存 (session ${session})`);
    logSession(session, "manual_learn");
  })();
} else if (cmd === "message") {
  // 从 stdin 读取 UserPromptSubmit hook JSON，实时分析用户消息
  (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (!raw) { console.log("[Praxis Phase1A] 空输入，跳过"); return; }

    let prompt = "";
    try {
      const data = JSON.parse(raw);
      prompt = data.prompt || data.text || data.message || "";
    } catch {
      prompt = raw;
    }
    if (!prompt) { console.log("[Praxis Phase1A] 无法提取消息内容"); return; }

    // Phase 2: 场景识别 — 如果 session-state 无场景，用首条消息识别
    let sessionState = readSessionState();
    const needsSceneEval = !sessionState || sessionState.activeScenarioIds.length === 0;

    if (needsSceneEval) {
      const startMs = Date.now();
      const matches = await recognizeScene(llmClient, prompt);
      const activeIds = getActiveScenarioIds(matches);
      const primaryId = getPrimaryScenarioId(matches);

      sessionState = {
        activeScenarioIds: activeIds,
        primaryScenarioId: primaryId,
        evaluatedAt: Date.now(),
      };
      writeSessionState(sessionState);

      // 离线验证: 记录场景分类到 JSONL
      const sessionId = process.env.CLAUDE_SESSION_ID || `s${getSessionCount()}`;
      appendSceneClassification({
        timestamp: new Date().toISOString(),
        sessionId,
        inputPreview: [...prompt].slice(0, 200).join(""),
        primaryScenarioId: primaryId,
        activeScenarioIds: activeIds,
        confidence: matches.length > 0 ? matches[0].confidence : 0,
        llmDurationMs: Date.now() - startMs,
        cacheHit: false,
      });

      if (primaryId) {
        console.error(`[Praxis] 场景识别: ${primaryId} (${activeIds.length} 活跃, ${Date.now() - startMs}ms)`);
      } else {
        console.error(`[Praxis] 场景识别: 无匹配 (Open Perception 模式, ${Date.now() - startMs}ms)`);
      }
    }

    const activeIds = sessionState?.activeScenarioIds ?? [];

    const analyzer = new TranscriptAnalyzerV2(llmClient);
    const events = await analyzer.analyze(prompt, { activeScenarioIds: activeIds.length > 0 ? activeIds : undefined });
    const finalEvents = events;
    if (finalEvents.length > 0) {
      const session = getSessionCount();
      await appendLearnings(finalEvents, session, "auto");
      console.log(`[Praxis Phase1A] 实时提取 ${finalEvents.length} 条学习`);
      for (const e of finalEvents.slice(0, 3)) {
        console.log(`  [${e.type}] ${e.content.slice(0, 80)}`);
      }
      logSession(session, `realtime_learned:${finalEvents.length}`);
    }

    // Governor shadow mode: LLM 语义检测 → governorDecide → 影子日志
    const correction = await detectCorrectionLLM(llmClient, prompt);
    if (correction) {
      // 使用 Claude Code 提供的真实 session ID (环境变量 CLAUDE_SESSION_ID)
      const sessionId = process.env.CLAUDE_SESSION_ID || `shadow_${getSessionCount()}`;
      const contentPreview = [...prompt].slice(0, 100).join("");
      try {
        const core = createCognitiveCore();
        const sessionCore = core.createSession(sessionId);
        const result = await sessionCore.governorDecide(correction, {
          sessionId,
          hasExplicitRejection: true,
          taskType: "unknown",
          domain: "unknown",
        });
        if (result.ok) {
          appendShadowDecision({
            sessionId,
            timestamp: new Date().toISOString(),
            action: result.value.action,
            confidence: result.value.confidence,
            routeTo: result.value.routeTo,
            signalType: result.value.signalType,
            timing: result.value.timing,
            isNewKnowledge: correction.isNewKnowledge,
            matchedKeyword: correction.likelyRootCause.replace("keyword_match:", ""),
            contentPreview,
          });
        } else {
          // 降级路径: 保持 stderr 输出，不静默失败
          console.error(`[Praxis Phase1A] [shadow] degraded: ${result.error?.message ?? "unknown"}`);
        }
      } catch (e) {
        // 影子模式失败不影响主流程 — 保持 stderr 可见性
        console.error(`[Praxis Phase1A] [shadow] error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  })();
} else if (cmd === "show") {
  const stored = loadLearnings();
  console.log(`=== Praxis Phase1A 学习状态 ===`);
  console.log(`累计学习: ${stored.length} 条`);
  console.log(`涉及 session: ${new Set(stored.map((s) => s.session)).size} 个`);

  const byType: Record<string, number> = {};
  stored.forEach((s) => { byType[s.type] = (byType[s.type] || 0) + 1; });
  console.log("按类型:", Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(", "));

  console.log("\n最近 5 条:");
  stored.slice(-5).forEach((s) => {
    console.log(`  [S${s.session}] [${s.type}] [${s.source}] ${s.content.slice(0, 80)}`);
  });
} else if (cmd === "shadow-stats") {
  // Phase 2 gate: 查看 Governor 影子决策统计
  ensureDir();
  if (!fs.existsSync(SHADOW_DECISIONS_FILE)) {
    console.log("=== Governor 影子决策统计 ===");
    console.log("状态: 暂无影子数据");
    console.log("");
    console.log("发送包含纠正关键词（\"不对\"/\"错了\"/\"不是\"等）的消息以产生影子决策。");
  } else {
    const raw = fs.readFileSync(SHADOW_DECISIONS_FILE, "utf-8");
    const lines = raw.split("\n");
    const stats = computeShadowStats(lines);

    console.log("=== Governor 影子决策统计 ===");
    console.log(`Session 数:   ${stats.sessionCount}`);
    console.log(`总决策数:     ${stats.totalDecisions}`);
    if (stats.skippedLines > 0) {
      console.log(`跳过损坏行:   ${stats.skippedLines}`);
    }
    console.log("");
    console.log("--- 决策分布 (action) ---");
    for (const [action, count] of Object.entries(stats.byAction)) {
      console.log(`  ${action}: ${count}`);
    }
    console.log("");
    console.log("--- 信号类型分布 (signalType) ---");
    for (const [signal, count] of Object.entries(stats.bySignal)) {
      console.log(`  ${signal}: ${count}`);
    }
    console.log("");
    console.log("--- isNewKnowledge 分布 ---");
    console.log(`  true:  ${stats.byIsNewKnowledge.true}`);
    console.log(`  false: ${stats.byIsNewKnowledge.false}`);
    console.log("");
    console.log("--- 路由分布 (routeTo) ---");
    for (const [route, count] of Object.entries(stats.byRouteTo)) {
      console.log(`  ${route}: ${count}`);
    }
  }
} else if (cmd === "expand") {
  // UserPromptExpansion hook — 每轮对话前搜索相关记忆，注入经验
  (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (!raw) return; // 空输入 → 零注入

    let prompt = "";
    try { const data = JSON.parse(raw); prompt = data.prompt || data.text || data.message || ""; }
    catch { prompt = raw; }
    if (!prompt || prompt.length < 3) return; // 太短不搜

    const scored = await searchRelevant(prompt, 3);
    if (scored.length === 0) return;

    // Phase 3: 场景上下文注入 — 读取活跃场景，标注在检索结果标题旁
    const sessionState = readSessionState();
    const sceneLabel = sessionState?.primaryScenarioId
      ? (() => {
          const seed = SEED_SCENARIOS.find((s) => s.scenarioId === sessionState.primaryScenarioId);
          return `（当前场景: ${seed?.tentativeName ?? sessionState.primaryScenarioId}）`;
        })()
      : "";

    const lines = scored.map((l: StoredLearning) =>
      `- [${l.type}] ${l.content.slice(0, 120)} (匹配: ${l.confidence.toFixed(3)})`
    );
    console.log(`\n[Praxis 相关经验]${sceneLabel}\n${lines.join("\n")}`);
    logSession(getSessionCount(), `expand:${scored.length}`);
  })();
} else if (cmd === "scene-log") {
  // 手动场景识别测试 — 从 stdin 读取文本，运行场景识别并输出结果
  (async () => {
    let text: string;
    const input = process.argv[3];
    if (!input || input === "-") {
      // 从 stdin 读取
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      text = Buffer.concat(chunks).toString("utf-8").trim();
      if (!text) {
        console.log("[Praxis] scene-log 需要输入文本。用法: echo '消息内容' | tsx src/phase1a-bridge.ts scene-log");
        return;
      }
    } else {
      text = input;
    }

    const startMs = Date.now();
    const matches = await recognizeScene(llmClient, text);
    const primaryId = getPrimaryScenarioId(matches);
    const activeIds = getActiveScenarioIds(matches);
    const elapsed = Date.now() - startMs;

    console.log(`输入: ${text.slice(0, 100)}...`);
    console.log(`主场景: ${primaryId ?? "无"}`);
    console.log(`活跃场景: ${activeIds.join(", ") || "无"}`);
    console.log(`耗时: ${elapsed}ms`);
    if (matches.length > 0) {
      console.log("\n全部匹配:");
      for (const m of matches) {
        console.log(`  ${m.scenarioId}: ${m.confidence.toFixed(2)}`);
      }
    }
    console.log("");

    // 记录到离线验证日志
    const sessionId = process.env.CLAUDE_SESSION_ID || `manual_${Date.now()}`;
    appendSceneClassification({
      timestamp: new Date().toISOString(),
      sessionId,
      inputPreview: [...text].slice(0, 200).join(""),
      primaryScenarioId: primaryId,
      activeScenarioIds: activeIds,
      confidence: matches.length > 0 ? matches[0].confidence : 0,
      llmDurationMs: elapsed,
      cacheHit: false,
    });
    console.log(`已记录到 ${SCENE_CLASSIFICATION_LOG}`);
  })();
} else if (cmd === "scene-stats") {
  // 查看场景分类统计数据
  ensureDir();
  if (!fs.existsSync(SCENE_CLASSIFICATION_LOG)) {
    console.log("=== 场景分类统计 ===");
    console.log("状态: 暂无分类数据");
    console.log("");
    console.log("场景分类由 message hook 和 end hook 自动记录。");
    console.log("手动测试: echo '你的消息' | tsx src/phase1a-bridge.ts scene-log");
  } else {
    const raw = fs.readFileSync(SCENE_CLASSIFICATION_LOG, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    console.log(`=== 场景分类统计 (${lines.length} 条记录) ===\n`);

    const byScenario: Record<string, number> = {};
    const sessions = new Set<string>();
    let noMatchCount = 0;

    for (const line of lines) {
      try {
        const record: SceneClassificationRecord = JSON.parse(line);
        sessions.add(record.sessionId);
        if (record.primaryScenarioId) {
          byScenario[record.primaryScenarioId] = (byScenario[record.primaryScenarioId] || 0) + 1;
        } else {
          noMatchCount++;
        }
      } catch { /* skip corrupted lines */ }
    }

    console.log(`Session 数: ${sessions.size}`);
    console.log(`无匹配:    ${noMatchCount}`);
    console.log("");
    console.log("--- 场景分布 ---");
    for (const [scenario, count] of Object.entries(byScenario).sort(([, a], [, b]) => b - a)) {
      const seed = SEED_SCENARIOS.find((s) => s.scenarioId === scenario);
      const name = seed ? seed.tentativeName : scenario;
      console.log(`  ${scenario} (${name}): ${count}`);
    }
    console.log("");
    console.log("--- 最近 5 条 ---");
    const recent = lines.slice(-5);
    for (const line of recent) {
      try {
        const r: SceneClassificationRecord = JSON.parse(line);
        const seed = r.primaryScenarioId
          ? SEED_SCENARIOS.find((s) => s.scenarioId === r.primaryScenarioId)
          : null;
        const name = seed ? seed.tentativeName : (r.primaryScenarioId || "无匹配");
        console.log(`  ${r.timestamp.slice(0, 19)} | ${name} (${r.confidence.toFixed(2)}) | "${r.inputPreview.slice(0, 60)}..."`);
      } catch { /* skip */ }
    }
  }
} else {
  console.log(`Praxis Phase1A Bridge
用法:
  tsx src/phase1a-bridge.ts inject           — 输出上下文注入 (SessionStart hook)
  tsx src/phase1a-bridge.ts end <file>       — 分析 transcript (Stop hook)
  tsx src/phase1a-bridge.ts end --summary    — Session 摘要 (Stop hook, 无文件)
  tsx src/phase1a-bridge.ts expand           — 搜索经验注入 (UserPromptExpansion hook)
  tsx src/phase1a-bridge.ts message          — 实时学习提取 (UserPromptSubmit hook)
  tsx src/phase1a-bridge.ts learn "<内容>"    — 手动保存学习
  tsx src/phase1a-bridge.ts show             — 查看学习状态
  tsx src/phase1a-bridge.ts shadow-stats     — 查看 Governor 影子决策统计
  tsx src/phase1a-bridge.ts scene-log <文本>  — 手动场景识别测试
  tsx src/phase1a-bridge.ts scene-stats      — 查看场景分类统计
`);
}
