/**
 * Praxis Bootstrap 测试 — Phase 1B sentinel 幂等 + 词袋合成 + 部分写入恢复
 *
 * 覆盖:
 *   - 首次 bootstrap: sentinel 缺失 + competency_model 缺失 → 合成并写入全部 slot
 *   - sentinel 幂等: praxis_bootstrap_done=true → 跳过
 *   - 部分写入恢复: sentinel 缺失但 competency_model 存在 → 补写缺失 slot
 *   - 空数据 fallback: 无 lessons 时 → DEFAULT_COMPETENCY (all 0.5)
 *   - 词袋合成: lessons → 8D 维度评分
 *   - searchLessons 降级: searchLessons 失败 → fallback smartSearch
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrapIfNeeded } from "./praxis-bootstrap";
import type { M0Deps, MemorySubsystem } from "../m0-deps";
import type { Result } from "../platform-adapter";

// ══════════════════════════════════════════════════════════════════
// 辅助: 构建 mock M0Deps
// ══════════════════════════════════════════════════════════════════

function makeMockMemory(overrides: Partial<MemorySubsystem> = {}): MemorySubsystem {
  return {
    getSlot: vi.fn().mockResolvedValue({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }),
    setSlot: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    smartSearch: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    saveLesson: vi.fn().mockResolvedValue({ ok: true }),
    isAvailable: vi.fn().mockResolvedValue(true),
    searchLessons: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    ...overrides,
  };
}

function makeMockDeps(overrides: Partial<MemorySubsystem> = {}): M0Deps {
  return {
    memory: makeMockMemory(overrides),
    cache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

// ══════════════════════════════════════════════════════════════════
// sample lessons
// ══════════════════════════════════════════════════════════════════

function sampleLessons() {
  return [
    { content: "用户偏好使用 TypeScript 类型别名而非 interface", confidence: 0.95, tags: ["preference", "typescript"], source: "auto" },
    { content: "架构设计应遵循六层架构模式", confidence: 0.9, tags: ["architecture", "design"], source: "manual" },
    { content: "工具调用超时需增加 10 秒控制", confidence: 0.85, tags: ["pitfall", "tool"], source: "auto" },
    { content: "工作流: 切分支 → review → ship → 合并", confidence: 0.95, tags: ["preference", "workflow"], source: "auto" },
    { content: "AI 分析应遵循第一性原理和推理诚实性规则", confidence: 0.95, tags: ["preference", "analysis"], source: "manual" },
    { content: "学习模式: 从 session transcript 提取 lessons", confidence: 0.8, tags: ["pattern", "learning"], source: "auto" },
    { content: "文件搜索使用 Glob 而非 PowerShell Get-ChildItem", confidence: 0.75, tags: ["pattern", "tool"], source: "auto" },
    { content: "迭代优化: 每个版本需记录 diff + rationale", confidence: 0.7, tags: ["pattern", "improvement"], source: "manual" },
  ];
}

// ══════════════════════════════════════════════════════════════════
// 测试
// ══════════════════════════════════════════════════════════════════

describe("bootstrapIfNeeded", () => {
  let deps: M0Deps;

  beforeEach(() => {
    deps = makeMockDeps();
  });

  describe("sentinel 幂等", () => {
    it("sentinel 存在时跳过 bootstrap", async () => {
      deps.memory.getSlot = vi.fn().mockResolvedValueOnce({
        ok: true, value: true,
      } as Result<unknown>); // praxis_bootstrap_done=true

      const result = await bootstrapIfNeeded(deps);
      expect(result.bootstrapped).toBe(false);
      expect(result.skipped).toBe(true);
      expect(deps.memory.setSlot).not.toHaveBeenCalled();
    });

    it("sentinel 缺失 + competency_model 缺失 → 执行 bootstrap", async () => {
      // sentinel not found
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } }) // sentinel
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } }); // model

      (deps.memory.searchLessons as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, value: sampleLessons() });

      const result = await bootstrapIfNeeded(deps);
      expect(result.bootstrapped).toBe(true);
      expect(result.dimensions).toBeGreaterThan(0);
    });

    it("sentinel 缺失但 competency_model 存在 → 部分写入恢复", async () => {
      // sentinel: not found, model: exists
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } }) // sentinel
        .mockResolvedValueOnce({
          ok: true,
          value: {
            domainProficiencies: { "工具熟练度": { selfRating: 0.5, taskCount: 0 } },
          },
        }); // model exists

      const result = await bootstrapIfNeeded(deps);
      expect(result.bootstrapped).toBe(false);
      expect(result.skipped).toBe(true);
      // 应补写 snapshots + audit_log + sentinel
      expect(deps.memory.setSlot).toHaveBeenCalledWith("competency_snapshots", expect.anything());
      expect(deps.memory.setSlot).toHaveBeenCalledWith("praxis_bootstrap_done", true);
    });
  });

  describe("词袋合成", () => {
    it("8 个维度全部有值", async () => {
      // sentinel + model both not found
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } })
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } });

      (deps.memory.searchLessons as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, value: sampleLessons() });

      await bootstrapIfNeeded(deps);

      // 验证 competency_model 写入包含 8 个维度
      const setSlotCalls = (deps.memory.setSlot as ReturnType<typeof vi.fn>).mock.calls;
      const modelCall = setSlotCalls.find((c: [string, unknown]) => c[0] === "competency_model");
      expect(modelCall).toBeDefined();

      const model = modelCall[1] as Record<string, unknown>;
      const dims = model.domainProficiencies as Record<string, { selfRating: number }>;
      expect(Object.keys(dims).length).toBe(8);

      // 有 lessons 数据时至少某些维度 > 0.2 (非默认)
      const ratings = Object.values(dims).map(d => d.selfRating);
      const hasNonDefault = ratings.some(r => r > 0.2);
      expect(hasNonDefault).toBe(true);
    });

    it("空 lessons → DEFAULT_COMPETENCY (all 0.5)", async () => {
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } })
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } });

      (deps.memory.searchLessons as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, value: [] });
      (deps.memory.smartSearch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, value: [] });

      await bootstrapIfNeeded(deps);

      const modelCall = (deps.memory.setSlot as ReturnType<typeof vi.fn>).mock.calls
        .find((c: [string, unknown]) => c[0] === "competency_model");
      const model = modelCall[1] as Record<string, unknown>;
      const dims = model.domainProficiencies as Record<string, { selfRating: number }>;
      const ratings = Object.values(dims).map(d => d.selfRating);
      expect(ratings.every(r => r === 0.5)).toBe(true);
      expect(model.source).toBe("bootstrap_v1_default");
    });
  });

  describe("写入顺序 (sentinel 保证幂等)", () => {
    it("按 audit_log → snapshots → model → sentinel 顺序写入", async () => {
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } })
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } });

      (deps.memory.searchLessons as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, value: sampleLessons() });

      await bootstrapIfNeeded(deps);

      const calls = (deps.memory.setSlot as ReturnType<typeof vi.fn>).mock.calls;
      const slotNames = calls.map((c: [string, unknown]) => c[0]);

      const auditIdx = slotNames.indexOf("audit_log");
      const snapIdx = slotNames.indexOf("competency_snapshots");
      const modelIdx = slotNames.indexOf("competency_model");
      const sentinelIdx = slotNames.indexOf("praxis_bootstrap_done");

      expect(auditIdx).toBeLessThan(sentinelIdx);
      expect(snapIdx).toBeLessThan(sentinelIdx);
      expect(modelIdx).toBeLessThan(sentinelIdx);
      // sentinel 必须在最后
      expect(sentinelIdx).toBeGreaterThan(modelIdx);
    });

    it("audit_log 格式为 { entries: [...] }", async () => {
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } })
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } });

      (deps.memory.searchLessons as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, value: sampleLessons() });

      await bootstrapIfNeeded(deps);

      const auditCall = (deps.memory.setSlot as ReturnType<typeof vi.fn>).mock.calls
        .find((c: [string, unknown]) => c[0] === "audit_log");
      const auditValue = auditCall[1] as Record<string, unknown>;
      expect(auditValue).toHaveProperty("entries");
      expect(Array.isArray(auditValue.entries)).toBe(true);
      expect((auditValue.entries as Array<Record<string, unknown>>)[0].type).toBe("bootstrap");
    });
  });

  describe("searchLessons 降级", () => {
    it("searchLessons 失败 → 降级到 smartSearch", async () => {
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } })
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } });

      // searchLessons 失败
      (deps.memory.searchLessons as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("timeout"));
      // smartSearch 成功
      (deps.memory.smartSearch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          value: sampleLessons().map(l => ({ content: l.content, confidence: l.confidence, tags: l.tags })),
        });

      await bootstrapIfNeeded(deps);

      expect(deps.memory.smartSearch).toHaveBeenCalled();
      // 应该最终写入 competency_model
      const modelCall = (deps.memory.setSlot as ReturnType<typeof vi.fn>).mock.calls
        .find((c: [string, unknown]) => c[0] === "competency_model");
      expect(modelCall).toBeDefined();
    });

    it("searchLessons 不存在时降级到 smartSearch", async () => {
      const mem = makeMockMemory();
      delete mem.searchLessons; // searchLessons undefined

      mem.getSlot = vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } })
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } });

      mem.smartSearch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          value: sampleLessons().map(l => ({ content: l.content, confidence: l.confidence, tags: l.tags })),
        });

      deps.memory = mem;
      await bootstrapIfNeeded(deps);
      expect(mem.smartSearch).toHaveBeenCalled();
    });
  });

  describe("错误恢复", () => {
    it("getSlot 失败时优雅降级到默认 bootstrap", async () => {
      // getSlot 全部失败 → checkIfNeeded 内部 catch → 判定需要 bootstrap
      // searchLessons 也失败 → collectRawData 内部 catch → 空 lessons
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error("catastrophic failure"));
      (deps.memory.searchLessons as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error("timeout"));
      (deps.memory.smartSearch as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error("timeout"));

      // 不抛异常，返回 DEFAULT_COMPETENCY
      const result = await bootstrapIfNeeded(deps);
      expect(result.bootstrapped).toBe(true);  // 降级成功
      expect(result.dimensions).toBe(8);       // 8 个默认维度
    });

    it("写入失败时返回 error", async () => {
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } })
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } });

      (deps.memory.searchLessons as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, value: sampleLessons() });
      // setSlot 全部抛异常，触发外层 catch
      (deps.memory.setSlot as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error("write failure"));

      const result = await bootstrapIfNeeded(deps);
      expect(result.bootstrapped).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("competency_snapshots 包含 1 条初始快照", async () => {
      (deps.memory.getSlot as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } })
        .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND", message: "nope" } });

      (deps.memory.searchLessons as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, value: sampleLessons() });

      await bootstrapIfNeeded(deps);

      const snapCall = (deps.memory.setSlot as ReturnType<typeof vi.fn>).mock.calls
        .find((c: [string, unknown]) => c[0] === "competency_snapshots");
      const snapValue = snapCall[1] as unknown[];
      expect(Array.isArray(snapValue)).toBe(true);
      expect(snapValue.length).toBe(1);
    });
  });
});
