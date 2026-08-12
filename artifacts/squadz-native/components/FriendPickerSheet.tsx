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
import { useData } from "@/context/AppContext";
import { useUserCache } from "@/context/UserCacheContext";
import { UserAvatar } from "@/components/UserAvatar";

type Props = {
  visible: boolean;
  /** Sheet heading, e.g. "Invite to trip". */
  title?: string;
  /** Action button label, e.g. "Invite". */
  confirmLabel?: string;
  /** User ids that are already in (host, members, already invited) — hidden. */
  excludeIds?: string[];
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
  onConfirm,
  onClose,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { friends, fetchFriends, friendsLoading, friendsAuthPending, friendsAuthError, retryFriends } =
    useData();
  const { resolveUser, prefetchUsers } = useUserCache();

  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const prevVisibleRef = useRef(false);

  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setSelected([]);
      setQuery("");
      void fetchFriends();
    }
    prevVisibleRef.current = visible;
  }, [visible, fetchFriends]);

  useEffect(() => {
    if (visible && friends.length > 0) prefetchUsers(friends);
  }, [visible, friends, prefetchUsers]);

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return friends
      .filter((id) => !exclude.has(id))
      .map((id) => ({ id, user: resolveUser(id) }))
      .filter(({ user }) => (q ? user.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
  }, [friends, exclude, query, resolveUser]);

  // A friends fetch that is still in flight (or 401ing during a cold-start auth
  // race) must not render "Add friends to invite them directly." — that falsely
  // tells the user they have no friends. Only a settled, authenticated,
  // zero-friend response is a real empty state.
  const showLoading = friends.length === 0 && (friendsLoading || friendsAuthPending);
  const showError = friends.length === 0 && !showLoading && friendsAuthError;

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
      <View style={styles.backdrop}>
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

          {friends.length > 0 && !showLoading && !showError && (
            <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search friends"
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
            ) : candidates.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={32} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  {friends.length === 0
                    ? "Add friends to invite them directly."
                    : query.trim()
                      ? "No friends match your search."
                      : "Everyone you can invite is already in."}
                </Text>
              </View>
            ) : (
              candidates.map(({ id, user }) => {
                const isSelected = selected.includes(id);
                return (
                  <TouchableOpacity
                    key={id}
                    style={styles.row}
                    onPress={() => toggle(id)}
                    activeOpacity={0.7}
                  >
                    <UserAvatar
                      initials={user.initials}
                      color={user.color}
                      imageUrl={user.profileImageUrl}
                      size={40}
                    />
                    <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                      {user.name}
                    </Text>
                    <Ionicons
                      name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={isSelected ? colors.primary : colors.mutedForeground}
                    />
                  </TouchableOpacity>
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
      </View>
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
  name: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 36, paddingHorizontal: 24 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginTop: 2 },
  retryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  ctaBtn: { borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
