import { describe, expect, it } from "vitest";
import { CART, CARRY, DOORS, ENEMY, ITEM_DEFS, MISSION, PLAYER, SEAT, TICK_DT, VAN, carrySpeedFactor } from "@last-stop/shared";
import { World } from "../sim/world.js";

process.env.LS_DISABLE_ENEMY = "1";

function scene() {
  const w = new World();
  const pilot = w.addPlayer("pilot", "Pilot", 0, true);
  const rider = w.addPlayer("rider", "Rider", 1, false);
  w.modifiersOverride = [];
  w.startMission();
  w.phase = "scavenge";
  return { w, pilot, rider };
}

function seatCart(w: World, p: ReturnType<World["addPlayer"]>, driver: boolean) {
  Object.assign(p.body, { x: w.cart.x - CART.HALF_W - 0.4, z: w.cart.z });
  expect(w.tryEnterCart(p, driver)).toBe(true);
}

describe("post-merge vehicle regressions", () => {
  it("extracts the van without crashing or extracting either cart seat", () => {
    const { w, pilot, rider } = scene();
    const passenger = w.addPlayer("passenger", "Passenger", 2, false);
    Object.assign(pilot.body, w.vanPoint(VAN.DRIVER_POINT));
    expect(w.tryEnterVan(pilot, true)).toBe(true);
    seatCart(w, rider, true);
    seatCart(w, passenger, false);
    w.step(TICK_DT);
    const cartPositions = [rider, passenger].map(p => ({ x: p.body.x, z: p.body.z }));
    w.finish("escaped");
    expect(() => {
      for (let i = 0; i < Math.ceil(MISSION.PULL_S / TICK_DT) + 2; i++) w.step(TICK_DT);
    }).not.toThrow();
    expect(w.phase).toBe("results");
    const rows = JSON.parse(w.state.resultsJson).rows as { nick: string; status: string }[];
    expect(rows.find(p => p.nick === "Pilot")!.status).toBe("escaped");
    for (const [i, p] of [rider, passenger].entries()) {
      expect(rows.find(row => row.nick === p.nick)!.status).not.toBe("escaped");
      expect(p.dead).toBe(true);
      expect(p.body.x).toBeCloseTo(cartPositions[i]!.x);
      expect(p.body.z).toBeCloseTo(cartPositions[i]!.z);
    }
  });

  it("counts cart occupants as outside the van even when parked beside it", () => {
    const { w, pilot, rider } = scene();
    Object.assign(pilot.body, w.vanPoint(VAN.DRIVER_POINT));
    w.tryEnterVan(pilot, true);
    seatCart(w, rider, false);
    Object.assign(rider.body, { x: w.van.x, z: w.van.z });
    expect(w.playersHaveLivingOutside()).toBe(1);
  });

  it("the open cart cannot hide a rider from the Caretaker", () => {
    const { w, pilot, rider } = scene();
    Object.assign(w.cart, { x: 0, z: 4, yaw: 0 });
    seatCart(w, pilot, true);
    Object.assign(rider.body, { x: 30, z: 24 });
    w.step(TICK_DT);
    Object.assign(w.enemy, { x: pilot.body.x, z: pilot.body.z - 1.5, yaw: 0 });
    w.vanDoorsOpen = false;
    expect(w.enemy.scanVision()?.sid).toBe(pilot.sid);
    w.enemy.chaseSid = pilot.sid;
    w.enemy.ai = "chase";
    w.enemy.step(TICK_DT);
    expect(w.enemy.chaseSid).toBe(pilot.sid);
    w.enemy.ai = "windup";
    w.enemy.windupT = 0;
    w.enemy.struck = false;
    for (let i = 0; i < Math.ceil(ENEMY.WINDUP_TIME / TICK_DT) + 1; i++) w.enemy.step(TICK_DT);
    expect(pilot.hp).toBe(100 - ENEMY.HIT_DAMAGE);
    w.damagePlayer(pilot, 999, "test");
    expect(pilot.downed).toBe(true);
    expect(pilot.seat).toBe(0);
    expect(w.cartDriver).toBe("");
    w.t = pilot.bleedAt;
    w.step(TICK_DT);
    expect(pilot.dead).toBe(true);
  });

  it("reverse throttle cannot bypass the designated-driver recovery gate", () => {
    const { w, pilot, rider } = scene();
    Object.assign(pilot.body, w.vanPoint(VAN.DRIVER_POINT));
    w.tryEnterVan(pilot, true);
    w.exitDriver = rider.sid;
    w.damagePlayer(rider, 999, "test");
    w.phase = "escape";
    pilot.input.mz = -1;
    for (let i = 0; i < 30; i++) w.step(TICK_DT);
    expect(w.exitDriverBlock()).toBe("down");
    expect(Math.abs(w.van.speed)).toBeLessThan(0.01);
  });

  it("holding W does not auto-confirm abandoning a teammate", () => {
    const { w, pilot, rider } = scene();
    Object.assign(pilot.body, w.vanPoint(VAN.DRIVER_POINT));
    w.tryEnterVan(pilot, true);
    Object.assign(rider.body, { x: 25, z: 20 });
    w.phase = "escape";
    pilot.input.mz = 1;
    for (let i = 0; i < 30; i++) w.step(TICK_DT);
    expect(w.extractConfirmed).toBe(false);
    expect(Math.abs(w.van.speed)).toBeLessThan(0.01);
    pilot.input.mz = 0; w.step(TICK_DT);
    pilot.input.mz = 1; w.step(TICK_DT);
    expect(w.extractConfirmed).toBe(true);
    expect(w.van.speed).toBeGreaterThan(0);
  });
});

describe("post-merge carrying regressions", () => {
  it("holding sprint does not accelerate a body carrier", () => {
    const { w, pilot, rider } = scene();
    rider.dead = true;
    Object.assign(rider.body, { x: pilot.body.x + 0.5, z: pilot.body.z });
    expect(w.tryLiftBody(pilot, rider.sid)).toBe(true);
    pilot.input.mz = 1;
    pilot.input.sprint = true;
    expect(w.effectiveSpeed(pilot)).toBeCloseTo(PLAYER.WALK * carrySpeedFactor(CARRY.BODY_WEIGHT));
    expect(pilot.sprinting).toBe(false);
  });

  it("cannot grab or stow loot across a closed door even at point-blank range", () => {
    const { w, pilot } = scene();
    const item = [...w.items.values()].find(i => !ITEM_DEFS[i.defId]!.twoHandle && !ITEM_DEFS[i.defId]!.part && ITEM_DEFS[i.defId]!.weight <= 2)!;
    const door = DOORS[0]!;
    Object.assign(pilot.body, { x: door.cx, z: door.cz + 0.3 });
    Object.assign(item.body, { x: door.cx, z: door.cz - 0.3 });
    expect(w.tryGrab(pilot, item.id)).toBe(false);
    expect(w.tryStow(pilot, item.id)).toBe(false);
    expect(item.h0).toBe("");
  });
});

describe("repeat-shift supply stop", () => {
  it("returns the crew to shopping and ready-up before starting another shift", () => {
    const { w, pilot, rider } = scene();
    pilot.ready = rider.ready = true;
    pilot.hasFlashlight = true;
    pilot.budget = 3;
    w.finish("timeout");
    expect(pilot.hasFlashlight).toBe(false);
    expect(w.tryBuy(pilot, "flashlight")).toBe(false);
    w.returnToLobby();
    expect(w.phase).toBe("lobby");
    expect(w.state.phase).toBe("lobby");
    expect(pilot.ready).toBe(false);
    expect(rider.ready).toBe(false);
    expect(w.endsAt).toBe(0);
    expect(w.tryBuy(pilot, "flashlight")).toBe(true);
    w.startMission();
    expect(pilot.hasFlashlight).toBe(true);
  });
});
