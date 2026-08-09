/**
 * Build-and-run wrapper for the R2 -> temporary Supabase restore drill.
 *
 * Usage (from the project root):
 *   pnpm --filter @workspace/api-server run restore:drill -- \
 *     --prefix "supabase/squadz-avatars/" --bucket restore-drill-<date> --limit 3
 */

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const outfile = path.resolve(__dirname, "dist/scripts/restore-drill.mjs");

await build({
  entryPoints: [path.resolve(__dirname, "src/scripts/restore-drill.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile,
  external: [
    "*.node",
    "@aws-sdk/*",
    "@opentelemetry/*",
    "@sentry/node",
    "stripe-replit-sync",
    "nodemailer",
    "handlebars",
    "pg",
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

execFileSync("node", [outfile, ...process.argv.slice(2)], { stdio: "inherit", cwd: __dirname });
