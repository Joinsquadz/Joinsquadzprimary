import { Linking } from "react-native";
import { buildAuthHeaders, resolveApiBase } from "@/lib/api";

export type CheckoutTier = "founding" | "standard";
export type CheckoutFailure = { ok: false; error: string; requiresEmailVerification?: boolean };
export type CheckoutResult = { ok: true; tier?: CheckoutTier } | CheckoutFailure;

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

    const { url, tier, error: apiError, requiresEmailVerification } = (await checkoutRes.json()) as {
      url?: string;
      tier?: CheckoutTier;
      error?: string;
      requiresEmailVerification?: boolean;
    };
    if (apiError || !url) {
      return { ok: false, error: apiError ?? "Failed to start checkout. Please try again.", requiresEmailVerification };
    }

    await Linking.openURL(url);
    return { ok: true, tier };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
