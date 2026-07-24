#!/usr/bin/env node
/**
 * Expo startup wrapper:
 *  1. Opens an SSH tunnel (localhost.run primary, serveo.net fallback) to give
 *     Expo Go a reachable public HTTPS URL for the Metro dev server.
 *  2. Starts Expo Metro with that tunnel URL as the packager proxy.
 *  3. Pre-warms BOTH the iOS bundle (Expo Go) and web bundle (Replit preview)
 *     in parallel, then prints a ✅ banner when it's safe to scan.
 *
 * Why not pipe Expo stdout?  isTTY=false → CI mode → CommandError on startup.
 * All stdio is inherited; we communicate exclusively via stderr.
 */
const { spawn } = require("child_process");
const http = require("http");

const port = process.env.PORT || "22402";

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpGet(opts) {
  return new Promise((resolve) => {
    const req = http.get(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ status: 0, data: "" });
    });
    req.on("error", () => resolve({ status: 0, data: "" }));
  });
}

// ── SSH tunnel helpers ────────────────────────────────────────────────────────

/**
 * Try localhost.run first (no interstitial warning page, stable for large
 * payloads). Fall back to serveo.net if it doesn't respond within 25 s.
 */
function startTunnel() {
  return new Promise((resolve) => {
    process.stderr.write("[Squadz] Starting SSH tunnel (localhost.run)…\n");
    let resolved = false;

    // localhost.run: output format is "https://<hash>.lhr.life"
    const lhr = spawn(
      "ssh",
      [
        "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-o", "ConnectTimeout=20",
        "-R", `80:localhost:${port}`,
        "nokey@localhost.run",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    function tryParseLhr(text) {
      const m = text.match(/https:\/\/[a-z0-9-]+\.lhr\.life/);
      if (m && !resolved) {
        resolved = true;
        process.stderr.write(`[Squadz] ✓ localhost.run tunnel ready: ${m[0]}\n`);
        resolve({ url: m[0], proc: lhr, provider: "localhost.run" });
      }
    }

    lhr.stdout.on("data", (c) => tryParseLhr(c.toString()));
    lhr.stderr.on("data", (c) => tryParseLhr(c.toString()));

    lhr.on("exit", () => {
      if (!resolved) {
        resolved = true;
        resolve({ url: null, proc: null, provider: null });
      } else {
        process.stderr.write("[Squadz] ⚠  localhost.run tunnel disconnected. Restart the workflow to reconnect.\n");
      }
    });

    // After 25 s without a URL, fall back to serveo
    setTimeout(() => {
      if (!resolved) {
        process.stderr.write("[Squadz] localhost.run timed out — trying serveo.net as fallback…\n");
        lhr.kill();
        startServeoTunnel().then(resolve);
      }
    }, 25_000);
  });
}

function startServeoTunnel() {
  return new Promise((resolve) => {
    let resolved = false;
    process.stderr.write("[Squadz] Starting serveo.net tunnel…\n");

    const ssh = spawn(
      "ssh",
      [
        "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-o", "ConnectTimeout=20",
        "-R", `80:localhost:${port}`,
        "serveo.net",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    function tryParse(text) {
      const m = text.match(/Forwarding HTTP traffic from (https:\/\/[^\s]+)/);
      if (m && !resolved) {
        resolved = true;
        process.stderr.write(`[Squadz] ✓ serveo.net tunnel ready: ${m[1]}\n`);
        resolve({ url: m[1], proc: ssh, provider: "serveo" });
      }
    }

    ssh.stdout.on("data", (c) => tryParse(c.toString()));
    ssh.stderr.on("data", (c) => tryParse(c.toString()));

    ssh.on("exit", () => {
      if (!resolved) {
        resolved = true;
        resolve({ url: null, proc: null, provider: null });
      } else {
        process.stderr.write("[Squadz] ⚠  Serveo tunnel disconnected — Expo Go may stop working. Restart the workflow to reconnect.\n");
      }
    });

    // Fall back after 30 s
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ url: null, proc: ssh, provider: null });
      }
    }, 30_000);
  });
}

// ── Metro readiness & bundle pre-warm ────────────────────────────────────────

async function waitForMetro(maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    // Use a plain GET (no Expo-* headers) so we don't trigger the
    // "Log in / Proceed anonymously" prompt for every poll attempt.
    const { status } = await httpGet({
      hostname: "localhost",
      port,
      path: "/status",
    });
    if (status === 200) return true;
    // Also accept 404 — Metro is up even if /status isn't recognised.
    const { status: s2 } = await httpGet({ hostname: "localhost", port, path: "/" });
    if (s2 === 200 || s2 === 404) return true;
  }
  return false;
}

// Expo Router entry bundle path (same for all platforms)
const ENTRY = "/node_modules/.pnpm/expo-router@6.0.24_@types+react-dom@19.1.11_@types+react@19.1.17__@types+react@19.1.17__4094ee48018c5b5c8f1246009fce9036/node_modules/expo-router/entry.bundle";

async function getBundleUrl(platform) {
  const params =
    platform === "ios"
      ? "platform=ios&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&transform.reactCompiler=true&unstable_transformProfile=hermes-stable"
      : "platform=web&dev=true&hot=false&lazy=true&transform.routerRoot=app&transform.reactCompiler=true";
  return `http://localhost:${port}${ENTRY}?${params}`;
}

function downloadBundle(label, bundleUrl) {
  return new Promise((resolve) => {
    if (!bundleUrl) {
      process.stderr.write(`[Squadz] ${label} bundle URL not found — skipping.\n`);
      resolve(0);
      return;
    }
    const u = new URL(bundleUrl);
    const req = http.get(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        headers: { "Accept-Encoding": "gzip" },
      },
      (res) => {
        let bytes = 0;
        res.on("data", (c) => (bytes += c.length));
        res.on("end", () => {
          const mb = (bytes / 1024 / 1024).toFixed(1);
          process.stderr.write(`[Squadz] ✓ ${label} bundle ready (${mb} MB compressed)\n`);
          resolve(bytes);
        });
      },
    );
    req.on("error", (e) => {
      process.stderr.write(`[Squadz] ${label} bundle fetch error: ${e.message}\n`);
      resolve(0);
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  // 1. Start tunnel first so Expo gets the right EXPO_PACKAGER_PROXY_URL.
  const { url: tunnelUrl, proc: tunnelProc, provider: tunnelProvider } = await startTunnel();

  const packagerUrl = tunnelUrl || `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`;

  if (tunnelUrl) {
    process.stderr.write(`[Squadz] ✓ Tunnel (${tunnelProvider}) ready: ${tunnelUrl}\n`);
    process.stderr.write(`[Squadz]   Expo Go will use this URL — scan AFTER the ✅ banner below.\n`);
  } else {
    process.stderr.write(`[Squadz] ⚠  Tunnel unavailable — falling back to Replit dev domain.\n`);
    process.stderr.write(`[Squadz]   Expo Go on device may still time out; the Replit preview will still work.\n`);
  }

  const env = {
    ...process.env,
    EXPO_PACKAGER_PROXY_URL: packagerUrl,
    // Passed into metro.config.js so the /expo-go-qr page can embed the URL.
    EXPO_TUNNEL_URL: tunnelUrl || "",
    EXPO_PUBLIC_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
    EXPO_PUBLIC_REPL_ID: process.env.REPL_ID,
    REACT_NATIVE_PACKAGER_HOSTNAME: process.env.REPLIT_DEV_DOMAIN,
    EXPO_NO_TELEMETRY: "1",
    // Prevent Expo from prompting for account login during CI-like workflows.
    EXPO_OFFLINE: "1",
  };

  // 2. Start Expo (stdio inherited so it keeps isTTY=true).
  const expo = spawn(
    "pnpm",
    ["exec", "expo", "start", "--localhost", "--port", port],
    { env, stdio: "inherit" },
  );

  expo.on("error", (err) => {
    process.stderr.write(`[Squadz] Expo failed to start: ${err.message}\n`);
    if (tunnelProc) tunnelProc.kill();
    process.exit(1);
  });

  expo.on("exit", (code) => {
    if (tunnelProc) tunnelProc.kill();
    process.exit(code ?? 0);
  });

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      expo.kill(sig);
      if (tunnelProc) tunnelProc.kill();
    });
  }

  // 3. Wait for Metro, then pre-warm iOS + web in parallel.
  process.stderr.write(
    "\n╔══════════════════════════════════════════════════════════════╗\n" +
    "║  ⏳  Compiling bundles — do NOT scan the QR code yet!      ║\n" +
    "╚══════════════════════════════════════════════════════════════╝\n\n",
  );

  const ready = await waitForMetro();
  if (!ready) {
    process.stderr.write("[Squadz] Metro did not start — skipping pre-warm.\n");
    return;
  }

  const [iosUrl, webUrl] = await Promise.all([
    getBundleUrl("ios"),
    getBundleUrl("web"),
  ]);

  await Promise.all([
    downloadBundle("iOS (Expo Go)", iosUrl),
    downloadBundle("Web (Replit preview)", webUrl),
  ]);

  const expoDevDomain = process.env.REPLIT_EXPO_DEV_DOMAIN || "";
  const qrPageUrl = expoDevDomain ? `https://${expoDevDomain}/expo-go-qr` : "";

  const lines = [
    "\n╔══════════════════════════════════════════════════════════════════╗",
    "║  ✅  All bundles ready!                                        ║",
    "║                                                                ║",
    "║  STEP 1: On your desktop, open this URL:                       ║",
  ];

  if (qrPageUrl) {
    // Split long URL across two lines if needed
    const u = qrPageUrl.padEnd(58);
    lines.push(`║  ${u.slice(0, 58)}  ║`);
    if (u.length > 58) lines.push(`║  ${u.slice(58).padEnd(58)}  ║`);
  } else {
    lines.push("║  (EXPO_DEV_DOMAIN not set — see QR code in Metro terminal)    ║");
  }

  lines.push(
    "║                                                                ║",
    "║  STEP 2: Scan the QR code shown there with your iPhone        ║",
    "║          Camera app → Expo Go opens automatically.            ║",
    "╚══════════════════════════════════════════════════════════════════╝\n",
  );

  process.stderr.write(lines.join("\n") + "\n");
})();
