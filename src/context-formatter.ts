/**
 * ContextFormatter — Phase 1: extracted from phase1a-bridge.ts
 *
 * Formats a SessionContextInjection into human-readable System Prompt
 * injection text suitable for LLM context windows.
 *
 * Extracted here so both the HookDispatcher (new Phase 1 entry) and
 * legacy phase1a-bridge can share the same formatting logic.
 */

import type { SessionContextInjection } from "./cognitive/types";

/**
 * Format a SessionContextInjection as System Prompt injection text.
 * Order: Critical Constraints → Capability → Tier A/B/C → Knowledge → Mental State
 */
export function formatSessionContextInjection(
  ctx: SessionContextInjection,
  cronWarning = "",
): string {
  const sections: string[] = [];
  sections.push("## Praxis Context");

  // M3: Critical Constraints (highest priority, non-compressible)
  if (ctx.tieredContext?.criticalConstraints?.injectionText) {
    sections.push("");
    sections.push(ctx.tieredContext.criticalConstraints.injectionText);
  }

  // Capability summary (compact)
  const c = ctx.competency;
  sections.push("");
  sections.push("### Capability");
  sections.push(
    `- Overall: ${c.overallProficiency.toFixed(2)} | Strongest: ${c.strongestDomains.join(", ") || "—"} | Weakest: ${c.weakestDomains.join(", ") || "—"}`,
  );
  if (c.currentLearningFocus) {
    sections.push(`- Learning Focus: ${c.currentLearningFocus}`);
  }

  // M2: Tiered context (Tier A/B)
  const tc = ctx.tieredContext;
  if (tc && (tc.tierA.items.length > 0 || tc.tierB.items.length > 0)) {
    const pressureTag =
      tc.meta.pressure !== "normal"
        ? ` [压力: ${tc.meta.pressure}]`
        : "";
    sections.push("");
    sections.push(
      `### Active Context (${tc.meta.totalStructures} structures, maturity: ${tc.meta.maturity}${pressureTag})`,
    );

    if (tc.tierA.items.length > 0) {
      sections.push(
        `**Tier A** (${tc.tierA.items.length} items, ~${tc.tierA.totalTokens} tokens):`,
      );
      for (const item of tc.tierA.items) {
        sections.push(
          `- [${item.protoType}] ${item.tentativeName}: ${item.description.slice(0, 120)}`,
        );
      }
    }
    if (tc.tierB.items.length > 0) {
      sections.push(
        `**Tier B** (${tc.tierB.items.length} items, ~${tc.tierB.totalTokens} tokens):`,
      );
      for (const item of tc.tierB.items) {
        sections.push(`- [${item.protoType}] ${item.tentativeName}`);
      }
    }
  }

  // Related experience (max 5)
  if (ctx.knowledge.length > 0) {
    sections.push("");
    sections.push("### Related Experience");
    for (const k of ctx.knowledge.slice(0, 5)) {
      const title = k.title || k.content.slice(0, 60);
      sections.push(`- [${k.source}] ${title} (${k.confidence.toFixed(2)})`);
    }
  }

  // Mental state
  if (ctx.mentalState) {
    sections.push("");
    sections.push(`### Previous State\n${ctx.mentalState.slice(0, 200)}`);
  }

  // Cron warning
  if (cronWarning) {
    sections.push("");
    sections.push(cronWarning.trim());
  }

  sections.push(""); // trailing newline
  return sections.join("\n");
}
