import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});
