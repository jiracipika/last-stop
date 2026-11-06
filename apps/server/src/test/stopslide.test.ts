// Stop-slide: releasing the movement keys coasts a short, deterministic
// distance instead of dead-stopping. World-level + deterministic. The exact
// same slide math lives in apps/web/src/game/predict.ts (prediction parity).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { World } from "../sim/world.js";
import { HIDE_SPOTS, ITEM_DEFS, PLAYER, TICK_DT } from "@last-stop/shared";

process.env.LS_DISABLE_ENEMY = "1"; // keep the Caretaker out of the corridor

const DT = TICK_DT;

/** Walk straight (-z) at full walk speed along the clear x=0 lot corridor. */
function walkToSpeed(w: World, ticks: number): number {
  const p = w.players.values().next().value!;
  p.input.mx = 0;
  p.input.mz = 1;
  p.input.yaw = Math.PI; // forward = (0, -1)
  for (let i = 0; i < ticks; i++) w.step(DT);
  return Math.hypot(p.body.vx, p.body.vz);
}

beforeAll(() => {
  process.env.LS_DISABLE_ENEMY = "1";
});

afterAll(() => {
  process.env.LS_DISABLE_ENEMY = "1";
});

describe("stop-slide", () => {
  it("decays coast velocity by exp(-STOP_SLIDE_RATE*dt) per tick after release", () => {
    const w = new World();
    const p = w.addPlayer("sl1", "Slider", 0, true);
    w.startMission();
    w.phase = "scavenge";
    p.body.x = 0;
    p.body.z = 9;
    const v0 = walkToSpeed(w, 30); // ~1s: walk speed fully ramped
    expect(v0).toBeGreaterThan(PLAYER.WALK * 0.95);
    p.input.mz = 0; // release everything
    w.step(DT);
    const keep = Math.exp(-PLAYER.STOP_SLIDE_RATE * DT);
    expect(Math.hypot(p.body.vx, p.body.vz)).toBeCloseTo(v0 * keep, 10);
  });

  it("coasts a fraction of a meter, straight, then fully stops", () => {
    const w = new World();
    const p = w.addPlayer("sl2", "Coaster", 0, true);
    w.startMission();
    w.phase = "scavenge";
    p.body.x = 0;
    p.body.z = 9;
    walkToSpeed(w, 30);
    p.input.mz = 0;
    const x0 = p.body.x;
    const z0 = p.body.z;
    let ticks = 0;
    while (Math.hypot(p.body.vx, p.body.vz) > 0.02 && ticks++ < 120) w.step(DT);
    const coast = Math.hypot(p.body.x - x0, p.body.z - z0);
    // tuned: ~0.37 m at walk speed (STOP_SLIDE_RATE 6), generous bounds so a
    // map tweak that drops a collider into the corridor fails loudly here
    expect(coast).toBeGreaterThan(0.25);
    expect(coast).toBeLessThan(0.55);
    expect(Math.abs(p.body.x - x0)).toBeLessThan(0.01); // no sideways drift
    expect(Math.hypot(p.body.vx, p.body.vz)).toBeLessThan(0.02);
  });

  it("never slides while seated or hidden (branches stay pinned)", () => {
    const w = new World();
    const p = w.addPlayer("sl3", "Pinned", 0, true);
    w.startMission();
    w.phase = "scavenge";
    // seated: the seat branch re-pins position and zeroes velocity
    p.body.vx = 3;
    p.body.vz = 3;
    p.seat = 1;
    w.step(DT);
    expect(p.body.vx).toBe(0);
    expect(p.body.vz).toBe(0);
    // hidden: tucked into a junker, velocity stays zero no matter what the
    // pre-step velocity was (the hidden branch continues past the slide)
    p.seat = 0;
    const spot = HIDE_SPOTS[0]!;
    p.body.x = spot.standX;
    p.body.z = spot.standZ;
    expect(w.tryHide(p, spot.id)).toBe(true);
    p.body.vx = 2.5; // smuggle in momentum as if we had just been sprinting
    w.step(DT);
    expect(p.hidden).toBe(true);
    expect(p.body.vx).toBe(0);
    expect(p.body.vz).toBe(0);
  });

  it("never slides while carrying (the leash punishes drifting haulers)", () => {
    const w = new World();
    const p = w.addPlayer("sl4", "Hauler", 0, true);
    w.startMission();
    w.phase = "scavenge";
    p.body.x = 0;
    p.body.z = 9;
    // pick up a real one-handed item through the real grab path (teleport it
    // to the corridor first — spawn points are scattered across the lot)
    const entry = [...w.items.entries()].find(([, it]) => {
      const def = ITEM_DEFS[it.defId];
      return def && !def.twoHandle;
    });
    expect(entry).toBeDefined();
    const [id, it] = entry!;
    it.body.x = p.body.x + 0.5; // well inside grab range + LOS
    it.body.z = p.body.z;
    expect(w.tryGrab(p, id)).toBe(true);
    expect(p.carrying).toBe(id);
    walkToSpeed(w, 30); // ramp to haul speed while carrying
    const vHaul = Math.hypot(p.body.vx, p.body.vz);
    expect(vHaul).toBeGreaterThan(0.5);
    p.input.mz = 0; // release: hauling keeps stepPlayer's own damping (no coast)
    w.step(DT);
    expect(Math.hypot(p.body.vx, p.body.vz)).toBeCloseTo(vHaul * Math.exp(-PLAYER.ACCEL_RATE * DT), 2);
  });
});
