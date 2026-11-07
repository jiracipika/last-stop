import { defineConfig } from "@playwright/test";
import { readdirSync } from "node:fs";

// Finds the workspace root from this file's location (works under pnpm).
const root = process.cwd();

// The game server binds 2567; vite dev binds 5173.
export default defineConfig({
  testDir: "tests",
  timeout: 90000,
  // retries for the same reason as the vitest suite (see apps/server/vitest.config.ts):
  // full-mission browser runs on a box with ambient load — movement/lobby
  // assertions flake on timer starvation, while a real regression fails
  // every attempt (the camera-180 bug did)
  retries: 2,
  workers: 1,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: [
    {
      // dedicated test server on 2667 — NEVER the public one on 2567
      // (reuseExistingServer would happily reuse prod, enemy and all)
      command: "PORT=2667 pnpm --filter @last-stop/server exec tsx src/index.ts",
      url: "http://127.0.0.1:2667/health",
      reuseExistingServer: true,
      stdout: "ignore",
      stderr: "pipe",
      cwd: root,
      // LS_TEST_MODE unlocks GameRoom's test knobs (testSeconds/testQuota) so
      // specs can shorten the shift timer; this env only exists on this
      // test-only 2667 server, never on the public 2567 one.
      env: { LS_DISABLE_ENEMY: "1", LS_TEST_MODE: "1", PORT: "2667" },
    },
    {
      command: "pnpm --filter @last-stop/web exec vite --port 5173 --strictPort",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      stdout: "ignore",
      stderr: "pipe",
      cwd: root,
      env: { VITE_GAME_SERVER_URL: "ws://127.0.0.1:2667" },
    },
  ],
});

void readdirSync;
