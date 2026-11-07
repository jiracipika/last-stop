// Per-preset renderer benchmark: boots the standard solo mission once per
// quality preset (low / medium / high) and measures idle + walking renderer
// stats, then regenerates docs/PERF.md with the numbers.
//
// LIKE shots.ts, this expects the e2e stack to already be up — it spawns
// nothing itself (server 2667, vite 5173):
//   pnpm --filter @last-stop/web exec vite --port 5173 &
//   PORT=2667 LS_DISABLE_ENEMY=1 pnpm --filter @last-stop/server exec tsx src/index.ts &
// then run from the repo root:
//   pnpm --filter @last-stop/server exec tsx "$PWD/e2e/bench.ts"
//
// The preset is selected the same way the game selects it: localStorage
// "laststop.prefs" is written before page load (App.loadPrefs merges it over
// the defaults) and the Engine constructor reads prefs.quality once at boot.
//
// NOTE: headless Chromium renders through SwiftShader (software GL), so these
// numbers are a floor / preset-comparison check on this box — NOT a
// hardware-GPU benchmark.
import { chromium } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs", "PERF.md");

const PRESETS = ["low", "medium", "high"] as const;
type Preset = (typeof PRESETS)[number];

interface Sample {
  fps: number;
  calls: number;
  tris: number;
  geoms: number;
}

interface Row {
  idle: Sample;
  walk: Sample;
}

// rAF-counted fps over `ms`, sampling renderer.info every ~250 ms inside the
// window (three.js resets render.calls/triangles each frame, so a single
// end-of-window read is one frame's view; the median over the window is far
// less noisy). memory.geometries is a scene-lifetime total.
// String form everywhere: avoids tsx's __name helper leaking into evaluate.
async function sample(page: Page, ms: number): Promise<Sample> {
  return page.evaluate<Sample>(`(async () => {
    const ls = window.__laststop;
    let n = 0;
    const start = performance.now();
    const calls = [];
    const tris = [];
    let nextSnap = 250;
    await new Promise((resolve) => {
      const tick = () => {
        n++;
        const el = performance.now() - start;
        if (el >= nextSnap) {
          nextSnap += 250;
          calls.push(ls.engine().renderer.info.render.calls);
          tris.push(ls.engine().renderer.info.render.triangles);
        }
        if (el < ${ms}) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const med = (a) => {
      if (!a.length) return 0;
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)];
    };
    const r = ls.engine().renderer;
    return {
      fps: Math.round(n / ((performance.now() - start) / 1000)),
      calls: med(calls) || r.info.render.calls,
      tris: med(tris) || r.info.render.triangles,
      geoms: r.info.memory.geometries,
    };
  })()`);
}

// Predicted self position + pointer-lock state. Movement input only drives
// the local walk sim while the player is on foot, so the walk sample must be
// gated on both.
async function readSelf(page: Page): Promise<{ x: number; z: number; locked: boolean }> {
  return page.evaluate(`(() => {
    const e = window.__laststop.engine();
    return { x: e.predictor.body.x, z: e.predictor.body.z, locked: !!(e.input && e.input.locked) };
  })()`);
}

// Pointer lock is what makes WASD trustworthy mid-mission (a lost lock pauses
// the game and pauses the walk). Click-to-catch and wait for the lock to
// actually engage; a couple of retries absorb headless flakiness.
async function ensureLock(page: Page): Promise<void> {
  if ((await readSelf(page)).locked) return;
  for (let i = 0; i < 3; i++) {
    await page.locator(".click-catch").click({ timeout: 3000 }).catch(() => undefined);
    const ok = await page
      .waitForFunction(
        `(() => { const e = window.__laststop.engine(); return !!(e && e.input && e.input.locked); })()`,
        undefined,
        { timeout: 2500 },
      )
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  throw new Error("pointer lock never engaged — walk input would be untrustworthy");
}

// Solo scavenge boots with the client predictor converging on the server
// position: the predictor keeps stepping through lobby/briefing, the server
// teleports the crew to the spawn plan at mission start, and input-sequence
// reconcile then slingshots the predicted body across the spawn lattice until
// it locks onto the authoritative spot (observed ~9 s after the timer appears
// on this box). The camera hard-follows the body every frame, so idle and
// walk are only comparable once the body has SETTLED onto the server position
// and gone still. Gate on exactly that instead of a fixed sleep.
async function awaitSpawnSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    `(() => {
      const w = window;
      if (!w.__lsSettle) w.__lsSettle = { x: NaN, z: NaN, n: 0 };
      const e = window.__laststop.engine();
      const st = e.net.state;
      const me = st && st.players.get(e.net.sid);
      if (!me) { w.__lsSettle.n = 0; return false; }
      const b = e.predictor.body;
      const onServer = Math.hypot(b.x - me.x, b.z - me.z) < 0.25;
      const still = Math.hypot(b.x - w.__lsSettle.x, b.z - w.__lsSettle.z) < 0.05;
      w.__lsSettle = { x: b.x, z: b.z, n: still ? w.__lsSettle.n + 1 : 0 };
      return onServer && w.__lsSettle.n >= 2;
    })()`,
    undefined,
    { timeout: 45000 },
  );
}

// Standard mission boot (same flow as shots.ts) in a context whose
// localStorage already carries the quality preset.
async function bootMission(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".game-title").waitFor({ timeout: 20000 });
  await page.locator("input[maxlength='16']").fill("Bench");
  await page.getByRole("button", { name: "Start a new shift" }).click();
  await page.locator(".invite .code").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();
  await page.locator(".timer").waitFor({ timeout: 30000 });
  await page.locator(".click-catch").click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(800); // let the scene settle (same as shots.ts)
  return page;
}

function table(rows: Record<Preset, Row>): string {
  const line = (p: Preset): string => {
    const r = rows[p];
    return [
      `| ${p.padEnd(6)} `,
      `| ${String(r.idle.fps).padStart(5)} `,
      `| ${String(r.idle.calls).padStart(5)} `,
      `| ${String(r.idle.tris).padStart(6)} `,
      `| ${String(r.walk.fps).padStart(5)} `,
      `| ${String(r.walk.calls).padStart(5)} `,
      `| ${String(r.walk.tris).padStart(6)} `,
      `| ${String(r.idle.geoms).padStart(5)} |`,
    ].join("");
  };
  return [
    "| preset | idle fps | idle calls | idle tris | walk fps | walk calls | walk tris | geometries |",
    "|--------|---------:|-----------:|----------:|---------:|-----------:|----------:|-----------:|",
    line("low"),
    line("medium"),
    line("high"),
  ].join("\n");
}

function doc(rows: Record<Preset, Row>, date: string): string {
  return `# Performance Notes

Benchmark table generated by \`e2e/bench.ts\` (last run ${date}). It boots the
standard solo mission once per quality preset — the preset is picked via the
\`laststop.prefs\` localStorage key before page load, exactly like a saved
player setting — and measures two windows per preset.

## Method and hardware context

- **SwiftShader software renderer on this box**: headless Chromium at
  1280x800 has no hardware GPU behind it, so treat the table as a regression
  floor and a like-for-like preset comparison — not real-player fps.
- Solo crew of 1 on the local stack, enemy AI disabled (\`LS_DISABLE_ENEMY=1\`).
  Boot: title -> create room -> ready up -> start the shift.
- **idle** = standing at spawn after the client predictor has converged onto
  the authoritative spawn position (gated on body == server position and
  still across consecutive reads — see the note below), 2 s rAF-counted
  window.
- **walk** = holding W down the drive for 4 s wall time from that spot,
  gated on pointer lock actually engaging and on a verified player position
  delta (a stood-still walk is an error, not a data point).
- Boot-quiet note the gate exists for: in solo scavenge the client-side
  predictor keeps stepping through lobby/briefing and reconcile then needs a
  few seconds after the timer appears to lock the predicted body onto the
  server spawn; sampling before that lands garbage cells. Worth a look from
  engine/netcode owners — the bench only papers over it.
- draw calls / triangles are the median of ~4 Hz \`renderer.info.render\`
  samples inside each window (three.js resets them per frame); geometries is
  \`renderer.info.memory.geometries\` (scene-lifetime total).
- Loot placement rolls a fresh seed per room, so expect a few calls of
  run-to-run jitter; the preset ordering is the signal, individual cells are
  not exact.
- At SwiftShader fps floors the engine's dt clamp (0.05 s) shortens the
  simulated distance covered by the fixed 4 s walk window on the slowest
  presets, so slow-preset walk cells see a shallower slice of the same path.

## Run it

\`\`\`
pnpm --filter @last-stop/web exec vite --port 5173 &
PORT=2667 LS_DISABLE_ENEMY=1 pnpm --filter @last-stop/server exec tsx src/index.ts &
pnpm --filter @last-stop/server exec tsx "$PWD/e2e/bench.ts"
\`\`\`

Rerunning regenerates this file (table + date) in place. A full sweep runs in
about two minutes on this box.

## Results — preset x idle/walk

${table(rows)}

## What the presets change

Knobs live in \`Engine.applyQuality\` (renderer) and \`World3D.setQuality\`
(world); antialias is fixed at GL-context creation:

- **low** — antialias off, pixel ratio 0.75x (capped at 1), denser fog
  (0.03 vs 0.021), dust motes off, lamp flicker flattened to steady,
  light-cull radius halved.
- **medium** — antialias on, pixel ratio capped at 1.25, everything else on.
- **high** — antialias on, full devicePixelRatio, everything on (the default
  for players who never saved a tier).

Reading the table: the draw-call and triangle columns barely move between
presets — the same view submits the same draws regardless of tier. What the
tiers actually change is per-pixel cost (antialias, pixel ratio) plus
fog/dust/lighting, which under SwiftShader shows up weakly in the fps column
(itself noisy with desktop load) and on real GPUs shows up in frame time.
`;
}

async function main() {
  const t0 = Date.now();
  const browser = await chromium.launch();
  const rows = {} as Record<Preset, Row>;

  for (const preset of PRESETS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((q: string) => {
      localStorage.setItem("laststop.prefs", JSON.stringify({ quality: q }));
    }, preset);

    const page = await bootMission(ctx);
    await awaitSpawnSettled(page);
    const idle = await sample(page, 2000);

    // The walk must actually walk: verify pointer lock and a real position
    // delta, retrying once from a clean lock if the first pass stood still.
    let walk: Sample | null = null;
    for (let attempt = 1; attempt <= 2 && !walk; attempt++) {
      await ensureLock(page);
      const before = await readSelf(page);
      await page.keyboard.down("w");
      const s = await sample(page, 4000);
      await page.keyboard.up("w");
      const after = await readSelf(page);
      const moved = Math.hypot(after.x - before.x, after.z - before.z);
      if (moved >= 0.5) {
        walk = s;
      } else {
        console.log(`BENCH ${preset} walk attempt ${attempt}: player moved only ${moved.toFixed(2)}m, locked=${after.locked} — retrying`);
      }
    }
    if (!walk) throw new Error(`walk never moved the player (preset ${preset})`);

    rows[preset] = { idle, walk };
    console.log(`BENCH ${preset} idle:`, JSON.stringify(idle), " walking:", JSON.stringify(walk));
    await ctx.close();
  }
  await browser.close();

  mkdirSync(dirname(DOC), { recursive: true });
  writeFileSync(DOC, doc(rows, new Date().toISOString().slice(0, 10)));
  console.log(`BENCH wrote ${DOC} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
