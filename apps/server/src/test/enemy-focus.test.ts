// chaseSid over the wire: The Caretaker's focus (who it is chasing) is
// replicated on EnemyState and cleared when the chase ends. World-level +
// deterministic — the World is constructed directly like stopslide.test.ts,
// with the enemy parked on the player's doorstep via the test knob.
import { describe, it, expect } from "vitest";
import { World } from "../sim/world.js";
import { ENEMY, TICK_DT } from "@last-stop/shared";

delete process.env.LS_DISABLE_ENEMY; // this suite needs the Caretaker stepping

describe("enemy focus over the wire", () => {
  it("replicates chaseSid on a sighting and clears it after losing sight", () => {
    const w = new World();
    const p = w.addPlayer("p1", "Focus", 0, true);
    w.modifiersOverride = []; // no blackout/wired dice rolls in a sight test
    w.testEnemyAt = { x: 0, z: 3.5 }; // same doorstep the wire test uses
    w.startMission();
    w.phase = "scavenge";
    p.body.x = 0;
    p.body.z = 9; // the clear x=0 lot corridor, 5.5 m south of the enemy
    expect(w.state.enemy.chaseSid).toBe(""); // idle: no target on the wire

    // step until the sighting flips it into chase (ai code 2)
    let ticks = 0;
    while (w.enemy.ai !== "chase" && ticks++ < 60) w.step(TICK_DT);
    expect(w.enemy.ai).toBe("chase");
    expect(w.enemy.chaseSid).toBe("p1"); // AI focus
    expect(w.state.enemy.chaseSid).toBe("p1"); // replicated on EnemyState

    // break line of sight: tuck the player into the laundry (walls plus a
    // closed door between it and the last-seen spot on the open lot)
    p.body.x = -18; // the LAUn nav node, inside room LAU
    p.body.z = -21;
    p.body.vx = 0;
    p.body.vz = 0;

    // within the grace window the focus still holds (grace/3 in, no sight)
    const holdTicks = Math.floor(ENEMY.LOSE_SIGHT_GRACE / 3 / TICK_DT);
    for (let i = 0; i < holdTicks; i++) w.step(TICK_DT);
    expect(w.enemy.chaseSid).toBe("p1");

    // past LOSE_SIGHT_GRACE the chase ends and the wire stops claiming a
    // target. Generous window: it may be mid-door-force when the grace
    // expires (the lost check only runs from the chase state), so allow the
    // grace plus a full fast-force and corridor walk on top.
    const maxTicks = Math.ceil((ENEMY.LOSE_SIGHT_GRACE + 6) / TICK_DT);
    let ran = 0;
    while (w.enemy.chaseSid !== "" && ran++ < maxTicks) w.step(TICK_DT);
    expect(w.enemy.chaseSid).toBe("");
    expect(w.state.enemy.chaseSid).toBe("");
    expect(w.enemy.aiCode).toBe(1); // investigating last-seen, not chasing
  });
});
