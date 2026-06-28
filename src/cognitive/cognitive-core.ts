/**
 * CognitiveCore — 已弃用的兼容层
 *
 * @deprecated 自 M0 (v0.8.0.0) 起, 使用 EventOrchestrator (src/orchestration/orchestrator.ts) 替代。
 *   Phase 8 删除 16 个 dead 子模块后, 本文件精简为最小桥接存根,
 *   仅支持 phase1a-bridge.ts 的 createSession() 接口。
 *   30 天过渡期 (至 2026-07-28), 之后随 bridge 一同删除。
 */

import type { Result } from "../platform-adapter";
import type { LlmClient } from "../platform-adapter";
import type { MetacognitiveProfile } from "./types";

// ══════════════════════════════════════════════════════════════════
// 存根类型 (原子模块已删除, 保留接口兼容)
// ══════════════════════════════════════════════════════════════════

export interface CognitiveCoreMemoryClient {
  getSlot(name: string): Promise<Result<unknown>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
  smartSearch(query: string, opts?: { limit?: number }): Promise<Result<unknown[]>>;
  lessonSave(data: Record<string, unknown>): Promise<Result<unknown>>;
  lessonRecall(query: Record<string, unknown>): Promise<Result<unknown[]>>;
}

export interface CognitiveCoreDeps {
  memoryClient: CognitiveCoreMemoryClient;
  walFilePath?: string;
  llmClient?: LlmClient;
}

// ══════════════════════════════════════════════════════════════════
// CognitiveCore — 最小存根
// ══════════════════════════════════════════════════════════════════

export class CognitiveCore {
  private readonly memoryClient: CognitiveCoreMemoryClient;
  private readonly walFilePath?: string;

  constructor(deps: CognitiveCoreDeps) {
    this.memoryClient = deps.memoryClient ?? {
      getSlot: async () => ({ ok: false, error: { code: "NO_CLIENT", message: "no memory client" } }),
      setSlot: async () => ({ ok: true, value: undefined }),
      smartSearch: async () => ({ ok: true, value: [] }),
      lessonSave: async () => ({ ok: true, value: undefined }),
      lessonRecall: async () => ({ ok: true, value: [] }),
    };
    this.walFilePath = deps.walFilePath;
  }

  /** WAL 重放 — 存根 (原逻辑随 learning-update 删除) */
  async replayPendingWrites(): Promise<Result<number>> {
    return { ok: true, value: 0 };
  }

  /** 创建 session 实例 */
  createSession(sessionId: string): SessionCognitiveCore {
    return new SessionCognitiveCore(sessionId, this.memoryClient);
  }
}

// ══════════════════════════════════════════════════════════════════
// SessionCognitiveCore — 最小存根
// ══════════════════════════════════════════════════════════════════

export class SessionCognitiveCore {
  constructor(
    private readonly sessionId: string,
    private readonly memoryClient: CognitiveCoreMemoryClient,
  ) {}

  async assessTask(_taskType: string, _domain: string): Promise<{ confidence: number }> {
    return { confidence: 0.5 };
  }

  captureCorrection(
    _correction: Record<string, unknown>,
    _context: Record<string, unknown>,
  ): void {
    // Phase 8: 原学习环路已删除 — 信号由 EventOrchestrator 处理
  }

  async finalizeLearning(
    _context: Record<string, unknown>,
    _domain: string,
  ): Promise<{ learningEvents: unknown[] }> {
    return { learningEvents: [] };
  }
}
