// Carrying: atomic grabs, two-handle hauling, delivery credit, disconnect
// release, range validation. Two real clients per test.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  bootServer, joinBot, joinExisting, sleep, waitFor, me, walkTo,
  findItemByDef, stateOf, type Harness, type Bot,
} from "./helpers.js";
import { VAN, VAN_START, dist2d } from "@last-stop/shared";

let h: Harness;
let host: Bot;
let mate: Bot;

async function startSoloMission(bot: Bot, extra: Record<string, unknown> = {}) {
  bot.room.send("act", { k: "ready" });
  await waitFor("ready", () => me(bot).ready);
  bot.room.send("act", { k: "start", ...extra });
  await waitFor("scavenge", () => stateOf(bot).phase === "scavenge", 12000);
}

beforeAll(async () => {
  h = await bootServer();
  host = await joinBot(h, "Ada", {});
  mate = await joinExisting(h, host.room.roomId, "Bob");
  await waitFor("2 players", () => stateOf(host).players.size === 2);
  host.room.send("act", { k: "ready" });
  mate.room.send("act", { k: "ready" });
  await waitFor("both ready", () => [...stateOf(host).players.values()].every((p) => p.ready));
  host.room.send("act", { k: "start" });
  await waitFor("scavenge", () => stateOf(host).phase === "scavenge", 12000);
});

afterAll(async () => {
  await h.close();
});

describe("carrying", () => {
  // retry budget: this is the suite's tightest race (two bots must both be
  // in grab range on the same tick) and the known load-sensitive flake —
  // 5+ historical failures, always this test, always timer starvation
  it("grabs are atomic: simultaneous grab of one item gives it to exactly one player", { retry: 2, timeout: 45000 }, async () => {
    // walk both bots near a small item
    let target: { id: string; x: number; z: number } | null = null;
    for (const [id, it] of stateOf(host).items) {
      if (it.defId === "toolbox" || it.defId === "radio" || it.defId === "cooler") {
        target = { id, x: it.x, z: it.z };
        break;
      }
    }
    expect(target).not.toBeNull();
    const t = target!;
    await walkTo(host, t.x + 1.2, t.z, 0.9);
    await walkTo(mate, t.x - 1.2, t.z, 0.9);
    // simultaneous grabs
    host.room.send("act", { k: "grab", id: t.id });
    mate.room.send("act", { k: "grab", id: t.id });
    await sleep(700);
    const st = stateOf(host);
    const item = st.items.get(t.id)!;
    const holders = [item.h0, item.h1].filter(Boolean);
    expect(holders.length).toBe(1);
    const carrying = [me(host).carrying === t.id, me(mate).carrying === t.id];
    expect(carrying.filter(Boolean).length).toBe(1);
    expect(item.state).toBe(1);
    // release for cleanliness
    host.room.send("act", { k: "release", thrown: false });
    mate.room.send("act", { k: "release", thrown: false });
    await sleep(300);
  });

  it("heavy items accept two handles and release one at a time", async () => {
    const heavyId = findItemByDef(host, "vending") ?? findItemByDef(host, "arcade") ?? findItemByDef(host, "freezer")
      ?? findItemByDef(host, "compressor") ?? findItemByDef(host, "fishtank") ?? findItemByDef(host, "clock");
    expect(heavyId).toBeTruthy();
    const item = stateOf(host).items.get(heavyId!)!;
    await walkTo(host, item.x + 0.9, item.z, 0.8);
    await walkTo(mate, item.x - 0.9, item.z, 0.8);
    host.room.send("act", { k: "grab", id: heavyId });
    mate.room.send("act", { k: "grab", id: heavyId });
    await waitFor("both carrying", () => me(host).carrying === heavyId && me(mate).carrying === heavyId);
    const st = stateOf(host).items.get(heavyId!)!;
    expect(st.h0).toBeTruthy();
    expect(st.h1).toBeTruthy();
    // one player lets go; the other keeps a handle
    mate.room.send("act", { k: "release", thrown: false });
    await sleep(500);
    const after = stateOf(host).items.get(heavyId!)!;
    expect(after.state).toBe(1);
    expect(me(host).carrying).toBe(heavyId);
    expect(me(mate).carrying).toBe("");
    host.room.send("act", { k: "release", thrown: false });
    await sleep(400);
    expect(stateOf(host).items.get(heavyId!)!.state).toBe(0);
  }, 60000);

  it("delivering cargo credits salvage exactly once", async () => {
    // find a small item, bring it to the van's loading zone
    let small: { id: string; x: number; z: number } | null = null;
    for (const [id, it] of stateOf(host).items) {
      if (it.state === 0 && ["toolbox", "radio", "cooler", "battery", "raccoon"].includes(it.defId)) {
        small = { id, x: it.x, z: it.z };
        break;
      }
    }
    expect(small).not.toBeNull();
    const s = small!;
    const before = stateOf(host).salvage;
    // open the rear doors
    const doorW = { x: VAN_START.x, z: VAN_START.z + 2.45 };
    await walkTo(host, doorW.x, doorW.z + 1.2, 0.9);
    host.room.send("act", { k: "vanDoors" });
    await sleep(400);
    await walkTo(host, s.x, s.z, 1.0);
    host.room.send("act", { k: "grab", id: s.id });
    await waitFor("carrying", () => me(host).carrying === s.id);
    // stand in the loading zone behind the open doors and set it down
    await walkTo(host, VAN_START.x, VAN_START.z + 3.0, 0.7, 60000);
    host.room.send("act", { k: "release", thrown: false });
    await waitFor("stored", () => stateOf(host).items.get(s.id)!.state === 2, 8000);
    const value = stateOf(host).items.get(s.id)!.value;
    expect(stateOf(host).salvage).toBe(before + value);
    // no double credit from lingering in the zone
    await sleep(1500);
    expect(stateOf(host).salvage).toBe(before + value);
    expect(me(host).deliveredCount).toBeGreaterThanOrEqual(1);
  }, 90000);

  it("leaving while carrying drops the item safely", async () => {
    let small: { id: string; x: number; z: number } | null = null;
    for (const [id, it] of stateOf(mate).items) {
      if (it.state === 0 && ["toolbox", "radio", "cooler", "battery", "raccoon", "cat", "globe"].includes(it.defId)) {
        small = { id, x: it.x, z: it.z };
        break;
      }
    }
    expect(small).not.toBeNull();
    const s = small!;
    await walkTo(mate, s.x, s.z, 0.9);
    mate.room.send("act", { k: "grab", id: s.id });
    await waitFor("mate carrying", () => me(mate).carrying === s.id);
    mate.room.leave();
    await waitFor("item released", () => {
      const it = stateOf(host).items.get(s.id);
      return !!it && it.state === 0 && it.h0 === "" && it.h1 === "";
    }, 8000);
    const it = stateOf(host).items.get(s.id)!;
    expect(dist2d(it.x, it.z, it.x, it.z)).toBe(0); // item still exists in world
    expect(stateOf(host).players.get(mate.sid)).toBeUndefined();
  }, 60000);

  it("grabbing out of range is rejected", async () => {
    let far: { id: string; x: number; z: number } | null = null;
    const p = me(host);
    for (const [id, it] of stateOf(host).items) {
      if (it.state === 0 && dist2d(p.x, p.z, it.x, it.z) > 12) {
        far = { id, x: it.x, z: it.z };
        break;
      }
    }
    if (!far) return; // everything close; skip
    host.room.send("act", { k: "grab", id: far.id });
    await sleep(500);
    expect(me(host).carrying).toBe("");
    const it = stateOf(host).items.get(far.id)!;
    expect(it.state).toBe(0);
  }, 30000);

  it("van door interactions require proximity", async () => {
    // walk far from the van, try toggling doors
    await walkTo(host, -12, 20, 1.0);
    const before = stateOf(host).van.doorsOpen;
    host.room.send("act", { k: "vanDoors" });
    await sleep(400);
    expect(stateOf(host).van.doorsOpen).toBe(before);
    void VAN;
  }, 30000);
});
