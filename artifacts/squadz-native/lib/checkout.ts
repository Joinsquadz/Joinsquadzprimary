import { Linking } from "react-native";
import { buildAuthHeaders, resolveApiBase } from "@/lib/api";

const PRO_PRODUCT_NAME = "Squadz Pro";
const PRO_PRICE_INTERVAL = "year";

type ProductsResponse = {
  data: Array<{
    id: string;
    name: string;
    prices: Array<{ id: string; recurring: { interval: string } | null }>;
  }>;
};

export type CheckoutFailure = { ok: false; error: string };
export type CheckoutResult = { ok: true } | CheckoutFailure;

/**
 * Starts the Squadz Pro checkout flow on mobile:
 * fetch products-with-prices → find the Pro yearly price → POST /api/checkout
 * → open the returned Stripe URL in the system browser.
 *
 * On success the URL is opened and the promise resolves to `{ ok: true }`.
 * On failure it resolves to `{ ok: false, error }` so callers can surface the
 * message however they like (typically an Alert).
 *
 * @param token Auth token for the current user (null if unauthenticated).
 */
export async function startProCheckout(token: string | null): Promise<CheckoutResult> {
  const apiBase = resolveApiBase();
  const authHeaders = buildAuthHeaders(token);
  try {
    const productsRes = await fetch(`${apiBase}/api/products-with-prices`);
    const { data: products } = (await productsRes.json()) as ProductsResponse;

    const pro = products.find((p) => p.name === PRO_PRODUCT_NAME);
    const yearlyPrice = pro?.prices.find((p) => p.recurring?.interval === PRO_PRICE_INTERVAL);

    if (!yearlyPrice) {
      return { ok: false, error: "Pro plan not found. Please try again later." };
    }

    const checkoutRes = await fetch(`${apiBase}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ priceId: yearlyPrice.id }),
    });

    const { url, error: apiError } = (await checkoutRes.json()) as { url?: string; error?: string };
    if (apiError || !url) {
      return { ok: false, error: apiError ?? "Failed to start checkout. Please try again." };
    }

    await Linking.openURL(url);
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
