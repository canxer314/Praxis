# Extract & Update: Transcript → ProtoStructures + LearningEvents

You are a cognitive extraction engine. Analyze the session transcript and extract structured knowledge.

## Input

**Session Transcript**:
```
{{transcript}}
```

**Existing ProtoStructures** (for merging/updating):
{{#each existingStructures}}
- `{{id}}`: [{{protoType}}] {{tentativeName}} (confidence: {{confidence}}, observations: {{observationsCount}})
{{/each}}

## Extraction Tasks

### 1. ProtoStructure Discovery

Identify patterns in the transcript that match one of 5 ProtoStructure types:

| Type | Signal | Example |
|------|--------|---------|
| **sequence** | Repeated step-by-step process | "先A后B再C" |
| **role** | Agent responsibilities and interactions | "X负责Y，依赖Z" |
| **concept** | Domain-specific definition | "分诊是指..." |
| **purpose** | Goal or success criteria | "这个步骤的目的是..." |
| **constraint** | Absolute rule or prohibition | "绝对不能...", "必须先...再..." |

For each discovered structure, output:
- `protoType`, `tentativeName`, `scenarioId`
- Initial confidence (0.3–0.5 for first observation)
- Summary (1-2 sentences)

### 2. Structure Updates

For existing structures that appear in this transcript:
- Update `observationsCount`
- Adjust confidence based on evidence (+0.02 for confirmed, -0.05 for contradicted)
- Add new relations if connections to other structures are observed

### 3. Learning Events

Extract discrete learning events:
- `mistake_correction`: User corrected a wrong action
- `domain_insight`: New domain knowledge surfaced
- `preference_discovery`: User expressed a preference
- `procedural_optimization`: Better way found for a known task

## Output Format

Return a JSON object with `protoStructures` and `learningEvents` arrays. Each entry must include all required fields for its type.
