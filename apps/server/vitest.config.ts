import { defineConfig } from "vitest/config";

// The server suite is full-mission integration: real 30 Hz sims, real-time
// waits, bot walks. Under this box's ambient load the failures are timer
// starvation, not logic — they rotate between long-walk tests run to run.
// A genuine logic bug fails consistently (the leash-slip did, 3 runs
// straight), so a retry budget costs little honesty and buys determinism.
export default defineConfig({
  test: {
    include: ["src/test/**/*.test.ts"],
    testTimeout: 45000,
    hookTimeout: 30000,
    retry: 2,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
