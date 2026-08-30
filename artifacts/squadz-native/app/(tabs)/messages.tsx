import { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { useMessages, type ConversationListItem } from "@/context/MessagesContext";
import { UserAvatar } from "@/components/UserAvatar";
// Shared auth-race guard (see lib/vaultAuthRace.ts). A cold-start / slow-login
// 401 — while the list is still empty — must keep this screen loading rather
// than flashing the "No messages yet" empty state.
import { vaultRenderMode } from "@/lib/vaultAuthRace";

// ── colours per type ──────────────────────────────────────────────────────────
const TYPE_META = {
  direct: { label: "DM",    bg: "#7C3AED", fg: "#fff" },
  squad:  { label: "Squad", bg: "#059669", fg: "#fff" },
  event:  { label: "Event", bg: "#D97706", fg: "#fff" },
  trip:   { label: "Trip",  bg: "#2563EB", fg: "#fff" },
} as const;

// Every inbox row — DM, squad, event and trip — is now a server-side
// conversation, so the list is a single sorted source with real unread counts
// (plan chats used to be stitched in client-side from the event records).
function itemSortKey(c: ConversationListItem): number {
  const raw = new Date(c.lastMessageAt).getTime();
  // Migrated legacy plan messages can carry an odd timestamp; treat an
  // unparseable one as oldest so it can't crash or reorder the list.
  return Number.isNaN(raw) ? 0 : raw;
}

/** Which pill/avatar treatment a row gets. Trips are visually distinct from events. */
function rowKind(c: ConversationListItem): keyof typeof TYPE_META {
  if (c.type !== "event") return c.type;
  return c.eventType === "trip" ? "trip" : "event";
}

// ── helpers ───────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 45) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
  return `${Math.floor(secs / 604800)}w`;
}

// ── type pill ─────────────────────────────────────────────────────────────────
function TypePill({ kind }: { kind: keyof typeof TYPE_META }) {
  const { label, bg } = TYPE_META[kind];
  return (
    <View style={[styles.pill, { backgroundColor: bg + "22", borderColor: bg + "55" }]}>
      <Text style={[styles.pillText, { color: bg }]}>{label}</Text>
    </View>
  );
}

// ── avatar ────────────────────────────────────────────────────────────────────
function Avatar({
  type,
  emoji,
  color,
  initial,
  imageUrl,
  initials,
}: {
  type: "direct" | "squad" | "event" | "trip";
  emoji?: string | null;
  color?: string | null;
  initial: string;
  imageUrl?: string | null;
  initials?: string;
}) {
  if (type === "event" || type === "trip") {
    const tint = type === "trip" ? "#2563EB" : "#D97706";
    return (
      <View style={[styles.avatar, { backgroundColor: tint + "22", borderColor: tint + "44", borderWidth: 1 }]}>
        <Text style={{ fontSize: 24 }}>{emoji ?? (type === "trip" ? "✈️" : "🗓️")}</Text>
      </View>
    );
  }
  if (type === "squad") {
    const bg = (color ?? "#059669") + "22";
    const border = (color ?? "#059669") + "44";
    return (
      <View style={[styles.avatar, { backgroundColor: bg, borderColor: border, borderWidth: 1 }]}>
        <Text style={{ fontSize: 24 }}>{emoji ?? "👥"}</Text>
      </View>
    );
  }
  return (
    <UserAvatar
      initials={initials ?? initial.toUpperCase()}
      color="#7C3AED"
      imageUrl={imageUrl ?? null}
      size={52}
      fontSize={18}
    />
  );
}

// ── main screen ───────────────────────────────────────────────────────────────
export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();
  const {
    conversations,
    conversationsLoading,
    refreshConversations,
    refreshUnread,
    conversationsAuthPending,
    conversationsAuthError,
    retryConversations,
  } = useMessages();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 100);

  useFocusEffect(
    useCallback(() => {
      void refreshConversations();
      void refreshUnread();
    }, [refreshConversations, refreshUnread]),
  );

  const inbox = useMemo(
    () => [...conversations].sort((a, b) => itemSortKey(b) - itemSortKey(a)),
    [conversations],
  );

  const isLoading = conversationsLoading && inbox.length === 0;

  // Auth-race guard: only treat the screen as pending/errored while it has
  // NOTHING to show. `authPending` overriding the empty state is what stops the
  // false "No messages yet" flash during a slow login.
  const renderMode = vaultRenderMode({
    loading: isLoading,
    authPending: conversationsAuthPending && inbox.length === 0,
    authError: conversationsAuthError && inbox.length === 0,
    photoCount: inbox.length,
  });

  const retry = useCallback(() => {
    retryConversations();
  }, [retryConversations]);

  const openItem = useCallback((c: ConversationListItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (c.type === "event" && c.eventId) {
      // Opened from the Messages inbox → land on the chat tab, not the
      // itinerary/overview ("the plan"). Both detail screens read ?tab.
      const base = c.eventType === "trip" ? `/trip/${c.eventId}` : `/event/${c.eventId}`;
      router.push(`${base}?tab=chat` as never);
      return;
    }
    router.push(`/conversation/${c.id}` as never);
  }, []);

  const openDirectProfile = useCallback((userId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push((userId === currentUser?.id ? "/profile" : `/user/${userId}`) as never);
  }, [currentUser?.id]);

  const handleRefresh = useCallback(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const renderItem = useCallback(
    ({ item: c }: { item: ConversationListItem }) => {
      const unread = c.unreadCount > 0;
      const youSent = c.lastMessageSenderId === currentUser?.id;
      const preview = c.lastMessagePreview
        ? `${youSent ? "You: " : ""}${c.lastMessagePreview}`
        : "No messages yet";
      const kind = rowKind(c);
      const isDirect = c.type === "direct";

      return (
        <View style={[styles.row, { borderBottomColor: colors.border }]}>
          {isDirect && c.otherUserId ? (
            <TouchableOpacity
              onPress={() => openDirectProfile(c.otherUserId!)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${c.title}'s profile`}
              hitSlop={8}
            >
              <Avatar
                type={kind} emoji={c.emoji} color={c.color} initial={(c.title || "?").charAt(0)}
                imageUrl={c.otherUserImageUrl ?? null} initials={(c.title || "?").slice(0, 2).toUpperCase()}
              />
            </TouchableOpacity>
          ) : (
            <Avatar
              type={kind} emoji={c.emoji} color={c.color} initial={(c.title || "?").charAt(0)}
              imageUrl={isDirect ? (c.otherUserImageUrl ?? null) : null}
              initials={isDirect ? (c.title || "?").slice(0, 2).toUpperCase() : undefined}
            />
          )}
          <TouchableOpacity onPress={() => openItem(c)} style={styles.rowBody} activeOpacity={0.7}>
            <View style={styles.rowTop}>
              <TypePill kind={kind} />
              <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
                {c.title}
              </Text>
              <Text style={[styles.rowTime, { color: unread ? colors.primary : colors.textDim }]}>
                {timeAgo(c.lastMessageAt)}
              </Text>
            </View>
            <View style={styles.rowBottom}>
              <Text
                style={[
                  styles.rowPreview,
                  { color: unread ? colors.foreground : colors.mutedForeground, fontWeight: unread ? "700" : "400" },
                ]}
                numberOfLines={1}
              >
                {preview}
              </Text>
              {unread && (
                <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.badgeText}>{c.unreadCount > 99 ? "99+" : c.unreadCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>
      );
    },
    [colors, currentUser?.id, openDirectProfile, openItem],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Messages</Text>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/friends");
          }}
          style={[styles.newBtn, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="create-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={renderMode === "content" ? inbox : []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: botPad, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={11}
        removeClippedSubviews={Platform.OS !== "web"}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          renderMode === "loading" ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : renderMode === "error" ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={48} color={colors.textDim} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load messages</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Check your connection and try again.
              </Text>
              <TouchableOpacity
                onPress={retry}
                style={[styles.emptyBtn, { borderColor: colors.primary + "40" }]}
              >
                <Ionicons name="refresh-outline" size={18} color={colors.primary} />
                <Text style={[styles.emptyBtnText, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={{ fontSize: 52, marginBottom: 14 }}>💬</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Start a chat with a friend or your squad
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/friends");
                }}
                style={[styles.emptyBtn, { borderColor: colors.primary + "40" }]}
              >
                <Ionicons name="person-add-outline" size={18} color={colors.primary} />
                <Text style={[styles.emptyBtnText, { color: colors.primary }]}>Message a friend</Text>
              </TouchableOpacity>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  title: { fontSize: 28, fontWeight: "900" },
  newBtn: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  loading: { paddingTop: 60, alignItems: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarInitial: { color: "#fff", fontSize: 20, fontWeight: "800" },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowName: { fontSize: 15, fontWeight: "700", flex: 1 },
  rowTime: { fontSize: 12, fontWeight: "600", flexShrink: 0 },
  rowBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowPreview: { fontSize: 14, flex: 1 },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  pill: {
    borderRadius: 5, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1, flexShrink: 0,
  },
  pillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  empty: { alignItems: "center", paddingTop: 80, paddingBottom: 40 },
  emptyTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 20 },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", paddingVertical: 12, paddingHorizontal: 18,
  },
  emptyBtnText: { fontSize: 14, fontWeight: "700" },
});
