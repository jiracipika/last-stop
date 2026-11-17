// Drive-in course: the shift opens with the whole crew seated in the van on
// the old road, one random driver threading three gates and parking at the
// lot spot. The wheel-holder at park time becomes the EXIT DRIVER, the shift
// clock only starts at park, a dropped driver is promoted from the riders,
// and a stalled course falls back to the server autopilot.
import { describe, expect, it } from "vitest";
import { COURSE, TICK_DT, VAN, VAN_START } from "@last-stop/shared";
import { World } from "../sim/world.js";

function scene(players = 2) {
  const w = new World();
  w.arriveEnabled = true;
  w.modifiersOverride = [];
  w.testQuota = 0; // quota met the moment the part installs -> easy escape flip
  const crew = [];
  for (let i = 0; i < players; i++) {
    crew.push(w.addPlayer(`s${i}`, `Crew ${i}`, i, i === 0));
  }
  w.startMission();
  // briefing is a fixed 5 s hold
  let guard = 0;
  while (w.phase === "briefing" && guard++ < 400) w.step(TICK_DT);
  return { w, crew };
}

/** Hold throttle straight east: the course is forgiving enough that a
 *  no-steer run threads all three gates and dies inside the park radius. */
function driveIn(w: World, maxSeconds = 40): number {
  const driver = w.players.get(w.vanDriver)!;
  driver.input.mz = 1;
  driver.input.mx = 0;
  let t = 0;
  while (w.phase === "arrive" && t < maxSeconds) {
    w.step(TICK_DT);
    t += TICK_DT;
  }
  return t;
}

describe("drive-in course", () => {
  it("seats the whole crew with exactly one driver and parks the van on the road", () => {
    const { w, crew } = scene(3);
    expect(w.phase).toBe("arrive");
    expect(crew.every((p) => p.seat > 0)).toBe(true);
    const drivers = crew.filter((p) => p.seat === 1);
    expect(drivers).toHaveLength(1);
    expect(w.vanDriver).toBe(drivers[0]!.sid);
    expect(w.exitDriver).toBe(drivers[0]!.sid);
    // parked at the course start on the old road, west of the gate
    expect(w.van.x).toBeCloseTo(COURSE.START.x, 1);
    expect(w.van.z).toBeCloseTo(COURSE.START.z, 1);
    // bodies snapped to their seats by the first step
    expect(crew[0]!.body.x).not.toBe(0);
  });

  it("threads the gates, parks, designates the exit driver and re-bases the clock", () => {
    const { w, crew } = scene(2);
    const t = driveIn(w);
    expect(t).toBeGreaterThan(4); // it is a real drive, not a teleport
    expect(t).toBeLessThan(35); // ~20 s at van pace, generous margins
    expect(w.phase).toBe("scavenge");
    expect(w.courseStage).toBe(3);
    const driver = crew.find((p) => p.seat === 1)!;
    expect(w.exitDriver).toBe(driver.sid);
    expect(w.state.course.driver).toBe(driver.sid);
    // the shift clock starts at park: a full mission remains
    expect(w.endsAt - w.t).toBeGreaterThan(700);
    // van came to rest inside the park radius
    expect(Math.hypot(w.van.x - VAN_START.x, w.van.z - VAN_START.z)).toBeLessThan(COURSE.PARK.r + 1);
    // checkpoint events were emitted in order
    const stages = w.events.filter((e) => e.t === "course").map((e) => e.stage);
    expect(stages).toEqual([1, 2, 3]);
    expect(w.events.some((e) => e.t === "arrived")).toBe(true);
  });

  it("solo shift: the lone player is the driver by necessity", () => {
    const { w, crew } = scene(1);
    expect(crew[0]!.seat).toBe(1);
    driveIn(w);
    expect(w.exitDriver).toBe(crew[0]!.sid);
    expect(w.phase).toBe("scavenge");
  });

  it("promotes the next rider when the driver drops", () => {
    const { w, crew } = scene(3);
    const rider = crew.find((p) => p.seat !== 1)!;
    const oldDriver = w.players.get(w.vanDriver)!;
    oldDriver.connected = false;
    w.step(TICK_DT);
    expect(w.vanDriver).toBe(rider.sid);
    expect(rider.seat).toBe(1);
    expect(w.exitDriver).toBe(rider.sid);
    expect(w.events.some((e) => e.t === "courseDriver" && e.sid === rider.sid)).toBe(true);
    driveIn(w);
    expect(w.exitDriver).toBe(rider.sid);
  });

  it("falls back to autopilot when nobody drives, and still completes", () => {
    const { w } = scene(2);
    // nobody touches the wheel: stall past STALL_S, then let the van self-drive
    let t = 0;
    while (!w.courseAuto && t < COURSE.STALL_S + 5) {
      w.step(TICK_DT);
      t += TICK_DT;
    }
    expect(w.courseAuto).toBe(true);
    expect(w.state.course.autopilot).toBe(true);
    expect(w.events.some((e) => e.t === "courseAuto")).toBe(true);
    while (w.phase === "arrive" && t < 180) {
      w.step(TICK_DT);
      t += TICK_DT;
    }
    expect(w.phase).toBe("scavenge");
    expect(w.courseAuto).toBe(false);
  });

  it("riders can bail out on the road and hop back in when the van stops", () => {
    const { w, crew } = scene(2);
    const rider = crew.find((p) => p.seat !== 1)!;
    const driver = w.players.get(w.vanDriver)!;
    driver.input.mz = 1;
    // a few seconds of driving, then brake
    for (let i = 0; i < 90; i++) w.step(TICK_DT);
    driver.input.mz = 0;
    driver.input.jump = true;
    for (let i = 0; i < 90; i++) w.step(TICK_DT);
    rider.input.mz = 0;
    w.exitSeat(rider);
    expect(rider.seat).toBe(0);
    // rider walks to the stopped van, opens the rear doors, boards a free seat
    const seat = w.players.get(rider.sid)!;
    const dp = w.vanPoint(VAN.DOOR_POINT);
    seat.body.x = dp.x;
    seat.body.z = dp.z;
    expect(w.toggleVanDoors(seat)).toBe(true);
    expect(w.tryEnterVan(seat, false)).toBe(true);
    expect(seat.seat).toBeGreaterThan(1);
  });
});
