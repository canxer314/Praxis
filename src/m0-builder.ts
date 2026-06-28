/**
 * M0 Builder — Phase 5: 共享 M0Deps 工厂
 *
 * 从 phase1a-bridge.ts 提取 buildM0Deps(), 供:
 *   - scripts/praxis-hook.ts (per-hook 入口)
 *   - scripts/praxis-cron.ts (cron-tick 入口)
 *   - phase1a-bridge.ts (旧入口, 保持 30 天兼容)
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

function getExtractProtoFn(): (t: string) => Promise<ProtoStructureCandidate[]> {
  if (_extractProtoViaLLM) return _extractProtoViaLLM;
  if (_extractInitError) return async () => [];

  try {
    const analyzer = new TranscriptAnalyzerV2(llmClient);
    _extractProtoViaLLM = async (transcript: string): Promise<ProtoStructureCandidate[]> => {
      try {
        const events = await analyzer.analyze(transcript);
        // 转换 LearningEvent[] → ProtoStructureCandidate[]
        return events.map((e) => {
          const raw = e as unknown as Record<string, unknown>;
          return {
            protoType: (raw.protoType as ProtoStructureCandidate["protoType"]) ?? "concept",
            tentativeName: String(raw.content ?? raw.tentativeName ?? ""),
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
