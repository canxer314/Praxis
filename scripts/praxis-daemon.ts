#!/usr/bin/env bun
/**
 * Praxis Daemon — Phase 1 D2: per-tick scheduling via setInterval
 *
 * A lightweight daemon that wakes every 30 minutes to run CronTickHandler.
 * Crash-isolated: try-catch per tick + uncaughtException/unhandledRejection
 * handlers ensure one failed tick doesn't kill the daemon.
 *
 * Usage:
 *   bun scripts/praxis-daemon.ts
 *
 * Architecture: D2 = daemon (setInterval). Simpler than OS-cron-per-tick:
 * one process, one setInterval, cross-platform. No install script needed.
 * §6/§8 modules are persisted-state-only — the daemon holds no in-memory
 * state between ticks.
 */

const TICK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Crash isolation: don't let one tick failure kill the daemon
process.on("uncaughtException", (err) => {
  console.error(`[Praxis Daemon] uncaughtException: ${err.message}`);
  // Daemon continues running
});

process.on("unhandledRejection", (reason) => {
  console.error(
    `[Praxis Daemon] unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`,
  );
  // Daemon continues running
});

async function runTick(): Promise<void> {
  const { EventOrchestrator } = await import("../src/orchestrator");
  const { buildM0Deps } = await import("../src/m0-deps-factory");

  const deps = buildM0Deps();
  const orchestrator = new EventOrchestrator(deps);

  try {
    await orchestrator.handleCronTick();
    console.log(`[Praxis Daemon] tick completed at ${new Date().toISOString()}`);
  } catch (err) {
    console.error(
      `[Praxis Daemon] tick failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Daemon continues — next tick in 30 min
  }
}

async function main(): Promise<void> {
  console.log(`[Praxis Daemon] starting — tick interval: ${TICK_INTERVAL_MS / 60000}min`);
  console.log(`[Praxis Daemon] PID: ${process.pid}`);

  // Run first tick immediately
  await runTick();

  // Then schedule periodic ticks
  setInterval(() => {
    runTick().catch((err) => {
      console.error(`[Praxis Daemon] setInterval error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, TICK_INTERVAL_MS);

  console.log(`[Praxis Daemon] next tick in ${TICK_INTERVAL_MS / 60000}min`);
}

main().catch((err) => {
  console.error(`[Praxis Daemon] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
