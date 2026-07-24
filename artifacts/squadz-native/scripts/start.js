#!/usr/bin/env node
/**
 * Expo startup wrapper:
 *  1. Opens an SSH tunnel (serveo.net primary, localhost.run fallback) and
 *     writes the tunnel URL to /tmp/expo-tunnel-url so metro.config.js can
 *     serve a fresh QR code on every request.
 *  2. Sets EXPO_PACKAGER_PROXY_URL = Replit dev domain (NOT the tunnel URL),
 *     so the manifest's launchAsset.url points to the Replit HTTPS proxy.
 *     The tunnel is only used for Expo Go's initial exp:// manifest fetch
 *     (HTTP); the 3 MB bundle download goes directly to Replit HTTPS where
 *     iOS can reliably download large payloads.
 *  3. Starts Expo Metro with stdio inherited (piped → isTTY=false → CI mode).
 *  4. Pre-warms BOTH the iOS bundle (Expo Go) and web bundle (Replit preview)
 *     in parallel, then prints a ✅ banner when it's safe to scan.
 *  5. Auto-reconnects the tunnel if it drops, updating the state file.
 */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");

const port = process.env.PORT || "22402";
const TUNNEL_URL_FILE = "/tmp/expo-tunnel-url";

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function writeTunnelUrl(url) {
  try { fs.writeFileSync(TUNNEL_URL_FILE, url || "", "utf8"); } catch {}
}

// ── SSH tunnel ─────────────────────────────────────────────────────────────────

/**
 * Try serveo.net first (longer-lived sessions, stable).
 * Fall back to localhost.run after 25 s if serveo doesn't respond.
 */
function startTunnel() {
  return new Promise((resolve) => {
    process.stderr.write("[Squadz] Starting SSH tunnel (serveo.net)…\n");
    let resolved = false;

    const ssh = spawn(
      "ssh",
      [
        "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=6",
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
        process.stderr.write(`[Squadz] ✓ serveo.net tunnel: ${m[1]}\n`);
        resolve({ url: m[1], proc: ssh, provider: "serveo" });
      }
    }

    // Drain all output so the pipe never fills and blocks the SSH process.
    ssh.stdout.on("data", (c) => tryParse(c.toString()));
    ssh.stderr.on("data", (c) => tryParse(c.toString()));

    ssh.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        resolve({ url: null, proc: null, provider: null });
      } else {
        // Will be handled by the caller's reconnect loop.
      }
    });

    // Fall back to localhost.run after 25 s
    setTimeout(() => {
      if (!resolved) {
        process.stderr.write("[Squadz] serveo timed out — trying localhost.run…\n");
        ssh.kill();

        const lhr = spawn(
          "ssh",
          [
            "-o", "StrictHostKeyChecking=no",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=6",
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
            process.stderr.write(`[Squadz] ✓ localhost.run tunnel: ${m[0]}\n`);
            resolve({ url: m[0], proc: lhr, provider: "localhost.run" });
          }
        }
        lhr.stdout.on("data", (c) => tryParseLhr(c.toString()));
        lhr.stderr.on("data", (c) => tryParseLhr(c.toString()));

        lhr.on("exit", () => {
          if (!resolved) { resolved = true; resolve({ url: null, proc: null, provider: null }); }
        });

        // Give up entirely after another 30 s
        setTimeout(() => {
          if (!resolved) { resolved = true; resolve({ url: null, proc: lhr, provider: null }); }
        }, 30_000);
      }
    }, 25_000);
  });
}

/**
 * Connect the tunnel, write the URL to the state file, and set up
 * auto-reconnect so it restarts whenever the SSH process exits.
 * Returns the initial URL (or null if unavailable).
 */
async function connectTunnel(isReconnect = false) {
  writeTunnelUrl(""); // Clear while connecting so QR page shows "reconnecting"

  const { url, proc, provider } = await startTunnel();

  if (url) {
    writeTunnelUrl(url);
    if (isReconnect) {
      process.stderr.write(`[Squadz] ✓ Tunnel reconnected (${provider}): ${url}\n`);
      process.stderr.write(`[Squadz]   Refresh /expo-go-qr for the new QR code.\n`);
    }
    // When this SSH process exits unexpectedly, reconnect automatically.
    if (proc) {
      proc.on("exit", () => {
        process.stderr.write("[Squadz] ⚠  Tunnel dropped — reconnecting in 3 s…\n");
        writeTunnelUrl("");
        setTimeout(() => connectTunnel(true), 3000);
      });
    }
  } else {
    process.stderr.write("[Squadz] ⚠  Tunnel unavailable — falling back to Replit dev domain.\n");
    process.stderr.write("[Squadz]   Expo Go on device may not connect; the Replit preview will still work.\n");
  }

  return url;
}

// ── Metro readiness & bundle pre-warm ────────────────────────────────────────

async function waitForMetro(maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    // Plain GET — no Expo headers (they trigger the "Log in" prompt on every poll).
    const { status } = await httpGet({ hostname: "localhost", port, path: "/status" });
    if (status === 200) return true;
    const { status: s2 } = await httpGet({ hostname: "localhost", port, path: "/" });
    if (s2 === 200 || s2 === 404) return true;
  }
  return false;
}

// Expo Router entry bundle path (same for all platforms)
const ENTRY =
  "/node_modules/.pnpm/expo-router@6.0.24_@types+react-dom@19.1.11_@types+react@19.1.17__@types+react@19.1.17__4094ee48018c5b5c8f1246009fce9036/node_modules/expo-router/entry.bundle";

async function getBundleUrl(platform) {
  const params =
    platform === "ios"
      ? "platform=ios&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app&transform.reactCompiler=true&unstable_transformProfile=hermes-stable"
      : "platform=web&dev=true&hot=false&lazy=true&transform.routerRoot=app&transform.reactCompiler=true";
  return `http://localhost:${port}${ENTRY}?${params}`;
}

function downloadBundle(label, bundleUrl) {
  return new Promise((resolve) => {
    if (!bundleUrl) { resolve(0); return; }
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
  // 1. Start tunnel — sets up auto-reconnect loop in background.
  const tunnelUrl = await connectTunnel();

  // KEY: EXPO_PACKAGER_PROXY_URL = Replit dev domain, NOT the tunnel URL.
  //
  // This makes Metro embed Replit HTTPS URLs in the manifest's launchAsset.url.
  // Expo Go fetches the manifest via exp://tunnel-hostname (HTTP, small),
  // then downloads the 3 MB bundle via https://replit-dev-domain (HTTPS, large).
  // Downloading directly from Replit HTTPS avoids serveo's per-connection
  // timeout that was dropping iPhone bundle requests before they reached Metro.
  const packagerUrl = `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`;

  if (tunnelUrl) {
    process.stderr.write(`[Squadz] ✓ Manifest: exp://${new URL(tunnelUrl).hostname} (tunnel)\n`);
    process.stderr.write(`[Squadz] ✓ Bundle:   ${packagerUrl} (Replit HTTPS)\n`);
    process.stderr.write(`[Squadz]   Scan AFTER the ✅ banner below.\n`);
  } else {
    process.stderr.write(`[Squadz] ⚠  No tunnel — both manifest and bundle use Replit dev domain.\n`);
  }

  const env = {
    ...process.env,
    EXPO_PACKAGER_PROXY_URL: packagerUrl,
    EXPO_PUBLIC_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
    EXPO_PUBLIC_REPL_ID: process.env.REPL_ID,
    REACT_NATIVE_PACKAGER_HOSTNAME: process.env.REPLIT_DEV_DOMAIN,
    EXPO_NO_TELEMETRY: "1",
    EXPO_OFFLINE: "1",
  };

  // 2. Start Expo (stdio inherited so isTTY stays true).
  const expo = spawn(
    "pnpm",
    ["exec", "expo", "start", "--localhost", "--port", port],
    { env, stdio: "inherit" },
  );

  expo.on("error", (err) => {
    process.stderr.write(`[Squadz] Expo failed to start: ${err.message}\n`);
    process.exit(1);
  });

  expo.on("exit", (code) => { process.exit(code ?? 0); });

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => expo.kill(sig));
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

  const [iosUrl, webUrl] = await Promise.all([getBundleUrl("ios"), getBundleUrl("web")]);
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
    "║  NOTE:   If the QR page shows 'reconnecting', refresh it.     ║",
    "╚══════════════════════════════════════════════════════════════════╝\n",
  );

  process.stderr.write(lines.join("\n") + "\n");
})();
