/**
 * Bridge 数据迁移 — Phase 5: ~/.praxis-phase1a/ → AgentMemory slot
 *
 * 迁移脚本: 一次性读取 bridge JSON 文件 → 转换为 SessionStateSnapshot →
 * 写入 praxis_session_state_<sessionId> slot。
 * 保留 bridge JSON 文件 30 天作为备份。
 *
 * 用法:
 *   import { migrateBridgeData } from "./bridge-migration";
 *   const result = await migrateBridgeData(deps.memory);
 *   // result.migratedSessions / result.skippedSessions / result.errors
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { MemorySubsystem } from "./m0-deps";
import type { SessionStateSnapshot } from "./session-state-store";

// ══════════════════════════════════════════════════════════════════
// 类型
// ══════════════════════════════════════════════════════════════════

export interface MigrationResult {
  /** 成功迁移的 session 数 */
  migratedSessions: number;
  /** 跳过的 session 数 (空/无效数据) */
  skippedSessions: number;
  /** 错误列表 */
  errors: string[];
}

interface BridgeSessionData {
  session: number;
  timestamp: string;
  learnings?: Array<Record<string, unknown>>;
  shadowDecisions?: Array<Record<string, unknown>>;
}

// ══════════════════════════════════════════════════════════════════
// 配置
// ══════════════════════════════════════════════════════════════════

const DEFAULT_BRIDGE_DIR = path.join(os.homedir(), ".praxis-phase1a");
const SESSION_LOG_FILE = "session-log.jsonl";
const LEARNINGS_FILE = "learnings.jsonl";
const SHADOW_DECISIONS_FILE = "shadow-decisions.jsonl";

// ══════════════════════════════════════════════════════════════════
// 读取 bridge JSON 文件
// ══════════════════════════════════════════════════════════════════

function readJsonlFile(filePath: string): Record<string, unknown>[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// 转换为 SessionStateSnapshot
// ══════════════════════════════════════════════════════════════════

function bridgeEntryToSnapshot(
  sessionId: string,
  learnings: Record<string, unknown>[],
): SessionStateSnapshot {
  return {
    schemaVersion: 1,
    pendingSignals: learnings
      .filter((l) => l.type === "correction" || l.type === "failure")
      .map((l) => ({
        id: `migrated-${l.id ?? Date.now()}`,
        type: (l.type as "correction" | "failure") ?? "correction",
        sessionId,
        timestamp: typeof l.timestamp === "number" ? l.timestamp : Date.now(),
        detail: String(l.content ?? ""),
      })),
    toolCallTrace: [],
    structures: [],
    injectedStructureIds: [],
    midSessionSources: [],
    currentTaskType: "unknown",
    currentDomain: "unknown",
    midSessionLearnerState: {
      totalPenalty: 0,
      correctionCount: 0,
      violationCounters: {},
      affectedStructures: [],
      records: [],
    },
    corrections: [],
  };
}

// ══════════════════════════════════════════════════════════════════
// migrateBridgeData
// ══════════════════════════════════════════════════════════════════

export async function migrateBridgeData(
  memory: MemorySubsystem,
  opts: { bridgeDir?: string; dryRun?: boolean } = {},
): Promise<MigrationResult> {
  const bridgeDir = opts.bridgeDir ?? DEFAULT_BRIDGE_DIR;
  const result: MigrationResult = {
    migratedSessions: 0,
    skippedSessions: 0,
    errors: [],
  };

  // 检查 bridge 目录是否存在
  if (!fs.existsSync(bridgeDir)) {
    return result; // 无可迁移数据, 不报错
  }

  // 读取 session 日志
  const sessionLog = readJsonlFile(path.join(bridgeDir, SESSION_LOG_FILE));
  const learnings = readJsonlFile(path.join(bridgeDir, LEARNINGS_FILE));

  if (sessionLog.length === 0 && learnings.length === 0) {
    return result; // 空目录, 无可迁移
  }

  // 按 session 分组 learnings
  const sessions = new Map<string, Record<string, unknown>[]>();
  for (const entry of sessionLog) {
    const sessionId = `migrated-session-${entry.session ?? "unknown"}`;
    if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  }
  // 也从未分组的 learnings 中创建 session
  if (learnings.length > 0 && sessions.size === 0) {
    sessions.set("migrated-session-legacy", learnings);
  } else {
    // 将 learnings 分配给最近的 session
    for (const [sid] of sessions) {
      sessions.set(sid, learnings);
      break; // 所有 learnings 分配给第一个 session
    }
  }

  // 写入每个 session 的 snapshot
  for (const [sessionId, sessionLearnings] of sessions) {
    try {
      const snapshot = bridgeEntryToSnapshot(sessionId, sessionLearnings);

      if (snapshot.pendingSignals.length === 0 && sessionLearnings.length === 0) {
        result.skippedSessions++;
        continue;
      }

      if (!opts.dryRun) {
        const setResult = await memory.setSlot(
          `praxis_session_state_${sessionId}`,
          snapshot,
        );
        if (!setResult.ok) {
          result.errors.push(`Failed to write slot for ${sessionId}: ${setResult.error.message}`);
          continue;
        }
      }

      result.migratedSessions++;
    } catch (err) {
      result.errors.push(`Migration error for ${sessionId}: ${String(err)}`);
    }
  }

  return result;
}

/**
 * 标记 bridge 目录为已迁移 (写入 .migrated 标记文件, 30 天后自动清理)。
 */
export function markBridgeMigrated(bridgeDir?: string): void {
  const dir = bridgeDir ?? DEFAULT_BRIDGE_DIR;
  if (!fs.existsSync(dir)) return;

  const markerFile = path.join(dir, ".migrated");
  fs.writeFileSync(markerFile, JSON.stringify({
    migratedAt: new Date().toISOString(),
    retainUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }), "utf-8");
}
