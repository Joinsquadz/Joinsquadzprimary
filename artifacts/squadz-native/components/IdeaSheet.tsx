import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import type { IdeaCategory, PlanIdea } from "@/types";
import { IDEA_CATEGORIES, IDEA_CATEGORY_META } from "@/lib/ideaUtils";
import type { IdeaPatch, NewIdeaInput } from "@/lib/ideas";
import { formatDayHeading } from "@/lib/tripUtils";

type IdeaDraft = {
  title: string;
  description: string;
  category: IdeaCategory;
  linkUrl: string;
  cost: string;
  suggestedDate: string | null;
};

function emptyDraft(defaultDay: string | null): IdeaDraft {
  return { title: "", description: "", category: "activity", linkUrl: "", cost: "", suggestedDate: defaultDay };
}

/**
 * Bottom-sheet form for suggesting or editing a plan idea. Modeled on
 * StopSheet: a single Modal with chip pickers only (no nested Modals — iOS
 * freezes on stacked Modals). Day + category pickers only render for trips.
 */
export function IdeaSheet({
  visible,
  dayKeys,
  defaultDay = null,
  isTrip,
  editing,
  saving,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  /** Trip day keys for the "Which day?" chips; empty for plain events. */
  dayKeys: string[];
  /** Preselected day when opened from a day section (null = General). */
  defaultDay?: string | null;
  /** Trips get category + day pickers; events are simple title-first ideas. */
  isTrip: boolean;
  editing: PlanIdea | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: NewIdeaInput | IdeaPatch, isEdit: boolean) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<IdeaDraft>(emptyDraft(defaultDay));
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setShowMore(!!editing);
    if (editing) {
      setDraft({
        title: editing.title ?? "",
        description: editing.description ?? "",
        category: editing.category,
        linkUrl: editing.linkUrl ?? "",
        cost: typeof editing.estimatedCost === "number" ? String(editing.estimatedCost) : "",
        suggestedDate: editing.suggestedDate,
      });
    } else {
      setDraft(emptyDraft(defaultDay));
    }
  }, [visible, editing, defaultDay]);

  const submit = () => {
    if (!draft.title.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const parsedCost = draft.cost.trim() ? Number(draft.cost.replace(/[^0-9.]/g, "")) : null;
    const payload: NewIdeaInput = {
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      category: isTrip ? draft.category : undefined,
      linkUrl: draft.linkUrl.trim() || undefined,
      estimatedCost: parsedCost !== null && !Number.isNaN(parsedCost) ? parsedCost : null,
      suggestedDate: isTrip ? draft.suggestedDate : undefined,
    };
    onSubmit(payload, !!editing);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, maxHeight: "88%" }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.headRow}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {editing ? "Edit idea" : "Suggest an idea"}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.label, { color: colors.mutedForeground }]}>What's the idea?</Text>
            <TextInput
              value={draft.title}
              onChangeText={(t) => setDraft((d) => ({ ...d, title: t }))}
              placeholder="e.g. Sunset kayak tour"
              placeholderTextColor={colors.textDim}
              maxLength={100}
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              autoFocus={!editing}
            />

            {isTrip ? (
              <>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Category</Text>
                <View style={styles.catRow}>
                  {IDEA_CATEGORIES.map((cat) => {
                    const meta = IDEA_CATEGORY_META[cat];
                    const active = draft.category === cat;
                    const tint = colors[meta.colorKey];
                    return (
                      <TouchableOpacity
                        key={cat}
                        onPress={() => setDraft((d) => ({ ...d, category: cat }))}
                        style={[styles.catChip, { borderColor: active ? tint : colors.border, backgroundColor: active ? tint + "1F" : colors.background }]}
                      >
                        <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={15} color={active ? tint : colors.mutedForeground} />
                        <Text style={[styles.catChipText, { color: active ? tint : colors.mutedForeground }]}>{meta.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {dayKeys.length > 0 ? (
                  <>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>Which day? (optional)</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => setDraft((d) => ({ ...d, suggestedDate: null }))}
                        style={[styles.dayChip, { borderColor: draft.suggestedDate === null ? colors.primary : colors.border, backgroundColor: draft.suggestedDate === null ? colors.primary + "18" : colors.background }]}
                      >
                        <Text style={[styles.dayChipLabel, { color: draft.suggestedDate === null ? colors.primary : colors.foreground }]}>General</Text>
                        <Text style={[styles.dayChipSub, { color: colors.mutedForeground }]}>Any day</Text>
                      </TouchableOpacity>
                      {dayKeys.map((key, i) => {
                        const active = draft.suggestedDate === key;
                        const h = formatDayHeading(key, i);
                        return (
                          <TouchableOpacity
                            key={key}
                            onPress={() => setDraft((d) => ({ ...d, suggestedDate: key }))}
                            style={[styles.dayChip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "18" : colors.background }]}
                          >
                            <Text style={[styles.dayChipLabel, { color: active ? colors.primary : colors.foreground }]}>{h.label}</Text>
                            <Text style={[styles.dayChipSub, { color: colors.mutedForeground }]}>{h.sub}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </>
                ) : null}
              </>
            ) : null}

            {!showMore ? (
              <TouchableOpacity
                onPress={() => setShowMore(true)}
                style={[styles.moreBtn, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel="More details"
              >
                <Ionicons name="options-outline" size={16} color={colors.mutedForeground} />
                <Text style={[styles.moreBtnText, { color: colors.mutedForeground }]}>More details — notes, link, cost…</Text>
                <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ) : null}

            {showMore ? (
              <>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Why this? (optional)</Text>
                <TextInput
                  value={draft.description}
                  onChangeText={(t) => setDraft((d) => ({ ...d, description: t }))}
                  placeholder="Anything the group should know"
                  placeholderTextColor={colors.textDim}
                  multiline
                  maxLength={500}
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, height: 70, textAlignVertical: "top", paddingTop: 12 }]}
                />

                <Text style={[styles.label, { color: colors.mutedForeground }]}>Link (optional)</Text>
                <TextInput
                  value={draft.linkUrl}
                  onChangeText={(t) => setDraft((d) => ({ ...d, linkUrl: t }))}
                  placeholder="https://…"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                />

                <Text style={[styles.label, { color: colors.mutedForeground }]}>Estimated cost (optional)</Text>
                <TextInput
                  value={draft.cost}
                  onChangeText={(t) => setDraft((d) => ({ ...d, cost: t }))}
                  placeholder="$ per person"
                  placeholderTextColor={colors.textDim}
                  keyboardType="decimal-pad"
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                />
              </>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 10, backgroundColor: colors.card }]}>
            <TouchableOpacity
              onPress={submit}
              disabled={!draft.title.trim() || saving}
              style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: !draft.title.trim() || saving ? 0.5 : 1 }]}
            >
              <Text style={styles.saveBtnText}>
                {saving ? "Saving…" : editing ? "Save changes" : "Suggest it"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 20, paddingTop: 12 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "900" },
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 16, marginBottom: 8 },
  input: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, height: 48, fontSize: 15 },
  dayChip: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8, minWidth: 92 },
  dayChipLabel: { fontSize: 14, fontWeight: "800" },
  dayChipSub: { fontSize: 11, marginTop: 1 },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8 },
  catChipText: { fontSize: 13, fontWeight: "700" },
  moreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, borderStyle: "dashed", paddingVertical: 12, marginTop: 18 },
  moreBtnText: { fontSize: 13, fontWeight: "700" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
