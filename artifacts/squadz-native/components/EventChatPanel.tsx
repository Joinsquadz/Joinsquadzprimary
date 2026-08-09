import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";
import { useUserCache, type ResolvedUser } from "@/context/UserCacheContext";
import { UserAvatar } from "@/components/UserAvatar";
import type { PlanChat } from "@/hooks/useEventChat";

/**
 * Shared plan (event / trip) chat used by both detail screens. Split into the
 * scrollable message list (rendered inside the screen's ScrollView) and the
 * sticky composer (rendered as a sibling pinned to the bottom), so it slots
 * into either screen's scroll architecture.
 *
 * Both halves read from the SAME `PlanChat` value, which the screen owns via
 * useEventChat(). Backed by a paginated conversation thread — the list starts
 * at the latest page and walks backwards via "Load earlier messages".
 */

function useResolveForDisplay() {
  const { currentUser } = useData();
  const { resolveUser } = useUserCache();
  return (userId: string): ResolvedUser =>
    userId === currentUser.id
      ? { ...(currentUser as unknown as ResolvedUser), isPro: resolveUser(currentUser.id).isPro }
      : resolveUser(userId);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ChatMessages({ chat }: { chat: PlanChat }) {
  const colors = useColors();
  const { currentUser } = useData();
  const resolveForDisplay = useResolveForDisplay();

  if (chat.denied) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="lock-closed-outline" size={40} color={colors.textDim} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Chat unavailable</Text>
        <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
          You no longer have access to this chat.
        </Text>
      </View>
    );
  }

  // Keep the spinner up through a slow-login auth race so a pre-token-restore
  // 401 never flashes a false "No messages yet".
  if ((chat.loading || chat.authPending) && chat.messages.length === 0) {
    return (
      <View style={styles.emptyState}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (chat.authError && chat.messages.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textDim} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn&apos;t load chat</Text>
        <TouchableOpacity onPress={chat.retry} style={[styles.retryBtn, { borderColor: colors.border }]}>
          <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (chat.messages.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="chatbubbles-outline" size={40} color={colors.textDim} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
        <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Say hi to your squad below</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {chat.hasMore ? (
        <TouchableOpacity
          onPress={() => void chat.loadOlder()}
          disabled={chat.loadingOlder}
          style={[styles.loadOlderBtn, { borderColor: colors.border }]}
        >
          {chat.loadingOlder ? (
            <ActivityIndicator size="small" color={colors.textDim} />
          ) : (
            <Text style={[styles.loadOlderText, { color: colors.primary }]}>Load earlier messages</Text>
          )}
        </TouchableOpacity>
      ) : null}
      {chat.messages.map((m) => {
        const sender = resolveForDisplay(m.senderId);
        const mine = m.senderId === currentUser.id;
        return (
          <View key={m.id} style={[styles.msgRow, mine && { flexDirection: "row-reverse" }]}>
            <UserAvatar initials={sender.initials} color={sender.color} imageUrl={sender.profileImageUrl} size={32} fontSize={11} />
            <View style={[styles.msgBubble, { backgroundColor: mine ? colors.primary : colors.card, borderColor: colors.border, opacity: m.pending ? 0.6 : 1 }]}>
              {!mine && <Text style={[styles.msgSender, { color: colors.mutedForeground }]}>{sender.name.split(" ")[0]}</Text>}
              <Text style={[styles.msgText, { color: mine ? "#fff" : colors.foreground }]}>{m.text}</Text>
              <Text style={[styles.msgTime, { color: mine ? "rgba(255,255,255,0.7)" : colors.textDim }]}>
                {formatTime(m.createdAt)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function ChatComposer({ chat, botPad }: { chat: PlanChat; botPad: number }) {
  const colors = useColors();
  const [chatText, setChatText] = useState("");

  const disabled = chat.denied || !chat.conversationId;

  const send = async () => {
    if (chat.sending || !chatText.trim()) return;
    const text = chatText.trim();
    setChatText("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await chat.send(text);
    if (result.error) {
      setChatText(text);
      Alert.alert("Couldn't send message", result.error);
    }
  };

  if (chat.denied) return null;

  return (
    <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: botPad + 10 }]}>
      <TextInput
        placeholder="Message your squad..."
        placeholderTextColor={colors.textDim}
        value={chatText}
        onChangeText={setChatText}
        editable={!disabled}
        style={[styles.composerInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
      />
      <TouchableOpacity
        onPress={send}
        disabled={disabled || chat.sending || !chatText.trim()}
        style={[styles.sendBtn, { backgroundColor: chatText.trim() && !chat.sending && !disabled ? colors.primary : colors.border }]}
      >
        {chat.sending ? (
          <ActivityIndicator size="small" color={colors.textDim} />
        ) : (
          <Ionicons name="send" size={18} color={chatText.trim() && !disabled ? "#fff" : colors.textDim} />
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "800" },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryBtn: { marginTop: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { fontSize: 14, fontWeight: "700" },
  loadOlderBtn: { alignSelf: "center", borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  loadOlderText: { fontSize: 13, fontWeight: "700" },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgBubble: { maxWidth: "78%", borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  msgSender: { fontSize: 11, fontWeight: "700", marginBottom: 2 },
  msgText: { fontSize: 14, lineHeight: 19 },
  msgTime: { fontSize: 10, marginTop: 3, alignSelf: "flex-end" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  composerInput: { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, height: 44, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
