#!/usr/bin/env node
/**
 * Expo startup wrapper with automatic iOS bundle pre-warm.
 *
 * Problem: Metro takes ~18s to compile the iOS bundle cold. Expo Go's timeout
 * fires before compilation finishes → "Unknown error: The request timed out."
 *
 * Fix: start Metro, wait for it to be ready, then immediately fetch the iOS
 * bundle URL so Metro compiles and caches it. By the time the user scans the
 * QR code the bundle is already in Metro's cache and serves in <1s.
 */
const { spawn } = require("child_process");
const http = require("http");

const port = process.env.PORT || "22402";

const env = {
  ...process.env,
  EXPO_PACKAGER_PROXY_URL: `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`,
  EXPO_PUBLIC_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
  EXPO_PUBLIC_REPL_ID: process.env.REPL_ID,
  REACT_NATIVE_PACKAGER_HOSTNAME: process.env.REPLIT_DEV_DOMAIN,
};

// ── Start Expo / Metro ────────────────────────────────────────────────────────

const expo = spawn(
  "pnpm",
  ["exec", "expo", "start", "--localhost", "--port", port],
  { env, stdio: "inherit" },
);

expo.on("error", (err) => {
  console.error("[start] Expo failed to start:", err.message);
  process.exit(1);
});

expo.on("exit", (code) => process.exit(code ?? 0));

// Propagate signals so the workflow can cleanly stop Expo.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    expo.kill(sig);
  });
}

// ── Auto pre-warm ─────────────────────────────────────────────────────────────

function get(opts, onData) {
  return new Promise((resolve) => {
    const req = http.get(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ status: 0, data: "" });
    });
    req.on("error", () => resolve({ status: 0, data: "" }));
  });
}

async function waitForMetro(maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { status } = await get({
      hostname: "localhost",
      port,
      path: "/",
      headers: { "Expo-Platform": "ios", "Expo-API": "expo" },
    });
    if (status === 200) return true;
  }
  return false;
}

async function getBundleUrl() {
  const { status, data } = await get({
    hostname: "localhost",
    port,
    path: "/",
    headers: { "Expo-Platform": "ios", "Expo-API": "expo" },
  });
  if (status !== 200) return null;
  try {
    const manifest = JSON.parse(data);
    const url = manifest?.launchAsset?.url;
    if (!url) return null;
    // Rewrite the public domain to localhost so the fetch stays in-container.
    return url.replace(
      `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`,
      `http://localhost:${port}`,
    );
  } catch {
    return null;
  }
}

async function prewarm(bundleUrl) {
  const u = new URL(bundleUrl);
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search },
      (res) => {
        let bytes = 0;
        res.on("data", (c) => (bytes += c.length));
        res.on("end", () => {
          const mb = (bytes / 1024 / 1024).toFixed(1);
          console.log(
            `\n[prewarm] ✓ iOS bundle cached (${mb} MB). Scan the QR code now.\n`,
          );
          resolve();
        });
      },
    );
    // No timeout — let Metro compile however long it needs.
    req.on("error", (err) => {
      console.log("[prewarm] Bundle fetch error:", err.message);
      resolve();
    });
  });
}

(async () => {
  // Give Metro a head-start before polling.
  console.log("[prewarm] Waiting for Metro to start…");
  const ready = await waitForMetro();
  if (!ready) {
    console.log("[prewarm] Metro did not become ready in time — skipping pre-warm.");
    return;
  }

  const bundleUrl = await getBundleUrl();
  if (!bundleUrl) {
    console.log("[prewarm] Could not read manifest — skipping pre-warm.");
    return;
  }

  console.log("[prewarm] Metro ready. Compiling iOS bundle in background…");
  await prewarm(bundleUrl);
})();
