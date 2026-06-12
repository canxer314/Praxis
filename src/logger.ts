/**
 * Logger — Phase 1A 结构化 JSON 日志
 *
 * 输出到 ~/.praxis/logs/praxis-YYYY-MM-DD.jsonl
 * 每行一条 JSON: { ts, module, op, duration_ms, outcome, error? }
 *
 * 零外部依赖，仅使用 fs。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LOG_DIR = path.join(os.homedir(), ".praxis", "logs");

function ensureDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return path.join(LOG_DIR, `praxis-${yyyy}-${mm}-${dd}.jsonl`);
}

interface LogEntry {
  ts: string;
  module: string;
  op: string;
  duration_ms: number;
  outcome: "success" | "error" | "degraded" | "skipped";
  error?: string;
  sessionId?: string;
}

export function log(entry: LogEntry): void {
  try {
    ensureDir();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(todayFile(), line, "utf-8");
  } catch {
    // 日志写入失败：静默跳过。不能让日志拖垮主流程。
  }
}

/** 包装异步操作，自动记录开始/结束/耗时/异常 */
export async function withLog<T>(
  module: string,
  op: string,
  fn: () => Promise<T>,
  sessionId?: string,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log({
      ts: new Date().toISOString(),
      module,
      op,
      duration_ms: Date.now() - start,
      outcome: "success",
      sessionId,
    });
    return result;
  } catch (err) {
    log({
      ts: new Date().toISOString(),
      module,
      op,
      duration_ms: Date.now() - start,
      outcome: "error",
      error: err instanceof Error ? err.message : String(err),
      sessionId,
    });
    throw err;
  }
}

/** 记录降级事件 */
export function logDegraded(module: string, op: string, reason: string, sessionId?: string): void {
  log({
    ts: new Date().toISOString(),
    module,
    op,
    duration_ms: 0,
    outcome: "degraded",
    error: reason,
    sessionId,
  });
}
