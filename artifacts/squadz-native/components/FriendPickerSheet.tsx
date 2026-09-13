import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { KeyboardAvoidingSheet } from "@/components/KeyboardAvoidingSheet";
import { KeyboardDismissControl } from "@/components/KeyboardDismissControl";
import { useAuth, useData } from "@/context/AppContext";
import { router } from "expo-router";
import { useUserCache, type ResolvedUser } from "@/context/UserCacheContext";
import { UserAvatar } from "@/components/UserAvatar";

type Props = {
  visible: boolean;
  /** Sheet heading, e.g. "Invite to trip". */
  title?: string;
  /** Action button label, e.g. "Invite". */
  confirmLabel?: string;
  /** User ids that are already in (host, members, already invited) — hidden. */
  excludeIds?: string[];
  /** Also search discoverable non-friends after two characters. */
  allowNonFriends?: boolean;
  /** Called with the selected friend ids; may be async (shows a spinner). */
  onConfirm: (ids: string[]) => void | Promise<void>;
  onClose: () => void;
};

/**
 * Reusable multi-select sheet for picking friends to invite to a trip/event.
 * Sources the user's friends from AppContext and resolves display info from the
 * user cache. Anyone in `excludeIds` (host, current members, already-invited) is
 * filtered out so the list only shows people who can actually be newly invited.
 */
export default function FriendPickerSheet({
  visible,
  title = "Invite friends",
  confirmLabel = "Invite",
  excludeIds = [],
  allowNonFriends = false,
  onConfirm,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();
  const { friends, fetchFriends, friendsLoading, friendsAuthPending, friendsAuthError, retryFriends, apiFetch } =
    useData();
  const { resolveUser, prefetchUsers } = useUserCache();

  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchUsers, setSearchUsers] = useState<ResolvedUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const prevVisibleRef = useRef(false);

  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setSelected([]);
      setQuery("");
      setSearchUsers([]);
      setSearchError(false);
      void fetchFriends();
    }
    prevVisibleRef.current = visible;
  }, [visible, fetchFriends]);

  useEffect(() => {
    if (!visible || !allowNonFriends || query.trim().length < 2) {
      setSearchUsers([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(false);
      try {
        const res = await apiFetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
        if (!res.ok) throw new Error("search failed");
        const rows = (await res.json()) as Array<{
          id: string;
          firstName: string | null;
          lastName: string | null;
          profileImageUrl: string | null;
        }>;
        if (cancelled) return;
        setSearchUsers(rows.map((row) => {
          const first = row.firstName ?? "";
          const last = row.lastName ?? "";
          const name = [first, last].filter(Boolean).join(" ") || "Unknown";
          return {
            id: row.id,
            name,
            initials: first && last
              ? `${first[0]}${last[0]}`.toUpperCase()
              : first
                ? first.slice(0, 2).toUpperCase()
                : "U?",
            color: "#4A9EFF",
            profileImageUrl: row.profileImageUrl ?? null,
            isPro: false,
          };
        }));
      } catch {
        if (!cancelled) {
          setSearchUsers([]);
          setSearchError(true);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allowNonFriends, apiFetch, query, visible]);

  useEffect(() => {
    if (visible && friends.length > 0) prefetchUsers(friends);
  }, [visible, friends, prefetchUsers]);

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const friendIds = new Set(friends);
    const friendCandidates = friends
      .filter((id) => !exclude.has(id))
      .map((id) => ({ id, user: resolveUser(id), nonFriend: false }))
      .filter(({ user }) => (q ? user.name.toLowerCase().includes(q) : true))
    const nonFriendCandidates = allowNonFriends
      ? searchUsers
        .filter((user) => !friendIds.has(user.id) && !exclude.has(user.id))
        .map((user) => ({ id: user.id, user, nonFriend: true }))
      : [];
    return [...friendCandidates, ...nonFriendCandidates]
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
  }, [allowNonFriends, friends, exclude, query, resolveUser, searchUsers]);

  // A friends fetch that is still in flight (or 401ing during a cold-start auth
  // race) must not render "Add friends to invite them directly." — that falsely
  // tells the user they have no friends. Only a settled, authenticated,
  // zero-friend response is a real empty state.
  const showLoading = friends.length === 0 && (friendsLoading || friendsAuthPending);
  const showError = !allowNonFriends && friends.length === 0 && !showLoading && friendsAuthError;

  const toggle = (id: string) => {
    Haptics.selectionAsync();
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const submit = async () => {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(selected);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingSheet style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View style={styles.handle} />

          {/* Header: Cancel + title only */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.cancelBtn}>
              <Text style={[styles.cancel, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
              {title}
            </Text>
            {/* Spacer to keep title centred */}
            <View style={styles.cancelBtn} />
          </View>

          {(allowNonFriends || friends.length > 0) && !showLoading && !showError && (
            <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={allowNonFriends ? "Search friends and people" : "Search friends"}
                placeholderTextColor={colors.mutedForeground}
                style={[styles.searchInput, { color: colors.foreground }]}
                autoCapitalize="none"
              />
            </View>
          )}

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {showLoading ? (
              <View style={styles.empty}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Loading your friends…
                </Text>
              </View>
            ) : showError ? (
              <View style={styles.empty}>
                <Ionicons name="cloud-offline-outline" size={32} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Couldn&apos;t load your friends.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    retryFriends();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Try loading your friends again"
                  style={[styles.retryBtn, { borderColor: colors.border }]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : searchLoading ? (
              <View style={styles.empty}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Searching people…
                </Text>
              </View>
            ) : candidates.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={32} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  {searchError
                    ? "Couldn't search people right now."
                    : friends.length === 0 && !allowNonFriends
                    ? "Add friends to invite them directly."
                    : allowNonFriends && query.trim().length < 2
                      ? "Search by name to find friends and other people."
                    : query.trim()
                      ? allowNonFriends
                        ? "No people match your search."
                        : "No friends match your search."
                      : "Everyone you can invite is already in."}
                </Text>
              </View>
            ) : (
              candidates.map(({ id, user, nonFriend }) => {
                const isSelected = selected.includes(id);
                return (
                  <View
                    key={id}
                    style={styles.row}
                  >
                    <TouchableOpacity
                      onPress={() => router.push((id === currentUser.id ? "/profile" : `/user/${id}`) as never)}
                      accessibilityLabel={`Open ${user.name}'s profile`}
                      hitSlop={8}
                    >
                      <UserAvatar
                        initials={user.initials}
                        color={user.color}
                        imageUrl={user.profileImageUrl}
                        size={40}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.rowSelect} onPress={() => toggle(id)} activeOpacity={0.7}>
                      <View style={styles.userCopy}>
                        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                          {user.name}
                        </Text>
                        {nonFriend && (
                          <Text style={[styles.subtitle, { color: colors.primary }]} numberOfLines={1}>
                            Invite + friend request
                          </Text>
                        )}
                      </View>
                      <Ionicons
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                        size={24}
                        color={isSelected ? colors.primary : colors.mutedForeground}
                      />
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Full-width CTA at the bottom — visible as soon as a friend is selected */}
          <TouchableOpacity
            onPress={submit}
            disabled={selected.length === 0 || submitting}
            style={[
              styles.ctaBtn,
              {
                backgroundColor: selected.length === 0 ? colors.muted : colors.primary,
                marginTop: 12,
              },
            ]}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={[styles.ctaText, { color: selected.length === 0 ? colors.mutedForeground : "#fff" }]}>
                {selected.length === 0
                  ? confirmLabel
                  : `${confirmLabel} ${selected.length === 1 ? "1 person" : `${selected.length} people`}`}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingSheet>
      <KeyboardDismissControl />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: "80%",
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#888", alignSelf: "center", marginBottom: 12, opacity: 0.5 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cancelBtn: { width: 64 },
  cancel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", padding: 0 },
  list: { flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 },
  rowSelect: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  userCopy: { flex: 1, minWidth: 0 },
  name: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  empty: { alignItems: "center", gap: 10, paddingVertical: 36, paddingHorizontal: 24 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginTop: 2 },
  retryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  ctaBtn: { borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
