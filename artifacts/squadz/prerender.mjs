/**
 * Post-build prerender script.
 *
 * Reads dist/public/index.html (client build), imports the SSR bundle, renders
 * each public route to HTML, extracts the <title>/<meta>/<link> head tags that
 * react-helmet-async renders inline, moves them into <head>, and writes a
 * separate index.html per route so crawlers receive meaningful HTML.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPublic = path.join(__dirname, "dist", "public");
const distServer = path.join(__dirname, "dist", "server");

const template = fs.readFileSync(path.join(distPublic, "index.html"), "utf-8");
const { render } = await import(path.join(distServer, "entry-server.js"));

// Strip the static fallback title + meta so per-route values don't duplicate.
const baseTemplate = template
  .replace(/<title>[^<]*<\/title>/gi, "")
  .replace(/<meta\s+name="description"[^>]*>/gi, "")
  .replace(/<meta\s+name="robots"[^>]*>/gi, "")
  .replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, "")
  .replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, "")
  .replace(/<link\s+rel="canonical"[^>]*>/gi, "");

/**
 * react-helmet-async v3 renders head tags (title, meta, link) as inline
 * elements at the very start of the renderToString output when running in SSR
 * mode. Extract them, strip them from the body HTML, then inject into <head>.
 */
function extractHeadTags(html) {
  // Match leading <title>, <meta …/>, and <link rel="canonical" …/> tags
  // that Helmet emits before the first "real" content element.
  const headTagPattern =
    /^((?:<title>[^<]*<\/title>|<meta\s[^>]*\/?>|<link\s[^>]*\/?>|\s)*)/i;
  const match = html.match(headTagPattern);
  if (!match || !match[1].trim()) {
    return { headTags: "", bodyHtml: html };
  }
  return { headTags: match[1].trim(), bodyHtml: html.slice(match[1].length) };
}

// Invite codes are dynamic, so the inline first-paint shell handles arbitrary
// code-bearing URLs. These representative directories also ensure a direct
// request with a path (rather than a query-only URL) receives invite HTML
// before the client bundle hydrates.
const routes = ["/", "/privacy", "/terms", "/squad/join", "/squad/join-public", "/join/INVITE"];

for (const route of routes) {
  const { html } = render(route);
  const { headTags, bodyHtml } = extractHeadTags(html);

  let page = baseTemplate;

  // Inject extracted head tags just before </head>.
  if (headTags) {
    page = page.replace("</head>", `    ${headTags}\n  </head>`);
  }

  // Inject pre-rendered body HTML into #root, replacing the lightweight
  // first-paint shell used while the client bundle is downloading.
  page = page.replace(
    /<div id="root">[\s\S]*?<!-- FIRST_PAINT_SHELL_END -->\s*<\/div>/,
    `<div id="root">${bodyHtml}</div>`,
  );
  const inviteRoute = route === "/squad/join" || route === "/squad/join-public" || route === "/join/INVITE";
  const requiredInviteText = ["You're invited", "Get SquadZ on the App Store"];
  if (inviteRoute && requiredInviteText.some((text) => !page.includes(text))) {
    throw new Error(`Invite prerender for ${route} is missing required first-paint content`);
  }
  if (route === "/join/INVITE" && !page.includes("INVITE")) {
    throw new Error("Plan invite prerender lost its representative invite code");
  }

  // Write to the correct directory.
  const routeDir =
    route === "/" ? distPublic : path.join(distPublic, route.slice(1));
  fs.mkdirSync(routeDir, { recursive: true });
  fs.writeFileSync(path.join(routeDir, "index.html"), page);
  console.log(`  Prerendered: ${route}`);
}

// Keep every browser-to-installed-app handoff mapped to its own native route.
// This is intentionally checked in the production build because these links
// are rendered server-side before hydration.
const nativeHandoffs = [
  ["/squad/join?code=SQUAD7", "squadz-native://squad/join?code=SQUAD7"],
  ["/squad/join-public?id=public-7", "squadz-native://squad/join-public?id=public-7"],
  ["/join/PLAN7", "squadz-native://join/PLAN7"],
  ["/api/add/friend/FRIEND7", "squadz-native://add/friend/FRIEND7"],
];
for (const [route, expectedHref] of nativeHandoffs) {
  const { html } = render(route);
  if (!html.includes(expectedHref)) {
    throw new Error(`Invite handoff for ${route} did not render ${expectedHref}`);
  }
}

console.log("Prerender complete.");
