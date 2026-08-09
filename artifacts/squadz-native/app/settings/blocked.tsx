import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";

type BlockedUser = { id: string; name: string; profileImageUrl: string | null };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarColor(id: string): string {
  const COLORS = ["#A855F7", "#6366F1", "#EC4899", "#F97316", "#10B981", "#3B82F6", "#EF4444"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/**
 * Settings → Blocked Users.
 *
 * Blocking is otherwise a one-way door from the profile screen: once someone is
 * blocked their profile is no longer reachable, so this is the only place an
 * unblock can happen. The list comes back with names/photos from the server
 * because per-user profile fetches are themselves block-gated.
 */
export default function BlockedUsersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();

  const [blocked, setBlocked] = useState<BlockedUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/users/blocks`, {
        headers: buildAuthHeaders(authToken),
      });
      if (!res.ok) {
        setError("Couldn't load your blocked list.");
        return;
      }
      const data = (await res.json()) as { blocked?: BlockedUser[]; blockedIds?: string[] };
      // `blocked` is the richer shape; fall back to bare ids from an older server.
      setBlocked(
        data.blocked ??
          (data.blockedIds ?? []).map((id) => ({ id, name: "SquadZ user", profileImageUrl: null })),
      );
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUnblock(user: BlockedUser) {
    if (unblocking) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUnblocking(user.id);
    const previous = blocked;
    setBlocked((prev) => (prev ?? []).filter((b) => b.id !== user.id));
    try {
      const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(user.id)}/block`, {
        method: "DELETE",
        headers: buildAuthHeaders(authToken),
      });
      if (!res.ok) {
        setBlocked(previous);
        setError("Couldn't unblock that person. Please try again.");
      }
    } catch {
      setBlocked(previous);
      setError("Network error. Please check your connection and try again.");
    } finally {
      setUnblocking(null);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) { router.back(); } else { router.replace("/profile" as never); }
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Blocked Users</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Blocked people can't see your profile, send you a friend request, or message you — and
            you won't see their content. You'll both still see messages in a squad chat you share.
          </Text>

          {error ? (
            <View style={[styles.errorBox, { borderColor: "#E5484D55", backgroundColor: "#E5484D18" }]}>
              <Text style={{ color: "#E5484D", fontSize: 13 }}>{error}</Text>
              <TouchableOpacity onPress={() => void load()} hitSlop={8}>
                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {(blocked ?? []).length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="ban-outline" size={46} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                You haven't blocked anyone.
              </Text>
            </View>
          ) : (
            <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {(blocked ?? []).map((user, i) => (
                <View
                  key={user.id}
                  style={[
                    styles.row,
                    i < (blocked ?? []).length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <UserAvatar
                    initials={initials(user.name)}
                    color={avatarColor(user.id)}
                    imageUrl={user.profileImageUrl}
                    size={38}
                    fontSize={14}
                  />
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                    {user.name}
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Unblock ${user.name}`}
                    onPress={() => void handleUnblock(user)}
                    disabled={unblocking === user.id}
                    style={[styles.unblockBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  >
                    {unblocking === user.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>Unblock</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  name: { flex: 1, fontSize: 15, fontWeight: "600" },
  unblockBtn: {
    minWidth: 84,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  empty: { alignItems: "center", gap: 12, paddingTop: 40 },
  emptyText: { fontSize: 15 },
});
