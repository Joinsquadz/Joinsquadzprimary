import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
  RefreshControl,
  ActivityIndicator,
  AppState,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import AttachmentVideo from "@/components/AttachmentVideo";
import { useColors } from "@/hooks/useColors";
import { renderKeyboardAwareScroll } from "@/components/KeyboardAwareScrollViewCompat";
import { useAuth, useData } from "@/context/AppContext";
import { useUserCache } from "@/context/UserCacheContext";
import { ProAvatar } from "@/components/ProAvatar";
import { Bounceable } from "@/components/Bounceable";
import { AnimatedCount } from "@/components/AnimatedCount";
import { SnapConfirm, type SnapConfirmHandle } from "@/components/SnapConfirm";
import { MomentsRingRow } from "@/components/MomentsRingRow";
import { MediaUploadError, uploadMediaDirect } from "@/lib/mediaUpload";
import { LiveStatusBanner } from "@/components/LiveStatusBanner";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
// Shared auth-race guard (see lib/vaultAuthRace.ts). A cold-start / slow-login
// 401 on the feed fetch must keep this screen loading instead of flashing the
// "No vibes yet" empty state before the auth token finishes restoring.
import {
  INITIAL_AUTH_RACE_STATE,
  applyVaultFetchOutcome,
  nextRetryDecision,
  resetAuthRaceState,
  vaultRenderMode,
  type AuthRaceState,
} from "@/lib/vaultAuthRace";

// ── types ─────────────────────────────────────────────────────────────────────
type FeedPost = {
  id: string;
  authorId: string;
  text: string;
  audience: string; // "friends" | squadId
  mediaUrl: string | null;
  mediaType: "photo" | "video" | null;
  durationMs: number | null;
  createdAt: string;
  reactions: Record<string, number>;
  myReactions: string[];
  commentCount: number;
  canDelete: boolean;
};

type PickedMedia = {
  uri: string;
  mediaType: "photo" | "video";
  fileName: string;
  mimeType: string;
  fileSize: number;
  durationMs: number | null;
};

type FeedComment = {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
};

const REACTION_EMOJIS = ["❤️", "🔥", "😂", "👏", "😮", "😢"];

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

const MAX_STREAM_RETRIES = 10;

export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, authToken } = useAuth();
  const { squads } = useData();
  const { resolveUser, prefetchUsers } = useUserCache();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 100);

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedAuth, setFeedAuth] = useState<AuthRaceState>(INITIAL_AUTH_RACE_STATE);
  const [refreshing, setRefreshing] = useState(false);
  const [momentsReload, setMomentsReload] = useState(0);

  // composer
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [picked, setPicked] = useState<PickedMedia | null>(null);
  const composerRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<FeedPost>>(null);
  const snapRef = useRef<SnapConfirmHandle>(null);

  const focusComposer = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    composerRef.current?.focus();
  }, []);

  const mediaSrc = useCallback((path: string) => `${API_BASE}/api/storage${path}`, []);

  // comments
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, FeedComment[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSending, setCommentSending] = useState(false);

  // editing your own post
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // ── data fetching ─────────────────────────────────────────────────────────
  const fetchFeed = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/feed`, { headers: buildAuthHeaders(authToken) });
      // A 401 here almost always means the auth token hasn't finished restoring
      // yet (cold start / slow login / token-refresh race). Treat it as "still
      // loading" and schedule a retry instead of falling through to the "No
      // vibes yet" empty state, which would falsely claim the feed is empty.
      if (res.status === 401) {
        setFeedAuth((prev) => applyVaultFetchOutcome(prev, { kind: "unauthorized" }));
        return;
      }
      if (!res.ok) {
        // Non-401 failure. If we're mid auth-race retry, keep the bounded loop
        // going so a transient blip doesn't strand us on a permanent spinner.
        setFeedAuth((prev) => applyVaultFetchOutcome(prev, { kind: "failure" }));
        return;
      }
      const data = (await res.json()) as { posts: FeedPost[] };
      setPosts(data.posts ?? []);
      setFeedAuth((prev) => applyVaultFetchOutcome(prev, { kind: "ok" }));
    } catch {
      // Network unavailable — keep current posts; don't strand an auth retry.
      setFeedAuth((prev) => applyVaultFetchOutcome(prev, { kind: "failure" }));
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  // Manual retry after the auth-race retries were exhausted. Clears the error,
  // resets the attempt counter, and kicks off a fresh fetch (which re-arms the
  // retry loop if it 401s again).
  const retryFeed = useCallback(() => {
    setFeedAuth(resetAuthRaceState());
    void fetchFeed();
  }, [fetchFeed]);

  const fetchComments = useCallback(
    async (postId: string) => {
      if (!authToken) return;
      try {
        const res = await fetch(`${API_BASE}/api/feed/posts/${postId}/comments`, {
          headers: buildAuthHeaders(authToken),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { comments: FeedComment[] };
        setCommentsByPost((prev) => ({ ...prev, [postId]: data.comments ?? [] }));
      } catch {
        // ignore
      }
    },
    [authToken],
  );

  useFocusEffect(
    useCallback(() => {
      void fetchFeed();
    }, [fetchFeed]),
  );

  // Pre-load author profiles for avatars/names.
  useEffect(() => {
    const ids = new Set<string>();
    posts.forEach((p) => ids.add(p.authorId));
    Object.values(commentsByPost).forEach((list) => list.forEach((c) => ids.add(c.authorId)));
    if (ids.size > 0) prefetchUsers(Array.from(ids));
  }, [posts, commentsByPost, prefetchUsers]);

  // Retry driver for the feed: while a fetch is auth-pending (401 seen before
  // the token restored) re-run it on a short delay. Re-runs whenever the token
  // changes (immediate retry once it lands) or the tick advances (a fresh 401
  // came back). After a bounded number of attempts we give up and surface a
  // retryable error rather than an infinite spinner.
  useEffect(() => {
    const decision = nextRetryDecision(feedAuth);
    if (decision.action === "give-up") {
      setFeedAuth(decision.next);
      return;
    }
    if (decision.action === "retry") {
      const t = setTimeout(() => { void fetchFeed(); }, decision.delayMs);
      return () => clearTimeout(t);
    }
  }, [feedAuth, authToken, fetchFeed]);

  // Single source of truth for the feed body. `authPending` keeps us on the
  // spinner (never the empty state) during a slow-login auth race; the "No vibes
  // yet" empty is only reached for a genuine authenticated zero result.
  const renderMode = vaultRenderMode({
    loading,
    authPending: feedAuth.authPending,
    authError: feedAuth.authError,
    photoCount: posts.length,
  });

  // ── live SSE stream ───────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const focusedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const connectRef = useRef<() => void>(() => {});
  const openCommentsRef = useRef<string | null>(null);
  openCommentsRef.current = openComments;

  const connect = useCallback(() => {
    if (!authToken) return;

    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    const scheduleRetry = () => {
      if (controller.signal.aborted || !focusedRef.current) return;
      retryCountRef.current += 1;
      if (retryCountRef.current > MAX_STREAM_RETRIES) return;
      const delay = Math.min(1000 * 2 ** (retryCountRef.current - 1), 30_000);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (focusedRef.current) connectRef.current();
      }, delay);
    };

    const run = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/feed/stream`, {
          headers: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            ...buildAuthHeaders(authToken),
          },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          scheduleRetry();
          return;
        }
        retryCountRef.current = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            if (block.includes("event: update")) {
              void fetchFeed();
              setMomentsReload((n) => n + 1);
              const open = openCommentsRef.current;
              if (open) void fetchComments(open);
            }
          }
        }
        reader.releaseLock();
        scheduleRetry();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        scheduleRetry();
      }
    };

    void run();
  }, [authToken, fetchFeed, fetchComments]);

  connectRef.current = connect;

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      retryCountRef.current = 0;
      connect();
      return () => {
        focusedRef.current = false;
        if (retryTimerRef.current !== null) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        abortRef.current?.abort();
        abortRef.current = null;
      };
    }, [connect]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && focusedRef.current) {
        retryCountRef.current = 0;
        connect();
      }
    });
    return () => sub.remove();
  }, [connect]);

  // ── actions ───────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchFeed();
    setRefreshing(false);
  }, [fetchFeed]);

  const runPicker = useCallback(
    async (source: "camera" | "library", kind: "photo" | "video") => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission needed", "Allow camera access to capture a photo or clip.");
          return;
        }
        try {
          result = await ImagePicker.launchCameraAsync({
            mediaTypes: kind === "video" ? ["videos"] : ["images"],
            quality: 0.8,
          });
        } catch {
          // Some devices/simulators have no usable camera — fall back to the
          // photo library silently instead of surfacing an error.
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: kind === "video" ? ["videos"] : ["images"],
            allowsMultipleSelection: false,
            quality: 0.8,
          });
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission needed", "Allow photo library access to share media.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images", "videos"],
          allowsMultipleSelection: false,
          quality: 0.8,
        });
      }
      if (result.canceled || !result.assets.length) return;
      const asset = result.assets[0];
      const isVideo = kind === "video" || asset.type === "video";
      const durationMs = asset.duration ?? null;
      // No duration cap — clips are limited by file size (150 MB), enforced
      // against the real byte size at upload time in handlePost.
      setPicked({
        uri: asset.uri,
        mediaType: isVideo ? "video" : "photo",
        fileName: asset.fileName ?? (isVideo ? "vibe.mp4" : "vibe.jpg"),
        mimeType: asset.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg"),
        fileSize: asset.fileSize ?? 0,
        durationMs: isVideo ? durationMs : null,
      });
    },
    [],
  );

  const handleAddMedia = useCallback(() => {
    if (Platform.OS === "web") {
      void runPicker("library", "photo");
      return;
    }
    Alert.alert("Add to your vibe", undefined, [
      { text: "Take Photo", onPress: () => void runPicker("camera", "photo") },
      { text: "Record Clip", onPress: () => void runPicker("camera", "video") },
      { text: "Choose from Library", onPress: () => void runPicker("library", "photo") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [runPicker]);

  const handlePost = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !picked) || posting) return;
    setPosting(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      let media: { mediaUrl: string; mediaType: "photo" | "video"; durationMs?: number } | null =
        null;

      if (picked) {
        const { objectPath } = await uploadMediaDirect({
          uri: picked.uri,
          fileName: picked.fileName,
          mimeType: picked.mimeType,
          fallbackSize: picked.fileSize,
          authToken,
          surface: "feed",
        });
        media = {
          mediaUrl: objectPath,
          mediaType: picked.mediaType,
          ...(picked.mediaType === "video" && picked.durationMs
            ? { durationMs: Math.round(picked.durationMs) }
            : {}),
        };
      }

      // 3. Create the post.
      const res = await fetch(`${API_BASE}/api/feed/posts`, {
        method: "POST",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(media ?? {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        Alert.alert("Couldn't post", body.error ?? "Please try again.");
        return;
      }
      setDraft("");
      setPicked(null);
      snapRef.current?.snap("Posted!");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await fetchFeed();
    } catch (error) {
      if (error instanceof MediaUploadError && error.kind === "too_large") {
        Alert.alert("Too large", "Photos and videos must be 150 MB or smaller. Try a shorter clip.");
        return;
      }
      Alert.alert("Couldn't post", "Please check your connection and try again.");
    } finally {
      setPosting(false);
    }
  }, [draft, picked, posting, authToken, fetchFeed]);

  const handleToggleReaction = useCallback(
    async (post: FeedPost, emoji: string) => {
      const mine = post.myReactions.includes(emoji);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // optimistic
      setPosts((prev) =>
        prev.map((p) => {
          if (p.id !== post.id) return p;
          const counts = { ...p.reactions };
          const myReactions = mine
            ? p.myReactions.filter((e) => e !== emoji)
            : [...p.myReactions, emoji];
          const nextCount = (counts[emoji] ?? 0) + (mine ? -1 : 1);
          if (nextCount <= 0) delete counts[emoji];
          else counts[emoji] = nextCount;
          return { ...p, reactions: counts, myReactions };
        }),
      );

      try {
        if (mine) {
          await fetch(
            `${API_BASE}/api/feed/posts/${post.id}/reactions/${encodeURIComponent(emoji)}`,
            { method: "DELETE", headers: buildAuthHeaders(authToken) },
          );
        } else {
          await fetch(`${API_BASE}/api/feed/posts/${post.id}/reactions`, {
            method: "POST",
            headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
            body: JSON.stringify({ emoji }),
          });
        }
      } catch {
        void fetchFeed();
      }
    },
    [authToken, fetchFeed],
  );

  const handleDeletePost = useCallback(
    (post: FeedPost) => {
      Alert.alert("Delete post?", "This can't be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setPosts((prev) => prev.filter((p) => p.id !== post.id));
            void (async () => {
              try {
                await fetch(`${API_BASE}/api/feed/posts/${post.id}`, {
                  method: "DELETE",
                  headers: buildAuthHeaders(authToken),
                });
              } catch {
                void fetchFeed();
              }
            })();
          },
        },
      ]);
    },
    [authToken, fetchFeed],
  );

  const handleStartEdit = useCallback((post: FeedPost) => {
    void Haptics.selectionAsync();
    setEditingPostId(post.id);
    setEditDraft(post.text);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingPostId(null);
    setEditDraft("");
  }, []);

  const handleSaveEdit = useCallback(
    async (post: FeedPost) => {
      const text = editDraft.trim();
      if (editSaving) return;
      if (!text && !post.mediaUrl) {
        Alert.alert("Can't save", "A post needs text or media.");
        return;
      }
      if (text === post.text) {
        handleCancelEdit();
        return;
      }
      setEditSaving(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // optimistic
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, text } : p)));
      try {
        const res = await fetch(`${API_BASE}/api/feed/posts/${post.id}`, {
          method: "PATCH",
          headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          Alert.alert("Couldn't save", body.error ?? "Please try again.");
          void fetchFeed();
          return;
        }
        setEditingPostId(null);
        setEditDraft("");
      } catch {
        Alert.alert("Couldn't save", "Please check your connection and try again.");
        void fetchFeed();
      } finally {
        setEditSaving(false);
      }
    },
    [editDraft, editSaving, authToken, fetchFeed, handleCancelEdit],
  );

  const submitReport = useCallback(
    async (post: FeedPost, reason: "spam" | "inappropriate_content" | "harassment" | "other") => {
      try {
        await fetch(`${API_BASE}/api/reports`, {
          method: "POST",
          headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: "post",
            contentId: post.id,
            targetUserId: post.authorId,
            reason,
          }),
        });
        Alert.alert("Report submitted", "Thanks for letting us know. We'll review this post.");
      } catch {
        Alert.alert("Couldn't submit report", "Please check your connection and try again.");
      }
    },
    [authToken],
  );

  const handleReportPost = useCallback(
    (post: FeedPost) => {
      Alert.alert("Report post", "Why are you reporting this?", [
        { text: "Spam", onPress: () => void submitReport(post, "spam") },
        { text: "Inappropriate content", onPress: () => void submitReport(post, "inappropriate_content") },
        { text: "Harassment", onPress: () => void submitReport(post, "harassment") },
        { text: "Other", onPress: () => void submitReport(post, "other") },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [submitReport],
  );

  const handleBlockUser = useCallback(
    (userId: string) => {
      Alert.alert("Block user?", "They won't be able to see your posts and you won't see theirs.", [
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await fetch(`${API_BASE}/api/users/${userId}/block`, {
                method: "POST",
                headers: buildAuthHeaders(authToken),
              });
              // Refresh the feed so blocked user's posts disappear.
              await fetchFeed();
            } catch {
              Alert.alert("Couldn't block user", "Please check your connection and try again.");
            }
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [authToken, fetchFeed],
  );

  const handlePostMenu = useCallback(
    (post: FeedPost) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (post.canDelete) {
        Alert.alert("Post options", undefined, [
          { text: "Edit", onPress: () => handleStartEdit(post) },
          { text: "Delete", style: "destructive", onPress: () => handleDeletePost(post) },
          { text: "Cancel", style: "cancel" },
        ]);
      } else {
        Alert.alert("", undefined, [
          { text: "Report", onPress: () => handleReportPost(post) },
          { text: "Block user", style: "destructive", onPress: () => handleBlockUser(post.authorId) },
          { text: "Cancel", style: "cancel" },
        ]);
      }
    },
    [handleStartEdit, handleDeletePost, handleReportPost, handleBlockUser],
  );

  const toggleComments = useCallback(
    (postId: string) => {
      setOpenComments((prev) => {
        const next = prev === postId ? null : postId;
        if (next && !commentsByPost[next]) void fetchComments(next);
        return next;
      });
      setCommentDraft("");
    },
    [commentsByPost, fetchComments],
  );

  const handleSendComment = useCallback(
    async (postId: string) => {
      const text = commentDraft.trim();
      if (!text || commentSending) return;
      setCommentSending(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const res = await fetch(`${API_BASE}/api/feed/posts/${postId}/comments`, {
          method: "POST",
          headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return;
        const comment = (await res.json()) as FeedComment;
        setCommentsByPost((prev) => ({
          ...prev,
          [postId]: [...(prev[postId] ?? []), comment],
        }));
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p)),
        );
        setCommentDraft("");
      } catch {
        // ignore
      } finally {
        setCommentSending(false);
      }
    },
    [commentDraft, commentSending, authToken],
  );

  const audienceLabel = useCallback(
    (aud: string): string => {
      if (aud === "friends") return "Friends";
      const squad = squads.find((s) => s.id === aud);
      return squad ? `${squad.emoji} ${squad.name}` : "Squad";
    },
    [squads],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <SnapConfirm ref={snapRef} />
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Vibe</Text>
        <TouchableOpacity
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/profile");
          }}
          style={styles.profileBtn}
          hitSlop={8}
        >
          <ProAvatar
            initials={currentUser.initials}
            color={currentUser.color}
            imageUrl={currentUser.profileImageUrl}
            size={34}
            fontSize={13}
          />
        </TouchableOpacity>
      </View>

      <LiveStatusBanner />

      <FlatList
        ref={listRef}
        data={renderMode === "content" ? posts : []}
        keyExtractor={(post) => post.id}
        contentContainerStyle={{ paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        renderScrollComponent={renderKeyboardAwareScroll}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={11}
        removeClippedSubviews={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <>
            {/* Moments ring row (friends + squad — the single Moments surface) */}
            <MomentsRingRow mode="feed" reloadKey={momentsReload} />

            {/* Composer */}
            <View style={[styles.composer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.composerTop}>
            <ProAvatar
              initials={currentUser.initials}
              color={currentUser.color}
              imageUrl={currentUser.profileImageUrl}
              size={38}
              fontSize={14}
            />
            <TextInput
              ref={composerRef}
              style={[styles.composerInput, { color: colors.foreground }]}
              placeholder="What's the vibe?"
              placeholderTextColor={colors.mutedForeground}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={1000}
            />
          </View>

          {picked && (
            <View style={[styles.mediaPreview, { borderColor: colors.border }]}>
              {picked.mediaType === "video" ? (
                <AttachmentVideo uri={picked.uri} style={StyleSheet.absoluteFillObject} />
              ) : (
                <Image
                  source={{ uri: picked.uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
              )}
              <TouchableOpacity
                style={styles.mediaClearBtn}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setPicked(null);
                }}
                hitSlop={8}
              >
                <Ionicons name="close" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.composerActions}>
            <TouchableOpacity
              onPress={handleAddMedia}
              disabled={posting}
              style={[styles.attachBtn, { borderColor: colors.border }]}
              activeOpacity={0.7}
              hitSlop={6}
            >
              <Ionicons name="image-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            <Text style={[styles.composerHint, { color: colors.textDim }]}>
              Sharing with friends
            </Text>
            <TouchableOpacity
              onPress={() => void handlePost()}
              disabled={(!draft.trim() && !picked) || posting}
              style={[
                styles.postBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: (!draft.trim() && !picked) || posting ? 0.5 : 1,
                },
              ]}
              activeOpacity={0.85}
            >
              {posting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.postBtnText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
            </View>
          </>
        }
        ListEmptyComponent={
          renderMode === "loading" ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : renderMode === "error" ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={48} color={colors.textDim} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load your feed</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Check your connection and try again.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  retryFeed();
                }}
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="refresh-outline" size={18} color="#fff" />
                <Text style={styles.emptyBtnText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={{ fontSize: 52, marginBottom: 14 }}>✨</Text>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No vibes yet</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Be the first to post. Share what's going on with your friends and squads.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  focusComposer();
                }}
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={styles.emptyBtnText}>Post a Vibe</Text>
              </TouchableOpacity>
            </View>
          )
        }
        renderItem={({ item: post }) => {
          const author = resolveUser(post.authorId);
          const commentsOpen = openComments === post.id;
          const comments = commentsByPost[post.id] ?? [];
          return (
              <View
                style={[styles.post, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                {/* author row */}
                <View style={styles.postHeader}>
                  <ProAvatar
                    initials={author.initials}
                    color={author.color}
                    imageUrl={author.profileImageUrl}
                    size={40}
                    fontSize={14}
                    isPro={author.isPro}
                    onPress={
                      post.authorId !== currentUser.id
                        ? () => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            router.push(`/user/${post.authorId}` as never);
                          }
                        : undefined
                    }
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.postAuthor, { color: colors.foreground }]} numberOfLines={1}>
                      {author.name}
                    </Text>
                    <Text style={[styles.postMeta, { color: colors.mutedForeground }]}>
                      {audienceLabel(post.audience)} · {timeAgo(post.createdAt)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handlePostMenu(post)} hitSlop={8}>
                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>

                {editingPostId === post.id ? (
                  <View style={styles.editBox}>
                    <TextInput
                      style={[
                        styles.editInput,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                      value={editDraft}
                      onChangeText={setEditDraft}
                      placeholder="What's the vibe?"
                      placeholderTextColor={colors.mutedForeground}
                      multiline
                      maxLength={1000}
                      autoFocus
                    />
                    <View style={styles.editActions}>
                      <TouchableOpacity
                        onPress={handleCancelEdit}
                        disabled={editSaving}
                        style={[styles.editBtn, { borderColor: colors.border }]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.editBtnText, { color: colors.mutedForeground }]}>
                          Cancel
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => void handleSaveEdit(post)}
                        disabled={editSaving}
                        style={[
                          styles.editBtn,
                          { backgroundColor: colors.primary, opacity: editSaving ? 0.5 : 1 },
                        ]}
                        activeOpacity={0.85}
                      >
                        {editSaving ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={[styles.editBtnText, { color: "#fff" }]}>Save</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  post.text.length > 0 && (
                    <Text style={[styles.postText, { color: colors.foreground }]}>{post.text}</Text>
                  )
                )}

                {post.mediaUrl && (
                  <View style={[styles.postMedia, { borderColor: colors.border }]}>
                    {post.mediaType === "video" ? (
                      <AttachmentVideo
                        uri={mediaSrc(post.mediaUrl)}
                        headers={buildAuthHeaders(authToken) as Record<string, string>}
                        style={StyleSheet.absoluteFillObject}
                      />
                    ) : (
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => setExpandedImage(mediaSrc(post.mediaUrl!))}
                        style={StyleSheet.absoluteFill}
                        accessibilityRole="imagebutton"
                        accessibilityLabel="Expand photo"
                      >
                        <Image
                          source={{
                            uri: mediaSrc(post.mediaUrl),
                            headers: buildAuthHeaders(authToken) as Record<string, string>,
                          }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* reactions */}
                <View style={styles.reactionRow}>
                  {REACTION_EMOJIS.map((emoji) => {
                    const count = post.reactions[emoji] ?? 0;
                    const mine = post.myReactions.includes(emoji);
                    return (
                      <Bounceable
                        key={emoji}
                        onPress={() => void handleToggleReaction(post, emoji)}
                        style={[
                          styles.reactionChip,
                          {
                            backgroundColor: mine ? colors.primary + "22" : colors.background,
                            borderColor: mine ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 14 }}>{emoji}</Text>
                        {count > 0 && (
                          <AnimatedCount
                            value={count}
                            style={[
                              styles.reactionCount,
                              { color: mine ? colors.primary : colors.mutedForeground },
                            ]}
                          />
                        )}
                      </Bounceable>
                    );
                  })}
                </View>

                {/* comment toggle */}
                <TouchableOpacity
                  onPress={() => toggleComments(post.id)}
                  style={styles.commentToggle}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={commentsOpen ? "chatbubble" : "chatbubble-outline"}
                    size={16}
                    color={colors.mutedForeground}
                  />
                  <Text style={[styles.commentToggleText, { color: colors.mutedForeground }]}>
                    {post.commentCount > 0
                      ? `${post.commentCount} comment${post.commentCount !== 1 ? "s" : ""}`
                      : "Comment"}
                  </Text>
                </TouchableOpacity>

                {/* comment thread */}
                {commentsOpen && (
                  <View style={[styles.commentSection, { borderTopColor: colors.border }]}>
                    {comments.map((c) => {
                      const cu = resolveUser(c.authorId);
                      return (
                        <View key={c.id} style={styles.commentRow}>
                          <ProAvatar
                            initials={cu.initials}
                            color={cu.color}
                            imageUrl={cu.profileImageUrl}
                            size={28}
                            fontSize={11}
                            isPro={cu.isPro}
                            onPress={
                              c.authorId !== currentUser.id
                                ? () => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    router.push(`/user/${c.authorId}` as never);
                                  }
                                : undefined
                            }
                          />
                          <View style={[styles.commentBubble, { backgroundColor: colors.background }]}>
                            <Text style={[styles.commentAuthor, { color: colors.foreground }]}>
                              {cu.name}
                              <Text style={[styles.commentTime, { color: colors.textDim }]}>
                                {"  "}
                                {timeAgo(c.createdAt)}
                              </Text>
                            </Text>
                            <Text style={[styles.commentText, { color: colors.foreground }]}>{c.text}</Text>
                          </View>
                        </View>
                      );
                    })}

                    <View style={styles.commentComposer}>
                      <TextInput
                        style={[
                          styles.commentInput,
                          { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
                        ]}
                        placeholder="Add a comment…"
                        placeholderTextColor={colors.mutedForeground}
                        value={commentDraft}
                        onChangeText={setCommentDraft}
                        multiline
                        maxLength={500}
                      />
                      <TouchableOpacity
                        onPress={() => void handleSendComment(post.id)}
                        disabled={!commentDraft.trim() || commentSending}
                        style={{ opacity: !commentDraft.trim() || commentSending ? 0.4 : 1 }}
                        hitSlop={8}
                      >
                        <Ionicons name="send" size={20} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          }}
        />
      <ImageViewerModal
        visible={!!expandedImage}
        uri={expandedImage}
        headers={buildAuthHeaders(authToken) as Record<string, string>}
        onClose={() => setExpandedImage(null)}
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
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 28, fontWeight: "900" },
  profileBtn: { borderRadius: 20 },

  composer: {
    margin: 16,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  composerTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  composerInput: {
    flex: 1,
    fontSize: 16,
    paddingTop: Platform.OS === "ios" ? 8 : 4,
    minHeight: 40,
    maxHeight: 140,
  },
  audienceRow: { gap: 8, paddingRight: 4 },
  audienceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 160,
  },
  audienceChipText: { fontSize: 13, fontWeight: "700" },
  composerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  composerHint: { fontSize: 12, fontWeight: "600", flex: 1 },
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  mediaPreview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
    backgroundColor: "#000",
  },
  mediaClearBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  postBtn: {
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
  },
  postBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  loading: { paddingTop: 60, alignItems: "center" },
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 999,
  },
  emptyBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  post: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  postHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  postAuthor: { fontSize: 15, fontWeight: "700" },
  postMeta: { fontSize: 12, fontWeight: "500", marginTop: 1 },
  postText: { fontSize: 15.5, lineHeight: 22 },
  editBox: { gap: 10 },
  editInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15.5,
    minHeight: 60,
    maxHeight: 160,
  },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  editBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
  },
  editBtnText: { fontSize: 13, fontWeight: "800" },
  postMedia: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    backgroundColor: "#000",
  },

  reactionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  reactionCount: { fontSize: 13, fontWeight: "700" },

  commentToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 2 },
  commentToggleText: { fontSize: 13, fontWeight: "600" },

  commentSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 10 },
  commentRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  commentBubble: { flex: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  commentAuthor: { fontSize: 13, fontWeight: "700" },
  commentTime: { fontSize: 11, fontWeight: "500" },
  commentText: { fontSize: 14, lineHeight: 19, marginTop: 2 },
  commentComposer: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 2 },
  commentInput: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 100,
  },
});
