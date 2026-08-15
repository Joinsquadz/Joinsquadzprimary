import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { pollStatusLabel } from "@/lib/pollWizard";
import { activePollScopeQuery } from "@/lib/activePollScope";
import type { ActivePollScope } from "@/components/ActivePollList";

export type FindTimeScope =
  | ActivePollScope
  | { type: "personal" };

interface PollSummary {
  id: string;
  title: string;
  days: string[];
  slots: string[];
  respondentCount: number;
  memberCount: number;
  createdBy: string;
  mine: boolean;
}

interface FindTimeChooserProps {
  visible: boolean;
  scope: FindTimeScope;
  onClose: () => void;
  /**
   * Called when the user taps "Start a new poll". The parent decides what fresh
   * means for its scope (squad push, ad-hoc participant picker, event poll).
   */
  onStartNew: () => void;
}

/**
 * New/Existing chooser shown at every "Find a Time" entry point. "Start new"
 * always shows; the "Existing" section only appears when there are un-converted
 * polls in this scope. Opening a poll navigates to the availability board by id;
 * the poll's creator can delete it from here.
 */
export function FindTimeChooser({ visible, scope, onClose, onStartNew }: FindTimeChooserProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const { authToken } = useAuth();
  const { currentUser } = useData();

  const [polls, setPolls] = useState<PollSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const scopeQuery = scope.type === "personal" ? "scope=personal" : activePollScopeQuery(scope);

  const headers = useCallback(
    (): Record<string, string> => ({ "Content-Type": "application/json", ...buildAuthHeaders(authToken) }),
    [authToken],
  );

  const load = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      // Every scope lists ALL of its active polls. Event scope used to resolve
      // a single board via /find, which hid every earlier active poll for that
      // event behind the newest one.
      const res = await fetch(`${API_BASE}/api/availability/polls?${scopeQuery}`, { headers: headers() });
      if (res.ok) {
        const body = (await res.json()) as { polls: PollSummary[] };
        setPolls(body.polls ?? []);
      } else {
        // A failed fetch is NOT "there are no polls" — silently showing an
        // empty list here is what pushed people into starting duplicate polls
        // on top of boards their squad had already answered.
        setPolls([]);
        setLoadFailed(true);
      }
    } catch {
      setPolls([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [authToken, headers, scopeQuery]);

  useEffect(() => {
    if (visible) void load();
    else {
      setPolls([]);
      setLoadFailed(false);
    }
  }, [visible, load]);

  const openPoll = useCallback((pollId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    router.push({ pathname: "/availability", params: { pollId } } as never);
  }, [onClose]);

  const handleStartNew = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Starting fresh while polls exist splits everyone's answers across two
    // boards, so make it a deliberate choice rather than the default tap.
    if (polls.length > 0) {
      Alert.alert(
        "Start a second poll?",
        `This squad already has ${polls.length === 1 ? "an active poll" : `${polls.length} active polls`}. A new one collects separate answers.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Start new",
            onPress: () => {
              onClose();
              onStartNew();
            },
          },
        ],
      );
      return;
    }
    onClose();
    onStartNew();
  };

  const deletePoll = (pollId: string) => {
    const doDelete = async () => {
      setDeletingId(pollId);
      try {
        const res = await fetch(`${API_BASE}/api/availability/polls/${pollId}`, {
          method: "DELETE",
          headers: headers(),
        });
        if (res.ok) {
          setPolls((prev) => prev.filter((p) => p.id !== pollId));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Alert.alert("Couldn't delete", "Please try again.");
        }
      } catch {
        Alert.alert("Couldn't delete", "Network error. Please try again.");
      } finally {
        setDeletingId(null);
      }
    };
    Alert.alert("Delete poll?", "This removes the poll and everyone's responses. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void doDelete() },
    ]);
  };

  const rangeLabel = (days: string[]) => {
    const n = days.length;
    return n === 1 ? "1 day" : `${n} days`;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 },
          ]}
        >
          <TouchableOpacity
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: colors.card }]}
            accessibilityLabel="Close"
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={colors.foreground} />
          </TouchableOpacity>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8 }}>
            <Text style={[styles.heading, { color: colors.foreground }]}>Find the Best Time</Text>

            {/* Start new — always present */}
            <TouchableOpacity
              onPress={handleStartNew}
              style={[styles.newBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.9}
            >
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={styles.newBtnText}>Start a new poll</Text>
            </TouchableOpacity>

            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 18 }} />
            ) : loadFailed ? (
              <View style={[styles.errorBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Ionicons name="cloud-offline-outline" size={20} color={colors.mutedForeground} />
                <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
                  Couldn&apos;t load existing polls. Starting a new one now could split your squad&apos;s answers.
                </Text>
                <TouchableOpacity
                  onPress={() => void load()}
                  style={[styles.retryBtn, { borderColor: colors.primary }]}
                  accessibilityLabel="Try again"
                >
                  <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : polls.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Continue an existing poll</Text>
                {polls.map((p) => (
                  <View key={p.id} style={[styles.row, { borderColor: colors.border }]}>
                    <TouchableOpacity
                      onPress={() => openPoll(p.id)}
                      style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: colors.primary + "20" }]}>
                        <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
                          {p.title || "Find the Best Time"}
                        </Text>
                        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {rangeLabel(p.days)} ·{" "}
                          {pollStatusLabel({ respondentCount: p.respondentCount, memberCount: p.memberCount })}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {p.mine ? (
                      <TouchableOpacity
                        onPress={() => deletePoll(p.id)}
                        disabled={deletingId === p.id}
                        hitSlop={8}
                        style={styles.deleteBtn}
                        accessibilityLabel="Delete poll"
                      >
                        {deletingId === p.id ? (
                          <ActivityIndicator size="small" color={colors.mutedForeground} />
                        ) : (
                          <Ionicons name="trash-outline" size={18} color={colors.mutedForeground} />
                        )}
                      </TouchableOpacity>
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                    )}
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  card: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: "82%",
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: { fontSize: 20, fontWeight: "800", marginBottom: 16, paddingRight: 40 },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
    marginBottom: 8,
  },
  newBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 13,
    padding: 12,
    marginBottom: 8,
  },
  errorBox: {
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
  },
  errorText: { fontSize: 13, fontWeight: "500", textAlign: "center", lineHeight: 18 },
  retryBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 18 },
  retryText: { fontSize: 13, fontWeight: "700" },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowName: { fontSize: 14, fontWeight: "700" },
  rowMeta: { fontSize: 12, fontWeight: "500", marginTop: 2 },
  deleteBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
});
