/**
 * Analysis 层 — 聚合导出 (M4 + M5)
 */

export type { Verifier, VerificationContext, VerifierOutput } from "./types";
export { MidSessionLearner, extractKeywords, matchStructures, computePenalty } from "./mid-session-learner";
export type { DowngradeRecord } from "./mid-session-learner";
export { quickCheck, deepCheck, updateTeleologicalMapping, isProtoSequence } from "./teleological-judge";
export type { TeleologicalJudgment } from "./teleological-judge";
export { accumulateProtoTask, growConfidence, extractTaskType } from "./proto-task-learner";
export type { ProtoTask, ProtoTaskPhase, ProtoTaskPitfall } from "./proto-task-learner";
export {
  detectProtoTaskDecline,
  detectCrossScenarioFailure,
  detectCorrectionCluster,
  detectSkillStagnation,
  detectEscalationAnomaly,
} from "./structural-gap-detector";
export type { StructuralGapSignal } from "./structural-gap-detector";
