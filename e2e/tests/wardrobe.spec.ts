// Wardrobe e2e: the beginner panels render for a fresh profile, and an outfit
// + nickname change saved in one lobby lands LIVE in the other — roster and
// the 3D avatar mesh (engine rebuilds on color/hat/nick drift). Also pins the
// text-input key isolation: typing spaces in the outfit name field works.
import { test, expect, type Page } from "@playwright/test";

async function gotoTitle(page: Page, timeoutMs = 20000): Promise<void> {
  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator(".game-title")).toBeVisible({ timeout: timeoutMs });
}

/** The look A's engine currently renders for B's avatar, via the dev hook. */
async function avatarLook(page: Page, sid: string): Promise<string | null> {
  return page.evaluate((sidArg) => {
    const ls = (window as unknown as {
      __laststop?: { engine?: () => { avatars: Map<string, { colorIdx: number; hat: number; nick: string }> } };
    }).__laststop;
    const av = ls?.engine?.()?.avatars.get(sidArg);
    return av ? `${av.colorIdx}|${av.hat}|${av.nick}` : null;
  }, sid);
}

test("wardrobe edits land live for the whole crew", async ({ browser }) => {
  test.setTimeout(150_000);
  // Two concurrent WebGL contexts rendering the full scene can starve each
  // other's main threads on integrated GPUs (the click hit-test seizes in the
  // driver). Seed the app's own low-quality tier — the lobby wardrobe doesn't
  // need full-fat shadows to prove replication.
  const lowQuality = () => localStorage.setItem("laststop.prefs", JSON.stringify({ quality: "low" }));
  const ctxA = await browser.newContext();
  await ctxA.addInitScript(lowQuality);
  const pageA = await ctxA.newPage();
  const errors: string[] = [];
  pageA.on("pageerror", (e) => errors.push(String(e)));
  await gotoTitle(pageA);

  // fresh profile: the first-night briefing is open on the title screen
  await expect(pageA.locator(".title-controls")).toHaveAttribute("open", "");
  await expect(pageA.locator(".title-controls .howto-steps li").first()).toBeVisible();

  await pageA.locator("input[maxlength='16']").fill("Ada");
  await pageA.getByRole("button", { name: "Start a new shift" }).click();
  const codeEl = pageA.locator(".invite .code");
  await expect(codeEl).toBeVisible({ timeout: 15000 });
  const code = ((await codeEl.textContent()) ?? "").trim();

  const ctxB = await browser.newContext();
  await ctxB.addInitScript(lowQuality);
  const pageB = await ctxB.newPage();
  // A second WebGL context cold-boots behind the host's attract loop: the
  // DOM lands quickly but the main thread can stay busy baking the world for
  // 10s+ on a loaded box (the documented two-browser family) — be patient.
  await gotoTitle(pageB, 60000);
  await pageB.locator("input[maxlength='16']").fill("Bob");
  await pageB.locator(".join-row input").fill(code);
  await pageB.getByRole("button", { name: "Join crew" }).click();
  await expect(pageA.locator(".roster li:not(.empty)")).toHaveCount(2, { timeout: 15000 });
  await expect(pageB.locator(".roster li:not(.empty)")).toHaveCount(2, { timeout: 30000 });

  // the lobby's beginner panel is open for a first-timer
  await expect(pageB.locator(".lobby-howto")).toHaveAttribute("open", "");
  await expect(pageB.locator(".lobby-howto .howto-steps li").first()).toBeVisible();

  // open the outfit editor; the host's color is disabled for Bob
  await pageB.getByRole("button", { name: "Edit outfit & name" }).click();
  const nickField = pageB.locator(".lobby-outfit .outfit-nick input");
  await expect(nickField).toBeVisible({ timeout: 15000 });
  await expect(pageB.locator(".lobby-outfit .swatch").first()).toBeDisabled();

  // text-input isolation: spaces in the name field must type (jump's
  // preventDefault used to eat them while game input listeners were attached)
  await nickField.click();
  await nickField.fill("Bob The Hauler");
  await pageB.keyboard.press(" ");
  await expect(nickField).toHaveValue("Bob The Hauler ");

  // a free color + the beanie, then one save commits name, color and hat
  await pageB.locator(".lobby-outfit .swatch").nth(3).click();
  await pageB.locator(".lobby-outfit select").selectOption("2");
  await pageB.getByRole("button", { name: "Save outfit" }).click();

  // A's roster shows the new name; A's engine rebuilt B's avatar mesh for the
  // new look (colorIdx|hat|nick as baked at mesh build)
  await expect(pageA.locator(".roster .nick").filter({ hasText: "Bob The Hauler" })).toBeVisible({ timeout: 10000 });
  const sidB = await pageB.evaluate(() => (window as unknown as { __laststop: { net: { sid: string } } }).__laststop.net.sid);
  await expect
    .poll(async () => avatarLook(pageA, sidB), { timeout: 15000 })
    .toBe("3|2|Bob The Hauler");

  // the editor closed and B's roster row carries the new headgear label
  await expect(pageB.locator(".lobby-outfit")).toHaveCount(0);
  await expect(pageB.locator(".roster .nick").filter({ hasText: "Bob The Hauler" }).locator("small")).toHaveText(/Beanie/);

  await pageA.screenshot({ path: "screenshots/wardrobe-host.png" });
  await pageB.screenshot({ path: "screenshots/wardrobe-editor.png" });
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
