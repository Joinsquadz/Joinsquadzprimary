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
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData } from "@/context/AppContext";
import { UserAvatar } from "@/components/UserAvatar";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { UpgradeModal } from "@/components/UpgradeModal";
import type { UpgradeTrigger } from "@/components/UpgradeModal";
import { router, useLocalSearchParams } from "expo-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { profileVaultUpgradeTrigger } from "@/lib/profileVault";
import { upgradeCtaLabel, useSquadzPlusPriceLabel } from "@/lib/squadzPlusPrice";
// Shared auth-race guard (see lib/vaultAuthRace.ts). The profile's own on-mount
// fetch (event count) can 401 during a slow login; keep the events stat loading
// + retrying rather than briefly showing a misleading value before it restores.
import {
  INITIAL_AUTH_RACE_STATE,
  applyVaultFetchOutcome,
  nextRetryDecision,
  vaultRenderMode,
  type AuthRaceState,
} from "@/lib/vaultAuthRace";

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

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, logout, authToken, isAuthRestoring, isPro } = useAuth();
  const { events, squads, friendCode, updateOwnPaymentHandles } = useData();
  const params = useLocalSearchParams<{ checkout?: string }>();

  const didCheckoutSuccess = params.checkout === "success";
  const bannerOpacity = useRef(new Animated.Value(0)).current;

  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
  const [upgradeTrigger, setUpgradeTrigger] = useState<UpgradeTrigger>("general");
  const upgradePriceLabel = useSquadzPlusPriceLabel();
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [showSuccessBanner, setShowSuccessBanner] = useState(didCheckoutSuccess);
  const [eventCount, setEventCount] = useState<number | null>(null);
  // Server is the source of truth for both caps (GET /api/events/count and
  // GET /api/squads/count) — these initial values are only placeholders shown
  // before the first response lands, never a hardcoded product rule.
  const [eventLimit, setEventLimit] = useState(3);
  const [squadUsage, setSquadUsage] = useState<{ count: number; limit: number } | null>(null);
  // Auth-race guard for the on-mount event-count fetch (see lib/vaultAuthRace.ts).
  const [countLoading, setCountLoading] = useState(true);
  const [countAuth, setCountAuth] = useState<AuthRaceState>(INITIAL_AUTH_RACE_STATE);
  const [streaks, setStreaks] = useState<{ monthlyPlan: number; stayInTouch: number } | null>(null);
  const [paymentHandles, setPaymentHandles] = useState<{ venmoHandle: string | null; cashappHandle: string | null; zelleHandle: string | null }>({
    venmoHandle: null,
    cashappHandle: null,
    zelleHandle: null,
  });
  const [editingHandle, setEditingHandle] = useState<"venmo" | "cashapp" | "zelle" | null>(null);
  const [draftHandle, setDraftHandle] = useState("");
  const [savingHandle, setSavingHandle] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [squadLinkCopied, setSquadLinkCopied] = useState(false);
  const [devPushToken, setDevPushToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [sendingTestPush, setSendingTestPush] = useState(false);
  const [devPushPermission, setDevPushPermission] = useState<"granted" | "denied" | "undetermined" | null>(null);
  const [notifPermission, setNotifPermission] = useState<"granted" | "denied" | "undetermined" | null>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + 24;
  const openUpgrade = useCallback((trigger: UpgradeTrigger) => {
    setUpgradeTrigger(trigger);
    setUpgradeModalVisible(true);
  }, []);

  const myEvents = events.filter(
    (e) => e.hostId === currentUser.id || e.rsvps[currentUser.id] === "going" || e.rsvps[currentUser.id] === "maybe",
  );
  const mySquads = squads;

  const authHeaders = useCallback((): HeadersInit => {
    return buildAuthHeaders(authToken);
  }, [authToken]);

  const fetchEventCount = useCallback(async () => {
    if (!authToken) {
      // No token yet: during a slow-login race stay pending (loading) so the
      // events stat doesn't flash a misleading value; if genuinely logged out,
      // just stop loading.
      if (isAuthRestoring) {
        setCountAuth(prev => applyVaultFetchOutcome(prev, { kind: "unauthorized" }));
      } else {
        setCountLoading(false);
      }
      return;
    }
    setCountLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/events/count`, {
        headers: authHeaders(),
      });
      if (res.status === 401) {
        setCountAuth(prev => applyVaultFetchOutcome(prev, { kind: "unauthorized" }));
        return;
      }
      if (!res.ok) {
        setCountAuth(prev => applyVaultFetchOutcome(prev, { kind: "failure" }));
        return;
      }
      const data = await res.json() as { count: number; limit: number };
      setEventCount(data.count);
      setEventLimit(data.limit);
      setCountAuth(prev => applyVaultFetchOutcome(prev, { kind: "ok" }));
    } catch {
      // silently ignore — event count is best-effort
      setCountAuth(prev => applyVaultFetchOutcome(prev, { kind: "failure" }));
    } finally {
      setCountLoading(false);
    }
  }, [authHeaders, authToken, isAuthRestoring]);

  useEffect(() => {
    void fetchEventCount();
  }, [fetchEventCount]);

  // Squad-slot usage. Best-effort and independent of the plan count: if it
  // fails the squad usage bar simply doesn't render (the server still enforces
  // the cap), so a failed fetch never blocks or misinforms.
  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/squads/count`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json() as { count: number; limit: number };
        if (!cancelled && typeof data?.count === "number" && typeof data?.limit === "number") {
          setSquadUsage({ count: data.count, limit: data.limit });
        }
      } catch {
        // best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders, authToken, squads.length]);

  // Retry driver: while the count fetch is auth-pending, re-run on a short
  // cadence until an authenticated fetch lands, then give up into an error.
  useEffect(() => {
    const decision = nextRetryDecision(countAuth);
    if (decision.action === "give-up") {
      setCountAuth(decision.next);
      return;
    }
    if (decision.action === "retry") {
      const t = setTimeout(() => { void fetchEventCount(); }, decision.delayMs);
      return () => clearTimeout(t);
    }
  }, [countAuth, fetchEventCount]);

  // The count is only authoritative once a genuine authenticated response has
  // arrived; while loading or mid auth-race the events/status stats stay neutral
  // rather than flashing a misleading "0" / "New" during a slow login.
  const countRenderMode = vaultRenderMode({
    loading: countLoading,
    authPending: countAuth.authPending,
    authError: countAuth.authError,
    photoCount: eventCount ?? 0,
  });
  const countReady = countRenderMode === "content" || countRenderMode === "empty";

  useEffect(() => {
    async function fetchStreaks() {
      try {
        const res = await fetch(`${API_BASE}/api/streaks`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = await res.json() as { monthlyPlan: number; stayInTouch: number };
          setStreaks(data);
        }
      } catch {
        // silently ignore — streaks are best-effort
      }
    }
    void fetchStreaks();
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

  // Production: check notification permission on mount (native only)
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    (async () => {
      try {
        const Notifications = await import("expo-notifications");
        const perm = await Notifications.getPermissionsAsync();
        if (cancelled) return;
        if (perm.granted || perm.status === "granted") {
          setNotifPermission("granted");
        } else if (perm.status === "denied") {
          setNotifPermission("denied");
        } else {
          setNotifPermission("undetermined");
        }
      } catch {
        // Notifications API unavailable (web build, simulator without credentials, etc.)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Production: re-check notification permission when app returns to foreground
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      (async () => {
        try {
          const Notifications = await import("expo-notifications");
          const perm = await Notifications.getPermissionsAsync();
          if (perm.granted || perm.status === "granted") {
            setNotifPermission("granted");
          } else if (perm.status === "denied") {
            setNotifPermission("denied");
          } else {
            setNotifPermission("undetermined");
          }
        } catch {
          // Notifications API unavailable
        }
      })();
    });
    return () => sub.remove();
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

  // Load persisted payment handles
  useEffect(() => {
    async function loadPreferences() {
      try {
        const res = await fetch(`${API_BASE}/api/user/preferences`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = await res.json() as {
            venmoHandle?: string | null;
            cashappHandle?: string | null;
            zelleHandle?: string | null;
          };
          setPaymentHandles({
            venmoHandle: data.venmoHandle ?? null,
            cashappHandle: data.cashappHandle ?? null,
            zelleHandle: data.zelleHandle ?? null,
          });
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

  const HANDLE_FIELD_MAP = {
    venmo: "venmoHandle",
    cashapp: "cashappHandle",
    zelle: "zelleHandle",
  } as const;

  async function saveHandle(key: "venmo" | "cashapp" | "zelle", value: string | null) {
    setSavingHandle(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ [HANDLE_FIELD_MAP[key]]: value }),
      });
      if (!res.ok) {
        Alert.alert("Error", "Couldn't save. Please try again.");
        return;
      }
      setPaymentHandles((prev) => ({ ...prev, [HANDLE_FIELD_MAP[key]]: value }));
      updateOwnPaymentHandles({ [key]: value });
      setEditingHandle(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setSavingHandle(false);
    }
  }

  function startEditHandle(key: "venmo" | "cashapp" | "zelle") {
    const current = paymentHandles[HANDLE_FIELD_MAP[key]];
    setDraftHandle(current ?? "");
    setEditingHandle(key);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function buildInviteUrl(code: string): string {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return `${window.location.origin}/api/add/friend/${code}`;
    }
    return `${API_BASE}/api/add/friend/${code}`;
  }

  /** Copy text on web: modern clipboard API → execCommand fallback for iframes. */
  function webCopy(text: string): boolean {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch { return false; }
  }

  async function handleShareFriendCode() {
    if (!friendCode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const inviteUrl = buildInviteUrl(friendCode);
    if (Platform.OS === "web") {
      const text = `${friendCode} — ${inviteUrl}`;
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = webCopy(text);
      }
      if (copied) {
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
      }
    } else {
      try {
        await Share.share({
          message: `Add me on SquadZ! 👥\n\nTap the link to add me instantly:\n${inviteUrl}\n\nOr use code: ${friendCode}`,
          url: inviteUrl,
          title: "Add me on SquadZ",
        });
      } catch {
        // User dismissed share sheet — no action needed
      }
    }
  }

  async function handleShareSquadInvite() {
    const firstSquad = mySquads[0];
    if (!firstSquad) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const code = firstSquad.inviteCode;
    const link = code
      ? `https://joinsquadz.com/squad/join?code=${code}`
      : `https://joinsquadz.com/squad/${firstSquad.id}`;
    const msg = `Join "${firstSquad.emoji} ${firstSquad.name}" on SquadZ — we use it to find when we're all free and plan hangouts 📅\n\n${link}`;
    if (Platform.OS === "web") {
      let copied = false;
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {
        copied = webCopy(link);
      }
      if (copied) {
        setSquadLinkCopied(true);
        setTimeout(() => setSquadLinkCopied(false), 2000);
      }
    } else {
      try {
        await Share.share({ message: msg, url: link });
      } catch {
        // dismissed
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
          title: "SquadZ test notification",
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
          label: "SquadZ Pro — Active",
          color: colors.gold,
          onPress: () => Alert.alert("SquadZ Pro", "You're on Pro! Manage your subscription below."),
        },
        {
          icon: "gift-outline",
          label: "What's included in Pro",
          onPress: () =>
            Alert.alert(
              "What's included in Pro",
              "🗓️  Unlimited Events — Create as many events as you like\n\n📷  Vault — Store, favorite & share squad photos",
              [
                { text: "View Events", onPress: () => router.navigate("/(tabs)/events" as never) },
                { text: "View Vault", onPress: () => router.push("/vault" as never) },
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
          icon: "gift-outline",
          label: "What's included in SquadZ+",
          color: colors.gold,
          onPress: () => openUpgrade("general"),
        },
        {
          icon: "flash",
          label: "Upgrade to SquadZ+",
          value: upgradePriceLabel ? `${upgradePriceLabel}/year` : undefined,
          color: colors.gold,
          onPress: () => openUpgrade("general"),
        },
      ];

  const { friends } = useData();

  const SETTINGS: SettingItem[][] = [
    [
      { icon: "person-outline", label: "Edit Profile", onPress: () => router.push("/settings/edit-profile" as never) },
      {
        icon: "images-outline",
        label: isPro === false ? "My Photo Vault ⚡" : "My Photo Vault",
        onPress: () => {
          const gate = profileVaultUpgradeTrigger(isPro);
          if (gate) {
            openUpgrade(gate);
            return;
          }
          router.push("/vault" as never);
        },
      },
      { icon: "people-outline", label: "Friends", value: String(friends.length), onPress: () => router.push("/friends" as never) },
      { icon: "notifications-outline", label: "Notifications", onPress: () => router.push("/settings/notifications" as never) },
      { icon: "lock-closed-outline", label: "Privacy", onPress: () => router.push("/settings/privacy" as never) },
      { icon: "ban-outline", label: "Blocked Users", onPress: () => router.push("/settings/blocked" as never) },
    ],
    proSection,
    [
      { icon: "help-circle-outline", label: "Help & Support", onPress: () => Alert.alert("Help & Support", "Need a hand? Reach us at support@joinsquadz.com") },
      { icon: "star-outline", label: "Rate SquadZ", onPress: () => Alert.alert("Rate SquadZ", "Thanks for the love! ⭐️ Ratings open in the App Store.") },
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
      <View style={[styles.topBar, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); if (router.canGoBack()) { router.back(); } else { router.replace("/(tabs)"); } }}
          style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.topBarTitle, { color: colors.foreground }]}>You</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
      >
        {showSuccessBanner && (
          <Animated.View style={[styles.successBanner, { backgroundColor: colors.green + "18", borderColor: colors.green + "50", opacity: bannerOpacity, marginTop: 12 }]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                <Text style={styles.successEmoji}>🎉</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.successTitle, { color: colors.green }]}>Welcome to SquadZ+!</Text>
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
                  { key: "vault", icon: "📷", label: "Vault", route: "/vault" },
                ] as const).map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowSuccessBanner(false);
                      router.navigate(f.route as never);
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
        <View style={[styles.profileCard, { paddingTop: showSuccessBanner ? 16 : 20, borderBottomColor: colors.border }]}>
          <View>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (currentUser.profileImageUrl) setAvatarViewerOpen(true);
                else router.push("/settings/edit-profile" as never);
              }}
              activeOpacity={0.85}
              accessibilityLabel={currentUser.profileImageUrl ? "View profile photo" : "Add profile photo"}
              accessibilityRole="button"
            >
              <UserAvatar initials={currentUser.initials} color={currentUser.color} imageUrl={currentUser.profileImageUrl} size={80} fontSize={28} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/settings/edit-profile" as never); }}
              style={[styles.avatarEditBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}
              hitSlop={8}
              accessibilityLabel="Edit profile photo"
              accessibilityRole="button"
            >
              <Ionicons name="camera" size={13} color="#fff" />
            </TouchableOpacity>
          </View>
          <ImageViewerModal
            visible={avatarViewerOpen}
            uri={currentUser.profileImageUrl ?? null}
            onClose={() => setAvatarViewerOpen(false)}
          />
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]}>{currentUser.name}</Text>
            {isPro === null ? (
              <ActivityIndicator size="small" color={colors.gold} style={{ marginLeft: 8 }} />
            ) : isPro ? (
              <View style={[styles.proBadge, { backgroundColor: colors.gold + "22", borderColor: colors.gold + "60" }]}>
                <Text style={[styles.proBadgeText, { color: colors.gold }]}>PRO</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.statsRow}>
            {[
              { value: countReady && eventCount !== null ? String(eventCount) : "—", label: "Events" },
              { value: mySquads.length.toString(), label: "Squads" },
              { value: mySquads.length > 0 || (countReady && eventCount !== null && eventCount > 0) ? "Active" : (countReady ? "New" : "—"), label: "Status" },
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
          {countReady && eventCount !== null && !isPro && (
            <View style={[styles.eventUsageBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.eventUsageRow}>
                <Text style={[styles.eventUsageLabel, { color: colors.mutedForeground }]}>
                  {eventCount} / {eventLimit} free plans used in the last 12 months
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
              <Text style={[styles.usageExplainer, { color: colors.textDim }]}>
                Events and trips count together, whether you created them or joined them.
              </Text>
            </View>
          )}
          {squadUsage !== null && !isPro && (
            <View style={[styles.eventUsageBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.eventUsageRow}>
                <Text style={[styles.eventUsageLabel, { color: colors.mutedForeground }]}>
                  {squadUsage.count} / {squadUsage.limit} free squads used
                </Text>
                <Text style={[styles.eventUsageRemaining, { color: squadUsage.count >= squadUsage.limit ? colors.destructive : colors.mutedForeground }]}>
                  {squadUsage.count >= squadUsage.limit
                    ? "Limit reached"
                    : `${squadUsage.limit - squadUsage.count} left`}
                </Text>
              </View>
              <View style={[styles.eventUsageTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.eventUsageFill,
                    {
                      backgroundColor: squadUsage.count >= squadUsage.limit ? colors.destructive : colors.primary,
                      width: `${Math.min(100, (squadUsage.count / squadUsage.limit) * 100)}%` as `${number}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.usageExplainer, { color: colors.textDim }]}>
                A slot is used when you create or join a squad. Leaving one doesn't give the slot back.
              </Text>
            </View>
          )}
        </View>

        {streaks !== null && (streaks.monthlyPlan > 0 || streaks.stayInTouch > 0) && (
          <View style={[styles.section, { flexDirection: "row", gap: 12 }]}>
            <View style={[styles.streakCard, { backgroundColor: colors.card, borderColor: "#FFB23E40", flex: 1 }]}>
              <View style={styles.streakCardTop}>
                <Text style={styles.streakEmoji}>🔥</Text>
                <Text style={[styles.streakCount, { color: "#FFB23E" }]}>
                  {streaks.monthlyPlan > 0 ? streaks.monthlyPlan : "—"}
                </Text>
              </View>
              <Text style={[styles.streakLabel, { color: colors.foreground }]}>
                {streaks.monthlyPlan === 1 ? "month" : "months"}
              </Text>
              <Text style={[styles.streakSub, { color: colors.mutedForeground }]}>Monthly plan streak</Text>
            </View>
            <View style={[styles.streakCard, { backgroundColor: colors.card, borderColor: "#4A9EFF40", flex: 1 }]}>
              <View style={styles.streakCardTop}>
                <Text style={styles.streakEmoji}>💬</Text>
                <Text style={[styles.streakCount, { color: "#4A9EFF" }]}>
                  {streaks.stayInTouch > 0 ? streaks.stayInTouch : "—"}
                </Text>
              </View>
              <Text style={[styles.streakLabel, { color: colors.foreground }]}>
                {streaks.stayInTouch === 1 ? "week" : "weeks"}
              </Text>
              <Text style={[styles.streakSub, { color: colors.mutedForeground }]}>Stay-in-touch streak</Text>
            </View>
          </View>
        )}

        {mySquads.length > 0 && (
          <TouchableOpacity
            onPress={() => { void handleShareSquadInvite(); }}
            activeOpacity={0.8}
            style={[styles.inviteCrewCard, {
              backgroundColor: squadLinkCopied ? colors.green + "12" : colors.primary + "12",
              borderColor: squadLinkCopied ? colors.green + "30" : colors.primary + "30",
            }]}
          >
            <View style={[styles.inviteCrewIcon, { backgroundColor: squadLinkCopied ? colors.green + "22" : colors.primary + "22" }]}>
              <Ionicons name={squadLinkCopied ? "checkmark" : "person-add-outline"} size={22} color={squadLinkCopied ? colors.green : colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.inviteCrewTitle, { color: colors.foreground }]}>
                {squadLinkCopied ? "Link copied!" : "Invite your crew"}
              </Text>
              <Text style={[styles.inviteCrewSub, { color: colors.mutedForeground }]}>
                {squadLinkCopied ? "Paste it and share with your crew" : `Share a link to ${mySquads[0]?.emoji} ${mySquads[0]?.name}`}
              </Text>
            </View>
            <Ionicons
              name={squadLinkCopied ? "checkmark-circle" : (Platform.OS === "web" ? "copy-outline" : "share-outline")}
              size={20}
              color={squadLinkCopied ? colors.green : colors.primary}
            />
          </TouchableOpacity>
        )}

        {notifPermission === "denied" && Platform.OS !== "web" && (
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void Linking.openSettings(); }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Turn on notifications in Settings"
            style={[styles.notifNudge, { backgroundColor: colors.card, borderColor: "#FF6B2C" + "60" }]}
          >
            <View style={[styles.notifNudgeIcon, { backgroundColor: "#FF6B2C" + "18" }]}>
              <Ionicons name="notifications-off-outline" size={22} color="#FF6B2C" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.notifNudgeTitle, { color: colors.foreground }]}>Turn on notifications</Text>
              <Text style={[styles.notifNudgeBody, { color: colors.mutedForeground }]}>
                You'll miss event reminders and squad invites. Tap to enable in Settings.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#FF6B2C" />
          </TouchableOpacity>
        )}

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
                    <Text style={[styles.eventDate, { color: colors.mutedForeground }]}>{s.memberIds?.length ?? 0} members</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Payment methods</Text>
          <Text style={[styles.eventDate, { color: colors.mutedForeground, marginBottom: 12 }]}>
            Squad members see these when splitting costs.
          </Text>
          {([
            { key: "venmo" as const, label: "Venmo", icon: "💸", placeholder: "@your-venmo", prefix: "@" },
            { key: "cashapp" as const, label: "Cash App", icon: "💰", placeholder: "$yourcashtag", prefix: "$" },
            { key: "zelle" as const, label: "Zelle", icon: "⚡", placeholder: "email or phone", prefix: "" },
          ]).map(({ key, label, icon, placeholder, prefix }, idx, arr) => {
            const fieldKey = HANDLE_FIELD_MAP[key];
            const current = paymentHandles[fieldKey];
            const isEditing = editingHandle === key;
            const isFirst = idx === 0;
            const isLast = idx === arr.length - 1;
            return (
              <View
                key={key}
                style={[
                  styles.handleRow,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  isFirst && styles.handleFirst,
                  isLast && styles.handleLast,
                  idx > 0 && { borderTopWidth: 0 },
                ]}
              >
                {isEditing ? (
                  <View style={{ flex: 1, gap: 10 }}>
                    <View style={styles.handleEditRow}>
                      <Text style={[styles.handleIcon]}>{icon}</Text>
                      <Text style={[styles.handleLabel, { color: colors.foreground }]}>{label}</Text>
                    </View>
                    <TextInput
                      value={draftHandle}
                      onChangeText={setDraftHandle}
                      placeholder={placeholder}
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus
                      style={[styles.handleInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    />
                    <View style={styles.handleEditActions}>
                      {savingHandle ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <>
                          <TouchableOpacity
                            onPress={() => { void saveHandle(key, draftHandle.trim() || null); }}
                            style={[styles.handleSaveBtn, { backgroundColor: colors.primary }]}
                          >
                            <Text style={styles.handleSaveBtnText}>Save</Text>
                          </TouchableOpacity>
                          {current && (
                            <TouchableOpacity
                              onPress={() => { void saveHandle(key, null); }}
                              style={[styles.handleRemoveBtn, { borderColor: colors.destructive + "60" }]}
                            >
                              <Text style={[styles.handleRemoveBtnText, { color: colors.destructive }]}>Remove</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            onPress={() => setEditingHandle(null)}
                            style={[styles.handleCancelBtn, { borderColor: colors.border }]}
                          >
                            <Text style={[styles.handleCancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                ) : (
                  <>
                    <Text style={styles.handleIcon}>{icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.handleLabel, { color: colors.foreground }]}>{label}</Text>
                      {current ? (
                        <Text style={[styles.handleValue, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {prefix}{current}
                        </Text>
                      ) : (
                        <Text style={[styles.handleEmpty, { color: colors.mutedForeground }]}>Not set</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => startEditHandle(key)}
                      style={[styles.handleEditBtn, { backgroundColor: current ? colors.card : colors.primary + "14", borderColor: current ? colors.border : colors.primary + "40" }]}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.handleEditBtnText, { color: current ? colors.mutedForeground : colors.primary }]}>
                        {current ? "Edit" : "Add"}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            );
          })}
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
                  <Switch
                    value={item.toggle}
                    onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); item.onToggle?.(v); }}
                    trackColor={{ false: colors.border, true: colors.primary + "80" }}
                    thumbColor={item.toggle ? colors.primary : colors.mutedForeground}
                  />
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

      <UpgradeModal
        visible={upgradeModalVisible}
        trigger={upgradeTrigger}
        onClose={() => setUpgradeModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  topBarTitle: { fontSize: 18, fontWeight: "800" },
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
  streakCard: { borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 4 },
  streakCardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  streakEmoji: { fontSize: 22 },
  streakCount: { fontSize: 28, fontWeight: "900" },
  streakLabel: { fontSize: 13, fontWeight: "700" },
  streakSub: { fontSize: 11, marginTop: 1 },
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
  usageExplainer: { fontSize: 11, marginTop: 6, lineHeight: 15 },
  devSectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 },
  devTokenLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  devTokenValue: { fontSize: 12, fontFamily: "monospace", letterSpacing: 0.3 },
  handleRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderWidth: 1 },
  handleFirst: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  handleLast: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  handleIcon: { fontSize: 22, width: 28, textAlign: "center" },
  handleLabel: { fontSize: 14, fontWeight: "700" },
  handleValue: { fontSize: 13, marginTop: 1 },
  handleEmpty: { fontSize: 13, marginTop: 1, fontStyle: "italic" },
  handleEditBtn: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 6 },
  handleEditBtnText: { fontSize: 13, fontWeight: "700" },
  handleEditRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  handleInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  handleEditActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  handleSaveBtn: { borderRadius: 20, paddingHorizontal: 18, paddingVertical: 7 },
  handleSaveBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  handleRemoveBtn: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  handleRemoveBtnText: { fontSize: 13, fontWeight: "700" },
  handleCancelBtn: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  handleCancelBtnText: { fontSize: 13, fontWeight: "600" },
  inviteCrewCard: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 20, marginTop: 16, borderRadius: 14, borderWidth: 1, padding: 14 },
  inviteCrewIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  inviteCrewTitle: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  inviteCrewSub: { fontSize: 13 },
  notifNudge: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 20, marginTop: 16, borderRadius: 14, borderWidth: 1, padding: 14 },
  notifNudgeIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  notifNudgeTitle: { fontSize: 15, fontWeight: "700" },
  notifNudgeBody: { fontSize: 13, lineHeight: 18 },
});
