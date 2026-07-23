// Best-effort Google Play subscription cancellation, used during account
// deletion (Apple provides no equivalent API for App Store subscriptions).
//
// Flow: look up the user's live subscriber state in RevenueCat (which stores
// the Play purchase token for Play-store purchases), then call the Google Play
// Developer API `purchases.subscriptions.cancel` with the service-account
// credentials in GOOGLE_PLAY_SERVICE_ACCOUNT_JSON. Every step is best-effort:
// missing configuration or API failures log and return — deletion never blocks.

import { logger } from "./logger";

const ANDROID_PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME || "com.squadz.app";

interface RcSubscription {
  store?: string;
  expires_date?: string | null;
  purchase_token?: string | null;
  product_identifier?: string | null;
}

export async function cancelPlaySubscriptionBestEffort(userId: string): Promise<void> {
  const rcKey = process.env.REVENUECAT_API_KEY;
  if (!rcKey) {
    logger.warn({ userId }, "REVENUECAT_API_KEY not set — skipping Play subscription cancel");
    return;
  }
  const rcRes = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${rcKey}` } },
  );
  if (!rcRes.ok) {
    logger.warn({ userId, status: rcRes.status }, "RevenueCat lookup failed — skipping Play cancel");
    return;
  }
  const body = (await rcRes.json()) as {
    subscriber?: {
      entitlements?: Record<string, { product_identifier?: string }>;
      subscriptions?: Record<string, RcSubscription>;
    };
  };
  const subs = body.subscriber?.subscriptions ?? {};
  // Find every ACTIVE play-store subscription (normally at most one).
  const now = Date.now();
  const candidates = Object.entries(subs).filter(([, s]) => {
    const active = s.expires_date == null || new Date(s.expires_date).getTime() > now;
    const isPlay = (s.store ?? "").toLowerCase() === "play_store";
    return active && isPlay;
  });
  if (candidates.length === 0) return; // no active Play subscription — nothing to do

  const credsJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!credsJson) {
    logger.warn(
      { userId },
      "Active Play subscription found but GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not set — cannot cancel; user must cancel via Play Store",
    );
    return;
  }

  const accessToken = await getPlayAccessToken(credsJson);
  for (const [productId, sub] of candidates) {
    const token = sub.purchase_token;
    if (!token) {
      logger.warn({ userId, productId }, "Play subscription without purchase token — skipping cancel");
      continue;
    }
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(ANDROID_PACKAGE_NAME)}` +
      `/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:cancel`;
    const cancelRes = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (cancelRes.ok) {
      logger.info({ userId, productId }, "Cancelled Play subscription during account deletion");
    } else {
      logger.error(
        { userId, productId, status: cancelRes.status },
        "Play subscription cancel failed (best-effort — continuing)",
      );
    }
  }
}

// Mint an OAuth2 access token for the androidpublisher scope from
// service-account JSON (JWT bearer grant — no SDK dependency needed).
async function getPlayAccessToken(credsJson: string): Promise<string> {
  const { createSign } = await import("node:crypto");
  const creds = JSON.parse(credsJson) as { client_email: string; private_key: string };
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(creds.private_key).toString("base64url");
  const jwt = `${header}.${claims}.${signature}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Play token exchange failed: ${tokenRes.status}`);
  const data = (await tokenRes.json()) as { access_token: string };
  return data.access_token;
}
