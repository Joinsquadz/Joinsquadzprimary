import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { getSquadzPlusPrices } from "@/lib/revenuecat";

type FoundingStatus = {
  spotsRemaining: number;
  isFoundingAvailable: boolean;
};

/**
 * Resolves the annual price shown outside the purchase sheet. A founding price
 * is never surfaced until the API confirms that founding spots are still
 * available; otherwise we keep the standard store price.
 */
export function useSquadzPlusPriceLabel(): string | null {
  const [price, setPrice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const prices = await getSquadzPlusPrices();
      let founding: FoundingStatus | null = null;
      try {
        const response = await fetch(`${API_BASE}/api/subscription/founding-status`);
        if (response.ok) {
          const data = (await response.json()) as Partial<FoundingStatus>;
          if (
            typeof data.spotsRemaining === "number" &&
            typeof data.isFoundingAvailable === "boolean"
          ) {
            founding = {
              spotsRemaining: data.spotsRemaining,
              isFoundingAvailable: data.isFoundingAvailable,
            };
          }
        }
      } catch {
        // An unverified founding tier must fall back to the standard store price.
      }
      if (cancelled) return;
      const foundingConfirmed =
        founding?.isFoundingAvailable === true && founding.spotsRemaining > 0;
      setPrice(
        foundingConfirmed
          ? prices.founding?.priceString ?? prices.standard?.priceString ?? null
          : prices.standard?.priceString ?? null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return price;
}

export function upgradeCtaLabel(price: string | null): string {
  return price ? `⚡ Upgrade to SquadZ+ — ${price}/year` : "⚡ Upgrade to SquadZ+";
}