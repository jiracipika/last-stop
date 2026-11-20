// Browser flow: create a room in one context, join by code in another,
// ready up, start the mission, and see the in-mission HUD on both clients.
import { test, expect, type Page } from "@playwright/test";
import { newLowPowerContext } from "./lowPower.js";

async function gotoTitle(page: Page): Promise<void> {
  await page.goto("http://127.0.0.1:5173");
  await expect(page.locator(".game-title")).toBeVisible({ timeout: 20000 });
}

async function phaseOf(page: Page): Promise<"briefing" | "mission" | "lobby" | "unknown"> {
  return page.evaluate(() => {
    if (document.querySelector(".briefing")) return "briefing" as const;
    if (document.querySelector(".timer")) return "mission" as const;
    if (document.querySelector(".lobby-panel")) return "lobby" as const;
    return "unknown" as const;
  });
}

test("two browsers join one room by code, ready up, and start the shift", async ({ browser }) => {
  // Two fresh browser contexts on software-rendered WebGL each pay a cold
  // boot; the global 90s budget was repeatedly spent before the briefing
  // finished on slow boxes (the same flow passes comfortably in one browser).
  test.setTimeout(150_000);
  const ctxA = await newLowPowerContext(browser);
  const pageA = await ctxA.newPage();
  const pageBErrors: string[] = [];
  pageA.on("pageerror", (e) => pageBErrors.push(String(e)));
  await gotoTitle(pageA);
  await pageA.locator("input[maxlength='16']").fill("Ada");

  await pageA.getByRole("button", { name: "Start a new shift" }).click();

  // room code appears in the crew room
  const codeEl = pageA.locator(".invite .code");
  await expect(codeEl).toBeVisible({ timeout: 15000 });
  const code = (await codeEl.textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  // second browser joins with the code
  const ctxB = await newLowPowerContext(browser);
  const pageB = await ctxB.newPage();
  await gotoTitle(pageB);
  await pageB.locator("input[maxlength='16']").fill("Bob");
  await pageB.locator(".join-row input").fill(code);
  await pageB.getByRole("button", { name: "Join crew" }).click();

  // both rosters show two players (joining browser's first state patch can
  // lag a tick under suite load — same budget as pageA's)
  await expect(pageA.locator(".roster li:not(.empty)")).toHaveCount(2, { timeout: 15000 });
  await expect(pageB.locator(".roster li:not(.empty)")).toHaveCount(2, { timeout: 15000 });

  // ready up both, host starts
  await pageA.getByRole("button", { name: "Ready up" }).click();
  await pageB.getByRole("button", { name: "Ready up" }).click();
  await expect(pageA.locator(".ready.on")).toHaveCount(2, { timeout: 10000 });
  await pageA.getByRole("button", { name: /Start the shift/ }).click();

  // the briefing is a 5-second transitional overlay; poll both pages until
  // the mission HUD appears and record whether the briefing was seen.
  let sawBriefing = false;
  const deadline = Date.now() + 40000;
  const samples: string[] = [];
  const netSnapshot = (page: Page): Promise<string> =>
    page.evaluate(`(() => {
      const ls = window.__laststop;
      const s = ls?.net?.state;
      const players = s ? [...s.players.values()].map((p) => p.nick + (ls.net.sid === p.sid ? "*" : "")).join(",") : "none";
      return \`status=\${ls?.net?.status} ph=\${s?.phase ?? "null"} room=\${ls?.net?.room?.id ?? "none"} players=\${players}\`;
    })()`);
  while (Date.now() < deadline) {
    const a = await phaseOf(pageA);
    const b = await phaseOf(pageB);
    if (a === "briefing" || b === "briefing") sawBriefing = true;
    if (a === "mission" && b === "mission") break;
    samples.push(`A[${a} ${await netSnapshot(pageA)}] B[${b} ${await netSnapshot(pageB)}]`);
    await pageA.waitForTimeout(250);
  }
  if (samples.length) console.log("LOBBY POLL SAMPLES:\n" + samples.slice(-8).join("\n"));
  expect(pageBErrors).toEqual([]);
  expect(sawBriefing).toBe(true);
  for (const page of [pageA, pageB]) {
    await expect(page.locator(".timer")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".q-value")).toContainText("$", { timeout: 5000 });
    await expect(page.locator("canvas.game-canvas")).toBeVisible();
  }

  // teammate panels reference each other
  await expect(pageA.locator(".team .mate")).toHaveCount(1, { timeout: 8000 });
  await expect(pageA.locator(".team .mate .m-nick")).toHaveText("Bob");
  await expect(pageB.locator(".team .mate .m-nick")).toHaveText("Ada");

  await ctxA.close();
  await ctxB.close();
});

test("joining a bogus code fails with feedback, not a crash", async ({ browser }) => {
  const ctx = await newLowPowerContext(browser);
  const page = await ctx.newPage();
  await gotoTitle(page);
  await page.locator(".join-row input").fill("ZZZZZ");
  await page.getByRole("button", { name: "Join crew" }).click();
  await expect(page.locator(".toast").first()).toBeVisible({ timeout: 15000 });
  // still on the title screen
  await expect(page.locator(".game-title")).toBeVisible();
  await ctx.close();
});
