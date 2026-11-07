// Late join e2e: a friend can clock in mid-shift through the normal join
// flow, and invite links pre-fill the title screen's join code. The room is
// reserved through the matchmake API with LS_TEST_MODE knobs (same trick as
// escape.spec.ts) so the shift is already live in the escape phase when the
// second browser joins. Screenshots land in two places: playwright's scratch
// test-results/ dir and the committed screenshots/ home (see results.spec.ts).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

const SCRATCH_SHOT = join(__dirname, "..", "test-results", "latejoin", "late-joined.png");
const COMMITTED_SHOT = join(__dirname, "..", "..", "screenshots", "latejoin-e2e.png");

// Same lookalike-free alphabet the UI's room codes use (GameRoom accepts
// /^[A-Z0-9]{5}$/).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

async function gotoTitle(page: Page): Promise<void> {
  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator(".game-title")).toBeVisible({ timeout: 20000 });
}

type Body = { x: number; z: number };
const readMyBody = (page: Page): Promise<Body> =>
  page.evaluate<Body>(() => {
    const ls = (window as unknown as {
      __laststop: { net: { state: { players: { get(k: string): Body | undefined } }; sid: string } };
    }).__laststop;
    const me = ls.net.state.players.get(ls.net.sid);
    if (!me) throw new Error("late joiner has no replicated body");
    return { x: me.x, z: me.z };
  });

test("a friend can clock in mid-shift", async ({ browser, request }) => {
  // Reserve a room that starts straight in the escape phase with a 90s clock.
  // Retry on the rare room-code collision.
  let code = "";
  for (let i = 0; i < 3 && !code; i++) {
    const attempt = randomCode();
    const res = await request.post("http://127.0.0.1:2667/matchmake/create/game", {
      data: { code: attempt, testAt: "escape", testSeconds: 90 },
    });
    if (res.status() === 200 || res.status() === 201) code = attempt;
  }
  expect(code, "room reserved via matchmake API").toBeTruthy();

  // Host: join the reserved room, ready up, start. The testAt knob skips
  // briefing+scavenge, so the mission is live in escape right away.
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await gotoTitle(pageA);
  await pageA.locator("input[maxlength='16']").fill("Host");
  await pageA.locator(".join-row input").fill(code);
  await pageA.getByRole("button", { name: "Join crew" }).click();
  await pageA.getByRole("button", { name: "Ready up" }).click();
  await pageA.getByRole("button", { name: /Start the shift/ }).click();
  await expect(pageA.locator(".timer")).toBeVisible({ timeout: 30000 });

  // Late joiner: a second browser joins the same code mid-mission.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await gotoTitle(pageB);
  await pageB.locator("input[maxlength='16']").fill("Late");
  await pageB.locator(".join-row input").fill(code);
  await pageB.getByRole("button", { name: "Join crew" }).click();

  // Inverse of lobby.spec's bogus-code case (there: a "Could not join" toast
  // and the title screen staying up): a successful late join drops B straight
  // into the mission HUD, title screen gone.
  await expect(pageB.locator(".game-title")).toHaveCount(0, { timeout: 20000 });

  // the crew hears about it: "<nick> clocked in late - get to work." rides
  // the ev channel as a toast
  await expect(pageA.locator(".toasts")).toContainText("clocked in late", { timeout: 15000 });

  // B's HUD renders live: mission clock within 20s of the join, and the
  // roster shows the host as a teammate.
  await expect(pageB.locator(".timer")).toBeVisible({ timeout: 20000 });
  await expect(pageB.locator(".team .mate .m-nick")).toHaveText("Host", { timeout: 10000 });

  // B can act: grab pointer lock via the click-catch overlay, then walk. The
  // replicated body has to move under local input, same probe as gameplay.spec.
  await pageB.locator(".click-catch").click({ timeout: 5000 }).catch(() => undefined);
  const before = await readMyBody(pageB);
  await pageB.keyboard.down("w");
  await pageB.waitForTimeout(2000);
  await pageB.keyboard.up("w");
  await pageB.waitForTimeout(500);
  const after = await readMyBody(pageB);
  // 2s at walk speed 3.2 m/s; B spawns in the open lot just past the van's
  // front bumper facing away from it, so forward is unobstructed
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1.5);

  for (const path of [SCRATCH_SHOT, COMMITTED_SHOT]) {
    mkdirSync(dirname(path), { recursive: true });
  }
  await pageB.screenshot({ path: SCRATCH_SHOT });
  await pageB.screenshot({ path: COMMITTED_SHOT });

  await ctxA.close();
  await ctxB.close();
});

test("invite link pre-fills the join code", async ({ page }) => {
  // clean code: filled verbatim and focused, ready for a nick + Enter
  await page.goto("http://127.0.0.1:5173/?code=ABCDE");
  const joinInput = page.locator(".join-row input");
  await expect(joinInput).toHaveValue("ABCDE", { timeout: 10000 });
  await expect(joinInput).toBeFocused();

  // messy codes are sanitized: uppercase, strip everything outside A-Z0-9,
  // cap at 5 chars ("ab1xyz!" -> "AB1XYZ" -> "AB1XY")
  await page.goto("http://127.0.0.1:5173/?code=ab1xyz!");
  await expect(page.locator(".join-row input")).toHaveValue("AB1XY", { timeout: 10000 });
});
