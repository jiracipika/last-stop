// New modifiers: AMPED UP (Caretaker 20% faster) and RAISED TARGETS (quota
// +15%). Pure-helper pins + world-level wiring checks.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { World } from "../sim/world.js";
import { quotaFor } from "@last-stop/shared";

const prevEnemyEnv = process.env.LS_DISABLE_ENEMY;

beforeAll(() => {
  // AMPED UP needs a live Caretaker instance (delete, don't overwrite: the
  // env var is process-global and vitest files share one sequential worker)
  delete process.env.LS_DISABLE_ENEMY;
});

afterAll(() => {
  if (prevEnemyEnv === undefined) delete process.env.LS_DISABLE_ENEMY;
  else process.env.LS_DISABLE_ENEMY = prevEnemyEnv;
});

describe("RAISED TARGETS (fatquota)", () => {
  it("quotaFor scales the player-scaled quota by 1.15, rounded", () => {
    // 2 crew: quotaFactor 0.5 -> base 500 of 1000 spawned value
    expect(quotaFor(1000, 2, [])).toBe(500);
    expect(quotaFor(1000, 2, ["fatquota"])).toBe(575); // 500 * 1.15
    // odd values round half-up like the rest of the economy
    expect(quotaFor(999, 2, ["fatquota"])).toBe(Math.round(Math.round(999 * 0.5) * 1.15));
  });

  it("startMission applies the modifier to the live quota", () => {
    const w = new World();
    w.modifiersOverride = ["fatquota"];
    w.addPlayer("m1", "Sole", 0, true);
    w.startMission();
    expect(w.modifiers).toEqual(["fatquota"]);
    expect(w.quota).toBe(Math.round(Math.round(w.lootTotal * 0.44) * 1.15)); // 1 crew -> 0.44
  });
});

describe("AMPED UP (wired)", () => {
  it("multiplies the Caretaker's speed by 1.2, capped at the esc-3 ceiling", () => {
    const w = new World();
    w.modifiersOverride = ["wired"];
    w.addPlayer("m2", "Sole", 0, true);
    w.startMission();
    const e = w.enemy;
    expect(e.speedMul()).toBeCloseTo(1.2, 5); // escalation 1: plain 1.0 * 1.2
    w.escalation = 2;
    expect(e.speedMul()).toBeCloseTo(1.3, 5); // 1.15 * 1.2 = 1.38, capped at 1.3
    w.escalation = 3;
    expect(e.speedMul()).toBeCloseTo(1.3, 5); // 1.3 * 1.2 = 1.56, capped: esc3+wired must stay escapable
    w.modifiers = [];
    w.escalation = 2;
    expect(e.speedMul()).toBeCloseTo(1.15, 5);
  });
});
