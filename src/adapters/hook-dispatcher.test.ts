/**
 * HookDispatcher tests — Phase 1 TDD (RED first)
 *
 * The HookDispatcher is the per-hook entry point: it takes a hook type
 * + raw hook data, maps through the adapter to a PraxisLifecycleEvent,
 * routes through EventOrchestrator, and returns the result.
 *
 * This replaces phase1a-bridge.ts lifecycle commands with a single
 * adapter-agnostic dispatch function callable from any CLI entry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookDispatcher } from "./hook-dispatcher";
import { EventOrchestrator } from "../orchestrator";
import { ConfidenceFuser } from "../orchestration/confidence-fuser";
import type { M0Deps } from "../m0-deps";
import type { Result } from "../platform-adapter";

function makeSlotBackedDeps() {
  const slots = new Map<string, unknown>();
  const protoStructures = [
    {
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
    },
  ];

  const saveProtoStructure = vi.fn().mockResolvedValue({ ok: true } as Result<void>);

  const deps: M0Deps = {
    memory: {
      isAvailable: async () => true,
      getSlot: vi.fn(async (name: string) => ({
        ok: true as const,
        value: slots.get(name) ?? null,
      })),
      setSlot: vi.fn(async (name: string, value: unknown) => {
        slots.set(name, value);
        return { ok: true as const };
      }),
      smartSearch: vi.fn(async (_q: string, type?: string) =>
        type === "proto_structure"
          ? { ok: true as const, value: protoStructures }
          : { ok: true as const, value: [] }),
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
    attentionRecords: new Map(),
    fuser: new ConfidenceFuser(),
  };
  return { deps, saveProtoStructure, slots };
}

describe("HookDispatcher", () => {
  let dispatcher: HookDispatcher;
  let deps: M0Deps;

  beforeEach(() => {
    const built = makeSlotBackedDeps();
    deps = built.deps;
    dispatcher = new HookDispatcher(deps);
  });

  describe("session_start hook", () => {
    it("returns context injection text with structures and capability summary", async () => {
      const result = await dispatcher.dispatch("session_start", {
        session_id: "hd-session-1",
      });

      expect(result.exitCode).toBe(0);
      // session_start produces context injection text
      expect(result.output).toContain("Praxis Context");
      expect(result.output).toContain("Capability");
    });

    it("generates unique session IDs when none provided", async () => {
      const result = await dispatcher.dispatch("session_start", {});

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Praxis Context");
    });
  });

  describe("message_received hook", () => {
    it("processes user message and emits correction signal for relevant structures", async () => {
      // First start a session to load structures
      await dispatcher.dispatch("session_start", { session_id: "hd-msg" });

      const result = await dispatcher.dispatch("message_received", {
        session_id: "hd-msg",
        message: { role: "user", content: "门诊流程，不对，顺序错了" },
      });

      // message_received is silent on success (no output to inject)
      expect(result.exitCode).toBe(0);
    });
  });

  describe("before_tool_call hook", () => {
    it("returns allow decision for safe tools", async () => {
      await dispatcher.dispatch("session_start", { session_id: "hd-btc" });

      const result = await dispatcher.dispatch("before_tool_call", {
        session_id: "hd-btc",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/test.txt" },
      });

      expect(result.exitCode).toBe(0);
      // before_tool_call returns JSON decision
      const decision = JSON.parse(result.output);
      expect(decision.allowed).toBe(true);
    });
  });

  describe("after_tool_call hook", () => {
    it("records tool call in trace", async () => {
      await dispatcher.dispatch("session_start", { session_id: "hd-atc" });

      const result = await dispatcher.dispatch("after_tool_call", {
        session_id: "hd-atc",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/test.txt" },
        result: { success: true },
      });

      expect(result.exitCode).toBe(0);
    });
  });

  describe("agent_end hook", () => {
    it("returns agent end summary with lesson counts", async () => {
      await dispatcher.dispatch("session_start", { session_id: "hd-ae" });
      await dispatcher.dispatch("message_received", {
        session_id: "hd-ae",
        message: { role: "user", content: "门诊流程，不对，顺序错了" },
      });

      const result = await dispatcher.dispatch("agent_end", {
        session_id: "hd-ae",
      });

      expect(result.exitCode).toBe(0);
      // agent_end returns JSON summary
      const summary = JSON.parse(result.output);
      expect(summary).toHaveProperty("toolCallCount");
    });
  });

  describe("session_end hook", () => {
    it("fuses structures and returns fusion count", async () => {
      await dispatcher.dispatch("session_start", { session_id: "hd-se" });
      await dispatcher.dispatch("message_received", {
        session_id: "hd-se",
        message: { role: "user", content: "门诊流程，不对，顺序错了" },
      });
      await dispatcher.dispatch("agent_end", { session_id: "hd-se" });

      const result = await dispatcher.dispatch("session_end", {
        session_id: "hd-se",
        transcript: "用户: 门诊流程，不对，顺序错了\nassistant: [PREDICTION_CONFIRMED: ps-clinic-flow]",
      });

      expect(result.exitCode).toBe(0);
      const summary = JSON.parse(result.output);
      expect(summary).toHaveProperty("fusedCount");
      expect(summary.fusedCount).toBeGreaterThan(0);
    });
  });

  describe("cross-process state sharing", () => {
    it("orchestrator B loads state persisted by orchestrator A", async () => {
      // Shared slot map — simulates AgentMemory as cross-process persistence
      const sharedSlots = new Map<string, unknown>();

      // Process A: session_start + message
      const { deps: depsA } = makeSlotBackedDeps();
      // Override getSlot/setSlot to use the shared map
      depsA.memory.getSlot = vi.fn(async (name: string) => ({
        ok: true as const,
        value: sharedSlots.get(name) ?? null,
      }));
      depsA.memory.setSlot = vi.fn(async (name: string, value: unknown) => {
        sharedSlots.set(name, value);
        return { ok: true as const };
      });
      const dispA = new HookDispatcher(depsA);
      await dispA.dispatch("session_start", { session_id: "xp-shared" });
      await dispA.dispatch("message_received", {
        session_id: "xp-shared",
        message: { role: "user", content: "门诊流程，不对，顺序错了" },
      });

      // Process B: NEW dispatcher reads state from the SAME shared slot
      const { deps: depsB } = makeSlotBackedDeps();
      depsB.memory.getSlot = vi.fn(async (name: string) => ({
        ok: true as const,
        value: sharedSlots.get(name) ?? null,
      }));
      depsB.memory.setSlot = vi.fn(async (name: string, value: unknown) => {
        sharedSlots.set(name, value);
        return { ok: true as const };
      });
      const dispB = new HookDispatcher(depsB);
      await dispB.dispatch("agent_end", { session_id: "xp-shared" });
      const result = await dispB.dispatch("session_end", {
        session_id: "xp-shared",
        transcript: "用户: 门诊流程，不对\nassistant: [PREDICTION_CONFIRMED: ps-clinic-flow]",
      });

      expect(result.exitCode).toBe(0);
      const summary = JSON.parse(result.output);
      // Fusion ran from state persisted by Process A
      expect(summary.fusedCount).toBeGreaterThan(0);
    });
  });

  describe("cron_tick hook", () => {
    it("runs cron tick handler successfully", async () => {
      const result = await dispatcher.dispatch("cron_tick", {});

      expect(result.exitCode).toBe(0);
    });
  });

  describe("unknown hook type", () => {
    it("returns error for unrecognized hook", async () => {
      const result = await dispatcher.dispatch("unknown_hook", {});

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("Unknown hook type");
    });
  });
});
