// Reproduce the socket scenario at world level: enemy at (0,3.5), victim
// walking in from spawn, medic idle at spawn. Log chase target decisions.
import { World } from "../sim/world.js";
import { dist2d } from "@last-stop/shared";

delete process.env.LS_DISABLE_ENEMY;
const w = new World();
const victim = w.addPlayer("v", "Bait", 4, true);
const medic = w.addPlayer("m", "Medic", 3, false);
w.startMission();
w.phase = "scavenge";
w.briefUntil = 0;
w.testEnemyAt = { x: 0, z: 3.5 };
w.enemy.x = 0;
w.enemy.z = 3.5;
// spawn positions like the real game
victim.body.x = -0.6;
victim.body.z = 9.6;
medic.body.x = 4.2;
medic.body.z = 10.2;

// victim walks north to (0,4.5) then stops (like walkTo)
let walkTicks = Math.round(dist2d(victim.body.x, victim.body.z, 0, 4.5) / (3.2 / 30));
for (let i = 0; i < 600; i++) {
  if (i < walkTicks) {
    const dx = 0 - victim.body.x;
    const dz = 4.5 - victim.body.z;
    const len = Math.hypot(dx, dz) || 1;
    victim.input.mx = 0;
    victim.input.mz = 1;
    victim.input.yaw = Math.atan2(dx / len, dz / len);
  } else {
    victim.input.mz = 0;
  }
  w.step(1 / 30);
  if (i % 15 === 0) {
    const e = w.enemy;
    console.log(
      `t=${(i / 30).toFixed(1)} ai=${e.ai} chase=${e.chaseSid || "-"} e=(${e.x.toFixed(1)},${e.z.toFixed(1)}) yaw=${e.yaw.toFixed(2)} v=(${victim.body.x.toFixed(1)},${victim.body.z.toFixed(1)},hp=${victim.hp}${victim.downed ? ",DOWN" : ""}) m=(${medic.body.x.toFixed(1)},${medic.body.z.toFixed(1)},hp=${medic.hp}${medic.downed ? ",DOWN" : ""}) dv=${dist2d(e.x, e.z, victim.body.x, victim.body.z).toFixed(1)}`,
    );
  }
  if (victim.downed) {
    console.log("VICTIM DOWNED at", (i / 30).toFixed(1));
    break;
  }
}
