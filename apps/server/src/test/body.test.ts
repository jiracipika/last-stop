// Dead-body recovery: lifting a fallen coworker (E), the heavy-carry speed
// penalty (mirrored in the predictor), the body riding the carrier's front,
// drops when the carrier goes down, and loading through the open rear doors
// into the cargo bay.
import { describe, expect, it } from "vitest";
import { CARRY, PLAYER, TICK_DT, VAN, carrySpeedFactor } from "@last-stop/shared";
import { World } from "../sim/world.js";

function scene() {
  const w = new World();
  const p = w.addPlayer("s0", "Hauler", 0, true);
  const dead = w.addPlayer("s1", "Fallen", 1, false);
  w.modifiersOverride = [];
  w.startMission();
  w.phase = "scavenge";
  // the teammate bleeds out on the lot beside the hauler
  w.damagePlayer(dead, 999, "test");
  w.damagePlayer(dead, 999, "test");
  expect(dead.dead).toBe(true);
  dead.body.x = p.body.x + 1;
  dead.body.z = p.body.z;
  return { w, p, dead };
}

describe("body recovery", () => {
  it("lifts a dead body in range with free hands", () => {
    const { w, p, dead } = scene();
    expect(w.tryLiftBody(p, dead.sid)).toBe(true);
    expect(p.carryBody).toBe(dead.sid);
    expect(w.events.some((e) => e.t === "bodyLift" && e.sid === dead.sid)).toBe(true);
  });

  it("rejects out-of-range lifts, live targets and double lifts", () => {
    const { w, p, dead } = scene();
    dead.body.x = p.body.x + 20;
    expect(w.tryLiftBody(p, dead.sid)).toBe(false);
    dead.body.x = p.body.x + 1;
    // a second hauler cannot grab the same body
    const other = w.addPlayer("s2", "Other", 2, false);
    other.body.x = dead.body.x;
    other.body.z = dead.body.z;
    expect(w.tryLiftBody(p, dead.sid)).toBe(true);
    expect(w.tryLiftBody(other, dead.sid)).toBe(false);
    // downed targets are not bodies
    w.damagePlayer(other, 999, "test");
    expect(other.downed).toBe(true);
    w.dropBody(p);
    expect(w.tryLiftBody(p, other.sid)).toBe(false);
  });

  it("hauling reads as a fixed heavy load and kills the sprint", () => {
    const { w, p, dead } = scene();
    const base = w.effectiveSpeed(p);
    expect(w.tryLiftBody(p, dead.sid)).toBe(true);
    expect(w.effectiveSpeed(p)).toBeCloseTo(PLAYER.WALK * carrySpeedFactor(CARRY.BODY_WEIGHT), 5);
    expect(w.effectiveSpeed(p)).toBeLessThan(base);
  });

  it("the body rides the carrier's front; drop sets it down", () => {
    const { w, p, dead } = scene();
    w.tryLiftBody(p, dead.sid);
    p.input.mx = 0;
    p.input.mz = 1;
    p.input.yaw = Math.PI / 2; // face east
    for (let i = 0; i < 30; i++) w.step(TICK_DT);
    // snapped to the carrier's forward hold point
    const fx = Math.sin(p.yaw) * CARRY.BODY_HOLD_DIST;
    const fz = Math.cos(p.yaw) * CARRY.BODY_HOLD_DIST;
    expect(dead.body.x).toBeCloseTo(p.body.x + fx, 1);
    expect(dead.body.z).toBeCloseTo(p.body.z + fz, 1);
    w.dropBody(p);
    expect(p.carryBody).toBe("");
    expect(w.events.some((e) => e.t === "bodyDrop")).toBe(true);
  });

  it("a carrier who goes down sets the body down where they stand", () => {
    const { w, p, dead } = scene();
    w.tryLiftBody(p, dead.sid);
    w.damagePlayer(p, 999, "test");
    expect(p.downed).toBe(true);
    expect(p.carryBody).toBe("");
    const d = Math.hypot(dead.body.x - p.body.x, dead.body.z - p.body.z);
    expect(d).toBeLessThan(2);
  });

  it("loads through the open rear doors into the cargo bay", () => {
    const { w, p, dead } = scene();
    // park the body beside the van rear, lift, open the doors, load
    w.vanDoorsOpen = false;
    const dp = w.vanPoint(VAN.DOOR_POINT);
    p.body.x = dp.x;
    p.body.z = dp.z;
    p.yaw = 0;
    dead.body.x = dp.x + 0.8;
    dead.body.z = dp.z;
    expect(w.tryLiftBody(p, dead.sid)).toBe(true);
    // doors closed -> no load
    expect(w.loadBody(p)).toBe(false);
    w.vanDoorsOpen = true;
    expect(w.loadBody(p)).toBe(true);
    expect(dead.bodyVan).toBe(true);
    expect(p.carryBody).toBe("");
    expect(w.events.some((e) => e.t === "bodyLoaded" && e.sid === dead.sid)).toBe(true);
    // body snaps into the cargo bay floor on the next tick
    w.step(TICK_DT);
    const spot = w.vanPoint(VAN.BODY_SPOTS[0]!);
    expect(dead.body.x).toBeCloseTo(spot.x, 1);
    expect(dead.body.z).toBeCloseTo(spot.z, 1);
    // schema mirrors recovery
    expect(w.state.players.get(dead.sid)!.bodyVan).toBe(true);
  });

  it("hands full of a body cannot board, grab or hide", () => {
    const { w, p, dead } = scene();
    w.tryLiftBody(p, dead.sid);
    const dp = w.vanPoint(VAN.DOOR_POINT);
    p.body.x = dp.x;
    p.body.z = dp.z;
    w.vanDoorsOpen = true;
    expect(w.tryEnterVan(p, false)).toBe(false);
    expect(w.tryEnterCart(p, true)).toBe(false);
    expect(w.tryHide(p, "carA")).toBe(false);
    expect(w.tryGrab(p, "i0")).toBe(false);
    expect(w.tryStow(p, "i0")).toBe(false);
  });
});
