import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useToast } from "@/context/ToastContext";
import { API_BASE, buildAuthHeaders, resolveUploadedUrl } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import AttachmentVideo from "@/components/AttachmentVideo";
import { ImageViewerOverlay } from "@/components/ImageViewerModal";
import { Bounceable } from "@/components/Bounceable";
import { AnimatedCount } from "@/components/AnimatedCount";
import { useVaultPhotoStream } from "@/hooks/useVaultPhotoStream";

const CAPTION_MAX = 300;
const COMMENT_MAX = 1000;
const POLL_MS = 20_000;

/** Normalized media shape the detail view renders, drawn from either the
 *  personal or squad vault grids. */
export type VaultDetailPhoto = {
  id: number;
  url: string;
  mediaType?: "image" | "video";
  uploaderId: string;
  uploadedAt: string;
  caption?: string | null;
  heartCount?: number;
  hearted?: boolean;
  commentCount?: number;
  title?: string | null;
  subtitle?: string | null;
};

type Heart = {
  userId: string;
  createdAt: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

type Comment = {
  id: number;
  photoId: number;
  authorId: string;
  text: string;
  createdAt: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

type Props = {
  visible: boolean;
  photo: VaultDetailPhoto | null;
  authToken: string | null;
  currentUserId: string | null;
  favorited: boolean;
  onClose: () => void;
  onToggleFavorite: (id: number) => void;
  onShare: (photo: VaultDetailPhoto) => void;
  onCaptionUpdated?: (id: number, caption: string | null) => void;
  onHeartChanged?: (id: number, hearted: boolean, heartCount: number) => void;
  onDelete?: (id: number) => void;
  deleteLabel?: string;
};

const displayName = (first?: string | null, last?: string | null): string => {
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name || "Squad member";
};

const initialOf = (first?: string | null, last?: string | null): string => {
  const base = first || last || "?";
  return base.slice(0, 1).toUpperCase();
};

const relTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** Resolve a stored object path into a loadable URL (public → verbatim,
 *  protected → auth-gated proxy, prefixed with the API base on native). */
const resolveMedia = (url: string): string => {
  const r = resolveUploadedUrl(url);
  return /^https?:\/\//i.test(r) ? r : `${API_BASE}${r}`;
};

/**
 * Full-screen rich detail view for a single vault photo/video: large media,
 * an inline-editable caption (uploader only), a heart button with a who-hearted
 * list, a live comments thread, and favorite / share / delete actions. Hearts
 * and comments update in real time over SSE with a 20 s poll fallback.
 */
export default function VaultMediaDetail({
  visible,
  photo,
  authToken,
  currentUserId,
  favorited,
  onClose,
  onToggleFavorite,
  onShare,
  onCaptionUpdated,
  onHeartChanged,
  onDelete,
  deleteLabel = "Delete",
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const photoId = photo?.id ?? null;
  const isUploader = !!(photo && currentUserId && photo.uploaderId === currentUserId);
  const isVideo = photo?.mediaType === "video";

  const authHeaders = useMemo(() => buildAuthHeaders(authToken), [authToken]);

  const [hearted, setHearted] = useState(false);
  const [heartCount, setHeartCount] = useState(0);
  const heartPendingRef = useRef(false);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [showHearts, setShowHearts] = useState(false);

  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const [caption, setCaption] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [savingCaption, setSavingCaption] = useState(false);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const commentInputRef = useRef<TextInput>(null);

  // Seed local state from the grid payload when a new photo opens.
  useEffect(() => {
    if (!photo) return;
    setHearted(!!photo.hearted);
    setHeartCount(photo.heartCount ?? 0);
    setCaption(photo.caption ?? null);
    setShowHearts(false);
    setEditingCaption(false);
    setOptionsOpen(false);
    setZoomOpen(false);
    setDraft("");
  }, [photo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchInteractions = useCallback(async () => {
    if (!photoId) return;
    try {
      const [hRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/api/vault/photos/${photoId}/hearts`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/vault/photos/${photoId}/comments`, { headers: authHeaders }),
      ]);
      if (hRes.ok) {
        const d = (await hRes.json()) as { hearts: Heart[] };
        setHearts(d.hearts ?? []);
        setHeartCount(d.hearts?.length ?? 0);
        if (currentUserId) setHearted((d.hearts ?? []).some((h) => h.userId === currentUserId));
      }
      if (cRes.ok) {
        const d = (await cRes.json()) as { comments: Comment[] };
        setComments(d.comments ?? []);
      }
    } catch {
      // covered by the next poll / SSE tick
    }
  }, [photoId, authHeaders, currentUserId]);

  // Initial load + 20 s fallback poll while open.
  useEffect(() => {
    if (!visible || !photoId) return;
    setLoading(true);
    void fetchInteractions().finally(() => setLoading(false));
    const t = setInterval(() => void fetchInteractions(), POLL_MS);
    return () => clearInterval(t);
  }, [visible, photoId, fetchInteractions]);

  // Live updates: refetch on any server-broadcast interaction change.
  useVaultPhotoStream({
    photoId: visible ? photoId : null,
    authToken,
    onUpdate: fetchInteractions,
  });

  const toggleHeart = useCallback(async () => {
    // Guard against double-taps: a heart request already in flight must settle
    // before another toggle can be sent, otherwise two rapid taps race and the
    // net state becomes unpredictable.
    if (!photoId || heartPendingRef.current) return;
    heartPendingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasHearted = hearted;
    setHearted(!wasHearted);
    setHeartCount((c) => Math.max(0, c + (wasHearted ? -1 : 1)));
    try {
      const res = await fetch(`${API_BASE}/api/vault/photos/${photoId}/heart`, {
        method: "POST",
        headers: authHeaders,
      });
      if (!res.ok) throw new Error("heart failed");
      const d = (await res.json()) as { hearted: boolean; heartCount: number };
      setHearted(d.hearted);
      setHeartCount(d.heartCount);
      onHeartChanged?.(photoId, d.hearted, d.heartCount);
      void fetchInteractions();
    } catch {
      setHearted(wasHearted);
      setHeartCount((c) => Math.max(0, c + (wasHearted ? 1 : -1)));
      showToast("Couldn't update. Please try again.", { durationMs: 2500 });
    } finally {
      heartPendingRef.current = false;
    }
  }, [photoId, hearted, authHeaders, fetchInteractions, showToast, onHeartChanged]);

  const submitComment = useCallback(async () => {
    const text = draft.trim();
    if (!photoId || !text || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`${API_BASE}/api/vault/photos/${photoId}/comments`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("comment failed");
      setDraft("");
      Keyboard.dismiss();
      await fetchInteractions();
    } catch {
      showToast("Couldn't post comment. Please try again.", { durationMs: 2500 });
    } finally {
      setPosting(false);
    }
  }, [draft, photoId, posting, authHeaders, fetchInteractions, showToast]);

  const deleteComment = useCallback(
    async (commentId: number) => {
      if (!photoId) return;
      const prev = comments;
      setComments((cs) => cs.filter((c) => c.id !== commentId));
      try {
        const res = await fetch(
          `${API_BASE}/api/vault/photos/${photoId}/comments/${commentId}`,
          { method: "DELETE", headers: authHeaders },
        );
        if (!res.ok) throw new Error("delete failed");
      } catch {
        setComments(prev);
        showToast("Couldn't delete comment.", { durationMs: 2500 });
      }
    },
    [photoId, comments, authHeaders, showToast],
  );

  const startEditCaption = useCallback(() => {
    commentInputRef.current?.blur();
    setCaptionDraft(caption ?? "");
    setEditingCaption(true);
    setOptionsOpen(false);
  }, [caption]);

  const saveCaption = useCallback(async () => {
    if (!photoId || savingCaption) return;
    const next = captionDraft.trim();
    setSavingCaption(true);
    try {
      const res = await fetch(`${API_BASE}/api/vault/photos/${photoId}/caption`, {
        method: "PATCH",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ caption: next }),
      });
      if (!res.ok) throw new Error("caption failed");
      const value = next.length > 0 ? next : null;
      setCaption(value);
      setEditingCaption(false);
      onCaptionUpdated?.(photoId, value);
    } catch {
      showToast("Couldn't save caption. Please try again.", { durationMs: 2500 });
    } finally {
      setSavingCaption(false);
    }
  }, [photoId, captionDraft, savingCaption, authHeaders, onCaptionUpdated, showToast]);

  if (!photo) return null;

  const mediaUri = resolveMedia(photo.url);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="close" size={26} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            {!!photo.title && (
              <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
                {photo.title}
              </Text>
            )}
            {!!photo.subtitle && (
              <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                {photo.subtitle}
              </Text>
            )}
          </View>
          {(isUploader || onDelete) ? (
            <TouchableOpacity onPress={() => setOptionsOpen((o) => !o)} hitSlop={10} style={styles.headerBtn}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.foreground} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerBtn} />
          )}
        </View>

        {optionsOpen && (
          <View style={[styles.optionsMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {isUploader && (
              <TouchableOpacity style={styles.optionRow} onPress={startEditCaption} activeOpacity={0.7}>
                <Ionicons name="create-outline" size={18} color={colors.foreground} />
                <Text style={[styles.optionText, { color: colors.foreground }]}>
                  {caption ? "Edit caption" : "Add caption"}
                </Text>
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => { setOptionsOpen(false); onDelete(photo.id); }}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                <Text style={[styles.optionText, { color: colors.destructive }]}>{deleteLabel}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={insets.top + 8}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Media */}
            <View style={[styles.mediaWrap, { backgroundColor: "#000" }]}>
              {isVideo ? (
                <AttachmentVideo
                  uri={mediaUri}
                  headers={authHeaders}
                  style={styles.media}
                />
              ) : (
                <TouchableOpacity
                  activeOpacity={0.95}
                  onPress={() => setZoomOpen(true)}
                  style={styles.media}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Expand photo"
                >
                  <Image
                    source={{ uri: mediaUri, headers: authHeaders }}
                    style={styles.media}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    transition={150}
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* Action bar */}
            <View style={styles.actionBar}>
              <Bounceable style={styles.action} onPress={() => void toggleHeart()} peak={1.5}>
                <Ionicons
                  name={hearted ? "heart" : "heart-outline"}
                  size={26}
                  color={hearted ? "#ff3b5c" : colors.foreground}
                />
              </Bounceable>
              <TouchableOpacity
                style={styles.action}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggleFavorite(photo.id); }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={favorited ? "bookmark" : "bookmark-outline"}
                  size={24}
                  color={favorited ? colors.gold : colors.foreground}
                />
              </TouchableOpacity>
            </View>

            {/* Heart count → who-hearted */}
            {heartCount > 0 && (
              <TouchableOpacity
                onPress={() => setShowHearts((s) => !s)}
                style={styles.heartCountRow}
                activeOpacity={0.7}
              >
                <AnimatedCount
                  value={heartCount}
                  style={[styles.heartCountText, { color: colors.foreground }]}
                />
                <Text style={[styles.heartCountText, { color: colors.foreground }]}>
                  {heartCount === 1 ? "like" : "likes"}
                </Text>
                <Ionicons
                  name={showHearts ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>
            )}
            {showHearts && (
              <View style={styles.heartList}>
                {hearts.map((h) => (
                  <View key={h.userId} style={styles.personRow}>
                    <UserAvatar
                      initials={initialOf(h.firstName, h.lastName)}
                      color={colors.primary}
                      imageUrl={h.profileImageUrl}
                      size={28}
                      fontSize={11}
                    />
                    <Text style={[styles.personName, { color: colors.foreground }]} numberOfLines={1}>
                      {displayName(h.firstName, h.lastName)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Caption */}
            <View style={styles.captionWrap}>
              {editingCaption ? (
                <View>
                  <TextInput
                    value={captionDraft}
                    onChangeText={(t) => setCaptionDraft(t.slice(0, CAPTION_MAX))}
                    placeholder="Write a caption…"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.captionInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                    multiline
                    maxLength={CAPTION_MAX}
                    autoFocus
                  />
                  <View style={styles.captionEditRow}>
                    <Text style={[styles.charCount, { color: colors.mutedForeground }]}>
                      {captionDraft.length}/{CAPTION_MAX}
                    </Text>
                    <View style={styles.captionEditBtns}>
                      <TouchableOpacity onPress={() => setEditingCaption(false)} style={styles.captionCancel}>
                        <Text style={[styles.captionCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={saveCaption}
                        disabled={savingCaption}
                        style={[styles.captionSave, { backgroundColor: colors.primary }]}
                      >
                        {savingCaption
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={styles.captionSaveText}>Save</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : caption ? (
                <TouchableOpacity
                  activeOpacity={isUploader ? 0.6 : 1}
                  onPress={isUploader ? startEditCaption : undefined}
                >
                  <Text style={[styles.captionText, { color: colors.foreground }]}>{caption}</Text>
                </TouchableOpacity>
              ) : isUploader ? (
                <TouchableOpacity onPress={startEditCaption} activeOpacity={0.6} style={styles.addCaptionRow}>
                  <Ionicons name="add-circle-outline" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.addCaptionText, { color: colors.mutedForeground }]}>Add a caption</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Comments */}
            <View style={styles.commentsHeader}>
              <Text style={[styles.commentsTitle, { color: colors.foreground }]}>
                Comments{comments.length > 0 ? ` (${comments.length})` : ""}
              </Text>
            </View>

            {loading && comments.length === 0 ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
            ) : comments.length === 0 ? (
              <Text style={[styles.emptyComments, { color: colors.mutedForeground }]}>
                No comments yet. Be the first to say something.
              </Text>
            ) : (
              comments.map((c) => {
                const canDelete = c.authorId === currentUserId || isUploader;
                return (
                  <View key={c.id} style={styles.commentRow}>
                    <UserAvatar
                      initials={initialOf(c.firstName, c.lastName)}
                      color={colors.primary}
                      imageUrl={c.profileImageUrl}
                      size={32}
                      fontSize={12}
                    />
                    <View style={styles.commentBody}>
                      <View style={styles.commentMetaRow}>
                        <Text style={[styles.commentAuthor, { color: colors.foreground }]} numberOfLines={1}>
                          {displayName(c.firstName, c.lastName)}
                        </Text>
                        <Text style={[styles.commentTime, { color: colors.mutedForeground }]}>
                          {relTime(c.createdAt)}
                        </Text>
                        {canDelete && (
                          <TouchableOpacity onPress={() => deleteComment(c.id)} hitSlop={8} style={styles.commentDelete}>
                            <Ionicons name="trash-outline" size={13} color={colors.mutedForeground} />
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text style={[styles.commentText, { color: colors.foreground }]}>{c.text}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Comment composer */}
          <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TextInput
              ref={commentInputRef}
              value={draft}
              onChangeText={(t) => setDraft(t.slice(0, COMMENT_MAX))}
              placeholder="Add a comment…"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.composerInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
              multiline
              maxLength={COMMENT_MAX}
            />
            <TouchableOpacity
              onPress={submitComment}
              disabled={posting || draft.trim().length === 0}
              style={[
                styles.sendBtn,
                { backgroundColor: draft.trim().length === 0 ? colors.border : colors.primary },
              ]}
              activeOpacity={0.8}
            >
              {posting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="arrow-up" size={20} color="#fff" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {zoomOpen && !isVideo && (
          <ImageViewerOverlay
            uri={mediaUri}
            headers={authHeaders}
            onClose={() => setZoomOpen(false)}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 40, height: 32, justifyContent: "center", alignItems: "center" },
  headerCenter: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  headerTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  optionsMenu: {
    position: "absolute",
    top: 52,
    right: 12,
    zIndex: 20,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 180,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
  optionText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  mediaWrap: { width: "100%", aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  media: { width: "100%", height: "100%" },
  actionBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 12, gap: 6 },
  action: { padding: 6 },
  heartCountRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 8 },
  heartCountText: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  heartList: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  personRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  personName: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  captionWrap: { paddingHorizontal: 16, paddingTop: 12 },
  captionText: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_400Regular" },
  addCaptionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  addCaptionText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  captionInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    minHeight: 64,
    textAlignVertical: "top",
  },
  captionEditRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  charCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  captionEditBtns: { flexDirection: "row", alignItems: "center", gap: 10 },
  captionCancel: { paddingVertical: 6, paddingHorizontal: 10 },
  captionCancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" },
  captionSave: { paddingVertical: 7, paddingHorizontal: 18, borderRadius: 20, minWidth: 64, alignItems: "center" },
  captionSaveText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  commentsHeader: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4 },
  commentsTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  emptyComments: { paddingHorizontal: 16, paddingTop: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  commentRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 14 },
  commentBody: { flex: 1 },
  commentMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  commentAuthor: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold", flexShrink: 1 },
  commentTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  commentDelete: { marginLeft: "auto", padding: 2 },
  commentText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", marginTop: 2 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    maxHeight: 110,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
