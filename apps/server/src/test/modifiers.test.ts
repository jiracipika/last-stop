// New modifiers: AMPED UP (Caretaker 20% faster) and RAISED TARGETS (quota
// +15%). Pure-helper pins + world-level wiring checks, plus the severity-capped
// draw contract for pickModifiers (CAP, determinism, bounded redraw).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { World } from "../sim/world.js";
import {
  MODIFIER_POOL,
  SEVERITY_CAP,
  comboSeverity,
  mulberry32,
  pickModifiers,
  quotaFor,
} from "@last-stop/shared";

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

// ---------------------------------------------------------------------------
// Severity-capped draw: pickModifiers must never deal a combo harsher than
// SEVERITY_CAP, and the cap's single re-roll must stay deterministic and
// bounded. See docs/BALANCE.md ("Severity cap") for the distribution math.
// ---------------------------------------------------------------------------
describe("severity-capped pickModifiers", () => {
  /** Counting rng wrapper: records how many draws pickModifiers consumed. */
  function countingRng(seed: number): { rng: () => number; calls: () => number } {
    const base = mulberry32(seed);
    let n = 0;
    return { rng: () => (n++, base()), calls: () => n };
  }

  it("(a) returns 3 distinct pool ids with a rigged rng, cap fired or not", () => {
    // rng always 0: picks the first pool id three times (blackout, fragile,
    // sensitive = sev 1.925 > CAP), so the cap fires on this rig too.
    const fired = pickModifiers(() => 0);
    expect(fired).toHaveLength(3);
    expect(new Set(fired).size).toBe(3);
    for (const id of fired) expect(MODIFIER_POOL).toContain(id);

    // rng always ~1: walks the pool from the top, no cap fire needed
    // (storm + fatquota + bells = sev 1.38).
    const calm = pickModifiers(() => 0.99);
    expect(calm).toHaveLength(3);
    expect(new Set(calm).size).toBe(3);
    for (const id of calm) expect(MODIFIER_POOL).toContain(id);
    expect(comboSeverity(calm)).toBeLessThanOrEqual(SEVERITY_CAP);
  });

  it("(b) over 2000 deterministic seeds comboSeverity(picked) <= CAP always", () => {
    let capFired = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const { rng, calls } = countingRng(seed);
      const picked = pickModifiers(rng);
      expect(picked).toHaveLength(3);
      expect(new Set(picked).size).toBe(3);
      expect(comboSeverity(picked)).toBeLessThanOrEqual(SEVERITY_CAP);
      if (calls() === 4) capFired++; // 3 picks + 1 redraw == cap fired
    }
    // The test would be vacuous if the cap never fired: ~14% of draws trip it.
    expect(capFired).toBeGreaterThan(0);
  });

  it("(c) the cap re-rolls the last pick of a fragile+sensitive+wired draw", () => {
    // Rigged sequence: 0.13 -> pool[1] fragile (of 8), 0.15 -> pool[1]
    // sensitive (of 7), 0.6 -> pool[3] wired (of 6). sev = 1.25*1.4*1.2 = 2.1
    // > CAP, so pick 4 re-rolls the last slot; 0.9 -> the only under-cap
    // candidate left (storm, sev 1.75 <= 1.9).
    const seq = [0.13, 0.15, 0.6, 0.9];
    let i = 0;
    const picked = pickModifiers(() => {
      if (i >= seq.length) throw new Error("rng over-consumed: redraw looped");
      return seq[i++]!;
    });
    expect(picked.slice(0, 2)).toEqual(["fragile", "sensitive"]); // first two kept
    expect(picked).not.toContain("wired"); // rejected pick cannot survive...
    expect(picked).not.toEqual(["fragile", "sensitive", "wired"]); // ...so it differs
    expect(picked[2]).toBe("storm"); // redraw landed under the cap
    expect(comboSeverity(picked)).toBeLessThanOrEqual(SEVERITY_CAP);
    expect(i).toBe(4); // bounded: 3 picks + exactly 1 redraw, no loop
  });

  it("(d) identical rng sequences produce identical draws", () => {
    for (const seed of [1, 42, 1234, 999999]) {
      const a = pickModifiers(mulberry32(seed));
      const b = pickModifiers(mulberry32(seed));
      expect(a).toEqual(b);
    }
    // Same for a rigged over-cap sequence (runs the redraw path twice).
    const run = (): string[] => {
      const seq = [0.13, 0.15, 0.6, 0.9];
      let i = 0;
      return pickModifiers(() => seq[i++ % seq.length]!);
    };
    expect(run()).toEqual(run());
  });
});
