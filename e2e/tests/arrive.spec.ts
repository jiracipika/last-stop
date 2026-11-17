// The drive-in course (e2e): with the testArrive:true knob (LS_TEST_MODE test
// server) a solo shift opens in the van on the old road with the lone player
// at the wheel. The spec drives the real course wire-level (engine input
// injection — the pane may be backgrounded, rAF is not trusted), threads the
// three gates, parks, and asserts the scavenge handoff plus the exit-driver
// designation. Screenshots land in the committed screenshots/ home.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, expect } from "@playwright/test";

const SCRATCH_SHOT = join(__dirname, "..", "test-results", "arrive", "drive-in.png");
const COMMITTED_SHOT = join(__dirname, "..", "..", "screenshots", "arrive-e2e.png");

// Same lookalike-free alphabet the UI's room codes use (GameRoom accepts
// /^[A-Z0-9]{5}$/).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

interface ArriveState {
  phase: string;
  stage: number;
  driver: string;
  vanX: number;
  seat: number;
}

test("drive-in course: crew rides in, driver threads the gates and parks", async ({ page, request }) => {
  // Reserve the room through the matchmake API: testArrive turns the drive-in
  // course ON for this room (the e2e server defaults it off).
  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator(".game-title")).toBeVisible({ timeout: 20000 });
  await page.locator("input[maxlength='16']").fill("Wheelman");

  let code = "";
  for (let i = 0; i < 3 && !code; i++) {
    const attempt = randomCode();
    const res = await request.post("http://127.0.0.1:2667/matchmake/create/game", {
      data: { code: attempt, testArrive: true, testSeconds: 120 },
    });
    if (res.status() === 200 || res.status() === 201) code = attempt;
  }
  expect(code, "room reserved via matchmake API").toBeTruthy();

  await page.locator(".join-row input").fill(code);
  await page.getByRole("button", { name: "Join crew" }).click();
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();

  // briefing (5 s) rolls into the drive-in: the course tracker + drive strip
  // name the solo player as the driver
  await expect(page.locator(".course-track")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".course-track")).toContainText("DRIVE-IN COURSE");
  await expect(page.locator(".drive-strip")).toContainText("DRIVING THE COURSE");

  const read = () =>
    page.evaluate((): ArriveState | null => {
      const ls = (window as unknown as {
        __laststop?: {
          net: { state: { phase: string; course: { stage: number; driver: string }; van: { x: number }; players: Map<string, { seat: number }> }; sid: string };
          engine: () => { input: { yaw: number; keys: Set<string> } };
        };
      }).__laststop;
      if (!ls) return null;
      return {
        phase: ls.net.state.phase,
        stage: ls.net.state.course.stage,
        driver: ls.net.state.course.driver,
        vanX: ls.net.state.van.x,
        seat: ls.net.state.players.get(ls.net.sid)?.seat ?? -1,
      };
    });

  // solo shift: the lone player is necessarily in the driver's seat
  await expect.poll(async () => (await read())?.seat).toBe(1);

  // drive the course wire-level: face east (the gates run +x along the road)
  // and hold throttle. The engine sends the input frames at its own 20 Hz.
  await page.evaluate(() => {
    const ls = (window as unknown as { __laststop?: { engine: () => { input: { yaw: number; keys: Set<string> } } } }).__laststop;
    ls!.engine().input.yaw = Math.PI / 2;
    ls!.engine().input.keys.add("KeyW");
  });
  // the gates tick over in order while the HUD tracker follows
  await expect.poll(async () => (await read())?.stage, { timeout: 40000 }).toBe(3);
  await expect(page.locator(".course-track")).toContainText("PARK AT THE RING");

  // park inside the ring: the shift clock starts and scavenge takes over
  await expect.poll(async () => (await read())?.phase, { timeout: 40000 }).toBe("scavenge");
  const final = await read();
  expect(final?.driver, "the wheel-holder at park is the exit driver").toBeTruthy();

  // the scavenge HUD replaced the course tracker
  await expect(page.locator(".timer")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".course-track")).toHaveCount(0);
  await expect(page.locator(".shift-directive")).toContainText("RECOVERY SHIFT");

  await page.evaluate(() => {
    const ls = (window as unknown as { __laststop?: { engine: () => { input: { keys: Set<string> } } } }).__laststop;
    ls!.engine().input.keys.clear();
  });

  for (const path of [SCRATCH_SHOT, COMMITTED_SHOT]) {
    mkdirSync(dirname(path), { recursive: true });
  }
  await page.screenshot({ path: SCRATCH_SHOT });
  await page.screenshot({ path: COMMITTED_SHOT });
});
