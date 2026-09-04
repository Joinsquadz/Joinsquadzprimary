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
import { InteractionManager, Linking, Platform, View } from "react-native";
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
import { TimezoneProvider } from "@/context/TimezoneContext";
import { ToastBannerProvider } from "@/context/ToastBannerContext";
import { ActivityBannerSurfacer } from "@/components/ActivityBannerSurfacer";
import { TipCoachMark } from "@/components/TipCoachMark";
import { KeyboardDismissControl } from "@/components/KeyboardDismissControl";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { installWebAlert } from "@/lib/webAlert";
import { installWebShare } from "@/lib/webShare";
import { logOutRevenueCat, addEntitlementListener } from "@/lib/revenuecat";
import { reconcileRcEntitlement } from "@/lib/rcReconcile";
import { routeFromNotificationData } from "@/lib/routeFromNotificationData";
import { createNotificationRouteDrainer } from "@/lib/notificationRouteQueue";
import { createNotificationResponseHandler } from "@/lib/notificationResponseHandler";
import { decidePushPermissionAction } from "@/lib/pushPermissionAction";
import { useUserCache } from "@/context/UserCacheContext";
import { initMonitoring } from "@/lib/monitoring";
import { initAnalytics } from "@/lib/analytics";
import { parsePendingInviteUrl, pendingInviteRoute, savePendingInvite } from "@/lib/pendingInvite";

installWebAlert();
installWebShare();
initMonitoring();
initAnalytics();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const AUTH_SCREENS = ["login", "signup", "onboarding", "invite", "add"];

// Taps queued while auth restores. Bounded so a burst of notifications can
// never grow without limit; the newest taps are the ones worth honouring.
const MAX_QUEUED_NOTIFICATION_ROUTES = 5;

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
      // deep link, or out of onboarding/signup themselves. login IS redirected:
      // with Stack.Protected, a cold start at "/" falls back to login (the
      // first unguarded screen), so a pending-onboarding user would otherwise
      // be stranded there instead of resuming onboarding.
      const isResumableHere =
        (segments[0] as string) === "onboarding" ||
        (segments[0] as string) === "signup" ||
        (segments[0] as string) === "invite" ||
        (segments[0] as string) === "add";
      if (!isResumableHere && !isOnPublicSquad && !isOnInviteJoin) {
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
 * Fallback pages copy a canonical HTTPS invite before sending a visitor to the
 * store. On the first native launch recover that one clipboard value only after
 * auth hydration, persist it before touching the clipboard, then enter the
 * normal deep-link/auth flow. The ref prevents navigation loops on rerenders.
 */
function ClipboardInviteRecovery() {
  const { isAuthRestoring } = useAuth();
  const recovered = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web" || isAuthRestoring || recovered.current) return;
    recovered.current = true;
    void (async () => {
      try {
        // Dynamic native-only import keeps the root bundle safe on web.
        const Clipboard = await import("expo-clipboard");
        const text = await Clipboard.getStringAsync();
        const invite = parsePendingInviteUrl(text);
        if (!invite || !(await savePendingInvite(invite))) return;
        // Never erase arbitrary clipboard content, and only clear a recognized
        // invite after AsyncStorage confirms it was written.
        await Clipboard.setStringAsync("");
        router.replace(pendingInviteRoute(invite) as never);
      } catch {
        // Clipboard access is best-effort; direct links still work normally.
      }
    })();
  }, [isAuthRestoring]);

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
  const [pendingNotificationRoutes, setPendingNotificationRoutes] = useState<Record<string, string>[]>([]);
  const notificationQueueMountedRef = useRef(true);
  const notificationDrainerRef = useRef<ReturnType<
    typeof createNotificationRouteDrainer<Record<string, string>>
  > | null>(null);
  if (!notificationDrainerRef.current) {
    notificationDrainerRef.current = createNotificationRouteDrainer<Record<string, string>>(
      (data) => routeFromNotificationData(data),
      (done) => {
        InteractionManager.runAfterInteractions(done);
      },
      () => {
        if (notificationQueueMountedRef.current) {
          setPendingNotificationRoutes((prev) => prev.slice(1));
        }
      },
    );
  }
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

        // Step 1: ensure/request permission. Never open Settings from this
        // automatic path — yanking a user into system Settings on launch is
        // hostile. A permanent denial just surfaces the banner, and the user's
        // own "Fix" tap is what opens Settings.
        const existing = await Notifications.getPermissionsAsync();
        let granted = existing.granted || existing.status === "granted";
        const action = decidePushPermissionAction(
          { granted, canAskAgain: existing.canAskAgain },
          false,
        );
        if (action === "request") {
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

  // routeFromNotificationData is imported from @/lib/routeFromNotificationData
  // so it can be unit-tested independently of this component.
  // createNotificationResponseHandler is imported from @/lib/notificationResponseHandler
  // and carries the dedup logic so it too can be unit-tested independently.

  // Notification responses can be delivered to both the live listener and the
  // cold-start getLastNotificationResponseAsync() path; dedupe by identifier so
  // a single tap never routes twice.
  const queueNotificationRoute = useCallback((data: Record<string, string> | undefined) => {
    // Wait for the authenticated navigator. On a cold push launch, routing
    // before session restoration makes a valid plan fetch with missing/stale
    // credentials and strands the user on a generic load error. Queue in tap
    // order — two notifications arriving together (the reported Vegas case)
    // must not overwrite each other, and the last tap ends up on top.
    if (data?.screen) {
      setPendingNotificationRoutes((prev) => [...prev, data].slice(-MAX_QUEUED_NOTIFICATION_ROUTES));
    }
  }, []);

  const handleNotificationResponse = useCallback(
    createNotificationResponseHandler(
      handledNotificationIds.current,
      queueNotificationRoute,
    ),
    // createNotificationResponseHandler and routeFromNotificationData are both
    // stable references — the handler is created once and reused across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A notification can launch the process before auth hydration completes.
  // Retain validated payloads, then route exactly ONE at a time in arrival
  // order once detail screens can use the shared authenticated request path.
  // Calling router.push for the whole queue in one render races Stack
  // transitions and leaves an arbitrary destination on top.
  useEffect(() => {
    if (pendingNotificationRoutes.length === 0 || !isLoggedIn || !authToken) return;
    // The drainer owns the in-flight navigation and survives queue appends. A
    // second tap arriving mid-transition must NOT cancel the first route's
    // completion callback, or the rest of the queue is stranded forever.
    notificationDrainerRef.current?.drain(pendingNotificationRoutes[0]);
  }, [pendingNotificationRoutes, isLoggedIn, authToken]);

  useEffect(() => {
    return () => {
      notificationQueueMountedRef.current = false;
    };
  }, []);

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

        // Re-request permission if needed. This path IS user-initiated, so a
        // permanent denial is allowed to open Settings.
        const existing = await Notifications.getPermissionsAsync();
        let granted = existing.granted || existing.status === "granted";
        const action = decidePushPermissionAction(
          { granted, canAskAgain: existing.canAskAgain },
          true,
        );
        if (action === "open-settings") {
          // The OS will never show the prompt again, so re-requesting is a
          // silent no-op — which is exactly why "Fix" appeared to do nothing.
          // Keep the banner up: permission isn't granted until they return.
          await Linking.openSettings();
          return;
        }
        if (action === "request") {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.granted || req.status === "granted";
        }
        if (!granted) {
          // Declined at the prompt — dismiss the banner; they can re-enable
          // later from Settings and the next login re-checks.
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
  const { isLoggedIn, currentUser, authToken, setEntitlement } = useAuth();
  const { refreshUsers } = useUserCache();

  // Keep the newest callbacks in a ref so the listener effect below can depend
  // ONLY on the signed-in user. Otherwise every render with a new callback
  // identity would tear down and re-register the RevenueCat listener.
  const handlersRef = useRef({ setEntitlement, refreshUsers, userId: currentUser.id });
  handlersRef.current = { setEntitlement, refreshUsers, userId: currentUser.id };

  useEffect(() => {
    if (isLoggedIn && currentUser.id) {
      const userId = currentUser.id;
      // On launch, reconcile the on-device RC entitlement with the server, and
      // publish the result into the global entitlement store.
      // See lib/rcReconcile.ts for the full algorithm (Cases 1 & 2).
      void reconcileRcEntitlement({
        authToken,
        userId,
        refreshUsers,
        onEntitlement: (next) => handlersRef.current.setEntitlement(next),
      });
    } else {
      void logOutRevenueCat();
    }
  }, [isLoggedIn, currentUser.id, authToken]);

  // Exactly ONE app-wide RevenueCat customer-info listener, owned here.
  //
  // This is what makes entitlement changes that originate outside a purchase
  // flow land in the UI: renewals, expiries, Ask-to-Buy approvals, family
  // sharing, and purchases completed on another device. It is scoped to the
  // signed-in user and torn down on logout so a listener from a previous session
  // can never write another account's entitlement into the store.
  useEffect(() => {
    if (!isLoggedIn || !currentUser.id) return;
    const boundUserId = currentUser.id;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const off = await addEntitlementListener((ent) => {
        // Late delivery after a logout / account switch must not leak across.
        if (handlersRef.current.userId !== boundUserId) return;
        handlersRef.current.setEntitlement({
          resolved: true,
          entitled: ent.entitled,
          tier: ent.tier,
          source: "revenuecat",
        });
        // Refresh the cached copy of this user so the gold ring follows.
        handlersRef.current.refreshUsers([boundUserId]);
      });
      // The subscription resolved after this effect was already cleaned up.
      if (cancelled) off();
      else unsubscribe = off;
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [isLoggedIn, currentUser.id]);

  return null;
}

function MutedSquadsConnector({ children }: { children: React.ReactNode }) {
  const { authToken } = useAuth();
  return <MutedSquadsProvider authToken={authToken}>{children}</MutedSquadsProvider>;
}

function RootLayoutNav() {
  const { isAuthRestoring, isSessionValidated, isLoggedIn } = useAuth();

  // Safety valve: never hold the boot screen longer than this even if the
  // session-validation request is stuck on a pathologically slow network.
  // (fetchApiUser's offline catch normally settles far sooner than this.)
  const [validationTimedOut, setValidationTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setValidationTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, []);

  // Minimum splash display time — keeps the splash visible for at least 1 s
  // even when auth resolves instantly (e.g. no stored token on first launch),
  // so the transition into the app feels intentional rather than a flash.
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinTimeElapsed(true), 1000);
    return () => clearTimeout(t);
  }, []);

  // True while we cannot yet make a routing decision:
  //   (1) AsyncStorage token restore still running, OR
  //   (2) a restored token hasn't been confirmed by the server yet, OR
  //   (3) the minimum splash display time hasn't elapsed yet.
  // Without (2), a dead token mounts the home screen "logged in" then kicks
  // the user to login — the broken cold-start seen on TestFlight.
  const waitingForValidation =
    !minTimeElapsed ||
    isAuthRestoring ||
    (isLoggedIn && !isSessionValidated && !validationTimedOut);

  // While waiting, keep the native splash visible by returning null (we
  // haven't called hideAsync yet). On web there is no native splash, so show
  // the dark background instead so the screen isn't blank. The moment the
  // gate lifts, dismiss the splash and let the real UI render.
  useEffect(() => {
    if (!waitingForValidation) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [waitingForValidation]);

  if (waitingForValidation) {
    // null → native splash stays visible; dark view → web fallback.
    return Platform.OS === "web"
      ? <View style={{ flex: 1, backgroundColor: "#0D0D0D" }} />
      : null;
  }

  return (
    <>
      <AuthGuard />
      <ClipboardInviteRecovery />
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
        <Stack.Screen name="settings/blocked" />
        <Stack.Screen name="add/friend/[code]" />
        <Stack.Screen name="user/[id]" />
      </Stack>
      <TipCoachMark />
      <KeyboardDismissControl />
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

  // Do NOT call SplashScreen.hideAsync() here — that is now done by
  // RootLayoutNav once auth validation has also settled, so the native splash
  // covers the full boot period (font load + token check) with no flash.

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <ToastProvider>
              <AppProvider>
                <TimezoneProvider>
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
                </TimezoneProvider>
              </AppProvider>
              </ToastProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
