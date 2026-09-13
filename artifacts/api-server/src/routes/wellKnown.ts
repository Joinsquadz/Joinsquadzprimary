import { Router, type IRouter, type Request, type Response } from "express";

/**
 * Apple App Site Association + Android Asset Links.
 *
 * These files let tapping a `https://joinsquadz.com/squad/join-public?id=<id>`
 * link open the native Squadz app directly (iOS universal links / Android app
 * links) instead of a browser. They MUST be served:
 *   - over HTTPS, with no redirects, and
 *   - with `Content-Type: application/json` (required by Android's Digital
 *     Asset Links verifier; recommended by Apple).
 *
 * This router is mounted at the app root (NOT under `/api`) so the files are
 * reachable at the canonical `/.well-known/*` paths. The shared reverse proxy
 * routes `/.well-known` to this service (see artifact.toml `paths`).
 *
 * Android identity values that are only known once the app is signed are read
 * from env vars so they can be set at deploy time without a code change:
 *   - ANDROID_PACKAGE_NAME — Android applicationId (defaults to com.squadz.app).
 *   - ANDROID_SHA256_CERT_FINGERPRINTS — comma-separated SHA-256 signing-cert
 *                            fingerprints (colon-separated hex per fingerprint).
 *
 * Until the real values are provided the files are still valid JSON and serve
 * correctly; they just won't verify against a real installed build.
 */

const router: IRouter = Router();

const IOS_APP_ID = "2567CLAZKC.com.squadz.app";

function androidPackageName(): string {
  return process.env.ANDROID_PACKAGE_NAME?.trim() || "com.squadz.app";
}

function androidFingerprints(): string[] {
  return (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((fp) => fp.trim())
    .filter((fp) => fp.length > 0);
}

function androidProductionIdentityError(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (androidPackageName() !== "com.squadz.app") {
    return "ANDROID_PACKAGE_NAME must match the signed com.squadz.app package";
  }
  const fingerprints = androidFingerprints();
  if (
    fingerprints.length === 0 ||
    fingerprints.some((fingerprint) => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(fingerprint))
  ) {
    return "ANDROID_SHA256_CERT_FINGERPRINTS must include the signed Android certificate";
  }
  return null;
}

router.get(
  "/.well-known/apple-app-site-association",
  (_req: Request, res: Response): void => {
    const body = {
      applinks: {
        apps: [],
        details: [
          {
            // Legacy keys (iOS 9–12)
            appID: IOS_APP_ID,
            paths: [
              "/squad/join-public",
              "/squad/join-public/*",
              "/squad/join",
              "/squad/join/*",
              "/squad/*",
              "/join/*",
              "/api/add/friend/*",
            ],
            // Modern keys (iOS 13+) — take precedence when supported.
            appIDs: [IOS_APP_ID],
            components: [
              {
                "/": "/squad/join-public",
                comment: "Open shared public-squad links in the Squadz app",
              },
              {
                "/": "/squad/join",
                comment: "Open shared squad invite-code links in the Squadz app",
              },
              {
                "/": "/squad/join/*",
                comment: "Open shared squad invite-code links in the Squadz app",
              },
              {
                "/": "/squad/*",
                comment: "Open shared squad links in the Squadz app",
              },
              {
                "/": "/join/*",
                comment: "Open shared event invite links in the Squadz app",
              },
              {
                "/": "/api/add/friend/*",
                comment: "Open shared friend-code links in the Squadz app",
              },
            ],
          },
        ],
      },
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(JSON.stringify(body));
  },
);

router.get(
  "/.well-known/assetlinks.json",
  (_req: Request, res: Response): void => {
    const configurationError = androidProductionIdentityError();
    if (configurationError) {
      res.status(503).json({ error: "App-link association is not configured", detail: configurationError });
      return;
    }
    const body = [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: androidPackageName(),
          sha256_cert_fingerprints: androidFingerprints(),
        },
      },
    ];
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(JSON.stringify(body));
  },
);

export default router;
