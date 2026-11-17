// Full mission arcs over real clients: WIN (deliver, install, drive out),
// timeout loss, replay reset. Plus deterministic World-level wipe and enemy
// FSM tests (no sockets needed).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { bootServer, joinBot, sleep, waitFor, me, walkTo, stateOf, type Harness, type Bot } from "./helpers.js";
import { World } from "../sim/world.js";
import { mulberry32, VAN_START, dist2d, ENEMY } from "@last-stop/shared";

let h: Harness;

beforeAll(async () => {
  h = await bootServer();
});

afterAll(async () => {
  await h.close();
});

async function startSolo(bot: Bot, extra: Record<string, unknown> = {}) {
  await waitFor("player synced", () => stateOf(bot).players.get(bot.sid) !== undefined);
  bot.room.send("act", { k: "ready" });
  await waitFor("ready", () => stateOf(bot).players.get(bot.sid)!.ready);
  bot.room.send("act", { k: "start", ...extra });
  await waitFor("scavenge", () => stateOf(bot).phase === "scavenge", 12000);
}

describe("mission arcs", () => {
  it("full WIN: deliver quota, install part, gate opens, drive out, results + replay", async () => {
    const bot = await joinBot(h, "SoloWin", { testQuota: 60, testSeconds: 600 });
    await startSolo(bot);

    const st = () => stateOf(bot);
    // 1) deliver one small item (>= 60 value)
    let pick: { id: string; x: number; z: number } | null = null;
    for (const [id, it] of st().items) {
      if (it.state === 0 && it.value >= 60 && !["vending", "arcade", "freezer", "compressor", "fishtank", "clock", "payphone", "mattress", "distributor"].includes(it.defId)) {
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
    await waitFor("doors open", () => st().van.doorsOpen);
    await walkTo(bot, VAN_START.x, VAN_START.z + 3.0, 0.7);
    bot.room.send("act", { k: "release", thrown: false });
    await waitFor("stored", () => st().items.get(pick!.id)!.state === 2);
    expect(st().salvage).toBeGreaterThanOrEqual(60);

    // 2) find + install the distributor
    const partId = [...st().items.entries()].find(([, it]) => it.defId === "distributor")![0];
    const part = st().items.get(partId)!;
    await walkTo(bot, part.x, part.z, 0.9);
    bot.room.send("act", { k: "grab", id: partId });
    await waitFor("carrying part", () => me(bot).carrying === partId);
    const engine = { x: VAN_START.x, z: VAN_START.z - 2.55 };
    await walkTo(bot, engine.x, engine.z - 0.8, 1.0);
    // hold E (interact) until installed
    bot.room.send("in", { mx: 0, mz: 0, yaw: me(bot).yaw, interact: true });
    try {
      await waitFor("installed", () => st().van.partInstalled, 15000);
    } catch (err) {
      const p = st().players.get(bot.sid)!;
      const it = st().items.get(partId)!;
      console.error("INSTALL DEBUG:", {
        carrying: p.carrying,
        partId,
        partState: it.state,
        partPos: [it.x.toFixed(1), it.z.toFixed(1)],
        playerPos: [p.x.toFixed(1), p.z.toFixed(1)],
        engineDist: dist2d(p.x, p.z, engine.x, engine.z).toFixed(2),
        events: bot.events.filter((e) => ["prog", "install", "slip", "stored", "toast"].includes(e.t)).slice(-8),
      });
      throw err;
    }
    bot.room.send("in", { mx: 0, mz: 0, yaw: me(bot).yaw, interact: false });

    // 3) objectives met -> gate + escape phase
    await waitFor("escape phase", () => st().phase === "escape");
    expect(st().gateOpen).toBe(true);

    // 4) board and drive west through the gate
    bot.room.send("act", { k: "vanDoors" }); // close doors? not required; leave open
    await sleep(300);
    await walkTo(bot, rear.x, rear.z + 1.0, 1.0);
    bot.room.send("act", { k: "enterVan", driver: true });
    await waitFor("driving seat", () => me(bot).seat === 1);
    // drive west through the gate: steer the van toward yaw -PI/2 (west)
    const targetYaw = -Math.PI / 2;
    const driveStart = Date.now();
    while (!(st().phase === "results" && st().outcome === "escaped")) {
      if (Date.now() - driveStart > 45000) {
        console.error("DRIVE DEBUG:", {
          seat: st().players.get(bot.sid)!.seat,
          van: [st().van.x.toFixed(1), st().van.z.toFixed(1), st().van.yaw.toFixed(2), st().van.speed.toFixed(1)],
          phase: st().phase,
        });
        throw new Error("drive-out timeout");
      }
      const yaw = st().van.yaw;
      let err = targetYaw - yaw;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      const mx = Math.max(-1, Math.min(1, -err * 2)); // steer: mx is negated into yaw
      const mz = Math.abs(err) < 0.3 ? 1 : 0.3;
      bot.room.send("in", { mx, mz, yaw: targetYaw, sprint: false });
      await sleep(120);
    }
    bot.room.send("in", { mx: 0, mz: 0, yaw: targetYaw });

    // 5) results content
    const results = JSON.parse(st().resultsJson);
    expect(results.outcome).toBe("escaped");
    expect(results.salvage).toBeGreaterThanOrEqual(60);
    expect(results.rows.length).toBe(1);
    expect(results.rows[0].delivered).toBeGreaterThanOrEqual(60);

    // 6) replay resets everything
    const oldItemIds = new Set([...st().items.keys()]);
    bot.room.send("act", { k: "replay" });
    await waitFor("gas stop again", () => st().phase === "lobby");
    expect(me(bot).hasFlashlight).toBe(false);
    expect(me(bot).ready).toBe(false);
    bot.room.send("act", { k: "shop", item: "flashlight" });
    await waitFor("restocked flashlight", () => me(bot).hasFlashlight);
    bot.room.send("act", { k: "ready" });
    await waitFor("ready again", () => me(bot).ready);
    bot.room.send("act", { k: "start" });
    await waitFor("briefing again", () => st().phase === "briefing");
    await waitFor("scavenge again", () => st().phase === "scavenge", 12000);
    expect(st().salvage).toBe(0);
    expect(st().gateOpen).toBe(false);
    expect(st().van.partInstalled).toBe(false);
    expect(st().outcome).toBe("");
    const newItemIds = new Set([...st().items.keys()]);
    for (const id of newItemIds) expect(oldItemIds.has(id)).toBe(false);
    bot.room.leave();
  }, 240000);

  it("timeout loss when the shift runs out", async () => {
    const bot = await joinBot(h, "Slowpoke", { testQuota: 60, testSeconds: 3 });
    await startSolo(bot);
    await waitFor("timeout results", () => stateOf(bot).phase === "results" && stateOf(bot).outcome === "timeout", 20000);
    const results = JSON.parse(stateOf(bot).resultsJson);
    expect(results.outcome).toBe("timeout");
    expect(results.quotaMet).toBe(false);
    bot.room.leave();
  }, 60000);

  it("wipe: everyone down ends the mission (World-level, deterministic)", () => {
    const w = new World();
    const a = w.addPlayer("a", "Ada", 0, true);
    const b = w.addPlayer("b", "Bob", 1, false);
    w.startMission();
    w.phase = "scavenge";
    w.briefUntil = 0;
    w.damagePlayer(a, 999, "test");
    w.damagePlayer(b, 999, "test");
    w.step(1 / 30);
    expect(w.phase).toBe("results");
    expect(w.state.outcome).toBe("wipe");
    expect(a.downed).toBe(true);
    // a revive scenario still works pre-wipe
    const w2 = new World();
    const c = w2.addPlayer("c", "Cal", 2, true);
    w2.startMission();
    w2.phase = "scavenge";
    w2.damagePlayer(c, 999, "test");
    expect(c.downed).toBe(true);
    const d = w2.addPlayer("d", "Dee", 3, false);
    w2.revive(d, c);
    expect(c.downed).toBe(false);
    expect(c.hp).toBe(40);
    expect(d.rescues).toBe(1);
  });

  it("Caretaker FSM: hears noise, investigates; chases on sight; winds up and hits (World-level)", () => {
    delete process.env.LS_DISABLE_ENEMY; // this test needs the enemy stepping
    const w = new World();
    const p = w.addPlayer("p", "Paz", 4, true);
    w.startMission();
    w.phase = "scavenge";
    // drop the enemy right in front of the player with a clear line
    p.body.x = 0;
    p.body.z = 8; // middle of the lot
    p.yaw = Math.PI;
    w.enemy.x = 0;
    w.enemy.z = 12;
    w.enemy.yaw = Math.PI; // facing the player (north)
    w.enemy.ai = "patrol";
    // noise first
    w.noise(0, 8, 30, "horn");
    expect(w.enemy.ai).toBe("investigate");
    // let it see the player
    let guard = 0;
    while ((w.enemy.ai as string) !== "chase" && guard++ < 60) {
      w.step(1 / 30);
    }
    expect(w.enemy.ai as string).toBe("chase");
    // close the distance -> windup -> strike
    guard = 0;
    let gotHit = false;
    while (guard++ < 400 && w.phase === "scavenge") {
      w.step(1 / 30);
      if (p.downed) {
        gotHit = true;
        break;
      }
    }
    expect(gotHit).toBe(true);
    expect(p.hp).toBeLessThanOrEqual(100 - ENEMY.HIT_DAMAGE + 0.01);
    process.env.LS_DISABLE_ENEMY = "1";
  });

  it("disconnect grace: dropped player's items are released immediately", () => {
    const w = new World();
    const p = w.addPlayer("q", "Quinn", 5, true);
    w.startMission();
    w.phase = "scavenge";
    const item = [...w.items.values()][0]!;
    item.body.x = p.body.x + 0.5;
    item.body.z = p.body.z;
    expect(w.tryGrab(p, item.id)).toBe(true);
    // simulate an unexpected drop
    p.connected = false;
    w.releaseCarries(p.sid, "leave");
    expect(item.state).toBe(0);
    expect(item.h0).toBe("");
    expect(p.carrying).toBe("");
    void dist2d;
  });
});

