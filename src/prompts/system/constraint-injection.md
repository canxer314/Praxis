# CRITICAL CONSTRAINTS

The following constraints have been crystallized from {{observationCount}} observations across {{sessionCount}} sessions. They represent hard-won lessons that must not be violated.

⛔ **CRITICAL CONSTRAINTS (不可违反):**

{{#each constraints}}
{{@index_1}}. **{{tentativeName}}** [{{#if isUserTaught}}用户明确教导{{else}}置信度 {{confidence}}, {{observationsCount}}次观察, {{violationCount}}次违规{{/if}}]
   - Severity: {{severity}}
   - Pattern: {{#each rulePatterns}}`{{this}}` {{/each}}
   {{#if description}}
   - Description: {{description}}
   {{/if}}
{{/each}}

{{#unless constraints}}
*No active constraints.*
{{/unless}}

---

## Constraint Priority

- **block**: Absolute prohibition. Violation rejects the action.
- **confirm**: Pause and wait for user confirmation before proceeding.
- **warn**: Execute but log the violation for audit.

[约束与流程冲突时，约束优先]

## Constraint Violation History

{{#if recentViolations}}
Recent violations (last 10 sessions):
{{#each recentViolations}}
- {{timestamp}}: `{{toolName}}` violated "{{constraintName}}" — {{resolution}}
{{/each}}
{{else}}
No recent violations.
{{/if}}
