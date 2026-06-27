/**
 * M0Deps Factory — Phase 1: extracted from phase1a-bridge.ts
 *
 * Shared factory for building M0Deps with AgentMemory-backed persistence.
 * Used by both the new per-hook bun entry (scripts/praxis-hook.ts) and
 * the legacy phase1a-bridge.ts during the transition period.
 *
 * Architecture: §11 EventOrchestrator module tree, Phase 0 state persistence.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { TranscriptAnalyzerV2 } from "./transcript-analyzer-v2";
import { llmClient } from "./llm-client";
import { agentmemory } from "./agentmemory-client";
import { ConfidenceFuser } from "./orchestration/confidence-fuser";
import type { M0Deps, ProtoStructureCandidate } from "./m0-deps";
import type { ProtoStructure } from "./cognitive/types";

// ══════════════════════════════════════════════════════════════════
// Cache directory
// ══════════════════════════════════════════════════════════════════

const MEMORY_DIR = path.join(os.homedir(), ".praxis-phase1a");

function ensureDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// ══════════════════════════════════════════════════════════════════
// LLM-backed ProtoStructure extraction
// ══════════════════════════════════════════════════════════════════

/**
 * M1.5: LLM-backed ProtoStructure extraction (partial impl — full T7 follow-up).
 * Prompts the LLM for candidates as strict JSON, validates protoType, and falls
 * back to [] on ANY parse/shape failure — never emits garbage structures.
 */
async function extractProtoStructuresViaLLM(
  transcript: string,
): Promise<ProtoStructureCandidate[]> {
  if (!transcript || transcript.trim().length === 0) return [];
  const prompt =
    "Analyze the following session transcript and extract ProtoStructure candidates. " +
    "Return ONLY a JSON array (no prose, no markdown fences). Each element must have: " +
    '{"protoType":"sequence"|"role"|"concept"|"purpose"|"constraint","tentativeName":string,' +
    '"scenarioId":string,"confidence":0.0-1.0}. Optional: steps:[{position,action,agent?}], ' +
    "purpose, severity, definition, behaviors:[string]. Focus on ProtoSequence first. " +
    "Omit fields that don't apply.\n\nTranscript:\n" +
    transcript.slice(0, 12000);
  const result = await llmClient.analyze(prompt);
  if (!result.ok || !result.value) return [];
  try {
    const parsed: unknown = JSON.parse(result.value);
    if (!Array.isArray(parsed)) return [];
    const validTypes = new Set([
      "sequence",
      "role",
      "concept",
      "purpose",
      "constraint",
    ]);
    return parsed
      .filter(
        (c): c is Record<string, unknown> =>
          typeof c === "object" && c !== null,
      )
      .filter((c) => validTypes.has(String(c.protoType)))
      .map((c) => ({
        protoType: String(
          c.protoType,
        ) as ProtoStructureCandidate["protoType"],
        tentativeName: String(c.tentativeName ?? ""),
        scenarioId: String(c.scenarioId ?? ""),
        confidence:
          typeof c.confidence === "number" ? c.confidence : 0.3,
        steps: Array.isArray(c.steps)
          ? (c.steps as ProtoStructureCandidate["steps"])
          : undefined,
        purpose:
          c.purpose !== undefined ? String(c.purpose) : undefined,
        severity:
          c.severity !== undefined ? String(c.severity) : undefined,
        definition:
          c.definition !== undefined
            ? String(c.definition)
            : undefined,
        behaviors: Array.isArray(c.behaviors)
          ? c.behaviors.map(String)
          : undefined,
      }))
      .filter((c) => c.tentativeName.length > 0);
  } catch {
    return []; // LLM returned non-JSON — no garbage.
  }
}

// ══════════════════════════════════════════════════════════════════
// Factory
// ══════════════════════════════════════════════════════════════════

/**
 * Build M0Deps backed by AgentMemory (+ local filesystem cache fallback).
 * This is the production dependency injection for Praxis runtime.
 *
 * Cache directory: ~/.praxis-phase1a/
 */
export function buildM0Deps(): M0Deps {
  const cacheDir = MEMORY_DIR;
  const analyzer = new TranscriptAnalyzerV2(llmClient);

  return {
    memory: {
      isAvailable: () => agentmemory.isAvailable(),
      getSlot: (name: string) => agentmemory.getSlot(name),
      setSlot: (name: string, value: unknown) =>
        agentmemory.setSlot(name, value),
      smartSearch: async (query: string, type?: string) => {
        if (type === "proto_structure") {
          return agentmemory.searchProtoStructures(query);
        }
        try {
          const results = await agentmemory.smartSearch(query, 20);
          return {
            ok: true as const,
            value: results as unknown[],
          };
        } catch (e) {
          return {
            ok: false,
            error: { code: "SEARCH_ERROR", message: String(e) },
          };
        }
      },
      saveLesson: async (lesson: Record<string, unknown>) => {
        const content = String(lesson.content || "");
        const tags = Array.isArray(lesson.tags)
          ? lesson.tags.map(String)
          : [];
        const confidence = Number(lesson.confidence ?? 0.8);
        return agentmemory.saveLesson(content, tags, confidence);
      },
      saveProtoStructure: async (structure: ProtoStructure) =>
        agentmemory.saveProtoStructure(
          structure as unknown as Record<string, unknown>,
        ),
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
            .filter(
              (f) =>
                f.startsWith("cache-") && f.endsWith(".json"),
            )
            .map((f) => {
              const key = f.slice(6, -5);
              const raw = fs.readFileSync(
                path.join(cacheDir, f),
                "utf-8",
              );
              return {
                key,
                value: JSON.parse(raw),
                writtenAt: fs.statSync(
                  path.join(cacheDir, f),
                ).mtimeMs,
              };
            });
        } catch {
          return [];
        }
      },
      delete: (key: string) => {
        try {
          const filePath = path.join(
            cacheDir,
            `cache-${key}.json`,
          );
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {
          /* 忽略 */
        }
      },
    },
    llm: {
      analyzeTranscript: (t: string) => analyzer.analyze(t),
      extractProtoStructures: (t: string) =>
        extractProtoStructuresViaLLM(t),
      analyze: (prompt: string) => llmClient.analyze(prompt),
    },
    fuser: new ConfidenceFuser(),
    attentionRecords: new Map(),
  };
}
