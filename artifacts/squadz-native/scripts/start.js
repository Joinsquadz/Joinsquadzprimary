#!/usr/bin/env node
/**
 * Expo startup wrapper with automatic iOS bundle pre-warm.
 *
 * Why piping stdout doesn't work: Expo checks process.stdout.isTTY. Piping
 * sets isTTY=false → Expo enters CI/non-interactive mode → CommandError.
 *
 * Approach: run Expo with fully inherited stdio (so Expo thinks it has a
 * terminal), and use stderr to print unmissable "WAIT" / "SCAN NOW" messages
 * that bracket the QR code reveal moment.
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
  EXPO_NO_TELEMETRY: "1",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function httpGet(opts) {
  return new Promise((resolve) => {
    const req = http.get(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, data: "" }); });
    req.on("error", () => resolve({ status: 0, data: "" }));
  });
}

async function waitForMetro(maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { status } = await httpGet({
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
  const { status, data } = await httpGet({
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
    return url.replace(
      `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`,
      `http://localhost:${port}`,
    );
  } catch { return null; }
}

function downloadBundle(bundleUrl) {
  return new Promise((resolve) => {
    const u = new URL(bundleUrl);
    const req = http.get(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search },
      (res) => {
        let bytes = 0;
        res.on("data", (c) => (bytes += c.length));
        res.on("end", () => resolve(bytes));
      },
    );
    req.on("error", () => resolve(0));
  });
}

// ── Expo process ──────────────────────────────────────────────────────────────

// All stdio inherited — Expo sees a TTY (isTTY=true) and behaves normally.
// We communicate with the user exclusively via stderr.
const expo = spawn(
  "pnpm",
  ["exec", "expo", "start", "--localhost", "--port", port],
  { env, stdio: "inherit" },
);

expo.on("error", (err) => {
  process.stderr.write(`[Squadz] Expo failed to start: ${err.message}\n`);
  process.exit(1);
});

expo.on("exit", (code) => process.exit(code ?? 0));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => expo.kill(sig));
}

// ── Pre-warm ──────────────────────────────────────────────────────────────────

const WAIT_BANNER = `
╔══════════════════════════════════════════════════════════════╗
║  ⏳  Squadz — iOS bundle compiling, do NOT scan yet!        ║
╚══════════════════════════════════════════════════════════════╝
`;

const READY_BANNER = (mb) => `
╔══════════════════════════════════════════════════════════════╗
║  ✅  iOS bundle ready (${mb} MB) — SCAN THE QR CODE NOW!   ║
╚══════════════════════════════════════════════════════════════╝
`;

(async () => {
  // Print the warning BEFORE Metro shows the QR code.
  // Metro starts ~5-10s after this wrapper starts, so this message races with
  // (and often precedes) the QR code in the terminal.
  process.stderr.write(WAIT_BANNER);

  const ready = await waitForMetro();
  if (!ready) {
    process.stderr.write("[Squadz] Metro did not start — skipping pre-warm.\n");
    return;
  }

  const bundleUrl = await getBundleUrl();
  if (!bundleUrl) {
    process.stderr.write("[Squadz] Could not read manifest — skipping pre-warm.\n");
    return;
  }

  const bytes = await downloadBundle(bundleUrl);
  const mb = (bytes / 1024 / 1024).toFixed(1);

  // Print the "ready" banner — this races with Metro's log output but stands
  // out because of the box-drawing characters.
  process.stderr.write(READY_BANNER(mb));
})();
