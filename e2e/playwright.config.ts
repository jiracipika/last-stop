import { defineConfig } from "@playwright/test";
import { readdirSync } from "node:fs";

// Finds the workspace root from this file's location (works under pnpm).
const root = process.cwd();

// The game server binds 2567; vite dev binds 5173.
export default defineConfig({
  testDir: "tests",
  timeout: 90000,
  retries: 0,
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
      env: { LS_DISABLE_ENEMY: "1", PORT: "2667" },
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
