/**
 * Client-side analytics — PostHog React Native.
 *
 * Required env vars (Expo public prefix):
 *   EXPO_PUBLIC_POSTHOG_API_KEY
 *   EXPO_PUBLIC_POSTHOG_HOST  (optional, defaults to https://app.posthog.com)
 *
 * Call initAnalytics() once at app startup (e.g. _layout.tsx).
 * No-ops silently when the key is absent.
 */
import PostHog from "posthog-react-native";

let _client: PostHog | null = null;

export function initAnalytics(): PostHog | null {
  const key = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  if (!key || _client) return _client;
  _client = new PostHog(key, {
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com",
  });
  return _client;
}

export function track(
  event: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: Record<string, any>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client?.capture(event, properties as any);
}

export function identify(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  traits?: Record<string, any>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client?.identify(userId, traits as any);
}

export function reset(): void {
  _client?.reset();
}
