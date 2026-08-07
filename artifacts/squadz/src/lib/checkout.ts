const PRO_PRODUCT_NAME = "SquadZ Pro";
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
 * Starts the SquadZ Pro checkout flow on web:
 * fetch products-with-prices → find the Pro yearly price → POST /api/checkout
 * → redirect the browser to the returned Stripe URL.
 *
 * On success the browser is redirected and the returned promise resolves to
 * `{ ok: true }`. On failure it resolves to `{ ok: false, error }` so callers
 * can surface the message in their own UI.
 *
 * @param returnTab Optional tab to return to after Stripe redirects back. When
 * provided it is stashed in sessionStorage so the post-checkout flow can route
 * the user back to the right place.
 */
export async function startProCheckout(returnTab?: string): Promise<CheckoutResult> {
  try {
    const productsRes = await fetch("/api/products-with-prices", { credentials: "include" });
    const { data: products } = (await productsRes.json()) as ProductsResponse;

    const pro = products.find((p) => p.name === PRO_PRODUCT_NAME);
    const yearlyPrice = pro?.prices.find((p) => p.recurring?.interval === PRO_PRICE_INTERVAL);

    if (!yearlyPrice) {
      return { ok: false, error: "SquadZ Pro plan not found. Please try again later." };
    }

    // Server resolves the current user from session — no userId sent from client.
    const checkoutRes = await fetch("/api/checkout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId: yearlyPrice.id }),
    });

    const { url, error: apiError } = (await checkoutRes.json()) as { url?: string; error?: string };
    if (apiError || !url) {
      return { ok: false, error: apiError ?? "Failed to start checkout. Please try again." };
    }

    if (returnTab) {
      sessionStorage.setItem("squadz:checkoutReturnTab", returnTab);
    }
    window.location.href = url;
    return { ok: true };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
