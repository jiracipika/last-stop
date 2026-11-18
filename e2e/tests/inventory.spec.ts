// Pack slots + the golf cart through the real client pipeline: reserve a room
// with the testItemAt knob (LS_TEST_MODE test server drops a toolbox on the
// asphalt beside the van), then drive everything with the real keyboard,
// prompts and HUD the way a player would.
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

/** Title → reserve a testItemAt room via the matchmake API → join by code →
 *  ready → start → first scavenge frame. */
async function joinProbeRoom(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator(".game-title")).toBeVisible({ timeout: 20000 });
  await page.locator("input[maxlength='16']").fill("Packer");

  let code = "";
  for (let i = 0; i < 3 && !code; i++) {
    const attempt = randomCode();
    const res = await request.post("http://127.0.0.1:2667/matchmake/create/game", {
      data: { code: attempt, testItemAt: true },
    });
    if (res.status() === 200 || res.status() === 201) code = attempt;
  }
  expect(code, "room reserved via matchmake API").toBeTruthy();

  await page.locator(".join-row input").fill(code);
  await page.getByRole("button", { name: "Join crew" }).click();
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();
  await page.locator(".timer").waitFor({ timeout: 30000 });
  await page.locator(".click-catch").click().catch(() => undefined);
}

// Walk via the real client input/prediction/server pipeline (same contract as
// overhaul.spec's helper).
async function walk(page: Page, x: number, z: number) {
  await page.evaluate(async ({ x, z }) => {
    const ls = (window as any).__laststop;
    const e = ls.engine();
    const until = performance.now() + 18000;
    try {
      while (performance.now() < until) {
        const p = ls.net.state.players.get(ls.net.sid);
        if (Math.hypot(x - p.x, z - p.z) < 0.35) return;
        e.input.yaw = Math.atan2(x - p.x, z - p.z);
        e.input.keys.add("KeyW");
        await new Promise((r) => setTimeout(r, 60));
      }
      throw new Error(`Could not walk to ${x}, ${z}`);
    } finally {
      e.input.keys.delete("KeyW");
    }
  }, { x, z });
  await page.waitForTimeout(350);
}

async function aim(page: Page, x: number, z: number) {
  await page.evaluate(({ x, z }) => {
    const e = (window as any).__laststop.engine();
    e.input.yaw = Math.atan2(x - e.predictor.renderX(), z - e.predictor.renderZ());
    e.input.pitch = 0;
  }, { x, z });
  await page.waitForTimeout(250);
}

const own = (page: Page) =>
  page.evaluate(() => {
    const n = (window as any).__laststop.net;
    const p = n.state.players.get(n.sid);
    return { sid: n.sid, x: p.x, z: p.z, seat: p.seat, slots: [...p.slots] };
  });

test("E stows small loot into the pack; slots select and drop", async ({ page, request }) => {
  await joinProbeRoom(page, request);

  // the testItemAt toolbox by the van's rear-right
  const tool = await page.evaluate(() => {
    const ls = (window as any).__laststop;
    for (const [id, it] of ls.net.state.items) {
      if (it.defId === "toolbox" && it.state === 0 && Math.hypot(it.x - 4.2, it.z - 16.6) < 1) {
        return { id, x: it.x, z: it.z };
      }
    }
    return null;
  });
  expect(tool, "probe toolbox spawned beside the van").toBeTruthy();

  // Walk around the van hull to reach the toolbox from the open lot.
  await walk(page, -0.4, 17.2);
  await walk(page, tool!.x, tool!.z);
  await aim(page, tool!.x, tool!.z);
  await expect(page.locator(".prompt")).toContainText("Stow", { timeout: 5000 });
  await page.keyboard.press("e");

  // slot 1 fills, the item leaves the world, the HUD strip shows it
  await expect
    .poll(async () => {
      const me = await own(page);
      return me.slots[0];
    })
    .toBe(tool!.id);
  await expect(page.locator(".pack .pack-slot.full")).toHaveCount(1);
  await expect(page.locator(".pack .pack-slot.full")).toContainText("Roadie Toolbox");

  // 1/2/3 select slots through the real key path. Poll the server ack before
  // pressing G: dropSlot reads slotSel SERVER-side, so pressing early (before
  // the "1" round-trip lands) would target the still-empty slot 2 and no-op.
  await page.keyboard.press("2");
  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).__laststop.net.state.players.get((window as any).__laststop.net.sid).slotSel),
    )
    .toBe(1);
  await page.keyboard.press("1");
  await expect
    .poll(async () =>
      page.evaluate(() => (window as any).__laststop.net.state.players.get((window as any).__laststop.net.sid).slotSel),
    )
    .toBe(0);

  // G drops the selected pack item back into the world
  await page.keyboard.press("g");
  await expect
    .poll(async () => {
      const me = await own(page);
      return me.slots[0];
    })
    .toBe("");
  const dropped = await page.evaluate((id: string) => {
    const ls = (window as any).__laststop;
    return ls.net.state.items.get(id).state;
  }, tool!.id);
  expect(dropped).toBe(0);
}, 90000);

test("golf cart: board with E, drive with W, hop back out", async ({ page, request }) => {
  await joinProbeRoom(page, request);

  // step up beside the cart (it parks by the gas pumps, facing east)
  await walk(page, -22.2, 19.6);
  await aim(page, -23.6, 19.6);
  await expect(page.locator(".prompt")).toContainText("Drive the golf cart", { timeout: 5000 });
  await page.keyboard.press("e");
  await expect.poll(async () => (await own(page)).seat).toBe(5);
  await expect(page.locator(".drive-strip")).toContainText("DRIVING THE CART");

  // real keyboard throttle: the cart must actually move under the driver
  const x0 = await page.evaluate(() => (window as any).__laststop.net.state.cart.x);
  await page.keyboard.down("w");
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => (window as any).__laststop.net.state.cart.speed)) || 0), { timeout: 8000 })
    .toBeGreaterThan(0.5);
  await page.waitForTimeout(900);
  await page.keyboard.up("w");
  const x1 = await page.evaluate(() => (window as any).__laststop.net.state.cart.x);
  expect(Math.abs(x1 - x0)).toBeGreaterThan(1);

  // space handbrake to a stop, then E hops out
  await page.keyboard.down("Space");
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => (window as any).__laststop.net.state.cart.speed)) || 0), { timeout: 8000 })
    .toBeLessThan(1.4);
  await page.keyboard.up("Space");
  await page.keyboard.press("e");
  await expect.poll(async () => (await own(page)).seat).toBe(0);
  const driver = await page.evaluate(() => (window as any).__laststop.net.state.cart.driver);
  expect(driver).toBe("");
}, 120000);
