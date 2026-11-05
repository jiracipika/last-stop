// Browser-level gameplay verification: real keyboard input moves YOUR player
// through prediction+server, and a forced socket drop heals through the SDK's
// auto-reconnect without losing the session.
import { test, expect, type Page } from "@playwright/test";

async function enterSoloMission(page: Page): Promise<void> {
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".game-title").waitFor({ timeout: 15000 });
  await page.locator("input[maxlength='16']").fill("Tester");
  await page.getByRole("button", { name: "Start a new shift" }).click();
  await page.locator(".invite .code").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();
  await page.locator(".timer").waitFor({ timeout: 30000 });
  await page.locator(".click-catch").click({ timeout: 5000 }).catch(() => undefined);
}

test("keyboard input drives the player through the real client pipeline", async ({ page }) => {
  await enterSoloMission(page);
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { state: { players: { get(k: string): { x: number; z: number } } }; sid: string } } }).__laststop;
    const me = ls.net.state.players.get(ls.net.sid);
    return { x: me!.x, z: me!.z };
  });

  // walk north for ~2s (spawn faces the motel)
  await page.keyboard.down("w");
  await page.waitForTimeout(2000);
  await page.keyboard.up("w");
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { state: { players: { get(k: string): { x: number; z: number } } }; sid: string } } }).__laststop;
    const me = ls.net.state.players.get(ls.net.sid);
    return { x: me!.x, z: me!.z };
  });
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  expect(moved).toBeGreaterThan(3); // ~2s at walk speed 3.2 m/s

  // flashlight toggles server state
  await page.keyboard.press("f");
  await page.waitForTimeout(600);
  const flash = await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { state: { players: { get(k: string): { flashlight: boolean } } }; sid: string } } }).__laststop;
    return ls.net.state.players.get(ls.net.sid)!.flashlight;
  });
  expect(flash).toBe(true);

  // Q ping lands a marker in replicated state
  await page.keyboard.press("q");
  await page.waitForTimeout(600);
  const markers = await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { state: { markers: unknown[] } } } }).__laststop;
    return ls.net.state.markers.length;
  });
  expect(markers).toBeGreaterThan(0);
}, 60000);

test("a dropped socket reconnects automatically and keeps the session", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterSoloMission(page);
  await page.waitForTimeout(600);

  const sid = await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { sid: string } } }).__laststop;
    return ls.net.sid;
  });

  // force an unconsented socket drop; the SDK should auto-reconnect
  await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { room: { connection: { close(c: number): void } } } } }).__laststop;
    ls.net.room.connection.close(4006);
  });
  await page.waitForTimeout(3500);

  // reconnected: same session, state still ticking (timer text keeps updating)
  const info = await page.evaluate(async () => {
    const ls = (window as unknown as {
      __laststop: { net: { sid: string; state: { phase: string; now: number } } };
    }).__laststop;
    const t1 = ls.net.state.now;
    await new Promise((r) => setTimeout(r, 700));
    return { sid: ls.net.sid, phase: ls.net.state.phase, ticking: ls.net.state.now !== t1 };
  });
  expect(info.sid).toBe(sid);
  expect(info.phase).toBe("scavenge");
  expect(info.ticking).toBe(true);

  // and the player can still move
  const pos1 = await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { state: { players: { get(k: string): { x: number; z: number; connected: boolean } } }; sid: string } } }).__laststop;
    const me = ls.net.state.players.get(ls.net.sid)!;
    return { x: me.x, z: me.z, connected: me.connected };
  });
  console.log("RECON DEBUG pos1:", JSON.stringify(pos1));
  await page.keyboard.down("w");
  await page.waitForTimeout(1400);
  await page.keyboard.up("w");
  await page.waitForTimeout(400);
  const pos2 = await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { state: { players: { get(k: string): { x: number; z: number } } }; sid: string } } }).__laststop;
    const me = ls.net.state.players.get(ls.net.sid)!;
    return { x: me.x, z: me.z };
  });
  console.log("RECON DEBUG pos2:", JSON.stringify(pos2));
  expect(Math.hypot(pos2.x - pos1.x, pos2.z - pos1.z)).toBeGreaterThan(1);
  await ctx.close();
}, 90000);
