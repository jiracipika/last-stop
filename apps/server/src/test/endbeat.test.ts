// End-beat: the success pull-away before results, failure immediacy, and the
// testAt:"escape" join knob.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { bootServer, joinBot, sleep, waitFor, me, walkTo, stateOf, type Harness, type Bot } from "./helpers.js";
import { VAN_START } from "@last-stop/shared";

let h: Harness;

beforeAll(async () => {
  h = await bootServer();
});

afterAll(async () => {
  await h.close();
});

async function startSolo(bot: Bot, phase: "scavenge" | "escape"): Promise<void> {
  await waitFor("player synced", () => stateOf(bot).players.get(bot.sid) !== undefined);
  bot.room.send("act", { k: "ready" });
  await waitFor("ready", () => stateOf(bot).players.get(bot.sid)!.ready);
  bot.room.send("act", { k: "start" });
  await waitFor(`phase ${phase}`, () => stateOf(bot).phase === phase, 12000);
}

describe("end beat", () => {
  it("success: outcome lands, van pulls away, results after the pull", async () => {
    const bot = await joinBot(h, "Puller", { testAt: "escape" });
    await startSolo(bot, "escape");
    const st = () => stateOf(bot);
    expect(st().van.partInstalled).toBe(true);
    expect(st().gateOpen).toBe(true);

    // board and drive west to the finish line
    const rear = { x: VAN_START.x, z: VAN_START.z + 2.45 };
    await walkTo(bot, rear.x, rear.z + 1.0, 1.0);
    bot.room.send("act", { k: "vanDoors" });
    await waitFor("van doors open", () => st().van.doorsOpen);
    bot.room.send("act", { k: "enterVan", driver: true });
    await waitFor("driving seat", () => me(bot).seat === 1);

    // drive west; once outcome flips, capture the pull-start position once
    // (re-sampling would chase the van and void the travel assertion)
    const targetYaw = -Math.PI / 2;
    let pullSeen = 0;
    let vanXAtPull = 0;
    const driveStart = Date.now();
    while (!(st().phase === "results" && st().outcome === "escaped")) {
      if (Date.now() - driveStart > 45000) {
        throw new Error("drive-out timeout, van at " + st().van.x.toFixed(1));
      }
      if (st().outcome === "escaped" && vanXAtPull === 0) {
        vanXAtPull = st().van.x; // van.x is never 0 on this drive (west of -56)
      }
      if (st().van.pullT > pullSeen) {
        pullSeen = st().van.pullT;
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

    // the pull played out: progress eased up and the van traveled along its facing
    expect(pullSeen).toBeGreaterThan(0);
    expect(st().van.pullT).toBeGreaterThan(0.9);
    expect(st().van.x).toBeLessThan(vanXAtPull - 3);
    const results = JSON.parse(st().resultsJson);
    expect(results.outcome).toBe("escaped");
    expect(results.rows[0].status).toBe("escaped");
    bot.room.leave();
  }, 120000);

  it("failure: timeout goes straight to results with pullT at 0", async () => {
    const bot = await joinBot(h, "LeftBehind", { testQuota: 60, testSeconds: 3 });
    await startSolo(bot, "scavenge");
    const st = () => stateOf(bot);
    await waitFor("timeout results", () => st().phase === "results" && st().outcome === "timeout", 20000);
    expect(st().van.pullT).toBe(0);
    const results = JSON.parse(st().resultsJson);
    expect(results.outcome).toBe("timeout");
    expect(results.rows[0].status).toBe("left");
    bot.room.leave();
  }, 60000);

  it('testAt:"escape" knob jumps a solo room straight to escape', async () => {
    const bot = await joinBot(h, "Scout", { testAt: "escape" });
    await startSolo(bot, "escape");
    const st = () => stateOf(bot);
    expect(st().phase).toBe("escape");
    expect(st().van.partInstalled).toBe(true);
    expect(st().gateOpen).toBe(true);
    expect(st().outcome).toBe("");
    expect(st().van.pullT).toBe(0);
    bot.room.leave();
  }, 60000);
});
