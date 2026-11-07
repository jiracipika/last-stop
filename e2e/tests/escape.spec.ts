// The escape-phase HUD: with the testAt:"escape" knob (LS_TEST_MODE test
// server) a solo crew lands straight in escape — the van compass and the
// latency chip must render. Screenshots land in the committed screenshots/
// home like results.spec does.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, expect } from "@playwright/test";

const SCRATCH_SHOT = join(__dirname, "..", "test-results", "escape", "escape-hud.png");
const COMMITTED_SHOT = join(__dirname, "..", "..", "screenshots", "escape-hud-e2e.png");

// Same lookalike-free alphabet the UI's room codes use (GameRoom accepts
// /^[A-Z0-9]{5}$/).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

test("escape-phase HUD: van compass and latency chip render", async ({ page, request }) => {
  // The UI cannot pass GameRoom's test knobs, so reserve the room through the
  // matchmake API directly; testAt:"escape" makes the next mission start in
  // the escape phase (part installed, gate open). The browser joins by code
  // and becomes host of the solo room.
  let code = "";
  for (let i = 0; i < 3 && !code; i++) {
    const attempt = randomCode();
    const res = await request.post("http://127.0.0.1:2667/matchmake/create/game", {
      data: { code: attempt, testAt: "escape", testSeconds: 90 },
    });
    if (res.status() === 200 || res.status() === 201) code = attempt;
  }
  expect(code, "room reserved via matchmake API").toBeTruthy();

  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator(".game-title")).toBeVisible({ timeout: 20000 });
  await page.locator("input[maxlength='16']").fill("Scout");
  await page.locator(".join-row input").fill(code);
  await page.getByRole("button", { name: "Join crew" }).click();

  // host of a solo room: ready up and start — the knob skips briefing+scavenge
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();

  // escape HUD: the compass fades in and names the van
  await expect(page.locator(".compass")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".compass")).toContainText("VAN");

  // latency chip: the first probe lands within seconds of connect
  await expect(page.locator(".lat-chip")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".lat-chip")).toContainText("ms");

  for (const path of [SCRATCH_SHOT, COMMITTED_SHOT]) {
    mkdirSync(dirname(path), { recursive: true });
  }
  await page.screenshot({ path: SCRATCH_SHOT });
  await page.screenshot({ path: COMMITTED_SHOT });
});
