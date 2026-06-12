import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";
import { useUserCache } from "@/context/UserCacheContext";
import { useMutedSquads } from "@/context/MutedSquadsContext";
import { API_BASE } from "@/lib/api";

type RemovalNotice = {
  id: string;
  squadName: string;
  createdAt: string;
};

export default function SquadsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { squads, events, currentUser, authToken } = useData();
  const { resolveUser, prefetchUsers } = useUserCache();
  const { mutedSquadIds, refreshMutedSquads } = useMutedSquads();
  const [notices, setNotices] = useState<RemovalNotice[]>([]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 100);

  const fetchNotices = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/squads/removal-notices`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return;
      const data = await res.json() as RemovalNotice[];
      setNotices(data);
    } catch {
      // Network unavailable — keep current notices
    }
  }, [authToken]);

  const dismissNotice = useCallback(async (noticeId: string) => {
    if (!authToken) return;
    setNotices((prev) => prev.filter((n) => n.id !== noticeId));
    try {
      await fetch(`${API_BASE}/api/squads/removal-notices/${noticeId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch {
      // Best-effort; the optimistic removal already happened
    }
  }, [authToken]);

  // Fetch notices whenever the screen comes into focus
  useFocusEffect(
    useCallback(() => {
      void fetchNotices();
    }, [fetchNotices]),
  );

  // Re-sync muted squad IDs on focus as a safety net (e.g. another device changed the state)
  useFocusEffect(
    useCallback(() => {
      void refreshMutedSquads();
    }, [refreshMutedSquads]),
  );

  // Pre-load all squad member profiles
  useEffect(() => {
    const ids = squads.flatMap((s) => s.memberIds);
    if (ids.length > 0) prefetchUsers(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squads]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>SquadZ</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/discover"); }}
            style={[styles.findBtn, { backgroundColor: colors.surfaceUp }]}
          >
            <Ionicons name="search-outline" size={16} color={colors.primary} />
            <Text style={[styles.findBtnText, { color: colors.primary }]}>Find squads</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/create"); }}
            style={[styles.newBtn, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
      >
        {notices.map((notice) => (
          <RemovalBanner
            key={notice.id}
            squadName={notice.squadName}
            onDismiss={() => dismissNotice(notice.id)}
            colors={colors}
          />
        ))}

        <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>
          {squads.length} squad{squads.length !== 1 ? "s" : ""}
        </Text>

        {squads.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 52, marginBottom: 14 }}>👥</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No squads yet</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Create a squad and invite your people — then find the time everyone's free.
            </Text>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/squad/create"); }}
              style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.emptyBtnText}>Create a Squad</Text>
            </TouchableOpacity>
          </View>
        ) : (
          squads.map((squad) => {
            const squadEvents = events.filter((e) => e.squadId === squad.id);
            const members = squad.memberIds.slice(0, 5).map((mid) => resolveUser(mid));
            return (
              <TouchableOpacity
                key={squad.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push(`/squad/${squad.id}`); }}
                style={[styles.squadCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.squadIcon, { backgroundColor: squad.color + "22", borderColor: squad.color + "30", borderWidth: 1 }]}>
                  <Text style={{ fontSize: 30 }}>{squad.emoji}</Text>
                </View>
                <View style={styles.squadBody}>
                  <View style={styles.squadNameRow}>
                    <Text style={[styles.squadName, { color: colors.foreground }]}>{squad.name}</Text>
                    {mutedSquadIds.has(squad.id) && (
                      <View style={[styles.mutedBadge, { backgroundColor: colors.surfaceUp }]}>
                        <Ionicons name="notifications-off-outline" size={11} color={colors.mutedForeground} />
                        <Text style={[styles.mutedBadgeText, { color: colors.mutedForeground }]}>Muted</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.squadMeta, { color: colors.mutedForeground }]}>
                    {squad.memberIds.length} members · {squadEvents.length} event{squadEvents.length !== 1 ? "s" : ""}
                  </Text>
                  <View style={styles.memberAvatars}>
                    {members.map((m, i) => {
                      const photoUrl = m.id === currentUser.id ? currentUser.profileImageUrl : m.profileImageUrl;
                      return (
                        <View
                          key={m.id}
                          style={[
                            styles.memberAvatar,
                            { backgroundColor: m.color, marginLeft: i > 0 ? -7 : 0, borderColor: colors.card },
                          ]}
                        >
                          {photoUrl ? (
                            <Image source={{ uri: photoUrl }} style={styles.memberAvatarImage} />
                          ) : (
                            <Text style={styles.memberInitial}>{m.initials[0]}</Text>
                          )}
                        </View>
                      );
                    })}
                    {squad.memberIds.length > 5 && (
                      <View style={[styles.memberAvatar, { backgroundColor: colors.surfaceUp, marginLeft: -7, borderColor: colors.card }]}>
                        <Text style={[styles.memberInitial, { color: colors.mutedForeground }]}>
                          +{squad.memberIds.length - 5}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </TouchableOpacity>
            );
          })
        )}

        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/create"); }}
          style={[styles.createBtn, { borderColor: colors.primary + "40" }]}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
          <Text style={[styles.createBtnText, { color: colors.primary }]}>Create a new squad</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

type ColorsLike = {
  card: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  primary: string;
};

function RemovalBanner({
  squadName,
  onDismiss,
  colors,
}: {
  squadName: string;
  onDismiss: () => void;
  colors: ColorsLike;
}) {
  return (
    <View style={[bannerStyles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name="information-circle-outline" size={18} color={colors.mutedForeground} style={{ marginTop: 1 }} />
      <Text style={[bannerStyles.text, { color: colors.foreground }]}>
        You were removed from{" "}
        <Text style={{ fontWeight: "800" }}>{squadName}</Text>
      </Text>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  title: { fontSize: 28, fontWeight: "900" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  findBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 11 },
  findBtnText: { fontSize: 13, fontWeight: "700" },
  newBtn: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  countLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  squadCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 10,
  },
  squadIcon: { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  squadBody: { flex: 1, gap: 3 },
  squadNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  squadName: { fontSize: 16, fontWeight: "800" },
  mutedBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  mutedBadgeText: { fontSize: 10, fontWeight: "600" },
  squadMeta: { fontSize: 12 },
  memberAvatars: { flexDirection: "row", marginTop: 4 },
  memberAvatar: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2,
    overflow: "hidden",
  },
  memberAvatarImage: { width: 24, height: 24, borderRadius: 12 },
  memberInitial: { fontSize: 9, fontWeight: "800", color: "#fff" },
  empty: { alignItems: "center", paddingTop: 60, paddingBottom: 40 },
  emptyTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20, paddingHorizontal: 24 },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 20, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 999,
  },
  emptyBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed", padding: 16, marginTop: 6,
  },
  createBtnText: { fontSize: 15, fontWeight: "700" },
});
