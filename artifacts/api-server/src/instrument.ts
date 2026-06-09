/**
 * Sentry instrumentation preload — loaded via Node's --import flag BEFORE
 * any other modules so @sentry/node can instrument Express automatically.
 *
 * Bundled as a separate esbuild entry point → dist/instrument.mjs.
 * Referenced in the `start` npm script:
 *   node --import ./dist/instrument.mjs --enable-source-maps ./dist/index.mjs
 *
 * See: https://docs.sentry.io/platforms/javascript/guides/express/install/esm/
 */
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  });
}
