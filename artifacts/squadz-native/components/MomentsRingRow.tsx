import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { useUserCache } from "@/context/UserCacheContext";
import { UserAvatar } from "./UserAvatar";
import { MomentViewer, type MomentRing } from "./MomentViewer";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type Props = {
  mode: "friends" | "squad" | "feed";
  squadId?: string;
  /** Bump to force a refetch (e.g. on SSE feed update). */
  reloadKey?: number;
};

function RingHalo({
  unseen,
  children,
  color,
}: {
  unseen: boolean;
  children: React.ReactNode;
  color: string;
}) {
  if (unseen) {
    return (
      <LinearGradient
        colors={["#FF5C3A", "#FF8050", "#FFB547"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.haloUnseen}
      >
        <View style={styles.haloInner}>{children}</View>
      </LinearGradient>
    );
  }
  return (
    <View style={[styles.haloSeen, { borderColor: color }]}>
      <View style={styles.haloInner}>{children}</View>
    </View>
  );
}

export function MomentsRingRow({ mode, squadId, reloadKey }: Props) {
  const colors = useColors();
  const { authToken, currentUser } = useAuth();
  const { resolveUser, prefetchUsers } = useUserCache();

  const [rings, setRings] = useState<MomentRing[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const audience = mode === "squad" && squadId ? squadId : "friends";

  const fetchRings = useCallback(async () => {
    if (!authToken) return;
    try {
      const url =
        mode === "squad" && squadId
          ? `${API_BASE}/api/moments/squad/${squadId}`
          : mode === "feed"
            ? `${API_BASE}/api/moments/feed`
            : `${API_BASE}/api/moments/friends`;
      const res = await fetch(url, { headers: buildAuthHeaders(authToken) });
      if (!res.ok) return;
      const data = (await res.json()) as { rings: MomentRing[] };
      const next = data.rings ?? [];
      setRings(next);
      const ids = next.map((r) => r.authorId);
      if (ids.length) prefetchUsers(ids);
    } catch {
      // Network unavailable — keep current state
    } finally {
      setLoaded(true);
    }
  }, [authToken, mode, squadId, prefetchUsers]);

  useFocusEffect(
    useCallback(() => {
      void fetchRings();
    }, [fetchRings, reloadKey]),
  );

  const selfRing = rings.find((r) => r.isSelf) ?? null;
  const selfRingIndex = rings.findIndex((r) => r.isSelf);

  const goCompose = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/moment/compose", params: { audience } } as never);
  }, [audience]);

  const openViewer = useCallback((index: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setViewerIndex(index);
  }, []);

  // Hide the row entirely until the first fetch resolves to avoid layout flash.
  if (!loaded) {
    return <View style={styles.placeholder} />;
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {/* Your moment tile — view self ring if present, else compose */}
        <View style={styles.tile}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => (selfRing ? openViewer(selfRingIndex) : goCompose())}
          >
            {selfRing ? (
              <RingHalo unseen={selfRing.hasUnseen} color={colors.border}>
                <UserAvatar
                  initials={currentUser.initials}
                  color={currentUser.color}
                  imageUrl={currentUser.profileImageUrl}
                  size={58}
                  fontSize={20}
                />
              </RingHalo>
            ) : (
              <View style={styles.haloSeen}>
                <View style={styles.haloInner}>
                  <UserAvatar
                    initials={currentUser.initials}
                    color={currentUser.color}
                    imageUrl={currentUser.profileImageUrl}
                    size={58}
                    fontSize={20}
                  />
                </View>
              </View>
            )}
            <View style={[styles.addBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
              <Ionicons name="add" size={15} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.label, { color: colors.mutedForeground }]} numberOfLines={1}>
            Your moment
          </Text>
        </View>

        {/* Other rings */}
        {rings.map((ringItem, index) => {
          if (ringItem.isSelf) return null;
          const u = resolveUser(ringItem.authorId);
          return (
            <View key={ringItem.authorId} style={styles.tile}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => openViewer(index)}>
                <RingHalo unseen={ringItem.hasUnseen} color={colors.border}>
                  <UserAvatar
                    initials={u.initials}
                    color={u.color}
                    imageUrl={u.profileImageUrl}
                    size={58}
                    fontSize={20}
                  />
                </RingHalo>
              </TouchableOpacity>
              <Text style={[styles.label, { color: colors.foreground }]} numberOfLines={1}>
                {u.name.split(" ")[0]}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {viewerIndex !== null && rings[viewerIndex] && (
        <MomentViewer
          rings={rings}
          initialRingIndex={viewerIndex}
          onClose={() => {
            setViewerIndex(null);
            void fetchRings();
          }}
          onChanged={() => void fetchRings()}
        />
      )}
    </View>
  );
}

const HALO = 70;
const styles = StyleSheet.create({
  placeholder: { height: 0 },
  row: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, gap: 14 },
  tile: { alignItems: "center", width: HALO + 6 },
  haloUnseen: {
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  haloSeen: {
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  haloInner: {
    backgroundColor: "#000",
    borderRadius: (HALO - 6) / 2,
    padding: 2,
  },
  addBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 12, fontWeight: "600", marginTop: 5, maxWidth: HALO + 4, textAlign: "center" },
});
