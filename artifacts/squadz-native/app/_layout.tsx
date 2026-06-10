import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PushNotificationBanner } from "@/components/PushNotificationBanner";
import { AppProvider, useAuth } from "@/context/AppContext";
import { ToastProvider } from "@/context/ToastContext";
import { MessagesProvider } from "@/context/MessagesContext";
import { UserCacheProvider } from "@/context/UserCacheContext";
import { MutedSquadsProvider } from "@/context/MutedSquadsContext";
import { installWebAlert } from "@/lib/webAlert";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { initMonitoring } from "@/lib/monitoring";
import { initAnalytics } from "@/lib/analytics";

installWebAlert();
initMonitoring();
initAnalytics();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const AUTH_SCREENS = ["login", "signup", "onboarding", "invite", "add"];

function AuthGuard() {
  const { isLoggedIn } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    const isOnAuthScreen = AUTH_SCREENS.includes(segments[0] as string);
    // The public-squad preview is reachable by logged-out friends via a shared
    // deep-link, so it must be allowed even when unauthenticated. The screen
    // itself routes to login/signup (carrying the squad id) when the user taps
    // Join while logged out.
    const isOnPublicSquad =
      (segments[0] as string) === "squad" && (segments[1] as string) === "join-public";
    // Shared squad/event invite deep-links may be opened by logged-out friends.
    // The screens themselves bounce to login (carrying the code) so they must
    // be reachable while unauthenticated.
    const isOnInviteJoin =
      ((segments[0] as string) === "squad" && (segments[1] as string) === "join") ||
      (segments[0] as string) === "join";

    if (!isLoggedIn && !isOnAuthScreen && !isOnPublicSquad && !isOnInviteJoin) {
      router.replace("/login" as never);
    } else if (isLoggedIn && (segments[0] === "login" || segments[0] === "signup")) {
      router.replace("/(tabs)" as never);
    }
  }, [isLoggedIn, segments]);

  return null;
}

/**
 * Handles push notification registration and stale-token detection in a single
 * sequential flow — no race between a drift check and auto-registration.
 *
 * On each login:
 *   1. Request / confirm permission.
 *   2. Fetch the device's current Expo push token.
 *   3. Fetch the server's stored token (GET /api/push-token).
 *   4a. If they match → silent idempotent re-registration, no banner.
 *   4b. If they differ (server has null or an old token) → show banner;
 *       do NOT auto-register so the server stays accurately "stale" until
 *       the user explicitly re-enables.
 *
 * The banner's "Fix" button re-fetches a fresh device token, POSTs it, and
 * only dismisses the banner when the server returns a 2xx response.
 *
 * Native-only — the whole component is a no-op on web.
 */
function PushNotificationHandler() {
  const { isLoggedIn, authToken } = useAuth();
  const checkedRef = useRef(false);
  const [showBanner, setShowBanner] = useState(false);
  const [registering, setRegistering] = useState(false);

  // Sequential startup check: permission → device token → server token → decision
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!isLoggedIn || !authToken) {
      // Reset on logout so the check runs again after a fresh login
      checkedRef.current = false;
      setShowBanner(false);
      return;
    }
    if (checkedRef.current) return;
    checkedRef.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const Notifications = await import("expo-notifications");

        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });

        // Step 1: ensure/request permission
        let granted = false;
        const existing = await Notifications.getPermissionsAsync();
        granted = existing.granted || existing.status === "granted";
        if (!granted) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.granted || req.status === "granted";
        }
        if (!granted || cancelled) return;

        // Step 2: get device token
        const tokenData = await Notifications.getExpoPushTokenAsync();
        const deviceToken = tokenData.data;
        if (cancelled) return;

        // Step 3: get server token — sequential, no race
        const serverRes = await fetch(`${API_BASE}/api/push-token`, {
          headers: buildAuthHeaders(authToken),
        });

        if (cancelled) return;

        if (!serverRes.ok) {
          // Can't check — fall back to normal silent registration
          await fetch(`${API_BASE}/api/push-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...buildAuthHeaders(authToken) },
            body: JSON.stringify({ token: deviceToken }),
          });
          return;
        }

        const { token: serverToken } = (await serverRes.json()) as { token: string | null };

        // Step 4: decide
        if (serverToken === deviceToken) {
          // Tokens already match — silent idempotent registration
          await fetch(`${API_BASE}/api/push-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...buildAuthHeaders(authToken) },
            body: JSON.stringify({ token: deviceToken }),
          });
        } else {
          // Stale or missing — show banner, do NOT auto-register
          if (!cancelled) setShowBanner(true);
        }
      } catch {
        // Never crash the app because of push token handling
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, authToken]);

  // Deep-link listener for notification taps
  useEffect(() => {
    if (Platform.OS === "web") return;

    let sub: { remove(): void } | null = null;

    void (async () => {
      try {
        const Notifications = await import("expo-notifications");
        sub = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response.notification.request.content.data as Record<string, string> | undefined;
          if (!data?.screen) return;

          switch (data.screen) {
            case "availability":
              if (data.squadId) {
                router.push({ pathname: "/availability", params: { squadId: data.squadId } } as never);
              } else if (data.eventId) {
                router.push({ pathname: "/availability", params: { eventId: data.eventId } } as never);
              }
              break;
            case "conversation":
              if (data.conversationId) {
                router.push({ pathname: "/conversation/[id]", params: { id: data.conversationId } } as never);
              }
              break;
            case "event":
              if (data.eventId) {
                router.push({ pathname: "/event/[id]", params: { id: data.eventId } } as never);
              }
              break;
            case "squad":
              if (data.squadId) {
                router.push({ pathname: "/squad/[id]", params: { id: data.squadId } } as never);
              }
              break;
            case "vault":
              if (data.squadId) {
                router.push({ pathname: "/vault", params: { squadId: data.squadId } } as never);
              }
              break;
            case "friends":
              router.push("/friends" as never);
              break;
          }
        });
      } catch {
        // Ignore
      }
    })();

    return () => {
      sub?.remove();
    };
  }, []);

  const handleReEnable = useCallback(() => {
    if (!authToken || registering) return;
    setRegistering(true);

    void (async () => {
      try {
        const Notifications = await import("expo-notifications");

        // Re-request permission if needed
        let granted = false;
        const existing = await Notifications.getPermissionsAsync();
        granted = existing.granted || existing.status === "granted";
        if (!granted) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.granted || req.status === "granted";
        }
        if (!granted) {
          // User denied — dismiss banner (nothing more we can do)
          setShowBanner(false);
          return;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync();
        const token = tokenData.data;

        const res = await fetch(`${API_BASE}/api/push-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...buildAuthHeaders(authToken) },
          body: JSON.stringify({ token }),
        });

        if (res.ok) {
          // Only dismiss when the server confirms the new token was saved
          setShowBanner(false);
        }
        // On failure: keep banner visible so the user can retry
      } catch {
        // Network error — keep banner visible so the user can retry
      } finally {
        setRegistering(false);
      }
    })();
  }, [authToken, registering]);

  const handleDismiss = useCallback(() => setShowBanner(false), []);

  return (
    <PushNotificationBanner
      visible={showBanner}
      registering={registering}
      onReEnable={handleReEnable}
      onDismiss={handleDismiss}
    />
  );
}

function MutedSquadsConnector({ children }: { children: React.ReactNode }) {
  const { authToken } = useAuth();
  return <MutedSquadsProvider authToken={authToken}>{children}</MutedSquadsProvider>;
}

function RootLayoutNav() {
  return (
    <>
      <AuthGuard />
      <PushNotificationHandler />
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="invite" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="create" />
        <Stack.Screen name="event/[id]" />
        <Stack.Screen name="squad/[id]" />
        <Stack.Screen name="squad/join" />
        <Stack.Screen name="squad/join-public" />
        <Stack.Screen name="join/[inviteCode]" />
        <Stack.Screen name="squad/create" />
        <Stack.Screen name="conversation/[id]" />
        <Stack.Screen name="moment/compose" />
        <Stack.Screen name="friends" />
        <Stack.Screen name="vault" />
        <Stack.Screen name="availability" />
        <Stack.Screen name="settings/edit-profile" />
        <Stack.Screen name="settings/notifications" />
        <Stack.Screen name="settings/privacy" />
        <Stack.Screen name="add/friend/[code]" />
        <Stack.Screen name="user/[id]" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <ToastProvider>
              <AppProvider>
                <MutedSquadsConnector>
                  <UserCacheProvider>
                    <MessagesProvider>
                      <RootLayoutNav />
                    </MessagesProvider>
                  </UserCacheProvider>
                </MutedSquadsConnector>
              </AppProvider>
              </ToastProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
