// Baseline/after capture: deterministic screenshots at fixed camera poses plus
// renderer stats. Run with the e2e stack up (server 2667, vite 5173):
//   pnpm --filter @last-stop/web exec vite --port 5173 &
//   PORT=2667 LS_DISABLE_ENEMY=1 pnpm --filter @last-stop/server exec tsx src/index.ts &
//   tsx e2e/shots.ts baseline
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = process.argv[2] ?? "baseline";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots", TAG);
mkdirSync(OUT, { recursive: true });

// Fixed poses: { x, y, z } camera, { tx, ty, tz } look target.
const POSES: { name: string; cam: [number, number, number]; look: [number, number, number] }[] = [
  { name: "01-lot-overview", cam: [10, 15, 24], look: [-6, 1, -10] },
  { name: "02-van-courtyard", cam: [8.5, 2.1, 17.5], look: [0, 1.2, 10] },
  { name: "03-motel-facade-sign", cam: [-6, 2.2, 2], look: [-13, 4.2, -6] },
  { name: "04-walkway-rooms", cam: [8, 1.8, -3.2], look: [-8, 1.5, -8.5] },
  { name: "05-reception", cam: [7.6, 1.7, -8.6], look: [7.2, 1.2, -13.5] },
  { name: "06-corridor", cam: [8.5, 1.7, -16.5], look: [-12, 1.4, -16.5] },
  { name: "07-maintenance", cam: [-8.8, 1.7, -18.6], look: [-11, 1.2, -22] },
  { name: "08-garage", cam: [19, 2.0, -5.6], look: [25, 1.2, -14] },
  { name: "09-gate-escape", cam: [-28, 2.2, 4], look: [-34.5, 1.8, 11] },
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

  // title screen (DOM only — the engine doesn't run here yet)
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".game-title").waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/00-title.png` });
  console.log("shot 00-title");

  // lobby
  await page.locator("input[maxlength='16']").fill("Dir");
  await page.getByRole("button", { name: "Start a new shift" }).click();
  await page.locator(".invite .code").waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/00b-lobby.png` });
  console.log("shot 00b-lobby");

  // into the mission
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();
  await page.locator(".timer").waitFor({ timeout: 30000 });
  await page.locator(".click-catch").click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  // fixed poses
  for (const p of POSES) {
    await page.evaluate(
      `(() => { window.__laststop.engine().frozenCam = ${JSON.stringify({
        x: p.cam[0], y: p.cam[1], z: p.cam[2], tx: p.look[0], ty: p.look[1], tz: p.look[2],
      })}; })()`,
    );
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${p.name}.png` });
    console.log("shot", p.name);
  }

  // perf + stats: walk for 4s with the camera back on the player
  await page.evaluate(`(() => { window.__laststop.engine().frozenCam = null; })()`);
  await page.waitForTimeout(300);
  const stats = await page.evaluate<string, { fps: number; calls: number; tris: number; geoms: number; tex: number }>(`(() => {
    const ls = window.__laststop;
    const r = ls.engine().renderer;
    return { fps: ls.store.state.fps, calls: r.info.render.calls, tris: r.info.render.triangles,
             geoms: r.info.memory.geometries, tex: r.info.memory.textures };
  })()`);
  await page.keyboard.down("w");
  await page.waitForTimeout(4000);
  await page.keyboard.up("w");
  const stats2 = await page.evaluate<string, { fps: number; calls: number; tris: number }>(`(() => {
    const ls = window.__laststop;
    const r = ls.engine().renderer;
    return { fps: ls.store.state.fps, calls: r.info.render.calls, tris: r.info.render.triangles };
  })()`);
  console.log("STATS idle:", JSON.stringify(stats), " walking:", JSON.stringify(stats2));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
