import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Platform,
  Alert,
  Linking,
  ActivityIndicator,
  Animated,
  Share,
  AppState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData } from "@/context/AppContext";
import { UserAvatar } from "@/components/UserAvatar";
import { startProCheckout } from "@/lib/checkout";
import { router, useLocalSearchParams } from "expo-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type SettingItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  color?: string;
  toggle?: boolean;
  onToggle?: (value: boolean) => void;
  highlight?: boolean;
  onPress?: () => void;
};

type CalendarModule = typeof import("expo-calendar");
let _calendarModulePromise: Promise<CalendarModule | null> | null = null;
async function loadCalendar(): Promise<CalendarModule | null> {
  if (Platform.OS === "web") return null;
  if (!_calendarModulePromise) {
    _calendarModulePromise = import("expo-calendar").catch(() => null);
  }
  return _calendarModulePromise;
}

async function getOrCreateSquadzCalendar(): Promise<string | null> {
  try {
    const Calendar = await loadCalendar();
    if (!Calendar) return null;
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const existing = calendars.find(c => c.title === "Squadz");
    if (existing) return existing.id;

    const defaultCalendar = await Calendar.getDefaultCalendarAsync();
    const newId = await Calendar.createCalendarAsync({
      title: "Squadz",
      color: "#FF5C3A",
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: defaultCalendar.source?.id,
      source: defaultCalendar.source,
      name: "Squadz",
      ownerAccount: defaultCalendar.ownerAccount ?? "personal",
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
    return newId;
  } catch {
    return null;
  }
}

async function writeEventsToCalendar(
  events: Array<{ id: string; title: string; date: string; location: string; description: string; emoji: string }>,
  calendarId: string,
): Promise<void> {
  const Calendar = await loadCalendar();
  if (!Calendar) return;
  for (const event of events) {
    try {
      const startDate = new Date(event.date);
      if (isNaN(startDate.getTime())) continue;
      const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

      const existingEvents = await Calendar.getEventsAsync(
        [calendarId],
        new Date(startDate.getTime() - 60 * 1000),
        new Date(endDate.getTime() + 60 * 1000),
      );
      const alreadyAdded = existingEvents.some(e => e.notes?.includes(`squadz:${event.id}`));
      if (alreadyAdded) continue;

      await Calendar.createEventAsync(calendarId, {
        title: `${event.emoji} ${event.title}`,
        startDate,
        endDate,
        location: event.location !== "TBD" ? event.location : undefined,
        notes: `${event.description}\nsquadz:${event.id}`,
        timeZone: "UTC",
      });
    } catch {
      // Skip events that fail — don't block others
    }
  }
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, logout, authToken } = useAuth();
  const { events, squads, friendCode } = useData();
  const params = useLocalSearchParams<{ checkout?: string }>();

  const didCheckoutSuccess = params.checkout === "success";
  const bannerOpacity = useRef(new Animated.Value(0)).current;

  const [isPro, setIsPro] = useState(didCheckoutSuccess);
  const [checkingPro, setCheckingPro] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [showSuccessBanner, setShowSuccessBanner] = useState(didCheckoutSuccess);
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [eventLimit] = useState(3);
  const [calSync, setCalSync] = useState(false);
  const [calSyncLoading, setCalSyncLoading] = useState(false);
  const [highlightCalSync, setHighlightCalSync] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [devPushToken, setDevPushToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [sendingTestPush, setSendingTestPush] = useState(false);
  const [devPushPermission, setDevPushPermission] = useState<"granted" | "denied" | "undetermined" | null>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 100);

  const myEvents = events.filter(
    (e) => e.hostId === currentUser.id || e.rsvps[currentUser.id] === "going" || e.rsvps[currentUser.id] === "maybe",
  );
  const mySquads = squads;

  const authHeaders = useCallback((): HeadersInit => {
    return buildAuthHeaders(authToken);
  }, [authToken]);

  const checkSubscription = useCallback(async () => {
    setCheckingPro(true);
    try {
      const res = await fetch(`${API_BASE}/api/subscription`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const { isPro: pro } = await res.json() as { isPro: boolean };
        setIsPro(!!pro);
      }
    } catch {
      // Network unavailable or server down — silently leave isPro false
    } finally {
      setCheckingPro(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void checkSubscription();
  }, [checkSubscription]);

  useEffect(() => {
    async function fetchEventCount() {
      try {
        const res = await fetch(`${API_BASE}/api/events/count`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = await res.json() as { count: number; limit: number };
          setEventCount(data.count);
        }
      } catch {
        // silently ignore — event count is best-effort
      }
    }
    void fetchEventCount();
  }, [authHeaders]);

  // Fetch push token in development builds so testers can copy it
  useEffect(() => {
    if (!__DEV__ || Platform.OS === "web") return;
    let cancelled = false;
    (async () => {
      try {
        const Notifications = await import("expo-notifications");
        const perm = await Notifications.getPermissionsAsync();
        const granted = perm.granted || perm.status === "granted";
        const status = granted ? "granted" : perm.status === "denied" ? "denied" : "undetermined";
        if (!cancelled) setDevPushPermission(status);
        if (!granted || cancelled) return;
        const tokenData = await Notifications.getExpoPushTokenAsync();
        if (!cancelled) setDevPushToken(tokenData.data);
      } catch {
        // Push token unavailable (simulator without credentials, etc.) — silently skip
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Re-check push permission when the app returns to foreground (e.g. after tapping "Open Settings")
  useEffect(() => {
    if (!__DEV__ || Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      (async () => {
        try {
          const Notifications = await import("expo-notifications");
          const perm = await Notifications.getPermissionsAsync();
          const granted = perm.granted || perm.status === "granted";
          const status = granted ? "granted" : perm.status === "denied" ? "denied" : "undetermined";
          setDevPushPermission(status);
          if (!granted) return;
          if (!devPushToken) {
            const tokenData = await Notifications.getExpoPushTokenAsync();
            setDevPushToken(tokenData.data);
          }
        } catch {
          // Notifications API unavailable
        }
      })();
    });
    return () => sub.remove();
  }, [devPushToken]);

  async function handleGrantPushPermission() {
    try {
      const Notifications = await import("expo-notifications");
      const result = await Notifications.requestPermissionsAsync();
      const granted = result.granted || result.status === "granted";
      if (granted) {
        setDevPushPermission("granted");
        try {
          const tokenData = await Notifications.getExpoPushTokenAsync();
          setDevPushToken(tokenData.data);
        } catch {
          // Token fetch failed after grant (simulator without credentials, etc.)
        }
      } else {
        setDevPushPermission("denied");
      }
    } catch {
      // Notifications API unavailable
    }
  }

  // Load persisted calendar sync preference
  useEffect(() => {
    async function loadPreferences() {
      try {
        const res = await fetch(`${API_BASE}/api/user/preferences`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = await res.json() as { calendarSyncEnabled?: boolean };
          if (typeof data.calendarSyncEnabled === "boolean") {
            setCalSync(data.calendarSyncEnabled);
          }
        }
      } catch {
        // silently ignore
      }
    }
    void loadPreferences();
  }, [authHeaders]);

  useEffect(() => {
    if (!showSuccessBanner) return;
    Animated.timing(bannerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    // Clear the query param from the URL (web only) without re-rendering
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname);
    }
    const t = setTimeout(() => {
      Animated.timing(bannerOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setShowSuccessBanner(false));
    }, 5000);
    return () => clearTimeout(t);
  }, [showSuccessBanner, bannerOpacity]);

  async function handleCalSyncToggle(next: boolean) {
    setCalSyncLoading(true);
    try {
      if (next) {
        // Request calendar permission (native only)
        const Calendar = await loadCalendar();
        if (!Calendar) {
          Alert.alert("Not Available", "Calendar Sync is only available in the mobile app.");
          return;
        }
        const { status } = await Calendar.requestCalendarPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Calendar Permission Required",
            "Please allow Squadz to access your calendar in Settings to enable Calendar Sync.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => Linking.openSettings() },
            ],
          );
          return;
        }
      }

      // Persist preference via API
      const res = await fetch(`${API_BASE}/api/user/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ calendarSyncEnabled: next }),
      });

      if (!res.ok) {
        Alert.alert("Error", "Failed to update calendar sync preference.");
        return;
      }

      setCalSync(next);

      if (next) {
        // Write existing accepted events to device calendar
        try {
          const calendarId = await getOrCreateSquadzCalendar();
          if (calendarId) {
            const eventsToSync = myEvents.map(e => ({
              id: e.id,
              title: e.title,
              date: e.date,
              location: e.location ?? "TBD",
              description: e.description ?? "",
              emoji: e.emoji ?? "🎉",
            }));
            await writeEventsToCalendar(eventsToSync, calendarId);
            Alert.alert(
              "Calendar Sync On",
              "Your Squadz events have been added to your calendar. Future accepted events will sync automatically.",
            );
          }
        } catch {
          Alert.alert(
            "Calendar Sync On",
            "Your preference was saved, but some events couldn't be added to your calendar.",
          );
        }
      } else {
        Alert.alert("Calendar Sync Off", "Future events won't be added to your calendar.");
      }
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setCalSyncLoading(false);
    }
  }

  function buildInviteUrl(code: string): string {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return `${window.location.origin}/api/add/friend/${code}`;
    }
    return `${API_BASE}/api/add/friend/${code}`;
  }

  async function handleShareFriendCode() {
    if (!friendCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const inviteUrl = buildInviteUrl(friendCode);
    if (Platform.OS === "web") {
      try {
        await navigator.clipboard.writeText(`${friendCode} — ${inviteUrl}`);
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
      } catch {
        Alert.alert("Your Friend Code", `${friendCode}\n\n${inviteUrl}`);
      }
    } else {
      try {
        await Share.share({
          message: `Add me on Squadz! 👥\n\nTap the link to add me instantly:\n${inviteUrl}\n\nOr use code: ${friendCode}`,
          url: inviteUrl,
          title: "Add me on Squadz",
        });
      } catch {
        // User dismissed share sheet — no action needed
      }
    }
  }

  async function handleSendTestNotification() {
    if (!devPushToken || sendingTestPush) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSendingTestPush(true);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          to: devPushToken,
          title: "Squadz test notification",
          body: "Push pipeline check — notification delivered successfully!",
          data: { smokeTest: true, sentAt: new Date().toISOString() },
          sound: "default",
        }),
      });
      const json = await res.json() as { data?: { status?: string; message?: string } };
      const ticket = json.data;
      if (ticket?.status === "ok") {
        Alert.alert("Delivered ✓", "Test notification sent successfully. Check your notification tray.");
      } else {
        Alert.alert("Send Failed", ticket?.message ?? "Expo returned an unexpected response.");
      }
    } catch {
      Alert.alert("Network Error", "Could not reach the Expo Push API. Check your connection and try again.");
    } finally {
      setSendingTestPush(false);
    }
  }

  async function handleCopyPushToken() {
    if (!devPushToken) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(devPushToken);
      } else {
        const Clipboard = await import("expo-clipboard");
        await Clipboard.setStringAsync(devPushToken);
      }
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      Alert.alert("Expo Push Token", devPushToken);
    }
  }

  async function handleUpgrade() {
    setUpgradeLoading(true);
    const result = await startProCheckout(authToken);
    if (!result.ok) {
      Alert.alert("Checkout Error", result.error);
    }
    setUpgradeLoading(false);
  }

  async function handlePortal() {
    try {
      const res = await fetch(`${API_BASE}/api/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const { url, error: apiError } = await res.json() as { url?: string; error?: string };
      if (apiError || !url) {
        Alert.alert("Error", apiError ?? "Failed to open portal.");
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    }
  }

  const proSection: SettingItem[] = isPro
    ? [
        {
          icon: "checkmark-circle",
          label: "Squadz Pro — Active",
          color: colors.gold,
          onPress: () => Alert.alert("Squadz Pro", "You're on Pro! Manage your subscription below."),
        },
        {
          icon: "gift-outline",
          label: "What's included in Pro",
          onPress: () =>
            Alert.alert(
              "What's included in Pro",
              "🗓️  Unlimited Events — Create as many events as you like\n\n📷  Photo Vault — Store & share squad photos\n\n📅  Calendar Sync — Add squad events to Apple / Google Calendar",
              [
                { text: "View Events", onPress: () => router.push("/(tabs)/events" as never) },
                { text: "View Photo Vault", onPress: () => router.push("/vault" as never) },
                { text: "Calendar Sync", onPress: () => { setHighlightCalSync(true); setTimeout(() => setHighlightCalSync(false), 3000); } },
                { text: "Done", style: "cancel" },
              ]
            ),
        },
        {
          icon: "settings-outline",
          label: "Manage Subscription",
          onPress: handlePortal,
        },
      ]
    : [
        {
          icon: "flash",
          label: upgradeLoading ? "Opening checkout…" : "Upgrade to Pro",
          value: "$20/yr",
          color: colors.gold,
          onPress: upgradeLoading ? undefined : () => { void handleUpgrade(); },
        },
      ];

  const { friends } = useData();

  const SETTINGS: SettingItem[][] = [
    [
      { icon: "person-outline", label: "Edit Profile", onPress: () => router.push("/settings/edit-profile" as never) },
      { icon: "people-outline", label: "Friends", value: String(friends.length), onPress: () => router.push("/friends" as never) },
      { icon: "notifications-outline", label: "Notifications", onPress: () => router.push("/settings/notifications" as never) },
      {
        icon: "calendar-outline",
        label: "Calendar Sync",
        toggle: calSync,
        onToggle: (v) => { void handleCalSyncToggle(v); },
        highlight: highlightCalSync,
      },
      { icon: "lock-closed-outline", label: "Privacy", onPress: () => router.push("/settings/privacy" as never) },
    ],
    proSection,
    [
      { icon: "help-circle-outline", label: "Help & Support", onPress: () => Alert.alert("Help & Support", "Need a hand? Reach us at support@getsquadz.com") },
      { icon: "star-outline", label: "Rate Squadz", onPress: () => Alert.alert("Rate Squadz", "Thanks for the love! ⭐️ Ratings open in the App Store.") },
    ],
    [
      {
        icon: "log-out-outline", label: "Sign Out", color: colors.destructive,
        onPress: () => Alert.alert("Sign Out", "Are you sure?", [
          { text: "Cancel", style: "cancel" },
          { text: "Sign Out", style: "destructive", onPress: () => { logout(); router.replace("/login" as never); } },
        ]),
      },
    ],
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
      >
        {showSuccessBanner && (
          <Animated.View style={[styles.successBanner, { backgroundColor: colors.green + "18", borderColor: colors.green + "50", opacity: bannerOpacity, marginTop: topPad + 12 }]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                <Text style={styles.successEmoji}>🎉</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.successTitle, { color: colors.green }]}>Welcome to Squadz Pro!</Text>
                  <Text style={[styles.successBody, { color: colors.mutedForeground }]}>
                    Your upgrade is confirmed. Tap a feature to explore what's unlocked.
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setShowSuccessBanner(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {([
                  { key: "events", icon: "🗓️", label: "Unlimited Events", route: "/(tabs)/events" },
                  { key: "vault", icon: "📷", label: "Photo Vault", route: "/vault" },
                  { key: "calendar", icon: "📅", label: "Calendar Sync", route: "/(tabs)/profile" },
                ] as const).map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowSuccessBanner(false);
                      if (f.key === "calendar") {
                        setHighlightCalSync(true);
                        setTimeout(() => setHighlightCalSync(false), 3000);
                      } else {
                        router.push(f.route as never);
                      }
                    }}
                    style={[styles.featureChip, { backgroundColor: colors.green + "18", borderColor: colors.green + "40" }]}
                  >
                    <Text style={styles.featureChipIcon}>{f.icon}</Text>
                    <Text style={[styles.featureChipLabel, { color: colors.green }]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Animated.View>
        )}
        <View style={[styles.profileCard, { paddingTop: showSuccessBanner ? 16 : topPad + 20, borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/settings/edit-profile" as never); }}
            activeOpacity={0.8}
            accessibilityLabel="Edit profile photo"
            accessibilityRole="button"
          >
            <UserAvatar initials={currentUser.initials} color={currentUser.color} imageUrl={currentUser.profileImageUrl} size={80} fontSize={28} />
            <View style={[styles.avatarEditBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
              <Ionicons name="camera" size={13} color="#fff" />
            </View>
          </TouchableOpacity>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]}>{currentUser.name}</Text>
            {checkingPro ? (
              <ActivityIndicator size="small" color={colors.gold} style={{ marginLeft: 8 }} />
            ) : isPro ? (
              <View style={[styles.proBadge, { backgroundColor: colors.gold + "22", borderColor: colors.gold + "60" }]}>
                <Text style={[styles.proBadgeText, { color: colors.gold }]}>PRO</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.statsRow}>
            {[
              { value: eventCount !== null ? String(eventCount) : "—", label: "Events" },
              { value: mySquads.length.toString(), label: "Squads" },
              { value: "Mar '24", label: "Joined" },
            ].map((s, i) => (
              <View key={i} style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
          {friendCode ? (
            <TouchableOpacity
              onPress={() => { void handleShareFriendCode(); }}
              activeOpacity={0.7}
              style={[styles.friendCodeRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.friendCodeLabel, { color: colors.mutedForeground }]}>Your friend code</Text>
                <Text style={[styles.friendCodeValue, { color: colors.foreground }]}>{friendCode}</Text>
              </View>
              <View style={[styles.friendCodeAction, { backgroundColor: codeCopied ? colors.green + "20" : colors.primary + "18", borderColor: codeCopied ? colors.green + "50" : colors.primary + "40" }]}>
                <Ionicons
                  name={codeCopied ? "checkmark" : (Platform.OS === "web" ? "copy-outline" : "share-outline")}
                  size={16}
                  color={codeCopied ? colors.green : colors.primary}
                />
                <Text style={[styles.friendCodeActionText, { color: codeCopied ? colors.green : colors.primary }]}>
                  {codeCopied ? "Copied!" : (Platform.OS === "web" ? "Copy" : "Share")}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}
          {eventCount !== null && !isPro && (
            <View style={[styles.eventUsageBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.eventUsageRow}>
                <Text style={[styles.eventUsageLabel, { color: colors.mutedForeground }]}>
                  {eventCount} / {eventLimit} free events used this year
                </Text>
                <Text style={[styles.eventUsageRemaining, { color: eventCount >= eventLimit ? colors.destructive : colors.mutedForeground }]}>
                  {eventCount >= eventLimit ? "Limit reached" : `${eventLimit - eventCount} left`}
                </Text>
              </View>
              <View style={[styles.eventUsageTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.eventUsageFill,
                    {
                      backgroundColor: eventCount >= eventLimit ? colors.destructive : colors.primary,
                      width: `${Math.min(100, (eventCount / eventLimit) * 100)}%` as `${number}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My Events</Text>
          <View style={styles.eventsGrid}>
            {myEvents.slice(0, 4).map((e) => (
              <TouchableOpacity
                key={e.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/event/${e.id}` as never); }}
                style={[styles.eventMini, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={styles.eventEmoji}>{e.emoji}</Text>
                <Text style={[styles.eventTitle, { color: colors.foreground }]} numberOfLines={1}>{e.title}</Text>
                <Text style={[styles.eventDate, { color: colors.mutedForeground }]} numberOfLines={1}>{e.date}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.squadsHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>My Squads</Text>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/create"); }}
              style={styles.newSquadLink}
            >
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={[styles.newSquadLinkText, { color: colors.primary }]}>New</Text>
            </TouchableOpacity>
          </View>
          {mySquads.length === 0 ? (
            <Text style={[styles.eventDate, { color: colors.mutedForeground }]}>You haven't joined any squads yet.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {mySquads.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/squad/${s.id}` as never); }}
                  style={[styles.squadRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.squadRowIcon, { backgroundColor: s.color + "20" }]}>
                    <Text style={{ fontSize: 20 }}>{s.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.squadRowName, { color: colors.foreground }]}>{s.name}</Text>
                    <Text style={[styles.eventDate, { color: colors.mutedForeground }]}>{s.memberIds.length} members</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {SETTINGS.map((group, gi) => (
          <View key={gi} style={styles.settingsGroup}>
            {group.map((item, ii) => (
              <TouchableOpacity
                key={ii}
                onPress={() => {
                  if (item.toggle !== undefined) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  item.onPress?.();
                }}
                activeOpacity={item.toggle !== undefined ? 1 : 0.7}
                style={[
                  styles.settingRow,
                  { backgroundColor: item.highlight ? colors.primary + "18" : colors.card, borderColor: item.highlight ? colors.primary + "60" : colors.border },
                  ii === 0 && styles.settingFirst,
                  ii === group.length - 1 && styles.settingLast,
                  ii > 0 && { borderTopWidth: 0 },
                ]}
              >
                <Ionicons name={item.icon} size={20} color={item.highlight ? colors.primary : (item.color ?? colors.foreground)} />
                <Text style={[styles.settingLabel, { color: item.highlight ? colors.primary : (item.color ?? colors.foreground), flex: 1 }]}>{item.label}</Text>
                {item.value && (
                  <Text style={[styles.settingValue, { color: colors.gold }]}>{item.value}</Text>
                )}
                {item.toggle !== undefined ? (
                  calSyncLoading && item.label === "Calendar Sync" ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Switch
                      value={item.toggle}
                      onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); item.onToggle?.(v); }}
                      trackColor={{ false: colors.border, true: colors.primary + "80" }}
                      thumbColor={item.toggle ? colors.primary : colors.mutedForeground}
                    />
                  )
                ) : !item.color ? (
                  <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ))}

        {__DEV__ && Platform.OS !== "web" && devPushPermission !== null ? (
          <View style={styles.settingsGroup}>
            <Text style={[styles.devSectionTitle, { color: colors.mutedForeground }]}>Developer / Staging</Text>
            {devPushToken ? (
              <>
                <TouchableOpacity
                  onPress={() => { void handleCopyPushToken(); }}
                  activeOpacity={0.7}
                  style={[styles.settingRow, styles.settingFirst, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Ionicons name="phone-portrait-outline" size={20} color={colors.mutedForeground} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.devTokenLabel, { color: colors.mutedForeground }]}>Expo Push Token</Text>
                    <Text style={[styles.devTokenValue, { color: colors.foreground }]} numberOfLines={1} ellipsizeMode="middle">
                      {devPushToken}
                    </Text>
                  </View>
                  <View style={[styles.friendCodeAction, { backgroundColor: tokenCopied ? colors.green + "20" : colors.primary + "12", borderColor: tokenCopied ? colors.green + "50" : colors.primary + "30" }]}>
                    <Ionicons
                      name={tokenCopied ? "checkmark" : "copy-outline"}
                      size={15}
                      color={tokenCopied ? colors.green : colors.primary}
                    />
                    <Text style={[styles.friendCodeActionText, { color: tokenCopied ? colors.green : colors.primary }]}>
                      {tokenCopied ? "Copied!" : "Copy"}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { void handleSendTestNotification(); }}
                  activeOpacity={sendingTestPush ? 1 : 0.7}
                  style={[styles.settingRow, styles.settingLast, { backgroundColor: colors.card, borderColor: colors.border, borderTopWidth: 0 }]}
                >
                  {sendingTestPush ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="notifications-outline" size={20} color={colors.primary} />
                  )}
                  <Text style={[styles.settingLabel, { color: sendingTestPush ? colors.mutedForeground : colors.primary, flex: 1 }]}>
                    {sendingTestPush ? "Sending…" : "Send test notification"}
                  </Text>
                  {!sendingTestPush && <Ionicons name="chevron-forward" size={16} color={colors.textDim} />}
                </TouchableOpacity>
              </>
            ) : devPushPermission === "undetermined" ? (
              <TouchableOpacity
                onPress={() => { void handleGrantPushPermission(); }}
                activeOpacity={0.7}
                style={[styles.settingRow, styles.settingFirst, styles.settingLast, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="notifications-outline" size={20} color={colors.primary} />
                <Text style={[styles.settingLabel, { color: colors.primary, flex: 1 }]}>Grant permission to see token</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            ) : devPushPermission === "granted" ? (
              <View style={[styles.settingRow, styles.settingFirst, styles.settingLast, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="phone-portrait-outline" size={20} color={colors.mutedForeground} />
                <Text style={[styles.settingLabel, { color: colors.mutedForeground, flex: 1 }]}>Token unavailable (simulator or missing credentials)</Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => { void Linking.openSettings(); }}
                activeOpacity={0.7}
                style={[styles.settingRow, styles.settingFirst, styles.settingLast, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="notifications-off-outline" size={20} color={colors.mutedForeground} />
                <Text style={[styles.settingLabel, { color: colors.mutedForeground, flex: 1 }]}>Push token unavailable — notifications denied</Text>
                <View style={[styles.friendCodeAction, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                  <Ionicons name="settings-outline" size={15} color={colors.primary} />
                  <Text style={[styles.friendCodeActionText, { color: colors.primary }]}>Open Settings</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  profileCard: { alignItems: "center", paddingHorizontal: 24, paddingBottom: 24, borderBottomWidth: 1 },
  avatarEditBadge: { position: "absolute", bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", marginTop: 12, marginBottom: 16 },
  name: { fontSize: 22, fontWeight: "800" },
  proBadge: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  proBadgeText: { fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  statsRow: { flexDirection: "row", gap: 32 },
  stat: { alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 12 },
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  eventsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  eventMini: { width: "48%", borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  eventEmoji: { fontSize: 22 },
  eventTitle: { fontSize: 14, fontWeight: "700" },
  eventDate: { fontSize: 12 },
  squadsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  newSquadLink: { flexDirection: "row", alignItems: "center", gap: 2 },
  newSquadLinkText: { fontSize: 14, fontWeight: "700" },
  squadRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  squadRowIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  squadRowName: { fontSize: 15, fontWeight: "700" },
  settingsGroup: { paddingHorizontal: 20, paddingTop: 20 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderWidth: 1 },
  settingFirst: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  settingLast: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  settingLabel: { fontSize: 15 },
  settingValue: { fontSize: 13, fontWeight: "700" },
  successBanner: { marginHorizontal: 20, marginBottom: 4, padding: 14, borderRadius: 14, borderWidth: 1 },
  successEmoji: { fontSize: 26, lineHeight: 32 },
  successTitle: { fontSize: 15, fontWeight: "800", marginBottom: 3 },
  successBody: { fontSize: 13, lineHeight: 18 },
  featureChip: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 5 },
  featureChipIcon: { fontSize: 13 },
  featureChipLabel: { fontSize: 12, fontWeight: "700" },
  friendCodeRow: { flexDirection: "row", alignItems: "center", marginTop: 16, borderRadius: 14, borderWidth: 1, padding: 12, width: "100%" },
  friendCodeLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 2 },
  friendCodeValue: { fontSize: 20, fontWeight: "800", letterSpacing: 1 },
  friendCodeAction: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  friendCodeActionText: { fontSize: 13, fontWeight: "700" },
  eventUsageBar: { marginTop: 14, borderRadius: 12, borderWidth: 1, padding: 10, width: "100%" },
  eventUsageRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  eventUsageLabel: { fontSize: 12 },
  eventUsageRemaining: { fontSize: 11, fontWeight: "700" },
  eventUsageTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  eventUsageFill: { height: "100%", borderRadius: 3 },
  devSectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 },
  devTokenLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  devTokenValue: { fontSize: 12, fontFamily: "monospace", letterSpacing: 0.3 },
});
