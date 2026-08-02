/**
 * Build-and-run wrapper for the upload-owners backfill script.
 *
 * Usage (from the project root):
 *   pnpm --filter @workspace/api-server run backfill:upload-owners
 */

import { build } from "esbuild";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const outfile = path.resolve(__dirname, "dist/scripts/backfill-upload-owners.mjs");

await build({
  entryPoints: [path.resolve(__dirname, "src/scripts/backfill-upload-owners.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile,
  external: [
    "*.node",
    "@opentelemetry/*",
    "@sentry/node",
    "stripe-replit-sync",
    "nodemailer",
    "handlebars",
  ],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';
import __p from 'node:path';
import __u from 'node:url';
globalThis.require = __cr(import.meta.url);
globalThis.__filename = __u.fileURLToPath(import.meta.url);
globalThis.__dirname = __p.dirname(globalThis.__filename);`,
  },
  sourcemap: "linked",
});

console.log("Build complete. Running backfill…\n");
execSync(`node "${outfile}"`, { stdio: "inherit", cwd: __dirname });
