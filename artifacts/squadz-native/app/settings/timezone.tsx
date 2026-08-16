import { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useTimezone, runtimeTimezone, zoneLabel } from "@/context/TimezoneContext";
import { useToast } from "@/context/ToastContext";

/**
 * Full IANA zone list when the runtime exposes it (Hermes/modern browsers),
 * otherwise a curated fallback so the picker is never empty.
 */
const FALLBACK_ZONES = [
  "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver",
  "America/Phoenix", "America/Chicago", "America/New_York", "America/Toronto",
  "America/Mexico_City", "America/Bogota", "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
  "Atlantic/Reykjavik", "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Madrid",
  "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "Europe/Rome", "Europe/Stockholm",
  "Europe/Warsaw", "Europe/Athens", "Europe/Istanbul", "Europe/Moscow", "Africa/Lagos",
  "Africa/Cairo", "Africa/Nairobi", "Africa/Johannesburg", "Asia/Jerusalem", "Asia/Dubai",
  "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Jakarta",
  "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Perth", "Australia/Adelaide", "Australia/Brisbane", "Australia/Sydney",
  "Pacific/Auckland", "UTC",
];

function allZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported && supported.length > 0) return supported;
  } catch {
    // Runtime doesn't expose the zone table — fall through to the curated list.
  }
  return FALLBACK_ZONES;
}

export default function TimezoneScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { timezone, mode, setManualTimezone, useAutomaticTimezone } = useTimezone();
  const { showToast } = useToast();

  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const detected = runtimeTimezone();
  const zones = useMemo(() => allZones(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "_");
    if (!q) return zones;
    return zones.filter((z) => z.toLowerCase().includes(q));
  }, [query, zones]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/profile" as never);
  }, []);

  const pickAutomatic = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaving("__auto__");
    const ok = await useAutomaticTimezone();
    setSaving(null);
    showToast(ok ? `Automatic · ${zoneLabel(detected)}` : "Couldn't save your time zone. Try again.");
  }, [detected, showToast, useAutomaticTimezone]);

  const pickManual = useCallback(async (zone: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaving(zone);
    const ok = await setManualTimezone(zone);
    setSaving(null);
    showToast(ok ? `Times now shown in ${zoneLabel(zone)}` : "Couldn't save your time zone. Try again.");
  }, [setManualTimezone, showToast]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={goBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Time Zone</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Event times are shown in your time zone. Everyone still sees the same moment — just
          on their own clock.
        </Text>

        <View style={[styles.currentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.iconWrap, { backgroundColor: colors.primary + "20" }]}>
            <Ionicons name="globe-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.currentLabel, { color: colors.mutedForeground }]}>
              Showing times in
            </Text>
            <Text style={[styles.currentValue, { color: colors.foreground }]}>
              {zoneLabel(timezone)}
            </Text>
            <Text style={[styles.currentSub, { color: colors.mutedForeground }]}>
              {mode === "automatic" ? "Automatic · follows your device" : "Set manually"}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => void pickAutomatic()}
          disabled={saving !== null}
          style={[styles.autoRow, { backgroundColor: colors.card, borderColor: mode === "automatic" ? colors.primary : colors.border }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Automatic</Text>
            <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
              Follow this device · {zoneLabel(detected)}
            </Text>
          </View>
          {saving === "__auto__" ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : mode === "automatic" ? (
            <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
          ) : null}
        </TouchableOpacity>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          CHOOSE A TIME ZONE
        </Text>

        <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search cities or regions"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {filtered.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                No time zones match "{query.trim()}".
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered.slice(0, 300)}
              keyExtractor={(z) => z}
              scrollEnabled={false}
              initialNumToRender={25}
              ItemSeparatorComponent={() => (
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
              )}
              renderItem={({ item }) => {
                const selected = mode === "manual" && item === timezone;
                return (
                  <TouchableOpacity
                    onPress={() => void pickManual(item)}
                    disabled={saving !== null}
                    style={styles.row}
                  >
                    <Text style={[styles.rowLabel, { flex: 1, color: colors.foreground }]} numberOfLines={1}>
                      {zoneLabel(item)}
                    </Text>
                    {saving === item ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : selected ? (
                      <Ionicons name="checkmark" size={20} color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
        {filtered.length > 300 ? (
          <Text style={[styles.rowSub, { color: colors.mutedForeground, marginTop: 10, textAlign: "center" }]}>
            Showing the first 300 matches — search to narrow it down.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  hint: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  currentCard: { flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 },
  iconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  currentLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  currentValue: { fontSize: 16, fontWeight: "700", marginTop: 2 },
  currentSub: { fontSize: 12, marginTop: 2 },
  autoRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  sectionLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, marginTop: 28, marginBottom: 8, marginLeft: 4 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 42, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 15, ...(Platform.OS === "web" ? { outlineStyle: "none" as never } : null) },
  group: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  emptyRow: { padding: 16 },
  rowLabel: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 12, marginTop: 2 },
});
