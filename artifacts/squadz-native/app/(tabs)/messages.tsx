import { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();
  const { conversations, conversationsLoading, refreshConversations } = useMessages();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 100);

  useFocusEffect(
    useCallback(() => {
      void refreshConversations();
    }, [refreshConversations]),
  );

  const openConversation = (c: ConversationListItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/conversation/${c.id}` as never);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Messages</Text>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/friends"); }}
          style={[styles.newBtn, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="create-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={refreshConversations}
            tintColor={colors.primary}
          />
        }
      >
        {conversationsLoading && conversations.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : conversations.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 52, marginBottom: 14 }}>💬</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Start a chat with a friend or your squad
            </Text>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/friends"); }}
              style={[styles.emptyBtn, { borderColor: colors.primary + "40" }]}
            >
              <Ionicons name="person-add-outline" size={18} color={colors.primary} />
              <Text style={[styles.emptyBtnText, { color: colors.primary }]}>Message a friend</Text>
            </TouchableOpacity>
          </View>
        ) : (
          conversations.map((c) => {
            const unread = c.unreadCount > 0;
            const youSent = c.lastMessageSenderId === currentUser?.id;
            const preview = c.lastMessagePreview
              ? `${youSent ? "You: " : ""}${c.lastMessagePreview}`
              : "No messages yet";
            return (
              <TouchableOpacity
                key={c.id}
                onPress={() => openConversation(c)}
                style={[styles.row, { borderBottomColor: colors.border }]}
                activeOpacity={0.7}
              >
                {c.type === "squad" ? (
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: (c.color ?? colors.primary) + "22", borderColor: (c.color ?? colors.primary) + "30", borderWidth: 1 },
                    ]}
                  >
                    <Text style={{ fontSize: 24 }}>{c.emoji ?? "👥"}</Text>
                  </View>
                ) : (
                  <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                    <Text style={styles.avatarInitial}>
                      {(c.title || "?").trim().charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}

                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text
                      style={[styles.rowName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
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
                      {c.type === "squad" && !youSent ? "" : ""}
                      {preview}
                    </Text>
                    {unread && (
                      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                        <Text style={styles.badgeText}>
                          {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
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
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowName: { fontSize: 16, fontWeight: "700", flex: 1 },
  rowTime: { fontSize: 12, fontWeight: "600", flexShrink: 0 },
  rowBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowPreview: { fontSize: 14, flex: 1 },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  empty: { alignItems: "center", paddingTop: 80, paddingBottom: 40 },
  emptyTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 20 },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", paddingVertical: 12, paddingHorizontal: 18,
  },
  emptyBtnText: { fontSize: 14, fontWeight: "700" },
});
