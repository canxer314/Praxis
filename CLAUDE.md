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

## 0. Think from first principles

start from raw requirements and the essence of the problem:

Don't assume the user has already thought it through. When the user's motivation or goal is unclear, stop and discuss it with me.
When the goal is clear but the path isn't optimal, say so directly and offer a better approach.
Trace problems to their root cause — don't patch over symptoms. Every decision should have a clear answer to "why this way."
Get to the point. Cut everything that doesn't affect the decision.

---

*A Short List of Rules, Earned by Watching the Same Mistakes Twice*

---

**Abstract.** This file exists because language models make predictable mistakes when they write code. Not random mistakes, just the same ones, over and over, often enough that it was worth writing them down. What follows is not a set of suggestions but a set of rules. The throughline is the same in every section: the model is fast at generating plausible code and slow to notice that plausible is not the same as correct, so the discipline has to come from the process around it.

**Index Terms.** LLM-assisted programming, code review, software craftsmanship, minimal diffs, debugging, dependency hygiene.

---

## I. READ BEFORE YOU WRITE

The biggest source of bad model-written code is writing before reading the codebase. Read the files you are about to touch; read, not skim. Copy the patterns that already exist, and check the imports to see what the project actually depends on, so you do not reach for axios where everything is fetch. When you cannot find a pattern, ask instead of guessing.

## II. THINK BEFORE YOU CODE

Figure out what you are doing before you type. State your assumptions ("add authentication" is five different things, so name the one you picked) and name the tradeoffs. If something is genuinely confusing, stop and ask rather than filling the gap with plausible-looking code; that is exactly the code that passes a casual review and fails when it matters.

## III. SIMPLICITY

Write the minimum code that solves the problem in front of you now, not the minimum that could solve every future version of it. Resist premature abstraction, skip error handling for errors that cannot occur, and hardcode values until there is a real reason to configure them. The test: if the only reason something is abstracted is "in case we need to," you have over-built it.

## IV. SURGICAL CHANGES

Your diff should be as small as the task allows. Do not touch what you were not asked to touch, match the existing style, and do not reformat; a formatter pass buries the three lines that matter inside three hundred that do not. The test is whether you can justify every changed line by the task. If a line is there because "while I was in there," revert it.

## V. VERIFICATION

The gap between code that works and code you think works is testing. When fixing a bug, write the failing test first, watch it fail, then fix it; that is the only proof you fixed the cause and not the symptom. Test behavior that can actually break, not that a constructor sets a field. If something is hard to test, that is information about the design, not permission to skip it.

## VI. GOAL-DRIVEN EXECUTION

Every task needs a success criterion before code is written. "Add validation" becomes "reject a missing or malformed email, return 400 with a clear message, and test both cases." For anything multi-step, state the plan first so the user can catch a wrong approach before you spend an hour building it.

## VII. DEBUGGING

When something breaks, investigate; do not guess. Read the whole error and the stack trace, reproduce the problem before you change anything, and change one thing at a time. Do not paper over an unexpected null with a null check; find out why it is null, or the bug just moves somewhere quieter.

## VIII. DEPENDENCIES

Every dependency is permanent code you do not control. Before adding one, ask whether the project or the standard library can already do it with `crypto.randomUUID()` over a uuid package. When you do add one, say why, so the choice is visible rather than smuggled into the manifest.

## IX. COMMUNICATION

Say what you did and why, not just a block of code. Flag concerns even when you did exactly what was asked, and be precise about uncertainty: "I am not sure this library supports streaming" tells the user what to verify; "I think this should work" does not.

## X. COMMON FAILURE MODES

A few patterns recur often enough to name: the *Kitchen Sink* (restructuring half the codebase while you are at it), the *Wrong Abstraction* (copy-paste twice before you abstract), the *Optimistic Path* (the happy path handled and the 500 ignored), and the *Runaway Refactor* (a fix that cascades across files). Catch yourself in any of these and the right move is to stop, not to push through.

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
