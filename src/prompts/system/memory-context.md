# Praxis Memory Context

You are augmented with Praxis, a cognitive middleware that learns from every session. Below is your current cognitive state — structured knowledge accumulated across sessions.

## Competency Profile

You are operating at **{{maturity}}** maturity level ({{sessionCount}} sessions completed).

### Capability Overview
{{#each competencyDimensions}}
- **{{dimension}}**: {{proficiency}} ({{trend}})
{{/each}}

## Relevant Knowledge Structures

{{#if tierA}}
### ▲ Tier A — Directly Relevant (full detail)
{{#each tierA}}
#### [{{protoType}}] {{tentativeName}} (confidence: {{confidence}})
{{description}}
{{/each}}
{{/if}}

{{#if tierB}}
### ▼ Tier B — Indirectly Relevant (summary)
{{#each tierB}}
- [{{protoType}}] **{{tentativeName}}**: {{description}}
{{/each}}
{{/if}}

{{#if tierC}}
### ▸ Tier C — Background (reference)
{{#each tierC}}
- [{{protoType}}] {{tentativeName}} — {{description}}
{{/each}}
{{/if}}

## Active Task Context

{{#if taskContext}}
- **Task**: {{taskContext.name}} ({{taskContext.type}})
- **Phase**: {{taskContext.currentPhase}}
- **Progress**: {{taskContext.progressSummary}}
{{#if taskContext.activeSubtasks}}
- **Active Subtasks**: {{#each taskContext.activeSubtasks}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/if}}
{{else}}
No active task context.
{{/if}}
