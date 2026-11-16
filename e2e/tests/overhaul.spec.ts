import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  // Same cold-boot budget as gameplay.spec's enterSoloMission: on a
  // software-rendered box the title and the first room state patch can both
  // take seconds — gate the title, then the room code, before touching the
  // roster (a 5s default here failed every attempt on slow hardware).
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".game-title").waitFor({ timeout: 15000 });
  await page.locator("input[maxlength='16']").fill("Mechanic");
  await page.getByRole("button", { name: "Start a new shift" }).click();
  await page.locator(".invite .code").waitFor({ timeout: 15000 });
  await expect(page.locator(".roster .nick")).toContainText("Mechanic");
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();
  await expect(page.locator(".timer")).toBeVisible({ timeout: 30000 });
  await page.locator(".click-catch").click().catch(() => {});
}

// Walk via the real client input/prediction/server pipeline, sampling truth.
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
    } finally { e.input.keys.delete("KeyW"); }
  }, { x, z });
  await page.waitForTimeout(350);
}

async function aim(page: Page, x: number, z: number) {
  await page.evaluate(({ x, z }) => {
    const e = (window as any).__laststop.engine();
    e.input.yaw = Math.atan2(x - e.predictor.renderX(), z - e.predictor.renderZ());
    e.input.pitch = 0;
  }, { x, z });
  await page.waitForTimeout(200);
}

const own = (page: Page) => page.evaluate(() => {
  const n = (window as any).__laststop.net;
  const p = n.state.players.get(n.sid);
  return { seat: p.seat, doors: n.state.van.doorsOpen };
});

test("rear doors open outwards, reveal a bay, and allow passenger boarding", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await start(page);
  await expect(page.locator(".shift-directive")).toContainText("RECOVERY SHIFT");
  await walk(page, -0.3, 17.4);
  await walk(page, 2, 17.4);
  await aim(page, 2, 15.95);
  await expect(page.locator(".prompt")).toContainText("Open van doors");
  await page.keyboard.press("e");
  await expect.poll(() => own(page).then(p => p.doors)).toBe(true);
  await page.waitForTimeout(700);
  const geometry = await page.evaluate(async () => {
    const e = (window as any).__laststop.engine();
    const v = e.vanView.group;
    const left = v.getObjectByName("rear-door-left");
    const right = v.getObjectByName("rear-door-right");
    // A ray down the bay center must reach the cab without hitting a solid rear wall.
    const THREE = await import("/node_modules/.vite/deps/three.js" as string);
    const from = v.localToWorld(new THREE.Vector3(0, 1.2, -3.5));
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(v.quaternion);
    const ray = new THREE.Raycaster(from, direction, 0, 2.2);
    v.updateMatrixWorld(true);
    return { left: left.rotation.y, right: right.rotation.y, blocked: ray.intersectObject(v, true).length };
  });
  expect(geometry.left).toBeGreaterThan(1.5);
  expect(geometry.right).toBeLessThan(-1.5);
  expect(geometry.blocked).toBe(0);
  await page.evaluate(() => {
    (window as any).__laststop.engine().frozenCam = { x: 7, y: 3, z: 20, tx: 2, ty: 1.2, tz: 13.5 };
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath("van-open.png") });
  await page.evaluate(() => { (window as any).__laststop.engine().frozenCam = null; });
  await aim(page, 2, 15.95);
  await expect(page.locator(".prompt")).toContainText("Board van");
  await page.keyboard.press("e");
  await expect.poll(() => own(page).then(p => p.seat)).toBe(2);
  expect(await page.evaluate(() => {
    const ls = (window as any).__laststop;
    let visible = 0;
    ls.engine().avatars.get(ls.net.sid).group.traverse((o: any) => { if ((o.isMesh || o.isSprite) && o.visible) visible++; });
    return visible;
  })).toBe(0);
  expect(errors).toEqual([]);
});

test("driver boards at cab while cargo doors are closed", async ({ page }) => {
  await start(page);
  await walk(page, 4.3, 9.4);
  await walk(page, 4.3, 11.9);
  await aim(page, 3.35, 11.9);
  await expect(page.locator(".prompt")).toContainText("Take the wheel");
  await page.keyboard.press("e");
  await expect.poll(() => own(page).then(p => p.seat)).toBe(1);
  expect((await own(page)).doors).toBe(false);
  await expect(page.locator(".drive-strip")).toContainText("DRIVING");
});
