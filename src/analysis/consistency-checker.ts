/**
 * analysis/consistency-checker.ts — 跨结构一致性验证
 *
 * 检测 ProtoStructure 之间的逻辑矛盾:
 *   - known_contradiction: contradicts 关系
 *   - constraint_paradox: 两个约束不能同时满足
 *   - name_collision: 同名不同型
 *
 * 架构参考: §8 Meta Layer, §11 analysis/consistency-checker.ts
 */

export interface ConsistencyCheckInput {
  structures: ConsistencyStruct[];
  constraints: ConsistencyConstraint[];
  knownRelations?: ConsistencyRelation[];
}

export interface ConsistencyStruct {
  id: string;
  tentativeName: string;
  protoType: string;
  confidence: number;
  lifecycle: string;
}

export interface ConsistencyConstraint {
  id: string;
  description: string;
  severity: "block" | "confirm" | "warn";
}

export interface ConsistencyRelation {
  fromId: string;
  toId: string;
  type: string;
  strength: number;
}

export interface ConsistencyReport {
  contradictions: Contradiction[];
  isConsistent: boolean;
  summary: string;
}

export interface Contradiction {
  type: "known_contradiction" | "constraint_paradox" | "name_collision";
  entities: string[];
  description: string;
  severity: "warning" | "critical";
  reason?: string;
}

export function checkConsistency(input: ConsistencyCheckInput): ConsistencyReport {
  const contradictions: Contradiction[] = [];

  // 1. Known contradicts relations
  if (input.knownRelations) {
    for (const rel of input.knownRelations) {
      if (rel.type === "contradicts" && rel.strength > 0.5) {
        contradictions.push({
          type: "known_contradiction",
          entities: [rel.fromId, rel.toId],
          description: `Known contradiction between ${rel.fromId} and ${rel.toId} (strength: ${rel.strength})`,
          severity: "warning",
        });
      }
    }
  }

  // 2. Constraint paradox detection (simple: conflicting keywords)
  for (let i = 0; i < input.constraints.length; i++) {
    for (let j = i + 1; j < input.constraints.length; j++) {
      if (areConstraintsParadoxical(input.constraints[i]!, input.constraints[j]!)) {
        contradictions.push({
          type: "constraint_paradox",
          entities: [input.constraints[i]!.id, input.constraints[j]!.id],
          description: `Paradoxical constraints: "${input.constraints[i]!.description}" vs "${input.constraints[j]!.description}"`,
          severity: "critical",
        });
      }
    }
  }

  // 3. Name collisions
  const nameMap = new Map<string, ConsistencyStruct[]>();
  for (const s of input.structures) {
    const existing = nameMap.get(s.tentativeName) ?? [];
    existing.push(s);
    nameMap.set(s.tentativeName, existing);
  }
  for (const [, structs] of nameMap) {
    if (structs.length > 1) {
      const types = [...new Set(structs.map((s) => s.protoType))];
      if (types.length > 1) {
        contradictions.push({
          type: "name_collision",
          entities: structs.map((s) => s.id),
          description: `Structures with same name "${structs[0]!.tentativeName}" but different types: ${types.join(", ")}`,
          severity: "warning",
        });
      }
    }
  }

  const summary = contradictions.length === 0
    ? "All structures are consistent. No contradictions found."
    : `${contradictions.length} contradiction(s) found: ${contradictions.map(c => c.description).join("; ")}`;

  return { contradictions, isConsistent: contradictions.length === 0, summary };
}

export interface NameCollision {
  ids: string[];
  name: string;
  types: string[];
  reason: string;
}

export function findContradictions(structs: ConsistencyStruct[]): NameCollision[] {
  const collisions: NameCollision[] = [];
  const nameMap = new Map<string, ConsistencyStruct[]>();

  for (const s of structs) {
    const existing = nameMap.get(s.tentativeName) ?? [];
    existing.push(s);
    nameMap.set(s.tentativeName, existing);
  }

  for (const [name, items] of nameMap) {
    if (items.length > 1) {
      const types = [...new Set(items.map((s) => s.protoType))];
      if (types.length > 1) {
        collisions.push({
          ids: items.map((s) => s.id),
          name,
          types,
          reason: `Name "${name}" used for multiple protoTypes: ${types.join(", ")}`,
        });
      }
    }
  }

  return collisions;
}

// ══════════════════════════════════════════════════════════════════
// Internal
// ══════════════════════════════════════════════════════════════════

const PARADOX_PAIRS: Array<[string, string]> = [
  ["always", "never"],
  ["monolith", "microservice"],
  ["strict", "flexible"],
  ["sync", "async"],
];

function areConstraintsParadoxical(
  a: ConsistencyConstraint,
  b: ConsistencyConstraint,
): boolean {
  const aLower = a.description.toLowerCase();
  const bLower = b.description.toLowerCase();
  for (const [k1, k2] of PARADOX_PAIRS) {
    if (aLower.includes(k1) && bLower.includes(k2)) return true;
    if (aLower.includes(k2) && bLower.includes(k1)) return true;
  }
  return false;
}
