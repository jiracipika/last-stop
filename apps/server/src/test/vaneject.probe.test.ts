// Probe: does a player walking north past the van's rear-left corner get teleported?
import { describe, it, expect } from "vitest";
import { TICK_DT, VAN } from "@last-stop/shared";
import { World } from "../sim/world.js";

describe("van corner eject probe", () => {
  it("walk north at x=-0.4 through z 15..19", async () => {
    const w = new World();
    const p = w.addPlayer("s0", "Walker", 0, true);
    w.startMission();
    let guard = 0;
    while (w.phase === "briefing" && guard++ < 400) w.step(TICK_DT);
    console.log("phase", w.phase, "van", w.van.x.toFixed(2), w.van.z.toFixed(2), "yaw", w.van.yaw.toFixed(2));
    // park the player just south of the rear corner, walking north like the e2e walk
    p.body.x = -0.4;
    p.body.z = 14.5;
    p.connected = true;
    let lastZ = p.body.z;
    for (let i = 0; i < 240; i++) {
      p.input.yaw = Math.atan2(-0.3 - p.body.x, 17.4 - p.body.z);
      p.input.mx = 0;
      p.input.mz = 1;
      w.step(TICK_DT);
      const dz = Math.abs(p.body.z - lastZ);
      if (dz > 0.4) {
        console.log(`TELEPORT at tick ${i}: z ${lastZ.toFixed(2)} -> ${p.body.z.toFixed(2)} (x ${p.body.x.toFixed(2)})`);
      }
      lastZ = p.body.z;
      if (p.body.z > 19) break;
    }
    console.log("final", p.body.x.toFixed(2), p.body.z.toFixed(2));
    expect(p.body.z).toBeGreaterThan(18);
  });
});
