import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { useConversationStream } from "@/hooks/useConversationStream";
import { useToast } from "@/context/ToastContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import {
  useMessages,
  type ChatAttachment,
  type ChatMessage,
  type ChatParticipant,
} from "@/context/MessagesContext";
import AttachmentVideo from "@/components/AttachmentVideo";
import { UpgradeModal } from "@/components/UpgradeModal";
import { ProAvatar } from "@/components/ProAvatar";
import { useUserCache } from "@/context/UserCacheContext";

const AVATAR_PALETTE = ["#FF5C3A", "#4A9EFF", "#2ECC8A", "#A855F7", "#FFB547"];

function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function participantName(p: ChatParticipant | undefined): string {
  if (!p) return "Someone";
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (p.email) return p.email.split("@")[0];
  return "Someone";
}

function initialFor(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, authToken } = useAuth();
  const { conversations, fetchThread, sendMessage, markRead } = useMessages();
  const { showToast } = useToast();
  const { resolveUser, prefetchUsers } = useUserCache();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [convType, setConvType] = useState<"direct" | "squad">("direct");
  const [locked, setLocked] = useState(false);
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<FlatList<ChatMessage>>(null);

  const listItem = conversations.find((c) => c.id === conversationId);

  const authHeaders = useCallback(
    () => buildAuthHeaders(authToken),
    [authToken],
  );

  const participantMap = useMemo(() => {
    const m = new Map<string, ChatParticipant>();
    for (const p of participants) m.set(p.userId, p);
    return m;
  }, [participants]);

  // Resolve participants through the user cache so we can show the Pro gold
  // ring on sender avatars (the thread payload doesn't include isPro).
  useEffect(() => {
    if (participants.length > 0) {
      prefetchUsers(participants.map((p) => p.userId));
    }
  }, [participants, prefetchUsers]);

  const title = useMemo(() => {
    if (listItem) return listItem.title;
    if (convType === "direct") {
      const other = participants.find((p) => p.userId !== currentUser.id);
      return participantName(other);
    }
    return "Group chat";
  }, [listItem, convType, participants, currentUser.id]);

  const loadThread = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      const data = await fetchThread(conversationId);
      if (data) {
        setMessages((prev) => {
          const pending = prev.filter((m) => m.pending || m.failed);
          const serverIds = new Set(data.messages.map((m) => m.id));
          const keptPending = pending.filter((p) => !serverIds.has(p.id));
          return [...data.messages, ...keptPending];
        });
        setParticipants(data.participants);
        setConvType(data.conversation.type === "squad" ? "squad" : "direct");
        setLocked(Boolean(data.conversation.locked));
      }
      if (showSpinner) setLoading(false);
    },
    [conversationId, fetchThread],
  );

  useEffect(() => {
    void loadThread(true);
    void markRead(conversationId);
  }, [loadThread, markRead, conversationId]);

  // SSE stream: instantly delivers new messages from other participants.
  // When a teammate sends a message, we re-fetch and mark the thread read.
  const { status: streamStatus, retry: retryStream } = useConversationStream({
    conversationId,
    authToken,
    onUpdate: useCallback(() => {
      void loadThread(false).then(() => markRead(conversationId));
    }, [loadThread, markRead, conversationId]),
  });

  // 30 s safety-net poll: catches messages missed when the stream is
  // temporarily unavailable (network blip, proxy timeout, etc.).
  useEffect(() => {
    const interval = setInterval(() => {
      void loadThread(false).then(() => markRead(conversationId));
    }, 30000);
    return () => clearInterval(interval);
  }, [loadThread, markRead, conversationId]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  const uploadAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset): Promise<ChatAttachment | null> => {
      try {
        const isVideo = asset.type === "video";
        const contentType =
          asset.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg");
        const urlRes = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            name: asset.fileName ?? (isVideo ? "video.mp4" : "photo.jpg"),
            size: asset.fileSize ?? 0,
            contentType,
          }),
        });
        if (!urlRes.ok) return null;
        const { uploadURL, objectPath } = (await urlRes.json()) as {
          uploadURL: string;
          objectPath: string;
        };
        const fileRes = await fetch(asset.uri);
        const blob = await fileRes.blob();
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": contentType },
        });
        if (!putRes.ok) return null;
        return {
          kind: isVideo ? "video" : "image",
          url: objectPath,
          width: asset.width,
          height: asset.height,
        };
      } catch {
        return null;
      }
    },
    [authHeaders],
  );

  const doSend = useCallback(
    async (body: string, attachments: ChatAttachment[]) => {
      const trimmed = body.trim();
      if (!trimmed && attachments.length === 0) return;
      const tempId = `pending-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: tempId,
        conversationId,
        senderId: currentUser.id,
        text: trimmed,
        attachments,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const saved = await sendMessage(conversationId, trimmed, attachments);
      if (!saved) {
        showToast("Message failed to send");
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? saved
              ? { ...saved, pending: false }
              : { ...m, pending: false, failed: true }
            : m,
        ),
      );
    },
    [conversationId, currentUser.id, sendMessage, showToast],
  );

  const handleSendText = useCallback(() => {
    const body = text;
    if (!body.trim()) return;
    setText("");
    void doSend(body, []);
  }, [text, doSend]);

  const attachFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to attach media.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets.length) return;
    setUploading(true);
    const uploaded: ChatAttachment[] = [];
    for (const asset of result.assets) {
      const a = await uploadAsset(asset);
      if (a) uploaded.push(a);
    }
    setUploading(false);
    if (uploaded.length === 0) {
      Alert.alert("Upload failed", "Could not attach that media. Please try again.");
      return;
    }
    void doSend("", uploaded);
  }, [uploadAsset, doSend]);

  const captureMedia = useCallback(
    async (mode: "photo" | "video") => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow camera access to capture media.");
        return;
      }
      let result: ImagePicker.ImagePickerResult;
      try {
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: mode === "video" ? ["videos"] : ["images"],
          quality: 0.8,
        });
      } catch {
        // Some devices/simulators have no usable camera — fall back to the
        // photo library silently instead of surfacing an error.
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: mode === "video" ? ["videos"] : ["images"],
          quality: 0.8,
        });
      }
      if (result.canceled || !result.assets.length) return;
      setUploading(true);
      const a = await uploadAsset(result.assets[0]);
      setUploading(false);
      if (!a) {
        Alert.alert("Upload failed", "Could not send that capture. Please try again.");
        return;
      }
      void doSend("", [a]);
    },
    [uploadAsset, doSend],
  );

  const onAttachPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "web") {
      void attachFromLibrary();
      return;
    }
    Alert.alert("Add to chat", undefined, [
      { text: "Take Photo", onPress: () => captureMedia("photo") },
      { text: "Record Video", onPress: () => captureMedia("video") },
      { text: "Photo & Video Library", onPress: () => attachFromLibrary() },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [attachFromLibrary, captureMedia]);

  // Index of the last message authored by me (for the read receipt line).
  const lastMineIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].senderId === currentUser.id) return i;
    }
    return -1;
  }, [messages, currentUser.id]);

  const readReceipt = useCallback(
    (msg: ChatMessage): string | null => {
      if (msg.pending) return "Sending…";
      if (msg.failed) return "Failed to send";
      const others = participants.filter((p) => p.userId !== currentUser.id);
      const sentAt = new Date(msg.createdAt).getTime();
      const seenBy = others.filter(
        (p) => p.lastReadAt && new Date(p.lastReadAt).getTime() >= sentAt,
      );
      if (convType === "squad") {
        return seenBy.length > 0 ? `Seen by ${seenBy.length}` : "Sent";
      }
      return seenBy.length > 0 ? "Seen" : "Sent";
    },
    [participants, currentUser.id, convType],
  );

  const renderAttachment = (att: ChatAttachment, key: string) => {
    const uri = `${API_BASE}/api/storage${att.url}`;
    if (att.kind === "video") {
      return (
        <AttachmentVideo
          key={key}
          uri={uri}
          headers={authHeaders()}
          style={styles.attachment}
        />
      );
    }
    return (
      <Image
        key={key}
        source={{ uri, headers: authHeaders() }}
        style={styles.attachment}
        contentFit="cover"
        transition={150}
      />
    );
  };

  const topPad = insets.top + (Platform.OS === "web" ? 60 : 8);
  const botPad = insets.bottom + 8;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        {listItem?.type === "squad" ? (
          <View
            style={[
              styles.headerAvatar,
              { backgroundColor: (listItem.color ?? colors.primary) + "22" },
            ]}
          >
            <Text style={{ fontSize: 18 }}>{listItem.emoji ?? "👥"}</Text>
          </View>
        ) : (
          <View style={[styles.headerAvatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.headerAvatarText}>{initialFor(title)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          {convType === "squad" && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>
              {participants.length} members
            </Text>
          )}
        </View>
      </View>

      {/* DM gate banner — non-Pro users can't read direct messages */}
      {locked && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setUpgradeVisible(true);
          }}
          style={[styles.lockBanner, { backgroundColor: colors.primary + "14", borderBottomColor: colors.border }]}
        >
          <Ionicons name="lock-closed" size={15} color={colors.primary} />
          <Text style={[styles.lockBannerText, { color: colors.foreground }]} numberOfLines={1}>
            Direct messages are a Squadz+ feature
          </Text>
          <View style={[styles.lockBannerBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.lockBannerBtnText}>Unlock</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Stream reconnecting indicator */}
      {streamStatus === "reconnecting" && (
        <View style={styles.reconnectBanner} pointerEvents="none">
          <ActivityIndicator size="small" color="#6B7280" style={{ marginRight: 6 }} />
          <Text style={styles.reconnectBannerText}>Reconnecting…</Text>
        </View>
      )}
      {streamStatus === "error" && (
        <TouchableOpacity
          style={styles.reconnectBanner}
          onPress={retryStream}
          activeOpacity={0.7}
        >
          <Ionicons name="cloud-offline-outline" size={14} color="#6B7280" style={{ marginRight: 6 }} />
          <Text style={styles.reconnectBannerText}>Live updates unavailable · Tap to retry</Text>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
      >
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={scrollRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={11}
            removeClippedSubviews={Platform.OS !== "web"}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No messages yet
                </Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  Send the first message below
                </Text>
              </View>
            }
            renderItem={({ item: m, index: idx }) => {
                const mine = m.senderId === currentUser.id;
                const sender = participantMap.get(m.senderId);
                const senderName = participantName(sender);
                const showName = !mine && convType === "squad";
                const receipt = mine && idx === lastMineIndex ? readReceipt(m) : null;
                return (
                  <View>
                    <View style={[styles.msgRow, mine && { flexDirection: "row-reverse" }]}>
                      {!mine && (
                        <ProAvatar
                          initials={initialFor(senderName)}
                          color={colorForId(m.senderId)}
                          imageUrl={sender?.profileImageUrl}
                          size={30}
                          fontSize={12}
                          isPro={resolveUser(m.senderId).isPro}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            router.push(`/user/${m.senderId}` as never);
                          }}
                        />
                      )}
                      <View style={{ maxWidth: "76%" }}>
                        {m.locked ? (
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setUpgradeVisible(true);
                            }}
                            style={[
                              styles.bubble,
                              styles.lockedBubble,
                              {
                                backgroundColor: mine ? colors.primary : colors.card,
                                borderColor: colors.border,
                              },
                            ]}
                          >
                            {showName && (
                              <Text style={[styles.senderName, { color: colors.mutedForeground }]}>
                                {senderName.split(" ")[0]}
                              </Text>
                            )}
                            <View style={styles.lockedLines} pointerEvents="none">
                              <View
                                style={[
                                  styles.lockedLine,
                                  { width: 150, backgroundColor: mine ? "#ffffff66" : colors.textDim },
                                ]}
                              />
                              <View
                                style={[
                                  styles.lockedLine,
                                  { width: 96, backgroundColor: mine ? "#ffffff55" : colors.textDim },
                                ]}
                              />
                            </View>
                            <BlurView
                              intensity={18}
                              tint={mine ? "light" : "dark"}
                              style={StyleSheet.absoluteFill}
                              pointerEvents="none"
                            />
                            <View style={styles.lockBadge} pointerEvents="none">
                              <Ionicons
                                name="lock-closed"
                                size={15}
                                color={mine ? "#fff" : colors.primary}
                              />
                              <Text
                                style={[
                                  styles.lockBadgeText,
                                  { color: mine ? "#fff" : colors.foreground },
                                ]}
                              >
                                Tap to unlock
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ) : (
                          <View
                            style={[
                              styles.bubble,
                              {
                                backgroundColor: mine ? colors.primary : colors.card,
                                borderColor: colors.border,
                                opacity: m.pending ? 0.7 : 1,
                              },
                            ]}
                          >
                            {showName && (
                              <Text style={[styles.senderName, { color: colors.mutedForeground }]}>
                                {senderName.split(" ")[0]}
                              </Text>
                            )}
                            {m.attachments.map((att, i) =>
                              renderAttachment(att, `${m.id}-att-${i}`),
                            )}
                            {!!m.text && (
                              <Text
                                style={[
                                  styles.bubbleText,
                                  { color: mine ? "#fff" : colors.foreground },
                                  m.attachments.length > 0 && { marginTop: 8 },
                                ]}
                              >
                                {m.text}
                              </Text>
                            )}
                            <Text
                              style={[
                                styles.bubbleTime,
                                { color: mine ? "rgba(255,255,255,0.7)" : colors.textDim },
                              ]}
                            >
                              {formatTime(m.createdAt)}
                            </Text>
                          </View>
                        )}
                        {receipt && (
                          <Text
                            style={[
                              styles.receipt,
                              { color: m.failed ? colors.destructive : colors.textDim },
                            ]}
                          >
                            {receipt}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
            }}
          />
        )}

        <View
          style={[
            styles.composer,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.background,
              paddingBottom: botPad,
            },
          ]}
        >
          <TouchableOpacity
            onPress={onAttachPress}
            disabled={uploading}
            style={[styles.attachBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="add" size={22} color={colors.primary} />
            )}
          </TouchableOpacity>
          <TextInput
            placeholder="Message…"
            placeholderTextColor={colors.textDim}
            value={text}
            onChangeText={setText}
            multiline
            style={[
              styles.input,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
            ]}
          />
          <TouchableOpacity
            onPress={handleSendText}
            disabled={!text.trim()}
            style={[styles.sendBtn, { backgroundColor: text.trim() ? colors.primary : colors.border }]}
          >
            <Ionicons name="send" size={18} color={text.trim() ? "#fff" : colors.textDim} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <UpgradeModal
        visible={upgradeVisible}
        trigger="dm_gate"
        onClose={() => setUpgradeVisible(false)}
        onUpgradeSuccess={() => {
          setUpgradeVisible(false);
          void loadThread(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn: { padding: 2 },
  headerAvatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  headerAvatarText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  headerTitle: { fontSize: 17, fontWeight: "800" },
  headerSub: { fontSize: 12, marginTop: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "800" },
  emptySub: { fontSize: 14, textAlign: "center" },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0,
  },
  avatarText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  bubble: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9 },
  lockedBubble: { overflow: "hidden", minWidth: 170, justifyContent: "center" },
  lockedLines: { gap: 7, paddingVertical: 2 },
  lockedLine: { height: 9, borderRadius: 5, opacity: 0.5 },
  lockBadge: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  lockBadgeText: { fontSize: 12.5, fontWeight: "700" },
  lockBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1,
  },
  lockBannerText: { flex: 1, fontSize: 13, fontWeight: "600" },
  lockBannerBtn: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 5 },
  lockBannerBtnText: { color: "#fff", fontSize: 12.5, fontWeight: "800" },
  senderName: { fontSize: 11, fontWeight: "700", marginBottom: 3 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTime: { fontSize: 10, marginTop: 5, alignSelf: "flex-end" },
  attachment: { width: 200, height: 200, borderRadius: 12, backgroundColor: "#000" },
  receipt: { fontSize: 11, marginTop: 3, marginRight: 4, alignSelf: "flex-end", fontWeight: "600" },
  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1,
  },
  attachBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  input: {
    flex: 1, borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 10 : 6,
    fontSize: 15, maxHeight: 110,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  reconnectBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 6, backgroundColor: "#6B728012",
  },
  reconnectBannerText: { fontSize: 12, fontWeight: "600", color: "#6B7280", letterSpacing: 0.2 },
});
