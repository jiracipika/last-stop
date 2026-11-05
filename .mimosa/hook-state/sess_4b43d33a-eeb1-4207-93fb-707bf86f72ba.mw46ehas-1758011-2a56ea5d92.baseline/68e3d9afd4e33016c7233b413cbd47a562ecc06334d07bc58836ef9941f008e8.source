// FPS probe: enter a mission solo and sample the render loop for a few
// seconds. NOTE: headless Chromium renders with SwiftShader (software GL), so
// these numbers are a floor/regression check — NOT a hardware-GPU benchmark.
import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("http://127.0.0.1:5173");
  await page.locator(".game-title").waitFor({ timeout: 15000 });
  await page.locator("input[maxlength='16']").fill("Fps");
  await page.getByRole("button", { name: "Start a new shift" }).click();
  await page.locator(".invite .code").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Ready up" }).click();
  await page.getByRole("button", { name: /Start the shift/ }).click();
  await page.locator(".timer").waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500); // let the scene settle

  // string form: avoids tsx's __name helper leaking into page.evaluate
  const fps = await page.evaluate(`(async () => {
    let n = 0;
    const start = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        n++;
        if (performance.now() - start < 5000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return Math.round(n / ((performance.now() - start) / 1000));
  })()`);
  const hudFps = await page.locator(".corner-meta span").first().textContent();
  console.log(`probe: ~${fps} fps over 5s (rAF), HUD reports ${hudFps}`);
  await browser.close();
}
void main();
