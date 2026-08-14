const APP_STORE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";
const PLAY_STORE_SUBSCRIPTIONS_URL =
  "https://play.google.com/store/account/subscriptions?package=com.squadz.app";

/**
 * Returns the store-owned subscription-management page for a native IAP.
 * SquadZ+ is sold through App Store / Google Play via RevenueCat, never through
 * the Stripe customer portal.
 */
export function subscriptionManagementUrl(
  platform: string,
): string | null {
  if (platform === "ios") return APP_STORE_SUBSCRIPTIONS_URL;
  if (platform === "android") return PLAY_STORE_SUBSCRIPTIONS_URL;
  return null;
}