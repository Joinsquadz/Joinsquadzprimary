import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Dimensions,
  ActivityIndicator,
  Animated,
  Alert,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AttachmentVideo from "./AttachmentVideo";
import { UserAvatar } from "./UserAvatar";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { useUserCache } from "@/context/UserCacheContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

export type MomentItem = {
  id: string;
  mediaUrl: string;
  mediaType: "photo" | "video";
  durationMs: number | null;
  createdAt: string;
  expiresAt: string;
  seen: boolean;
};

export type MomentRing = {
  authorId: string;
  hasUnseen: boolean;
  isSelf: boolean;
  moments: MomentItem[];
};

type Viewer = { userId: string; viewedAt: string; reaction: string | null };

const PHOTO_DURATION = 5000;
const REACTIONS = ["❤️", "🔥", "😂", "👏", "😮", "😢"];

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 45) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

type Props = {
  rings: MomentRing[];
  initialRingIndex: number;
  onClose: () => void;
  onChanged?: () => void;
};

export function MomentViewer({ rings, initialRingIndex, onClose, onChanged }: Props) {
  const colors = useColors();
  const { authToken, currentUser } = useAuth();
  const { resolveUser } = useUserCache();

  const [ringIndex, setRingIndex] = useState(initialRingIndex);
  const [momentIndex, setMomentIndex] = useState(0);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [viewersLoading, setViewersLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reacted, setReacted] = useState<string | null>(null);

  const progress = useRef(new Animated.Value(0)).current;

  const ring = rings[ringIndex];
  const moment = ring?.moments[momentIndex];

  const headers = buildAuthHeaders(authToken);
  const mediaSrc = (path: string) => `${API_BASE}/api/storage${path}`;

  // Keep latest goNext for use inside animation callbacks without stale closures.
  const goNextRef = useRef<() => void>(() => {});

  const goNext = useCallback(() => {
    const r = rings[ringIndex];
    if (!r) {
      onClose();
      return;
    }
    if (momentIndex < r.moments.length - 1) {
      setMomentIndex((i) => i + 1);
    } else if (ringIndex < rings.length - 1) {
      setRingIndex((i) => i + 1);
      setMomentIndex(0);
    } else {
      onClose();
    }
  }, [rings, ringIndex, momentIndex, onClose]);

  const goPrev = useCallback(() => {
    if (momentIndex > 0) {
      setMomentIndex((i) => i - 1);
    } else if (ringIndex > 0) {
      const prev = ringIndex - 1;
      setRingIndex(prev);
      setMomentIndex(Math.max(0, (rings[prev]?.moments.length ?? 1) - 1));
    }
  }, [rings, ringIndex, momentIndex]);

  goNextRef.current = goNext;

  // Mark seen + drive auto-advance progress whenever the active moment changes.
  useEffect(() => {
    if (!ring || !moment) return;
    setReacted(null);
    setShowViewers(false);

    if (!ring.isSelf && authToken) {
      fetch(`${API_BASE}/api/moments/${moment.id}/views`, {
        method: "POST",
        headers,
      }).catch(() => {});
    }

    progress.setValue(0);
    if (moment.mediaType === "photo") {
      const anim = Animated.timing(progress, {
        toValue: 1,
        duration: PHOTO_DURATION,
        useNativeDriver: false,
      });
      anim.start(({ finished }) => {
        if (finished) goNextRef.current();
      });
      return () => anim.stop();
    }
    // Videos play to the user's own pace; full bar shown.
    progress.setValue(1);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringIndex, momentIndex]);

  const fetchViewers = useCallback(async () => {
    if (!moment || !authToken) return;
    setViewersLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/moments/${moment.id}/viewers`, { headers });
      if (!res.ok) return;
      const data = (await res.json()) as { viewers: Viewer[] };
      setViewers(data.viewers ?? []);
    } catch {
      // ignore
    } finally {
      setViewersLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment, authToken]);

  const handleReact = useCallback(
    async (emoji: string) => {
      if (!moment || !authToken || ring?.isSelf) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Tapping the already-selected reaction removes it (undo).
      const isUndo = reacted === emoji;
      setReacted(isUndo ? null : emoji);
      try {
        if (isUndo) {
          await fetch(
            `${API_BASE}/api/moments/${moment.id}/reactions/${encodeURIComponent(emoji)}`,
            { method: "DELETE", headers },
          );
        } else {
          await fetch(`${API_BASE}/api/moments/${moment.id}/reactions`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ emoji }),
          });
        }
      } catch {
        // ignore
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moment, authToken, ring, reacted],
  );

  const handleDelete = useCallback(() => {
    if (!moment || !authToken) return;
    Alert.alert("Delete moment?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setDeleting(true);
          void (async () => {
            try {
              await fetch(`${API_BASE}/api/moments/${moment.id}`, {
                method: "DELETE",
                headers,
              });
              onChanged?.();
            } catch {
              // ignore
            } finally {
              setDeleting(false);
              onClose();
            }
          })();
        },
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment, authToken, onChanged, onClose]);

  if (!ring || !moment) return null;

  const author = ring.isSelf
    ? {
        name: "Your moment",
        initials: currentUser.initials,
        color: currentUser.color,
        profileImageUrl: currentUser.profileImageUrl ?? null,
      }
    : (() => {
        const u = resolveUser(ring.authorId);
        return {
          name: u.name,
          initials: u.initials,
          color: u.color,
          profileImageUrl: u.profileImageUrl,
        };
      })();

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        {/* Media */}
        <View style={StyleSheet.absoluteFill}>
          {moment.mediaType === "video" ? (
            <AttachmentVideo
              uri={mediaSrc(moment.mediaUrl)}
              headers={headers as Record<string, string>}
              style={StyleSheet.absoluteFillObject}
            />
          ) : (
            <Image
              source={{ uri: mediaSrc(moment.mediaUrl), headers: headers as Record<string, string> }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              transition={150}
            />
          )}
        </View>

        {/* Tap zones for prev / next */}
        <Pressable style={styles.tapLeft} onPress={goPrev} />
        <Pressable style={styles.tapRight} onPress={goNext} />

        {/* Progress segments */}
        <View style={styles.progressRow} pointerEvents="none">
          {ring.moments.map((m, i) => (
            <View key={m.id} style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width:
                      i < momentIndex
                        ? "100%"
                        : i > momentIndex
                        ? "0%"
                        : progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: ["0%", "100%"],
                          }),
                  },
                ]}
              />
            </View>
          ))}
        </View>

        {/* Header */}
        <View style={styles.header} pointerEvents="box-none">
          <View style={styles.headerLeft}>
            <UserAvatar
              initials={author.initials}
              color={author.color}
              imageUrl={author.profileImageUrl}
              size={34}
              fontSize={13}
            />
            <View>
              <Text style={styles.authorName} numberOfLines={1}>
                {ring.isSelf ? "You" : author.name}
              </Text>
              <Text style={styles.timeText}>{timeAgo(moment.createdAt)}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            {ring.isSelf && (
              <TouchableOpacity onPress={handleDelete} hitSlop={10} disabled={deleting} style={styles.iconBtn}>
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="trash-outline" size={22} color="#fff" />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.iconBtn}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer: reactions (others) or viewer count (self) */}
        <View style={styles.footer} pointerEvents="box-none">
          {ring.isSelf ? (
            <TouchableOpacity
              style={[styles.viewerPill, { backgroundColor: "rgba(0,0,0,0.45)" }]}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowViewers(true);
                void fetchViewers();
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="eye-outline" size={18} color="#fff" />
              <Text style={styles.viewerPillText}>See who viewed</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.reactionRow}>
              {REACTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => void handleReact(emoji)}
                  style={[
                    styles.reactionBtn,
                    reacted === emoji && { backgroundColor: "rgba(255,255,255,0.25)" },
                  ]}
                  activeOpacity={0.7}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Viewers list overlay */}
        {showViewers && (
          <View style={styles.viewersOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowViewers(false)} />
            <View style={[styles.viewersSheet, { backgroundColor: colors.card }]}>
              <View style={styles.viewersHeader}>
                <Text style={[styles.viewersTitle, { color: colors.foreground }]}>
                  Viewers · {viewers.length}
                </Text>
                <TouchableOpacity onPress={() => setShowViewers(false)} hitSlop={10}>
                  <Ionicons name="close" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              {viewersLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
              ) : viewers.length === 0 ? (
                <Text style={[styles.viewersEmpty, { color: colors.mutedForeground }]}>
                  No views yet
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {viewers.map((v) => {
                    const u = resolveUser(v.userId);
                    return (
                      <View key={v.userId} style={styles.viewerRow}>
                        <UserAvatar
                          initials={u.initials}
                          color={u.color}
                          imageUrl={u.profileImageUrl}
                          size={36}
                          fontSize={13}
                        />
                        <Text style={[styles.viewerName, { color: colors.foreground }]} numberOfLines={1}>
                          {u.name}
                        </Text>
                        {v.reaction && <Text style={styles.viewerReaction}>{v.reaction}</Text>}
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>
        )}

        <LinearGradient
          colors={["rgba(0,0,0,0.5)", "transparent"]}
          style={styles.topScrim}
          pointerEvents="none"
        />
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.5)"]}
          style={styles.bottomScrim}
          pointerEvents="none"
        />
      </View>
    </Modal>
  );
}

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000" },
  tapLeft: { position: "absolute", top: 0, bottom: 0, left: 0, width: width * 0.35 },
  tapRight: { position: "absolute", top: 0, bottom: 0, right: 0, width: width * 0.65 },

  progressRow: {
    position: "absolute",
    top: 52,
    left: 12,
    right: 12,
    flexDirection: "row",
    gap: 4,
    zIndex: 5,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    overflow: "hidden",
  },
  progressFill: { height: 3, backgroundColor: "#fff" },

  header: {
    position: "absolute",
    top: 64,
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 5,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  iconBtn: { padding: 2 },
  authorName: { color: "#fff", fontSize: 15, fontWeight: "800" },
  timeText: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600", marginTop: 1 },

  footer: { position: "absolute", left: 0, right: 0, bottom: 36, alignItems: "center", zIndex: 5 },
  reactionRow: { flexDirection: "row", gap: 6 },
  reactionBtn: { padding: 8, borderRadius: 999 },
  reactionEmoji: { fontSize: 28 },
  viewerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  viewerPillText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  viewersOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", zIndex: 10 },
  viewersSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 36,
  },
  viewersHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  viewersTitle: { fontSize: 17, fontWeight: "800" },
  viewersEmpty: { fontSize: 14, textAlign: "center", marginVertical: 24 },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  viewerName: { flex: 1, fontSize: 15, fontWeight: "600" },
  viewerReaction: { fontSize: 18 },

  topScrim: { position: "absolute", top: 0, left: 0, right: 0, height: 140 },
  bottomScrim: { position: "absolute", bottom: 0, left: 0, right: 0, height: 140 },
});
