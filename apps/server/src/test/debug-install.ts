import { bootServer, joinBot, sleep, waitFor, me, walkTo, stateOf } from "./helpers.js";
import { VAN_START, dist2d } from "@last-stop/shared";

async function main() {
  const h = await bootServer();
  const bot = await joinBot(h, "Solo", { testQuota: 60, testSeconds: 600 });
  await waitFor("player synced", () => stateOf(bot).players.get(bot.sid));
  bot.room.send("act", { k: "ready" });
  await waitFor("ready", () => stateOf(bot).players.get(bot.sid)!.ready);
  bot.room.send("act", { k: "start" });
  await waitFor("scavenge", () => stateOf(bot).phase === "scavenge", 12000);
  const st = () => stateOf(bot);

  const partEntry = [...st().items.entries()].find(([, it]) => it.defId === "distributor")!;
  const [partId, part] = partEntry;
  console.log("part at", part.x.toFixed(1), part.z.toFixed(1));
  await walkTo(bot, part.x, part.z, 0.9);
  bot.room.send("act", { k: "grab", id: partId });
  await waitFor("carrying part", () => me(bot).carrying === partId);
  console.log("carrying part; at", me(bot).x.toFixed(1), me(bot).z.toFixed(1));
  const engine = { x: VAN_START.x, z: VAN_START.z - 2.55 };
  await walkTo(bot, engine.x, engine.z - 0.8, 1.0);
  console.log("near engine; at", me(bot).x.toFixed(1), me(bot).z.toFixed(1), "dist:", dist2d(me(bot).x, me(bot).z, engine.x, engine.z).toFixed(2));
  console.log("engine world:", engine.x, engine.z);
  bot.room.send("in", { mx: 0, mz: 0, yaw: me(bot).yaw, interact: true });
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (st().van.partInstalled) break;
  }
  console.log("installed:", st().van.partInstalled);
  console.log("still carrying:", me(bot).carrying);
  console.log("part state:", st().items.get(partId)?.state, "pos", st().items.get(partId)?.x.toFixed(1), st().items.get(partId)?.z.toFixed(1));
  console.log("events tail:", bot.events.filter((e) => ["prog", "install", "toast", "slip", "grab"].includes(e.t)).slice(-6));
  await h.close();
  process.exit(0);
}
main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
