import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  RefreshControl,
  ActivityIndicator,
  AppState,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData } from "@/context/AppContext";
import { useUserCache } from "@/context/UserCacheContext";
import { ProAvatar } from "@/components/ProAvatar";
import { MomentsRingRow } from "@/components/MomentsRingRow";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

// ── types ─────────────────────────────────────────────────────────────────────
type FeedPost = {
  id: string;
  authorId: string;
  text: string;
  audience: string; // "friends" | squadId
  createdAt: string;
  reactions: Record<string, number>;
  myReactions: string[];
  commentCount: number;
  canDelete: boolean;
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
  const [refreshing, setRefreshing] = useState(false);
  const [momentsReload, setMomentsReload] = useState(0);

  // composer
  const [draft, setDraft] = useState("");
  const [audience, setAudience] = useState<string>("friends");
  const [posting, setPosting] = useState(false);

  // comments
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, FeedComment[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSending, setCommentSending] = useState(false);

  // ── data fetching ─────────────────────────────────────────────────────────
  const fetchFeed = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/feed`, { headers: buildAuthHeaders(authToken) });
      if (!res.ok) return;
      const data = (await res.json()) as { posts: FeedPost[] };
      setPosts(data.posts ?? []);
    } catch {
      // Network unavailable — keep current posts
    } finally {
      setLoading(false);
    }
  }, [authToken]);

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

  const handlePost = useCallback(async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${API_BASE}/api/feed/posts`, {
        method: "POST",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({ text, audience }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        Alert.alert("Couldn't post", body.error ?? "Please try again.");
        return;
      }
      setDraft("");
      await fetchFeed();
    } catch {
      Alert.alert("Couldn't post", "Please check your connection and try again.");
    } finally {
      setPosting(false);
    }
  }, [draft, posting, audience, authToken, fetchFeed]);

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

  // ── audience options ───────────────────────────────────────────────────────
  const audienceOptions = useMemo(
    () => [
      { id: "friends", label: "Friends", emoji: "👥" },
      ...squads.map((s) => ({ id: s.id, label: s.name, emoji: s.emoji })),
    ],
    [squads],
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
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Vibe</Text>
        <TouchableOpacity
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/profile");
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

      <ScrollView
        contentContainerStyle={{ paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {/* Moments ring row (friends) */}
        <MomentsRingRow mode="friends" reloadKey={momentsReload} />

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
              style={[styles.composerInput, { color: colors.foreground }]}
              placeholder="What's the vibe?"
              placeholderTextColor={colors.mutedForeground}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={1000}
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.audienceRow}
          >
            {audienceOptions.map((opt) => {
              const selected = audience === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setAudience(opt.id);
                  }}
                  style={[
                    styles.audienceChip,
                    {
                      backgroundColor: selected ? colors.primary + "22" : colors.background,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={{ fontSize: 13 }}>{opt.emoji}</Text>
                  <Text
                    style={[
                      styles.audienceChipText,
                      { color: selected ? colors.primary : colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.composerActions}>
            <Text style={[styles.composerHint, { color: colors.textDim }]}>
              Sharing to {audienceLabel(audience)}
            </Text>
            <TouchableOpacity
              onPress={() => void handlePost()}
              disabled={!draft.trim() || posting}
              style={[
                styles.postBtn,
                { backgroundColor: colors.primary, opacity: !draft.trim() || posting ? 0.5 : 1 },
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

        {/* Feed list */}
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 52, marginBottom: 14 }}>✨</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No vibes yet</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Be the first to post. Share what's going on with your friends and squads.
            </Text>
          </View>
        ) : (
          posts.map((post) => {
            const author = resolveUser(post.authorId);
            const commentsOpen = openComments === post.id;
            const comments = commentsByPost[post.id] ?? [];
            return (
              <View
                key={post.id}
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
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.postAuthor, { color: colors.foreground }]} numberOfLines={1}>
                      {author.name}
                    </Text>
                    <Text style={[styles.postMeta, { color: colors.mutedForeground }]}>
                      {audienceLabel(post.audience)} · {timeAgo(post.createdAt)}
                    </Text>
                  </View>
                  {post.canDelete && (
                    <TouchableOpacity onPress={() => handleDeletePost(post)} hitSlop={8}>
                      <Ionicons name="ellipsis-horizontal" size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={[styles.postText, { color: colors.foreground }]}>{post.text}</Text>

                {/* reactions */}
                <View style={styles.reactionRow}>
                  {REACTION_EMOJIS.map((emoji) => {
                    const count = post.reactions[emoji] ?? 0;
                    const mine = post.myReactions.includes(emoji);
                    return (
                      <TouchableOpacity
                        key={emoji}
                        onPress={() => void handleToggleReaction(post, emoji)}
                        style={[
                          styles.reactionChip,
                          {
                            backgroundColor: mine ? colors.primary + "22" : colors.background,
                            borderColor: mine ? colors.primary : colors.border,
                          },
                        ]}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 14 }}>{emoji}</Text>
                        {count > 0 && (
                          <Text
                            style={[
                              styles.reactionCount,
                              { color: mine ? colors.primary : colors.mutedForeground },
                            ]}
                          >
                            {count}
                          </Text>
                        )}
                      </TouchableOpacity>
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
          })
        )}
      </ScrollView>
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
  composerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  composerHint: { fontSize: 12, fontWeight: "600", flex: 1 },
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
