import { describe, it, expect } from "vitest";
import { validateMap } from "@last-stop/shared";

describe("map integrity", () => {
  it("nav edges never cross walls; spawns are clear; escape road is drivable", () => {
    const problems = validateMap();
    expect(problems).toEqual([]);
  });
});
