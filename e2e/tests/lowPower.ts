// Two concurrent WebGL contexts in one headless Chromium starve each other's
// main threads on integrated GPUs (locators pass; click hit-tests seize for
// 30s+). Every spec that opens a second browser context boots them at the
// app's own low-quality tier — the scenes these specs assert on don't need
// full-fat shadows, and it keeps the multi-browser family runnable on
// ordinary dev hardware.
import type { Browser, BrowserContext } from "@playwright/test";

export async function newLowPowerContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    // partial prefs merge on top of DEFAULT_PREFS in the app (loadPrefs
    // spreads), so first-timer states like seenHowto stay at their defaults
    localStorage.setItem("laststop.prefs", JSON.stringify({ quality: "low" }));
  });
  return ctx;
}
