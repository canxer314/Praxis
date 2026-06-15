/**
 * AgentMemory MCP 客户端 — 轻量 stdio JSON-RPC
 *
 * 用于 bridge 脚本（hook 进程）调用 AgentMemory。
 * 进程内复用单例，避免每次调用都重新 spawn。
 */

import { spawn, ChildProcess } from "child_process";
import { Result } from "./platform-adapter";

// ---- MCP JSON-RPC ----

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

let proc: ChildProcess | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let buffer = "";

function getClient(): ChildProcess {
  if (proc && !proc.killed) return proc;

  const url = process.env.AGENTMEMORY_URL || "http://127.0.0.1:11434";
  const secret = process.env.AGENTMEMORY_SECRET || "";

  proc = spawn("npx", ["-y", "@agentmemory/mcp"], {
    env: { ...process.env, AGENTMEMORY_URL: url, AGENTMEMORY_SECRET: secret },
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      } catch { /* skip partial/unparseable */ }
    }
  });

  proc.on("exit", () => { proc = null; });
  return proc;
}

function callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const p = getClient();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }) + "\n";
    p.stdin!.write(req);

    // 15s 超时
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("MCP timeout"));
      }
    }, 15000);
  });
}

// ---- 公开 API ----

export const agentmemory = {
  async getSlot(name: string): Promise<Result<unknown>> {
    try {
      const result = await callTool("memory_slot_get", { name });
      return { ok: true, value: (result as { content: Array<{ text: string }> }).content?.[0]?.text };
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  async setSlot(name: string, data: unknown): Promise<Result<void>> {
    try {
      await callTool("memory_slot_set", { name, data: JSON.stringify(data) });
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  async smartSearch(query: string, limit = 5): Promise<string[]> {
    try {
      const result = await callTool("memory_smart_search", { query, limit });
      const raw = (result as { content: Array<{ text: string }> }).content?.[0]?.text || "[]";
      const items = JSON.parse(raw);
      return Array.isArray(items) ? items.map((i: { content?: string; text?: string }) => i.content || i.text || "") : [];
    } catch {
      return [];
    }
  },

  isAvailable(): boolean {
    return !!(process.env.AGENTMEMORY_URL || process.env.AGENTMEMORY_SECRET);
  }
};
