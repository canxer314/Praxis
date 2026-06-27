/**
 * Orchestrator fusion integration test — proves the Phase 0 M4 wiring
 * (multi-source fuser + ProtoStructure persistence) actually runs
 * end-to-end through EventOrchestrator with a fully-populated M0Deps.
 *
 * This is the integration test the M1–M6 eng review (2026-06-27) identified
 * as the missing "definition of done": a real session_start→session_end run
 * through EventOrchestrator with full deps that produces a persisted, fused
 * ProtoStructure. Its absence hid the finding that fusion never ran.
 *
 * Architecture refs: §4 (7-source fusion), §10 (session_end), Phase 0 wiring.
 */
import { describe, it, expect, vi } from "vitest";
import { EventOrchestrator } from "./orchestrator";
import { ConfidenceFuser } from "./orchestration/confidence-fuser";
import type { M0Deps } from "./m0-deps";
import type { Result } from "./platform-adapter";

function makeFusedDeps(protoStructures: unknown[]): {
  deps: M0Deps;
  saveProtoStructure: ReturnType<typeof vi.fn>;
} {
  const saveProtoStructure = vi.fn().mockResolvedValue({ ok: true } as Result<void>);
  const deps: M0Deps = {
    memory: {
      isAvailable: async () => true,
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null } as Result<unknown>),
      setSlot: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      smartSearch: vi.fn(async (_q: string, type?: string) => {
        if (type === "proto_structure") {
          return { ok: true as const, value: protoStructures };
        }
        return { ok: true as const, value: [] };
      }),
      saveLesson: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      saveProtoStructure,
    },
    cache: {
      get: () => null,
      set: () => {},
      list: () => [],
      delete: () => {},
    },
    llm: {
      analyzeTranscript: async () => [],
      extractProtoStructures: async () => [],
      analyze: async () => ({ ok: true as const, value: "" }),
    },
    fuser: new ConfidenceFuser(),
    attentionRecords: new Map(),
  };
  return { deps, saveProtoStructure };
}

// A ProtoStructure as AgentMemory would return it. session_start maps this to a
// summary ({id,tentativeName,protoType,confidence,scenarioId,summary}); the fusion
// loop then operates on that summary.
const CLINIC_FLOW = {
  id: "ps-clinic-flow",
  protoType: "sequence",
  tentativeName: "门诊流程",
  scenarioId: "hospital_outpatient",
  confidence: 0.5,
  observationsCount: 3,
  lifecycle: "experimental",
  summary: "挂号→分诊→问诊",
  structure: { steps: [{ position: 1, action: "挂号" }, { position: 2, action: "分诊" }] },
  function: { postcondition: [] },
  relations: [],
  versionChain: [],
  updatedAt: Date.now(),
};

describe("EventOrchestrator fusion e2e (M4 Phase 0 wiring)", () => {
  it("fuses + persists a structure when llm_marker + mid_session sources align", async () => {
    const { deps, saveProtoStructure } = makeFusedDeps([CLINIC_FLOW]);
    const orchestrator = new EventOrchestrator(deps);

    await orchestrator.handleSessionStart("fuse-e2e");

    // User correction. Note: the correction keyword must be a *separate* CJK token
    // from the structure name, because matchStructures checks searchText.includes(keyword)
    // — a keyword "门诊流程错了" (name+error contiguous) would not match the name
    // "门诊流程". Punctuation between them yields "门诊流程" as its own keyword.
    await orchestrator.handleMessageReceived("fuse-e2e", {
      role: "user",
      content: "门诊流程，不对，顺序错了",
    });

    await orchestrator.handleAgentEnd("fuse-e2e");

    // Transcript carries a [PREDICTION_CONFIRMED] marker → llm_marker source for the same structure.
    const result = await orchestrator.handleSessionEnd(
      "fuse-e2e",
      "用户: 门诊流程，不对，顺序错了\nassistant: [PREDICTION_CONFIRMED: ps-clinic-flow]",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Fusion ran: ≥1 structure was fused (llm_marker + mid_session ≥ MIN_SOURCES).
      expect(result.value.fusedCount).toBeGreaterThan(0);
    }
    // Persistence: the fused structure was written back to memory.
    expect(saveProtoStructure).toHaveBeenCalled();
    const saved = saveProtoStructure.mock.calls[0]?.[0] as {
      id?: string;
      confidence?: number;
    };
    expect(saved?.id).toBe("ps-clinic-flow");
    // Confidence was fused away from the initial 0.5.
    expect(saved?.confidence).not.toBe(0.5);
  });
});

// Phase 0 acceptance: cross-process session state survives via SessionStateStore.
// Map-backed slot store so orchestrator B can read what orchestrator A wrote.
function makeSlotBackedDeps(protoStructures: unknown[]) {
  const slots = new Map<string, unknown>();
  const saveProtoStructure = vi.fn().mockResolvedValue({ ok: true } as Result<void>);
  const deps: M0Deps = {
    memory: {
      isAvailable: async () => true,
      getSlot: vi.fn(async (name: string) => ({ ok: true as const, value: slots.get(name) ?? null })),
      setSlot: vi.fn(async (name: string, value: unknown) => { slots.set(name, value); return { ok: true as const }; }),
      smartSearch: vi.fn(async (_q: string, type?: string) =>
        type === "proto_structure" ? { ok: true as const, value: protoStructures } : { ok: true as const, value: [] }),
      saveLesson: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      saveProtoStructure,
    },
    cache: { get: () => null, set: () => {}, list: () => [], delete: () => {} },
    llm: {
      analyzeTranscript: async () => [],
      extractProtoStructures: async () => [],
      analyze: async () => ({ ok: true as const, value: "" }),
    },
    fuser: new ConfidenceFuser(),
    attentionRecords: new Map(),
  };
  return { deps, saveProtoStructure, slots };
}

describe("EventOrchestrator cross-process state (Phase 0 SessionStateStore)", () => {
  it("orchestrator B (session_end) loads state persisted by orchestrator A (session_start+message)", async () => {
    const { deps, saveProtoStructure } = makeSlotBackedDeps([CLINIC_FLOW]);

    // Process A: session_start + message (produces mid_session source) → state persisted to slot
    const orchA = new EventOrchestrator(deps);
    await orchA.handleSessionStart("xp-session");
    await orchA.handleMessageReceived("xp-session", { role: "user", content: "门诊流程，不对，顺序错了" });

    // Process B: NEW orchestrator instance (empty in-memory Map) — must load state from slot
    const orchB = new EventOrchestrator(deps);
    await orchB.handleAgentEnd("xp-session");
    const result = await orchB.handleSessionEnd(
      "xp-session",
      "用户: 门诊流程，不对\nassistant: [PREDICTION_CONFIRMED: ps-clinic-flow]",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // fusion ran from persisted state (mid_session from A + llm_marker from transcript)
      expect(result.value.fusedCount).toBeGreaterThan(0);
    }
    expect(saveProtoStructure).toHaveBeenCalled();
    const saved = saveProtoStructure.mock.calls[0]?.[0] as { id?: string };
    expect(saved?.id).toBe("ps-clinic-flow");
  });
});
