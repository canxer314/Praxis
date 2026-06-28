/**
 * memory/schemas.ts — JSON Schema 定义测试
 *
 * 架构参考: §11 memory/schemas.ts
 */

import { describe, it, expect } from "vitest";
import {
  PROTO_STRUCTURE_SCHEMA,
  PROTO_TASK_SCHEMA,
  COMPETENCY_MODEL_SCHEMA,
  TASK_CONTEXT_SCHEMA,
  validateProtoStructure,
  validateProtoTask,
  getAllSchemas,
} from "./schemas";

// ══════════════════════════════════════════════════════════════════
// Schema 结构验证
// ══════════════════════════════════════════════════════════════════

describe("PROTO_STRUCTURE_SCHEMA", () => {
  it("is a valid JSON Schema with $schema and type", () => {
    expect(PROTO_STRUCTURE_SCHEMA.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(PROTO_STRUCTURE_SCHEMA.type).toBe("object");
  });

  it("requires id, protoType, tentativeName, confidence, lifecycle", () => {
    const required = PROTO_STRUCTURE_SCHEMA.required;
    expect(required).toContain("id");
    expect(required).toContain("protoType");
    expect(required).toContain("tentativeName");
    expect(required).toContain("confidence");
    expect(required).toContain("lifecycle");
  });

  it("restricts protoType to 5 valid values", () => {
    const prop = PROTO_STRUCTURE_SCHEMA.properties!.protoType as Record<string, unknown>;
    expect(prop.enum).toEqual(["sequence", "role", "concept", "purpose", "constraint"]);
  });

  it("restricts confidence to 0-1 range", () => {
    const prop = PROTO_STRUCTURE_SCHEMA.properties!.confidence as Record<string, unknown>;
    expect(prop.minimum).toBe(0);
    expect(prop.maximum).toBe(1);
  });
});

describe("PROTO_TASK_SCHEMA", () => {
  it("is a valid JSON Schema", () => {
    expect(PROTO_TASK_SCHEMA.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(PROTO_TASK_SCHEMA.type).toBe("object");
  });

  it("requires taskType, confidence, source, observations", () => {
    const required = PROTO_TASK_SCHEMA.required;
    expect(required).toContain("taskType");
    expect(required).toContain("confidence");
    expect(required).toContain("source");
    expect(required).toContain("observations");
  });

  it("restricts source to bootstrap or cumulative", () => {
    const prop = PROTO_TASK_SCHEMA.properties!.source as Record<string, unknown>;
    expect(prop.enum).toEqual(["bootstrap", "cumulative"]);
  });
});

describe("COMPETENCY_MODEL_SCHEMA", () => {
  it("is a valid JSON Schema", () => {
    expect(COMPETENCY_MODEL_SCHEMA.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(COMPETENCY_MODEL_SCHEMA.type).toBe("object");
  });
});

describe("TASK_CONTEXT_SCHEMA", () => {
  it("is a valid JSON Schema", () => {
    expect(TASK_CONTEXT_SCHEMA.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(TASK_CONTEXT_SCHEMA.type).toBe("object");
  });

  it("requires taskId, name, type, currentPhase", () => {
    const required = TASK_CONTEXT_SCHEMA.required;
    expect(required).toContain("taskId");
    expect(required).toContain("name");
    expect(required).toContain("type");
    expect(required).toContain("currentPhase");
  });
});

// ══════════════════════════════════════════════════════════════════
// validateProtoStructure
// ══════════════════════════════════════════════════════════════════

describe("validateProtoStructure", () => {
  const validStructure = {
    id: "ps-001",
    protoType: "sequence" as const,
    tentativeName: "门诊流程",
    scenarioId: "hospital",
    confidence: 0.5,
    observationsCount: 3,
    adoptionRate: 0.8,
    lifecycle: "experimental" as const,
    relations: [],
    versionChain: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("returns valid=true for a complete structure", () => {
    const result = validateProtoStructure(validStructure);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("returns valid=false and errors for missing required fields", () => {
    const result = validateProtoStructure({} as never);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("returns valid=false for invalid protoType", () => {
    const result = validateProtoStructure({ ...validStructure, protoType: "invalid" });
    expect(result.valid).toBe(false);
  });

  it("returns valid=false for confidence out of range", () => {
    const result = validateProtoStructure({ ...validStructure, confidence: 1.5 });
    expect(result.valid).toBe(false);
  });

  it("returns valid=false for negative confidence", () => {
    const result = validateProtoStructure({ ...validStructure, confidence: -0.1 });
    expect(result.valid).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// validateProtoTask
// ══════════════════════════════════════════════════════════════════

describe("validateProtoTask", () => {
  const validTask = {
    taskType: "web_deploy",
    confidence: 0.5,
    source: "bootstrap" as const,
    typicalPhases: [],
    commonPitfalls: [],
    observations: 3,
    generatedAt: Date.now(),
  };

  it("returns valid=true for a complete ProtoTask", () => {
    const result = validateProtoTask(validTask);
    expect(result.valid).toBe(true);
  });

  it("returns valid=false for invalid source", () => {
    const result = validateProtoTask({ ...validTask, source: "manual" });
    expect(result.valid).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// getAllSchemas
// ══════════════════════════════════════════════════════════════════

describe("getAllSchemas", () => {
  it("returns all 4 schemas keyed by name", () => {
    const schemas = getAllSchemas();
    expect(schemas.proto_structure).toBe(PROTO_STRUCTURE_SCHEMA);
    expect(schemas.proto_task).toBe(PROTO_TASK_SCHEMA);
    expect(schemas.competency_model).toBe(COMPETENCY_MODEL_SCHEMA);
    expect(schemas.task_context).toBe(TASK_CONTEXT_SCHEMA);
  });
});
