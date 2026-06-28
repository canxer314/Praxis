// Phase 0.5 D1 measurement: tsx cold-start + Praxis import + minimal before_tool_call route.
// Wall time of `tsx scripts/bench-hook-latency.ts` = tsx startup + Praxis import + route + exit.
// This is the per-hook latency Claude Code would see on every tool call (the D1 variable).

import { EventOrchestrator } from "../src/orchestrator";

async function main(): Promise<void> {
  // Minimal in-memory deps — no real AgentMemory I/O (measures pure route cost).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deps: any = {
    memory: {
      isAvailable: async () => true,
      getSlot: async () => ({ ok: true, value: null }),
      setSlot: async () => ({ ok: true }),
      smartSearch: async () => ({ ok: true, value: [] }),
      saveLesson: async () => ({ ok: true }),
      saveProtoStructure: async () => ({ ok: true }),
    },
    cache: { get: () => null, set: () => {}, list: () => [], delete: () => {} },
  };

  const orch = new EventOrchestrator(deps);
  // session_start first (before_tool_call needs a session state)
  await orch.handleSessionStart("bench-session");
  const t0 = performance.now();
  await orch.handleBeforeToolCall("bench-session", "file_read");
  const routeMs = performance.now() - t0;
  console.log(`ROUTE_MS=${routeMs.toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
