import express from "express";
import * as Sentry from "@sentry/node";

const smokeUrl = process.env.SENTRY_SMOKE_URL;
if (!smokeUrl) {
  throw new Error("SENTRY_SMOKE_URL is required");
}

const app = express();
app.get("/__sentry-express-smoke", () => {
  throw new Error("SENTRY_EXPRESS_SMOKE_TEST");
});
Sentry.setupExpressErrorHandler(app);

const server = app.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Smoke test server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/__sentry-express-smoke`);
    if (response.status !== 500) {
      throw new Error(`Expected the Express error handler to return 500, received ${response.status}`);
    }
    await Sentry.flush(2_000);
    console.log("[sentry-smoke] Express error delivered");
  } finally {
    server.close(() => process.exit(0));
  }
});