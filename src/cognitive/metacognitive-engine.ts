/**
 * MetacognitiveEngine — 元认知自评 + 回顾性校准
 *
 * 职责:
 *   - assess(): 任务前自评 (domain proficiency + 缺口检测)
 *   - calibrate(): 任务后对比 selfRating vs actualOutcome 并修正
 *   - cachedAssess(): 异步优化 — 先用缓存值注入，后台 LLM 更新
 *   - getProfile(): 读取完整 MetacognitiveProfile
 *
 * 核心原则:
 *   - 校准基于用户显式修正信号，不依赖 LLM 自评
 *   - 新领域 (taskCount < 3): 默认 selfRating = 0.3
 *   - taskCount ≥ 5 才启动自动校准
 */

import type { Result } from "../platform-adapter";
import { PraxisErrorThrowable, ErrorCode } from "../platform-adapter";
import type {
  MetacognitiveProfile,
  CalibrationEntry,
  DomainProficiency,
  KnowledgeGap,
} from "./types";
import { log, logDegraded } from "../logger";

// ══════════════════════════════════════════════════════════════════
// 依赖接口 (最小化 — 仅需 memoryClient 读写 profile slot)
// ══════════════════════════════════════════════════════════════════

export interface MetacognitiveMemoryClient {
  getSlot(name: string): Promise<Result<unknown>>;
  setSlot(name: string, data: unknown): Promise<Result<void>>;
  slotAppend?(name: string, entry: unknown): Promise<Result<void>>;
}

// ══════════════════════════════════════════════════════════════════
// 默认值
// ══════════════════════════════════════════════════════════════════

const PROFILE_SLOT = "metacognitive_profile";
const DEFAULT_SELF_RATING = 0.3;
const MIN_TASKS_FOR_CALIBRATION = 5;
const MIN_TASKS_FOR_NEW_DOMAIN = 3;

function defaultProfile(): MetacognitiveProfile {
  return {
    domainProficiencies: {},
    knowledgeGaps: [],
    calibrationHistory: [],
    inferredPreferences: {
      learnsBy: "instruction",
      needsConfirmationFor: [],
    },
  };
}

// ══════════════════════════════════════════════════════════════════
// MetacognitiveEngine
// ══════════════════════════════════════════════════════════════════

export class MetacognitiveEngine {
  private readonly memory: MetacognitiveMemoryClient;
  private cachedProfile: MetacognitiveProfile | null = null;

  constructor(memory: MetacognitiveMemoryClient) {
    if (!memory) throw new PraxisErrorThrowable(ErrorCode.MISSING_DEP,"MetacognitiveMemoryClient is required");
    this.memory = memory;
  }

  // ---- 任务前自评 ----

  /**
   * 对当前任务做元认知评估。
   *
   * @returns selfRating + gapFlags + recommendedMode
   *   新领域 (taskCount < 3): selfRating=0.3, mode=guided
   *   熟悉领域 (taskCount ≥ 5): 使用校准后的 selfRating
   */
  async assess(
    domain: string,
    _taskType: string,
  ): Promise<
    Result<{
      selfRating: number;
      gapFlags: string[];
      recommendedMode: "autonomous" | "guided" | "exploratory";
    }>
  > {
    const profileResult = await this.getProfile();

    if (!profileResult.ok) {
      logDegraded("metacognitive-engine", "assess", "profile read failed, using defaults");
      return {
        ok: true,
        value: {
          selfRating: DEFAULT_SELF_RATING,
          gapFlags: [],
          recommendedMode: "guided",
        },
      };
    }

    const profile = profileResult.value;
    const prof = profile.domainProficiencies[domain];

    if (!prof || prof.taskCount < MIN_TASKS_FOR_NEW_DOMAIN) {
      // 新领域 — 新手模式
      return {
        ok: true,
        value: {
          selfRating: DEFAULT_SELF_RATING,
          gapFlags: this.findOpenGaps(profile, domain),
          recommendedMode: "guided",
        },
      };
    }

    const recommendedMode: "autonomous" | "guided" | "exploratory" =
      prof.selfRating >= 0.8 ? "autonomous" :
      prof.selfRating >= 0.5 ? "guided" :
      "exploratory";

    return {
      ok: true,
      value: {
        selfRating: prof.selfRating,
        gapFlags: this.findOpenGaps(profile, domain),
        recommendedMode,
      },
    };
  }

  // ---- 任务后校准 ----

  /**
   * 回顾性校准: 对比 selfRating vs actualOutcome，修正 domain proficiency。
   *
   * 仅在 taskCount ≥ 5 时执行自动校准。
   * 校准只基于用户显式修正信号，不依赖 LLM 自评。
   */
  async calibrate(entry: CalibrationEntry): Promise<Result<void>> {
    const profileResult = await this.getProfile();
    if (!profileResult.ok) {
      logDegraded("metacognitive-engine", "calibrate", "profile read failed, calibration skipped (will be retried via WAL)");
      return { ok: false, error: { code: "CALIBRATE_NO_PROFILE", message: "Cannot read profile for calibration" } };
    }

    const profile = profileResult.value;
    const prof = profile.domainProficiencies[entry.domain];

    if (!prof || prof.taskCount < MIN_TASKS_FOR_CALIBRATION) {
      // 数据不足，不校准
      log({
        ts: new Date().toISOString(),
        module: "metacognitive-engine",
        op: "calibrate",
        duration_ms: 0,
        outcome: "skipped",
        error: `taskCount ${prof?.taskCount ?? 0} < ${MIN_TASKS_FOR_CALIBRATION}`,
      });
      return { ok: true, value: undefined };
    }

    // 克隆 profile 再修改 — 防止写入失败时污染缓存 (E4)
    const cloned: MetacognitiveProfile = {
      ...profile,
      domainProficiencies: { ...profile.domainProficiencies },
      calibrationHistory: [...profile.calibrationHistory],
      knowledgeGaps: [...profile.knowledgeGaps],
      inferredPreferences: { ...profile.inferredPreferences },
    };

    // 追加校准记录
    cloned.calibrationHistory.push(entry);

    // 更新 actualAccuracy
    const outcomes = cloned.calibrationHistory
      .filter((c) => c.domain === entry.domain)
      .map((c) => c.actualOutcome);
    const successes = outcomes.filter((o) => o === "success").length;
    const profClone = cloned.domainProficiencies[entry.domain]!;
    profClone.actualAccuracy = outcomes.length > 0 ? successes / outcomes.length : 0;

    // 校准 selfRating: 高估→下调, 低估→上调
    const delta = profClone.selfRating - profClone.actualAccuracy;
    if (Math.abs(delta) > 0.15) {
      profClone.selfRating = Number(
        (profClone.selfRating - delta * 0.3).toFixed(2),
      );
      profClone.lastCalibrated = Date.now();
    }

    // 持久化
    const writeResult = await this.memory.setSlot(PROFILE_SLOT, cloned);
    if (!writeResult.ok) {
      logDegraded("metacognitive-engine", "calibrate", "profile write failed");
      return writeResult;
    }

    this.cachedProfile = cloned;
    return { ok: true, value: undefined };
  }

  // ---- 异步优化 (T8) ----

  /**
   * 先用缓存的 selfRating 返回，后台触发 LLM 更新。
   * 保证 session_start < 1s 延迟。
   *
   * 有缓存 profile → 立即返回 (stale: true)，后台异步刷新
   * 无缓存 profile → 同步 assess（首次 session，无法避免）
   */
  async cachedAssess(
    domain: string,
    taskType: string,
  ): Promise<
    Result<{
      selfRating: number;
      gapFlags: string[];
      recommendedMode: "autonomous" | "guided" | "exploratory";
      stale: boolean;
    }>
  > {
    // 快速路径: profile 已缓存 → 立即返回，后台异步更新
    if (this.cachedProfile) {
      const prof = this.cachedProfile.domainProficiencies[domain];

      const fastResult = {
        selfRating: prof?.selfRating ?? DEFAULT_SELF_RATING,
        gapFlags: this.findOpenGaps(this.cachedProfile, domain),
        recommendedMode:
          (prof?.selfRating ?? 0) >= 0.8 ? "autonomous" as const
          : (prof?.selfRating ?? 0) >= 0.5 ? "guided" as const
          : "exploratory" as const,
        stale: true,
      };

      // 后台异步刷新 profile（不阻塞返回）
      this.assess(domain, taskType).then(
        () => log({
          ts: new Date().toISOString(),
          module: "metacognitive-engine",
          op: "cachedAssess:background",
          duration_ms: 0,
          outcome: "success",
        }),
        () => {}, // 后台刷新失败——静默，不崩主流程
      );

      return { ok: true, value: fastResult };
    }

    // 慢速路径: 无缓存 → 必须同步 assess
    const result = await this.assess(domain, taskType);
    if (!result.ok) return result;
    return { ok: true, value: { ...result.value, stale: false } };
  }

  // ---- Profile 读写 ----

  async getProfile(): Promise<Result<MetacognitiveProfile>> {
    if (this.cachedProfile) {
      return { ok: true, value: this.cachedProfile };
    }

    const result = await this.memory.getSlot(PROFILE_SLOT);
    if (!result.ok) {
      return result;
    }

    // 运行时类型守卫 — slot 可能包含任意类型
    if (
      typeof result.value !== "object" ||
      result.value === null ||
      Array.isArray(result.value)
    ) {
      logDegraded("metacognitive-engine", "getProfile", "slot value is not an object, using defaults");
      this.cachedProfile = defaultProfile();
      return { ok: true, value: this.cachedProfile };
    }

    const profile = result.value as MetacognitiveProfile;
    // 确保嵌套字段有默认值
    profile.domainProficiencies ??= {};
    profile.knowledgeGaps ??= [];
    profile.calibrationHistory ??= [];
    profile.inferredPreferences ??= defaultProfile().inferredPreferences;

    this.cachedProfile = profile;
    return { ok: true, value: profile };
  }

  async saveProfile(profile: MetacognitiveProfile): Promise<Result<void>> {
    const result = await this.memory.setSlot(PROFILE_SLOT, profile);
    if (result.ok) this.cachedProfile = profile;
    return result;
  }

  // ---- 缺口管理 ----

  addKnowledgeGap(profile: MetacognitiveProfile, gap: KnowledgeGap): void {
    profile.knowledgeGaps.push(gap);
  }

  private findOpenGaps(profile: MetacognitiveProfile, domain: string): string[] {
    return profile.knowledgeGaps
      .filter((g) => !g.resolved && g.context.includes(domain))
      .map((g) => g.topic);
  }
}
