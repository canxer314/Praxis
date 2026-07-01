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
import { ConfidenceFuser } from "./confidence-fuser";
import type { M0Deps } from "../m0-deps";
import type { Result } from "../platform-adapter";
import type { SignalSourceInput } from "../cognitive/types";

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
    const { deps } = makeFusedDeps([CLINIC_FLOW]);
    // T11: CrossAgentSync uses per-structure slots via setSlot (CAS write),
    // not saveProtoStructure. Track setSlot calls for persistence verification.
    const setSlotSpy = deps.memory.setSlot as ReturnType<typeof vi.fn>;
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
    // Phase 8: saveProtoStructure (lesson-based) replaces CrossAgentSync (slot-based)
    expect(saveProtoStructure).toHaveBeenCalled();
    const savedCall = saveProtoStructure.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.id === "ps-clinic-flow",
    );
    expect(savedCall).toBeDefined();
    const saved = savedCall?.[0] as Record<string, unknown>;
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
    const { deps, slots, saveProtoStructure } = makeSlotBackedDeps([CLINIC_FLOW]);

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
    // Phase 8: saveProtoStructure (lesson-based) replaces CrossAgentSync
    expect(saveProtoStructure).toHaveBeenCalled();
    const savedCall = saveProtoStructure.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.id === "ps-clinic-flow",
    );
    expect(savedCall).toBeDefined();
    expect((savedCall?.[0] as Record<string, unknown>)?.id).toBe("ps-clinic-flow");
  });

  it("T1: LLM-independent verifiers (statistical) feed fusion when toolCallTrace present", async () => {
    const { deps } = makeSlotBackedDeps([CLINIC_FLOW]);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const fuseSpy = vi.spyOn(deps.fuser!, "fuse");
    const orch = new EventOrchestrator(deps);
    await orch.handleSessionStart("t1-session");
    // after_tool_call with tools matching CLINIC_FLOW steps (挂号, 分诊) → StatisticalVerifier match (1.0)
    await orch.handleAfterToolCall("t1-session", "挂号", {}, { success: true });
    await orch.handleAfterToolCall("t1-session", "分诊", {}, { success: true });
    await orch.handleMessageReceived("t1-session", { role: "user", content: "门诊流程，不对，顺序错了" });
    await orch.handleAgentEnd("t1-session");
    await orch.handleSessionEnd("t1-session", "用户: 门诊流程\nassistant: [PREDICTION_CONFIRMED: ps-clinic-flow]");
    // T1: a statistical (LLM-independent) source reached the fuser — LLM self-eval loop broken
    const allSources = fuseSpy.mock.calls.flatMap((c) => c[0] as SignalSourceInput[]);
    expect(allSources.some((s) => s.sourceName === "statistical")).toBe(true);
  });

  it("T6: relation-graph confidence propagation (A depends_on B → B fused → A propagates)", async () => {
    // B: sequence with step "分诊"; A: sequence depends_on B (strength 1.0)
    const B = { ...CLINIC_FLOW, id: "ps-triage", tentativeName: "分诊流程", structure: { steps: [{ position: 1, action: "分诊" }] }, relations: [] };
    const A = {
      ...CLINIC_FLOW, id: "ps-consult", tentativeName: "问诊流程",
      structure: { steps: [{ position: 1, action: "问诊" }] },
      relations: [{ targetId: "ps-triage", type: "depends_on" as const, strength: 1.0, evidence: [], establishedAt: 0, lastValidatedAt: 0 }],
    };
    const { deps, slots, saveProtoStructure } = makeSlotBackedDeps([A, B]);
    const orch = new EventOrchestrator(deps);
    await orch.handleSessionStart("t6-session");
    // after_tool_call matching B's step "分诊" → StatisticalVerifier match for B; llm_marker for B
    await orch.handleAfterToolCall("t6-session", "分诊", {}, { success: true });
    await orch.handleSessionEnd("t6-session", "用户: 分诊\nassistant: [PREDICTION_CONFIRMED: ps-triage]");

    // B fused (llm_marker + statistical) → confidence changed → propagated to A (depends_on B)
    // Phase 8: verify via saveProtoStructure (lesson-based), not CrossAgentSync slot
    const savedA = saveProtoStructure.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.id === "ps-consult",
    )?.[0] as Record<string, unknown> | undefined;
    expect(savedA).toBeDefined();
    // A had no direct fusion sources (its step "问诊" didn't match "分诊") → its confidence change
    // is purely from relation-graph propagation (§3 depends_on).
    expect(savedA!.confidence).not.toBe(0.5);
  });
});
