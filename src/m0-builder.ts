/**
 * M0 Builder — Phase 5: 共享 M0Deps 工厂
 *
 * 从 phase1a-bridge.ts 提取 buildM0Deps(), 供:
 *   - scripts/praxis-hook.ts (per-hook 入口)
 *   - scripts/praxis-cron.ts (cron-tick 入口)
 * 共用。
 *
 * 使用方式:
 *   import { buildM0Deps } from "./m0-builder";
 *   const deps = buildM0Deps({ memoryDir: "/path/to/cache" });
 *   const orch = new EventOrchestrator(deps);
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { M0Deps, ProtoStructureCandidate } from "./m0-deps";
import type { ProtoStructure } from "./cognitive/types";
import { agentmemory } from "./agentmemory-client";
import { TranscriptAnalyzerV2 } from "./analysis/transcript-analyzer-v2";
import { llmClient } from "./llm-client";
import { ConfidenceFuser } from "./orchestration/confidence-fuser";

// ══════════════════════════════════════════════════════════════════
// 配置
// ══════════════════════════════════════════════════════════════════

const DEFAULT_MEMORY_DIR = path.join(os.homedir(), ".praxis-phase1a");

export interface M0BuilderOptions {
  /** 本地缓存目录 (降级用 JSON 文件持久化) */
  memoryDir?: string;
}

// ══════════════════════════════════════════════════════════════════
// extractProtoStructuresViaLLM — Phase 0 惰性初始化
// ══════════════════════════════════════════════════════════════════

let _extractProtoViaLLM: ((t: string) => Promise<ProtoStructureCandidate[]>) | null = null;
let _extractInitError = false;

/** Phase 8: 从学习事件 content + type 推断 protoType */
function inferProtoType(
  learningType: string,
  content: string,
): ProtoStructureCandidate["protoType"] {
  const text = content.toLowerCase();
  const cn = content;

  // constraint: 禁止性/强制性语言 → 约束
  if (/必须|禁止|不能|永远不要|不可|不得|never|must\b|always\b|强制|必须遵守|决不/.test(cn)) {
    return "constraint";
  }

  // sequence: 流程/步骤/顺序描述 → 序列
  if (/流程|步骤|顺序|先.*再|首先.*然后|→|调用链|先处理.*再处理|收到.*检查.*调用/.test(cn) ||
      (learningType === "pattern" && /→|流程|步骤/.test(cn))) {
    return "sequence";
  }

  // purpose: 目标/目的/意图 → 目标
  if (/目标|目的|为了|旨在|意义|purpose|goal|aim|希望达到|实现.*目标/.test(cn)) {
    return "purpose";
  }

  // role: 角色/职责/平台适配/分工 → 角色
  if (/负责|角色|平台|适配|映射到|使用.*工具|每个.*采用|根据.*平台|作为.*代理|担任/.test(cn) ||
      (learningType === "preference" && /平台|工具.*选择/.test(cn))) {
    return "role";
  }

  // 默认 → concept
  return "concept";
}

function getExtractProtoFn(): (t: string) => Promise<ProtoStructureCandidate[]> {
  if (_extractProtoViaLLM) return _extractProtoViaLLM;
  if (_extractInitError) return async () => [];

  try {
    const analyzer = new TranscriptAnalyzerV2(llmClient);
    _extractProtoViaLLM = async (transcript: string): Promise<ProtoStructureCandidate[]> => {
      try {
        const events = await analyzer.analyze(transcript);
        // 转换 LearningEvent[] → ProtoStructureCandidate[]
        // Phase 8: 代码层 inferProtoType — LLM 仅提取语义, protoType 由关键词+类型信号推断
        return events.map((e) => {
          const raw = e as unknown as Record<string, unknown>;
          const content = String(raw.content ?? raw.tentativeName ?? "");
          const learningType = String(raw.type ?? "");
          return {
            protoType: inferProtoType(learningType, content),
            tentativeName: content,
            scenarioId: String(raw.scenarioId ?? "general"),
            confidence: Number(raw.confidence ?? 0.5),
          };
        });
      } catch {
        return [];
      }
    };
    return _extractProtoViaLLM;
  } catch {
    _extractInitError = true;
    return async () => [];
  }
}

// ══════════════════════════════════════════════════════════════════
// buildM0Deps
// ══════════════════════════════════════════════════════════════════

export function buildM0Deps(opts: M0BuilderOptions = {}): M0Deps {
  const cacheDir = opts.memoryDir ?? DEFAULT_MEMORY_DIR;
  const analyzer = new TranscriptAnalyzerV2(llmClient);

  function ensureDir(): void {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  return {
    memory: {
      isAvailable: () => agentmemory.isAvailable(),
      getSlot: (name: string) => agentmemory.getSlot(name),
      setSlot: (name: string, value: unknown) => agentmemory.setSlot(name, value),
      smartSearch: async (query: string, type?: string) => {
        if (type === "proto_structure") {
          return agentmemory.searchProtoStructures(query);
        }
        try {
          const results = await agentmemory.smartSearch(query, 20);
          return { ok: true as const, value: results as unknown[] };
        } catch (e) {
          return { ok: false, error: { code: "SEARCH_ERROR", message: String(e) } };
        }
      },
      saveLesson: async (lesson: Record<string, unknown>) => {
        const content = String(lesson.content || "");
        const tags = Array.isArray(lesson.tags) ? lesson.tags.map(String) : [];
        const confidence = Number(lesson.confidence ?? 0.8);
        return agentmemory.saveLesson(content, tags, confidence);
      },
      saveProtoStructure: async (structure: ProtoStructure) =>
        agentmemory.saveProtoStructure(structure as unknown as Record<string, unknown>),
      searchLessons: (query?: string, limit?: number, minConfidence?: number) =>
        agentmemory.searchLessons(query, limit, minConfidence),
    },
    cache: {
      get: (key: string) => {
        try {
          const filePath = path.join(cacheDir, `cache-${key}.json`);
          if (!fs.existsSync(filePath)) return null;
          return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch {
          return null;
        }
      },
      set: (key: string, value: unknown) => {
        try {
          ensureDir();
          fs.writeFileSync(
            path.join(cacheDir, `cache-${key}.json`),
            JSON.stringify(value),
            "utf-8",
          );
        } catch {
          /* 缓存写入失败不影响主流程 */
        }
      },
      list: () => {
        try {
          if (!fs.existsSync(cacheDir)) return [];
          return fs
            .readdirSync(cacheDir)
            .filter((f) => f.startsWith("cache-") && f.endsWith(".json"))
            .map((f) => {
              const key = f.slice(6, -5);
              const raw = fs.readFileSync(path.join(cacheDir, f), "utf-8");
              return {
                key,
                value: JSON.parse(raw),
                writtenAt: fs.statSync(path.join(cacheDir, f)).mtimeMs,
              };
            });
        } catch {
          return [];
        }
      },
      delete: (key: string) => {
        try {
          const filePath = path.join(cacheDir, `cache-${key}.json`);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {
          /* 忽略 */
        }
      },
    },
    llm: {
      analyzeTranscript: (t: string) => analyzer.analyze(t),
      extractProtoStructures: (t: string) => getExtractProtoFn()(t),
      analyze: (prompt: string) => llmClient.analyze(prompt),
    },
    fuser: new ConfidenceFuser(),
    attentionRecords: new Map(),
  };
}
