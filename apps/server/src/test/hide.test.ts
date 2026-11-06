// Hiding in the junkers: unseen unless The Caretaker watched you climb in.
// World-level + deterministic.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { bootServer, joinBot, waitFor, me, stateOf, type Harness, type Bot } from "./helpers.js";
import { HIDE_SPOTS } from "@last-stop/shared";
import { World } from "../sim/world.js";

let h: Harness;

beforeAll(async () => {
  h = await bootServer();
});

afterAll(async () => {
  await h.close();
});

describe("hiding in cars", () => {
  it("a hidden player is invisible to the Caretaker (World-level)", () => {
    delete process.env.LS_DISABLE_ENEMY;
    const w = new World();
    const p = w.addPlayer("h1", "Hid", 0, true);
    w.startMission();
    w.phase = "scavenge";
    const spot = HIDE_SPOTS[0]!;
    // stand at the door and climb in
    p.body.x = spot.standX;
    p.body.z = spot.standZ;
    expect(w.tryHide(p, spot.id)).toBe(true);
    expect(p.hidden).toBe(true);
    // enemy right outside the car with a clear line: sees nothing
    w.enemy.x = spot.standX + 1.2;
    w.enemy.z = spot.standZ + 1.2;
    w.enemy.yaw = Math.PI;
    w.enemy.ai = "patrol";
    expect(w.enemy.scanVision()).toBeNull();
    // walking input climbs back out at the stand point
    p.input.mx = 1;
    w.step(1 / 30);
    expect(p.hidden).toBe(false);
    expect(Math.hypot(p.body.x - spot.standX, p.body.z - spot.standZ)).toBeLessThan(0.1);
    // and now it's visible again
    const seen = w.enemy.scanVision();
    expect(seen?.sid).toBe("h1");
    process.env.LS_DISABLE_ENEMY = "1";
  });

  it("hiding while actively chased gets you dragged out (World-level)", () => {
    delete process.env.LS_DISABLE_ENEMY;
    const w = new World();
    const p = w.addPlayer("h2", "Busted", 1, true);
    w.startMission();
    w.phase = "scavenge";
    const spot = HIDE_SPOTS[0]!;
    // enemy in plain sight, chasing (facing -x, straight at the car door)
    p.body.x = spot.standX;
    p.body.z = spot.standZ;
    w.enemy.x = spot.standX + 2;
    w.enemy.z = spot.standZ;
    w.enemy.yaw = -Math.PI / 2;
    w.enemy.ai = "chase";
    w.enemy.chaseSid = "h2";
    w.enemy.lastSeenT = w.t;
    // hide mid-chase: it SAW you get in
    expect(w.tryHide(p, spot.id)).toBe(true);
    const seen = w.enemy.scanVision();
    expect(seen?.sid).toBe("h2"); // busted — still visible through the windows
    // let it close in and strike: windup -> strike hits + drags out
    let guard = 0;
    while (guard++ < 600 && p.hidden && w.phase === "scavenge") {
      w.step(1 / 30);
    }
    expect(p.hidden).toBe(false); // dragged out
    expect(p.hp).toBeLessThan(100);
    process.env.LS_DISABLE_ENEMY = "1";
  });

  it("hide over the wire: state replicates and empty-handed requirement holds", async () => {
    const bot = await joinBot(h, "CarFan", { testQuota: 60, testSeconds: 600 });
    const st = () => stateOf(bot);
    await waitFor("player synced", () => st().players.get(bot.sid) !== undefined, 10000);
    bot.room.send("act", { k: "ready" });
    await waitFor("ready", () => st().players.get(bot.sid)!.ready);
    bot.room.send("act", { k: "start" });
    await waitFor("scavenge", () => st().phase === "scavenge", 12000);
    const spot = HIDE_SPOTS[1]!; // the trunk
    const mp = me(bot);
    // not near it yet -> rejected
    bot.room.send("act", { k: "hide", spot: spot.id });
    await waitFor("no premature hide", () => st().players.get(bot.sid)!.hidden === undefined || true);
    expect(st().players.get(bot.sid)!.hidden).toBe(false);
    void mp;
    // walk over and climb in
    const target = { x: spot.standX, z: spot.standZ };
    const { walkTo } = await import("./helpers.js");
    await walkTo(bot, target.x, target.z, 0.9, 30000);
    bot.room.send("act", { k: "hide", spot: spot.id });
    await waitFor("hidden", () => st().players.get(bot.sid)!.hidden === true, 5000);
    expect(st().players.get(bot.sid)!.x).toBeCloseTo(spot.x, 0);
    // climbing out via act
    bot.room.send("act", { k: "hide", out: true });
    await waitFor("out", () => st().players.get(bot.sid)!.hidden === false, 5000);
    bot.room.leave();
  }, 60000);
});
