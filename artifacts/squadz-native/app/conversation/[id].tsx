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
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { useConversationStream } from "@/hooks/useConversationStream";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { useToast } from "@/context/ToastContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import {
  useMessages,
  type ChatAttachment,
  type ChatMessage,
  type ChatParticipant,
} from "@/context/MessagesContext";
import AttachmentVideo from "@/components/AttachmentVideo";
import { ProAvatar } from "@/components/ProAvatar";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { stripImageExif } from "@/lib/imageUtils";
import { useUserCache } from "@/context/UserCacheContext";
// Shared auth-race guard (see lib/vaultAuthRace.ts). Opening a conversation
// directly on a cold start (deep link / push tap) can 401 before the token
// restores; keep the thread loading + retry instead of flashing "No messages
// yet" or an error.
import {
  INITIAL_AUTH_RACE_STATE,
  type AuthRaceState,
  applyVaultFetchOutcome,
  nextRetryDecision,
  resetAuthRaceState,
  vaultRenderMode,
} from "@/lib/vaultAuthRace";

const AVATAR_PALETTE = ["#FF6B2C", "#4A9EFF", "#2ECC8A", "#A855F7", "#FFB23E"];

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

/** Local YYYY-MM-DD key, used to detect day boundaries between messages. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Human date label for a day separator: Today / Yesterday / weekday / full date. */
function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
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
  const [loading, setLoading] = useState(true);
  const [authRace, setAuthRace] = useState<AuthRaceState>(INITIAL_AUTH_RACE_STATE);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  // Cursor pagination (infinite scroll up). hasMore/nextCursor track the OLDER
  // page; loadingOlder gates the spinner + double-fetch guard.
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Blocked-thread state for direct conversations — swaps the composer for a
  // neutral read-only notice (never reveals who blocked whom).
  const [blocked, setBlocked] = useState(false);
  const scrollRef = useRef<FlatList<ChatMessage>>(null);
  // Guards a concurrent older-page fetch (never double-fetch).
  const loadingOlderRef = useRef(false);
  // Set true right before prepending an older page so onContentSizeChange skips
  // its auto-scroll-to-end (position is preserved by maintainVisibleContentPosition).
  const skipAutoScrollRef = useRef(false);
  // Once the user has paged back, refreshes must not reset the cursor to the
  // latest page's oldest id (that would forget how far back we've loaded).
  const hasPagedRef = useRef(false);

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
    // `track` = feed the auth-race guard. The cold-start load + its retries pass
    // true (a pre-token-restore 401 keeps the screen loading instead of flashing
    // the empty state); silent SSE/poll refreshes pass false (a transient 401
    // there must not yank an already-populated thread back to a spinner).
    async (showSpinner: boolean, track = false) => {
      if (showSpinner) setLoading(true);
      const result = await fetchThread(conversationId);
      if (result.kind === "ok") {
        const data = result.data;
        setMessages((prev) => {
          const serverIds = new Set(data.messages.map((m) => m.id));
          // Preserve already-loaded OLDER pages (merge by id) so a poll/SSE
          // refresh of the latest page never wipes them out. Pending/failed
          // optimistic messages are kept and re-appended at the tail.
          const pending = prev.filter((m) => m.pending || m.failed);
          const olderKept = prev.filter(
            (m) => !m.pending && !m.failed && !serverIds.has(m.id),
          );
          const merged = [...olderKept, ...data.messages].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
          const keptPending = pending.filter((p) => !serverIds.has(p.id));
          return [...merged, ...keptPending];
        });
        setParticipants(data.participants);
        setConvType(data.conversation.type === "squad" ? "squad" : "direct");
        // Only seed hasMore/nextCursor from the latest page until the user has
        // paged back — after that, loadOlder owns the cursor.
        if (!hasPagedRef.current) {
          setHasMore(data.hasMore);
          setNextCursor(data.nextCursor);
        }
      }
      if (track) {
        setAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: result.kind }));
      }
      if (showSpinner) setLoading(false);
    },
    [conversationId, fetchThread],
  );

  useEffect(() => {
    // Reset per-conversation state when the screen instance is reused for a
    // different conversation — the blocked notice must never leak across threads.
    setBlocked(false);
    void loadThread(true, true);
    void markRead(conversationId);
  }, [loadThread, markRead, conversationId]);

  // Retry driver: while the initial load is auth-pending (401 before the token
  // restored), re-run it on a short cadence until an authenticated fetch lands,
  // then give up into a retryable error rather than an infinite spinner.
  useEffect(() => {
    const decision = nextRetryDecision(authRace);
    if (decision.action === "give-up") {
      setAuthRace(decision.next);
      return;
    }
    if (decision.action === "retry") {
      const t = setTimeout(() => { void loadThread(false, true); }, decision.delayMs);
      return () => clearTimeout(t);
    }
  }, [authRace, loadThread]);

  const retryThread = useCallback(() => {
    setAuthRace(resetAuthRaceState());
    void loadThread(true, true);
  }, [loadThread]);

  // Infinite scroll up: fetch the page of OLDER messages before nextCursor and
  // PREPEND them (merge by id). loadingOlderRef guards against double-fetch;
  // skipAutoScrollRef stops the content-size handler from yanking to the bottom
  // (position is preserved by maintainVisibleContentPosition).
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore || !nextCursor) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const result = await fetchThread(conversationId, nextCursor);
    if (result.kind === "ok") {
      const data = result.data;
      hasPagedRef.current = true;
      skipAutoScrollRef.current = true;
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id));
        const older = data.messages.filter((m) => !existing.has(m.id));
        return [...older, ...prev];
      });
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    }
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }, [conversationId, fetchThread, hasMore, nextCursor]);

  // Single source of truth for the thread body. `authPending` keeps us on the
  // spinner (never the empty state) during a slow-login auth race; "No messages
  // yet" is only reached for a genuine authenticated zero-message thread.
  const renderMode = vaultRenderMode({
    loading,
    authPending: authRace.authPending,
    authError: authRace.authError,
    photoCount: messages.length,
  });

  // SSE stream: instantly delivers new messages from other participants.
  // When a teammate sends a message, we re-fetch and mark the thread read.
  const { status: streamStatus, retry: retryStream } = useConversationStream({
    conversationId,
    authToken,
    onUpdate: useCallback(() => {
      void loadThread(false).then(() => markRead(conversationId));
    }, [loadThread, markRead, conversationId]),
  });
  // Only show "Reconnecting…" if the stream is still down after 3s.
  const showReconnecting = useDelayedFlag(streamStatus === "reconnecting", 3000);

  // 30 s safety-net poll: catches messages missed when the stream is
  // temporarily unavailable (network blip, proxy timeout, etc.).
  useEffect(() => {
    const interval = setInterval(() => {
      void loadThread(false).then(() => markRead(conversationId));
    }, 30000);
    return () => clearInterval(interval);
  }, [loadThread, markRead, conversationId]);

  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    // Only auto-scroll when the newest (last) message changes — appending a new
    // message at the tail or the initial load. Prepending an older page leaves
    // the last id unchanged, so it won't fire and yank the user to the bottom.
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [lastMessageId]);

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
        const { uri: uploadUri, mimeType: uploadMimeType } = !isVideo
          ? await stripImageExif(asset.uri, contentType)
          : { uri: asset.uri, mimeType: contentType };
        const fileRes = await fetch(uploadUri);
        const blob = await fileRes.blob();
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": uploadMimeType },
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

      const result = await sendMessage(conversationId, trimmed, attachments);
      if (result.ok) {
        // Server ack: swap the temp message for the real one.
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...result.message, pending: false } : m)),
        );
      } else if (result.blocked) {
        // Blocked thread: drop the optimistic message and swap the composer for
        // the neutral read-only state (direct conversations only).
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        if (convType === "direct") setBlocked(true);
        showToast("You can't message this person");
      } else {
        // Generic failure: mark the temp message failed (tap to resend/remove).
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
        );
        showToast("Message failed to send");
      }
    },
    [conversationId, currentUser.id, sendMessage, showToast, convType],
  );

  // Failed-send affordance: tap a failed bubble to resend (re-optimistic with a
  // fresh temp id) or remove it entirely.
  const handleFailedPress = useCallback(
    (m: ChatMessage) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Alert.alert("Message not sent", undefined, [
        {
          text: "Try again",
          onPress: () => {
            setMessages((prev) => prev.filter((x) => x.id !== m.id));
            void doSend(m.text, m.attachments);
          },
        },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => setMessages((prev) => prev.filter((x) => x.id !== m.id)),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [doSend],
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
      <TouchableOpacity
        key={key}
        activeOpacity={0.9}
        onPress={() => setViewer({ uri, headers: authHeaders() })}
        accessibilityRole="imagebutton"
        accessibilityLabel="Expand image"
      >
        <Image
          source={{ uri, headers: authHeaders() }}
          style={styles.attachment}
          contentFit="cover"
          transition={150}
        />
      </TouchableOpacity>
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
        {listItem?.type === "squad" && (
          <View
            style={[
              styles.headerAvatar,
              { backgroundColor: (listItem.color ?? colors.primary) + "22" },
            ]}
          >
            <Text style={{ fontSize: 18 }}>{listItem.emoji ?? "👥"}</Text>
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

      {/* Stream reconnecting indicator */}
      {showReconnecting && (
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
        {renderMode === "loading" ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : renderMode === "error" ? (
          <View style={styles.empty}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.textDim} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              Couldn't load messages
            </Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Check your connection and try again.
            </Text>
            <TouchableOpacity
              onPress={retryThread}
              style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="refresh-outline" size={18} color="#fff" />
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            ref={scrollRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              // Skip the auto-scroll-to-end when an older page was just prepended
              // (position is preserved by maintainVisibleContentPosition).
              if (skipAutoScrollRef.current) {
                skipAutoScrollRef.current = false;
                return;
              }
              scrollRef.current?.scrollToEnd({ animated: true });
            }}
            onScroll={(e) => {
              // Reaching the top of the (non-inverted) list loads the older page.
              if (e.nativeEvent.contentOffset.y <= 40) void loadOlder();
            }}
            scrollEventThrottle={16}
            maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
            ListHeaderComponent={
              loadingOlder ? (
                <View style={styles.olderSpinner}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : null
            }
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
                const prev = idx > 0 ? messages[idx - 1] : null;
                const showDate = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                return (
                  <View>
                    {showDate && (
                      <View style={styles.dateSeparator}>
                        <Text style={[styles.dateSeparatorText, { color: colors.mutedForeground, backgroundColor: colors.card }]}>
                          {formatDateSeparator(m.createdAt)}
                        </Text>
                      </View>
                    )}
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
                      <TouchableOpacity
                        style={{ maxWidth: "76%" }}
                        activeOpacity={mine && m.failed ? 0.7 : 1}
                        onPress={mine && m.failed ? () => handleFailedPress(m) : undefined}
                        onLongPress={!mine ? () => {
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          Alert.alert("", undefined, [
                            {
                              text: "Report message",
                              onPress: () =>
                                Alert.alert("Report message", "Why are you reporting this?", [
                                  {
                                    text: "Spam",
                                    onPress: () =>
                                      void fetch(`${API_BASE}/api/reports`, {
                                        method: "POST",
                                        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
                                        body: JSON.stringify({ contentType: "message", contentId: m.id, targetUserId: m.senderId, reason: "spam" }),
                                      }).then(() => Alert.alert("Report submitted", "Thanks for letting us know.")),
                                  },
                                  {
                                    text: "Inappropriate content",
                                    onPress: () =>
                                      void fetch(`${API_BASE}/api/reports`, {
                                        method: "POST",
                                        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
                                        body: JSON.stringify({ contentType: "message", contentId: m.id, targetUserId: m.senderId, reason: "inappropriate_content" }),
                                      }).then(() => Alert.alert("Report submitted", "Thanks for letting us know.")),
                                  },
                                  {
                                    text: "Harassment",
                                    onPress: () =>
                                      void fetch(`${API_BASE}/api/reports`, {
                                        method: "POST",
                                        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
                                        body: JSON.stringify({ contentType: "message", contentId: m.id, targetUserId: m.senderId, reason: "harassment" }),
                                      }).then(() => Alert.alert("Report submitted", "Thanks for letting us know.")),
                                  },
                                  {
                                    text: "Other",
                                    onPress: () =>
                                      void fetch(`${API_BASE}/api/reports`, {
                                        method: "POST",
                                        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
                                        body: JSON.stringify({ contentType: "message", contentId: m.id, targetUserId: m.senderId, reason: "other" }),
                                      }).then(() => Alert.alert("Report submitted", "Thanks for letting us know.")),
                                  },
                                  { text: "Cancel", style: "cancel" },
                                ]),
                            },
                            { text: "Cancel", style: "cancel" },
                          ]);
                        } : undefined}
                      >
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
                            <View style={styles.bubbleMeta}>
                              {m.pending && (
                                <Ionicons
                                  name="time-outline"
                                  size={11}
                                  color={mine ? "rgba(255,255,255,0.7)" : colors.textDim}
                                />
                              )}
                              {m.failed && (
                                <Ionicons
                                  name="alert-circle"
                                  size={12}
                                  color={mine ? "#fff" : colors.destructive}
                                />
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
                          </View>
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
                      </TouchableOpacity>
                    </View>
                  </View>
                );
            }}
          />
        )}

        {blocked && convType === "direct" ? (
          // Blocked thread: neutral read-only notice in place of the composer.
          // The thread above stays readable; never reveal who blocked whom.
          <View
            style={[
              styles.blockedNotice,
              {
                borderTopColor: colors.border,
                backgroundColor: colors.background,
                paddingBottom: botPad,
              },
            ]}
          >
            <Text style={[styles.blockedText, { color: colors.mutedForeground }]}>
              You can't message this person
            </Text>
          </View>
        ) : (
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
        )}
      </KeyboardAvoidingView>

      <ImageViewerModal
        visible={!!viewer}
        uri={viewer?.uri ?? null}
        headers={viewer?.headers}
        onClose={() => setViewer(null)}
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
  headerTitle: { fontSize: 17, fontWeight: "800" },
  headerSub: { fontSize: 12, marginTop: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "800" },
  emptySub: { fontSize: 14, textAlign: "center" },
  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, marginTop: 8,
  },
  retryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0,
  },
  avatarText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  bubble: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 9 },
  senderName: { fontSize: 11, fontWeight: "700", marginBottom: 3 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleMeta: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 5, alignSelf: "flex-end" },
  bubbleTime: { fontSize: 10 },
  olderSpinner: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  dateSeparator: { alignItems: "center", marginVertical: 8 },
  dateSeparatorText: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
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
  blockedNotice: {
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 24, paddingTop: 16, borderTopWidth: 1,
  },
  blockedText: { fontSize: 14, fontWeight: "600", textAlign: "center" },
});
