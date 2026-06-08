/**
 * Error tracking & crash reporting — Sentry React Native.
 *
 * Required env vars (Expo public prefix):
 *   EXPO_PUBLIC_SENTRY_DSN
 *
 * Call initMonitoring() once at app startup (e.g. _layout.tsx).
 * No-ops silently when the DSN is absent.
 */
import * as Sentry from "@sentry/react-native";

export function initMonitoring(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    enabled: !__DEV__,
  });
}

export { Sentry };
