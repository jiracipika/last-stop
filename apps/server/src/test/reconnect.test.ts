// Reconnection over a real socket: unconsented drop frees the carried item,
// keeps the seat for the grace window, restores the same session/state, and
// expires if nobody comes back.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@colyseus/sdk";
import {
  bootServer, joinBot, joinExisting, sleep, waitFor, me, walkTo, stateOf,
  type Harness, type Bot,
} from "./helpers.js";
import { RoomState, VAN_START } from "@last-stop/shared";

let h: Harness;

beforeAll(async () => {
  h = await bootServer();
});

afterAll(async () => {
  await h.close();
});

async function startWithWitness(bot: Bot, witness: Bot) {
  await waitFor("synced", () => stateOf(bot).players.get(bot.sid) !== undefined);
  bot.room.send("act", { k: "ready" });
  witness.room.send("act", { k: "ready" });
  await waitFor("both ready", () => [...stateOf(bot).players.values()].every((p) => p.ready));
  bot.room.send("act", { k: "start" });
  await waitFor("scavenge", () => stateOf(bot).phase === "scavenge", 12000);
}

describe("reconnection", () => {
  it("a dropped player reconnects with the same session, position, and stats", async () => {
    const bot = await joinBot(h, "Recon", { testQuota: 60, testSeconds: 900 });
    const watcher = await joinExisting(h, bot.room.roomId, "Witness");
    await startWithWitness(bot, watcher);

    // deliver one light item so stats are non-zero (small pool: bot walks fast)
    const SMALL = ["toolbox", "battery", "cooler", "radio", "raccoon", "typewriter", "barsign"];
    let pick: { id: string; x: number; z: number } | null = null;
    for (const [id, it] of stateOf(bot).items) {
      if (it.state === 0 && it.value >= 55 && SMALL.includes(it.defId)) {
        pick = { id, x: it.x, z: it.z };
        break;
      }
    }
    expect(pick).not.toBeNull();
    await walkTo(bot, pick!.x, pick!.z, 0.9);
    bot.room.send("act", { k: "grab", id: pick!.id });
    await waitFor("carrying", () => me(bot).carrying === pick!.id);
    const rear = { x: VAN_START.x, z: VAN_START.z + 2.45 };
    await walkTo(bot, rear.x, rear.z + 1.0, 0.9);
    bot.room.send("act", { k: "vanDoors" });
    await waitFor("doors", () => stateOf(bot).van.doorsOpen);
    await walkTo(bot, VAN_START.x, VAN_START.z + 3.0, 0.7);
    bot.room.send("act", { k: "release", thrown: false });
    await waitFor("stored", () => stateOf(bot).items.get(pick!.id)!.state === 2);

    const before = stateOf(watcher).players.get(bot.sid)!;
    const token = bot.room.reconnectionToken;
    const sid = bot.sid;
    expect(token).toBeTruthy();

    // simulate a network drop (NOT a consented leave); disable the SDK's own
    // auto-reconnect so we exercise the server-side grace window explicitly
    bot.room.reconnection.enabled = false;
    bot.room.connection.close(4006);
    await waitFor("marked disconnected", () => stateOf(watcher).players.get(sid)?.connected === false);
    // seat still held during grace
    expect(stateOf(watcher).players.get(sid)).toBeDefined();

    // wander somewhere new after reconnecting to prove inputs work again
    const client = new Client(h.url);
    const room2 = (await client.reconnect(token, RoomState)) as unknown as Bot["room"];
    await sleep(800);
    const after = stateOf(watcher).players.get(sid)!;
    expect(room2.sessionId).toBe(sid);
    expect(after.connected).toBe(true);
    expect(after.nick).toBe(before.nick);
    expect(after.deliveredValue).toBeCloseTo(before.deliveredValue, 1);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1.5);
    expect(Math.abs(after.z - before.z)).toBeLessThan(1.5);
    // can still act: walk a few meters west and confirm the position moved
    const px = after.x;
    room2.send("in", { mx: 0, mz: 1, yaw: -Math.PI / 2, sprint: false });
    await sleep(1200);
    room2.send("in", { mx: 0, mz: 0, yaw: -Math.PI / 2 });
    await sleep(400);
    const moved = stateOf(watcher).players.get(sid)!;
    expect(moved.x).toBeLessThan(px - 0.5);
    room2.leave();
    watcher.room.leave();
  }, 120000);

  it("the seat expires after the grace window and the player is removed", async () => {
    const bot = await joinBot(h, "Ghost", { testQuota: 60, testSeconds: 900 });
    const watcher = await joinExisting(h, bot.room.roomId, "Keeper");
    await startWithWitness(bot, watcher);
    const sid = bot.sid;
    const token = bot.room.reconnectionToken;
    bot.room.reconnection.enabled = false;
    bot.room.connection.close(4006);
    await waitFor("marked disconnected", () => stateOf(watcher).players.get(sid)?.connected === false);
    // wait out the 20 s grace (+ slack) with the room kept alive by the watcher
    await sleep(23500);
    expect(stateOf(watcher).players.get(sid)).toBeUndefined();
    // the token no longer works
    let failed = false;
    try {
      const client = new Client(h.url);
      await client.reconnect(token, RoomState);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    watcher.room.leave();
  }, 90000);
});
