# Praxis Module Architecture

> Phase 1: Governor-Centric Refactor
> Branch: `feature/governor-phase1` | Version: 0.6.1.0

## Module Tree

```
src/cognitive/
├── index.ts                          # Public API surface
├── types.ts                          # All TypeScript interfaces + enums
├── constants.ts                      # AgentMemory slot names
│
├── cognitive-core.ts                 # CognitiveCore + SessionCognitiveCore (entry point)
│   └── Governor (per-session)        #   └── 4-stage learning decision pipeline
│
├── governor.ts                       # Governor: classify→gate→decide→dispatch
├── timing-controller.ts              # Signal classifier: IMMEDIATE|BATCH|DEFERRED
├── task-state-machine.ts             # Pure-function two-level state machine
├── proto-task.ts                     # Zero-shot task template bootstrap + TTL cache
│
├── learning-loop.ts                  # LearningLoop (passive executor, Phase 1 shadow mode)
├── task-assessment.ts                # TaskAssessmentBuilder: pre-task memory retrieval
├── execution-feedback.ts             # ExecutionFeedbackCollector: capture corrections
├── learning-update.ts                # LearningUpdateBuilder: WAL-protected persistence
│
├── metacognitive-engine.ts           # Self-assessment + calibration
├── gap-detector.ts                   # Knowledge gap detection
├── memory-consolidator.ts            # Episodic→Semantic→Procedural consolidation
│
├── strategy-registry.ts              # E4: Strategy lifecycle (PROPOSED→ACTIVE→DORMANT)
├── cross-domain-analyzer.ts          # E5: Cross-domain pattern migration
│
├── task-scheduler.ts                 # V13: Active task scheduling
├── subagent-manager.ts               # V13: Sub-agent lifecycle management
├── heartbeat-monitor.ts              # V13: Stalled task detection + intervention
│
├── context.ts                        # Context injection builder
├── sanitize.ts                       # Prompt fragment sanitization
├── inmemory-client.ts                # InMemoryMemoryClient (dev/test)
│
└── utils/
    └── signal-quality.ts             # isRealExperience pure function
```

## Data Flow

### Governor Pipeline (4 stages)

```
User corrects AI
  │
  ▼
┌──────────────────────────────────────────────────────┐
│ Stage 1: classify                                    │
│   SignalDetector.inferSignalType(correction, ctx)    │
│   → TimingController.classify(signalType)             │
│   Output: ClassifiedSignal { signalType, timing }    │
├──────────────────────────────────────────────────────┤
│ Stage 2: gate                                        │
│   isRealExperience(correction, ctx)                  │
│   → true: pass    false: SKIP                        │
│   unknown signalType: pass with low confidence       │
│   Output: GatedSignal { signal, passed, reason }     │
├──────────────────────────────────────────────────────┤
│ Stage 3: decide                                      │
│   IMMEDIATE → LEARN + execution_feedback (0.7)       │
│   BATCH     → LEARN + learning_update (0.5)          │
│   DEFERRED   → DEFER + deferred_queue (0.3)          │
│   SKIP       → action=SKIP + routeTo=none            │
│   Output: LearningDecision { action, confidence }    │
├──────────────────────────────────────────────────────┤
│ Stage 4: dispatch (Phase 1: no-op, caller handles)   │
│   Phase 2: routeTo → delegates                       │
├──────────────────────────────────────────────────────┤
│ Degradation: pipeline throws → signal bypassed       │
│   → ExecutionFeedback.captureCorrection()             │
│   → returns SAFE_DEFAULT (DEFER, confidence=0)       │
└──────────────────────────────────────────────────────┘
```

### Session Lifecycle (current)

```
session_start
  └── CognitiveCore.createSession()
      ├── MetacognitiveEngine (shared, cross-session)
      ├── Governor (per-session, Phase 1 shadow mode)
      └── LearningLoop (existing orchestrator)
          ├── TaskAssessmentBuilder
          ├── ExecutionFeedbackCollector
          └── LearningUpdateBuilder

message_received (user corrects AI)
  └── PlatformAdapter.route("message_received")
      └── SessionCognitiveCore.captureCorrection()    ← existing path
      └── SessionCognitiveCore.governorDecide()        ← Phase 2 activation

session_end
  └── SessionCognitiveCore.finalizeLearning()
      └── LearningLoop.sessionEnd()
          ├── MemoryConsolidator.consolidate()
          ├── GapDetector.detect()
          ├── StrategyRegistry.reactivateDormant()
          ├── CrossDomainAnalyzer.findDegradedMigrations()
          └── WAL persist
```

## Task State Machine

```
OUTER LOOP (Task states — advanceTask)
═══════════════════════════════════════════════════════
TASK_NOT_STARTED ──[task_start]──▶ TASK_ASSESSING
TASK_ASSESSING ──[assessment_complete]──▶ TASK_PLAN_GENERATING
TASK_PLAN_GENERATING ──[plan_ready]──▶ TASK_IN_PROGRESS
TASK_IN_PROGRESS ──[all_subtasks_done]──▶ TASK_VERIFYING
TASK_VERIFYING ──[verification_passed]──▶ TASK_COMPLETE
TASK_VERIFYING ──[verification_failed]──▶ TASK_ITERATING
TASK_ITERATING ──[plan_ready]──▶ TASK_IN_PROGRESS     (re-enter)
TASK_ITERATING ──[user_abort]──▶ TASK_ABANDONED
TASK_ITERATING ──[max_iterations]──▶ TASK_ABANDONED

Terminal: TASK_COMPLETE, TASK_ABANDONED

INNER LOOP (Subtask states — advanceSubtask)
═══════════════════════════════════════════════════════
SUBTASK_PENDING ──[subtask_start]──▶ SUBTASK_ACTIVE
SUBTASK_ACTIVE ──[subtask_done]──▶ SUBTASK_COMPLETING
SUBTASK_ACTIVE ──[user_correction_3x]──▶ SUBTASK_BLOCKED
SUBTASK_ACTIVE ──[tool_violation_3x]──▶ SUBTASK_BLOCKED
SUBTASK_ACTIVE ──[max_retries]──▶ SUBTASK_FAILED
SUBTASK_COMPLETING ──[verification_passed]──▶ SUBTASK_VERIFIED
SUBTASK_COMPLETING ──[verification_failed]──▶ SUBTASK_FAILED

Terminal: SUBTASK_VERIFIED, SUBTASK_FAILED, SUBTASK_BLOCKED
```

Invalid transitions return `{ ok: false, reason: "..." }` — no exceptions thrown.

## Timing Controller

| Signal Type | Timing | Route |
|-------------|--------|-------|
| `mistake_correction` | IMMEDIATE | execution_feedback |
| `domain_insight` | BATCH | learning_update |
| `preference_discovery` | BATCH | learning_update |
| `task_pattern_recognition` | BATCH | learning_update |
| `procedural_optimization` | DEFERRED | deferred_queue |
| `unknown` / invalid | DEFERRED | safe default |

## ProtoTask

```
bootstrapProtoTask(taskType, llmClient)
  │
  ├── TTL cache hit (< 24h)? → return cached
  │
  └── cache miss:
      ├── LLM.chat(system_prompt, taskType)
      │   ├── success → parse JSON → validate → cache → return (confidence=0.2)
      │   ├── malformed JSON → retry 1x → null
      │   ├── timeout/429 → exponential backoff + jitter → retry 3x → null
      │   └── unavailable → null (safe degradation)
      │
      └── shouldInjectProtoTask(pt): confidence >= 0.5?
```

Cache: module-level `Map<string, {protoTask, cachedAt}>`. 24h TTL. `clearProtoTaskCache()` for testing.

## Interface Contracts

### CognitiveCoreDeps

```typescript
interface CognitiveCoreDeps {
  memoryClient: CognitiveCoreMemoryClient;  // AgentMemory or InMemoryMemoryClient
  walFilePath?: string;                     // Optional WAL for crash recovery
}
```

### Governor public API

```typescript
class Governor {
  // Main entry: 4-stage pipeline
  decide(correction, sessionContext, signalTypeHint?): Result<LearningDecision>
  
  // Observability
  getStats(): GovernorStats         // { decisionCount, bypassCount, feedbackCount }
  getFeedback(): Result<{...}>      // Execution feedback snapshot
  reset(): void                     // Clear per-session state
}
```

### CognitiveCore public API (Phase 1 additions)

```typescript
class SessionCognitiveCore {
  readonly governor: Governor;       // Per-session Governor instance
  
  governorDecide(                    // Governor-driven decision (Phase 2 activation)
    correction: Correction,
    sessionContext: SessionContext,
    signalTypeHint?: string,
  ): Result<LearningDecision>;
}
```

### Pure function exports

```typescript
// signal-quality
isRealExperience(correction, sessionContext): boolean

// timing-controller
classify(signalType): TimingResult
isKnownSignalType(value): value is SignalType

// task-state-machine
advanceTask(from, event): TaskTransitionResult
advanceSubtask(from, event): SubtaskTransitionResult
isTaskTerminal(state): boolean
isSubtaskTerminal(state): boolean

// proto-task
bootstrapProtoTask(taskType, llmClient): Promise<ProtoTask | null>
getCachedProtoTask(taskType): ProtoTask | null
shouldInjectProtoTask(pt): boolean
```

## Existing Components (reused, not rebuilt)

| Component | File | Role in Governor Architecture |
|-----------|------|-------------------------------|
| MetacognitiveEngine | `metacognitive-engine.ts` | Self-assessment sensor for Governor |
| GapDetector | `gap-detector.ts` | Gap signal sensor |
| ExecutionFeedbackCollector | `execution-feedback.ts` | Receives IMMEDIATE decisions |
| LearningUpdateBuilder | `learning-update.ts` | Receives BATCH decisions, WAL-protected writes |
| LearningLoop | `learning-loop.ts` | Passive executor (Phase 1: runs in parallel with Governor) |
| MemoryConsolidator | `memory-consolidator.ts` | Episodic→Semantic→Procedural consolidation |
| TaskAssessmentBuilder | `task-assessment.ts` | Pre-task memory retrieval |
| Context builder | `context.ts` | System prompt injection |
| InMemoryMemoryClient | `inmemory-client.ts` | Dev/test memory backend |

## Phase 2: Not Yet Implemented

| Component | Purpose | Blocked By |
|-----------|---------|------------|
| Governor activation | Replace LearningLoop as orchestrator | 20+ sessions shadow mode data |
| SignalRouter | Route 5 signal types to correct delegate | Governor activation |
| QuestionGate | Rate/quality/silent-hours gating | Proactive question caller |
| TaskScheduler bridge | Retry queue + passive fallback | Governor activation |
| UnclassifiedBuffer | Capture unclassifiable signals | SignalRouter |
| ProtoTask cumulative | 0.2→0.8 over 10 projects | 3+ completed projects |
