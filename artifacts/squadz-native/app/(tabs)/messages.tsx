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
import type { Event } from "@/types";

// ── colours per type ──────────────────────────────────────────────────────────
const TYPE_META = {
  direct: { label: "DM",    bg: "#7C3AED", fg: "#fff" },
  squad:  { label: "Squad", bg: "#059669", fg: "#fff" },
  event:  { label: "Event", bg: "#D97706", fg: "#fff" },
  trip:   { label: "Trip",  bg: "#2563EB", fg: "#fff" },
} as const;

// ── unified list item ─────────────────────────────────────────────────────────
type UnifiedItem =
  | { kind: "conversation"; data: ConversationListItem }
  | { kind: "event"; event: Event; lastAt: string; lastText: string; unread: boolean };

function itemSortKey(item: UnifiedItem): number {
  const raw =
    item.kind === "conversation"
      ? new Date(item.data.lastMessageAt).getTime()
      : new Date(item.lastAt).getTime();
  // Event/trip messages may carry an unparseable legacy `time` ("Just now").
  // Treat those as oldest so a bad value can't crash or reorder the list.
  return Number.isNaN(raw) ? 0 : raw;
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
  type: "direct" | "squad" | "event";
  emoji?: string | null;
  color?: string | null;
  initial: string;
  imageUrl?: string | null;
  initials?: string;
}) {
  if (type === "event") {
    return (
      <View style={[styles.avatar, { backgroundColor: "#D9770622", borderColor: "#D9770644", borderWidth: 1 }]}>
        <Text style={{ fontSize: 24 }}>{emoji ?? "🗓️"}</Text>
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
  const { currentUser, events, eventsLoading } = useAuth();
  const { conversations, conversationsLoading, refreshConversations, refreshUnread, eventReads } = useMessages();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 100);

  useFocusEffect(
    useCallback(() => {
      void refreshConversations();
      void refreshUnread();
    }, [refreshConversations, refreshUnread]),
  );

  // Build event chat items — only events that have at least one message
  const unifiedList = useMemo<UnifiedItem[]>(() => {
    const convItems: UnifiedItem[] = conversations.map((c) => ({ kind: "conversation", data: c }));

    const eventItems: UnifiedItem[] = events
      .filter((e) => e.messages.length > 0 && !e.cancelled)
      .map((e) => {
        const last = e.messages[e.messages.length - 1];
        const lastAt = last.createdAt ?? last.time;
        // Unread when the latest message is newer than what we've seen AND it
        // wasn't sent by us. Messages without a real timestamp (legacy) can't
        // be compared, so they never count as unread (avoids false positives).
        const readAt = eventReads[e.id];
        const unread =
          !!last.createdAt &&
          last.senderId !== currentUser?.id &&
          (!readAt || readAt < last.createdAt);
        return {
          kind: "event",
          event: e,
          lastAt,
          lastText: last.text,
          unread,
        };
      });

    return [...convItems, ...eventItems].sort((a, b) => itemSortKey(b) - itemSortKey(a));
  }, [conversations, events, eventReads, currentUser?.id]);

  const isLoading = conversationsLoading && eventsLoading && unifiedList.length === 0;

  const openItem = useCallback((item: UnifiedItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (item.kind === "conversation") {
      router.push(`/conversation/${item.data.id}` as never);
    } else {
      // Opened from the Messages inbox → land on the chat tab, not the
      // itinerary/overview ("the event"). Both detail screens read ?tab.
      const base = item.event.type === "trip" ? `/trip/${item.event.id}` : `/event/${item.event.id}`;
      router.push(`${base}?tab=chat` as never);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const renderItem = useCallback(
    ({ item }: { item: UnifiedItem }) => {
      if (item.kind === "conversation") {
        const c = item.data;
        const unread = c.unreadCount > 0;
        const youSent = c.lastMessageSenderId === currentUser?.id;
        const preview = c.lastMessagePreview
          ? `${youSent ? "You: " : ""}${c.lastMessagePreview}`
          : "No messages yet";
        const type = c.type; // "direct" | "squad"

        return (
          <TouchableOpacity
            onPress={() => openItem(item)}
            style={[styles.row, { borderBottomColor: colors.border }]}
            activeOpacity={0.7}
          >
            <Avatar
              type={type}
              emoji={c.emoji}
              color={c.color}
              initial={(c.title || "?").charAt(0)}
              imageUrl={type === "direct" ? (c.otherUserImageUrl ?? null) : null}
              initials={type === "direct" ? (c.title || "?").slice(0, 2).toUpperCase() : undefined}
            />
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <TypePill kind={type} />
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
            </View>
          </TouchableOpacity>
        );
      }

      // ── event / trip chat item ────────────────────────────────────────
      const { event, lastAt, lastText, unread } = item;
      const isTrip = event.type === "trip";
      const youSent = event.messages[event.messages.length - 1]?.senderId === currentUser?.id;
      const preview = `${youSent ? "You: " : ""}${lastText}`;

      return (
        <TouchableOpacity
          onPress={() => openItem(item)}
          style={[styles.row, { borderBottomColor: colors.border }]}
          activeOpacity={0.7}
        >
          <Avatar type="event" emoji={event.emoji ?? (isTrip ? "✈️" : null)} initial={event.title.charAt(0)} />
          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <TypePill kind={isTrip ? "trip" : "event"} />
              <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
                {event.title}
              </Text>
              <Text style={[styles.rowTime, { color: unread ? colors.primary : colors.textDim }]}>
                {timeAgo(lastAt)}
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
              {unread && <View style={[styles.dot, { backgroundColor: colors.primary }]} />}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [colors, currentUser?.id, openItem],
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
        data={isLoading ? [] : unifiedList}
        keyExtractor={(item) =>
          item.kind === "conversation" ? `conv-${item.data.id}` : `event-${item.event.id}`
        }
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
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
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
