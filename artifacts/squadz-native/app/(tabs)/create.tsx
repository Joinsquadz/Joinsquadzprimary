import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Modal,
  Switch,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth } from "@/context/AppContext";
import { startProCheckout } from "@/lib/checkout";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { TAB_BAR_HEIGHT } from "@/constants/layout";

const EMOJIS = ["🔥", "🎉", "🎮", "🏖️", "🍕", "🎸", "⚽", "🎬", "🍻", "🎊"];
const TAB_BAR_H = TAB_BAR_HEIGHT;
const FREE_EVENT_LIMIT = 3;

function formatPickedDate(d: Date): string {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const mm = m.toString().padStart(2, "0");
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} · ${h12}:${mm} ${ampm}`;
}

export default function CreateEventScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addEvent, squads } = useData();
  const { authToken } = useAuth();
  const prefill = useLocalSearchParams<{ prefillDate?: string; prefillSquad?: string; prefillTitle?: string; prefillEmoji?: string }>();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + TAB_BAR_H;

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [selectedEmoji, setSelectedEmoji] = useState("🔥");

  const [isPublic, setIsPublic] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [myEventCount, setMyEventCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const atLimit = !isPro && myEventCount >= FREE_EVENT_LIMIT;

  const authHeaders = useCallback((): HeadersInit => {
    return buildAuthHeaders(authToken);
  }, [authToken]);

  useEffect(() => {
    fetch(`${API_BASE}/api/subscription`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { isPro: false })
      .then((data: { isPro?: boolean }) => setIsPro(data.isPro ?? false))
      .catch(() => setIsPro(false));
  }, [authHeaders]);

  useEffect(() => {
    fetch(`${API_BASE}/api/events/count`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then((data: { count: number } | null) => { if (data) setMyEventCount(data.count); })
      .catch(() => {});
  }, [authHeaders]);

  const [pickerDate, setPickerDate] = useState(new Date());
  const [pickerStep, setPickerStep] = useState<"date" | "time" | null>(null);

  // Apply a time / squad chosen via the "Find the Best Time" picker, or a
  // title / emoji passed from an AI suggestion on the Home screen.
  useEffect(() => {
    if (prefill.prefillDate) setDate(prefill.prefillDate);
    if (prefill.prefillSquad) setSelectedSquad(prefill.prefillSquad);
    if (prefill.prefillTitle) setTitle(prefill.prefillTitle);
    if (prefill.prefillEmoji) setSelectedEmoji(prefill.prefillEmoji);
  }, [prefill.prefillDate, prefill.prefillSquad, prefill.prefillTitle, prefill.prefillEmoji]);

  const resetForm = () => {
    setTitle(""); setLocation(""); setDate(""); setDescription("");
    setSelectedSquad(null); setSelectedEmoji("🔥");
    setPickerDate(new Date());
  };

  const handleCreate = async () => {
    setCreateError(null);
    if (!title.trim()) {
      setCreateError("Please add an event title.");
      return;
    }
    if (atLimit) {
      setShowUpgradeModal(true);
      return;
    }
    setCreating(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const id = await addEvent({
        title: title.trim(), emoji: selectedEmoji,
        date: date.trim(), location: location.trim(),
        description: description.trim(), squadId: selectedSquad,
        isPublic,
      });
      fetch(`${API_BASE}/api/events/count`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : null)
        .then((data: { count: number } | null) => { if (data) setMyEventCount(data.count); })
        .catch(() => {});
      resetForm();
      router.push(`/event/${id}` as never);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create event. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const openDatePicker = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerStep("date");
  };

  const handleIOSConfirm = () => {
    if (pickerStep === "date") {
      setPickerStep("time");
    } else {
      setDate(formatPickedDate(pickerDate));
      setPickerStep(null);
    }
  };

  const handleAndroidChange = (_: DateTimePickerEvent, d?: Date) => {
    if (!d) { setPickerStep(null); return; }
    const updated = new Date(pickerDate);
    if (pickerStep === "date") {
      updated.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      setPickerDate(updated);
      setTimeout(() => setPickerStep("time"), 50);
    } else {
      updated.setHours(d.getHours(), d.getMinutes());
      setPickerDate(updated);
      setDate(formatPickedDate(updated));
      setPickerStep(null);
    }
  };

  const clearDate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDate("");
    setPickerDate(new Date());
  };

  async function handleUpgrade() {
    setUpgradeLoading(true);
    const result = await startProCheckout(authToken);
    if (result.ok) {
      setShowUpgradeModal(false);
    } else {
      Alert.alert("Checkout Error", result.error);
    }
    setUpgradeLoading(false);
  }

  const Field = ({ icon, placeholder, value, onChangeText }: {
    icon: keyof typeof Ionicons.glyphMap;
    placeholder: string;
    value: string;
    onChangeText: (v: string) => void;
  }) => (
    <View style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon} size={20} color={colors.mutedForeground} />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        value={value}
        onChangeText={onChangeText}
        style={[styles.fieldInput, { color: colors.foreground }]}
      />
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>New Event</Text>
      </View>

      {atLimit && (
        <View style={[styles.limitBanner, { backgroundColor: colors.primary + "18", borderBottomColor: colors.primary + "40" }]}>
          <Ionicons name="flash" size={14} color={colors.primary} />
          <Text style={[styles.limitBannerText, { color: colors.primary }]}>
            Free plan: {myEventCount}/{FREE_EVENT_LIMIT} events used — upgrade for unlimited
          </Text>
          <TouchableOpacity onPress={() => setShowUpgradeModal(true)} style={[styles.limitBannerBtn, { borderColor: colors.primary + "60" }]}>
            <Text style={[styles.limitBannerBtnText, { color: colors.primary }]}>Upgrade</Text>
          </TouchableOpacity>
        </View>
      )}

      {createError && (
        <View style={[styles.limitBanner, { backgroundColor: "#FF3B3018", borderBottomColor: "#FF3B3040" }]}>
          <Ionicons name="alert-circle-outline" size={14} color="#FF3B30" />
          <Text style={[styles.limitBannerText, { color: "#FF3B30", flex: 1 }]}>{createError}</Text>
          <TouchableOpacity onPress={() => setCreateError(null)}>
            <Ionicons name="close" size={16} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: botPad + 80 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Event icon</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {EMOJIS.map((e) => (
              <TouchableOpacity
                key={e}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedEmoji(e); }}
                style={[
                  styles.emojiOption,
                  { backgroundColor: selectedEmoji === e ? colors.primary + "25" : colors.card, borderColor: selectedEmoji === e ? colors.primary : colors.border },
                ]}
              >
                <Text style={styles.emojiText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Event name</Text>
          <Field icon="text-outline" placeholder="What are you planning?" value={title} onChangeText={setTitle} />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Date & time</Text>
          {Platform.OS === "web" ? (
            <Field icon="calendar-outline" placeholder="e.g. Sat, Jun 7 · 5:00 PM" value={date} onChangeText={setDate} />
          ) : date ? (
            <View style={[styles.dateDisplay, { backgroundColor: colors.card, borderColor: colors.primary }]}>
              <Ionicons name="calendar" size={20} color={colors.primary} />
              <Text style={[styles.dateText, { color: colors.foreground }]}>{date}</Text>
              <TouchableOpacity onPress={openDatePicker} style={[styles.editDateBtn, { borderColor: colors.border }]}>
                <Text style={[styles.editDateText, { color: colors.mutedForeground }]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={clearDate}>
                <Ionicons name="close-circle" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={openDatePicker}
              style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.mutedForeground} />
              <Text style={[styles.dateBtnText, { color: colors.textDim }]}>Tap to select date & time</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (!selectedSquad) {
                Alert.alert("Pick a squad first", "Choose a squad below so we can poll everyone's availability.");
                return;
              }
              router.push({ pathname: "/availability", params: { squadId: selectedSquad, from: "create" } } as never);
            }}
            style={[styles.bestTimeBtn, { borderColor: colors.primary + "55", backgroundColor: colors.primary + "10" }]}
          >
            <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
            <Text style={[styles.bestTimeText, { color: colors.primary }]}>Find the best time with your squad</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Location</Text>
          <Field icon="location-outline" placeholder="Where is it happening?" value={location} onChangeText={setLocation} />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Description</Text>
          <View style={[styles.field, styles.fieldMultiline, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="document-text-outline" size={20} color={colors.mutedForeground} style={{ marginTop: 2 }} />
            <TextInput
              placeholder="What's the plan? (optional)"
              placeholderTextColor={colors.textDim}
              value={description}
              onChangeText={setDescription}
              multiline
              style={[styles.fieldInput, { color: colors.foreground, height: 80, textAlignVertical: "top", paddingTop: 2 }]}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Visibility</Text>
          <View style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons
              name={isPublic ? "earth-outline" : "lock-closed-outline"}
              size={20}
              color={isPublic ? colors.primary : colors.mutedForeground}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleTitle, { color: colors.foreground }]}>Make this event public</Text>
              <Text style={[styles.toggleSub, { color: colors.mutedForeground }]}>
                {isPublic ? "Anyone can discover and join" : "Invite-only — only people with the link can join"}
              </Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsPublic(v); }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Squad</Text>
          <View style={styles.squadList}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/create"); }}
              style={[styles.newSquadRow, { borderColor: colors.primary + "50" }]}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={[styles.newSquadText, { color: colors.primary }]}>New squad</Text>
            </TouchableOpacity>
            {squads.map((s) => (
              <TouchableOpacity
                key={s.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedSquad(s.id === selectedSquad ? null : s.id); }}
                style={[
                  styles.squadOption,
                  { backgroundColor: selectedSquad === s.id ? colors.primary + "15" : colors.card, borderColor: selectedSquad === s.id ? colors.primary : colors.border },
                ]}
              >
                <Text style={styles.squadOptionEmoji}>{s.emoji}</Text>
                <View style={styles.squadOptionBody}>
                  <Text style={[styles.squadOptionName, { color: colors.foreground }]}>{s.name}</Text>
                  <Text style={[styles.squadOptionCount, { color: colors.mutedForeground }]}>{s.memberIds.length} members</Text>
                </View>
                {selectedSquad === s.id && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 8, backgroundColor: colors.background }]}>
        <TouchableOpacity
          onPress={handleCreate}
          disabled={!title.trim() || creating}
          activeOpacity={0.9}
          style={styles.createBtnWrap}
        >
          {title.trim() ? (
            <LinearGradient
              colors={atLimit ? ["#FF5C3A", "#FF8050"] : ["#FF5C3A", "#FF8050"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={[styles.createBtn, creating && { opacity: 0.7 }]}
            >
              <Ionicons name={creating ? "hourglass-outline" : atLimit ? "lock-closed" : "add-circle-outline"} size={20} color="#fff" />
              <Text style={[styles.createBtnText, { color: "#fff" }]}>
                {creating ? "Creating…" : atLimit ? "Upgrade to Create Event" : "Create Event"}
              </Text>
            </LinearGradient>
          ) : (
            <View style={[styles.createBtn, { backgroundColor: colors.card }]}>
              <Ionicons name="add-circle-outline" size={20} color={colors.textDim} />
              <Text style={[styles.createBtnText, { color: colors.textDim }]}>Add a title to continue</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {Platform.OS === "ios" && pickerStep !== null && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setPickerStep(null)}>
          <View style={styles.pickerOverlay}>
            <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
              <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => setPickerStep(null)} style={styles.pickerBtn}>
                  <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                </TouchableOpacity>
                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
                  {pickerStep === "date" ? "Select Date" : "Select Time"}
                </Text>
                <TouchableOpacity onPress={handleIOSConfirm} style={styles.pickerBtn}>
                  <Text style={[styles.pickerBtnText, { color: colors.primary, fontWeight: "700" }]}>
                    {pickerStep === "date" ? "Next →" : "Done"}
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerDate}
                mode={pickerStep}
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

      {Platform.OS === "android" && pickerStep !== null && (
        <DateTimePicker
          value={pickerDate}
          mode={pickerStep}
          display="default"
          onChange={handleAndroidChange}
          minimumDate={new Date()}
        />
      )}

      <Modal visible={showUpgradeModal} animationType="slide" transparent onRequestClose={() => setShowUpgradeModal(false)}>
        <View style={styles.upgradeOverlay}>
          <View style={[styles.upgradeSheet, { backgroundColor: colors.card }]}>
            <View style={[styles.upgradeIconWrap, { backgroundColor: colors.primary + "22" }]}>
              <Text style={styles.upgradeIcon}>🎉</Text>
            </View>
            <Text style={[styles.upgradeTitle, { color: colors.foreground }]}>You're on a roll!</Text>
            <Text style={[styles.upgradeBody, { color: colors.mutedForeground }]}>
              You've planned {myEventCount} events this year — the free plan limit. Upgrade to keep the momentum going with unlimited events.
            </Text>

            <View style={[styles.upgradePriceBadge, { borderColor: colors.primary + "40", backgroundColor: colors.primary + "12" }]}>
              <Text style={[styles.upgradePriceAmount, { color: colors.foreground }]}>$20</Text>
              <Text style={[styles.upgradePriceSub, { color: colors.mutedForeground }]}>per year · less than $2/month · cancel anytime</Text>
            </View>

            {[
              "Unlimited events per year",
              "Permanent photo vault",
              "Calendar sync & AI best-time finder",
              "Custom invite codes",
              "Priority support",
            ].map(f => (
              <View key={f} style={styles.upgradeFeatureRow}>
                <View style={[styles.upgradeCheck, { backgroundColor: "#2ECC8A" }]}>
                  <Text style={styles.upgradeCheckText}>✓</Text>
                </View>
                <Text style={[styles.upgradeFeatureText, { color: colors.foreground }]}>{f}</Text>
              </View>
            ))}

            <TouchableOpacity
              onPress={handleUpgrade}
              disabled={upgradeLoading}
              activeOpacity={0.9}
              style={styles.upgradeCtaWrap}
            >
              <LinearGradient colors={["#FF5C3A", "#FF8050"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.upgradeCta}>
                <Text style={styles.upgradeCtaText}>
                  {upgradeLoading ? "Opening checkout…" : "Upgrade to Pro — $20/year →"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowUpgradeModal(false)} style={styles.upgradeDismiss}>
              <Text style={[styles.upgradeDismissText, { color: colors.textDim }]}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontSize: 28, fontWeight: "900" },
  limitBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1,
  },
  limitBannerText: { flex: 1, fontSize: 12, fontWeight: "600" },
  limitBannerBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  limitBannerBtnText: { fontSize: 11, fontWeight: "700" },
  body: { flex: 1, paddingHorizontal: 20 },
  section: { paddingTop: 20 },
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  field: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, height: 52,
  },
  fieldInput: { flex: 1, fontSize: 15 },
  fieldMultiline: { height: undefined, alignItems: "flex-start", paddingVertical: 12 },
  emojiOption: { width: 52, height: 52, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  emojiText: { fontSize: 24 },
  dateBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, height: 52,
  },
  dateBtnText: { flex: 1, fontSize: 15 },
  dateDisplay: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12,
  },
  dateText: { flex: 1, fontSize: 15, fontWeight: "600" },
  editDateBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  editDateText: { fontSize: 12 },
  bestTimeBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 11, marginTop: 10 },
  bestTimeText: { flex: 1, fontSize: 14, fontWeight: "700" },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, padding: 14,
  },
  toggleTitle: { fontSize: 15, fontWeight: "700" },
  toggleSub: { fontSize: 12, marginTop: 2 },
  squadList: { gap: 8 },
  newSquadRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 13, borderWidth: 1.5, borderStyle: "dashed", padding: 14 },
  newSquadText: { fontSize: 14, fontWeight: "700" },
  squadOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, padding: 12,
  },
  squadOptionEmoji: { fontSize: 22 },
  squadOptionBody: { flex: 1 },
  squadOptionName: { fontSize: 14, fontWeight: "700" },
  squadOptionCount: { fontSize: 12 },
  bottomBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  createBtnWrap: { borderRadius: 15, overflow: "hidden" },
  createBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 15, paddingVertical: 15 },
  createBtnText: { fontSize: 16, fontWeight: "800" },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  pickerToolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  pickerBtn: { minWidth: 60 },
  pickerBtnText: { fontSize: 16 },
  pickerTitle: { fontSize: 16, fontWeight: "700" },
  upgradeOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.78)", justifyContent: "flex-end" },
  upgradeSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 44 },
  upgradeIconWrap: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  upgradeIcon: { fontSize: 28 },
  upgradeTitle: { fontSize: 22, fontWeight: "800", marginBottom: 8 },
  upgradeBody: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  upgradePriceBadge: { borderWidth: 1.5, borderRadius: 16, padding: 16, alignItems: "center", marginBottom: 18 },
  upgradePriceAmount: { fontSize: 40, fontWeight: "900", lineHeight: 44 },
  upgradePriceSub: { fontSize: 13, marginTop: 2 },
  upgradeFeatureRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  upgradeCheck: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  upgradeCheckText: { fontSize: 11, color: "#000", fontWeight: "900" },
  upgradeFeatureText: { fontSize: 14 },
  upgradeCtaWrap: { borderRadius: 14, overflow: "hidden", marginTop: 6, marginBottom: 10 },
  upgradeCta: { paddingVertical: 15, alignItems: "center" },
  upgradeCtaText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  upgradeDismiss: { alignItems: "center", paddingVertical: 8 },
  upgradeDismissText: { fontSize: 13 },
});
