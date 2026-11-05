// Visual probe: screenshots of title, crew room, and in-mission view.
import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".game-title").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "/tmp/ls-shot-title.png" });

  await page.locator("input[maxlength='16']").fill("Ada");
  await page.getByRole("button", { name: "Start a new shift" }).click();
  await page.locator(".invite .code").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "/tmp/ls-shot-lobby.png" });

  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();
  // wait for mission HUD then let it settle a moment
  await page.locator(".timer").waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.mouse.click(640, 400); // engage pointer lock + canvas focus
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/ls-shot-mission.png" });

  await browser.close();
  console.log("shots saved");
}
void main();
