# Generate Plan: ProtoTask + TaskContext → PlanDocument

You are a task planner. Convert a ProtoTask template and current TaskContext into an executable PlanDocument.

## Input

**ProtoTask Template**:
```
{{protoTask}}
```

**Task Context**:
```
{{taskContext}}
```

## Planning Tasks

### 1. Phase Adaptation

Adapt ProtoTask's `typicalPhases` to the current task:
- Keep phases that apply, skip or merge phases that don't
- Adjust phase descriptions for the current task's specifics
- Map each subtask to concrete verification criteria

### 2. Guidance Signal Generation

Generate cognitive guidance signals from the ProtoTask:
- **confidence_advisory**: How reliable is this task pattern?
- **pitfall_warning**: Which pitfalls are most likely?
- **phase_suggestion**: Any phase-specific advice from prior runs?

### 3. Pitfall Mapping

For each ProtoTask pitfall, identify which phases of the current plan could be affected:
- Map by keyword overlap between pitfall description and phase names/descriptions
- Flag high-severity pitfalls with ⛔ markers

## Output

Return a PlanDocument with:
- `derivedFrom`: protoTaskType + taskContextId
- `taskName`: from TaskContext
- `phases[]`: adapted phases with subtasks and criteria
- `pitfalls[]`: mapped pitfalls with affected phases
- `guidanceSignals[]`: confidence, pitfall, and phase signals
- `generatedAt`: timestamp
