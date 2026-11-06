// PRODUCTION end-to-end: two real browsers on the deployed Vercel frontend,
// multiplayer through the Tailscale-Funnel-hosted game server. If this
// passes, the public link is genuinely playable.
import { chromium } from "@playwright/test";

const PROD = "https://laststopgame.vercel.app";

async function main() {
  const browser = await chromium.launch({
  args: [
    // simulate an OFF-tailnet player: resolve the funnel host to its public
    // edge IPs instead of the local 100.x address this box would use
    "--host-resolver-rules=MAP rs-server.tail617f4d.ts.net 199.38.181.54",
  ],
});
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto(PROD, { waitUntil: "networkidle" });
  await pageA.locator(".game-title").waitFor({ timeout: 20000 });
  await pageA.locator("input[maxlength='16']").fill("Ada");
  await pageA.getByRole("button", { name: "Start a new shift" }).click();

  const codeEl = pageA.locator(".invite .code");
  await codeEl.waitFor({ timeout: 25000 });
  const code = (await codeEl.textContent())?.trim() ?? "";
  console.log(`room created on prod: ${code}`);
  if (!/^[A-Z0-9]{5}$/.test(code)) throw new Error("no room code from production server");

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(PROD, { waitUntil: "networkidle" });
  await pageB.locator(".game-title").waitFor({ timeout: 20000 });
  await pageB.locator("input[maxlength='16']").fill("Bob");
  await pageB.locator(".join-row input").fill(code);
  await pageB.getByRole("button", { name: "Join crew" }).click();

  await pageA.locator(".roster li:not(.empty)").nth(1).waitFor({ timeout: 25000 });
  // Bob's side may lag behind through the funnel — wait, then diagnose
  try {
    await pageB.locator(".roster li:not(.empty)").nth(1).waitFor({ timeout: 15000 });
  } catch {
    const bToast = (await pageB.locator(".toast").first().textContent().catch(() => "none")) ?? "none";
    const bLobby = await pageB.locator(".lobby-panel").count();
    const bTitle = await pageB.locator(".game-title").count();
    const bUrl = pageB.url();
    console.error(`BOB DEBUG: url=${bUrl} lobby=${bLobby} title=${bTitle} toast=${bToast.trim()}`);
    throw new Error("Bob never saw the roster");
  }
  const aCount = await pageA.locator(".roster li:not(.empty)").count();
  const bCount = await pageB.locator(".roster li:not(.empty)").count();
  console.log(`rosters: Ada sees ${aCount}, Bob sees ${bCount}`);
  if (aCount !== 2 || bCount !== 2) throw new Error("roster mismatch over production");

  // ready up both, start, reach the mission HUD through the public path
  await pageA.getByRole("button", { name: "Ready up" }).click();
  await pageB.getByRole("button", { name: "Ready up" }).click();
  await pageA.locator(".ready.on").nth(1).waitFor({ timeout: 15000 });
  await pageA.getByRole("button", { name: /Start the shift/ }).click();
  await pageA.locator(".timer").waitFor({ timeout: 40000 });
  await pageB.locator(".timer").waitFor({ timeout: 40000 });
  const timer = await pageA.locator(".timer").textContent();
  console.log(`mission HUD live on prod (timer ${timer?.trim()}) — public game WORKS`);

  await ctxA.close();
  await ctxB.close();
  await browser.close();
}

main().catch((e) => {
  console.error("PROD E2E FAILED:", e);
  process.exit(1);
});
