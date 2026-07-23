import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  Syne_600SemiBold,
  Syne_700Bold,
  Syne_800ExtraBold,
} from "@expo-google-fonts/syne";
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
import { TipsProvider } from "@/context/TipsContext";
import { ActivityProvider } from "@/context/ActivityContext";
import { ToastBannerProvider } from "@/context/ToastBannerContext";
import { ActivityBannerSurfacer } from "@/components/ActivityBannerSurfacer";
import { TipCoachMark } from "@/components/TipCoachMark";
import { installWebAlert } from "@/lib/webAlert";
import { configureRevenueCat, logOutRevenueCat, getLocalEntitlementActive } from "@/lib/revenuecat";
import { API_BASE, buildAuthHeaders, syncIapEntitlement } from "@/lib/api";
import { initMonitoring } from "@/lib/monitoring";
import { initAnalytics } from "@/lib/analytics";

installWebAlert();
initMonitoring();
initAnalytics();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const AUTH_SCREENS = ["login", "signup", "onboarding", "invite", "add"];

function AuthGuard() {
  const { isLoggedIn, isAuthRestoring, pendingOnboarding } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    // Wait for the AsyncStorage token restore to finish before making any
    // routing decisions. Without this guard, the first render (isLoggedIn=false)
    // would always redirect to /login before the stored session is checked.
    if (isAuthRestoring) return;

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

    if (pendingOnboarding && !isLoggedIn) {
      // The account exists but onboarding was never finished (registered, then
      // closed the app). Keep the user in onboarding so they resume where they
      // left off — but don't yank them out of an in-progress invite/public-join
      // deep link or the auth screens themselves.
      if (!isOnAuthScreen && !isOnPublicSquad && !isOnInviteJoin) {
        router.replace("/onboarding" as never);
      }
    } else if (!isLoggedIn && !isOnAuthScreen && !isOnPublicSquad && !isOnInviteJoin) {
      router.replace("/login" as never);
    } else if (isLoggedIn && (segments[0] === "login" || segments[0] === "signup")) {
      router.replace("/(tabs)" as never);
    }
  }, [isLoggedIn, pendingOnboarding, segments]);

  return null;
}

/**
 * Handles push notification registration in a single sequential flow.
 *
 * On each login:
 *   1. Request / confirm OS permission.
 *   2a. Permission granted → fetch the device's Expo push token and register it
 *       silently (POST /api/push-token is idempotent). No banner — once the user
 *       has granted OS permission we maximize reach by registering automatically.
 *   2b. Permission denied → show the banner so the user can enable notifications
 *       (its "Fix" button re-requests permission and registers on grant).
 *
 * The banner's "Fix" button re-requests permission, fetches a fresh device
 * token, POSTs it, and only dismisses when the server returns a 2xx response.
 *
 * Native-only — the whole component is a no-op on web.
 */
function PushNotificationHandler() {
  const { isLoggedIn, authToken } = useAuth();
  const checkedRef = useRef(false);
  const handledNotificationIds = useRef<Set<string>>(new Set());
  const [showBanner, setShowBanner] = useState(false);
  const [registering, setRegistering] = useState(false);

  // Sequential startup flow: permission → device token → silent registration
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
        if (cancelled) return;

        if (!granted) {
          // No OS permission — surface the banner so the user can enable it.
          if (!cancelled) setShowBanner(true);
          return;
        }

        // Step 2: permission granted — get the device token and register it
        // silently. POST /api/push-token is idempotent, so registering on every
        // launch is safe and keeps the server token fresh (covers first-run,
        // reinstall, and token drift) without making the user tap a banner.
        const tokenData = await Notifications.getExpoPushTokenAsync();
        const deviceToken = tokenData.data;
        if (cancelled) return;

        const res = await fetch(`${API_BASE}/api/push-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...buildAuthHeaders(authToken) },
          body: JSON.stringify({ token: deviceToken }),
        });
        if (cancelled) return;

        if (res.ok) {
          setShowBanner(false);
        } else {
          // Transient backend/network failure — allow a retry on the next
          // login cycle and surface the banner so the user has a manual path.
          checkedRef.current = false;
          setShowBanner(true);
        }
      } catch {
        // Network/permission error during registration — allow a retry next
        // login cycle so a transient blip doesn't silently drop push reach.
        if (!cancelled) checkedRef.current = false;
        // Never crash the app because of push token handling
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, authToken]);

  // Shared deep-link routing for notification taps, used by both the live
  // response listener and the cold-start launch handler.
  const routeFromNotificationData = useCallback((data?: Record<string, string>) => {
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
        // Vault comment notifications carry a photoId so the tap opens the
        // specific photo (VaultMediaDetail) rather than the generic vault.
        if (data.photoId) {
          router.push({
            pathname: "/vault",
            params: {
              ...(data.squadId ? { squadId: data.squadId } : {}),
              ...(data.eventId ? { eventId: data.eventId } : {}),
              photoId: data.photoId,
            },
          } as never);
        } else if (data.squadId) {
          router.push({ pathname: "/vault", params: { squadId: data.squadId } } as never);
        }
        break;
      case "friends":
        router.push("/friends" as never);
        break;
    }
  }, []);

  // Notification responses can be delivered to both the live listener and the
  // cold-start getLastNotificationResponseAsync() path; dedupe by identifier so
  // a single tap never routes twice.
  const handleNotificationResponse = useCallback(
    (response: { notification: { request: { identifier?: string; content: { data?: unknown } } } }) => {
      const id = response?.notification?.request?.identifier;
      if (id) {
        if (handledNotificationIds.current.has(id)) return;
        handledNotificationIds.current.add(id);
      }
      const data = response.notification.request.content.data as
        | Record<string, string>
        | undefined;
      routeFromNotificationData(data);
    },
    [routeFromNotificationData],
  );

  // Deep-link listener for notification taps. Handles taps while the app is
  // running (foreground/background) AND the launch notification when the app is
  // started from a fully-killed (cold) state via getLastNotificationResponseAsync.
  useEffect(() => {
    if (Platform.OS === "web") return;

    let sub: { remove(): void } | null = null;

    void (async () => {
      try {
        const Notifications = await import("expo-notifications");
        sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

        // Cold start: the response listener does not fire for the notification
        // that launched the app, so read it explicitly and route through the
        // same handler (deduped by notification identifier).
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last) handleNotificationResponse(last);
      } catch {
        // Ignore
      }
    })();

    return () => {
      sub?.remove();
    };
  }, [handleNotificationResponse]);

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

// Identify the signed-in user to RevenueCat (app_user_id = Squadz user id) so
// purchases and entitlements are tied to the account, and detach on logout.
// No-op on web / without SDK keys.
function RevenueCatConnector() {
  const { isLoggedIn, currentUser, authToken } = useAuth();
  useEffect(() => {
    if (isLoggedIn && currentUser.id) {
      void (async () => {
        await configureRevenueCat(currentUser.id);
        // B4: on launch, if the on-device RC entitlement disagrees with the
        // server-gated state, ask the server to re-sync from RevenueCat.
        try {
          const local = await getLocalEntitlementActive();
          if (local === null) return;
          const r = await fetch(`${API_BASE}/api/subscription`, {
            headers: buildAuthHeaders(authToken),
            credentials: "include",
          });
          if (!r.ok) return;
          const d = (await r.json()) as { isPro?: boolean };
          if (!!d.isPro !== local) void syncIapEntitlement(authToken);
        } catch {
          // Best-effort reconciliation only — never block launch on billing.
        }
      })();
    } else {
      void logOutRevenueCat();
    }
  }, [isLoggedIn, currentUser.id, authToken]);
  return null;
}

function MutedSquadsConnector({ children }: { children: React.ReactNode }) {
  const { authToken } = useAuth();
  return <MutedSquadsProvider authToken={authToken}>{children}</MutedSquadsProvider>;
}

function RootLayoutNav() {
  return (
    <>
      <AuthGuard />
      <RevenueCatConnector />
      <PushNotificationHandler />
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="invite" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="activity" />
        <Stack.Screen name="create" />
        <Stack.Screen name="event/[id]" />
        <Stack.Screen name="trip/[id]" />
        <Stack.Screen name="trip/start" />
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
      <TipCoachMark />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Syne_600SemiBold,
    Syne_700Bold,
    Syne_800ExtraBold,
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
                      <TipsProvider>
                        <ActivityProvider>
                          <ToastBannerProvider>
                            <RootLayoutNav />
                            <ActivityBannerSurfacer />
                          </ToastBannerProvider>
                        </ActivityProvider>
                      </TipsProvider>
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
