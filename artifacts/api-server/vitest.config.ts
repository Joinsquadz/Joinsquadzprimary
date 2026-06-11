import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // The concurrency integration suite spins up a real ephemeral Postgres and
    // is intentionally NOT part of the default/CI unit run. It has its own
    // config (vitest.concurrency.config.ts) + `test:concurrency` script.
    exclude: [...configDefaults.exclude, "src/__tests__/concurrency/**"],
  },
});
