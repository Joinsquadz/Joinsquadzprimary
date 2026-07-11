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

const defaultEnhance = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (metroMiddleware, server) => {
  const base = defaultEnhance
    ? defaultEnhance(metroMiddleware, server)
    : metroMiddleware;
  return (req, res, next) => {
    if (shouldProxy(req.url)) {
      proxyToApi(req, res);
      return;
    }
    return base(req, res, next);
  };
};

module.exports = config;
