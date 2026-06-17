import { useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { EMOJI_CATEGORIES, CURATED_EMOJIS } from "@/constants/emojis";

interface IconPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  /** Accent color for the selected state (defaults to the brand primary). */
  accent?: string;
}

/**
 * Compact icon picker used on the squad/event create screens.
 *
 * Shows 8 curated quick picks inline (plus the current selection if it isn't
 * one of them), with a "More" tile that opens a searchable, categorized bottom
 * sheet covering the full icon set. Keeps the create form calm while leaving
 * the whole library one tap away.
 */
export function IconPicker({ value, onChange, accent }: IconPickerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const tint = accent ?? colors.primary;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Quick-pick row: if the selected icon isn't curated, surface it first so the
  // user always sees their current choice without opening the sheet.
  const row = useMemo(() => {
    if (CURATED_EMOJIS.includes(value)) return CURATED_EMOJIS;
    return [value, ...CURATED_EMOJIS.slice(0, CURATED_EMOJIS.length - 1)];
  }, [value]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return EMOJI_CATEGORIES;
    return EMOJI_CATEGORIES.map((cat) => ({
      label: cat.label,
      items: cat.items.filter((it) => it.keywords.includes(q) || it.emoji === q),
    })).filter((cat) => cat.items.length > 0);
  }, [q]);

  const quickSelect = (e: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(e);
  };

  const sheetSelect = (e: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(e);
    setOpen(false);
    setQuery("");
  };

  const openSheet = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(true);
  };

  const closeSheet = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <View style={styles.row}>
        {row.map((e) => {
          const active = value === e;
          return (
            <TouchableOpacity
              key={e}
              onPress={() => quickSelect(e)}
              style={[
                styles.tile,
                {
                  backgroundColor: active ? tint + "25" : colors.card,
                  borderColor: active ? tint : colors.border,
                  borderWidth: active ? 2 : 1,
                },
              ]}
            >
              <Text style={styles.tileEmoji}>{e}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          onPress={openSheet}
          style={[styles.moreTile, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          accessibilityLabel="Browse all icons"
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.mutedForeground} />
          <Text style={[styles.moreText, { color: colors.mutedForeground }]}>More</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={closeSheet}>
        <View style={styles.overlay}>
          {/* Tap-away to dismiss */}
          <TouchableOpacity style={styles.overlayTap} activeOpacity={1} onPress={closeSheet} />
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 12 }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Choose an icon</Text>
              <TouchableOpacity
                onPress={closeSheet}
                style={[styles.closeBtn, { backgroundColor: colors.card }]}
                accessibilityLabel="Close"
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.searchField,
                { backgroundColor: colors.background, borderColor: q ? tint : colors.border },
              ]}
            >
              <Ionicons name="search" size={16} color={colors.textDim} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search icons… (try “ball”, “food”, “gym”)"
                placeholderTextColor={colors.textDim}
                style={[styles.searchInput, { color: colors.foreground }]}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.textDim} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 }}
            >
              {filtered.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.textDim }]}>No icons match “{query}”.</Text>
              ) : (
                filtered.map((cat) => (
                  <View key={cat.label} style={{ marginBottom: 18 }}>
                    <Text style={[styles.catLabel, { color: colors.mutedForeground }]}>{cat.label}</Text>
                    <View style={styles.grid}>
                      {cat.items.map((it) => {
                        const active = value === it.emoji;
                        return (
                          <TouchableOpacity
                            key={it.emoji}
                            onPress={() => sheetSelect(it.emoji)}
                            style={[
                              styles.tile,
                              {
                                backgroundColor: active ? tint + "25" : colors.card,
                                borderColor: active ? tint : colors.border,
                                borderWidth: active ? 2 : 1,
                              },
                            ]}
                          >
                            <Text style={styles.tileEmoji}>{it.emoji}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tileEmoji: { fontSize: 24 },
  moreTile: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  moreText: { fontSize: 10, fontWeight: "700" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  overlayTap: { ...StyleSheet.absoluteFillObject },
  card: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    maxHeight: "82%",
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontWeight: "800" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    height: 46,
  },
  searchInput: { flex: 1, fontSize: 15 },
  catLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  emptyText: { textAlign: "center", fontSize: 14, marginTop: 32 },
});
