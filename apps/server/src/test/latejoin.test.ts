// Late join ("clock in mid-shift"): a player joining during a live mission
// spawns at the van, can act immediately, results joins still work, and full
// rooms still reject.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  bootServer, joinBot, joinExisting, sleep, waitFor, me, walkTo, stateOf,
  type Harness, type Bot,
} from "./helpers.js";
import { MISSION, VAN, vanLocalToWorld, dist2d } from "@last-stop/shared";

let h: Harness;

beforeAll(async () => {
  h = await bootServer();
});

afterAll(async () => {
  await h.close();
});

async function startAtEscape(bot: Bot) {
  await waitFor("synced", () => stateOf(bot).players.get(bot.sid) !== undefined);
  bot.room.send("act", { k: "ready" });
  await waitFor("ready", () => stateOf(bot).players.get(bot.sid)!.ready);
  bot.room.send("act", { k: "start" });
  await waitFor("escape", () => stateOf(bot).phase === "escape", 12000);
}

describe("late join", () => {
  it("a second player clocks in mid-escape: spawns at the van, moves, toast arrives", async () => {
    const bot = await joinBot(h, "Early", { testQuota: 60, testSeconds: 600, testAt: "escape" });
    await startAtEscape(bot);

    const late = await joinExisting(h, bot.room.roomId, "Late");
    await waitFor("late synced", () => stateOf(bot).players.get(late.sid) !== undefined);
    expect(stateOf(bot).phase).toBe("escape");

    // spawn sits at the van's late-spawn offset, not at PLAYER_SPAWNS
    const van = stateOf(bot).van;
    const spot = vanLocalToWorld({ x: van.x, z: van.z, yaw: van.yaw, speed: van.speed }, 0, MISSION.LATE_SPAWN_LOCAL_Z);
    const lp = stateOf(bot).players.get(late.sid)!;
    expect(dist2d(lp.x, lp.z, spot.x, spot.z)).toBeLessThan(2);
    // outside the hull: farther from the van center than its half length
    expect(dist2d(lp.x, lp.z, van.x, van.z)).toBeGreaterThan(VAN.HALF_L);

    // the late toast reaches the wire
    await waitFor("late toast", () => late.events.some((e) => e.t === "toast" && String(e.msg).includes("clocked in late")), 5000);

    // movement works immediately: walk west for a beat
    const x0 = lp.x;
    late.room.send("in", { mx: 0, mz: 1, yaw: -Math.PI / 2, sprint: false });
    await sleep(1200);
    late.room.send("in", { mx: 0, mz: 0, yaw: -Math.PI / 2 });
    await sleep(400);
    const moved = stateOf(late).players.get(late.sid)!;
    expect(moved.x).toBeLessThan(x0 - 0.5);
    late.room.leave();
    bot.room.leave();
    await sleep(300);
  }, 90000);

  it("the late joiner can grab loose loot and the mission proceeds", async () => {
    const bot = await joinBot(h, "Chief", { testQuota: 60, testSeconds: 600, testAt: "escape" });
    await startAtEscape(bot);

    const late = await joinExisting(h, bot.room.roomId, "Temp");
    await waitFor("late synced", () => stateOf(late).players.get(late.sid) !== undefined);
    const lp = stateOf(late).players.get(late.sid)!;

    // nearest loose item (skip the distributor: pre-installed in this knob)
    let pick: { id: string; x: number; z: number } | null = null;
    let best = Infinity;
    for (const [id, it] of stateOf(late).items) {
      if (it.state !== 0 || it.defId === "distributor") continue;
      const d = dist2d(lp.x, lp.z, it.x, it.z);
      if (d < best) {
        best = d;
        pick = { id, x: it.x, z: it.z };
      }
    }
    expect(pick).not.toBeNull();
    await walkTo(late, pick!.x, pick!.z, 0.9);
    late.room.send("act", { k: "grab", id: pick!.id });
    await waitFor("carrying", () => me(late).carrying === pick!.id, 8000);
    expect(stateOf(late).items.get(pick!.id)!.state).toBe(1);
    expect(stateOf(late).phase).toBe("escape");
    late.room.leave();
    bot.room.leave();
    await sleep(300);
  }, 120000);

  it("joining during results still works", async () => {
    const bot = await joinBot(h, "Done", { testQuota: 60, testSeconds: 3 });
    await waitFor("synced", () => stateOf(bot).players.get(bot.sid) !== undefined);
    bot.room.send("act", { k: "ready" });
    await waitFor("ready", () => stateOf(bot).players.get(bot.sid)!.ready);
    bot.room.send("act", { k: "start" });
    await waitFor("results", () => stateOf(bot).phase === "results" && stateOf(bot).outcome === "timeout", 20000);

    const late = await joinExisting(h, bot.room.roomId, "AfterHours");
    await waitFor("joined results room", () => stateOf(late).players.get(late.sid) !== undefined);
    expect(stateOf(late).phase).toBe("results");
    // no late toast outside an active mission
    await sleep(600);
    expect(late.events.some((e) => e.t === "toast" && String(e.msg).includes("clocked in late"))).toBe(false);
    late.room.leave();
    bot.room.leave();
    await sleep(300);
  }, 60000);

  it("a full room still rejects joins", async () => {
    const host = await joinBot(h, "P1");
    await waitFor("host in", () => stateOf(host).players.size >= 1);
    const others = [
      await joinExisting(h, host.room.roomId, "P2"),
      await joinExisting(h, host.room.roomId, "P3"),
      await joinExisting(h, host.room.roomId, "P4"),
    ];
    await waitFor("4 players", () => stateOf(host).players.size === 4);
    let err = "";
    try {
      await joinExisting(h, host.room.roomId, "P5");
    } catch (e) {
      err = String(e);
    }
    expect(err).toMatch(/full|maximum|locked|4/i);
    for (const b of others) b.room.leave();
    host.room.leave();
    await sleep(300);
  }, 30000);
});
