# Critical Mode — Minimal Injection Format

Context pressure is **CRITICAL** (< 50K tokens remaining). Standard injection is suspended. This is the emergency format.

## What You Get

1. **Structure Index** — names and IDs only (no details)
2. **Block-level Constraints** — absolute prohibitions only (confirm/warn dropped)
3. **Current Task Phase** — one line

## What You Can Do

Use `recall_structure("<structure_id>")` to pull full details on demand. The structures exist — they're just not pre-loaded.

## Active Structure Index

{{#each structures}}
- `{{id}}`: {{tentativeName}} [{{protoType}}] ({{confidence}})
{{/each}}

## Active Block Constraints

{{#each blockConstraints}}
- ⛔ {{tentativeName}}: {{#each rulePatterns}}`{{this}}` {{/each}}
{{/each}}

{{#unless blockConstraints}}
*No block-level constraints active.*
{{/unless}}

## Current Task

{{taskName}} — Phase: {{currentPhase}}

---

**Tokens remaining: ~{{remainingK}}K** | Recall any structure by ID. Prioritize block constraints over all other guidance.
