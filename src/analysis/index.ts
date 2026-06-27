/**
 * Analysis 层 — 聚合导出 (M4 + M5 + M6)
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
export { ArchitectureAuditor } from "./architecture-auditor";
export type { ArchitectureAuditReport, AdversarialChallenge, AuditRecommendation } from "./architecture-auditor";
export { CategoryAuditor } from "./category-auditor";
export type { CategoryAuditReport, CategoryBlindSpot, DomainCategoryForkProposal, NewCategoryProposal } from "./category-auditor";
export { CrossAgentSync } from "./cross-agent-sync";
export type { OptimisticLockResult, PendingMerge } from "./cross-agent-sync";
