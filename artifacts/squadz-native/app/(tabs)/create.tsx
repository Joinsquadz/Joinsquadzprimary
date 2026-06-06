import { useState } from "react";
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
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";

const EMOJIS = ["🔥", "🎉", "🎮", "🏖️", "🍕", "🎸", "⚽", "🎬", "🍻", "🎊"];
const TAB_BAR_H = Platform.select({ ios: 49, android: 56, default: 49 }) ?? 49;

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
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + TAB_BAR_H;

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [selectedEmoji, setSelectedEmoji] = useState("🔥");

  // Date picker state
  const [pickerDate, setPickerDate] = useState(new Date());
  const [pickerStep, setPickerStep] = useState<"date" | "time" | null>(null);

  const resetForm = () => {
    setTitle(""); setLocation(""); setDate(""); setDescription("");
    setSelectedSquad(null); setSelectedEmoji("🔥");
    setPickerDate(new Date());
  };

  const handleCreate = () => {
    if (!title.trim()) {
      Alert.alert("Missing info", "Please add an event title.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const id = addEvent({
      title: title.trim(), emoji: selectedEmoji,
      date: date.trim(), location: location.trim(),
      description: description.trim(), squadId: selectedSquad,
    });
    Alert.alert("Event created!", `${selectedEmoji} ${title} has been created. Your squad will be notified.`, [
      { text: "View Event", onPress: () => { resetForm(); router.push(`/event/${id}` as never); } },
    ]);
  };

  // ── Date picker logic ──────────────────────────────────────
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
      // auto-advance to time
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

  // ── Field component ────────────────────────────────────────
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

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: botPad + 80 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Emoji picker */}
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

        {/* Event name */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Event name</Text>
          <Field icon="text-outline" placeholder="What are you planning?" value={title} onChangeText={setTitle} />
        </View>

        {/* Date & time — native picker */}
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
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Location</Text>
          <Field icon="location-outline" placeholder="Where is it happening?" value={location} onChangeText={setLocation} />
        </View>

        {/* Description */}
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

        {/* Squad picker */}
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

      {/* Create button */}
      <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 8, backgroundColor: colors.background }]}>
        <TouchableOpacity
          onPress={handleCreate}
          disabled={!title.trim()}
          activeOpacity={0.9}
          style={styles.createBtnWrap}
        >
          {title.trim() ? (
            <LinearGradient colors={["#FF5C3A", "#FF8050"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.createBtn}>
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={[styles.createBtnText, { color: "#fff" }]}>Create Event</Text>
            </LinearGradient>
          ) : (
            <View style={[styles.createBtn, { backgroundColor: colors.card }]}>
              <Ionicons name="add-circle-outline" size={20} color={colors.textDim} />
              <Text style={[styles.createBtnText, { color: colors.textDim }]}>Add a title to continue</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── iOS date/time picker modal ── */}
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

      {/* ── Android date/time picker (native dialog, no modal needed) ── */}
      {Platform.OS === "android" && pickerStep !== null && (
        <DateTimePicker
          value={pickerDate}
          mode={pickerStep}
          display="default"
          onChange={handleAndroidChange}
          minimumDate={new Date()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontSize: 28, fontWeight: "900" },
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
  // Picker modal
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  pickerToolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  pickerBtn: { minWidth: 60 },
  pickerBtnText: { fontSize: 16 },
  pickerTitle: { fontSize: 16, fontWeight: "700" },
});
