/**
 * types/memory.ts — ProtoStructure, ProtoTask, LearningEvent, CompetencyModel 类型
 *
 * 重新导出 cognitive/types.ts 中的认知结构相关类型。
 * 此文件是按领域组织的类型入口点。定义源仍在 cognitive/types.ts（保持向后兼容）。
 *
 * 架构参考: §11 types/memory.ts
 */

export type {
  // ProtoStructure core
  ProtoStructure,
  ProtoSequence,
  ProtoRole,
  ProtoConcept,
  ProtoPurpose,
  ProtoConstraint,
  ProtoSequenceStep,
  TeleologicalMapping,
  ProtoType,
  LifecycleStage,
  RelationType,
  ConstraintSeverity,
  ConstraintSource,
  Relation,
  VersionSnapshot,
  // Learning events
  LearningEventType,
  CoarseType,
  LearningEvent,
  // Confidence / Fusion
  FusionWeights,
  SignalSourceInput,
  SourceContribution,
  FusedConfidence,
  StepMatch,
  VerifierOutput,
  VerificationContext,
  // Lifecycle
  RetiredStructure,
  ReactivationContext,
  ProtoStructureSeed,
  ConfidenceView,
} from "../cognitive/types";
