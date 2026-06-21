import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  Image,
  ActivityIndicator,
  Modal,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { API_BASE, buildAuthHeaders, resolveUploadedUrl } from "@/lib/api";
import { useAuth, useData } from "@/context/AppContext";
import { useActivity } from "@/context/ActivityContext";
import { useUserCache, type ResolvedUser } from "@/context/UserCacheContext";
import { ProAvatar } from "@/components/ProAvatar";

type ActivityMeta = {
  commentPreview?: string;
  emoji?: string;
  rsvpStatus?: "going" | "maybe" | "notgoing";
  subjectName?: string;
  subjectEmoji?: string;
  squadId?: string;
  photoId?: number;
  thumbUrl?: string;
};

type ActivityItem = {
  id: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  grouped: boolean;
  actorIds: string[];
  actorCount: number;
  createdAt: string;
  read: boolean;
  meta: ActivityMeta | null;
};

const PAGE_LIMIT = 30;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function actorsLabel(names: string[], total: number): string {
  const first = names[0] ?? "Someone";
  if (total <= 1) return first;
  if (total === 2) return `${first} and ${names[1] ?? "1 other"}`;
  return `${first} and ${total - 1} others`;
}

export default function ActivityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();
  const { markAllRead, subscribe } = useActivity();
  const { resolveUser, prefetchUsers } = useUserCache();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetActors, setSheetActors] = useState<ResolvedUser[] | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  const { fetchFriends } = useData();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + 24;

  const fetchPage = useCallback(
    async (pageNum: number): Promise<{ items: ActivityItem[]; hasMore: boolean } | null> => {
      if (!authToken) return null;
      try {
        const res = await fetch(
          `${API_BASE}/api/activity?page=${pageNum}&limit=${PAGE_LIMIT}`,
          { headers: buildAuthHeaders(authToken) },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { items: ActivityItem[]; hasMore: boolean };
        const allIds = data.items.flatMap((i) => i.actorIds);
        if (allIds.length) prefetchUsers(allIds);
        return data;
      } catch {
        return null;
      }
    },
    [authToken, prefetchUsers],
  );

  const loadFirst = useCallback(async () => {
    const data = await fetchPage(0);
    if (data) {
      setItems(data.items);
      setHasMore(data.hasMore);
      setPage(0);
    }
    setLoading(false);
    setRefreshing(false);
  }, [fetchPage]);

  // Initial load + mark read so the badge clears when the screen opens.
  useEffect(() => {
    void loadFirst();
    markAllRead();
  }, [loadFirst, markAllRead]);

  // Live refresh when a new activity arrives while the screen is open.
  useEffect(() => {
    const unsub = subscribe(() => {
      void (async () => {
        const data = await fetchPage(0);
        if (data) {
          setItems(data.items);
          setHasMore(data.hasMore);
          setPage(0);
        }
        markAllRead();
      })();
    });
    return unsub;
  }, [subscribe, fetchPage, markAllRead]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = page + 1;
    const data = await fetchPage(next);
    if (data) {
      setItems((prev) => [...prev, ...data.items]);
      setHasMore(data.hasMore);
      setPage(next);
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, page, fetchPage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadFirst();
  }, [loadFirst]);

  const navigate = useCallback((item: ActivityItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const meta = item.meta ?? {};
    switch (item.type) {
      case "friend_added":
        if (item.subjectId) {
          router.push({ pathname: "/user/[id]", params: { id: item.subjectId } } as never);
        }
        break;
      case "vibe_reaction":
      case "vibe_comment":
        router.navigate("/(tabs)/feed" as never);
        break;
      case "vault_reaction":
      case "vault_comment":
        if (meta.photoId) {
          router.push({
            pathname: "/vault",
            params: {
              photoId: String(meta.photoId),
              ...(meta.squadId ? { squadId: meta.squadId } : {}),
            },
          } as never);
        } else if (meta.squadId) {
          router.push({ pathname: "/vault", params: { squadId: meta.squadId } } as never);
        } else {
          router.push("/vault" as never);
        }
        break;
      case "rsvp":
        if (item.subjectId) {
          router.push({ pathname: "/event/[id]", params: { id: item.subjectId } } as never);
        }
        break;
      case "squad_join": {
        const sid = meta.squadId ?? item.subjectId;
        if (sid) router.push({ pathname: "/squad/[id]", params: { id: sid } } as never);
        break;
      }
    }
  }, []);

  const openActorSheet = useCallback(
    (item: ActivityItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSheetActors(item.actorIds.map((id) => resolveUser(id)));
    },
    [resolveUser],
  );

  const handleAccept = useCallback(
    async (requestId: string) => {
      if (processing.has(requestId)) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setProcessing((prev) => new Set(prev).add(requestId));
      try {
        const res = await fetch(`${API_BASE}/api/users/friend-requests/${requestId}/accept`, {
          method: "POST",
          headers: buildAuthHeaders(authToken),
        });
        if (res.ok) {
          void fetchFriends();
          void loadFirst();
        }
      } catch {
        /* silently ignore */
      } finally {
        setProcessing((prev) => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
      }
    },
    [authToken, fetchFriends, loadFirst, processing],
  );

  const handleDecline = useCallback(
    async (requestId: string) => {
      if (processing.has(requestId)) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setProcessing((prev) => new Set(prev).add(requestId));
      try {
        const res = await fetch(`${API_BASE}/api/users/friend-requests/${requestId}/decline`, {
          method: "POST",
          headers: buildAuthHeaders(authToken),
        });
        if (res.ok) void loadFirst();
      } catch {
        /* silently ignore */
      } finally {
        setProcessing((prev) => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
      }
    },
    [authToken, loadFirst, processing],
  );

  const renderItem = useCallback(
    ({ item }: { item: ActivityItem }) => {
      const meta = item.meta ?? {};
      const names = item.actorIds.map((id) => resolveUser(id).name);
      const lead = actorsLabel(names, item.actorCount);
      const primary = resolveUser(item.actorIds[0] ?? "");

      // Friend requests get their own layout with Accept / Decline inline
      if (item.type === "friend_request") {
        const requestId = item.subjectId ?? "";
        const isProcessing = processing.has(requestId);
        return (
          <View
            style={[
              styles.row,
              { borderBottomColor: colors.border, alignItems: "flex-start" },
              !item.read && { backgroundColor: colors.primary + "0D" },
            ]}
          >
            <TouchableOpacity
              disabled={!item.grouped || item.actorCount <= 1}
              onPress={() => openActorSheet(item)}
              style={styles.avatarWrap}
            >
              <ProAvatar
                initials={primary.initials}
                color={primary.color}
                imageUrl={primary.profileImageUrl}
                isPro={primary.isPro}
                size={44}
                fontSize={16}
              />
              {item.grouped && item.actorCount > 1 ? (
                <View style={[styles.countBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
                  <Text style={styles.countBadgeText}>+{item.actorCount - 1}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
            <View style={styles.body}>
              <Text style={[styles.text, { color: colors.foreground }]}>
                <Text style={styles.bold}>{lead}</Text>{" "}wants to be your friend
              </Text>
              <Text style={[styles.time, { color: colors.textDim }]}>{relativeTime(item.createdAt)}</Text>
              {requestId ? (
                <View style={styles.requestActions}>
                  <TouchableOpacity
                    onPress={() => { void handleAccept(requestId); }}
                    disabled={isProcessing}
                    activeOpacity={0.8}
                    style={[styles.acceptBtn, { backgroundColor: colors.primary, opacity: isProcessing ? 0.6 : 1 }]}
                  >
                    <Text style={styles.acceptBtnText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { void handleDecline(requestId); }}
                    disabled={isProcessing}
                    activeOpacity={0.8}
                    style={[styles.declineBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: isProcessing ? 0.6 : 1 }]}
                  >
                    <Text style={[styles.declineBtnText, { color: colors.foreground }]}>Decline</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </View>
        );
      }

      let action = "";
      let preview: string | null = null;
      switch (item.type) {
        case "friend_added":
          action = "added you as a friend";
          break;
        case "vibe_reaction":
          action = `reacted ${meta.emoji ?? "❤️"} to your post`;
          break;
        case "vibe_comment":
          action = "commented on your post";
          preview = meta.commentPreview ?? null;
          break;
        case "vault_reaction":
          action = "hearted your photo";
          break;
        case "vault_comment":
          action = "commented on your photo";
          preview = meta.commentPreview ?? null;
          break;
        case "rsvp": {
          const verb =
            meta.rsvpStatus === "going"
              ? "is going to"
              : meta.rsvpStatus === "maybe"
              ? "might go to"
              : "RSVP'd to";
          action = `${verb} ${meta.subjectEmoji ?? ""} ${meta.subjectName ?? "your event"}`.trim();
          break;
        }
        case "squad_join":
          action = `joined ${meta.subjectEmoji ?? ""} ${meta.subjectName ?? "your squad"}`.trim();
          break;
      }

      const thumb = meta.thumbUrl ? resolveUploadedUrl(meta.thumbUrl) : null;

      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigate(item)}
          style={[
            styles.row,
            { borderBottomColor: colors.border },
            !item.read && { backgroundColor: colors.primary + "0D" },
          ]}
        >
          <TouchableOpacity
            disabled={!item.grouped || item.actorCount <= 1}
            onPress={() => openActorSheet(item)}
            style={styles.avatarWrap}
          >
            <ProAvatar
              initials={primary.initials}
              color={primary.color}
              imageUrl={primary.profileImageUrl}
              isPro={primary.isPro}
              size={44}
              fontSize={16}
            />
            {item.grouped && item.actorCount > 1 ? (
              <View style={[styles.countBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
                <Text style={styles.countBadgeText}>+{item.actorCount - 1}</Text>
              </View>
            ) : null}
          </TouchableOpacity>

          <View style={styles.body}>
            <Text style={[styles.text, { color: colors.foreground }]}>
              <Text style={styles.bold}>{lead}</Text> {action}
            </Text>
            {preview ? (
              <Text style={[styles.preview, { color: colors.mutedForeground }]} numberOfLines={1}>
                “{preview}”
              </Text>
            ) : null}
            <Text style={[styles.time, { color: colors.textDim }]}>{relativeTime(item.createdAt)}</Text>
          </View>

          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} />
          ) : !item.read ? (
            <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
          ) : null}
        </TouchableOpacity>
      );
    },
    [colors, navigate, openActorSheet, resolveUser, handleAccept, handleDecline, processing],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); if (router.canGoBack()) { router.back(); } else { router.replace("/(tabs)"); } }}
          style={[styles.backBtn, { backgroundColor: colors.card }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Activity</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: botPad }}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 40, marginBottom: 10 }}>🔔</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No activity yet</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                When friends react, comment, RSVP, or join your squads, it shows up here.
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
        />
      )}

      <Modal
        visible={!!sheetActors}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetActors(null)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setSheetActors(null)}
        >
          <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>People</Text>
            {(sheetActors ?? []).map((u) => (
              <TouchableOpacity
                key={u.id}
                style={styles.sheetRow}
                onPress={() => {
                  setSheetActors(null);
                  router.push({ pathname: "/user/[id]", params: { id: u.id } } as never);
                }}
              >
                <ProAvatar
                  initials={u.initials}
                  color={u.color}
                  imageUrl={u.profileImageUrl}
                  isPro={u.isPro}
                  size={40}
                  fontSize={15}
                />
                <Text style={[styles.sheetName, { color: colors.foreground }]}>{u.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  avatarWrap: { width: 44, height: 44 },
  countBadge: {
    position: "absolute",
    bottom: -2,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  countBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  body: { flex: 1 },
  text: { fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: "800" },
  preview: { fontSize: 13, marginTop: 2 },
  time: { fontSize: 12, marginTop: 3 },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: "#0002" },
  unreadDot: { width: 9, height: 9, borderRadius: 5 },
  requestActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  acceptBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, alignItems: "center" as const },
  acceptBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" as const },
  declineBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, alignItems: "center" as const, borderWidth: 1 },
  declineBtnText: { fontSize: 13, fontWeight: "600" as const },
  emptyState: { alignItems: "center", paddingVertical: 80, paddingHorizontal: 36 },
  emptyTitle: { fontSize: 17, fontWeight: "800", marginBottom: 6 },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  footer: { paddingVertical: 20 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  sheetTitle: { fontSize: 16, fontWeight: "800", marginBottom: 12 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  sheetName: { fontSize: 15, fontWeight: "600" },
});
