/**
 * Phase 1A Bridge — 将 5 个模块接入 Claude Code hook 系统
 *
 * 用法:
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
import { TranscriptAnalyzer } from "./transcript-analyzer";
import { TranscriptAnalyzerV2 } from "./transcript-analyzer-v2";
import { llmClient } from "./llm-client";
import { agentmemory } from "./agentmemory-client";
import { Result, LearningEvent } from "./platform-adapter";
import { CognitiveCore } from "./cognitive/cognitive-core";
import type { CognitiveCoreMemoryClient } from "./cognitive/cognitive-core";

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

function ensureDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

interface StoredLearning {
  session: number;
  timestamp: string;
  type: string;
  content: string;
  confidence: number;
  source: "auto" | "manual";
}

function loadLearnings(): StoredLearning[] {
  ensureDir();
  if (!fs.existsSync(LEARNINGS_FILE)) return [];
  return JSON.parse(fs.readFileSync(LEARNINGS_FILE, "utf-8"));
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

// ---- AgentMemory 数据读取（注入到 SessionStartHandler） ----

const DEFAULT_SKILLS = [
  { id: "typescript", name: "TypeScript", proficiency: 0.65, level: "competent" },
  { id: "architecture", name: "系统架构设计", proficiency: 0.80, level: "proficient" },
  { id: "ai-agent", name: "AI Agent 系统", proficiency: 0.70, level: "competent" },
  { id: "obsidian", name: "Obsidian 笔记管理", proficiency: 0.75, level: "competent" },
];

async function getSlotForInjection(_name: string): Promise<Result<unknown>> {
  const amAvailable = await agentmemory.isAvailable();

  if (amAvailable) {
    try {
      const r = await agentmemory.getSlot("praxis_learnings");
      if (r.ok && r.value) {
        const parsed = typeof r.value === "string" ? JSON.parse(r.value) : r.value;
        if (Array.isArray(parsed)) {
          const bestPractices = [...new Set(parsed.filter((s: StoredLearning) => s.type === "pattern" || s.type === "insight").map((s: StoredLearning) => s.content))];
          const antiPatterns = [...new Set(parsed.filter((s: StoredLearning) => s.type === "pitfall" || s.type === "correction").map((s: StoredLearning) => s.content))];
          return { ok: true, value: { skills: DEFAULT_SKILLS, best_practices: bestPractices.slice(-20), anti_patterns: antiPatterns.slice(-20) } };
        }
      }
    } catch {
      // AgentMemory 读取失败 → 降级
    }
  }

  // 本地 JSON 兜底
  const stored = loadLearnings();
  const bestPractices = stored.filter((s) => s.type === "pattern" || s.type === "insight").map((s) => s.content);
  const antiPatterns = stored.filter((s) => s.type === "pitfall" || s.type === "correction").map((s) => s.content);

  return {
    ok: true,
    value: {
      skills: DEFAULT_SKILLS,
      best_practices: [...new Set(bestPractices)].slice(-20),
      anti_patterns: [...new Set(antiPatterns)].slice(-20),
    },
  };
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
    const healthResult = await agentmemory.getSlot("cron_health");
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

    const handler = new SessionStartHandler({
      getSlot: getSlotForInjection,
      cognitiveCore: core,
    });
    const result = await handler.handle(`session-${getSessionCount()}`);
    if (result.ok) {
      const injection = result.value.systemPromptAddition + cronWarning;
      console.log(injection);
      console.log("\n[Praxis Phase1A] 注入验证码: PRAXIS-1A-OK-8f3a");
      logSession(getSessionCount(), "context_injected");
    } else {
      console.error("inject failed:", result.error.message);
      process.exit(1);
    }
  })();
} else if (cmd === "end") {
  const transcriptFile = process.argv[3];
  if (!transcriptFile) {
    console.error("用法: tsx src/phase1a-bridge.ts end <transcript-file>");
    process.exit(1);
  }
  (async () => {
    const v2Analyzer = new TranscriptAnalyzerV2(llmClient);
    const v1Fallback = new TranscriptAnalyzer();
    const analyzeTranscript = async (t: string) => {
      const events = await v2Analyzer.analyze(t);
      return events.length > 0 ? events : v1Fallback.analyze(t);
    };
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
  })();
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

    const v2 = new TranscriptAnalyzerV2(llmClient);
    const v1 = new TranscriptAnalyzer();
    const events = await v2.analyze(prompt);
    const finalEvents = events.length > 0 ? events : v1.analyze(prompt);
    if (finalEvents.length > 0) {
      const session = getSessionCount();
      await appendLearnings(finalEvents, session, "auto");
      console.log(`[Praxis Phase1A] 实时提取 ${finalEvents.length} 条学习`);
      for (const e of finalEvents.slice(0, 3)) {
        console.log(`  [${e.type}] ${e.content.slice(0, 80)}`);
      }
      logSession(session, `realtime_learned:${finalEvents.length}`);
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

    const lines = scored.map((l: StoredLearning) =>
      `- [${l.type}] ${l.content.slice(0, 120)} (匹配: ${l.confidence.toFixed(3)})`
    );
    console.log(`\n[Praxis 相关经验]\n${lines.join("\n")}`);
    logSession(getSessionCount(), `expand:${scored.length}`);
  })();
} else {
  console.log(`Praxis Phase1A Bridge
用法:
  tsx src/phase1a-bridge.ts inject           — 输出上下文注入 (SessionStart hook)
  tsx src/phase1a-bridge.ts end <file>       — 分析 transcript (Stop hook)
  tsx src/phase1a-bridge.ts expand           — 搜索经验注入 (UserPromptExpansion hook)
  tsx src/phase1a-bridge.ts learn "<内容>"    — 手动保存学习
  tsx src/phase1a-bridge.ts show             — 查看状态
`);
}
