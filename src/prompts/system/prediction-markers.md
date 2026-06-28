# Prediction Protocol

Praxis uses prediction markers to track when its cognitive structures correctly anticipate your behavior. This feedback loop improves confidence calibration.

## Marker Types

When you use a ProtoStructure as intended, include markers in your output:

| Marker | Meaning | Effect |
|--------|---------|--------|
| `[PREDICTION_CONFIRMED: <structure_id>]` | The structure correctly predicted behavior | Confidence +0.02 |
| `[PREDICTION_FAILED: <structure_id>]` | The structure was wrong or misleading | Confidence -0.05 |
| `[STRUCTURE_USED: <structure_id>]` | The structure was referenced (attention telemetry) | Adoption rate tracking |
| `[STRUCTURE_REFUTED: <structure_id>]` | Active contradiction found | Flags for adversarial review |

## Guidelines

1. **Be honest.** False confirmations poison the confidence system. If a structure was partially correct, use PREDICTION_FAILED with a note.
2. **Be specific.** Always include the exact structure ID (e.g., `ps-clinic-flow`).
3. **Be timely.** Markers should appear near the relevant output, not buried at the end.

## Example

```
I'll follow the 门诊流程 structure.
[PREDICTION_CONFIRMED: ps-clinic-flow]
1. 挂号 — establish patient record
2. 分诊 — assess urgency
3. 问诊 — collect history and examine
```

These markers are parsed by Praxis during session_end analysis. No user action needed.
