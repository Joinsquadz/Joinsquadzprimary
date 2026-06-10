import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Pressable,
  Share,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { API_BASE } from "@/lib/api";
import { UpgradeModal } from "@/components/UpgradeModal";

type PublicSquad = {
  id: string;
  name: string;
  description?: string | null;
  emoji: string;
  color: string;
  memberIds: string[];
  creatorId: string | null;
  creatorName?: string | null;
};

export default function DiscoverSquadsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 20);

  const [squads, setSquads] = useState<PublicSquad[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PublicSquad | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const fetchSquads = useCallback(async () => {
    if (!authToken) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/discover`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error("Failed to load squads");
      const data = await res.json() as { squads: PublicSquad[] };
      setSquads(data.squads ?? []);
    } catch {
      setError("Couldn't load public squads. Pull to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authToken]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void fetchSquads();
    }, [fetchSquads]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    void fetchSquads();
  };

  const handleJoin = async (squad: PublicSquad) => {
    if (!authToken || joiningId) return;
    setJoiningId(squad.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${API_BASE}/api/squads/${squad.id}/join`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; code?: string };
        if (body.code === "SQUAD_LIMIT") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setPreview(null);
          setShowUpgrade(true);
          return;
        }
        throw new Error(body.error ?? "Failed to join");
      }
      const data = await res.json() as { squad: PublicSquad; alreadyMember: boolean };
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJoinedIds((prev) => new Set([...prev, squad.id]));
      setPreview(null);
      router.replace(`/squad/${data.squad.id}` as never);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setJoiningId(null);
    }
  };

  const handleShare = async (squad: PublicSquad) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const link = `https://joinsquadz.com/squad/join-public?id=${squad.id}`;
    try {
      await Share.share({
        message: `Join "${squad.emoji} ${squad.name}" on SquadZ!\n${link}`,
      });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)" as never);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Find Squads</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Finding public squads…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: botPad }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          {error && (
            <View style={[styles.errorBanner, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "40" }]}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          )}

          {squads.length === 0 && !error ? (
            <View style={styles.empty}>
              <Text style={{ fontSize: 52, marginBottom: 14 }}>🔍</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No public squads</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                There are no open squads to join right now. Create your own and make it public!
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/squad/create")}
                style={[styles.createBtn, { backgroundColor: colors.primary, marginTop: 24 }]}
              >
                <Text style={[styles.createBtnText, { color: "#fff" }]}>Create a Squad</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                {squads.length} public squad{squads.length !== 1 ? "s" : ""} open to join
              </Text>

              {squads.map((squad) => {
                const isJoining = joiningId === squad.id;
                const isJoined = joinedIds.has(squad.id);
                return (
                  <TouchableOpacity
                    key={squad.id}
                    activeOpacity={0.7}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setPreview(squad);
                    }}
                    style={[styles.squadCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.squadIcon, { backgroundColor: squad.color + "22", borderColor: squad.color + "30" }]}>
                      <Text style={{ fontSize: 28 }}>{squad.emoji}</Text>
                    </View>

                    <View style={styles.squadBody}>
                      <Text style={[styles.squadName, { color: colors.foreground }]} numberOfLines={1}>
                        {squad.name}
                      </Text>
                      {squad.description ? (
                        <Text style={[styles.squadDesc, { color: colors.foreground }]} numberOfLines={2}>
                          {squad.description}
                        </Text>
                      ) : null}
                      <Text style={[styles.squadMeta, { color: colors.mutedForeground }]}>
                        {squad.memberIds.length} member{squad.memberIds.length !== 1 ? "s" : ""}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => handleShare(squad)}
                      style={[styles.shareBtn, { borderColor: colors.border }]}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="share-outline" size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleJoin(squad)}
                      disabled={isJoining || isJoined}
                      style={[
                        styles.joinBtn,
                        {
                          backgroundColor: isJoined
                            ? colors.green ?? "#22c55e"
                            : colors.primary,
                          opacity: isJoining ? 0.6 : 1,
                        },
                      ]}
                    >
                      {isJoining ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : isJoined ? (
                        <Ionicons name="checkmark" size={16} color="#fff" />
                      ) : (
                        <Text style={styles.joinBtnText}>Join</Text>
                      )}
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>
      )}

      <Modal
        visible={preview !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setPreview(null)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

            {preview && (() => {
              const isJoining = joiningId === preview.id;
              const isJoined = joinedIds.has(preview.id);
              return (
                <>
                  <View
                    style={[
                      styles.previewIcon,
                      { backgroundColor: preview.color + "22", borderColor: preview.color + "30" },
                    ]}
                  >
                    <Text style={{ fontSize: 44 }}>{preview.emoji}</Text>
                  </View>

                  <Text style={[styles.previewName, { color: colors.foreground }]}>{preview.name}</Text>

                  <View style={styles.previewMetaRow}>
                    <View style={styles.previewMetaItem}>
                      <Ionicons name="people-outline" size={16} color={colors.mutedForeground} />
                      <Text style={[styles.previewMetaText, { color: colors.mutedForeground }]}>
                        {preview.memberIds.length} member{preview.memberIds.length !== 1 ? "s" : ""}
                      </Text>
                    </View>
                    {preview.creatorName ? (
                      <View style={styles.previewMetaItem}>
                        <Ionicons name="person-outline" size={16} color={colors.mutedForeground} />
                        <Text style={[styles.previewMetaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                          Created by {preview.creatorName}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    onPress={() => handleJoin(preview)}
                    disabled={isJoining || isJoined}
                    style={[
                      styles.previewJoinBtn,
                      {
                        backgroundColor: isJoined ? colors.green ?? "#22c55e" : colors.primary,
                        opacity: isJoining ? 0.7 : 1,
                      },
                    ]}
                  >
                    {isJoining ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : isJoined ? (
                      <>
                        <Ionicons name="checkmark" size={18} color="#fff" />
                        <Text style={styles.previewJoinText}>Joined</Text>
                      </>
                    ) : (
                      <Text style={styles.previewJoinText}>Join Squad</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setPreview(null)} style={styles.previewCancelBtn}>
                    <Text style={[styles.previewCancelText, { color: colors.mutedForeground }]}>Not now</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  squadCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  squadIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
  },
  squadBody: { flex: 1, gap: 3 },
  squadName: { fontSize: 16, fontWeight: "800" },
  squadDesc: { fontSize: 13, lineHeight: 18, opacity: 0.85 },
  squadMeta: { fontSize: 12 },
  joinBtn: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 62,
    height: 36,
  },
  joinBtnText: { fontSize: 14, fontWeight: "800", color: "#fff" },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  errorText: { fontSize: 13, fontWeight: "500", flex: 1 },
  empty: { alignItems: "center", paddingTop: 60, paddingBottom: 40 },
  emptyTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  createBtn: { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 28, alignItems: "center" },
  createBtnText: { fontSize: 15, fontWeight: "800" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: "center",
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 20,
  },
  previewIcon: {
    width: 84,
    height: 84,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: 16,
  },
  previewName: {
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 12,
  },
  previewMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 18,
    marginBottom: 28,
  },
  previewMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  previewMetaText: { fontSize: 14, fontWeight: "600" },
  previewJoinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    borderRadius: 16,
    paddingVertical: 16,
    height: 54,
  },
  previewJoinText: { fontSize: 16, fontWeight: "800", color: "#fff" },
  previewCancelBtn: {
    paddingVertical: 14,
    alignItems: "center",
    alignSelf: "stretch",
  },
  previewCancelText: { fontSize: 15, fontWeight: "600" },
});
