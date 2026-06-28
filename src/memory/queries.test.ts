/**
 * memory/queries.ts — 复合查询封装测试
 */

import { describe, it, expect } from "vitest";
import {
  buildCrystallizedStructuresQuery,
  buildScenarioStructuresQuery,
  buildRecentLessonsQuery,
  buildStaleStructuresQuery,
} from "./queries";

describe("buildCrystallizedStructuresQuery", () => {
  it("builds a query for crystallized structures", () => {
    const q = buildCrystallizedStructuresQuery("hospital");
    expect(q).toContain("crystallized");
    expect(q).toContain("hospital");
  });

  it("works without scenario filter", () => {
    const q = buildCrystallizedStructuresQuery();
    expect(q).toContain("crystallized");
  });
});

describe("buildScenarioStructuresQuery", () => {
  it("builds a scenario-specific query", () => {
    const q = buildScenarioStructuresQuery("web_deploy", "sequence");
    expect(q).toContain("web_deploy");
    expect(q).toContain("sequence");
  });

  it("works without type filter", () => {
    const q = buildScenarioStructuresQuery("web_deploy");
    expect(q).toContain("web_deploy");
  });
});

describe("buildRecentLessonsQuery", () => {
  it("builds a query for recent lessons", () => {
    const q = buildRecentLessonsQuery(7);
    expect(q).toContain("lesson");
    expect(q).toContain("7");
  });
});

describe("buildStaleStructuresQuery", () => {
  it("builds a query for stale structures", () => {
    const q = buildStaleStructuresQuery(60);
    expect(q).toContain("60");
    expect(q).toContain("stale");
  });
});
