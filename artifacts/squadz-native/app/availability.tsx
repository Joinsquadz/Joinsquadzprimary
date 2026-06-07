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
  Modal,
  TextInput,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

const DAY_COUNT_OPTIONS = [3, 5, 7, 14];
const DEFAULT_DAY_COUNT = 7;

const DAY_FULL: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type PollPayload = {
  poll: { id: string; title: string; days: string[]; slots: string[] };
  heatmap: { cell: string; count: number }[];
  respondentCount: number;
  myCells: string[];
  best: { cell: string; count: number; total: number } | null;
};

// Split a cell key `${day}-${slot}` on the LAST dash so ISO dates (which
// contain dashes, e.g. "2026-06-14") keep their slot intact.
function splitCell(cell: string): { day: string; slot: string } {
  const i = cell.lastIndexOf("-");
  if (i < 0) return { day: cell, slot: "" };
  return { day: cell.slice(0, i), slot: cell.slice(i + 1) };
}

function parseISODate(day: string): Date | null {
  const m = ISO_DATE.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Build `count` consecutive ISO date strings starting at `start`.
function computeRange(start: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(toISODate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  }
  return out;
}

// "7PM" -> "7 PM"; pass anything else through unchanged.
function formatSlot(slot: string): string {
  const m = /^(\d{1,2})\s*(AM|PM)$/i.exec(slot);
  return m ? `${m[1]} ${m[2].toUpperCase()}` : slot;
}

// Column header label for a poll day. Dated polls show weekday + M/D
// (e.g. "Sat" / "6/14"); legacy weekday polls show the weekday label.
function dayHeader(day: string): { top: string; sub: string } {
  const d = parseISODate(day);
  if (!d) return { top: day, sub: "" };
  return {
    top: WEEKDAY_SHORT[d.getDay()],
    sub: `${d.getMonth() + 1}/${d.getDate()}`,
  };
}

// Human-friendly day label. Dated -> "Sat Jun 14"; legacy -> "Monday".
function prettyDay(day: string): string {
  const d = parseISODate(day);
  if (!d) return DAY_FULL[day] ?? day;
  return `${WEEKDAY_SHORT[d.getDay()]} ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// Full label for a chosen cell, e.g. "Sat Jun 14 · 7 PM" (dated) or
// "Monday 8 PM" (legacy weekday).
function prettyCell(cell: string | null): string {
  if (!cell) return "";
  const { day, slot } = splitCell(cell);
  const isDate = parseISODate(day) !== null;
  const slotPretty = formatSlot(slot);
  const dayPretty = prettyDay(day);
  if (!slotPretty) return dayPretty;
  return isDate ? `${dayPretty} · ${slotPretty}` : `${dayPretty} ${slotPretty}`;
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

  // Setup state: shown when no poll exists yet so the creator can pick the
  // availability range (start date + number of days) before it's created.
  const [needsSetup, setNeedsSetup] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rangeStart, setRangeStart] = useState<Date>(new Date());
  const [rangeDays, setRangeDays] = useState<number>(DEFAULT_DAY_COUNT);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());

  const authHeaders = useCallback((): Record<string, string> => {
    return {
      "Content-Type": "application/json",
      ...buildAuthHeaders(authToken),
    };
  }, [authToken]);

  const loadPoll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsSetup(false);
    try {
      const qs = new URLSearchParams(squadId ? { squadId } : { eventId: eventId ?? "" });
      const res = await fetch(`${API_BASE}/api/availability/polls/find?${qs.toString()}`, {
        headers: authHeaders(),
      });
      if (res.status === 404) {
        // No poll yet — let the creator choose the date range.
        setData(null);
        setNeedsSetup(true);
        return;
      }
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

  const createPoll = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const days = computeRange(rangeStart, rangeDays);
      const res = await fetch(`${API_BASE}/api/availability/polls`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ...(squadId ? { squadId } : { eventId }), days }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        Alert.alert("Couldn't create poll", body.error ?? "Please try again.");
        return;
      }
      const payload = (await res.json()) as PollPayload;
      setData(payload);
      setMySet(new Set(payload.myCells));
      setNeedsSetup(false);
      setDirty(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Couldn't create poll", "Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }, [authHeaders, squadId, eventId, rangeStart, rangeDays]);

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

  const openRangePicker = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerDate(rangeStart);
    setPickerOpen(true);
  };

  const handleAndroidPick = (_: DateTimePickerEvent, d?: Date) => {
    setPickerOpen(false);
    if (d) setRangeStart(d);
  };

  const confirmIOSPick = () => {
    setRangeStart(pickerDate);
    setPickerOpen(false);
  };

  const rangePreview = useMemo(() => {
    const days = computeRange(rangeStart, rangeDays);
    const first = days[0];
    const last = days[days.length - 1];
    return `${prettyDay(first)} – ${prettyDay(last)}`;
  }, [rangeStart, rangeDays]);

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
      ) : needsSetup ? (
        <>
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: botPad + 120, paddingHorizontal: 20 }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Pick the dates everyone should mark their availability for. You can plan for this week or further out.
            </Text>

            <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>Start date</Text>
            {Platform.OS === "web" ? (
              <View style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.primary }]}>
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <TextInput
                  value={toISODate(rangeStart)}
                  onChangeText={(t) => {
                    const d = parseISODate(t.trim());
                    if (d) setRangeStart(d);
                  }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textDim}
                  style={[styles.dateBtnText, { color: colors.foreground }]}
                />
              </View>
            ) : (
              <TouchableOpacity
                onPress={openRangePicker}
                style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.primary }]}
              >
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <Text style={[styles.dateBtnText, { color: colors.foreground }]}>{prettyDay(toISODate(rangeStart))}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}

            <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>How many days?</Text>
            <View style={styles.chipRow}>
              {DAY_COUNT_OPTIONS.map((n) => {
                const active = rangeDays === n;
                return (
                  <TouchableOpacity
                    key={n}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setRangeDays(n);
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>{n} days</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.previewCard, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
              <Ionicons name="time-outline" size={16} color={colors.primary} />
              <Text style={[styles.previewText, { color: colors.foreground }]}>{rangePreview}</Text>
            </View>
          </ScrollView>

          <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 12, backgroundColor: colors.background }]}>
            <TouchableOpacity
              onPress={() => void createPoll()}
              disabled={creating}
              style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: creating ? 0.7 : 1 }]}
            >
              <Text style={[styles.saveBtnText, { color: "#fff" }]}>
                {creating ? "Creating…" : "Create poll"}
              </Text>
            </TouchableOpacity>
          </View>

          {Platform.OS === "ios" && pickerOpen && (
            <Modal visible animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
              <View style={styles.pickerOverlay}>
                <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
                  <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => setPickerOpen(false)} style={styles.pickerBtn}>
                      <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                    </TouchableOpacity>
                    <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Start Date</Text>
                    <TouchableOpacity onPress={confirmIOSPick} style={styles.pickerBtn}>
                      <Text style={[styles.pickerBtnText, { color: colors.primary, fontWeight: "700" }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={pickerDate}
                    mode="date"
                    display="spinner"
                    onChange={(_, d) => { if (d) setPickerDate(d); }}
                    minimumDate={new Date()}
                    themeVariant="dark"
                    style={{ width: "100%", height: 200 }}
                  />
                </View>
              </View>
            </Modal>
          )}

          {Platform.OS === "android" && pickerOpen && (
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display="default"
              onChange={handleAndroidPick}
              minimumDate={new Date()}
            />
          )}
        </>
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
                {data.poll.days.map((d) => {
                  const h = dayHeader(d);
                  return (
                    <View key={d} style={styles.dayHeaderCol}>
                      <Text style={[styles.dayHeader, { color: colors.mutedForeground }]}>
                        {h.top}
                      </Text>
                      {h.sub ? (
                        <Text style={[styles.dayHeaderSub, { color: colors.textDim }]}>
                          {h.sub}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
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
  dayHeaderCol: { flex: 1, alignItems: "center" },
  dayHeader: { textAlign: "center", fontSize: 11, fontWeight: "700" },
  dayHeaderSub: { textAlign: "center", fontSize: 10, fontWeight: "600", marginTop: 1 },
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
  setupLabel: { fontSize: 13, fontWeight: "700", marginTop: 22, marginBottom: 10 },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 14 },
  dateBtnText: { flex: 1, fontSize: 15, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 10 },
  chipText: { fontSize: 14, fontWeight: "700" },
  previewCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 22 },
  previewText: { fontSize: 15, fontWeight: "700" },
  pickerOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  pickerSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  pickerToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1 },
  pickerBtn: { padding: 8 },
  pickerBtnText: { fontSize: 15 },
  pickerTitle: { fontSize: 16, fontWeight: "700" },
});
