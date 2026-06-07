import { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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

const DAY_FULL: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

type PollPayload = {
  poll: { id: string; title: string; days: string[]; slots: string[] };
  heatmap: { cell: string; count: number }[];
  respondentCount: number;
  myCells: string[];
  best: { cell: string; count: number; total: number } | null;
};

function prettyCell(cell: string | null): string {
  if (!cell) return "";
  const [day, slot] = cell.split("-");
  return `${DAY_FULL[day] ?? day} ${slot}`;
}

export default function AvailabilityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();
  const params = useLocalSearchParams<{ squadId?: string; eventId?: string; from?: string }>();
  const squadId = params.squadId || undefined;
  const eventId = params.eventId || undefined;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PollPayload | null>(null);
  const [mySet, setMySet] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    return {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    };
  }, [authToken]);

  const loadPoll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/availability/polls`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(squadId ? { squadId } : { eventId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not load availability.");
        return;
      }
      const payload = (await res.json()) as PollPayload;
      setData(payload);
      setMySet(new Set(payload.myCells));
      setDirty(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, squadId, eventId]);

  useEffect(() => {
    if (!squadId && !eventId) {
      setError("Missing squad or event.");
      setLoading(false);
      return;
    }
    void loadPoll();
  }, [loadPoll, squadId, eventId]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    data?.heatmap.forEach((c) => m.set(c.cell, c.count));
    return m;
  }, [data]);

  const toggleCell = (cell: string) => {
    Haptics.selectionAsync();
    setMySet((prev) => {
      const next = new Set(prev);
      if (next.has(cell)) next.delete(cell);
      else next.add(cell);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/availability/polls/${data.poll.id}/me`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ cells: [...mySet] }),
      });
      if (!res.ok) {
        Alert.alert("Couldn't save", "Please try again.");
        return;
      }
      const payload = (await res.json()) as PollPayload;
      setData(payload);
      setMySet(new Set(payload.myCells));
      setDirty(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Couldn't save", "Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const useThisTime = async () => {
    if (!data?.best) return;
    const friendly = prettyCell(data.best.cell);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (eventId) {
      try {
        const res = await fetch(`${API_BASE}/api/events/${eventId}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ date: friendly }),
        });
        if (res.ok) {
          Alert.alert("Time locked in", `${friendly} is now the event time.`, [
            { text: "Done", onPress: () => router.back() },
          ]);
        } else if (res.status === 403) {
          Alert.alert("Host only", "Only the event host can change the time.");
        } else {
          Alert.alert("Couldn't update", "Please try again.");
        }
      } catch {
        Alert.alert("Couldn't update", "Network error. Please try again.");
      }
      return;
    }
    // Squad / create flow → start an event prefilled with the winning slot.
    router.replace({
      pathname: "/(tabs)/create",
      params: { prefillDate: friendly, prefillSquad: squadId ?? "" },
    } as never);
  };

  const total = data?.respondentCount ?? 0;

  const cellStyle = (cell: string) => {
    const c = counts.get(cell) ?? 0;
    const mine = mySet.has(cell);
    let bg = colors.card;
    if (total > 0 && c > 0) {
      const intensity = c / total;
      const alpha = intensity >= 1 ? "FF" : intensity >= 0.66 ? "AA" : intensity >= 0.33 ? "66" : "33";
      bg = colors.primary + alpha;
    }
    return {
      backgroundColor: bg,
      borderColor: mine ? colors.foreground : colors.border,
      borderWidth: mine ? 2 : 1,
    };
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never))}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Find the Best Time</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textDim} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{error}</Text>
          <TouchableOpacity onPress={() => void loadPoll()} style={[styles.retryBtn, { borderColor: colors.border }]}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : data ? (
        <>
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: botPad + 140, paddingHorizontal: 20 }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Tap the times you're free. We'll highlight when the most people can make it.
            </Text>

            {data.best && (
              <View style={[styles.bestCard, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
                <View style={[styles.bestIcon, { backgroundColor: colors.primary }]}>
                  <Ionicons name="sparkles" size={16} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.bestLabel, { color: colors.primary }]}>Best time</Text>
                  <Text style={[styles.bestValue, { color: colors.foreground }]}>{prettyCell(data.best.cell)}</Text>
                  <Text style={[styles.bestSub, { color: colors.mutedForeground }]}>
                    {data.best.count} of {data.best.total} free
                  </Text>
                </View>
              </View>
            )}

            {/* Grid */}
            <View style={styles.gridWrap}>
              <View style={styles.gridHeaderRow}>
                <View style={styles.timeLabelCol} />
                {data.poll.days.map((d) => (
                  <Text key={d} style={[styles.dayHeader, { color: colors.mutedForeground }]}>
                    {d}
                  </Text>
                ))}
              </View>
              {data.poll.slots.map((slot) => (
                <View key={slot} style={styles.gridRow}>
                  <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>{slot}</Text>
                  {data.poll.days.map((day) => {
                    const cell = `${day}-${slot}`;
                    const c = counts.get(cell) ?? 0;
                    return (
                      <TouchableOpacity
                        key={cell}
                        onPress={() => toggleCell(cell)}
                        activeOpacity={0.7}
                        style={[styles.cell, cellStyle(cell)]}
                      >
                        {c > 0 && (
                          <Text style={[styles.cellCount, { color: total > 0 && c / total >= 0.66 ? "#fff" : colors.foreground }]}>
                            {c}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Legend */}
            <View style={styles.legendRow}>
              <View style={[styles.legendSwatch, { backgroundColor: colors.card, borderColor: colors.border }]} />
              <Text style={[styles.legendText, { color: colors.textDim }]}>None</Text>
              <View style={[styles.legendSwatch, { backgroundColor: colors.primary + "66" }]} />
              <Text style={[styles.legendText, { color: colors.textDim }]}>Some</Text>
              <View style={[styles.legendSwatch, { backgroundColor: colors.primary }]} />
              <Text style={[styles.legendText, { color: colors.textDim }]}>Everyone</Text>
            </View>

            <Text style={[styles.respText, { color: colors.mutedForeground }]}>
              {total === 0 ? "Be the first to add your times." : `${total} ${total === 1 ? "person has" : "people have"} responded`}
            </Text>
          </ScrollView>

          <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 12, backgroundColor: colors.background }]}>
            {data.best && !dirty && (
              <TouchableOpacity onPress={() => void useThisTime()} style={[styles.secondaryBtn, { borderColor: colors.primary }]}>
                <Ionicons name={eventId ? "checkmark-circle-outline" : "calendar-outline"} size={18} color={colors.primary} />
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                  {eventId ? `Use ${prettyCell(data.best.cell)}` : "Create event at best time"}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => void save()}
              disabled={saving || !dirty}
              style={[styles.saveBtn, { backgroundColor: dirty ? colors.primary : colors.border }]}
            >
              <Text style={[styles.saveBtnText, { color: dirty ? "#fff" : colors.textDim }]}>
                {saving ? "Saving…" : dirty ? "Save my availability" : "Saved"}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { padding: 8 },
  title: { fontSize: 24, fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errorText: { fontSize: 15, textAlign: "center" },
  retryBtn: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { fontSize: 14, fontWeight: "700" },
  body: { flex: 1 },
  subtitle: { fontSize: 14, lineHeight: 20, paddingTop: 16, paddingBottom: 4 },
  bestCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 14 },
  bestIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  bestLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  bestValue: { fontSize: 17, fontWeight: "800", marginTop: 1 },
  bestSub: { fontSize: 12, marginTop: 1 },
  gridWrap: { marginTop: 20 },
  gridHeaderRow: { flexDirection: "row", marginBottom: 6 },
  timeLabelCol: { width: 38 },
  dayHeader: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700" },
  gridRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  timeLabel: { width: 38, fontSize: 11, fontWeight: "600" },
  cell: { flex: 1, height: 38, marginHorizontal: 2, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cellCount: { fontSize: 12, fontWeight: "800" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18, flexWrap: "wrap" },
  legendSwatch: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: "transparent" },
  legendText: { fontSize: 12, marginRight: 8 },
  respText: { fontSize: 13, marginTop: 16, fontWeight: "600" },
  bottomBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, gap: 10 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1.5, paddingVertical: 13 },
  secondaryBtnText: { fontSize: 15, fontWeight: "800" },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 15 },
  saveBtnText: { fontSize: 16, fontWeight: "800" },
});
