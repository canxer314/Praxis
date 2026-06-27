/**
 * SessionStateStore — per-session 状态持久化 (Phase 0, P0-1 并发模型)。
 *
 * 持久化 EventOrchestrator 的 SessionState 到 `praxis_session_state_<sessionId>` slot,
 * 使跨进程 (per-hook) session 状态可达 —— session_start (进程 A) 加载的结构 +
 * 会话累积的 midSessionSources, 在 session_end (进程 B) 仍可用。
 *
 * 并发模型 (P0-1): 每 session 独立 slot → 无跨 session 竞态 (每 session 只写自己的 slot)。
 * 共享 slot 的 lost-update 由 AgentMemory 无 CAS 决定, 接受最终一致 (见 wiring-debt-dev-plan §0.4)。
 *
 * MidSessionLearner 序列化 (P0-2): 快照存 midSessionLearnerState (plain), load 时 fromState 重建。
 *
 * 架构参考: §10 (session_start/session_end 状态流), wiring-debt-dev-plan Phase 0 改法 2/4/5。
 */

import type { M0Deps } from "./m0-deps";
import type {
  PendingSignal,
  ToolCallRecord,
  ProtoStructure,
  SignalSourceInput,
} from "./cognitive/types";
import type { MidSessionLearnerState } from "./analysis/mid-session-learner";

const SLOT_PREFIX = "praxis_session_state_";
const SCHEMA_VERSION = 1;

/** 可序列化的 session 状态快照 (MidSessionLearner 实例 → plain state)。 */
export interface SessionStateSnapshot {
  schemaVersion: number;
  pendingSignals: PendingSignal[];
  toolCallTrace: ToolCallRecord[];
  structures: ProtoStructure[];
  injectedStructureIds: string[];
  midSessionSources: SignalSourceInput[];
  currentTaskType: string;
  currentDomain: string;
  midSessionLearnerState: MidSessionLearnerState;
  corrections: Array<{ sequenceId: string; correctionText: string; timestamp: number }>;
}

export class SessionStateStore {
  constructor(private readonly deps: M0Deps) {}

  private slotKey(sessionId: string): string {
    return `${SLOT_PREFIX}${sessionId}`;
  }

  /** 加载 session 状态快照; 不存在或 schema 不匹配返回 null。 */
  async load(sessionId: string): Promise<SessionStateSnapshot | null> {
    try {
      const result = await this.deps.memory.getSlot(this.slotKey(sessionId));
      if (!result.ok || !result.value) return null;
      const snap = result.value as SessionStateSnapshot;
      if (!snap || snap.schemaVersion !== SCHEMA_VERSION) {
        // schema 不匹配 (旧版 slot) → 丢弃, 不破坏
        return null;
      }
      return snap;
    } catch {
      return null; // 加载失败降级: 视为无持久化状态
    }
  }

  /** 保存 session 状态快照。失败不阻塞 (降级到单进程内存)。 */
  async save(sessionId: string, snapshot: SessionStateSnapshot): Promise<void> {
    try {
      await this.deps.memory.setSlot(
        this.slotKey(sessionId),
        snapshot as unknown as Record<string, unknown>,
      );
    } catch {
      // 持久化失败不阻塞 (降级到单进程内存)
    }
  }

  /** session_end 时清理 slot。 */
  async delete(sessionId: string): Promise<void> {
    try {
      await this.deps.memory.setSlot(this.slotKey(sessionId), null);
    } catch {
      // ignore
    }
  }
}
