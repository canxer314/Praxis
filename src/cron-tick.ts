/**
 * CronTickHandler — M0 (skeleton)
 *
 * M0 实现为空操作。后续里程碑:
 *   - M2: HeartbeatMonitor 停顿检测
 *   - M5: 跨 session 模式挖掘
 *   - M5: 自主学习触发
 */

import type { M0Deps } from "./m0-deps";

export class CronTickHandler {
  constructor(private readonly deps: M0Deps) {}

  /** M0 空实现 — 不执行任何操作 */
  async handle(): Promise<void> {
    this.deps.logger?.info("cron_tick (M0 skeleton — noop)");
  }
}
