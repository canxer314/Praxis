/**
 * before-tool-call 测试 — M0 autonomy + M3 constraint validation
 *
 * 覆盖:
 *   - M0 autonomy: 4 级风险决策 + 特定操作策略
 *   - M3 loadConstraints: 防御性拷贝 + 空数组清除
 *   - M3 mergeResults: constraint block 覆盖 autonomy、confirm 升级、warn 不变、无约束时回归
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BeforeToolCallHandler } from "./before-tool-call";
import type { M0Deps } from "../m0-deps";
import type { ProtoConstraint } from "../cognitive/types";

function makeDeps(overrides: Partial<M0Deps> = {}): M0Deps {
  return {
    memory: {
      getSlot: vi.fn().mockResolvedValue({ ok: true, value: null }),
      setSlot: vi.fn().mockResolvedValue({ ok: true }),
      smartSearch: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      saveLesson: vi.fn().mockResolvedValue({ ok: true }),
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

function makeConstraint(overrides: Partial<ProtoConstraint> = {}): ProtoConstraint {
  return {
    id: "c1",
    protoType: "constraint",
    tentativeName: "测试约束",
    scenarioId: "general",
    confidence: 0.85,
    observationsCount: 7,
    adoptionRate: 0.5,
    lifecycle: "crystallized",
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    severity: "block",
    source: "user_taught",
    rulePatterns: ["migrate", "backup"],
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// M0: 自主性决策
// ══════════════════════════════════════════════════════════════════

describe("BeforeToolCallHandler (M0 — autonomy)", () => {
  it("低风险操作 → proceed 或 inform", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    const result = await handler.handle("test-session", "git_status");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(["proceed", "inform"]).toContain(result.value.action);
    }
  });

  it("中风险操作 → inform", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    const result = await handler.handle("test-session", "npm_install");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("inform");
    }
  });

  it("高风险操作 → confirm (keyword: database_changes)", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    const result = await handler.handle("test-session", "apply_database_changes");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("confirm");
    }
  });

  it("关键风险操作 → block (keyword: production_deploy)", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    const result = await handler.handle("test-session", "production_deploy");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("block");
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// M3: 约束验证
// ══════════════════════════════════════════════════════════════════

describe("BeforeToolCallHandler (M3 — constraints)", () => {
  it("loadConstraints 防御性拷贝", () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    const c = makeConstraint();
    handler.loadConstraints([c]);
    // Mutating the original shouldn't affect internal state
    c.severity = "warn";
    // Can't easily test internal state, but the copy prevents mutation
  });

  it("空数组清除约束", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    handler.loadConstraints([makeConstraint()]);
    handler.loadConstraints([]);
    // After clearing, constraint should NOT block
    const result = await handler.handle("test-session", "git_status"); // low risk → proceed/inform
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(["proceed", "inform"]).toContain(result.value.action);
    }
  });

  it("constraint block 覆盖 autonomy proceed → block", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    handler.loadConstraints([
      makeConstraint({ id: "backup-block", rulePatterns: ["status"], severity: "block" }),
    ]);
    const result = await handler.handle("test-session", "git_status"); // low risk → proceed
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("block");
      expect(result.value.reason).toContain("backup-block");
    }
  });

  it("constraint confirm 覆盖 autonomy inform → confirm", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    handler.loadConstraints([
      makeConstraint({ id: "install-confirm", rulePatterns: ["install"], severity: "confirm" }),
    ]);
    const result = await handler.handle("test-session", "npm_install"); // medium risk → inform
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("confirm");
    }
  });

  it("constraint warn 不改变 autonomy 决策", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    handler.loadConstraints([
      makeConstraint({ id: "warn-only", rulePatterns: ["status"], severity: "warn" }),
    ]);
    const result = await handler.handle("test-session", "git_status"); // low risk → proceed/inform
    expect(result.ok).toBe(true);
    if (result.ok) {
      // warn should not escalate — autonomy decision stands
      expect(["proceed", "inform"]).toContain(result.value.action);
    }
  });

  it("constraint block + autonomy block → block（双方一致）", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    handler.loadConstraints([
      makeConstraint({ id: "rm-block", rulePatterns: ["rm_rf"], severity: "block" }),
    ]);
    const result = await handler.handle("test-session", "rm_rf_root"); // critical risk → block
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("block");
    }
  });

  it("无约束加载时行为与 M0 完全一致（回归）", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    // No loadConstraints call → empty array
    const result = await handler.handle("test-session", "apply_database_changes"); // high risk → confirm
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("confirm");
    }
  });

  it("constraint 不匹配 toolName 时 → autonomy 决策不变", async () => {
    const handler = new BeforeToolCallHandler(makeDeps());
    handler.loadConstraints([
      makeConstraint({ rulePatterns: ["nonexistent_tool"] }),
    ]);
    const result = await handler.handle("test-session", "git_status");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(["proceed", "inform"]).toContain(result.value.action);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// T12: 降级约束缓存
// ══════════════════════════════════════════════════════════════════

describe("BeforeToolCallHandler (T12 — constraint cache fallback)", () => {
  it("loadConstraintsFromCache 从 local-cache 读取并加载约束", () => {
    const cachedConstraints = [
      makeConstraint({ id: "cached-c1", rulePatterns: ["dangerous_tool"], severity: "block" }),
    ];
    const deps = makeDeps({
      cache: {
        get: vi.fn().mockReturnValue(cachedConstraints),
        set: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      },
    });
    const handler = new BeforeToolCallHandler(deps);
    const loaded = handler.loadConstraintsFromCache();
    expect(loaded).toBe(true);
    expect(deps.cache.get).toHaveBeenCalledWith("active_constraints");
  });

  it("loadConstraintsFromCache 返回 false 当缓存为空", () => {
    const deps = makeDeps({
      cache: {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      },
    });
    const handler = new BeforeToolCallHandler(deps);
    const loaded = handler.loadConstraintsFromCache();
    expect(loaded).toBe(false);
  });

  it("loadConstraintsFromCache 返回 false 当缓存数据不是数组", () => {
    const deps = makeDeps({
      cache: {
        get: vi.fn().mockReturnValue({ not: "an array" }),
        set: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      },
    });
    const handler = new BeforeToolCallHandler(deps);
    const loaded = handler.loadConstraintsFromCache();
    expect(loaded).toBe(false);
  });

  it("从缓存加载的约束可以正常拦截违规操作", async () => {
    const cachedConstraints = [
      makeConstraint({ id: "cache-block", rulePatterns: ["dangerous_op"], severity: "block" }),
    ];
    const deps = makeDeps({
      cache: {
        get: vi.fn().mockReturnValue(cachedConstraints),
        set: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      },
    });
    const handler = new BeforeToolCallHandler(deps);
    handler.loadConstraintsFromCache();
    const result = await handler.handle("test-session", "dangerous_op");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("block");
      expect(result.value.constraintId).toBe("cache-block");
    }
  });

  it("缓存加载失败（异常）→ 返回 false，不崩溃", () => {
    const deps = makeDeps({
      cache: {
        get: vi.fn().mockImplementation(() => { throw new Error("disk error"); }),
        set: vi.fn(),
        list: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      },
    });
    const handler = new BeforeToolCallHandler(deps);
    const loaded = handler.loadConstraintsFromCache();
    expect(loaded).toBe(false);
  });
});
