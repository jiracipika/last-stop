// Damage-direction telemetry: hurt events that have a positional source
// (the Caretaker's strike) must carry world-space sx/sz so clients can point
// a wedge at whatever hit you. Real sockets, real 30 Hz sim, LS_TEST_MODE
// enemy placement for determinism. Van bumps never hurt players (cargo only),
// so the strike is the only positional cause to cover.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  bootServer, joinBot, sleep, waitFor, stateOf, walkTo,
  type Harness, type Bot,
} from "./helpers.js";

let h: Harness;
let bot: Bot;

beforeAll(async () => {
  h = await bootServer();
  delete process.env.LS_DISABLE_ENEMY; // this suite needs the enemy stepping
  bot = await joinBot(h, "Bait", { testQuota: 60, testSeconds: 900, testEnemyX: 0, testEnemyZ: 3.5 });
  bot.room.send("act", { k: "ready" });
  bot.room.send("act", { k: "start" });
  await waitFor("scavenge", () => stateOf(bot).phase === "scavenge", 12000);
});

afterAll(async () => {
  process.env.LS_DISABLE_ENEMY = "1";
  await h.close();
});

describe("hurt events carry a source position", () => {
  it("caretaker strike stamps sx/sz within reach of the enemy", async () => {
    // stand in the open lot one meter from the placed enemy
    await walkTo(bot, 0, 4.5, 0.8, 40000);
    bot.room.send("in", { mx: 0, mz: 0, yaw: Math.PI });
    await waitFor(
      "hurt with sx/sz",
      () => bot.events.some((ev) => ev.t === "hurt" && typeof ev.sx === "number" && typeof ev.sz === "number"),
      45000,
    );
    await sleep(200); // let the strike's broadcast settle before reading state
    const hurt = bot.events.find((ev) => ev.t === "hurt" && typeof ev.sx === "number")!;
    expect(hurt.cause).toBe("caretaker");
    expect(hurt.sid).toBe(bot.sid);
    const e = stateOf(bot).enemy;
    const spread = Math.hypot(Number(hurt.sx) - e.x, Number(hurt.sz) - e.z);
    expect(spread).toBeLessThan(3);
  }, 60000);
});
