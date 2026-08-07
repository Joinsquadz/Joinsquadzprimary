import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * GET /add/friend/:code  (effective path: /api/add/friend/:code via app.use("/api", router))
 *
 * Public (no auth required).
 *
 * - Accept: application/json → return the inviter's public profile as JSON.
 *   Used by the in-app /add/friend/[code] screen to show name + avatar.
 *
 * - Everything else (browser) → serve an HTML redirect page that immediately
 *   tries the native deep link (squadz-native://add/friend/:code) and falls
 *   back to the Expo web screen (/mobile/add/friend/:code) after 1 s.
 */
// Only allow codes in the SquadZ format: SQ- followed by 1–12 uppercase
// alphanumeric characters.  This allowlist is enforced BEFORE any HTML
// rendering, which ensures the code value is always safe for use in URLs
// and HTML attribute values without further escaping.
const FRIEND_CODE_RE = /^SQ-[A-Z0-9]{1,12}$/;

router.get("/add/friend/:code", async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = (req.params.code as string).toUpperCase().trim();
    if (!FRIEND_CODE_RE.test(raw)) {
      res.status(400).json({ error: "Invalid friend code format." });
      return;
    }
    const code = raw; // guaranteed safe for HTML/URL after allowlist check

    const [user] = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        friendCode: usersTable.friendCode,
      })
      .from(usersTable)
      .where(eq(usersTable.friendCode, code));

    // Prefer HTML (browser / share-link tap) unless the client explicitly
    // requests JSON (in-app fetch with Accept: application/json).
    const wantsJson = req.accepts(["html", "json"]) === "json";

    if (!user) {
      if (wantsJson) {
        res.status(404).json({ error: "No user found with that friend code." });
      } else {
        const host = req.headers.host ?? "";
        const protocol = req.headers["x-forwarded-proto"] ?? "https";
        const origin = `${protocol}://${host}`;
        res.status(404).send(buildRedirectPage(code, null, origin));
      }
      return;
    }

    if (wantsJson) {
      res.json(user);
      return;
    }

    // Browser request — serve an HTML page that opens the native deep link
    // (squadz-native://add/friend/:code) and falls back to the Expo web screen.
    const host = req.headers.host ?? "";
    const protocol = req.headers["x-forwarded-proto"] ?? "https";
    const origin = `${protocol}://${host}`;
    const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || "your friend";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildRedirectPage(code, displayName, origin));
  } catch (err) {
    logger.error({ err }, "Error looking up friend invite");
    res.status(500).json({ error: "Failed to look up friend code" });
  }
});

function buildRedirectPage(code: string, name: string | null, origin: string): string {
  const deepLink = `squadz-native://add/friend/${code}`;
  const webFallback = `${origin}/mobile/add/friend/${code}`;
  const displayName = name ?? code;
  const escapedCode = code.replace(/[^A-Z0-9-]/g, "");
  const escapedName = displayName.replace(/[<>"'&]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "&": "&amp;" }[c] ?? c),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Add ${escapedName} on SquadZ</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0A0A0F; color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px;
    }
    .card {
      text-align: center; max-width: 360px; width: 100%;
      background: #16161F; border: 1px solid #2A2A3A;
      border-radius: 24px; padding: 40px 32px; gap: 0;
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    p { color: #888; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    .code {
      font-size: 28px; font-weight: 900; letter-spacing: 3px;
      color: #FF5C3A; margin-bottom: 28px;
      font-variant-numeric: tabular-nums;
    }
    a.btn {
      display: block; background: #FF5C3A; color: #fff;
      text-decoration: none; font-weight: 700; font-size: 16px;
      border-radius: 14px; padding: 15px; margin-bottom: 12px;
    }
    a.btn-outline {
      display: block; border: 1.5px solid #FF5C3A; color: #FF5C3A;
      text-decoration: none; font-weight: 700; font-size: 14px;
      border-radius: 14px; padding: 13px;
    }
    .hint { color: #555; font-size: 12px; margin-top: 20px; }
  </style>
  <script>
    // Immediately try to open the native app
    window.location.href = ${JSON.stringify(deepLink)};
    // Fall back to the web screen after 1.5 s if the app didn't open
    setTimeout(function() {
      window.location.replace(${JSON.stringify(webFallback)});
    }, 1500);
  </script>
</head>
<body>
  <div class="card">
    <div class="logo">👥</div>
    <h1>Add ${escapedName} on SquadZ</h1>
    <p>Opening the SquadZ app…</p>
    <div class="code">${escapedCode}</div>
    <a class="btn" href="${deepLink}">Open in SquadZ</a>
    <a class="btn-outline" href="${webFallback}">Continue in browser</a>
    <p class="hint">Don't have SquadZ yet? Tap "Continue in browser" to add ${escapedName} after signing up.</p>
  </div>
</body>
</html>`;
}

export default router;
