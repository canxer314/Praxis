#!/usr/bin/env bun
/**
 * Praxis Cron Tick — Phase 1 OS-cron per-tick entry
 *
 * Invoked by OS scheduler (Windows Task Scheduler / cron) at regular intervals.
 * Each invocation is a fresh bun process that:
 *   1. Builds M0Deps (AgentMemory-backed)
 *   2. Creates EventOrchestrator
 *   3. Runs CronTickHandler.handle() once
 *   4. Exits
 *
 * Scheduled intervals:
 *   - Every 30 min: `bun scripts/praxis-cron.ts`
 *     (internal guards ensure 30-min minimum spacing; Meta Layer checks
 *      structural gap 168h + category audit 720h intervals independently)
 *
 * Architecture: D2 = OS-cron-per-tick (no Praxis daemon).
 * CronTickHandler is persisted-state-only — reads/writes AgentMemory slots,
 * no in-process state between invocations.
 *
 * Install (Windows):
 *   powershell -File scripts/install-scheduler.ps1
 *
 * Install (Linux/Mac):
 *   crontab -e
 *   */30 * * * * cd /path/to/praxis && bun scripts/praxis-cron.ts
 */

async function main(): Promise<void> {
  // Dynamic imports keep cold-start minimal
  const { EventOrchestrator } = await import("../src/orchestrator");
  const { buildM0Deps } = await import("../src/m0-deps-factory");

  const deps = buildM0Deps();
  const orchestrator = new EventOrchestrator(deps);

  try {
    await orchestrator.handleCronTick();
    console.log(`[Praxis] cron_tick completed at ${new Date().toISOString()}`);
  } catch (err) {
    console.error(
      `[Praxis] cron_tick failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[Praxis] Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
