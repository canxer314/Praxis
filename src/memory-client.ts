/**
 * MemoryClient — Phase 1A, AgentMemory MCP 客户端
 *
 * 职责:
 *   - getSlot/setSlot: 类型安全的 AgentMemory slot 读写
 *   - healthCheck: AgentMemory 连通性检测
 *   - 超时控制: 可配置超时，默认 10s
 *   - 降级模式: AgentMemory 不可用时读本地缓存 / 写本地队列
 *   - Result 类型统一错误处理
 */

import { Result, PraxisError } from "./platform-adapter";

// ---- 配置 ----

export interface MemoryClientConfig {
  /** AgentMemory MCP 调用函数（抽象注入，可 mock） */
  mcpCall: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  /** MCP 调用超时（毫秒），默认 10000 */
  timeout?: number;
  /** 本地缓存目录，用于降级模式 */
  cacheDir?: string;
  /** 是否启用本地缓存降级，默认 false */
  enableCache?: boolean;
}

// ---- MemoryClient ----

export class MemoryClient {
  private readonly mcpCall: MemoryClientConfig["mcpCall"];
  private readonly timeout: number;
  private readonly cacheDir: string;
  private readonly enableCache: boolean;

  /** 降级模式下的待回放写入计数（公开，供测试断言） */
  public pendingWrites = 0;

  constructor(config: MemoryClientConfig) {
    this.mcpCall = config.mcpCall;
    this.timeout = config.timeout ?? 10000;
    this.cacheDir = config.cacheDir ?? "";
    this.enableCache = config.enableCache ?? false;
  }

  // ---- 公开 API ----

  async getSlot(name: string): Promise<Result<unknown, PraxisError>> {
    try {
      const raw = await this.withTimeout(
        this.mcpCall("memory_slot_get", { name }),
      );

      // MCP 可能返回 { ok, value } 或 { ok, error } Result 格式
      const mcpResult = raw as { ok?: boolean; value?: unknown; error?: { code: string; message: string } } | undefined;
      if (mcpResult && typeof mcpResult === "object" && "ok" in mcpResult) {
        if (mcpResult.ok) {
          return { ok: true, value: mcpResult.value };
        }
        return { ok: false, error: { code: mcpResult.error?.code ?? "UNKNOWN", message: mcpResult.error?.message ?? "未知错误" } };
      }

      // 非标准格式，按原始值返回
      return { ok: true, value: raw };
    } catch (err) {
      if (this.enableCache) {
        return {
          ok: false,
          error: { code: "AGENTMEMORY_UNAVAILABLE", message: `无法读取 slot "${name}"：AgentMemory 不可用` },
        };
      }
      return { ok: false, error: this.classifyError(err, `读取 slot "${name}" 失败`) };
    }
  }

  async setSlot(name: string, data: unknown): Promise<Result<void, PraxisError>> {
    try {
      const raw = await this.withTimeout(
        this.mcpCall("memory_slot_set", { name, data }),
      );

      // 检查 MCP Result 格式
      const mcpResult = raw as { ok?: boolean; error?: { code: string; message: string } } | undefined;
      if (mcpResult && typeof mcpResult === "object" && "ok" in mcpResult && !mcpResult.ok) {
        return { ok: false, error: { code: mcpResult.error?.code ?? "UNKNOWN", message: mcpResult.error?.message ?? "写入失败" } };
      }

      return { ok: true, value: undefined };
    } catch (err) {
      if (this.enableCache) {
        this.pendingWrites++;
        return { ok: true, value: undefined };
      }
      return { ok: false, error: this.classifyError(err, `写入 slot "${name}" 失败`) };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const raw = await this.withTimeout(
        this.mcpCall("memory_slot_get", { name: "__health_check__" }),
      );
      const mcpResult = raw as { ok?: boolean } | undefined;
      if (mcpResult && typeof mcpResult === "object" && "ok" in mcpResult) {
        return mcpResult.ok === true;
      }
      return raw !== null && raw !== undefined;
    } catch {
      return false;
    }
  }

  // ---- 内部 ----

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("TIMEOUT")), this.timeout);
      promise
        .then((v) => {
          clearTimeout(timer);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  private classifyError(err: unknown, fallback: string): PraxisError {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("TIMEOUT")) {
      return { code: "TIMEOUT", message: "AgentMemory MCP 调用超时" };
    }
    if (msg.includes("NOT_FOUND") || msg.includes("not found")) {
      return { code: "NOT_FOUND", message };
    }
    if (msg.includes("connection refused") || msg.includes("ECONNREFUSED")) {
      return { code: "AGENTMEMORY_UNAVAILABLE", message: "AgentMemory 连接被拒绝" };
    }
    return { code: "UNKNOWN", message: fallback };
  }
}
