import { Linking, Platform } from "react-native";
import { buildAuthHeaders, resolveApiBase } from "@/lib/api";

export type CheckoutTier = "founding" | "standard";
export type CheckoutFailure = { ok: false; error: string };
export type CheckoutResult = { ok: true; tier?: CheckoutTier } | CheckoutFailure;

/**
 * Opens the Stripe checkout URL in a way that actually surfaces failure.
 *
 * On native, `Linking.openURL` hands off to the system browser and works.
 *
 * On web, react-native-web's `Linking.openURL` calls
 * `window.open(url, "_blank", "noopener")` and resolves even when the popup
 * is BLOCKED (window.open returns null without throwing) — e.g. inside a
 * sandboxed preview iframe or when the browser suppresses popups after an
 * async fetch. The app then thinks checkout opened and silently waits
 * forever. So on web we call window.open ourselves and check the return:
 * - popup opened → done;
 * - popup blocked but we're a top-level tab → navigate in place (the
 *   `/home?checkout=success` return routing brings the user back);
 * - popup blocked AND we're embedded in an iframe → fail loudly. Stripe
 *   checkout refuses to render inside frames, so in-place navigation would
 *   dead-end on a blank frame.
 */
async function openCheckoutUrl(url: string): Promise<boolean> {
  if (Platform.OS !== "web") {
    await Linking.openURL(url);
    return true;
  }
  if (typeof window === "undefined") return false;
  const popup = window.open(url, "_blank", "noopener");
  if (popup) return true;
  let embedded = true;
  try {
    embedded = window.self !== window.top;
  } catch {
    embedded = true; // cross-origin top access throws → we're framed
  }
  if (!embedded) {
    window.location.assign(url);
    return true;
  }
  return false;
}

export const POPUP_BLOCKED_ERROR =
  "Your browser blocked the checkout window. Open the app in its own browser tab and try again.";

/**
 * Starts the Squadz+ checkout flow on mobile:
 * POST /api/checkout → open the returned Stripe URL in the system browser.
 *
 * The server now decides the price tier (founding vs standard) atomically and
 * picks the matching Stripe price from its own env — the client no longer looks
 * up or sends a priceId, so it can't self-select the cheaper founding price.
 *
 * On success the URL is opened and the promise resolves to `{ ok: true, tier }`.
 * On failure it resolves to `{ ok: false, error }` so callers can surface the
 * message however they like (typically an Alert).
 *
 * @param token Auth token for the current user (null if unauthenticated).
 */
export async function startProCheckout(token: string | null): Promise<CheckoutResult> {
  const apiBase = resolveApiBase();
  const authHeaders = buildAuthHeaders(token);
  try {
    const checkoutRes = await fetch(`${apiBase}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({}),
    });

    const { url, tier, error: apiError } = (await checkoutRes.json()) as {
      url?: string;
      tier?: CheckoutTier;
      error?: string;
    };
    if (apiError || !url) {
      return { ok: false, error: apiError ?? "Failed to start checkout. Please try again." };
    }

    const opened = await openCheckoutUrl(url);
    if (!opened) {
      return { ok: false, error: POPUP_BLOCKED_ERROR };
    }
    return { ok: true, tier };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
