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
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";
import { SQUADS } from "@/data/mock";

const EMOJIS = ["🔥", "🎉", "🎮", "🏖️", "🍕", "🎸", "⚽", "🎬", "🍻", "🎊"];

export default function CreateEventScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addEvent } = useData();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [selectedEmoji, setSelectedEmoji] = useState("🔥");

  const resetForm = () => {
    setTitle("");
    setLocation("");
    setDate("");
    setDescription("");
    setSelectedSquad(null);
    setSelectedEmoji("🔥");
  };

  const handleCreate = () => {
    if (!title.trim()) {
      Alert.alert("Missing info", "Please add an event title.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const id = addEvent({
      title: title.trim(),
      emoji: selectedEmoji,
      date: date.trim(),
      location: location.trim(),
      description: description.trim(),
      squadId: selectedSquad,
    });
    Alert.alert("Event created!", `${selectedEmoji} ${title} has been created. Your squad will be notified.`, [
      { text: "View Event", style: "default", onPress: () => { resetForm(); router.push(`/event/${id}` as never); } },
    ]);
  };

  const Field = ({ icon, placeholder, value, onChangeText, keyboardType = "default" }: {
    icon: keyof typeof Ionicons.glyphMap;
    placeholder: string;
    value: string;
    onChangeText: (v: string) => void;
    keyboardType?: "default" | "email-address" | "decimal-pad";
  }) => (
    <View style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon} size={20} color={colors.mutedForeground} />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
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
        contentContainerStyle={{ paddingBottom: botPad + 120 }}
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
                  {
                    backgroundColor: selectedEmoji === e ? colors.primary + "25" : colors.card,
                    borderColor: selectedEmoji === e ? colors.primary : colors.border,
                  },
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
          <Field
            icon="text-outline"
            placeholder="What are you planning?"
            value={title}
            onChangeText={setTitle}
          />
        </View>

        {/* Date & time */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Date & time</Text>
          <Field
            icon="calendar-outline"
            placeholder="e.g. Sat, Jun 7 · 5:00 PM"
            value={date}
            onChangeText={setDate}
          />
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Location</Text>
          <Field
            icon="location-outline"
            placeholder="Where is it happening?"
            value={location}
            onChangeText={setLocation}
          />
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
            {SQUADS.map((s) => (
              <TouchableOpacity
                key={s.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedSquad(s.id); }}
                style={[
                  styles.squadOption,
                  {
                    backgroundColor: selectedSquad === s.id ? colors.primary + "15" : colors.card,
                    borderColor: selectedSquad === s.id ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={styles.squadOptionEmoji}>{s.emoji}</Text>
                <View style={styles.squadOptionBody}>
                  <Text style={[styles.squadOptionName, { color: colors.foreground }]}>{s.name}</Text>
                  <Text style={[styles.squadOptionCount, { color: colors.mutedForeground }]}>
                    {s.memberIds.length} members
                  </Text>
                </View>
                {selectedSquad === s.id && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 12, backgroundColor: colors.background }]}>
        <TouchableOpacity
          onPress={handleCreate}
          style={[styles.createBtn, { backgroundColor: title.trim() ? colors.primary : colors.border }]}
        >
          <Ionicons name="add-circle-outline" size={20} color={title.trim() ? "#fff" : colors.textDim} />
          <Text style={[styles.createBtnText, { color: title.trim() ? "#fff" : colors.textDim }]}>
            Create Event
          </Text>
        </TouchableOpacity>
      </View>
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
  squadList: { gap: 8 },
  squadOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, padding: 12,
  },
  squadOptionEmoji: { fontSize: 22 },
  squadOptionBody: { flex: 1 },
  squadOptionName: { fontSize: 14, fontWeight: "700" },
  squadOptionCount: { fontSize: 12 },
  bottomBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  createBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, padding: 15 },
  createBtnText: { fontSize: 16, fontWeight: "800" },
});
