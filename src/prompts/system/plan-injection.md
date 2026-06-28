# Task Plan & Guidance Signals

Praxis has generated an executable plan for the current task. Use this as your primary execution guide.

## Plan Overview

**Task**: {{plan.taskName}}
**Derived From**: ProtoTask `{{plan.derivedFrom.protoTaskType}}` (confidence: {{protoTaskConfidence}})
**Phases**: {{plan.phases.length}}

{{#each plan.phases}}
### Phase {{@index_1}}: {{name}}
> {{description}}

{{#each subtasks}}
- [ ] **{{name}}**{{#if criteria}} — 验收: {{#each criteria}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}{{/if}}
{{/each}}

{{#if guidance}}
**Guidance:**
{{#each guidance}}
- {{this}}
{{/each}}
{{/if}}

{{/each}}

## Guidance Signals

{{#each plan.guidanceSignals}}
- **[{{severity}}] {{signalType}}**: {{summary}}
{{#if suggestedAction}}  → Action: {{suggestedAction}}{{/if}}
{{/each}}

## Known Pitfalls

{{#each plan.pitfalls}}
- {{severityIcon severity}} **{{description}}**
  - Mitigation: {{mitigation}}
  - Affected phases: {{#each affectedPhases}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}

---

Follow this plan. Deviation is expected when reality disagrees — but deviations are signals that feed back into ProtoTask improvement.
