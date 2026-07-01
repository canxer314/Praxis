/**
 * Praxis Hook Entry — Phase 5: bun per-hook 统一入口
 *
 * 替代 phase1a-bridge.ts 的生命周期命令 (inject/end/expand/message)。
 * 用 bun 运行, Phase 0.5 实测 p50=59ms (含 Praxis import + EventOrchestrator 路由)。
 *
 * 用法:
 *   bun scripts/praxis-hook.ts session_start <sessionId>
 *   bun scripts/praxis-hook.ts message_received <sessionId> --role user --content "..."
 *   bun scripts/praxis-hook.ts before_tool_call <sessionId> --tool <name> --params '<json>'
 *   bun scripts/praxis-hook.ts after_tool_call <sessionId> --tool <name> --params '<json>' --success <bool> [--output '<json>']
 *   bun scripts/praxis-hook.ts agent_end <sessionId>
 *   bun scripts/praxis-hook.ts session_end <sessionId> [--transcript '<text>']
 */

import { buildM0Deps } from "../src/m0-builder";
import { EventOrchestrator, type PraxisLifecycleEvent } from "../src/orchestration/orchestrator";
import type { Result } from "../src/platform-adapter";
import { handlePraxisCommand, type PraxisCommand } from "../src/commands/praxis-cli";

// ══════════════════════════════════════════════════════════════════
// HookContext — 从 CLI args 解析的 hook 上下文
// ══════════════════════════════════════════════════════════════════

export interface HookContext {
  hookType: "session_start" | "message_received" | "before_tool_call"
    | "after_tool_call" | "agent_end" | "session_end" | "praxis";
  sessionId: string;
  subcommand?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  result?: {
    success: boolean;
    output?: unknown;
    error?: string;
  };
  message?: {
    role: "user" | "assistant";
    content: string;
  };
  transcript?: string;
  transcriptFile?: string;
}

const VALID_HOOK_TYPES = new Set([
  "session_start", "message_received", "before_tool_call",
  "after_tool_call", "agent_end", "session_end", "praxis",
]);

/**
 * 从 CLI argv 解析 hook 上下文。
 * 返回 null 表示参数无效。
 */
export function parseHookArgs(argv: string[]): HookContext | null {
  // argv[0]=bun, argv[1]=script path, argv[2]=hookType, argv[3]=sessionId|subcommand
  if (argv.length < 4) return null;

  const hookType = argv[2];
  const arg3 = argv[3];

  if (!VALID_HOOK_TYPES.has(hookType)) return null;

  // /praxis 命令: argv[3] 是子命令, 不需要 sessionId
  if (hookType === "praxis") {
    return {
      hookType: "praxis",
      sessionId: "",
      subcommand: arg3,
    };
  }

  if (!arg3 || arg3.startsWith("-")) return null;

  const ctx: HookContext = {
    hookType: hookType as HookContext["hookType"],
    sessionId: arg3,
  };

  // 解析可选参数
  for (let i = 4; i < argv.length; i++) {
    switch (argv[i]) {
      case "--tool":
        ctx.toolName = argv[++i] ?? "";
        break;
      case "--params":
        try { ctx.toolParams = JSON.parse(argv[++i] ?? "{}"); }
        catch { ctx.toolParams = {}; }
        break;
      case "--success":
        ctx.result = { ...(ctx.result ?? { success: false }), success: argv[++i] === "true" };
        break;
      case "--output":
        try { ctx.result = { ...(ctx.result ?? { success: false }), output: JSON.parse(argv[++i] ?? "null") }; }
        catch { ctx.result = { ...(ctx.result ?? { success: false }), output: argv[++i] }; }
        break;
      case "--error":
        ctx.result = { ...(ctx.result ?? { success: false }), error: argv[++i] ?? "" };
        break;
      case "--role":
        ctx.message = { ...(ctx.message ?? { role: "user", content: "" }), role: (argv[++i] as "user" | "assistant") ?? "user" };
        break;
      case "--content":
        ctx.message = { ...(ctx.message ?? { role: "user", content: "" }), content: argv[++i] ?? "" };
        break;
      case "--transcript":
        ctx.transcript = argv[++i] ?? "";
        break;
      case "--transcript-file":
        ctx.transcriptFile = argv[++i] ?? "";
        break;
    }
  }

  return ctx;
}

// ══════════════════════════════════════════════════════════════════
// runHook — 将 HookContext 映射为 Praxis 事件并路由
// ══════════════════════════════════════════════════════════════════

export async function runHook(
  ctx: HookContext,
  deps: ReturnType<typeof buildM0Deps>,
): Promise<Result<unknown>> {
  const orch = new EventOrchestrator(deps);
  const ts = Date.now();

  switch (ctx.hookType) {
    case "session_start":
      return orch.handleSessionStart(ctx.sessionId);

    case "message_received": {
      if (!ctx.message) {
        return { ok: false, error: { code: "INVALID_ARGS", message: "message_received requires --role and --content" } };
      }
      const msgResult = await orch.handleMessageReceived(ctx.sessionId, ctx.message);
      // handleMessageReceived 返回 string (praxis command) 或 void
      return { ok: true, value: msgResult ?? null };
    }

    case "before_tool_call":
      return orch.handleBeforeToolCall(
        ctx.sessionId,
        ctx.toolName ?? "unknown",
        ctx.toolParams ?? {},
      );

    case "after_tool_call": {
      await orch.handleAfterToolCall(
        ctx.sessionId,
        ctx.toolName ?? "unknown",
        ctx.toolParams ?? {},
        ctx.result ?? { success: false },
      );
      return { ok: true, value: null };
    }

    case "agent_end": {
      const summary = await orch.handleAgentEnd(ctx.sessionId);
      return { ok: true, value: summary };
    }

    case "session_end":
      return orch.handleSessionEnd(ctx.sessionId, ctx.transcript);

    case "praxis": {
      const sub = (ctx.subcommand ?? "status") as PraxisCommand;
      try {
        const output = await handlePraxisCommand(sub, deps);
        return { ok: true, value: output };
      } catch (e) {
        return { ok: false, error: { code: "PRAXIS_CMD_ERROR", message: String(e) } };
      }
    }

    default:
      return { ok: false, error: { code: "UNKNOWN_HOOK", message: `Unknown hook type: ${ctx.hookType}` } };
  }
}

// ══════════════════════════════════════════════════════════════════
// stdin 读取 — message_received 从 hook stdin 读取消息内容
// ══════════════════════════════════════════════════════════════════

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function extractMessageFromStdin(raw: string): { role: "user" | "assistant"; content: string } | null {
  if (!raw) return null;
  try {
    // Claude Code hook: stdin is JSON with prompt/text/message fields
    const data = JSON.parse(raw);
    const content = data.prompt || data.text || data.message || "";
    if (!content) return null;
    return { role: "user", content };
  } catch {
    // Plain text fallback
    return { role: "user", content: raw };
  }
}

/**
 * Phase 7: 从 Claude Code hook stdin JSON 提取上下文。
 * Claude Code 通过 stdin 传入 JSON: {session_id, transcript_path, hook_event_name, ...}
 * PreToolUse/PostToolUse 额外包含: {tool_name, tool_input, tool_output}
 */
interface ClaudeCodeHookStdin {
  session_id?: string;
  transcript_path?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  success?: boolean;
  error?: string;
}

async function readClaudeCodeStdin(): Promise<ClaudeCodeHookStdin | null> {
  try {
    const raw = await readStdin();
    if (!raw) return null;
    const data = JSON.parse(raw) as ClaudeCodeHookStdin;
    return data;
  } catch {
    return null;
  }
}

/**
 * 从 Claude Code hook 的 transcript_path 读取完整 transcript 内容。
 */
async function readTranscriptFromPath(transcriptPath: string): Promise<string> {
  const fs = await import("fs");
  try {
    return fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    return `(transcript unreadable: ${transcriptPath})`;
  }
}

// ══════════════════════════════════════════════════════════════════
// CLI 入口 (bun scripts/praxis-hook.ts ...)
// ══════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const ctx = parseHookArgs(process.argv);
  if (!ctx) {
    console.error("[Praxis] 用法: bun scripts/praxis-hook.ts <hook_type> <sessionId> [options]");
    console.error("  hook_type: session_start | message_received | before_tool_call | after_tool_call | agent_end | session_end");
    process.exit(1);
  }

  // Phase 7: message_received 从 stdin 读取消息内容
  if (ctx.hookType === "message_received" && !ctx.message) {
    const raw = await readStdin();
    ctx.message = extractMessageFromStdin(raw) ?? { role: "user", content: "(empty)" };
  }

  // Phase 7: before_tool_call / after_tool_call 从 Claude Code stdin JSON 读取工具信息
  if ((ctx.hookType === "before_tool_call" || ctx.hookType === "after_tool_call") && !ctx.toolName) {
    const stdinData = await readClaudeCodeStdin();
    if (stdinData) {
      ctx.toolName = stdinData.tool_name ?? ctx.toolName;
      ctx.toolParams = stdinData.tool_input ?? ctx.toolParams;
      if (ctx.hookType === "after_tool_call" && !ctx.result) {
        ctx.result = {
          success: stdinData.success ?? true,
          output: stdinData.tool_output ?? undefined,
          error: stdinData.error,
        };
      }
    }
  }

  // Phase 7: session_end 从 Claude Code stdin JSON 读取 transcript
  if (ctx.hookType === "session_end") {
    // 优先 --transcript-file > --transcript > stdin transcript_path
    if (!ctx.transcript && !ctx.transcriptFile) {
      const stdinData = await readClaudeCodeStdin();
      if (stdinData?.transcript_path) {
        ctx.transcript = await readTranscriptFromPath(stdinData.transcript_path);
      }
    } else if (!ctx.transcript && ctx.transcriptFile) {
      ctx.transcript = await readTranscriptFromPath(ctx.transcriptFile);
    }
  }

  try {
    const deps = buildM0Deps();
    const result = await runHook(ctx, deps);

    if (result.ok) {
      // /praxis 命令: 纯文本输出 (Claude Code 直接展示给用户)
      if (ctx.hookType === "praxis" && typeof result.value === "string") {
        console.log(result.value);
        process.exit(0);
      }
      // SessionStart: stdout is the context injection mechanism — Claude Code inlines it
      if (ctx.hookType === "session_start" && result.value) {
        const injection = result.value as Record<string, unknown>;
        if (injection.tieredContext) {
          const tc = injection.tieredContext as Record<string, unknown>;
          const meta = tc.meta as Record<string, unknown> | undefined;
          console.log(`## Praxis Context
### Capability
- Overall: ${(injection.competency as Record<string, number>)?.overallProficiency ?? 0.5} | Context pressure: ${meta?.pressure ?? "normal"}
[Praxis Phase5] 注入验证码: PRAXIS-5-OK-${ctx.sessionId.slice(0, 4)}`);
        }
      } else {
        // All other hooks: output JSON to match Claude Code's JSON expectation
        const val = result.value as Record<string, unknown> | undefined;
        console.log(JSON.stringify({ ok: true, hook: ctx.hookType, sessionId: ctx.sessionId, ...val }));
      }
      process.exit(0);
    } else {
      console.error(JSON.stringify({ ok: false, hook: ctx.hookType, error: result.error.message }));
      process.exit(1);
    }
  } catch (err) {
    console.error(`[Praxis] ${ctx.hookType} CRASHED: ${String(err)}`);
    process.exit(2);
  }
}

main();
