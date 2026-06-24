# CLAUDE.md

## Praxis 项目上下文

**Praxis** 是 AI 认知操作系统 — 在 LLM 与外部世界之间的中间件，赋予 AI 跨会话记忆、学习和任务编排能力。

### 架构
- **六层架构**: L1 工具集成 → L2 任务编排 → L3 知识管理 → L4 学习闭环 → L5 能力模型 → L6 自主决策
- **核心模块**: `src/cognitive/` — CognitiveCore, Governor, TaskStateMachine, ProtoTask, TaskScheduler, SubagentManager, HeartbeatMonitor, SceneRecognizer, SignalDetector
- **完整设计**: `architech/praxis-architecture.md` (V1-V13 架构迭代)
- **原始迭代**: `draft/V1/` 到 `draft/V13/`

### 关键概念
- **Result\<T\>**: 所有异步 API 返回 `{ ok: true, value: T } | { ok: false, error: {...} }`，调用方通过 `result.ok` 分支
- **Session 隔离**: `core.createSession(id)` 为每个会话创建独立的 CognitiveCore 实例
- **学习环路**: 任务评估(assessTask) → 执行反馈(captureCorrection) → 学习更新(finalizeLearning)
- **ProtoTask**: 零样本任务模板，bootstrap 置信度 0.2，随项目积累成长
- **任务状态机**: 两层嵌套 — 外层(任务级 7 状态) + 内层(子任务级 4 状态+中间态)

### 测试
- `npm test` — vitest run
- `npm run typecheck` — tsc --noEmit

### 架构文档
- 完整架构: `architech/praxis-architecture.md`
- 原始迭代: `draft/` (V1-V13, 每版本 ~6 文件: what/why/how/when/where/who + design)

---

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.
## 0. Think from first principles

start from raw requirements and the essence of the problem:

Don't assume the user has already thought it through. When the user's motivation or goal is unclear, stop and discuss it with me.
When the goal is clear but the path isn't optimal, say so directly and offer a better approach.
Trace problems to their root cause — don't patch over symptoms. Every decision should have a clear answer to "why this way."
Get to the point. Cut everything that doesn't affect the decision.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.


## 5. Use the model only for judgment calls
Use me for: classification, drafting, summarization, extraction.
Do NOT use me for: routing, retries, deterministic transforms.
If code can answer, code answers.

## 6. Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh.
Surface the breach. Do not silently overrun.

## 7. Surface conflicts, don't average them
If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## 8. Read before you write
Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

## 9. Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## 10. Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back.
If you lose track, stop and restate.

## 11. Match the codebase's conventions, even if you disagree
Conformance > taste inside the codebase.
If you genuinely think a convention is harmful, surface it. Don't fork silently.

## 12. Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## gstack

gstack provides specialized skills for QA, code review, design, planning, deployment, and more. See `~/.claude/skills/gstack/SKILL.md` for the full reference.

**Web browsing:** Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools — they are slow and unreliable compared to gstack's headless browser.

### Available skills

| Skill | Purpose |
|-------|---------|
| `/office-hours` | Product ideas, brainstorming, pitch evaluation |
| `/plan-ceo-review` | Strategy, scope, ambition review |
| `/plan-eng-review` | Architecture and engineering plan review |
| `/plan-design-review` | Design review of a plan |
| `/design-consultation` | Design system, brand, visual identity |
| `/design-shotgun` | Generate multiple AI design variants for comparison |
| `/design-html` | Generate production-quality HTML/CSS |
| `/review` | Code review and diff check |
| `/ship` | Create PR and ship changes |
| `/land-and-deploy` | Merge + deploy + verify as one flow |
| `/canary` | Post-deploy monitoring |
| `/benchmark` | Performance regression detection |
| `/browse` | Headless browser for QA testing and dogfooding |
| `/connect-chrome` | Launch headed Chromium for interactive testing |
| `/qa` | Full QA testing workflow |
| `/qa-only` | QA testing without fixes |
| `/design-review` | Visual design audit of live site |
| `/setup-browser-cookies` | Import cookies for authenticated testing |
| `/setup-deploy` | Configure deployment for the project |
| `/setup-gbrain` | Set up GBrain integration |
| `/retro` | Weekly retrospective |
| `/investigate` | Systematic debugging and root cause analysis |
| `/document-release` | Post-ship documentation update |
| `/document-generate` | Generate documentation from scratch |
| `/codex` | OpenAI Codex CLI wrapper |
| `/cso` | Security review |
| `/autoplan` | Full auto-review pipeline |
| `/plan-devex-review` | Developer experience plan review |
| `/devex-review` | Live developer experience audit |
| `/careful` | Safety guardrails for destructive commands |
| `/freeze` | Restrict edits to a directory |
| `/guard` | Full safety mode |
| `/unfreeze` | Remove directory edit restrictions |
| `/gstack-upgrade` | Upgrade gstack to latest version |
| `/learn` | View gstack learnings |

**Routing:** When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill — a false positive is cheaper than a false negative.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
