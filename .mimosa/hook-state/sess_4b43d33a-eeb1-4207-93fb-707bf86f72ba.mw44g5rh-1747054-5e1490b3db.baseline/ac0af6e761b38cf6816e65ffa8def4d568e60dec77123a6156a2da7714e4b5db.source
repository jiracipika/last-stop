// Manual probe: trace HUD phase transitions in a real browser after start.
import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[console.error]", m.text());
  });
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".game-title").waitFor({ timeout: 15000 });
  await page.locator("input[maxlength='16']").fill("Probe");
  await page.getByRole("button", { name: "Start a new shift" }).click();
  await page.locator(".invite .code").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();
  const phases = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const cls = await page.evaluate(() => {
      const briefing = !!document.querySelector(".briefing");
      const hud = !!document.querySelector(".timer");
      const lobby = !!document.querySelector(".lobby-panel");
      return briefing ? "briefing" : hud ? "scavenge" : lobby ? "lobby" : "unknown";
    });
    phases.add(cls);
    if (i % 5 === 0) console.log(`t=${i * 0.25}s phase=${cls}`);
    await page.waitForTimeout(250);
  }
  console.log("phases seen:", [...phases].join(","));
  await browser.close();
}
void main();
