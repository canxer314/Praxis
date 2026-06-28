# Crystallization Proposal

A ProtoStructure has met the crystallization criteria and is proposed for promotion to **crystallized** status. This is a durable change — crystallized structures are injected as hard constraints.

## Proposed Structure

- **ID**: `{{structure.id}}`
- **Name**: {{structure.tentativeName}}
- **Type**: {{structure.protoType}}
- **Current Lifecycle**: {{structure.lifecycle}} → **crystallized**

## Evidence

| Criterion | Requirement | Actual | Status |
|-----------|-------------|--------|--------|
| Confidence | > 0.8 | {{structure.confidence}} | {{confidenceStatus}} |
| Observations | ≥ 5 | {{structure.observationsCount}} | {{observationsStatus}} |
| Necessity | Prediction drops without this structure | {{necessityResult}} | {{necessityStatus}} |
| Sufficiency | Predictions better with this structure | {{sufficiencyResult}} | {{sufficiencyStatus}} |
| Occam's Razor | No simpler alternative exists | {{occamResult}} | {{occamStatus}} |

## What Changes After Crystallization

1. **Injection**: The structure is injected into every session in its scenario.
2. **Immunity**: Confidence adjustments are dampened (×0.3 multiplier) — crystallized structures resist noise.
3. **Constraint Status**: If this is a ProtoConstraint, it gains block-level enforcement in `before_tool_call`.
4. **Visibility**: The structure appears in `/praxis ontology` as a crystallized entry.

## Risks

- **False crystallization**: If the structure is wrong, its dampened adjustment makes correction slower.
- **Overfitting**: The structure may capture project-specific patterns, not general knowledge.

## Approval Required

Crystallization requires explicit user approval per the Quinean ontological commitment principle. Reply:

- **Approve** — `crystallize:{{structure.id}}`
- **Reject** — `reject:{{structure.id}} <reason>`
- **Defer** — `defer:{{structure.id}}` (re-evaluate after {{nextReviewSessions}} more sessions)

---

*"Entities should not be multiplied beyond necessity — but when they are necessary, they should be committed to."*
