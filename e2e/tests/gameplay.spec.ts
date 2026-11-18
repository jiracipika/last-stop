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
  // gas-station stop: buy the flashlight so the F-toggle below is armed
  await page
    .locator(".gas-shelf li")
    .filter({ hasText: "Torchlight" })
    .getByRole("button", { name: "Buy" })
    .click();
  await page.locator(".gas-shelf li").filter({ hasText: "Torchlight" }).getByRole("button", { name: "Purchased" }).waitFor({ timeout: 8000 });
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
  // Replicated fields are accessor-backed, so spreading the schema silently
  // erased avatar height and flashlight state before applying its pose.
  await expect.poll(() => page.evaluate(() => {
    const ls = (window as any).__laststop;
    const avatar = ls.engine().avatars.get(ls.net.sid);
    return {
      finite: Number.isFinite(avatar.group.position.y),
      light: avatar.flashlight.intensity,
    };
  })).toEqual({ finite: true, light: 26 });

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
  const preDropNow = await page.evaluate<number>(`window.__laststop.net.state?.now ?? -1`);
  await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { room: { connection: { close(c: number): void } } } } }).__laststop;
    ls.net.room.connection.close(4006);
  });
  // reconnect + first state patch can land anywhere in a few seconds (SDK
  // backoff); poll until server time has advanced WELL past the pre-drop
  // value — ordinary pre-drop ticking can't satisfy the +2s margin
  await expect
    .poll(
      () => page.evaluate<string, number>(`window.__laststop.net.state?.now ?? -1`),
      { timeout: 15000 },
    )
    .toBeGreaterThan(preDropNow + 2);
  const info = await page.evaluate(`(() => ({
    sid: window.__laststop.net.sid,
    phase: window.__laststop.net.state?.phase ?? null,
  }))()`);
  expect(info.sid).toBe(sid);
  expect(info.phase).toBe("scavenge");

  // and the player can still move
  const pos1 = await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { state: { players: { get(k: string): { x: number; z: number; connected: boolean } } }; sid: string } } }).__laststop;
    const me = ls.net.state.players.get(ls.net.sid)!;
    return { x: me.x, z: me.z, connected: me.connected };
  });
  await page.keyboard.down("w");
  await page.waitForTimeout(1400);
  await page.keyboard.up("w");
  await page.waitForTimeout(400);
  const pos2 = await page.evaluate(() => {
    const ls = (window as unknown as { __laststop: { net: { state: { players: { get(k: string): { x: number; z: number } } }; sid: string } } }).__laststop;
    const me = ls.net.state.players.get(ls.net.sid)!;
    return { x: me.x, z: me.z };
  });
  expect(Math.hypot(pos2.x - pos1.x, pos2.z - pos1.z)).toBeGreaterThan(1);
  await ctx.close();
}, 90000);

test("W moves toward what the camera shows (screen-direction regression)", async ({ page }) => {
  await enterSoloMission(page);
  await page.waitForTimeout(600);

  // camera must look along the character's forward (sin yaw, cos yaw):
  // three.js looks along -Z at yaw 0, so camera yaw = player yaw + PI
  const read = `(() => {
    const ls = window.__laststop;
    const me = ls.net.state.players.get(ls.net.sid);
    const cam = ls.engine().camera;
    return { yaw: me.yaw, x: me.x, z: me.z, camYaw: cam.rotation.y };
  })()`;
  const s0 = await page.evaluate(read);
  let camDelta = (s0.camYaw - s0.yaw - Math.PI) % (2 * Math.PI);
  if (camDelta > Math.PI) camDelta -= 2 * Math.PI;
  if (camDelta < -Math.PI) camDelta += 2 * Math.PI;
  expect(Math.abs(camDelta)).toBeLessThan(0.05);

  // W: movement should align with the camera's view direction
  await page.keyboard.down("w");
  await page.waitForTimeout(1100);
  await page.keyboard.up("w");
  await page.waitForTimeout(400);
  const s1 = await page.evaluate(read);
  const dx = s1.x - s0.x;
  const dz = s1.z - s0.z;
  const len = Math.hypot(dx, dz);
  expect(len).toBeGreaterThan(2);
  const fwd = { x: Math.sin(s0.yaw), z: Math.cos(s0.yaw) };
  expect((dx / len) * fwd.x + (dz / len) * fwd.z).toBeGreaterThan(0.8);

  // D: strafe should align with the character's right vector
  await page.keyboard.down("d");
  await page.waitForTimeout(900);
  await page.keyboard.up("d");
  await page.waitForTimeout(400);
  const s2 = await page.evaluate(read);
  const dx2 = s2.x - s1.x;
  const dz2 = s2.z - s1.z;
  const len2 = Math.hypot(dx2, dz2);
  expect(len2).toBeGreaterThan(1.5);
  const right = { x: -Math.cos(s1.yaw), z: Math.sin(s1.yaw) };
  expect((dx2 / len2) * right.x + (dz2 / len2) * right.z).toBeGreaterThan(0.8);
}, 60000);

