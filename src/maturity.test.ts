/**
 * maturity 测试 — Phase 3 T10: deriveMaturity + session count tracking
 *
 * 覆盖:
 *   - deriveMaturity: 0-9→novice, 10-49→competent, 50+→expert
 *   - defensive: negative → novice
 *   - getSessionCount: reads from session_count slot
 *   - incrementSessionCount: increments + persists
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveMaturity, getSessionCount, incrementSessionCount } from "./maturity";
import type { M0Deps } from "./m0-deps";
import type { Result } from "./platform-adapter";

function makeDeps(overrides: Partial<M0Deps> = {}): M0Deps {
  return {
    memory: {
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null } as Result<unknown>),
      setSlot: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      smartSearch: vi.fn().mockResolvedValue({ ok: true, value: [] } as Result<unknown[]>),
      saveLesson: vi.fn().mockResolvedValue({ ok: true } as Result<void>),
      isAvailable: vi.fn().mockResolvedValue(true),
    },
    cache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    },
    ...overrides,
  };
}

describe("deriveMaturity", () => {
  it("0-9 sessions → novice", () => {
    expect(deriveMaturity(0)).toBe("novice");
    expect(deriveMaturity(5)).toBe("novice");
    expect(deriveMaturity(9)).toBe("novice");
  });

  it("10-49 sessions → competent", () => {
    expect(deriveMaturity(10)).toBe("competent");
    expect(deriveMaturity(30)).toBe("competent");
    expect(deriveMaturity(49)).toBe("competent");
  });

  it("50+ sessions → expert", () => {
    expect(deriveMaturity(50)).toBe("expert");
    expect(deriveMaturity(100)).toBe("expert");
    expect(deriveMaturity(500)).toBe("expert");
  });

  it("negative count → novice (defensive)", () => {
    expect(deriveMaturity(-1)).toBe("novice");
    expect(deriveMaturity(-100)).toBe("novice");
  });

  it("non-integer count → correct bucket", () => {
    expect(deriveMaturity(9.5)).toBe("novice");
    expect(deriveMaturity(49.9)).toBe("competent");
  });
});

describe("getSessionCount", () => {
  let deps: M0Deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("returns 0 when slot is empty", async () => {
    const count = await getSessionCount(deps);
    expect(count).toBe(0);
  });

  it("returns stored count when slot has value", async () => {
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { count: 15 },
    } as Result<unknown>);

    const count = await getSessionCount(deps);
    expect(count).toBe(15);
  });

  it("returns 0 when slot read fails", async () => {
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "READ_ERROR", message: "fail" },
    } as Result<unknown>);

    const count = await getSessionCount(deps);
    expect(count).toBe(0);
  });
});

describe("incrementSessionCount", () => {
  let deps: M0Deps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("increments from 0 to 1 when slot is empty", async () => {
    const newCount = await incrementSessionCount(deps);
    expect(newCount).toBe(1);
    expect(deps.memory.setSlot).toHaveBeenCalledWith("session_count", { count: 1 });
  });

  it("increments from existing count", async () => {
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: true,
      value: { count: 7 },
    } as Result<unknown>);

    const newCount = await incrementSessionCount(deps);
    expect(newCount).toBe(8);
    expect(deps.memory.setSlot).toHaveBeenCalledWith("session_count", { count: 8 });
  });

  it("returns 1 when slot read fails (defensive increment)", async () => {
    deps.memory.getSlot = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "READ_ERROR", message: "fail" },
    } as Result<unknown>);

    const newCount = await incrementSessionCount(deps);
    expect(newCount).toBe(1);
  });
});
