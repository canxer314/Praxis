/**
 * Phase 1A Bridge — 将 5 个模块接入 Claude Code hook 系统
 *
 * 用法:
 *   tsx src/phase1a-bridge.ts inject        — SessionStart: 输出上下文注入
 *   tsx src/phase1a-bridge.ts end <file>    — SessionEnd: 分析 transcript 并保存学习
 *   tsx src/phase1a-bridge.ts show          — 查看学习状态
 *   tsx src/phase1a-bridge.ts learn "<内容>" — 手动保存学习
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionStartHandler } from "./session-start";
import { SessionEndHandler } from "./session-end";
import { TranscriptAnalyzer } from "./transcript-analyzer";
import { TranscriptAnalyzerV2 } from "./transcript-analyzer-v2";
import { llmClient } from "./llm-client";
import { Result, LearningEvent } from "./platform-adapter";

// ---- 持久化（本地 JSON，等 AgentMemory 集成后替换） ----

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

function appendLearnings(events: LearningEvent[], session: number, source: "auto" | "manual"): void {
  const stored = loadLearnings();
  for (const e of events) {
    stored.push({
      session,
      timestamp: new Date().toISOString(),
      type: e.type,
      content: e.content,
      confidence: e.confidence,
      source,
    });
  }
  saveLearnings(stored);
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

// ---- 模拟 AgentMemory getSlot（Phase 1A 真实集成前用本地文件） ----

async function mockGetSlot(_name: string): Promise<Result<unknown>> {
  const stored = loadLearnings();
  const bestPractices = stored.filter((s) => s.type === "pattern" || s.type === "insight").map((s) => s.content);
  const antiPatterns = stored.filter((s) => s.type === "pitfall" || s.type === "correction").map((s) => s.content);

  return {
    ok: true,
    value: {
      skills: [
        { id: "typescript", name: "TypeScript", proficiency: 0.65, level: "competent" },
        { id: "architecture", name: "系统架构设计", proficiency: 0.80, level: "proficient" },
        { id: "ai-agent", name: "AI Agent 系统", proficiency: 0.70, level: "competent" },
        { id: "obsidian", name: "Obsidian 笔记管理", proficiency: 0.75, level: "competent" },
      ],
      best_practices: [...new Set(bestPractices)].slice(-20),
      anti_patterns: [...new Set(antiPatterns)].slice(-20),
    },
  };
}

async function mockSetSlot(name: string, data: unknown): Promise<Result<void>> {
  ensureDir();
  const file = path.join(MEMORY_DIR, `slot-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  return { ok: true, value: undefined };
}

// ---- 命令 ----

const cmd = process.argv[2];

if (cmd === "inject") {
  (async () => {
    const handler = new SessionStartHandler({ getSlot: mockGetSlot });
    const result = await handler.handle(`session-${getSessionCount()}`);
    if (result.ok) {
      console.log(result.value.systemPromptAddition);
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
      setSlot: mockSetSlot,
    });

    const transcript = fs.readFileSync(transcriptFile, "utf-8");
    const session = getSessionCount();
    const result = await handler.handle(`session-${session}`, transcript);

    if (result.ok && result.value.learningEvents && result.value.learningEvents.length > 0) {
      appendLearnings(result.value.learningEvents, session, "auto");
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
  appendLearnings([event], session, "manual");
  console.log(`[Praxis Phase1A] 已保存 (session ${session})`);
  logSession(session, "manual_learn");
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
      appendLearnings(finalEvents, session, "auto");
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

    const stored = loadLearnings();
    if (stored.length === 0) return; // 无学习 → 零注入

    // 中文 n-gram 匹配（无 AgentMemory 时的轻量方案）
    const grams = new Set<string>();
    for (let i = 0; i < prompt.length - 1; i++) grams.add(prompt.slice(i, i + 2));
    for (let i = 0; i < prompt.length - 2; i++) grams.add(prompt.slice(i, i + 3));
    const keywords = [...grams].filter((g: string) => /[一-鿿]/.test(g));
    // 去重 + 排序
    const seen = new Set<string>();
    const scored = stored
      .map((l: StoredLearning) => {
        const lower = l.content.toLowerCase();
        const hits = keywords.filter((kw: string) => lower.includes(kw)).length;
        return { ...l, score: hits > 0 ? hits * l.confidence : 0 };
      })
      .filter((l: { score: number; content: string }) => {
        if (l.score === 0) return false;
        const key = l.content.slice(0, 60);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, 3);

    if (scored.length === 0) return; // 无相关 → 零注入

    const lines = scored.map((l: StoredLearning) =>
      `- [${l.type}] ${l.content.slice(0, 120)} (置信度: ${l.confidence.toFixed(1)})`
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
