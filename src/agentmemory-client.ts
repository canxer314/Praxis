/**
 * AgentMemory MCP 客户端
 *
 * 通过 spawn npx @agentmemory/mcp → stdio JSON-RPC 调用 AgentMemory。
 * 需要 AGENTMEMORY_URL 环境变量指向 AgentMemory REST API（默认 http://localhost:3111）。
 */

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Result } from "./platform-adapter";

// ---- 读取 .env ----

function loadEnv(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    vars[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return vars;
}

const env = loadEnv();
const AM_URL = env.AGENTMEMORY_URL || process.env.AGENTMEMORY_URL || "http://localhost:3111";

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
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  proc = spawn(cmd, ["-y", "@agentmemory/mcp"], {
    env: { ...process.env, AGENTMEMORY_URL: AM_URL },
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
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
        if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      } catch { /* skip */ }
    }
  });
  proc.on("exit", () => { proc = null; });
  return proc;
}

function callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const p = getClient();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } }) + "\n");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("MCP timeout")); } }, 15000);
  });
}

function extractText(result: unknown): string {
  try {
    const r = result as { content?: Array<{ text?: string; type?: string }> };
    const texts = (r.content || []).filter((c) => c.type === "text").map((c) => c.text || "");
    return texts.join("\n");
  } catch { return ""; }
}

// ---- 公开 API ----

export const agentmemory = {
  async getSlot(name: string): Promise<Result<unknown>> {
    try {
      const raw = await callTool("memory_slot_get", { name });
      const text = extractText(raw);
      if (!text || text.startsWith("Error:")) {
        return { ok: false, error: { code: "NOT_FOUND", message: text || "slot not found" } };
      }
      try { return { ok: true, value: JSON.parse(text) }; }
      catch { return { ok: true, value: text }; }
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  async setSlot(name: string, data: unknown): Promise<Result<void>> {
    try {
      await callTool("memory_slot_set", { name, data: typeof data === "string" ? data : JSON.stringify(data) });
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: { code: "AGENTMEMORY_ERROR", message: String(err) } };
    }
  },

  async smartSearch(query: string, limit = 5): Promise<Array<{ content: string; confidence: number }>> {
    try {
      const raw = await callTool("memory_smart_search", { query, limit });
      const text = extractText(raw);
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed.map((i: { content?: string; score?: number; confidence?: number }) => ({
          content: i.content || "", confidence: i.score || i.confidence || 0.7,
        }));
      } catch { /* fall through */ }
      return text ? [{ content: text, confidence: 0.7 }] : [];
    } catch { return []; }
  },

  async isAvailable(): Promise<boolean> {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 2000); // 2s 超时
      const r = await fetch(`${AM_URL}/api/health`, { signal: c.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  },
};
