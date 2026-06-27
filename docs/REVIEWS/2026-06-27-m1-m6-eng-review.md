# Praxis M1–M6 Engineering Review

> Review against `architech/praxis-architecture.md` (World Model target) and `docs/ROADMAP.md` (M1–M6 deliverables).
> Method: spec read in full → 6 parallel milestone deep-dives (subagents, pre-emit verification gate) → headline P0 claims re-verified by direct read + grep → holistic synthesis → outside voice (codex).
> Date: 2026-06-27 · Branch: master · Reviewer: Claude (plan-eng-review) + codex outside voice.

## Ground truth (verified, not trusted)

- `tsc --noEmit` → **clean (exit 0)**.
- `vitest run` → **801 tests pass across 55 files (exit 0)**. (ROADMAP's "774 tests" claim is already stale — the suite has grown to 801.)
- codegraph index spans the parent `AgentOS` workspace (22k files, includes sibling projects) and is unreliable for Praxis; review used direct Read/Grep scoped to `src/`.

## Executive verdict

> ⚠️ **REFRAMED BY OUTSIDE VOICE (codex; verified by direct read).** The deeper finding is that **there are two systems and they are not the same**: a *tested* system (`EventOrchestrator` + handlers + a fully-populated `M0Deps` in tests — 801 tests pass here) and a *running* system (`phase1a-bridge.ts` → handlers directly, with `buildM0Deps()` = `memory`+`cache` only — no `llm`, `fuser`, or `attentionRecords`). `new EventOrchestrator` appears **only in `orchestrator.test.ts`** (grep: zero production hits). In production the fuser never runs (`deps.fuser` undefined → guards short-circuit), no LLM extraction/deepCheck/cron-LLM runs (`deps.llm` undefined), and no `LLMSubsystem` implementation exists to inject even if it were set (`LlmClient`/DeepSeek has only `analyze()`; `LLMSubsystem` requires `analyzeTranscript`+`extractProtoStructures`). **The 801 passing tests exercise a system that doesn't run.** The first-pass framing below is accurate but *understated* — it reviewed the tested system as if it were the runtime.

**First-pass framing:** The M1–M6 implementation is, in runtime terms, a thin M0 event pipeline (orchestrator + 7 handlers) surrounded by a large library of cognitive functions that are mostly not connected to it.** The data model is faithful to the spec and the M0 plumbing is clean, but the cognitive middle — especially M2 (context orchestration) and M4 (confidence/verifiers, the core of Praxis) — is largely **implemented-but-not-wired**: pure functions that exist, pass isolated unit tests, and are never called in any production event path. The roadmap's "✅ 全部完成" systematically overstates reality: at least 13 of the per-milestone completion checkboxes are not met in code.

The single most important finding: **Praxis's headline thesis — "break the LLM self-eval loop" via LLM-independent verifiers (architecture §12 principle 2) — is unrealized in the runtime.** The 7-source fuser runs on 2 LLM-derived sources (`llm_marker` + `mid_session`); the 3 LLM-independent verifiers (Statistical/Role/Concept) are never instantiated or fed to it; QuineanGating never gates crystallization. A "zombie structure" (high confidence, never used) — the exact failure the Quinean gates exist to reject — passes crystallization today.

This is not a broken build or a pile of bugs. It is a **wiring debt** problem: the parts are mostly present and individually tested; they are not assembled into the running system the architecture describes.

---

## What already exists (Step 0 — reuse audit)

| Sub-problem | Exists? | Reused or rebuilt? |
|---|---|---|
| M0 event pipeline (7 lifecycle handlers, Result\<T\>, AgentMemory + local-cache degradation) | ✅ solid | Foundation everything else hangs off — correctly reused |
| 5 ProtoStructure types + dual-nature fields + 6 relations + 6 lifecycle states | ✅ in `types.ts`, faithful to §3/§9 | Reused by all later milestones |
| Adapter layer (OpenClaw + Claude Code) | ✅ pure functions, well-tested | M6.3 equivalence proof is the strongest test in the repo |
| `/praxis status` (M6.4) | ✅ reads real `competency_model` data | Not stubbed |
| MidSessionLearner penalty cap (≤0.2) + <10ms hot path | ✅ correctly enforced | Wired in orchestrator |
| ProtoTask log-confidence formula | ✅ matches spec exactly | — |

**Complexity check (Step 0):** the implementation touches 125+ files and introduces dozens of classes/services — far past the 8-file/2-class smell threshold. For a *new* plan this would trigger a scope-reduction gate. Here it is a retrospective observation: the surface area is large **relative to what is actually live**, which is itself the core problem (see Theme 1).

---

## M1 — Cognitive data structures

**Architecture**
- `[P0] (9/10) src/structure-graph.ts:202` — `fullPropagation` (6-relation confidence propagation, M1.2 core) is **dead code**. Grep confirms the only callers are `structure-graph.test.ts`. The orchestrator never imports it. When a structure's confidence changes in production, **no relations propagate**.
- `[P0] (9/10) src/analysis/transcript-analyzer-v2.ts:137` — M1.5 extraction does not exist. Both analyzers emit `LearningEvent[]`, never a `ProtoStructure`. No production converter exists. Roadmap M1.5 `[x]` is false.
  - **Correction (codex; verified):** M1.5 extraction *interface* exists (`LLMSubsystem.extractProtoStructures`, `m0-deps.ts:54`) and is *called* at `session-end.ts:129`. Dead at runtime for **two** reasons: (a) `buildM0Deps()` never injects `deps.llm`; (b) no `LLMSubsystem` implementation exists (`LlmClient`/DeepSeek has only `analyze()`). Right symptom (no extraction fires), deeper root cause.
- `[P1] (8/10) src/structure-graph.ts:90` — per-hop `1/hop` attenuation invented, not in spec §3 (spec: `Δ × strength` only). Tests lock in the deviation.
- `[P1] (8/10) src/structure-graph.ts:215-219` — `fullPropagation` sums 5 traversals with no clamp; a structure linked by two relation types can receive compounded/uncapped deltas.
- `[P2] (7/10) src/structure-version.ts:88-96` — `rollback` truncates the chain but **does not restore field values**. Roadmap M1.4 "rollback 到 v1 → 恢复 v1 状态" is false.
- `[P2] (7/10) src/structure-graph.ts` — `precedes` relation has **no propagation function** (5 of 6 relations implemented). Comment defers to "Phase 2" which shipped without it.
- `[P3] (7/10) src/structure-lifecycle.ts:162` — module-global `verifier` singleton violates session isolation.

**Spec-gaps:** `precedes` propagation (silent omission); transcript→ProtoStructure extraction (silent omission); propagation applied to runtime confidence (silent omission); rollback field restoration (silent omission); confidence clamp after propagation (silent omission). 6 lifecycle states + dual-nature fields: ✅ present.

**Tests:** ~70% line / ~50% branch. ★★★ `structure-lifecycle`, `proto-constraint`; ★★ `structure-graph`, `structure-version`, `proto-task`, `recall-structure`; ★ `transcript-analyzer` v1/v2. **3 of 6 relations have zero direct tests** (`specializes`/`constrains`/`alternative_to`); `precedes` untested (no fn). Rollback tests assert chain length only, never field restoration (test-hidden gap).

---

## M2 — Context orchestration

**Architecture**
- `[P0] (10/10) src/session-start.ts:104-107` — pressure is **never measured in production**. Orchestrator calls `sessionStart.handle(sessionId)` with no opts → `estimatedUsedTokens` undefined → level always `"normal"`. Elevated/High/Critical are dead code. M2.2 adaptive compression never triggers.
- `[P0] (9/10) src/context-pressure-monitor.ts:25-31` — Normal threshold is `>250K` in code vs `>400K` in spec §7/§9. 400K threshold silently dropped.
- `[P0] (9/10) src/context-pressure-monitor.ts:18` — cognitive maturity (Novice/Competent/Expert) has **no mapping function**; `MaturityLevel` is a bare type, always `"competent"` in production. M2.4 two-axis (pressure × granularity) interaction not implemented — Critical+Expert yields *full* Tier A, opposite of spec's "极少量极高密度".
- `[P1] (9/10) src/memory/recall-structure.ts:52` — Critical Lazy Loading (`recallStructure`) **unwired** — only called by tests. No index build, no `recall_structure` tool registration under Critical.
- `[P1] (9/10) src/task-context.ts:90` — `applyProgress` (TaskContext auto-inference) **unwired** — never called by session-end. TaskContext never created in production.
- `[P1] (9/10) src/semantic-disambiguator.ts:79` — `disambiguate` **unwired** — `message-received.ts` does not import it.
- `[P2] (7/10) src/context-organizer.ts:142-152` — Tier B "compression" is actually proportional *truncation*, not compression.

**Spec-gaps:** pressure measurement (silent omission); 400K threshold (silent omission); maturity mapping (silent omission); two-axis interaction (silent omission); Critical Lazy Loading wiring (silent omission, roadmap acks "可用" only); TaskContext auto-inference (silent omission); semantic disambiguation wiring (silent omission). Tier weights 0.55/0.35/0.10 ✅; zombie/underestimation thresholds ✅.

**Tests:** 7 files, ~90 cases. ★★★ `context-pressure-monitor`, `attention-telemetry`, `task-context`, `scene-recognizer`; ★★ `context-organizer`, `semantic-disambiguator`, `recall-structure`. **Zero e2e tests** for Critical→Lazy Loading, pressure×maturity interaction, TaskContext wiring, disambiguation core behavior, Tier boundaries.

---

## M3 — Constraint system

**Architecture**
- `[P0] (10/10) src/commands/praxis-cli.ts:42` — `/praxis ontology` (M3.5) is a one-line stub `return "⚠️ /praxis ontology 尚未实现 (计划 M3.5)"`. Roadmap M3.5 ✅ is false. §13 defines a 5-section output; none exists. (`/praxis task` at line 46 is also stubbed.)
- `[P0] (9/10) src/constraint-validator.ts:54` — constraint matching is naive `lowerName.includes(pattern)` with no anchoring. `["rm"]` matches `confirm`/`form`/`normalize` (false-positive block); `["backup"]` does not match `db_snapshot` (false-negative). Wrong matching model for a safety engine.
- `[P1] (9/10) src/before-tool-call.ts:42` — `handle(sessionId, toolName)` drops `toolParams` (orchestrator line 168 receives `toolParams` but line 169 doesn't pass it). **Precondition constraints ("backup before migrate") are structurally unverifiable.** M3.1 verification scenario is impossible to satisfy.
- `[P1] (8/10) src/before-tool-call.ts` — `warn` severity cannot be expressed in the `proceed|inform|confirm|block` Result union; caller can't distinguish "warn fired" from "no constraint".
- `[P2] (8/10) src/constraint-injector.ts:74-78` — under Critical pressure the injector **drops** constraints (slice) rather than compressing, violating "约束段永远不压缩" (`proto-constraint.ts:86`) and §7 "Critical 下仍注入 ~100 tokens".
- `[P2] (7/10) src/session-start.ts:128` — `criticalConstraints` only built `if (amAvailable)`; degraded path loads `[]` → **constraints vanish exactly when running on local-cache fallback**. Violates §12 principle 5 (优雅降级).
- `[P1] (9/10) src/proto-constraint.ts:75` — `deprecateConstraint` mutates `tentativeName` by string-append (`[废弃: reason]`), corrupting the name used for matching/display. Stale "M4+ 升级" TODO; M4 shipped without fixing.
- **Performance:** `[P2] (8/10) src/before-tool-call.ts:80-90` — the `<10ms` invariant (M3.3) is **broken**: every violation does synchronous `getSlot`→append→`setSlot` (2 AgentMemory round-trips) in the hot path. JSDoc claims "<1ms 纯内存 Map" — inaccurate (linear scan + per-call string ops + I/O).

**Spec-gaps:** `/praxis ontology` (silent omission, roadmap false); precondition constraints (silent omission via signature); warn-in-Result (silent omission). M3.4 auto-extraction is a **model clean deferral** (interface reserved, documented) — the correct pattern. CRITICAL CONSTRAINTS injected before Tier A/B/C ✅; block returns rejection+constraintId ✅.

**Tests:** ★★★ `proto-constraint`; ★★ `constraint-injector`/`constraint-validator`/`before-tool-call`; ✗ `praxis-cli` (no test file). Critical-pressure injection test is a **sham** (passes default maxTokens, never tests low pressure). Constraint→before_tool_call integration wiring **0%** tested.

---

## M4 — Confidence system (the core of Praxis)

**Architecture — this milestone is largely a facade.**
- `[P0] (10/10) src/structure-lifecycle.ts:95` — QuineanGating is **never wired into `canCrystallize`**. The M1 stub `// 门控 3-5: 预留 (M4 实现)` is still present verbatim. `canCrystallize` checks only confidence≥0.8 + observations≥5. **A conf-0.85 zombie (never used) passes crystallization** — directly contradicting §3 line 217 and M4.4 acceptance. `QuineanGating` class exists (`quinean-gating.ts:59`) but is instantiated only in its test.
- `[P0] (10/10) src/session-end.ts:166-167 + src/agent-end.ts:98-99` — runtime fusion feeds **only `llm_marker` + `mid_session`** to the fuser (`const allSources = [...llmMarkerSources, ...(midSessionSources ?? [])]`). The 3 LLM-independent verifiers (Statistical/Role/Concept) are **never instantiated or fed** (grep: `new StatisticalVerifier`/`RoleVerifier`/`ConceptVerifier` only in test files). The "≥3 active sources" spec requirement is **structurally impossible** in production — only 2 source types ever flow, both LLM-derived.
- `[P0] (10/10) src/analysis/statistical-verifier.ts:113-117` — returns continuous `avgScore` (0.0-1.0), not the spec's **binary 1.0/0.0** (§4 M4.3 "一致→1.0, 不一致→0.0"). Returns 0.5 (not 0.0) on type-mismatch. The independence guarantee is not implemented.
- `[P0] (9/10) src/analysis/quinean-gating.ts:104-109` — sufficiency gate is an **absolute threshold** (`accuracyWithStructure >= 0.65`), not the spec's used-vs-unused comparison. A never-used zombie with seeded accuracy ≥0.65 passes.
- `[P0] (9/10) src/orchestration/confidence-fuser.ts:18-26` — `DEFAULT_WEIGHTS` deviate from spec §4 table (statistical 0.28 vs 0.25, concept 0.05 vs 0.08). Comment "吸收 concept 降权 0.03" — undocumented deviation. (Moot at runtime since neither source is wired, but breaks test/spec fidelity.)
- `[P1] (9/10) src/orchestration/confidence-fuser.ts:29` — `MIN_SOURCES = 2` vs spec ≥3. Allows fusing 2 LLM-derived sources — defeats the independence thesis even if verifiers were wired.
- `[P1] (8/10) src/cognitive/governor.ts:159` — Governor receives `fusedConfidence` as a parameter but **never calls the fuser or verifiers itself**; it's a classifier, not a fusion orchestrator. If the caller doesn't pass `fusedConfidence`, BATCH always DEFERs.
- `[P1] (8/10) src/analysis/concept-verifier.ts:54` — the adversarial LLM call IS real (`this.llm.analyze`) ✅ — but never invoked at runtime, and self-limits to confidence `[0.4,0.7]` so high-confidence (≥0.7) flawed concepts are never adversarially checked (the case that matters most).

**Spec-gaps (M4):** 7-source fusion end-to-end wiring (silent omission); QuineanGating gating crystallization (silent omission); sufficiency used-vs-unused (silent omission); StatisticalVerifier binary contract (silent omission); MIN_SOURCES (silent omission); weights (silent deviation). RoleVerifier "运行时越界检测" deferred to M6 (roadmap acks). `outcome_feedback`/`user_correction` runtime conversion partially deferred (M4.2 note "M5 完善").

**Tests:** ~60% line / ~35% behavioral. ★★★ `prediction-protocol`, `governor`; ★★ `confidence-fuser`, `statistical-verifier`, `quinean-gating`, `governor.integration`. **No test file** for `role-verifier`, `concept-verifier`, `curiosity-engine`, `structure-retirement`, `learning-loop`, `learning-update`, `execution-feedback`, `task-assessment`. Governor "degrade" test mislabeled (asserts happy path, not the catch branch). No zombie-rejection test. No redistribution-sums-to-1 assertion.

**Bottom line:** M4's headline claim is unrealized. The verifiers are theater: implemented, unit-tested in isolation, never connected. The fuser runs in production on 2 LLM-derived sources. QuineanGating exists but doesn't gate. The zombie guarantee fails. This is the core of Praxis, and it is not yet built *as a running system*.

  **Correction (codex; verified):** "the fuser runs in production on 2 sources" holds only in *tests*. In *production* (`phase1a-bridge.ts buildM0Deps()`), `deps.fuser` is undefined → the `if (this.deps.fuser && …)` guards short-circuit → **zero fusion runs at all**. The verifiers aren't merely unwired; there is no fuser to wire them to in the running system.

---

## M5 — Autonomous learning

**Architecture**
- `[P0] (9/10) src/cron-tick.ts:76` — **no external scheduler invokes `handleCronTick`**. The 30min guard is a dedup gate, not a scheduler; no `setInterval`/adapter fires it. All cross-session mining (M5.3) + StructuralGap detection (M5.4) are **dormant by default**. (Same host-dependence as M6 Meta Layer — see Theme 7.)
- `[P1] (9/10) src/analysis/mid-session-learner.ts:32-44` — §9 `mid_session_learner` config (`contradiction_threshold`, `max_immediate_penalty_per_session`) hardcoded as module constants; spec name `contradiction_threshold` absent from codebase; config never read from GovernancePolicy.
- `[P1] (8/10) src/cron-tick.ts:110` — decay uses `updatedAt` (last *modified*) not last *referenced*; spec §M5.3 "60天未引用" means used. A daily-used-but-unmodified structure is wrongly decayed. Attention telemetry (adoptionRate) not consulted.
- `[P1] (8/10) src/analysis/teleological-judge.ts:66` — hidden `0.5` per-postcondition keyword-coverage threshold not in spec (only 0.7 overall is spec'd) — undocumented tuning knob.
- `[P1] (8/10) src/agent-end.ts:118` — `deepCheck` awaited **sequentially** in a for-loop over `correctionPairs`; comment line 110 says "异步, 不阻塞" but it blocks `agent_end` for N×LLM latency (10 corrections × 3s = 30s).
- ✅ `[P3] (9/10)` — MidSessionLearner penalty cap (≤0.2) correctly enforced via `Math.min(penalty, MAX_SESSION_PENALTY - totalPenalty)`; hot path genuinely <10ms pure-rule (no await/LLM). ProtoTask log formula `0.2 + 0.15×log2(N+1)` matches spec exactly.

**M6-Fix verification (4 known M5 TODOs the roadmap says M6 fixed):**
- Fix-1 (deepCheck→agent_end): **FIXED** (caveat: blocking, not truly async — see above).
- Fix-2 (5 StructuralGap detectors→cron_tick): **FIXED with caveats** — Signal #2 mislabels `sessionId` as `scenarioId` (cron-tick.ts:211); Signal #5 reads `heartbeat_state.escalationCount` which **no writer populates** (data-starved).
- Fix-3 (before_tool_call audit_log writer): **FIXED** (10K cap, backward-compatible entries).
- Fix-4 (attentionRecords cross-session persistence): **FIXED** (session_end write + session_start restore round-trip).

**Spec-gaps:** `mid_session_learner` config wiring (silent omission); `cron_tick.interval_minutes:30` scheduler (silent omission); decay semantics (silent omission). MidSessionLearner in message_received + before_tool_call ✅; penalty cap ✅.

**Tests:** ~40% of M5 modules have test files. **No test file** for `proto-task-learner`, `gap-detector`, `praxis-audit`. `growConfidence` formula (load-bearing) has **zero tests**. `detectEscalationAnomaly` has only negative tests. Spec M5.1 verification case (3 corrections × 0.08 = 0.24 → capped 0.2) is **impossible by design** (per-structure dedup) and untested.

---

## M6 — Metacognition + adapters

**Architecture**
- `[P1] (9/10) src/adapters/openclaw-adapter.ts` vs `claude-code-adapter.ts` — the two adapters are **~90% copy-paste** (only `constraintId: "openclaw-block"` vs `"claude-code-block"` + cosmetic strings differ). No shared base. DRY violation; a 3rd adapter means copy #3.
- `[P1] (8/10) src/analysis/cross-agent-sync.ts:64,67` — `saveWithOptimisticLock` derives "our version" from `versionChain.length`, but the production writer (`session-end.ts`) saves structures without setting a `version` field. `ourVersion(1) <= currentVersion` triggers **spurious pending_merge**; the CAS is built on a version field no production path maintains.
- `[P1] (8/10) src/analysis/cross-agent-sync.ts:75` — the "CAS write" is a plain `setSlot` read-modify-write (**non-atomic**); two runtimes can both read version=0, both pass, both write → last-write-wins. Spec §6 "先提交者成功 → 后提交者进入 pending_merge" is **not enforced**.
- `[P1] (8/10) src/analysis/cross-agent-sync.ts:200-208` — `listPendingMerges` lookup keys (`pending_merge_${s.id}`) **never match** storage keys (`pending_merge_pending_merge_${id}_${ts}` — double prefix). `listPendingMerges` always returns `[]`.
- `[P1] (9/10) src/analysis/cross-agent-sync.ts` — **never instantiated in production** (`new CrossAgentSync` = zero hits). Roadmap acks this ("standalone module; 生产接线需 MemorySubsystem 扩展") — so it's deferred-by-design, **but the deferred code has the bugs above and zero tests**. M6.5 ✅ is not earned.
- `[P2] (8/10) src/cron-tick.ts:392-403` — Meta Layer "cron" (168h/720h) is interval-*gating*, not self-scheduling (same as M5 cron). Honored only if the host fires `cron_tick`.
- `[P2] (7/10) src/analysis/category-auditor.ts:311-321` — 铁律 #1 ("无新结构不经过人类审批") is respected **by omission** (no code auto-creates structures), but `category_proposals` slot is **write-only** — no consumer reads/approves. The gate holds by absence, not enforcement.
- `[P2] (7/10) src/analysis/category-auditor.ts:152-166` — Kantian data-vs-category fork uses `count<5` (spec says 3+) and a global-structures threshold, not per-pattern observation. Approximate.
- `[P2] (7/10) src/analysis/architecture-auditor.ts:137-143` — "4 audit dimensions" are effectively **3** (dimension 3 "self-consistency" = dimension 1 zombie-detection). `calcDecayRate` ignores its `auditLog` param.
- ✅ Adapters are pure protocol-conversion (no cognition) per §1. ✅ `/praxis status` (M6.4) reads real `competency_model`/`competency_snapshots`/`audit_log` data, degrades gracefully. ✅ M6.3 cross-adapter equivalence tested (4/8 events).

**Spec-gaps:** CrossAgentSync wiring (deferred, roadmap acks) but implementation buggy; `category_proposals` consumer (silent omission); auditor "4 dimensions" (silent omission = 3); Kantian fork thresholds (silent deviation). Adapter purity ✅; `/praxis status` ✅; 铁律 #1 upheld (by omission).

**Tests:** ★★★ `openclaw-adapter`, `claude-code-adapter`; ★★ `architecture-auditor`, `category-auditor`; ★ `platform-adapter` (M6 `acceptAdapterEvent` bridge **untested**); ✗ `cross-agent-sync`, `praxis-status`, `praxis-audit` (no test file). No negative test for 铁律 #1. M6.3 equivalence only 4/8 events.

---

## Holistic review — cross-cutting themes

**Theme 1 (the finding): "implemented-but-not-wired."** The dominant pattern. Functions exist, pass isolated unit tests, never run in production: M1 `fullPropagation`; M1 extraction; M2 `measurePressure`/maturity/`recallStructure`/`applyProgress`/`disambiguate`; M4 verifiers + QuineanGating; M5 cron scheduler; M6 CrossAgentSync + `category_proposals` consumer. The runtime system is the M0 pipeline + a few M3/M5/M6 patches; the "World Model" is a library beside it, not the running system.

**Theme 2: roadmap checkboxes systematically overstate reality.** At least 13 `[x]` are false in code: M1.2 (6 relations + propagation applied), M1.4 (rollback restores), M1.5 (extraction e2e), M2.2 (pressure switching + Lazy Loading), M2.4 (maturity granularity), M2.5 (TaskContext auto-inference), M2.6 (disambiguation), M3.5 (`/praxis ontology`), M4.2 (≥3 sources), M4.3 (verifier independent judgment), M4.4 (Quinean gating), M6.5 (cross-runtime lock). The "✅ 全部完成" banner is not a trustworthy status artifact.

**Theme 3: tests are co-located but wiring-blind.** 801 pass, but tests assert isolated functions do what they do — not that the system meets spec. The integration layer (does X get called in the real event path?) is ~0% covered. 9+ modules have no test file. Several "completion" tests are sham (M3 Critical-pressure injection; M1 rollback). The 801 count masks ~0 behavioral coverage on the highest-value paths.

**Theme 4: the LLM-independence thesis is unrealized.** M4 is Praxis's differentiator. In runtime: fuser gets `llm_marker` (from LLM) + `mid_session` (rule). The 3 independent verifiers are dead. QuineanGating doesn't gate. Confidence is still essentially LLM-self-eval with a mid-session rule overlay. The differentiator is on paper only.

**Theme 5: session isolation violated by process-global singletons.** `structure-lifecycle.ts:162` (`verifier`), `cognitive/proto-task.ts:60` (`cache` Map). CLAUDE.md says `core.createSession(id)` creates independent instances; the orchestrator does create per-session `SessionState` (good), but these singletons leak across sessions. Latent multi-session bug.

**Theme 6: graceful degradation drops safety guardrails.** M3: AgentMemory unavailable → `criticalConstraints` not built → `before_tool_call` loads `[]` → constraints vanish on the local-cache fallback (the path meant to be safe). M3: `audit_log` write failures silently swallowed → `/praxis audit` reports false-clean. Violates §12 principle 5.

**Theme 7: no external scheduler — the "active driving" layer is off by default.** `cron_tick` and Meta Layer 168h/720h are interval-*gates*, not self-scheduling. Nothing in src or the adapters fires `cron_tick` on a timer. So M5.3 cross-session mining, M5.4 StructuralGap detection, M6.1 Meta Layer audits, M5 ProtoTask plateau detection are all dormant unless the host runtime drives them — and no adapter does. L6 (autonomy) / §6 (active driving) is effectively off.

**Theme 8: the constraint engine is too weak to enforce safety.** M3 substring matching (no anchoring, no params) means block constraints both false-positive and false-negative. `before_tool_call` can't see `toolParams` so precondition constraints are impossible. §12 principle 4 ("事前约束") — the "stop the LLM before it errs" promise — is not actually enforced.

**Fairness (per first-principles honesty):** the *data model* is faithful (types, relations, lifecycle, dual-nature all present). The *M0 pipeline* is clean and well-structured. The *adapter layer* is the strongest part (pure, tested, equivalence-proven). MidSessionLearner's cap + hot path, ProtoTask's formula, and `/praxis status` are correct and live. The problem is not code quality in the small — it is *assembly*: the parts are not connected into the system the architecture describes.

---

## NOT in scope

- **M0 core runtime** — user scoped the review to M1–M6; M0 is context only. (M0 itself looks solid.)
- **Sibling projects** (`agentmemory/`, `hermes-agent/`, `openclaw/`) — out of scope; only referenced where Praxis integrates with them.
- **Rewriting the architecture** — the World Model design is not challenged as unsound; the gap is implementation-to-spec, not spec validity (subject to codex outside-voice below).
- **Performance at scale** (1000s of structures, 50+ sessions) — flagged where it will bite (propagation O(n×e), version chain unbounded, cron wildcard scans) but not deeply optimized; M1–M6 scale is small.

## Failure modes — critical gaps (no test AND no error handling AND silent)

1. **Zombie crystallization** (M4) — a high-confidence never-used structure crystallizes; no test, no gate, silent. *Critical gap.* (The exact failure QuineanGating exists to prevent.)
2. **Constraint drop on degradation** (M3) — AgentMemory down → all constraints vanish → forbidden operation runs; no test, no fallback, silent. *Critical gap.*
3. **Cron never fires** (M5/M6) — cross-session learning + Meta Layer audits never run; no alarm, silent. *Critical gap* (the system silently stops learning).
4. **CrossAgentSync pending_merge never resolves** (M6) — `listPendingMerges` always returns `[]`; merge conflicts accumulate invisibly; no test, silent. *Critical gap* (moot until wired, but the deferred code is broken).
5. **Precondition constraint false-negative** (M3) — `["prescribe"]` doesn't match `rx_issue` → block constraint silently fails → safety violation; no test, silent. *Critical gap.*

---

## Implementation Tasks

Synthesized from findings. P0 blocks the core thesis / safety; P1 should land before calling M1–M6 "done"; P2 is correctness/fidelity.

- [ ] **T1 (P0, human: ~3d / CC: ~30min)** — M4 — Wire the 3 LLM-independent verifiers into runtime fusion
  - Surfaced by: M4 Architecture — verifiers never instantiated/fed (session-end.ts:167, agent-end.ts:99)
  - Files: `src/session-end.ts`, `src/agent-end.ts`, `src/m0-deps.ts`, `src/analysis/statistical-verifier.ts`, `role-verifier.ts`, `concept-verifier.ts`
  - Verify: integration test that Statistical/Role/Concept sources reach the fuser; ≥3 active sources; fuser output reflects verifier disagreement.
- [ ] **T2 (P0, human: ~1d / CC: ~15min)** — M4 — Wire QuineanGating into `canCrystallize`
  - Surfaced by: M4 — `structure-lifecycle.ts:95` still M1 stub; zombie passes
  - Files: `src/structure-lifecycle.ts`, `src/analysis/quinean-gating.ts`
  - Verify: a conf-0.85 zombie with ≥5 observations but 0 usage is REJECTED; necessity/sufficiency/parsimony gates each exercised.
- [ ] **T3 (P0, human: ~2d / CC: ~20min)** — M2 — Wire real pressure measurement into the runtime
  - Surfaced by: M2 — `measurePressure` never called with real data; always "normal"
  - Files: `src/orchestrator.ts`, `src/session-start.ts`, `src/context-pressure-monitor.ts`
  - Verify: Critical pressure triggers Tier A summary + Lazy Loading e2e; Elevated/High/Critical each reachable from a real token estimate.
- [ ] **T4 (P0, human: ~2d / CC: ~25min)** — M3 — Make the constraint engine actually enforce safety
  - Surfaced by: M3 — substring matching + dropped `toolParams`
  - Files: `src/before-tool-call.ts`, `src/constraint-validator.ts`, `src/orchestrator.ts`, `src/proto-constraint.ts`
  - Verify: "backup before migrate" block scenario; `["rm"]` does NOT match `confirm`; `warn` is expressible in the Result.
- [ ] **T5 (P0, human: ~1d / CC: ~15min)** — M3 — Implement `/praxis ontology` per §13 (5-section output)
  - Surfaced by: M3 — `praxis-cli.ts:42` stub; roadmap M3.5 false
  - Files: `src/commands/praxis-cli.ts` (+ new module)
  - Verify: output matches §13 (crystallized/proto/subsistent/category system/confidence histogram).
- [ ] **T6 (P0, human: ~2d / CC: ~20min)** — M1 — Wire relation-graph propagation into the runtime confidence path + implement `precedes`
  - Surfaced by: M1 — `fullPropagation` dead code; `precedes` missing
  - Files: `src/session-end.ts`, `src/structure-graph.ts`
  - Verify: A depends_on B → B down → A down e2e; all 6 relations; remove `1/hop` deviation or document it.
- [ ] **T7 (P0, human: ~2d / CC: ~25min)** — M1 — Implement transcript→ProtoStructure extraction (M1.5)
  - Surfaced by: M1 — analyzers emit LearningEvent only
  - Files: `src/analysis/transcript-analyzer-v2.ts`
  - Verify: mock clinic transcript → ProtoSequence "挂号→分诊→问诊" extracted (conf 0.3-0.5).
- [ ] **T8 (P1, human: ~1d / CC: ~15min)** — M1 — Fix rollback to restore field values
  - Files: `src/structure-version.ts` (snapshot or diff-replay)
  - Verify: rollback to v1 restores `confidence`/`steps`/etc., not just chain length.
- [ ] **T9 (P1, human: ~2d / CC: ~20min)** — M5/M6 — Add an external cron scheduler (or document+enforce the host contract in adapters)
  - Surfaced by: Theme 7 — no scheduler fires `cron_tick`
  - Files: `src/cron-tick.ts`, `src/adapters/*`
  - Verify: `cron_tick` fires every 30min in a real runtime; Meta Layer 168h/720h honored.
- [ ] **T10 (P1, human: ~2d / CC: ~25min)** — M2 — Wire maturity mapping + `recallStructure` + `applyProgress` + `disambiguate`
  - Files: `src/session-start.ts`, `src/message-received.ts`, `src/session-end.ts`, `src/cognitive/scene-recognizer.ts`
  - Verify: each fires in its event path; two-axis (pressure×maturity) interaction test.
- [ ] **T11 (P1, human: ~2d / CC: ~20min)** — M6 — Fix CrossAgentSync (version contract, atomic CAS, key bug, tests) then wire OR mark explicitly deferred
  - Files: `src/analysis/cross-agent-sync.ts`, `src/session-end.ts`
  - Verify: first-wins/second-pending_merge test; `listPendingMerges` returns real merges.
- [ ] **T12 (P1, human: ~0.5d / CC: ~10min)** — M3 — Restore constraint injection under degradation (local-cache fallback)
  - Files: `src/session-start.ts`
  - Verify: degraded path still injects CRITICAL CONSTRAINTS.
- [ ] **T13 (P1, human: ~1d / CC: ~15min)** — Cross-cutting — Eliminate process-global singletons (verifier, proto-task cache) → per-session
  - Files: `src/structure-lifecycle.ts`, `src/cognitive/proto-task.ts`
  - Verify: multi-session isolation test.
- [ ] **T14 (P1, human: ~3d / CC: ~30min)** — Tests — Add test files for the 9 untested modules + wiring integration tests
  - Files: `role-verifier`, `concept-verifier`, `curiosity-engine`, `structure-retirement`, `proto-task-learner`, `gap-detector`, `praxis-audit`, `praxis-status`, `cross-agent-sync` + orchestrator wiring tests
  - Verify: coverage on the wiring layer (the current ~0%).
- [ ] **T15 (P1, human: ~0.5d / CC: ~10min)** — Correct ROADMAP.md checkboxes to reflect reality + add a "Wiring debt" section
  - Files: `docs/ROADMAP.md`
  - Verify: each `[x]` matches code; deferred items explicitly marked.
- [ ] **T16 (P2, human: ~1d / CC: ~15min)** — M4 — Fix StatisticalVerifier binary contract, `MIN_SOURCES=3`, restore spec weights
  - Files: `src/analysis/statistical-verifier.ts`, `src/orchestration/confidence-fuser.ts`
  - Verify: binary 1.0/0.0; ≥3 sources; weights match §4 table.
- [ ] **T17 (P2, human: ~0.5d / CC: ~10min)** — M2/M5 — Fix Normal threshold 400K; decay uses last-referenced; remove hidden 0.5 quickCheck threshold
  - Files: `src/context-pressure-monitor.ts`, `src/cron-tick.ts`, `src/analysis/teleological-judge.ts`
- [ ] **T18 (P2, human: ~1d / CC: ~15min)** — M6 — DRY the two adapters (shared base)
  - Files: `src/adapters/*`
- [ ] **T19 (P2, human: ~0.5d / CC: ~10min)** — M5 — Make `deepCheck` truly async (fire-and-forget/queue) in agent_end
  - Files: `src/agent-end.ts`
- [ ] **T20 (P2, human: ~0.5d / CC: ~10min)** — M3 — Pressure-aware constraint injection (never drop under Critical)
  - Files: `src/constraint-injector.ts`, `src/session-start.ts`

## Worktree parallelization strategy

The P0 tasks cluster into 4 largely-independent workstreams (different module trees, minimal shared files):

| Lane | Tasks | Modules touched | Depends on |
|------|-------|-----------------|------------|
| A (M4 core) | T1, T2, T16 | `analysis/` verifiers + `structure-lifecycle.ts` + `confidence-fuser.ts` | — |
| B (M3 safety) | T4, T5, T12, T20 | `before-tool-call.ts`, `constraint-*`, `commands/` | — |
| C (M1+M2 wiring) | T3, T6, T7, T8, T10, T17 | `structure-graph.ts`, `structure-version.ts`, `session-start.ts`, `transcript-analyzer*`, `context-*` | — |
| D (M5/M6 + cross-cutting) | T9, T11, T13, T18, T19 | `cron-tick.ts`, `cross-agent-sync.ts`, `adapters/`, `agent-end.ts` | — |

- **Launch A + B + C + D in parallel worktrees.** Conflict surface is small: A and C both touch `structure-lifecycle.ts`/`session-end.ts` indirectly (A via gating, C via propagation application in `session-end.ts`) — **flag: lanes A and C both touch `session-end.ts` fusion region; sequence the `session-end.ts` edits or coordinate.** B and D both touch `before-tool-call.ts`/`agent-end.ts` only loosely.
- T14 (tests) and T15 (roadmap) are cross-cutting — run *after* A–D merge (they test/document the merged result).
- T13 (singletons) touches `structure-lifecycle.ts` (also in A) — **flag: sequence T13 after lane A.**

**Execution order:** A+B+C+D parallel → merge → T14 + T15 → ship. Realistic: A and C are the longest poles (M4 core + M1/M2 wiring); B and D finish faster.

---

## Outside Voice (codex)

Source: `codex-cli 0.141.0`, read-only, `model_reasoning_effort=high`, ~126k tokens, ran against the repo root with the 11 headline findings and asked to (A) verify/refute each by reading the code, (B) find what was missed, (C) judge strategic miscalibration.

**Verification tally: 10 of 11 findings fully verified; Finding 2 verified in symptom but corrected in root cause. No finding was false. Codex judged the audit "accurate and, on coverage, conservative."**

### Findings codex added (B1–B7) — what the first-pass review missed

- **B1 (verified by me) — The production entry point never wires `M0Deps`, and never uses `EventOrchestrator`.** `phase1a-bridge.ts:367 buildM0Deps()` returns `{ memory, cache }` only — no `llm`, `fuser`, `attentionRecords`, `autonomyPolicy`. `new EventOrchestrator` appears **only in `orchestrator.test.ts`** (grep: zero production hits). Production calls `SessionStartHandler`/`SessionEndHandler` directly (`phase1a-bridge.ts:576`). Consequence: in production `deps.fuser`/`deps.llm` are undefined → the fuser never runs, no LLM extraction/deepCheck/cron-LLM runs, attention-telemetry persistence never activates. **This reframes the audit: the system the 801 tests exercise is not the system that runs.** Findings 8 & 9 were correct but *understated* — it is not "verifiers unwired," it is "the entire fuser/llm injection is absent at the real entry point."
- **B2 (verified by me) — `LLMSubsystem` is unimplementable by the real client.** `LLMSubsystem` (`m0-deps.ts:50-57`) requires `analyzeTranscript` + `extractProtoStructures`; `LlmClient` (`llm-client.ts`, DeepSeek) implements only `analyze()`. No adapter bridges them. M1.5 extraction is dead at two layers (no wiring + no implementation).
- **B3 (codex) — Tier A is never compressed, even under Critical.** `context-organizer.ts:155` applies `tierARetention`; the Critical strategy sets `tierARetention: 1.0` (`context-pressure-monitor.ts:90`). Spec §7 Critical = "structure index + `recall_structure`" (Tier A collapses to an index). It doesn't. Combined with `recallStructure` unwired (Finding 5), Critical has no pull path — Praxis either over-injects (full Tier A) or provides no retrieval; neither is the spec behavior.
- **B4 (codex) — `agent_end` fusion result is discarded.** `agent-end.ts:104-111` fuses, logs, sets `fusedCount=1`, then does nothing with `fused.confidence` — no structure is updated. Pure dead computation; misleading metric.
- **B5 (codex; NOT personally verified — line refs differ from M5 subagent's) — `transition()` return-value misuse in cron decay.** Cron calls `transition(s, "degrade")` on non-crystallized structures; `degrade` only exists from `crystallized`, so it no-ops and decay silently skips. Verify the exact lines before acting.
- **B6 (codex) — Two divergent type systems.** `cognitive/types.ts` ProtoStructure universe vs `platform-adapter`/`m0-deps` universe, bridged by `as unknown as ProtoStructure[]` casts (`orchestrator.ts:116`). AgentMemory-loaded structures lack `relations`/`versionChain`/`observationsCount` — verifiers would NPE on real data even if wired.
- **B7 (codex) — `CognitiveCore` still imported by the production bridge.** `phase1a-bridge.ts:16,68` imports/constructs `CognitiveCore` despite M0 claiming its removal. Live second code path; part of why wiring is fragmented.

### Strategic judgment (codex)

- The architecture's value proposition is the verifier loop; the code delivers none of it. What runs is "LLM extracts → LLM marks predictions → fuser blends 2 LLM-derived signals" = the LLM self-eval loop, relabeled.
- The roadmap measures the wrong thing: every checkbox tracks "module exists + unit tests pass," never "reachable from a production entry point." It is a *file-existence ledger*, not a *capability ledger*.
- **Simpler approach:** invert the milestone definition. Define "done" as "a real `session_start→session_end` run through `EventOrchestrator` with a fully-populated `M0Deps` produces a persisted, fused, verifiable ProtoStructure." One such integration test would have caught findings 4, 5, 8, 9, B1 in week one. **Highest-leverage fix:** make `buildM0Deps()` inject a real `LLMSubsystem` (wrapping `llmClient` with `extractProtoStructures`/`analyzeTranscript`) and a `ConfidenceFuser`, then add one `EventOrchestrator` e2e test asserting fused confidence + a persisted structure.

## Cross-Model Tension

**No cross-model tension — codex reinforced the review.** Codex verified 10/11 findings, called the audit "accurate and conservative," and extended it with B1–B7 (the two-system reframing). The one correction (Finding 2 root cause) is accepted — codex is right that M1.5 has an interface + call site, dead for deeper reasons than "no converter."

The single substantive divergence is **framing depth, not direction**: the first-pass verdict was "implemented-but-not-wired library around a live M0 pipeline." Codex's verified reframing is stronger: the M0 pipeline itself *isn't the production path* — production is `phase1a-bridge.ts` with a partial `M0Deps`, so even the "live pipeline" is test-only. This is accepted; the executive verdict and M4 bottom-line have been corrected above to reflect it.

Context I might be missing: whether `phase1a-bridge.ts` is intended as a temporary Phase-1A shim (the name suggests it) that will eventually route through `EventOrchestrator` — in which case the "two systems" gap is known migration debt, not an oversight. The user can clarify (see AskUserQuestion).

---

## Remediation applied (this session, 2026-06-27)

User authorized the highest-leverage fix (option D). Shipped + verified: `tsc --noEmit` clean; full suite **802 tests pass across 56 files** (was 801/55; +1 e2e test, no regressions).

1. **Source-flow bug fixed** — `src/orchestrator.ts` `handleAgentEnd` no longer clears `state.midSessionSources`; `session_end` (the unified fusion+persist point) now receives mid_session sources. Previously fusion starved to 1 source (`< MIN_SOURCES`) and never persisted — the mechanism behind codex's B4.
2. **`createVersion` robustness** — `src/structure-version.ts` now initializes a missing `versionChain` instead of throwing on summary objects (a B6 manifestation; the fusion loop calls `createVersion` on session_start-loaded summaries that lack `versionChain`).
3. **`buildM0Deps()` completed** — `src/phase1a-bridge.ts` now injects `ConfidenceFuser` + `memory.saveProtoStructure` + `attentionRecords` + an `llm` adapter (`analyzeTranscript` via `TranscriptAnalyzerV2`; `extractProtoStructures` via a conservative LLM-backed extractor with strict-JSON parse + `[]` fallback — never emits garbage; `analyze` via `llmClient`). Partially lights up M1.5 extraction (T7).
4. **e2e integration test added** — `src/orchestrator-fusion.integration.test.ts` proves a full `session_start→message→agent_end→session_end` run through `EventOrchestrator` with a fully-populated `M0Deps` **fuses + persists** a ProtoStructure. This is the "definition of done" test the review (and codex) identified as the missing guardrail.

**Still NOT fixed (next priorities — the e2e test now guards these):**
- **Production fusion still not live.** The bridge's `end` command still uses a partial `{analyzeTranscript, setSlot}` deps (not `buildM0Deps`), and the bridge is multi-process (each Claude Code hook = a separate `tsx` invocation), so `session_end` has no `injectedStructures` from `session_start`. Making production fusion live requires the **bridge→`EventOrchestrator` migration (T9 / Q1 oversight)** — a larger refactor. The e2e test proves the `EventOrchestrator` path works; production must route through it.
- M4 verifiers (Statistical/Role/Concept) still not wired to the fuser (T1); QuineanGating still not gating `canCrystallize` (T2); pressure/maturity/Lazy Loading/TaskContext/disambiguation still unwired (T3/T10); `/praxis ontology` still a stub (T5); relation propagation still dead (T6); cron scheduler still absent (T9); CrossAgentSync still broken+unwired (T11); ROADMAP checkboxes still overstated (T15).
- **B6 (data quality):** the `createVersion` guard prevents the throw, but the fusion loop still operates on *summaries* (not full structures), so `saveProtoStructure` persists a partial object. The right fix is for `session_start` to load full structures into `state.structures` — flagged as follow-up.

The e2e test is the load-bearing artifact: any future wiring change that breaks fusion+persist will now fail this test before shipping.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 11 verified findings + 7 codex findings (B1–B7); 5 critical gaps; 20 implementation tasks |
| Outside Voice | codex (plan review) | Independent 2nd opinion | 1 | issues_found | 10/11 verified, 1 corrected (accepted), 7 added; strategic two-system reframing |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a (no UI) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **CODEX:** verified 10/11 headline findings; corrected Finding 2 root cause (accepted); added B1–B7 (two-system reframing). Highest-leverage fix: inject real `LLMSubsystem` + `ConfidenceFuser` at `buildM0Deps()` + one `EventOrchestrator` e2e test.
- **CROSS-MODEL:** full agreement on direction; codex extended (not contradicted) the verdict. No tension to resolve.
- **VERDICT:** ENG REVIEW NOT CLEARED — eng review required. The M1–M6 "✅ 全部完成" roadmap is not a trustworthy status artifact: in production, confidence fusion, LLM extraction, relation propagation, pressure adaptation, and cross-agent sync do not run; 13+ completion checkboxes are false in code. Recommend: (1) correct `ROADMAP.md` to reflect runtime reality; (2) make the production entry point (`buildM0Deps` + `EventOrchestrator`) the thing tested e2e; (3) wire M4 verifiers + QuineanGating (the core thesis) before any further milestone work.

**UNRESOLVED DECISIONS:**
- Whether `phase1a-bridge.ts` is an intentional Phase-1A shim (known migration debt) or an oversight — determines whether the "two systems" gap is a tracked migration or a P0. Awaiting user (AskUserQuestion).
- Whether to (a) correct the roadmap checkboxes now, (b) build a wiring-remediation plan (buildM0Deps injection + T1–T3), or (c) cut speculative inventory — awaiting user decision (AskUserQuestion).
- Codex B5 (cron `transition()` misuse) reported but not personally verified — needs a direct read before action.
