import { useCallback, useEffect, useRef, useState } from "react";
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
import { resolveResumeAction, pollStatusLabel } from "@/lib/pollWizard";

export type FindTimeScope =
  | { type: "squad"; squadId: string }
  | { type: "event"; eventId: string }
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Guards the resume-first auto-navigation so it fires at most once per open
  // (the load effect can re-run while the sheet is still visible).
  const resumeHandledRef = useRef(false);

  const headers = useCallback(
    (): Record<string, string> => ({ "Content-Type": "application/json", ...buildAuthHeaders(authToken) }),
    [authToken],
  );

  const load = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    try {
      if (scope.type === "event") {
        // Events are 1:1 with a poll — resolve the single existing one via /find.
        const res = await fetch(`${API_BASE}/api/availability/polls/find?eventId=${scope.eventId}`, {
          headers: headers(),
        });
        if (res.ok) {
          const payload = (await res.json()) as {
            poll: { id: string; title: string; days: string[]; slots: string[]; createdBy: string };
            respondentCount?: number;
          };
          const p = payload.poll;
          setPolls([
            {
              id: p.id,
              title: p.title,
              days: p.days,
              slots: p.slots,
              respondentCount: payload.respondentCount ?? 0,
              memberCount: 0,
              createdBy: p.createdBy,
              mine: p.createdBy === currentUser?.id,
            },
          ]);
        } else {
          setPolls([]);
        }
        return;
      }
      const qs = scope.type === "squad" ? `squadId=${scope.squadId}` : "scope=personal";
      const res = await fetch(`${API_BASE}/api/availability/polls?${qs}`, { headers: headers() });
      if (res.ok) {
        const body = (await res.json()) as { polls: PollSummary[] };
        setPolls(body.polls ?? []);
      } else {
        setPolls([]);
      }
    } catch {
      setPolls([]);
    } finally {
      setLoading(false);
    }
  }, [authToken, headers, scope, currentUser?.id]);

  useEffect(() => {
    if (visible) void load();
    else {
      setPolls([]);
      resumeHandledRef.current = false;
    }
  }, [visible, load]);

  const openPoll = useCallback((pollId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    router.push({ pathname: "/availability", params: { pollId } } as never);
  }, [onClose]);

  // Resume-first: a single active poll in this scope IS the answer to "find a
  // time", so open it rather than making the user pick it out of a sheet. Two
  // or more still need the chooser.
  useEffect(() => {
    if (!visible || loading || resumeHandledRef.current) return;
    const decision = resolveResumeAction(polls);
    if (decision.action === "resume") {
      resumeHandledRef.current = true;
      openPoll(decision.pollId);
    }
  }, [visible, loading, polls, openPoll]);

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
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowName: { fontSize: 14, fontWeight: "700" },
  rowMeta: { fontSize: 12, fontWeight: "500", marginTop: 2 },
  deleteBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
});
