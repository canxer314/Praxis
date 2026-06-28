/**
 * types/scene.ts — Scenario, TaskContext, GuidanceSignal 类型
 *
 * 重新导出场景识别和任务上下文相关类型。
 * 定义源在 cognitive/types.ts + orchestration/task-context.ts + orchestration/plan-generator.ts。
 *
 * 架构参考: §11 types/scene.ts
 */

export type {
  ScenarioMatch,
  AutonomyLevel,
  AutonomyPolicy,
} from "../cognitive/types";

// GuidanceSignal is defined in orchestration/plan-generator.ts
export type { GuidanceSignal } from "../orchestration/plan-generator";

// TaskContext types — from orchestration/task-context.ts
export type {
  TaskContext,
  InferredProgress,
  TaskType,
} from "../orchestration/task-context";
