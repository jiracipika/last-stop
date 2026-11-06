// First visual pass over the shift-report debrief: a solo crew rides out a
// ~20s shift (test server, LS_TEST_MODE), the clock runs out, and the DUSTPAN
// RECOVERY results overlay must render with real letterhead, crew ledger and
// management notes. Screenshots land in two places: playwright's scratch
// test-results/ dir and the committed screenshots/ home (see shots.ts).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, expect } from "@playwright/test";

const SCRATCH_SHOT = join(__dirname, "..", "test-results", "results", "results-e2e.png");
const COMMITTED_SHOT = join(__dirname, "..", "..", "screenshots", "results-e2e.png");

// Same lookalike-free alphabet the UI's room codes use (GameRoom accepts
// /^[A-Z0-9]{5}$/).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

test("solo shift times out into the shift-report debrief", async ({ page, request }) => {
  // The UI cannot pass GameRoom's test knobs, so reserve the room through the
  // matchmake API directly: LS_TEST_MODE on the 2667 test server accepts
  // testSeconds and shortens the shift to ~20s. The browser then joins by
  // code and becomes host (first player in an empty room). Retry on the rare
  // room-code collision.
  let code = "";
  for (let i = 0; i < 3 && !code; i++) {
    const attempt = randomCode();
    const res = await request.post("http://127.0.0.1:2667/matchmake/create/game", {
      data: { code: attempt, testSeconds: 20 },
    });
    if (res.status() === 200 || res.status() === 201) code = attempt;
  }
  expect(code, "room reserved via matchmake API").toBeTruthy();

  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator(".game-title")).toBeVisible({ timeout: 20000 });
  await page.locator("input[maxlength='16']").fill("Tester");
  await page.locator(".join-row input").fill(code);
  await page.getByRole("button", { name: "Join crew" }).click();

  // host of a solo room: ready up, start, ride the briefing out
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();
  await page.locator(".timer").waitFor({ timeout: 30000 });

  // ~5s briefing + 20s shift + patch latency -> results overlay
  await expect(page.locator(".results-panel")).toBeVisible({ timeout: 45000 });

  // letterhead: brand, motto, form line with the new shift length
  await expect(page.locator(".report-brand")).toHaveText("DUSTPAN RECOVERY CO.");
  await expect(page.locator(".report-motto")).toHaveText("WE TOW REGRETS");
  await expect(page.locator(".report-meta")).toContainText("SHIFT LENGTH ");
  await expect(page.locator(".report-meta")).toContainText("CREW OF 1");

  // timeout outcome: clock beat the crew, stamp and headline agree
  await expect(page.locator("h1")).toHaveText("OVERRUN AT DAWN");
  await expect(page.locator(".report-stamp")).toHaveText("DO NOT RE-ENTER");

  // crew ledger: one row, standing-but-stranded status from the server
  await expect(page.locator(".results-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".results-table .row-nick")).toContainText("Tester");
  await expect(page.locator(".results-table td.st-left")).toHaveText("left on site");

  // management notes rendered and non-empty
  const notes = page.locator(".mgmt-notes ul li");
  expect(await notes.count()).toBeGreaterThanOrEqual(1);
  expect((await notes.first().textContent())?.trim().length).toBeGreaterThan(0);

  // instant replay / leave buttons stay wired
  await expect(page.getByRole("button", { name: "Run it back" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to title" })).toBeVisible();

  // the point of this spec: somebody finally LOOKS at this screen
  for (const path of [SCRATCH_SHOT, COMMITTED_SHOT]) {
    mkdirSync(dirname(path), { recursive: true });
  }
  await page.screenshot({ path: SCRATCH_SHOT });
  await page.screenshot({ path: COMMITTED_SHOT });
});
