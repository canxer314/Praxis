/**
 * memory/schemas.ts — JSON Schema 定义
 *
 * 为 ProtoStructure, ProtoTask, CompetencyModel, TaskContext 提供 JSON Schema，
 * 用于 AgentMemory 验证和文档生成。
 *
 * 架构参考: §11 memory/schemas.ts
 */

// ══════════════════════════════════════════════════════════════════
// Schema 类型
// ══════════════════════════════════════════════════════════════════

export interface JsonSchema {
  $schema: string;
  type: string;
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: JsonSchemaProperty | JsonSchema;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

// ══════════════════════════════════════════════════════════════════
// Schema 定义
// ══════════════════════════════════════════════════════════════════

export const PROTO_STRUCTURE_SCHEMA: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "ProtoStructure",
  description:
    "Praxis cognitive unit — probabilistic, evolvable structure pattern extracted from conversations and tool calls.",
  properties: {
    id: { type: "string", description: "Unique identifier" },
    protoType: {
      type: "string",
      enum: ["sequence", "role", "concept", "purpose", "constraint"],
      description: "One of 5 ProtoStructure types",
    },
    tentativeName: { type: "string", description: "Human-readable name" },
    scenarioId: { type: "string", description: "Owning scenario ID" },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Fused confidence score (0.0–1.0)",
    },
    observationsCount: {
      type: "number",
      minimum: 0,
      description: "Number of observations backing this structure",
    },
    adoptionRate: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Attention telemetry adoption rate",
    },
    lifecycle: {
      type: "string",
      enum: [
        "hypothesized",
        "candidate",
        "experimental",
        "crystallized",
        "deprecated",
        "rejected",
      ],
      description: "Lifecycle stage",
    },
    relations: {
      type: "array",
      description: "Relationship edges to other structures",
      items: { type: "object" },
    },
    versionChain: {
      type: "array",
      description: "Version history for rollback",
      items: { type: "object" },
    },
    createdAt: { type: "number", description: "Creation timestamp (ms)" },
    updatedAt: { type: "number", description: "Last update timestamp (ms)" },
  },
  required: ["id", "protoType", "tentativeName", "confidence", "lifecycle"],
  additionalProperties: true,
};

export const PROTO_TASK_SCHEMA: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "ProtoTask",
  description:
    "Cross-project task pattern — learned from observing multiple instances of the same task type.",
  properties: {
    taskType: { type: "string", description: "Task type identifier" },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence in this task pattern (logarithmic growth)",
    },
    source: {
      type: "string",
      enum: ["bootstrap", "cumulative"],
      description: "Origin: bootstrap template or cumulative learning",
    },
    typicalPhases: {
      type: "array",
      description: "Typical phases with subtasks and criteria",
      items: { type: "object" },
    },
    commonPitfalls: {
      type: "array",
      description: "Common pitfalls with severity and mitigation",
      items: { type: "object" },
    },
    observations: {
      type: "number",
      minimum: 0,
      description: "Number of task instances observed",
    },
    generatedAt: { type: "number", description: "Generation timestamp (ms)" },
  },
  required: ["taskType", "confidence", "source", "observations"],
  additionalProperties: true,
};

export const COMPETENCY_MODEL_SCHEMA: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "CompetencyModel",
  description:
    "8D competency assessment — tool skills, domain familiarity, task proficiency, user model, process management, action reliability, proto-cognition, learning velocity.",
  properties: {
    toolSkills: { type: "object", description: "Tool proficiency scores" },
    domainFamiliarity: {
      type: "object",
      description: "Domain familiarity scores",
    },
    taskTypeProficiency: {
      type: "object",
      description: "Task type proficiency scores",
    },
    userModelConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Overall user model confidence",
    },
    processManagement: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Process management proficiency",
    },
    actionReliability: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Action decision reliability",
    },
    protoCognition: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "ProtoStructure recognition accuracy",
    },
    learningVelocity: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Rate of learning improvement",
    },
  },
  required: [],
  additionalProperties: true,
};

export const TASK_CONTEXT_SCHEMA: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "TaskContext",
  description:
    "Lightweight task awareness — current phase, progress summary, active subtasks.",
  properties: {
    taskId: { type: "string", description: "Unique task identifier" },
    name: { type: "string", description: "Human-readable task name" },
    type: {
      type: "string",
      enum: ["feature", "bugfix", "refactor", "research", "ops", "unknown"],
      description: "Task type classification",
    },
    currentPhase: { type: "string", description: "Current execution phase" },
    progressSummary: {
      type: "string",
      description: "Progress summary (≤200 chars)",
    },
    activeSubtasks: {
      type: "array",
      items: { type: "string" },
      description: "Currently active subtask names",
    },
    relevantScenarios: {
      type: "array",
      items: { type: "string" },
      description: "Related scenario IDs",
    },
    lastAutoUpdated: {
      type: "number",
      description: "Last auto-update timestamp (ms), null if never",
    },
    createdAt: { type: "number", description: "Creation timestamp (ms)" },
  },
  required: ["taskId", "name", "type", "currentPhase"],
  additionalProperties: true,
};

// ══════════════════════════════════════════════════════════════════
// 验证函数
// ══════════════════════════════════════════════════════════════════

/**
 * Lightweight structural validation against PROTO_STRUCTURE_SCHEMA.
 * Checks required fields, enum values, and numeric ranges.
 * Does NOT use a full JSON Schema validator — zero-dependency check.
 */
export function validateProtoStructure(data: unknown): ValidationResult {
  return validateAgainst(data, PROTO_STRUCTURE_SCHEMA);
}

/**
 * Lightweight structural validation against PROTO_TASK_SCHEMA.
 */
export function validateProtoTask(data: unknown): ValidationResult {
  return validateAgainst(data, PROTO_TASK_SCHEMA);
}

/**
 * Returns all schemas keyed by logical name.
 */
export function getAllSchemas(): Record<string, JsonSchema> {
  return {
    proto_structure: PROTO_STRUCTURE_SCHEMA,
    proto_task: PROTO_TASK_SCHEMA,
    competency_model: COMPETENCY_MODEL_SCHEMA,
    task_context: TASK_CONTEXT_SCHEMA,
  };
}

// ══════════════════════════════════════════════════════════════════
// Internal: lightweight schema validation
// ══════════════════════════════════════════════════════════════════

function validateAgainst(data: unknown, schema: JsonSchema): ValidationResult {
  const errors: string[] = [];

  if (data === null || data === undefined) {
    return { valid: false, errors: ["data is null or undefined"] };
  }
  if (typeof data !== "object") {
    return { valid: false, errors: [`expected object, got ${typeof data}`] };
  }

  const obj = data as Record<string, unknown>;

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in obj) || obj[field] === undefined) {
        errors.push(`missing required field: ${field}`);
      }
    }
  }

  // Check property constraints
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const value = obj[key];
      if (value === undefined) continue;

      // Enum check
      if (prop.enum && !prop.enum.includes(value as string)) {
        errors.push(
          `${key}: "${value}" is not a valid value (allowed: ${prop.enum.join(", ")})`,
        );
      }

      // Numeric range check
      if (typeof value === "number") {
        if (prop.minimum !== undefined && value < prop.minimum) {
          errors.push(`${key}: ${value} < minimum ${prop.minimum}`);
        }
        if (prop.maximum !== undefined && value > prop.maximum) {
          errors.push(`${key}: ${value} > maximum ${prop.maximum}`);
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
