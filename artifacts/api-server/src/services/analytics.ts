/**
 * Server-side analytics — PostHog.
 * Set POSTHOG_API_KEY (and optionally POSTHOG_HOST) to enable.
 * All calls are no-ops when the key is absent.
 */
import { PostHog } from "posthog-node";
import { logger } from "../lib/logger";

function init(): PostHog | null {
  const key = process.env.POSTHOG_API_KEY;
  if (!key) return null;
  return new PostHog(key, {
    host: process.env.POSTHOG_HOST ?? "https://app.posthog.com",
    flushAt: 20,
    flushInterval: 10_000,
  });
}

export const analytics: PostHog | null = init();

if (analytics) {
  logger.info("[services/analytics] PostHog analytics initialised");
}

export function trackEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!analytics) return;
  analytics.capture({ distinctId, event, properties: properties ?? {} });
}

export function identifyUser(
  distinctId: string,
  traits?: Record<string, unknown>,
): void {
  if (!analytics) return;
  analytics.identify({ distinctId, properties: traits ?? {} });
}

export async function shutdownAnalytics(): Promise<void> {
  if (!analytics) return;
  await analytics.shutdown();
}
