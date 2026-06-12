/**
 * Praxis PoC — 验证核心假设:
 * "跨 session 上下文注入 + 学习事件提取能改善 LLM 性能"
 *
 * 用法:
 *   npx tsx poc/index.ts inject   — 输出上下文注入块（贴到 system prompt）
 *   npx tsx poc/index.ts learn "<内容>" [--type=<类型>]  — 保存一条学习
 *   npx tsx poc/index.ts analyze <transcript文件>  — 输出提取 prompt（贴给 Claude）
 *   npx tsx poc/index.ts show     — 查看当前状态
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PRAXIS_HOME = path.join(os.homedir(), ".praxis-poc");
const STATE_FILE = path.join(PRAXIS_HOME, "state.json");

// --- 数据模型 ---

interface Skill {
  id: string;
  name: string;
  proficiency: number;
  level: "novice" | "advanced_beginner" | "competent" | "proficient" | "expert";
}

interface Learning {
  id: number;
  session: number;
  timestamp: string;
  type: "correction" | "preference" | "pattern" | "insight" | "pitfall";
  content: string;
  confidence: number; // 0.0-1.0, PoC 中人工设定
}

interface PraxisState {
  session_count: number;
  competency_model: {
    skills: Skill[];
    best_practices: string[];
    anti_patterns: string[];
  };
  learnings: Learning[];
  last_session: string | null;
}

// --- 状态读写 ---

const DEFAULT_STATE: PraxisState = {
  session_count: 0,
  competency_model: {
    skills: [
      { id: "typescript", name: "TypeScript", proficiency: 0.6, level: "competent" },
      { id: "architecture", name: "系统架构设计", proficiency: 0.8, level: "proficient" },
      { id: "ai-agent", name: "AI Agent 系统", proficiency: 0.7, level: "competent" },
    ],
    best_practices: [],
    anti_patterns: [],
  },
  learnings: [],
  last_session: null,
};

function ensureState(): void {
  if (!fs.existsSync(PRAXIS_HOME)) {
    fs.mkdirSync(PRAXIS_HOME, { recursive: true });
  }
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2) + "\n", "utf-8");
  }
}

function loadState(): PraxisState {
  ensureState();
  const raw = fs.readFileSync(STATE_FILE, "utf-8");
  return JSON.parse(raw);
}

function saveState(state: PraxisState): void {
  ensureState();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

// --- inject: 输出上下文注入块 ---

function inject(): void {
  const state = loadState();

  // 递增 session 计数
  state.session_count += 1;
  state.last_session = new Date().toISOString();
  saveState(state);

  const skills = state.competency_model.skills
    .map((s) => `- ${s.name}: ${s.proficiency.toFixed(2)} (${s.level})`)
    .join("\n");

  const learnings = state.learnings
    .slice(-10) // 最近 10 条
    .map(
      (l) =>
        `- [S${l.session}] [${l.type}] ${l.content} (confidence: ${l.confidence.toFixed(1)})`
    )
    .join("\n");

  const bestPractices =
    state.competency_model.best_practices.length > 0
      ? state.competency_model.best_practices.map((p) => `- ${p}`).join("\n")
      : "（尚无）";

  const antiPatterns =
    state.competency_model.anti_patterns.length > 0
      ? state.competency_model.anti_patterns.map((a) => `- ${a}`).join("\n")
      : "（尚无）";

  const output = `
## Praxis Context (PoC — Session ${state.session_count})

### 能力概况
${skills}

### 最近学习（最近 10 条）
${learnings || "（尚无学习记录）"}

### 最佳实践
${bestPractices}

### 已知陷阱
${antiPatterns}
`.trim();

  console.log(output);
}

// --- learn: 保存一条学习 ---

function learn(content: string, type: string, confidence: number): void {
  const state = loadState();

  const learning: Learning = {
    id: state.learnings.length + 1,
    session: state.session_count,
    timestamp: new Date().toISOString(),
    type: validateType(type),
    content,
    confidence: Math.min(1, Math.max(0, confidence)),
  };

  state.learnings.push(learning);

  // 自动更新能力模型
  if (type === "correction" || type === "pitfall") {
    if (!state.competency_model.anti_patterns.includes(content)) {
      state.competency_model.anti_patterns.push(content);
    }
  } else if (type === "pattern" || type === "insight") {
    if (!state.competency_model.best_practices.includes(content)) {
      state.competency_model.best_practices.push(content);
    }
  }

  saveState(state);
  console.log(`✅ 学习已保存 (id=${learning.id}, session=${learning.session})`);
  console.log(`   类型: ${learning.type} | 置信度: ${learning.confidence.toFixed(1)}`);
}

function validateType(type: string): Learning["type"] {
  const valid = ["correction", "preference", "pattern", "insight", "pitfall"];
  if (valid.includes(type)) return type as Learning["type"];
  console.error(`无效类型 "${type}"，使用默认值 "insight"。有效值: ${valid.join(", ")}`);
  return "insight";
}

// --- analyze: 输出提取 prompt ---

function analyze(transcriptPath: string): void {
  const transcript = fs.readFileSync(transcriptPath, "utf-8");

  const prompt = `
你是一个学习事件提取器。分析以下对话记录，提取最多 3 条学习事件。

对每条学习事件，输出格式：
  npx tsx poc/index.ts learn "<学习内容>" --type=<correction|preference|pattern|insight|pitfall> --confidence=<0.0-1.0>

类型说明：
- correction: 用户纠正了AI的错误行为
- preference: 用户表达了偏好或风格倾向
- pattern: 发现了可复用的任务模式
- insight: 领域知识或架构洞察
- pitfall: 遇到的陷阱或错误模式

对话记录：
---
${transcript.slice(0, 8000)}
---
`.trim();

  console.log(prompt);
  console.log("\n--- 将以上 prompt 贴给 Claude，然后运行输出的 learn 命令 ---");
}

// --- show: 查看当前状态 ---

function show(): void {
  const state = loadState();

  console.log(`=== Praxis PoC 状态 ===`);
  console.log(`Session 数: ${state.session_count}`);
  console.log(`学习条目: ${state.learnings.length}`);
  console.log(`上次 session: ${state.last_session || "无"}`);
  console.log(`\n技能:`);
  state.competency_model.skills.forEach((s) => {
    const bar = "█".repeat(Math.round(s.proficiency * 10)) + "░".repeat(10 - Math.round(s.proficiency * 10));
    console.log(`  ${s.name}: ${bar} ${s.proficiency.toFixed(1)} (${s.level})`);
  });
  console.log(`\n最近学习:`);
  state.learnings.slice(-5).forEach((l) => {
    console.log(`  [S${l.session}] [${l.type}] ${l.content} (${l.confidence.toFixed(1)})`);
  });
}

// --- CLI ---

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case "inject":
    inject();
    break;

  case "learn": {
    const content = args[1];
    if (!content) {
      console.error("用法: npx tsx poc/index.ts learn \"<内容>\" [--type=<类型>] [--confidence=<0.0-1.0>]");
      process.exit(1);
    }
    const typeFlag = args.find((a) => a.startsWith("--type="));
    const type = typeFlag ? typeFlag.split("=")[1] : "insight";
    const confFlag = args.find((a) => a.startsWith("--confidence="));
    const confidence = confFlag ? parseFloat(confFlag.split("=")[1]) : 0.7;
    learn(content, type, confidence);
    break;
  }

  case "analyze": {
    const filePath = args[1];
    if (!filePath) {
      console.error("用法: npx tsx poc/index.ts analyze <transcript文件>");
      process.exit(1);
    }
    analyze(filePath);
    break;
  }

  case "show":
    show();
    break;

  case "init":
    ensureState();
    if (fs.existsSync(STATE_FILE)) {
      console.log(`state.json 已存在于 ${STATE_FILE}`);
      console.log("如需重置，请使用: npx tsx poc/index.ts reset");
    } else {
      saveState({ ...DEFAULT_STATE });
      console.log(`✅ state.json 已初始化: ${STATE_FILE}`);
    }
    break;

  case "reset":
    saveState({ ...DEFAULT_STATE });
    console.log(`✅ state.json 已重置: ${STATE_FILE}`);
    break;

  default:
    console.log(`Praxis PoC — 验证核心假设

用法:
  npx tsx poc/index.ts inject              — 输出上下文注入块
  npx tsx poc/index.ts learn "<内容>"       — 保存一条学习
  npx tsx poc/index.ts analyze <文件>       — 输出学习提取 prompt
  npx tsx poc/index.ts show                — 查看当前状态
  npx tsx poc/index.ts init                — 初始化 state.json（首次使用）
  npx tsx poc/index.ts reset               — 重置所有数据

数据存储: ~/.praxis-poc/state.json（跨 session 共享）
`);
    break;
}
