/**
 * Praxis CLI tests — Phase 1 TDD: bridge command migration
 *
 * Phase 1 folds phase1a-bridge.ts non-lifecycle commands into /praxis CLI.
 * This test verifies command parsing and handler routing for the new commands.
 */

import { describe, it, expect, vi } from "vitest";
import { parsePraxisCommand, handlePraxisCommand, type PraxisCommand } from "./praxis-cli";
import type { M0Deps } from "../m0-deps";
import type { Result } from "../platform-adapter";

function makeDeps(): M0Deps {
  const slots = new Map<string, unknown>();
  return {
    memory: {
      isAvailable: async () => true,
      getSlot: vi.fn(async (name: string) => ({
        ok: true as const,
        value: slots.get(name) ?? null,
      })),
      setSlot: vi.fn(async (name: string, value: unknown) => {
        slots.set(name, value);
        return { ok: true as const };
      }),
      smartSearch: vi.fn(async () => ({ ok: true as const, value: [] })),
      saveLesson: vi.fn(async () => ({ ok: true } as Result<void>)),
    },
    cache: {
      get: () => null,
      set: () => {},
      list: () => [],
      delete: () => {},
    },
    attentionRecords: new Map(),
  };
}

describe("parsePraxisCommand (Phase 1 extended)", () => {
  it("parses /praxis shadow-stats", () => {
    expect(parsePraxisCommand("/praxis shadow-stats")).toBe("shadow-stats");
  });

  it("parses /praxis show", () => {
    expect(parsePraxisCommand("/praxis show")).toBe("show");
  });

  it("parses /praxis scene-stats", () => {
    expect(parsePraxisCommand("/praxis scene-stats")).toBe("scene-stats");
  });

  it("parses /praxis learn with content", () => {
    // /praxis learn should still parse even with trailing content
    expect(parsePraxisCommand("/praxis learn 这是一条手动学习")).toBe("learn");
  });

  it("parses /praxis scene-log", () => {
    expect(parsePraxisCommand("/praxis scene-log")).toBe("scene-log");
  });

  it("still parses existing commands", () => {
    expect(parsePraxisCommand("/praxis ontology")).toBe("ontology");
    expect(parsePraxisCommand("/praxis audit")).toBe("audit");
    expect(parsePraxisCommand("/praxis status")).toBe("status");
  });

  it("returns null for unknown commands", () => {
    expect(parsePraxisCommand("/praxis unknown-cmd")).toBeNull();
  });

  it("returns null for non-/praxis messages", () => {
    expect(parsePraxisCommand("hello world")).toBeNull();
  });
});

describe("handlePraxisCommand (Phase 1 extended)", () => {
  const deps = makeDeps();

  it("handles /praxis show — returns learning overview", async () => {
    const result = await handlePraxisCommand("show", deps);
    expect(result).toContain("Praxis");
    // Should show learning overview
  });

  it("handles /praxis shadow-stats — returns shadow decision stats", async () => {
    const result = await handlePraxisCommand("shadow-stats", deps);
    expect(result).toContain("影子");
  });

  it("handles /praxis scene-stats — returns scene classification stats", async () => {
    const result = await handlePraxisCommand("scene-stats", deps);
    expect(result).toContain("场景");
  });

  it("handles /praxis learn — saves manual learning", async () => {
    // Note: /praxis learn extracts content from the original message,
    // not from the command arg. The handler receives just the command.
    const result = await handlePraxisCommand("learn", deps);
    // Should return confirmation or instruction
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles /praxis scene-log — returns usage instructions", async () => {
    const result = await handlePraxisCommand("scene-log", deps);
    expect(result.length).toBeGreaterThan(0);
  });
});
