import { describe, it, expect } from "vitest";
import { validateMap } from "../../../../packages/shared/src/mapcheck.js";

describe("map integrity", () => {
  it("nav edges never cross walls; spawns are clear; escape road is drivable", () => {
    const problems = validateMap();
    expect(problems).toEqual([]);
  });
});
