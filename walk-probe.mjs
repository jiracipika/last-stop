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
  const x = -0.3, z = 17.4;
  const log = [];
  const until = performance.now() + 18000;
  while (performance.now() < until) {
    const p = ls.net.state.players.get(ls.net.sid);
    const d = Math.hypot(x - p.x, z - p.z);
    if (log.length === 0 || Math.hypot(p.x - log[log.length-1].x, p.z - log[log.length-1].z) > 0.5) log.push({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), d: +d.toFixed(2) });
    if (d < 0.35) return { ok: true, log: log.slice(-8) };
    e.input.yaw = Math.atan2(x - p.x, z - p.z);
    e.input.keys.add("KeyW");
    await new Promise((r) => setTimeout(r, 60));
  }
  e.input.keys.delete("KeyW");
  return { ok: false, log: log.slice(-10) };
});
console.log(JSON.stringify(out, null, 1));
process.exit(0);
