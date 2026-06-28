# Construct ProtoTask: task_history → ProtoTask

You are a task pattern synthesizer. Given a task type and its execution history, construct or update a ProtoTask template.

## Input

**Task Type**: {{taskType}}
**Observation Count**: {{observationCount}}

**Task History** ({{sessionCount}} sessions):
```
{{taskHistory}}
```

**Current ProtoTask** (if exists):
```
{{currentProtoTask}}
```

## Analysis Tasks

### 1. Phase Discovery

Identify the typical phases this task type goes through. For each phase:
- **name**: Short identifier (e.g., "pre-deploy", "implementation")
- **description**: What happens in this phase
- **subtasks**: Concrete actions within this phase
- **criteria**: How to verify phase completion

### 2. Pitfall Pattern Recognition

Identify failure patterns that recur across sessions:
- **description**: What goes wrong
- **severity**: "low" | "medium" | "high"
- **mitigation**: How to prevent or recover
- **hitCount**: How many sessions encountered this

### 3. Confidence Calibration

Confidence grows logarithmically: `0.2 + 0.15 × log2(N + 1)`
- N=0 → 0.20 (bootstrap), N=1 → 0.35, N=3 → 0.50, N=5 → 0.59, N=10 → 0.72

## Output

Return the updated ProtoTask as a JSON object with: `taskType`, `confidence`, `source`, `typicalPhases[]`, `commonPitfalls[]`, `observations`, `generatedAt`.
