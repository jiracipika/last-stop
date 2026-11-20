import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173");
await page.locator(".game-title").waitFor({ timeout: 20000 });
await page.locator("input[maxlength='16']").fill("Mechanic");
await page.getByRole("button", { name: "Start a new shift" }).click();
await page.locator(".invite .code").waitFor({ timeout: 15000 });
await page.getByRole("button", { name: "Ready up" }).click();
await page.getByRole("button", { name: /Start the shift/ }).click();
await page.locator(".timer").waitFor({ timeout: 30000 });
await page.locator(".click-catch").click().catch(() => {});
const out = await page.evaluate(async () => {
  const ls = window.__laststop;
  const e = ls.engine();
  const evs = [];
  const off = ls.net.onEvent((ev) => evs.push({ t: ev.t, ...ev }));
  const x = -0.3, z = 17.4;
  const jumps = [];
  let last = null;
  const until = performance.now() + 18000;
  while (performance.now() < until) {
    const p = ls.net.state.players.get(ls.net.sid);
    if (last && Math.hypot(p.x - last.x, p.z - last.z) > 1.0) {
      jumps.push({ from: { x: +last.x.toFixed(2), z: +last.z.toFixed(2) }, to: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) }, seat: p.seat, hidden: p.hidden, at: Math.round(performance.now() % 100000) });
    }
    last = { x: p.x, z: p.z };
    if (Math.hypot(x - p.x, z - p.z) < 0.35) break;
    e.input.yaw = Math.atan2(x - p.x, z - p.z);
    e.input.keys.add("KeyW");
    await new Promise((r) => setTimeout(r, 60));
  }
  e.input.keys.delete("KeyW");
  off();
  return { jumps, evs: evs.map((v) => v.t + (v.k ? ":" + v.k : "")).slice(-12) };
});
console.log(JSON.stringify(out, null, 1));
process.exit(0);
