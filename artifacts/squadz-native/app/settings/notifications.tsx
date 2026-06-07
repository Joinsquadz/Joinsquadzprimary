import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";

function resolveApiBase(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined;
  if (extra?.apiBase) return extra.apiBase;
  if (Platform.OS === "web") return "";
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "";
}

const API_BASE = resolveApiBase();

type Prefs = {
  notifyEventInvites: boolean;
  notifyReminders: boolean;
  notifyMessages: boolean;
  notifyFriendActivity: boolean;
};

const ROWS: { key: keyof Prefs; icon: keyof typeof Ionicons.glyphMap; label: string; sub: string }[] = [
  { key: "notifyEventInvites", icon: "mail-outline", label: "Event Invites", sub: "When you're invited to an event" },
  { key: "notifyReminders", icon: "alarm-outline", label: "Event Reminders", sub: "Before events you're going to" },
  { key: "notifyMessages", icon: "chatbubble-outline", label: "Squad Messages", sub: "New messages in squad chats" },
  { key: "notifyFriendActivity", icon: "people-outline", label: "Friend Activity", sub: "When friends join or RSVP" },
];

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const authHeaders = useCallback((): Record<string, string> => {
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  }, [authToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/preferences`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json() as Prefs;
        setPrefs({
          notifyEventInvites: data.notifyEventInvites,
          notifyReminders: data.notifyReminders,
          notifyMessages: data.notifyMessages,
          notifyFriendActivity: data.notifyFriendActivity,
        });
      }
    } catch {
      // leave prefs null → error state shown
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(key: keyof Prefs, value: boolean) {
    if (!prefs) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prev = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      const res = await fetch(`${API_BASE}/api/user/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) setPrefs(prev);
    } catch {
      setPrefs(prev);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : !prefs ? (
        <View style={styles.center}>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground, textAlign: "center", marginBottom: 14 }]}>
            Couldn't load your settings.
          </Text>
          <TouchableOpacity
            onPress={() => void load()}
            style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.primary, fontWeight: "600" }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
            Choose what Squadz notifies you about.
          </Text>
          <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {ROWS.map((row, i) => (
              <View
                key={row.key}
                style={[styles.row, i < ROWS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
                  <Ionicons name={row.icon} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{row.label}</Text>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{row.sub}</Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={(v) => toggle(row.key, v)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionHint: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  group: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  iconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2 },
});
