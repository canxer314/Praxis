/**
 * Praxis Cron Entry — Phase 5: OS-cron per-tick 入口
 *
 * OS 调度器 (Windows Task Scheduler / cron) 触发, 每次新进程跑 handle() 一次后退出。
 * 无 Praxis daemon — 仅消费持久化 slot。
 *
 * 用法:
 *   bun scripts/praxis-cron.ts cron-tick    — 30min 间隔: ProtoTask 累积 + 衰退检测 + Meta Layer
 *   bun scripts/praxis-cron.ts heartbeat     — 5min 间隔: 停顿检测
 *   bun scripts/praxis-cron.ts meta-audit    — daily: Meta Layer 审计
 */

import { buildM0Deps } from "../src/m0-builder";
import { CronTickHandler } from "../src/cron-tick";

type CronCommand = "cron-tick" | "heartbeat" | "meta-audit";

function parseCronArgs(argv: string[]): CronCommand | null {
  if (argv.length < 3) return null;
  const cmd = argv[2];
  if (cmd === "cron-tick" || cmd === "heartbeat" || cmd === "meta-audit") {
    return cmd;
  }
  return null;
}

async function runCronTick(): Promise<void> {
  const deps = buildM0Deps();
  const handler = new CronTickHandler(deps);
  await handler.handle();
  console.log("[Praxis Phase5] cron-tick OK");
}

async function runHeartbeat(): Promise<void> {
  const deps = buildM0Deps();
  // HeartbeatMonitor.check 需要从 AgentMemory slot 加载状态
  // Phase 5 使用 CronTickHandler 中集成的 heartbeat 逻辑
  const handler = new CronTickHandler(deps);
  await handler.handle();
  console.log("[Praxis Phase5] heartbeat OK");
}

async function runMetaAudit(): Promise<void> {
  const deps = buildM0Deps();
  const handler = new CronTickHandler(deps);
  await handler.handle();
  console.log("[Praxis Phase5] meta-audit OK");
}

async function main(): Promise<void> {
  const cmd = parseCronArgs(process.argv);
  if (!cmd) {
    console.error("[Praxis] 用法: bun scripts/praxis-cron.ts <cron-tick|heartbeat|meta-audit>");
    process.exit(1);
  }

  try {
    switch (cmd) {
      case "cron-tick":
        await runCronTick();
        break;
      case "heartbeat":
        await runHeartbeat();
        break;
      case "meta-audit":
        await runMetaAudit();
        break;
    }
    process.exit(0);
  } catch (err) {
    console.error(`[Praxis] ${cmd} FAILED: ${String(err)}`);
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("praxis-cron.ts")) {
  main();
}
