// Enemy vs. real clients over sockets: The Caretaker chases, downs a player,
// and a teammate revives them — all observed through replicated state.
// Uses the LS_TEST_MODE enemy-placement hook for determinism.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  bootServer, joinBot, joinExisting, sleep, waitFor, me, walkTo, stateOf,
  type Harness, type Bot,
} from "./helpers.js";
import { dist2d } from "@last-stop/shared";

let h: Harness;
let victim: Bot;
let medic: Bot;

beforeAll(async () => {
  h = await bootServer();
  delete process.env.LS_DISABLE_ENEMY; // this suite needs the enemy stepping
  // enemy placed point-blank south of the victim's stand point (deterministic
  // detection), frozen once someone is down so the revive flow is testable
  victim = await joinBot(h, "Bait", { testQuota: 60, testSeconds: 900, testEnemyX: 0, testEnemyZ: 3.5, testFreezeEnemyAfterDown: true });
  medic = await joinExisting(h, victim.room.roomId, "Medic");
  await waitFor("2 players", () => stateOf(victim).players.size === 2);
  victim.room.send("act", { k: "ready" });
  medic.room.send("act", { k: "ready" });
  await waitFor("both ready", () => [...stateOf(victim).players.values()].every((p) => p.ready));
  victim.room.send("act", { k: "start" });
  await waitFor("scavenge", () => stateOf(victim).phase === "scavenge", 12000);
});

afterAll(async () => {
  process.env.LS_DISABLE_ENEMY = "1";
  await h.close();
});

describe("enemy over the wire", () => {
  it("chases and downs a player it can see; teammate revives them", async () => {
    // victim walks to the enemy's doorstep in the open lot and stands still
    await walkTo(victim, 0, 4.5, 0.8, 40000);
    victim.room.send("in", { mx: 0, mz: 0, yaw: Math.PI });

    // the enemy spots the victim and enters chase (ai code 2)
    await waitFor("chase", () => stateOf(victim).enemy.ai === 2, 25000);
    // strike happens: victim goes down (telemetry on failure)
    try {
      await waitFor("downed", () => me(victim).downed === true, 40000);
    } catch (err) {
      const e = stateOf(victim).enemy;
      const v = me(victim);
      const m = me(medic);
      console.error("ENEMY DEBUG:", {
        ai: e.ai,
        enemyPos: [e.x.toFixed(1), e.z.toFixed(1)],
        forcing: e.forcing,
        victim: [v.x.toFixed(1), v.z.toFixed(1), `hp=${v.hp}`, `downed=${v.downed}`],
        medic: [m.x.toFixed(1), m.z.toFixed(1)],
        events: victim.events.filter((ev) => ["hurt", "down", "strike", "bang"].includes(ev.t)).slice(-6),
      });
      throw err;
    }
    expect(me(victim).hp).toBe(0);
    expect(stateOf(medic).players.get(victim.sid)!.downed).toBe(true); // replicated

    // medic walks over and holds E to revive (close enough for the prompt)
    await walkTo(medic, 0, 4.4, 0.6, 60000);
    const d = dist2d(me(medic).x, me(medic).z, me(victim).x, me(victim).z);
    expect(d).toBeLessThan(2.4);
    medic.room.send("in", { mx: 0, mz: 0, yaw: me(medic).yaw, interact: true });
    await waitFor("revived", () => me(victim).downed === false && me(victim).hp > 0, 20000);
    medic.room.send("in", { mx: 0, mz: 0, yaw: me(medic).yaw, interact: false });
    const revived = me(victim);
    expect(revived.hp).toBeGreaterThanOrEqual(40);
    expect(me(medic).rescues).toBe(1);
    // rescue also visible on the other client
    expect(stateOf(victim).players.get(medic.sid)!.rescues).toBe(1);
  }, 180000);

  it("enemy state replicates consistently to every client", async () => {
    // both clients should agree on the enemy's ai code and position (within
    // patch jitter) while it does whatever it does next
    for (let i = 0; i < 10; i++) {
      const ev = stateOf(victim).enemy;
      const em = stateOf(medic).enemy;
      expect(ev.ai).toBe(em.ai);
      expect(Math.abs(ev.x - em.x)).toBeLessThan(0.6);
      expect(Math.abs(ev.z - em.z)).toBeLessThan(0.6);
      await sleep(300);
    }
    // noise reaction is covered world-level (mission.test); here just confirm
    // the enemy stays live (ai changes or time passes) without desyncing
    expect(stateOf(victim).enemy.phase).toBeGreaterThanOrEqual(1);
  }, 60000);
});
