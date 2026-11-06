// Diagnose prod multiplayer: click create, capture console/network errors.
import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP rs-server.tail617f4d.ts.net 199.38.181.54"] });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || /websocket|wss|failed/i.test(t)) errors.push(t.slice(0, 220));
  });
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${String(e).slice(0, 220)}`));

  await page.goto("https://laststopgame.vercel.app", { waitUntil: "networkidle" });
  await page.locator(".game-title").waitFor({ timeout: 20000 });
  await page.locator("input[maxlength='16']").fill("Debug");
  await page.getByRole("button", { name: "Start a new shift" }).click();
  await page.waitForTimeout(10000);

  const lobby = await page.locator(".invite .code").count();
  const toast = (await page.locator(".toast").first().textContent().catch(() => "none")) ?? "none";
  console.log(`lobby code visible: ${lobby === 1}`);
  console.log(`toast: ${toast.trim()}`);
  console.log("captured:");
  console.log(errors.slice(0, 8).map((e) => `  - ${e}`).join("\n") || "  none");
  await browser.close();
}
void main();
