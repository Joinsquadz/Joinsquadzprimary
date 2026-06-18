import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Badge, Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useMessages } from "@/context/MessagesContext";
import { useData } from "@/context/AppContext";
import { TAB_BAR_HEIGHT } from "@/constants/layout";

function NativeTabLayout() {
  const { unreadCount } = useMessages();
  const { outstandingBalancesCount } = useData();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
        {outstandingBalancesCount > 0 ? <Badge>{outstandingBalancesCount > 99 ? "99+" : String(outstandingBalancesCount)}</Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="squads">
        <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <Label>SquadZ</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="events">
        <Icon sf={{ default: "calendar", selected: "calendar" }} />
        <Label>Events</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <Icon sf={{ default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }} />
        <Label>Messages</Label>
        {unreadCount > 0 ? <Badge>{unreadCount > 99 ? "99+" : String(unreadCount)}</Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="feed">
        <Icon sf={{ default: "sparkles", selected: "sparkles" }} />
        <Label>Vibe</Label>
      </NativeTabs.Trigger>
      {/* Hidden destinations: navigable via router.navigate but not shown in the tab bar.
          Activity ("notifications") and Profile ("You") are root Stack routes
          (app/activity.tsx, app/profile.tsx), reached from the Home header bell + avatar. */}
      <NativeTabs.Trigger name="photos" hidden />
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const { unreadCount } = useMessages();
  const { outstandingBalancesCount } = useData();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: TAB_BAR_HEIGHT } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarBadge: outstandingBalancesCount > 0 ? (outstandingBalancesCount > 99 ? "99+" : outstandingBalancesCount) : undefined,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={24} />
            ) : (
              <Ionicons name="home-outline" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="squads"
        options={{
          title: "SquadZ",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={24} />
            ) : (
              <Ionicons name="people-outline" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="calendar" tintColor={color} size={24} />
            ) : (
              <Ionicons name="calendar-outline" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : undefined,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="bubble.left.and.bubble.right" tintColor={color} size={24} />
            ) : (
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: "Vibe",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="sparkles" tintColor={color} size={24} />
            ) : (
              <Ionicons name="sparkles-outline" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen name="photos" options={{ tabBarButton: () => null }} />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
