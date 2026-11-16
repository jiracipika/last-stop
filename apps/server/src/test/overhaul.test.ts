import { describe, expect, it } from "vitest";
import { DOORS, ENEMY, HIDE_SPOTS, TICK_DT, VAN, doorAabb, moveToward, mulberry32 } from "@last-stop/shared";
import { World } from "../sim/world.js";

function scene() {
  const w = new World();
  const p = w.addPlayer("crew", "Crew", 0, true);
  w.modifiersOverride = [];
  w.startMission();
  w.phase = "scavenge";
  return { w, p };
}

function strike(w: World) {
  w.enemy.ai = "windup";
  w.enemy.windupT = 0;
  w.enemy.struck = false;
  for (let i = 0; i < Math.ceil(ENEMY.WINDUP_TIME / TICK_DT) + 1; i++) w.enemy.step(TICK_DT);
}

describe("vehicle and entity regression cases", () => {
  it("enemy movement reports open ground as clear and a wall as blocked", () => {
    const clear = moveToward(0, 0, 0, 0, 5, 3, TICK_DT, []);
    expect(clear.z).toBeGreaterThan(0);
    expect(clear.blocked).toBe(false);
    const wall = moveToward(0, 0, 0, 0, 5, 3, TICK_DT, [{ x0: -2, x1: 2, z0: 0.45, z1: 1 }]);
    expect(wall.z).toBeCloseTo(0);
    expect(wall.blocked).toBe(true);
  });
  it("boards the driver from the advertised cab interaction point", () => {
    const { w, p } = scene();
    const side = w.vanPoint({ x: -VAN.HALF_W - 0.3, z: 1.6 });
    p.body.x = side.x;
    p.body.z = side.z;
    expect(w.tryEnterVan(p, true)).toBe(true);
    expect(p.seat).toBe(1);
    expect(w.vanDriver).toBe(p.sid);
  });

  it("passenger boarding cannot silently take the driver's seat", () => {
    const { w, p } = scene();
    Object.assign(p.body, w.vanPoint(VAN.DOOR_POINT));
    w.vanDoorsOpen = true;
    expect(w.tryEnterVan(p, false)).toBe(true);
    expect(p.seat).toBe(2);
    expect(w.vanDriver).toBe("");
  });

  it("rejects boarding from outside interaction range", () => {
    const { w, p } = scene();
    Object.assign(p.body, { x: 30, z: 25 });
    w.vanDoorsOpen = true;
    expect(w.tryEnterVan(p, true)).toBe(false);
  });

  it("only one player fits in each hiding spot", () => {
    const { w, p } = scene();
    const other = w.addPlayer("other", "Other", 1, false);
    const spot = HIDE_SPOTS[0]!;
    for (const crew of [p, other]) Object.assign(crew.body, { x: spot.standX, z: spot.standZ });
    expect(w.tryHide(p, spot.id)).toBe(true);
    expect(w.tryHide(other, spot.id)).toBe(false);
  });

  it("a closed door blocks a strike even when the victim is in melee range", () => {
    const { w, p } = scene();
    const def = DOORS[0]!;
    const a = doorAabb(def);
    const x = (a.x0 + a.x1) / 2;
    const z = (a.z0 + a.z1) / 2;
    w.doors.get(def.id)!.open = false;
    w.enemy.x = x;
    w.enemy.z = z + 0.65;
    w.enemy.yaw = Math.PI;
    Object.assign(p.body, { x, z: z - 0.65 });
    w.enemy.chaseSid = p.sid;
    expect(w.hasLineOfSight(x, z + 0.65, x, z - 0.65)).toBe(false);
    strike(w);
    expect(p.hp).toBe(100);
    // Opening the same door allows contact on the next attack.
    w.doors.get(def.id)!.open = true;
    strike(w);
    expect(p.hp).toBe(100 - ENEMY.HIT_DAMAGE);
  });

  it("a visible player cannot cancel the enemy recovery window", () => {
    const { w, p } = scene();
    w.enemy.x = 0;
    w.enemy.z = 5;
    w.enemy.yaw = 0;
    Object.assign(p.body, { x: 0, z: 6.5 });
    w.enemy.chaseSid = p.sid;
    strike(w);
    expect(w.enemy.ai).toBe("recover");
    const hp = p.hp;
    for (let i = 0; i < Math.floor(ENEMY.RECOVER_TIME / TICK_DT) - 2; i++) w.enemy.step(TICK_DT);
    expect(w.enemy.ai).toBe("recover");
    expect(p.hp).toBe(hp);
  });

  it("the struck player standing adjacent keeps priority through the recovery pause", () => {
    // Regression: post-strike the enemy went blind, its recover exit detoured
    // through nav nodes away from the victim, and the next vision scan
    // retargeted a distant idle player — the wounded victim was forgotten.
    const { w, p } = scene();
    const medic = w.addPlayer("medic", "Medic", 1, false);
    medic.body.x = 4.2;
    medic.body.z = 10.2;
    w.enemy.x = -0.2;
    w.enemy.z = 6.1;
    w.enemy.yaw = Math.atan2(0.2, -1.7); // squared away on the victim
    Object.assign(p.body, { x: 0, z: 4.4 });
    w.enemy.chaseSid = p.sid;
    w.enemy.lastSeenX = p.body.x;
    w.enemy.lastSeenZ = p.body.z;
    strike(w);
    expect(p.hp).toBe(100 - ENEMY.HIT_DAMAGE);
    expect(w.enemy.ai).toBe("recover");
    // through the pause and the follow-up re-engage: the victim goes down,
    // the medic across the lot is never touched
    for (let i = 0; i < Math.ceil((ENEMY.RECOVER_TIME + 4) / TICK_DT) && !p.downed; i++) {
      w.enemy.step(TICK_DT);
    }
    expect(p.downed).toBe(true);
    expect(p.hp).toBe(0);
    expect(medic.hp).toBe(100);
    expect(medic.downed).toBe(false);
  });

  it("replaying clears enemy attack, navigation and sight timers", () => {
    const { w } = scene();
    Object.assign(w.enemy, { visT: 5, stuckT: 1, searchT: 4, lastSeenT: 99, windupT: 2, struck: true, recoverT: 2, forceT: 2, bangT: 1, routeDir: -1 });
    w.enemy.reset(mulberry32(123));
    expect(w.enemy.visT).toBe(0);
    expect(w.enemy.stuckT).toBe(0);
    expect(w.enemy.lastSeenT).toBeLessThan(0);
    expect(w.enemy.windupT).toBe(0);
    expect(w.enemy.struck).toBe(false);
    expect(w.enemy.routeDir).toBe(1);
  });
});
