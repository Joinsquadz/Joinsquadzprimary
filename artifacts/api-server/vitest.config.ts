import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // The concurrency integration suite spins up a real ephemeral Postgres and
    // is intentionally NOT part of the default/CI unit run. It has its own
    // config (vitest.concurrency.config.ts) + `test:concurrency` script.
    exclude: [...configDefaults.exclude, "src/__tests__/concurrency/**"],
  },
  resolve: {
    alias: {
      // Map the workspace package directly to its TypeScript source so vitest
      // can import it without a prior build step (it has no dist/ directory).
      "@workspace/cost-math": resolve(__dirname, "../../lib/cost-math/src/index.ts"),
    },
  },
});
