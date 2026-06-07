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
import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppProvider, useAuth } from "@/context/AppContext";
import { MessagesProvider } from "@/context/MessagesContext";
import { UserCacheProvider } from "@/context/UserCacheContext";
import { installWebAlert } from "@/lib/webAlert";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

installWebAlert();

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const AUTH_SCREENS = ["login", "signup", "onboarding", "invite", "add"];

function AuthGuard() {
  const { isLoggedIn } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    const isOnAuthScreen = AUTH_SCREENS.includes(segments[0] as string);

    if (!isLoggedIn && !isOnAuthScreen) {
      router.replace("/login" as never);
    } else if (isLoggedIn && (segments[0] === "login" || segments[0] === "signup")) {
      router.replace("/(tabs)" as never);
    }
  }, [isLoggedIn, segments]);

  return null;
}

/**
 * Registers the device's Expo push token with the server once the user is
 * logged in. Also sets up a listener so tapping a push notification
 * deep-links into the correct availability screen (squad or event).
 * Native-only — the whole component is a no-op on web.
 */
function PushNotificationManager() {
  const { isLoggedIn, authToken } = useAuth();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!isLoggedIn || !authToken) {
      registeredRef.current = false;
      return;
    }
    if (registeredRef.current) return;

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

        let granted = false;
        const existing = await Notifications.getPermissionsAsync();
        granted = existing.granted || existing.status === "granted";
        if (!granted) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.granted || req.status === "granted";
        }
        if (!granted || cancelled) return;

        const tokenData = await Notifications.getExpoPushTokenAsync();
        const token = tokenData.data;
        if (cancelled) return;

        await fetch(`${API_BASE}/api/push-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildAuthHeaders(authToken),
          },
          body: JSON.stringify({ token }),
        });
        registeredRef.current = true;
      } catch {
        // Never crash the app because of push token registration failure
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, authToken]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    let sub: { remove(): void } | null = null;

    void (async () => {
      try {
        const Notifications = await import("expo-notifications");
        sub = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response.notification.request.content.data as Record<string, string> | undefined;
          if (!data || data.screen !== "availability") return;

          if (data.squadId) {
            router.push({ pathname: "/availability", params: { squadId: data.squadId } } as never);
          } else if (data.eventId) {
            router.push({ pathname: "/availability", params: { eventId: data.eventId } } as never);
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

  return null;
}

function RootLayoutNav() {
  return (
    <>
      <AuthGuard />
      <PushNotificationManager />
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="invite" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="event/[id]" />
        <Stack.Screen name="squad/[id]" />
        <Stack.Screen name="squad/join" />
        <Stack.Screen name="squad/create" />
        <Stack.Screen name="conversation/[id]" />
        <Stack.Screen name="friends" />
        <Stack.Screen name="vault" />
        <Stack.Screen name="availability" />
        <Stack.Screen name="settings/edit-profile" />
        <Stack.Screen name="settings/notifications" />
        <Stack.Screen name="settings/privacy" />
        <Stack.Screen name="add/friend/[code]" />
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
              <AppProvider>
                <UserCacheProvider>
                  <MessagesProvider>
                    <RootLayoutNav />
                  </MessagesProvider>
                </UserCacheProvider>
              </AppProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
