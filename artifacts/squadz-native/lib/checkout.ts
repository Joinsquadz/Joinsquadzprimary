import { Linking, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { buildAuthHeaders, resolveApiBase } from "@/lib/api";

export type CheckoutTier = "founding" | "standard";
export type CheckoutFailure = { ok: false; error: string };
export type CheckoutResult =
  | {
      ok: true;
      tier?: CheckoutTier;
      /**
       * When true the in-app browser was already dismissed and the caller
       * should poll the subscription immediately (native path).
       * When false the checkout URL was opened in an external tab/browser
       * and the caller should wait for an AppState "active" event (web path).
       */
      confirmNow: boolean;
    }
  | CheckoutFailure;

/**
 * Opens the Stripe checkout URL in a way that actually surfaces failure.
 *
 * On native (iOS / Android) we use WebBrowser.openBrowserAsync, which renders
 * the checkout inside a SFSafariViewController / Chrome Custom Tab that stays
 * embedded within the app session. The Promise blocks until the user taps
 * "Done" (or the payment flow completes a redirect), so the caller knows
 * exactly when to poll the subscription — no AppState race needed.
 *
 * On web, react-native-web's Linking.openURL calls
 * window.open(url,"_blank","noopener") and resolves successfully even when the
 * popup is BLOCKED (window.open returns null without throwing). Inside a
 * sandboxed preview iframe or with strict popup-blocker settings the checkout
 * silently does nothing. So on web we call window.open ourselves and check the
 * return:
 *  - popup opened → done;
 *  - popup blocked but we're a top-level tab → navigate in place (the
 *    /home?checkout=success return routing brings the user back);
 *  - popup blocked AND we're embedded in an iframe → fail loudly (Stripe
 *    checkout refuses to render inside frames, so in-place navigation would
 *    dead-end on a blank frame).
 */

export const POPUP_BLOCKED_ERROR =
  "Your browser blocked the checkout window. Open the app in its own browser tab and try again.";

async function openCheckoutUrl(url: string): Promise<boolean> {
  if (Platform.OS !== "web") {
    // In-app browser — blocks until user dismisses.
    await WebBrowser.openBrowserAsync(url, {
      // Dismiss button label (iOS). "Done" is the system default; keep it.
      dismissButtonStyle: "done",
      // Show the URL bar so users can verify they're on stripe.com.
      showInRecents: true,
    });
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

/**
 * Starts the Squadz+ checkout flow.
 *
 * Posts to /api/checkout to obtain a Stripe Checkout URL, then opens it:
 * - Native: in an in-app browser (SFSafariViewController / Chrome Custom Tab).
 *   The call blocks until the user dismisses the browser, then resolves with
 *   {ok: true, confirmNow: true} — the caller should immediately poll the
 *   subscription to confirm the upgrade. No AppState listener needed.
 * - Web: opens the URL in a new tab. Resolves with {ok: true, confirmNow: false}
 *   as soon as the tab is opened; the caller should wait for an AppState "active"
 *   event to confirm (the tab returns the user to the app via the success URL).
 *
 * The server decides the price tier (founding vs standard) atomically and
 * picks the matching Stripe price from its own env — the client no longer looks
 * up or sends a priceId, so it can't self-select the cheaper founding price.
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

    // confirmNow: true  = native in-app browser was dismissed → poll now
    // confirmNow: false = web tab opened externally → wait for AppState
    return { ok: true, tier, confirmNow: Platform.OS !== "web" };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
