import { defineConfig } from "vitest/config";

// Dedicated config for the isolated multi-user concurrency integration test.
// It boots a throwaway local Postgres in beforeAll, so it needs generous
// timeouts, must run serially (single file, single fork), and is kept out of
// the default unit suite (see vitest.config.ts `exclude`).
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/__tests__/concurrency/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: "forks",
  },
});
