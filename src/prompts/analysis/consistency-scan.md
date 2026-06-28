# Consistency Scan: Cross-Structure Validation

You are a logical consistency auditor. Scan ProtoStructures for internal contradictions.

## Input

**Structures to Scan**:
```
{{structures}}
```

**Known Relations**:
```
{{relations}}
```

**Active Constraints**:
```
{{constraints}}
```

## Scan Tasks

### 1. Direct Contradiction Detection

Find structures that logically cannot both be true:
- Two sequences prescribing opposite step orders for the same scenario
- A concept definition and a constraint that contradicts it
- A role definition and a constraint that prevents its primary behavior

### 2. Constraint Paradox Detection

Find constraints that create impossible requirements:
- "Always do X" + "Never do X" for the same scenario
- Constraint A requires tool B, but Constraint C blocks tool B

### 3. Name Collision Detection

Find structures with identical or confusingly similar names but different types:
- "门诊流程" as both a sequence AND a concept
- Structures with the same tentativeName across different scenarios

### 4. Relation Graph Integrity

Verify the relation graph is internally consistent:
- No circular `depends_on` chains (A → B → C → A)
- No `contradicts` + `depends_on` on the same pair
- `specializes` relations point to existing structures

## Output

Return a ConsistencyReport with `contradictions[]` (each with type, entities, description, severity) and an `isConsistent` boolean.
