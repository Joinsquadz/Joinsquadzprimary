const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");

const config = getDefaultConfig(__dirname);

/**
 * Dev-only reverse proxy so the Expo WEB dev server can serve `/api/*` from its
 * OWN origin (same-origin), forwarded server-side to the api-server via the
 * shared proxy (localhost:80).
 *
 * Why: on web the app is loaded from $REPLIT_EXPO_DEV_DOMAIN (the Expo/Metro
 * dev server), which bypasses the shared proxy. Without this, the web build has
 * to make CROSS-ORIGIN calls to the main dev domain — which a headless
 * Playwright/UI-test browser cannot reach, so every authenticated request 401s
 * and no automated test can exercise a signed-in screen. By proxying `/api`
 * here, the web client can use relative, same-origin URLs (see
 * `resolveApiBase()` returning "" on web) that work for BOTH the normal preview
 * browser and the headless test browser.
 *
 * This runs ONLY under `expo start` (Metro dev server). It does not affect
 * native builds or the production static server (`server/serve.js`).
 */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || "http://localhost:80";

function shouldProxy(url) {
  return !!url && (url === "/api" || url.startsWith("/api/"));
}

function proxyToApi(req, res) {
  const target = new URL(req.url, API_PROXY_TARGET);
  const headers = { ...req.headers, host: target.host };
  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: target.pathname + target.search,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "api_proxy_error", detail: String(err) }));
  });
  req.pipe(upstream);
}

// ── /expo-go-qr  ─────────────────────────────────────────────────────────────
// Serves a scannable QR-code page so users can open the app in Expo Go without
// needing to read the Metro terminal QR output.
//
// The tunnel URL is read from /tmp/expo-tunnel-url on EVERY request (not from
// EXPO_TUNNEL_URL which is frozen at startup). This means refreshing the page
// always gives a live QR code, even after the tunnel reconnects with a new URL.

const TUNNEL_URL_FILE = "/tmp/expo-tunnel-url";

function readTunnelUrl() {
  try { return require("fs").readFileSync(TUNNEL_URL_FILE, "utf8").trim(); } catch { return ""; }
}

function serveExpoGoQr(res) {
  const tunnelUrl = readTunnelUrl();

  if (!tunnelUrl) {
    // Tunnel is connecting/reconnecting — show a waiting page that auto-refreshes.
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="4">
  <title>Expo Go — Tunnel connecting…</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:16px;text-align:center}
    h1{font-size:20px;font-weight:700}
    p{color:#aaa;font-size:14px;max-width:300px}
    .dot{animation:blink 1s infinite alternate}
    @keyframes blink{to{opacity:.2}}
  </style>
</head>
<body>
  <h1>⏳ Tunnel connecting<span class="dot">…</span></h1>
  <p>This page refreshes automatically every 4 seconds.<br>Scan the QR code once it appears.</p>
  <p style="color:#555;font-size:12px">If this persists more than 60 s, restart the Expo workflow.</p>
</body>
</html>`);
    return;
  }

  let hostname;
  try { hostname = new URL(tunnelUrl).hostname; }
  catch { hostname = tunnelUrl.replace(/^https?:\/\//, "").split("/")[0]; }

  const expUrl = `exp://${hostname}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(expUrl)}&size=280x280&margin=2&color=000000&bgcolor=FFFFFF`;

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Open Squadz in Expo Go</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:20px;text-align:center}
    h1{font-size:22px;font-weight:700}
    .sub{color:#aaa;font-size:14px;max-width:300px}
    .qr{background:#fff;border-radius:16px;padding:16px;display:inline-block}
    .qr img{display:block}
    code{color:#ff6b2c;font-size:12px;word-break:break-all;max-width:340px;display:block;margin-top:4px}
    .step{background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:14px 18px;max-width:340px;text-align:left;font-size:13px;line-height:1.6}
    .step b{color:#ff6b2c}
    .hint{color:#555;font-size:11px;max-width:340px}
  </style>
</head>
<body>
  <h1>Open Squadz in Expo Go</h1>
  <div class="qr">
    <img src="${qrApiUrl}" width="280" height="280" alt="Expo Go QR code">
  </div>
  <div class="step">
    <b>Step 1.</b> On your iPhone, open the <b>Camera app</b><br>
    <b>Step 2.</b> Point at the QR code above — a banner appears<br>
    <b>Step 3.</b> Tap the banner → <b>Expo Go</b> opens &amp; loads Squadz
  </div>
  <p class="sub">Or open this URL manually in Expo Go:<br><code>${expUrl}</code></p>
  <p class="hint">If you get "no tunnel here", refresh this page — the tunnel URL changes on reconnect.</p>
</body>
</html>`);
}

const defaultEnhance = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (metroMiddleware, server) => {
  const base = defaultEnhance
    ? defaultEnhance(metroMiddleware, server)
    : metroMiddleware;
  return (req, res, next) => {
    if (req.url === "/expo-go-qr" || req.url === "/expo-go-qr/") {
      serveExpoGoQr(res);
      return;
    }
    if (shouldProxy(req.url)) {
      proxyToApi(req, res);
      return;
    }
    return base(req, res, next);
  };
};

module.exports = config;
