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
      command: "pnpm --filter @last-stop/server exec tsx src/index.ts",
      url: "http://127.0.0.1:2567/health",
      reuseExistingServer: true,
      stdout: "ignore",
      stderr: "pipe",
      cwd: root,
      env: { LS_DISABLE_ENEMY: "1" },
    },
    {
      command: "pnpm --filter @last-stop/web exec vite --port 5173 --strictPort",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      stdout: "ignore",
      stderr: "pipe",
      cwd: root,
      env: { VITE_GAME_SERVER_URL: "ws://127.0.0.1:2567" },
    },
  ],
});

void readdirSync;
