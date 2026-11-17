// Exit-driver leave gate: the van may not leave the lot while the designated
// exit driver is downed (stabilize them) or dead with the body still on the
// lot (haul it home). No double-press abandon confirms past either state.
import { describe, expect, it } from "vitest";
import { FINISH_X, TICK_DT, VAN } from "@last-stop/shared";
import { World } from "../sim/world.js";

function scene() {
  const w = new World();
  w.arriveEnabled = true;
  w.modifiersOverride = [];
  w.testQuota = 0; // quota met -> escape flips as soon as the part installs
  const a = w.addPlayer("s0", "Driver", 0, true);
  const b = w.addPlayer("s1", "Hauler", 1, false);
  w.startMission();
  let guard = 0;
  while (w.phase === "briefing" && guard++ < 400) w.step(TICK_DT);
  // hold throttle straight east through the course
  w.players.get(w.vanDriver)!.input.mz = 1;
  guard = 0;
  while (w.phase === "arrive" && guard++ < 1600) w.step(TICK_DT);
  expect(w.phase).toBe("scavenge");
  // the van rolls into scavenge and its idle handbrake stops it — let it
  // settle (and the crew hop out) like the real flow before escaping
  guard = 0;
  while (Math.abs(w.van.speed) > 0.15 && guard++ < 200) w.step(TICK_DT);
  w.players.get(w.vanDriver)!.input.mz = 0;
  return { w, a, b };
}

/** Land the crew in the escape phase: install the part with quota already 0. */
function toEscape(w: World) {
  w.partInstalled = true;
  w.salvage = Math.max(w.salvage, w.quota);
  w.step(TICK_DT);
  expect(w.phase).toBe("escape");
}

/** Everyone hops out of the parked van (the real flow before anyone can be
 *  downed out on the lot). */
function dismount(w: World) {
  for (const p of w.players.values()) {
    if (p.seat > 0) w.leaveSeat(p);
  }
}

/** Put `p` behind the wheel of the stopped van. */
function takeWheel(w: World, p: ReturnType<typeof scene>["a"]) {
  p.seat = 1;
  w.vanDriver = p.sid;
  p.input.mz = 0;
  p.input.jump = false;
}

describe("exit-driver leave gate", () => {
  it("blocks the throttle while the exit driver is downed, then drives after revive", () => {
    const { w, a, b } = scene();
    dismount(w);
    toEscape(w);
    const exit = w.players.get(w.exitDriver)!;
    // exit driver downs out on the lot; the other player takes the wheel
    w.damagePlayer(exit, 999, "test");
    expect(exit.downed).toBe(true);
    takeWheel(w, exit === a ? b : a);
    const pilot = w.players.get(w.vanDriver)!;
    pilot.input.mz = 1;
    for (let i = 0; i < 45; i++) w.step(TICK_DT); // 1.5 s of flooring it
    expect(Math.abs(w.van.speed)).toBeLessThan(0.5);
    expect(w.events.some((e) => e.t === "leaveBlock" && e.k === "down")).toBe(true);
    // stabilize + revive the exit driver: the gate lifts
    w.revive(pilot, exit);
    expect(w.exitDriverBlock()).toBe(null);
    for (let i = 0; i < 45; i++) w.step(TICK_DT);
    expect(w.van.speed).toBeGreaterThan(2);
  });

  it("blocks while the exit driver's body is unrecovered, lifts once it is loaded", () => {
    const { w, a, b } = scene();
    dismount(w);
    toEscape(w);
    const exit = w.players.get(w.exitDriver)!;
    w.damagePlayer(exit, 999, "test"); // downed…
    w.damagePlayer(exit, 999, "test"); // …then gone
    expect(exit.dead).toBe(true);
    takeWheel(w, exit === a ? b : a);
    const pilot = w.players.get(w.vanDriver)!;
    pilot.input.mz = 1;
    for (let i = 0; i < 45; i++) w.step(TICK_DT);
    expect(Math.abs(w.van.speed)).toBeLessThan(0.5);
    expect(w.events.some((e) => e.t === "leaveBlock" && e.k === "body")).toBe(true);
    // body recovered into the van -> free to go
    exit.bodyVan = true;
    expect(w.exitDriverBlock()).toBe(null);
    for (let i = 0; i < 45; i++) w.step(TICK_DT);
    expect(w.van.speed).toBeGreaterThan(2);
  });

  it("a full run: blocked driver revived, van crosses the finish and escapes", () => {
    const { w, a, b } = scene();
    dismount(w);
    toEscape(w);
    const exit = w.players.get(w.exitDriver)!;
    const pilot = exit === a ? b : a;
    w.damagePlayer(exit, 999, "test");
    takeWheel(w, pilot);
    w.van.yaw = -Math.PI / 2; // face west down the road
    pilot.input.mz = 1;
    for (let i = 0; i < 20; i++) w.step(TICK_DT);
    expect(Math.abs(w.van.speed)).toBeLessThan(0.5);
    // while the van is held: revive the exit driver, open the rear doors,
    // everyone piles in — then the gate lifts and the van rides out
    w.revive(pilot, exit);
    const dp = w.vanPoint(VAN.DOOR_POINT);
    exit.body.x = dp.x;
    exit.body.z = dp.z;
    expect(w.toggleVanDoors(exit)).toBe(true);
    expect(w.tryEnterVan(exit, false)).toBe(true);
    expect(w.exitDriverBlock()).toBe(null);
    pilot.input.mz = 1;
    let guard = 0;
    while (w.phase === "escape" && guard++ < 3000) w.step(TICK_DT);
    expect(w.van.x).toBeLessThan(FINISH_X);
    expect(w.state.outcome).toBe("escaped");
    guard = 0;
    while (w.phase !== "results" && guard++ < 300) w.step(TICK_DT); // pull-away
    expect(w.phase).toBe("results");
    // both riders clocked out
    const rows = JSON.parse(w.state.resultsJson).rows as { status: string }[];
    expect(rows.every((r) => r.status === "escaped")).toBe(true);
  });

  it("a departed exit driver lifts the constraint entirely", () => {
    const { w } = scene();
    toEscape(w);
    const exit = w.players.get(w.exitDriver)!;
    w.damagePlayer(exit, 999, "test");
    exit.connected = false; // dropped out of the room
    expect(w.exitDriverBlock()).toBe(null);
  });
});
