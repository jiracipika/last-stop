// Manual probe: is the production deployment serving the title screen?
import { chromium } from "@playwright/test";

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto("https://last-stop-beta.vercel.app", { waitUntil: "networkidle" });
  const title = await p.locator(".game-title").waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const btn = await p.getByRole("button", { name: "Start a new shift" }).isVisible();
  console.log(`prod title screen: ${title}, start button: ${btn}`);
  await b.close();
}
void main();
