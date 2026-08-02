import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type Prefs = {
  notifyEventInvites: boolean;
  notifyReminders: boolean;
  notifyMessages: boolean;
  notifyFriendActivity: boolean;
  notifySquadJoin: boolean;
  notifySquadLeave: boolean;
  notifyPayments: boolean;
};

type MutedSquad = {
  id: string;
  name: string;
  emoji: string;
};

type Squad = {
  id: string;
  name: string;
  emoji: string;
};

const ROWS: { key: keyof Prefs; icon: keyof typeof Ionicons.glyphMap; label: string; sub: string }[] = [
  { key: "notifyEventInvites", icon: "mail-outline", label: "Event Invites", sub: "When you're invited to an event" },
  { key: "notifyReminders", icon: "alarm-outline", label: "Event Reminders", sub: "Before events you're going to" },
  { key: "notifyMessages", icon: "chatbubble-outline", label: "Messages", sub: "New messages in your chats" },
  { key: "notifyFriendActivity", icon: "people-outline", label: "Friend Activity", sub: "When friends join or RSVP" },
  { key: "notifySquadJoin", icon: "person-add-outline", label: "New Squad Members", sub: "When someone joins one of your squads" },
  { key: "notifySquadLeave", icon: "person-remove-outline", label: "Squad Departures", sub: "When someone leaves or is removed from a squad" },
  { key: "notifyPayments", icon: "cash-outline", label: "Payments", sub: "When you owe money or someone settles up with you" },
];

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutedSquads, setMutedSquads] = useState<MutedSquad[]>([]);
  const [unmutingId, setUnmutingId] = useState<string | null>(null);

  const [mutePickerVisible, setMutePickerVisible] = useState(false);
  const [allSquads, setAllSquads] = useState<Squad[]>([]);
  const [loadingSquads, setLoadingSquads] = useState(false);
  const [mutingId, setMutingId] = useState<string | null>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const authHeaders = useCallback((): Record<string, string> => {
    return buildAuthHeaders(authToken);
  }, [authToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prefsRes, mutedRes] = await Promise.all([
        fetch(`${API_BASE}/api/user/preferences`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/squads/muted`, { headers: authHeaders() }),
      ]);
      if (prefsRes.ok) {
        const data = await prefsRes.json() as Prefs;
        setPrefs({
          notifyEventInvites: data.notifyEventInvites,
          notifyReminders: data.notifyReminders,
          notifyMessages: data.notifyMessages,
          notifyFriendActivity: data.notifyFriendActivity,
          notifySquadJoin: data.notifySquadJoin,
          notifySquadLeave: data.notifySquadLeave,
          notifyPayments: data.notifyPayments,
        });
      }
      if (mutedRes.ok) {
        const data = await mutedRes.json() as { squads: MutedSquad[] };
        setMutedSquads(data.squads);
      }
    } catch {
      // leave prefs null → error state shown
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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

  async function unmuteSquad(squadId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUnmutingId(squadId);
    try {
      const res = await fetch(`${API_BASE}/api/squads/${squadId}/mute`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ muted: false }),
      });
      if (res.ok) {
        setMutedSquads((prev) => prev.filter((s) => s.id !== squadId));
      }
    } catch {
      // leave list unchanged on error
    } finally {
      setUnmutingId(null);
    }
  }

  async function openMutePicker() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMutePickerVisible(true);
    setLoadingSquads(true);
    try {
      const res = await fetch(`${API_BASE}/api/squads`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json() as Squad[];
        setAllSquads(data);
      }
    } catch {
      // leave empty on error
    } finally {
      setLoadingSquads(false);
    }
  }

  async function muteSquad(squad: Squad) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMutingId(squad.id);
    try {
      const res = await fetch(`${API_BASE}/api/squads/${squad.id}/mute`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ muted: true }),
      });
      if (res.ok) {
        setMutedSquads((prev) => [...prev, { id: squad.id, name: squad.name, emoji: squad.emoji }]);
        setMutePickerVisible(false);
      }
    } catch {
      // leave list unchanged on error
    } finally {
      setMutingId(null);
    }
  }

  const unmutedSquads = allSquads.filter((s) => !mutedSquads.some((m) => m.id === s.id));

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/profile" as never); } }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
            Choose what SquadZ notifies you about.
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

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>MUTED SQUADS</Text>
          <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {mutedSquads.length === 0 ? (
              <View style={[styles.row, { justifyContent: "center" }]}>
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>No squads muted</Text>
              </View>
            ) : (
              mutedSquads.map((squad, i) => (
                <View
                  key={squad.id}
                  style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
                    <Text style={{ fontSize: 18 }}>{squad.emoji}</Text>
                  </View>
                  <Text style={[styles.rowLabel, { flex: 1, color: colors.foreground }]} numberOfLines={1}>
                    {squad.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => void unmuteSquad(squad.id)}
                    disabled={unmutingId === squad.id}
                    style={[styles.actionBtn, { borderColor: colors.primary }]}
                  >
                    {unmutingId === squad.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Text style={[styles.actionBtnText, { color: colors.primary }]}>Unmute</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity
              onPress={() => void openMutePicker()}
              style={[styles.row, styles.addMuteRow]}
            >
              <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
                <Ionicons name="volume-mute-outline" size={18} color={colors.primary} />
              </View>
              <Text style={[styles.rowLabel, { flex: 1, color: colors.primary }]}>Mute a squad…</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      <Modal
        visible={mutePickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setMutePickerVisible(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <View style={{ width: 60 }} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Mute a Squad</Text>
            <TouchableOpacity
              onPress={() => setMutePickerVisible(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ width: 60, alignItems: "flex-end" }}
            >
              <Text style={[styles.modalCancel, { color: colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {loadingSquads ? (
            <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
          ) : unmutedSquads.length === 0 ? (
            <View style={styles.center}>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>All your squads are already muted.</Text>
            </View>
          ) : (
            <FlatList
              data={unmutedSquads}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }}
              ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => void muteSquad(item)}
                  disabled={mutingId === item.id}
                  style={[styles.row, { backgroundColor: colors.card }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
                    <Text style={{ fontSize: 18 }}>{item.emoji}</Text>
                  </View>
                  <Text style={[styles.rowLabel, { flex: 1, color: colors.foreground }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {mutingId === item.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <View style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                      <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Mute</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionHint: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  sectionLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, marginTop: 28, marginBottom: 8, marginLeft: 4 },
  group: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  addMuteRow: { borderTopWidth: StyleSheet.hairlineWidth },
  iconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2 },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, minWidth: 72, alignItems: "center" },
  actionBtnText: { fontSize: 13, fontWeight: "600" },
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  modalCancel: { fontSize: 15, fontWeight: "500" },
});
