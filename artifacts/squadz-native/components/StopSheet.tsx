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
import type { ItineraryStop, StopCategory } from "@/types";
import { STOP_CATEGORIES, STOP_CATEGORY_META, formatDayHeading } from "@/lib/tripUtils";
import type { NewStopInput, StopPatch } from "@/lib/tripApi";

export type StopDraft = {
  day: string;
  time: string;
  endTime: string;
  title: string;
  placeName: string;
  address: string;
  note: string;
  category: StopCategory;
  status: "confirmed" | "proposed";
  cost: string;
  assigneeId: string | null;
};

function emptyDraft(day: string): StopDraft {
  return { day, time: "", endTime: "", title: "", placeName: "", address: "", note: "", category: "activity", status: "confirmed", cost: "", assigneeId: null };
}

export function StopSheet({
  visible,
  dayKeys,
  defaultDay,
  editing,
  saving,
  members = [],
  onClose,
  onSubmit,
}: {
  visible: boolean;
  dayKeys: string[];
  defaultDay: string;
  editing: ItineraryStop | null;
  saving: boolean;
  members?: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (data: NewStopInput | StopPatch, isEdit: boolean) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<StopDraft>(emptyDraft(defaultDay));

  useEffect(() => {
    if (!visible) return;
    if (editing) {
      setDraft({
        day: editing.day,
        time: editing.time ?? "",
        endTime: editing.endTime ?? "",
        title: editing.title ?? "",
        placeName: editing.placeName ?? "",
        address: editing.address ?? "",
        note: editing.note ?? "",
        category: editing.category,
        status: editing.status,
        cost: typeof editing.cost === "number" ? String(editing.cost) : "",
        assigneeId: editing.assigneeId ?? null,
      });
    } else {
      setDraft(emptyDraft(defaultDay));
    }
  }, [visible, editing, defaultDay]);

  const submit = () => {
    if (!draft.title.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const parsedCost = draft.cost.trim() ? Number(draft.cost.replace(/[^0-9.]/g, "")) : null;
    const payload = {
      day: draft.day,
      time: draft.time.trim(),
      endTime: draft.endTime.trim(),
      title: draft.title.trim(),
      placeName: draft.placeName.trim(),
      address: draft.address.trim(),
      note: draft.note.trim(),
      category: draft.category,
      status: draft.status,
      cost: parsedCost !== null && !Number.isNaN(parsedCost) ? parsedCost : null,
      assigneeId: draft.assigneeId,
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
            <Text style={[styles.title, { color: colors.foreground }]}>{editing ? "Edit stop" : "Add stop"}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Title</Text>
            <TextInput
              value={draft.title}
              onChangeText={(t) => setDraft((d) => ({ ...d, title: t }))}
              placeholder="e.g. Sunset dinner"
              placeholderTextColor={colors.textDim}
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              autoFocus={!editing}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {dayKeys.map((key, i) => {
                const active = draft.day === key;
                const h = formatDayHeading(key, i);
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setDraft((d) => ({ ...d, day: key }))}
                    style={[styles.dayChip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "18" : colors.background }]}
                  >
                    <Text style={[styles.dayChipLabel, { color: active ? colors.primary : colors.foreground }]}>{h.label}</Text>
                    <Text style={[styles.dayChipSub, { color: colors.mutedForeground }]}>{h.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.timeRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Start time (optional)</Text>
                <TextInput
                  value={draft.time}
                  onChangeText={(t) => setDraft((d) => ({ ...d, time: t }))}
                  placeholder="e.g. 7:00 PM"
                  placeholderTextColor={colors.textDim}
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>End time (optional)</Text>
                <TextInput
                  value={draft.endTime}
                  onChangeText={(t) => setDraft((d) => ({ ...d, endTime: t }))}
                  placeholder="e.g. 9:00 PM"
                  placeholderTextColor={colors.textDim}
                  style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                />
              </View>
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Category</Text>
            <View style={styles.catRow}>
              {STOP_CATEGORIES.map((cat) => {
                const meta = STOP_CATEGORY_META[cat];
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

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Place (optional)</Text>
            <TextInput
              value={draft.placeName}
              onChangeText={(t) => setDraft((d) => ({ ...d, placeName: t }))}
              placeholder="Name of the spot"
              placeholderTextColor={colors.textDim}
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            />
            <TextInput
              value={draft.address}
              onChangeText={(t) => setDraft((d) => ({ ...d, address: t }))}
              placeholder="Address or area (optional)"
              placeholderTextColor={colors.textDim}
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

            {members.length > 0 ? (
              <>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Assignee (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => setDraft((d) => ({ ...d, assigneeId: null }))}
                    style={[styles.assigneeChip, { borderColor: draft.assigneeId === null ? colors.primary : colors.border, backgroundColor: draft.assigneeId === null ? colors.primary + "18" : colors.background }]}
                  >
                    <Text style={[styles.assigneeChipText, { color: draft.assigneeId === null ? colors.primary : colors.mutedForeground }]}>Unassigned</Text>
                  </TouchableOpacity>
                  {members.map((m) => {
                    const active = draft.assigneeId === m.id;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => setDraft((d) => ({ ...d, assigneeId: m.id }))}
                        style={[styles.assigneeChip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "18" : colors.background }]}
                      >
                        <Text style={[styles.assigneeChipText, { color: active ? colors.primary : colors.foreground }]} numberOfLines={1}>{m.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Note (optional)</Text>
            <TextInput
              value={draft.note}
              onChangeText={(t) => setDraft((d) => ({ ...d, note: t }))}
              placeholder="Anything the squad should know"
              placeholderTextColor={colors.textDim}
              multiline
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, height: 70, textAlignVertical: "top", paddingTop: 12 }]}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Status</Text>
            <View style={styles.statusRow}>
              {(["confirmed", "proposed"] as const).map((st) => {
                const active = draft.status === st;
                return (
                  <TouchableOpacity
                    key={st}
                    onPress={() => setDraft((d) => ({ ...d, status: st }))}
                    style={[styles.statusChip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary + "18" : colors.background }]}
                  >
                    <Ionicons
                      name={st === "confirmed" ? "checkmark-circle" : "help-circle"}
                      size={16}
                      color={active ? colors.primary : colors.mutedForeground}
                    />
                    <Text style={[styles.statusText, { color: active ? colors.primary : colors.mutedForeground }]}>
                      {st === "confirmed" ? "Confirmed" : "Proposed (let the squad vote)"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 10, backgroundColor: colors.card }]}>
            <TouchableOpacity
              onPress={submit}
              disabled={!draft.title.trim() || saving}
              style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: !draft.title.trim() || saving ? 0.5 : 1 }]}
            >
              <Text style={styles.saveBtnText}>{saving ? "Saving…" : editing ? "Save changes" : "Add to itinerary"}</Text>
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
  timeRow: { flexDirection: "row", gap: 12 },
  assigneeChip: { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8, maxWidth: 160 },
  assigneeChipText: { fontSize: 13, fontWeight: "700" },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 8 },
  catChipText: { fontSize: 13, fontWeight: "700" },
  statusRow: { gap: 8 },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  statusText: { fontSize: 13, fontWeight: "700", flex: 1 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
