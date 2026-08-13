import { useCallback, useEffect, useState } from "react";
import { Alert, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { pollStatusLabel, INLINE_POLL_CAP, splitInlinePolls } from "@/lib/pollWizard";

// INLINE_POLL_CAP / splitInlinePolls live in lib/pollWizard (React-free) so the
// capping rule is unit-tested without mounting this component. Re-exported here
// because the screens import them alongside the list itself.
export { INLINE_POLL_CAP, splitInlinePolls };

export type ActivePollScope =
  | { type: "squad"; squadId: string }
  | { type: "event"; eventId: string };

export interface ActivePollSummary {
  id: string;
  title: string;
  days: string[];
  slots: string[];
  respondentCount: number;
  memberCount: number;
  createdBy: string;
  mine: boolean;
}

interface ActivePollListProps {
  scope: ActivePollScope;
  /** Opens the full chooser (all polls + start-new). */
  onSeeAll: () => void;
  /** Bumped by the parent to force a refetch (e.g. on screen focus). */
  refreshKey?: number;
}

/**
 * Capped, always-visible list of a scope's ACTIVE availability polls.
 *
 * Squad and event screens used to advertise a single poll resolved via /find,
 * so a squad with three live polls looked like it had one and every other board
 * was unreachable from the screen people actually visit. This lists them and
 * never auto-opens one — choosing a poll is always an explicit tap.
 */
export function ActivePollList({ scope, onSeeAll, refreshKey = 0 }: ActivePollListProps) {
  const colors = useColors();
  const { authToken } = useAuth();
  const [polls, setPolls] = useState<ActivePollSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    setFailed(false);
    try {
      const qs = scope.type === "squad" ? `squadId=${scope.squadId}` : `eventId=${scope.eventId}`;
      const res = await fetch(`${API_BASE}/api/availability/polls?${qs}`, {
        headers: { "Content-Type": "application/json", ...buildAuthHeaders(authToken) },
      });
      if (!res.ok) {
        setPolls([]);
        setFailed(true);
        return;
      }
      const body = (await res.json()) as { polls?: ActivePollSummary[] };
      setPolls(body.polls ?? []);
    } catch {
      setPolls([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [authToken, scope]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const open = (pollId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/availability", params: { pollId } } as never);
  };

  const deletePoll = (pollId: string) => {
    Alert.alert("Delete poll?", "This removes the poll and everyone's responses. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              const res = await fetch(`${API_BASE}/api/availability/polls/${pollId}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json", ...buildAuthHeaders(authToken) },
              });
              if (!res.ok) {
                Alert.alert("Couldn't delete", "Please try again.");
                return;
              }
              setPolls((prev) => prev.filter((p) => p.id !== pollId));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              Alert.alert("Couldn't delete", "Network error. Please try again.");
            }
          })();
        },
      },
    ]);
  };

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: 10 }} />;
  }

  if (failed) {
    return (
      <TouchableOpacity
        onPress={() => void load()}
        style={[styles.retryRow, { borderColor: colors.border, backgroundColor: colors.card }]}
        activeOpacity={0.8}
      >
        <Ionicons name="refresh-outline" size={14} color={colors.mutedForeground} />
        <Text style={[styles.retryText, { color: colors.mutedForeground }]}>
          Couldn&apos;t load active polls — tap to retry
        </Text>
      </TouchableOpacity>
    );
  }

  if (polls.length === 0) return null;

  const { visible, hiddenCount } = splitInlinePolls(polls);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>
        {polls.length === 1 ? "Active poll" : `${polls.length} active polls`}
      </Text>
      {visible.map((p) => (
        <View
          key={p.id}
          style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <TouchableOpacity
            onPress={() => open(p.id)}
            style={styles.openPoll}
            activeOpacity={0.8}
          >
            <View style={[styles.icon, { backgroundColor: colors.primary + "20" }]}>
              <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                {p.title || "Find the Best Time"}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                {p.days.length === 1 ? "1 day" : `${p.days.length} days`} ·{" "}
                {pollStatusLabel({ respondentCount: p.respondentCount, memberCount: p.memberCount })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
          </TouchableOpacity>
          {p.mine && (
            <TouchableOpacity
              onPress={() => deletePoll(p.id)}
              style={styles.deleteBtn}
              hitSlop={8}
              accessibilityLabel="Delete poll"
            >
              <Ionicons name="trash-outline" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      ))}
      {hiddenCount > 0 && (
        <TouchableOpacity onPress={onSeeAll} style={styles.moreRow} activeOpacity={0.7}>
          <Text style={[styles.moreText, { color: colors.primary }]}>
            See all {polls.length} polls
          </Text>
          <Ionicons name="chevron-forward" size={13} color={colors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 8 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
  },
  openPoll: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  deleteBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 13.5, fontWeight: "700" },
  meta: { fontSize: 12, fontWeight: "500", marginTop: 2 },
  moreRow: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", paddingVertical: 2 },
  moreText: { fontSize: 12.5, fontWeight: "700" },
  retryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    marginTop: 10,
  },
  retryText: { fontSize: 12.5, fontWeight: "600" },
});
