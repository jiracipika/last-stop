// The full crew experience: four clients in one room complete a mission
// together — two-handle heavy delivery, part install, everyone boards, drives
// out, and all four clients see the same win.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { bootServer, joinBot, joinExisting, sleep, waitFor, me, walkTo, stateOf, type Harness, type Bot } from "./helpers.js";
import { VAN_START, VAN, dist2d } from "@last-stop/shared";

let h: Harness;
let bots: Bot[] = [];

beforeAll(async () => {
  h = await bootServer();
});

afterAll(async () => {
  await h.close();
});

function findItem(bot: Bot, pred: (defId: string) => boolean): { id: string; x: number; z: number } | null {
  for (const [id, it] of stateOf(bot).items) {
    if (it.state === 0 && pred(it.defId)) return { id, x: it.x, z: it.z };
  }
  return null;
}

const HEAVY = ["vending", "arcade", "compressor", "freezer", "fishtank", "clock"];

describe("four-crew cooperative mission", () => {
  it("delivers a two-handle heavy, installs the part, everyone escapes together", async () => {
    // 4 bots join one room
    const host = await joinBot(h, "Ari", { testQuota: 160, testSeconds: 1200 });
    bots = [host];
    for (const nick of ["Bo", "Cyd", "Dee"]) {
      bots.push(await joinExisting(h, host.room.roomId, nick));
    }
    await waitFor("4 players", () => stateOf(host).players.size === 4);
    const [ari, bo, cyd, dee] = bots as [Bot, Bot, Bot, Bot];
    for (const b of bots) b.room.send("act", { k: "ready" });
    await waitFor("all ready", () => [...stateOf(host).players.values()].every((p) => p.ready));
    host.room.send("act", { k: "start" });
    await waitFor("scavenge", () => stateOf(host).phase === "scavenge", 15000);
    const st = () => stateOf(host);

    // ---- open the van's rear doors (Ari) ----
    const rear = { x: VAN_START.x, z: VAN_START.z + 2.45 };
    await walkTo(ari, rear.x, rear.z + 1.1, 0.9, 40000);
    ari.room.send("act", { k: "vanDoors" });
    await waitFor("van doors open", () => st().van.doorsOpen);

    // ---- heavy with two handles: Ari carries, Bo joins at the van ----
    const heavy = findItem(host, (d) => HEAVY.includes(d));
    expect(heavy).not.toBeNull();
    await walkTo(ari, heavy!.x, heavy!.z, 0.9, 60000);
    ari.room.send("act", { k: "grab", id: heavy!.id });
    await waitFor("ari carrying heavy", () => me(ari).carrying === heavy!.id);
    // haul it to the loading zone (solo-heavy pace is slow — allow time).
    // Stand just south of the van's rear so the held item sits inside the zone.
    await walkTo(ari, rear.x, rear.z + 0.2, 0.5, 120000);

    // Bo takes the second handle next to the van and they set it down together
    const heavyNow = st().items.get(heavy!.id)!;
    await walkTo(bo, heavyNow.x - 0.9, heavyNow.z, 1.2, 60000);
    bo.room.send("act", { k: "grab", id: heavy!.id });
    await waitFor("bo on handle 2", () => me(bo).carrying === heavy!.id);
    const item = st().items.get(heavy!.id)!;
    expect(item.h0).toBeTruthy();
    expect(item.h1).toBeTruthy();
    ari.room.send("act", { k: "release", thrown: false });
    bo.room.send("act", { k: "release", thrown: false });
    await waitFor("heavy stored", () => st().items.get(heavy!.id)!.state === 2, 10000);
    expect(st().salvage).toBeGreaterThanOrEqual(st().quota);

    // ---- Cyd finds and installs the distributor ----
    const part = findItem(host, (d) => d === "distributor");
    expect(part).not.toBeNull();
    await walkTo(cyd, part!.x, part!.z, 0.9, 60000);
    cyd.room.send("act", { k: "grab", id: part!.id });
    await waitFor("cyd carrying part", () => me(cyd).carrying === part!.id);
    const engine = { x: VAN_START.x, z: VAN_START.z - VAN.ENGINE_POINT.z }; // front (north)
    await walkTo(cyd, engine.x, engine.z - 0.8, 1.0, 90000);
    cyd.room.send("in", { mx: 0, mz: 0, yaw: me(cyd).yaw, interact: true });
    await waitFor("installed", () => st().van.partInstalled, 20000);
    cyd.room.send("in", { mx: 0, mz: 0, yaw: me(cyd).yaw, interact: false });

    // ---- objectives met: gate + escape phase ----
    await waitFor("escape phase", () => st().phase === "escape");
    expect(st().gateOpen).toBe(true);

    // ---- everyone boards (Dee drives) ----
    await walkTo(dee, rear.x, rear.z + 1.0, 1.0, 60000);
    dee.room.send("act", { k: "enterVan", driver: true });
    await waitFor("dee driving", () => me(dee).seat === 1);
    for (const b of [ari, bo, cyd]) {
      await walkTo(b, rear.x, rear.z + 1.0, 1.2, 60000);
      b.room.send("act", { k: "enterVan", driver: false });
      await waitFor(`${b.sid} seated`, () => me(b).seat > 0, 8000);
    }
    expect([...st().players.values()].filter((p) => p.seat > 0).length).toBe(4);

    // ---- drive west through the gate ----
    const targetYaw = -Math.PI / 2;
    const driveStart = Date.now();
    while (!(st().phase === "results" && st().outcome === "escaped")) {
      if (Date.now() - driveStart > 60000) throw new Error("crew drive-out timeout: van at " + st().van.x.toFixed(1));
      const yaw = st().van.yaw;
      let err = targetYaw - yaw;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      dee.room.send("in", { mx: Math.max(-1, Math.min(1, -err * 2)), mz: Math.abs(err) < 0.3 ? 1 : 0.3, yaw: targetYaw });
      await sleep(120);
    }
    dee.room.send("in", { mx: 0, mz: 0, yaw: targetYaw });

    // ---- all four clients agree on the win and the results ----
    for (const b of bots) {
      await waitFor(`results for ${me(b).nick}`, () => stateOf(b).phase === "results" && stateOf(b).outcome === "escaped", 10000);
      const results = JSON.parse(stateOf(b).resultsJson);
      expect(results.outcome).toBe("escaped");
      expect(results.rows).toHaveLength(4);
      expect(results.salvage).toBeGreaterThanOrEqual(160);
    }
    const rows = JSON.parse(st().resultsJson).rows as { nick: string; delivered: number }[];
    expect(rows.find((r) => r.nick === "Ari")!.delivered).toBeGreaterThan(0);
    void dist2d;
  }, 420000);
});
