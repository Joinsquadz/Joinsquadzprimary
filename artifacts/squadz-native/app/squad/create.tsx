import { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Switch,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData, SquadLimitError } from "@/context/AppContext";
import { UpgradeModal } from "@/components/UpgradeModal";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { IconPicker } from "@/components/IconPicker";

const COLORS = ["#FF5C3A", "#4A9EFF", "#2ECC8A", "#A855F7", "#FFB547", "#FF6B9D"];
const CATEGORIES = [
  { label: "Roommates", emoji: "🏠", name: "The Roommates" },
  { label: "Gaming", emoji: "🎮", name: "Game Night Crew" },
  { label: "Foodies", emoji: "🍕", name: "The Foodies" },
  { label: "Sports", emoji: "⚽", name: "Weekend Warriors" },
  { label: "Travel", emoji: "🏖️", name: "Travel Squad" },
  { label: "Coworkers", emoji: "💼", name: "The Coworkers" },
];

export default function CreateSquadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addSquad } = useData();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("🔥");
  const [color, setColor] = useState(COLORS[0]);
  const [isPublic, setIsPublic] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  const pickCategory = (cat: (typeof CATEGORIES)[number]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEmoji(cat.emoji);
    // Only suggest a name when the user hasn't typed one yet.
    setName((prev) => (prev.trim() ? prev : cat.name));
  };

  const handleCreate = async () => {
    if (inFlightRef.current) return;
    if (!name.trim()) {
      Alert.alert("Missing info", "Give your squad a name.");
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    const desc = description.trim();
    try {
      const id = await addSquad({ name: name.trim(), description: desc || undefined, emoji, color, isPublic });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/squad/${id}` as never);
    } catch (err) {
      inFlightRef.current = false;
      setSubmitting(false);
      if (err instanceof SquadLimitError) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setShowUpgrade(true);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't create squad", "Something went wrong. Please try again.");
    }
  };

  const canCreate = !!name.trim() && !submitting;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never))}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>New Squad</Text>
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.body}
        contentContainerStyle={{ paddingBottom: botPad + 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Preview */}
        <View style={styles.previewWrap}>
          <View style={[styles.previewIcon, { backgroundColor: color + "25", borderColor: color }]}>
            <Text style={styles.previewEmoji}>{emoji}</Text>
          </View>
          <Text style={[styles.previewName, { color: name.trim() ? colors.foreground : colors.textDim }]}>
            {name.trim() || "Your squad name"}
          </Text>
        </View>

        {/* Quick start categories */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Quick start</Text>
          <View style={styles.catGrid}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.label}
                onPress={() => pickCategory(cat)}
                style={[styles.catChip, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={styles.catEmoji}>{cat.emoji}</Text>
                <Text style={[styles.catLabel, { color: colors.foreground }]}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Name */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Squad name</Text>
          <View style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="people-outline" size={20} color={colors.mutedForeground} />
            <TextInput
              placeholder="Name your squad"
              placeholderTextColor={colors.textDim}
              value={name}
              onChangeText={setName}
              style={[styles.fieldInput, { color: colors.foreground }]}
            />
          </View>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>About this squad</Text>
          <View style={[styles.textArea, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              placeholder="What's this squad about? (optional)"
              placeholderTextColor={colors.textDim}
              value={description}
              onChangeText={(t) => t.length <= 280 && setDescription(t)}
              style={[styles.textAreaInput, { color: colors.foreground }]}
              multiline
              maxLength={280}
            />
          </View>
          <Text style={[styles.charCount, { color: colors.textDim }]}>{description.length}/280</Text>
        </View>

        {/* Emoji */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Squad icon</Text>
          <IconPicker value={emoji} onChange={setEmoji} accent={color} />
        </View>

        {/* Color */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Squad color</Text>
          <View style={styles.colorRow}>
            {COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setColor(c); }}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: c, borderWidth: color === c ? 3 : 0, borderColor: "#fff" },
                ]}
              />
            ))}
          </View>
        </View>

        {/* Visibility */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Visibility</Text>
          <View style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons
              name={isPublic ? "earth-outline" : "lock-closed-outline"}
              size={20}
              color={isPublic ? color : colors.mutedForeground}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleTitle, { color: colors.foreground }]}>Make this squad public</Text>
              <Text style={[styles.toggleSub, { color: colors.mutedForeground }]}>
                {isPublic ? "Anyone can discover and join" : "Invite-only — members must be added manually"}
              </Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsPublic(v); }}
              trackColor={{ false: colors.border, true: color }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 12, backgroundColor: colors.background }]}>
        <TouchableOpacity
          onPress={handleCreate}
          disabled={!canCreate}
          style={[styles.createBtn, { backgroundColor: canCreate ? colors.primary : colors.border }]}
        >
          <Ionicons name="add-circle-outline" size={20} color={canCreate ? "#fff" : colors.textDim} />
          <Text style={[styles.createBtnText, { color: canCreate ? "#fff" : colors.textDim }]}>
            {submitting ? "Creating…" : "Create Squad"}
          </Text>
        </TouchableOpacity>
      </View>

      <UpgradeModal
        visible={showUpgrade}
        trigger="squad_limit"
        onClose={() => setShowUpgrade(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { padding: 8 },
  title: { fontSize: 28, fontWeight: "900" },
  body: { flex: 1, paddingHorizontal: 20 },
  previewWrap: { alignItems: "center", paddingTop: 24, gap: 12 },
  previewIcon: { width: 88, height: 88, borderRadius: 26, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  previewEmoji: { fontSize: 40 },
  previewName: { fontSize: 20, fontWeight: "800" },
  section: { paddingTop: 24 },
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  catEmoji: { fontSize: 16 },
  catLabel: { fontSize: 13, fontWeight: "700" },
  field: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, height: 52,
  },
  fieldInput: { flex: 1, fontSize: 15 },
  textArea: { borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, minHeight: 80 },
  textAreaInput: { fontSize: 15, minHeight: 56, textAlignVertical: "top" },
  charCount: { fontSize: 11, textAlign: "right", marginTop: 6 },
  colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  colorSwatch: { width: 48, height: 48, borderRadius: 24 },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, padding: 14,
  },
  toggleTitle: { fontSize: 15, fontWeight: "700" },
  toggleSub: { fontSize: 12, marginTop: 2 },
  bottomBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  createBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, padding: 15 },
  createBtnText: { fontSize: 16, fontWeight: "800" },
});
