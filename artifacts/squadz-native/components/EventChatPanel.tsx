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
import type { Event } from "@/types";

/**
 * Shared per-event chat used by both the event and trip detail screens.
 * Split into the scrollable message list (rendered inside the screen's
 * ScrollView) and the sticky composer (rendered as a sibling pinned to the
 * bottom), so it slots into either screen's scroll architecture.
 */

function useResolveForDisplay() {
  const { currentUser } = useData();
  const { resolveUser } = useUserCache();
  return (userId: string): ResolvedUser =>
    userId === currentUser.id
      ? { ...(currentUser as unknown as ResolvedUser), isPro: resolveUser(currentUser.id).isPro }
      : resolveUser(userId);
}

export function ChatMessages({ event }: { event: Event }) {
  const colors = useColors();
  const { currentUser } = useData();
  const resolveForDisplay = useResolveForDisplay();

  if (event.messages.length === 0) {
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
      {event.messages.map((m) => {
        const sender = resolveForDisplay(m.senderId);
        const mine = m.senderId === currentUser.id;
        return (
          <View key={m.id} style={[styles.msgRow, mine && { flexDirection: "row-reverse" }]}>
            <UserAvatar initials={sender.initials} color={sender.color} imageUrl={sender.profileImageUrl} size={32} fontSize={11} />
            <View style={[styles.msgBubble, { backgroundColor: mine ? colors.primary : colors.card, borderColor: colors.border }]}>
              {!mine && <Text style={[styles.msgSender, { color: colors.mutedForeground }]}>{sender.name.split(" ")[0]}</Text>}
              <Text style={[styles.msgText, { color: mine ? "#fff" : colors.foreground }]}>{m.text}</Text>
              <Text style={[styles.msgTime, { color: mine ? "rgba(255,255,255,0.7)" : colors.textDim }]}>{m.time}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function ChatComposer({ event, botPad }: { event: Event; botPad: number }) {
  const colors = useColors();
  const { sendMessage } = useData();
  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);

  const send = async () => {
    if (chatSending || !chatText.trim()) return;
    const text = chatText.trim();
    setChatText("");
    setChatSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await sendMessage(event.id, text);
      if (result.error) {
        setChatText(text);
        Alert.alert("Couldn't send message", result.error);
      }
    } finally {
      setChatSending(false);
    }
  };

  return (
    <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: botPad + 10 }]}>
      <TextInput
        placeholder="Message your squad..."
        placeholderTextColor={colors.textDim}
        value={chatText}
        onChangeText={setChatText}
        style={[styles.composerInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
      />
      <TouchableOpacity
        onPress={send}
        disabled={chatSending || !chatText.trim()}
        style={[styles.sendBtn, { backgroundColor: chatText.trim() && !chatSending ? colors.primary : colors.border }]}
      >
        {chatSending ? (
          <ActivityIndicator size="small" color={colors.textDim} />
        ) : (
          <Ionicons name="send" size={18} color={chatText.trim() ? "#fff" : colors.textDim} />
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "800" },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgBubble: { maxWidth: "78%", borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  msgSender: { fontSize: 11, fontWeight: "700", marginBottom: 2 },
  msgText: { fontSize: 14, lineHeight: 19 },
  msgTime: { fontSize: 10, marginTop: 3, alignSelf: "flex-end" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  composerInput: { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, height: 44, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
