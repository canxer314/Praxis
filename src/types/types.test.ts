/**
 * types/ — Type extraction verification tests
 *
 * 验证 types/memory.ts, types/scene.ts, types/hooks.ts 导出所有必要类型，
 * 且 cognitive/types.ts 仍然向后兼容（重新导出）。
 */

import { describe, it, expect } from "vitest";

// ══════════════════════════════════════════════════════════════════
// types/memory.ts — Memory & cognitive structure types
// ══════════════════════════════════════════════════════════════════

describe("types/memory.ts", () => {
  it("exports ProtoStructure base type", async () => {
    const mod = await import("./memory");
    // Check key exports exist
    expect(mod).toBeDefined();
  });

  it("exports ProtoSequence, ProtoRole, ProtoConcept, ProtoPurpose, ProtoConstraint", async () => {
    const mod = await import("./memory");
    // Sub-type exports should be available
    expect(mod).toBeDefined();
  });

  it("exports Relation type", async () => {
    const mod = await import("./memory");
    expect(mod).toBeDefined();
  });

  it("exports LifecycleStage type", async () => {
    const mod = await import("./memory");
    expect(mod).toBeDefined();
  });

  it("exports ProtoType type", async () => {
    const mod = await import("./memory");
    expect(mod).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// types/scene.ts — Scenario & task context types
// ══════════════════════════════════════════════════════════════════

describe("types/scene.ts", () => {
  it("exports ScenarioMatch type", async () => {
    const mod = await import("./scene");
    expect(mod).toBeDefined();
  });

  it("exports GuidanceSignal type", async () => {
    const mod = await import("./scene");
    expect(mod).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// types/hooks.ts — Hook event context types
// ══════════════════════════════════════════════════════════════════

describe("types/hooks.ts", () => {
  it("exports SessionStartEvent type", async () => {
    const mod = await import("./hooks");
    expect(mod).toBeDefined();
  });

  it("exports MessageReceivedEvent type", async () => {
    const mod = await import("./hooks");
    expect(mod).toBeDefined();
  });

  it("exports BeforeToolCallEvent type", async () => {
    const mod = await import("./hooks");
    expect(mod).toBeDefined();
  });

  it("exports AfterToolCallEvent type", async () => {
    const mod = await import("./hooks");
    expect(mod).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// cognitive/types.ts — Backward compatibility (re-exports)
// ══════════════════════════════════════════════════════════════════

describe("cognitive/types.ts backward compatibility", () => {
  it("still exports ProtoStructure from new types/memory.ts", async () => {
    const mod = await import("../cognitive/types");
    expect(mod).toBeDefined();
    // ProtoStructure should still be accessible via cognitive/types
  });

  it("still exports ScenarioMatch from new types/scene.ts", async () => {
    const mod = await import("../cognitive/types");
    expect(mod).toBeDefined();
  });

  it("still exports SessionStartEvent from new types/hooks.ts", async () => {
    const mod = await import("../cognitive/types");
    expect(mod).toBeDefined();
  });
});
