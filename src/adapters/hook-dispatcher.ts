/**
 * HookDispatcher — Phase 1 per-hook entry point
 *
 * Replaces phase1a-bridge.ts lifecycle commands with a single adapter-agnostic
 * dispatch function. Takes a hook type + raw hook data, maps through
 * ClaudeCodeAdapter → PraxisLifecycleEvent, routes through EventOrchestrator.
 *
 * Architecture: §11 EventOrchestrator module tree, §10 lifecycle events.
 * Runtime: D1 = A+D (per-hook bun, no daemon). Each invocation is a fresh
 * process that loads state from SessionStateStore, processes, and exits.
 */

import { EventOrchestrator } from "../orchestrator";
import type { M0Deps } from "../m0-deps";
import { claudeCodeAdapter } from "./claude-code-adapter";
import { formatSessionContextInjection } from "../context-formatter";
import type { SessionContextInjection } from "../cognitive/types";

export interface DispatchResult {
  exitCode: number;
  output: string;
}

export class HookDispatcher {
  private readonly orchestrator: EventOrchestrator;

  constructor(private readonly deps: M0Deps) {
    this.orchestrator = new EventOrchestrator(deps);
  }

  /**
   * Dispatch a hook event through the adapter → orchestrator pipeline.
   *
   * @param hookType - One of: session_start, message_received, before_tool_call,
   *   after_tool_call, agent_end, session_end, cron_tick
   * @param rawData - Raw hook data from the runtime (stdin JSON or env vars)
   */
  async dispatch(
    hookType: string,
    rawData: Record<string, unknown>,
  ): Promise<DispatchResult> {
    try {
      switch (hookType) {
        case "session_start": {
          const event = claudeCodeAdapter.mapToSessionStart(rawData);
          const result = await this.orchestrator.route(event);
          if (
            result &&
            typeof result === "object" &&
            "ok" in result &&
            (result as { ok: boolean }).ok &&
            "value" in result
          ) {
            const ctx = (result as { ok: true; value: SessionContextInjection }).value;
            return {
              exitCode: 0,
              output: formatSessionContextInjection(ctx),
            };
          }
          return { exitCode: 0, output: "" };
        }

        case "message_received": {
          const event = claudeCodeAdapter.mapToMessageReceived(rawData);
          if (!event) return { exitCode: 0, output: "" };
          await this.orchestrator.route(event);
          return { exitCode: 0, output: "" };
        }

        case "before_tool_call": {
          const event = claudeCodeAdapter.mapToBeforeToolCall(rawData);
          const result = await this.orchestrator.route(event);
          if (result && typeof result === "object" && "ok" in result) {
            const r = result as { ok: boolean; value?: { allowed?: boolean; constraintId?: string; message?: string } };
            if (r.ok) {
              return {
                exitCode: 0,
                output: JSON.stringify({
                  allowed: r.value?.allowed ?? true,
                  constraintId: r.value?.constraintId ?? null,
                  message: r.value?.message ?? null,
                }),
              };
            }
          }
          return { exitCode: 0, output: JSON.stringify({ allowed: true }) };
        }

        case "after_tool_call": {
          const event = claudeCodeAdapter.mapToAfterToolCall(rawData);
          await this.orchestrator.route(event);
          return { exitCode: 0, output: "" };
        }

        case "agent_end": {
          const event = claudeCodeAdapter.mapToAgentEnd(rawData);
          const result = await this.orchestrator.route(event);
          return {
            exitCode: 0,
            output: JSON.stringify(result ?? {}),
          };
        }

        case "session_end": {
          const event = claudeCodeAdapter.mapToSessionEnd(rawData);
          const result = await this.orchestrator.route(event);
          return {
            exitCode: 0,
            output: JSON.stringify(
              result && typeof result === "object" && "ok" in result
                ? (result as { ok: boolean; value?: unknown }).value ?? {}
                : {},
            ),
          };
        }

        case "cron_tick": {
          await this.orchestrator.route({ type: "cron_tick", timestamp: Date.now() });
          return { exitCode: 0, output: "" };
        }

        default:
          return { exitCode: 1, output: `Unknown hook type: ${hookType}` };
      }
    } catch (err) {
      return {
        exitCode: 1,
        output: `Error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
