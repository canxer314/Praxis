#!/usr/bin/env bun
/**
 * Praxis Hook Entry — Phase 1 per-hook bun runtime
 *
 * Replaces phase1a-bridge.ts lifecycle commands. Each invocation is a fresh
 * bun process (~59ms cold start) that loads session state from AgentMemory,
 * dispatches the hook event through EventOrchestrator, persists state, and exits.
 *
 * Usage:
 *   bun scripts/praxis-hook.ts <hook-type> [--json]
 *
 * Hook types:
 *   session_start     — context injection (outputs formatted text to stdout)
 *   message_received  — process user message (silent on success)
 *   before_tool_call  — constraint check (outputs JSON decision)
 *   after_tool_call   — record tool call (silent)
 *   agent_end         — agent end summary (outputs JSON)
 *   session_end       — fusion + persistence (outputs JSON summary)
 *   cron_tick         — periodic maintenance (silent)
 *
 * Hook data is read from stdin as JSON (Claude Code hook format).
 *
 * Architecture: D1 = A+D (per-hook bun, no daemon).
 * Phase 0: cross-process state via SessionStateStore (praxis_session_state_<id> slot).
 */

import * as path from "path";

// ESM-compatible __dirname polyfill (bun supports import.meta.dirname in newer versions)
const scriptDir = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);

// Dynamic import of the built TypeScript (when running via bun)
// bun natively supports .ts files, so we can import directly
async function main(): Promise<void> {
  const hookType = process.argv[2];

  if (!hookType) {
    console.error("Usage: bun scripts/praxis-hook.ts <hook-type>");
    console.error("Hook types: session_start, message_received, before_tool_call, after_tool_call, agent_end, session_end, cron_tick");
    process.exit(1);
  }

  // Read raw hook data from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();

  let rawData: Record<string, unknown> = {};
  if (raw) {
    try {
      rawData = JSON.parse(raw);
    } catch {
      // Non-JSON stdin → treat as empty
    }
  }

  // Lazy-load Praxis modules (keeps cold-start minimal for hooks that don't need Praxis)
  const { HookDispatcher } = await import("../src/adapters/hook-dispatcher");
  const { buildM0Deps } = await import("../src/m0-deps-factory");

  const deps = buildM0Deps();
  const dispatcher = new HookDispatcher(deps);
  const result = await dispatcher.dispatch(hookType, rawData);

  if (result.output) {
    console.log(result.output);
  }
  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error(`[Praxis] Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
