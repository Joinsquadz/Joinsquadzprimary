import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData } from "@/context/AppContext";
import { friendCtaFor } from "@/lib/profileActions";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { ProAvatar } from "@/components/ProAvatar";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { FriendRulesInfo } from "@/components/FriendRulesInfo";

type SharedSquad = { id: string; name: string; emoji: string; color: string };

type UserProfile = {
  id: string;
  name: string;
  friendCode: string | null;
  profileImageUrl: string | null;
  bio: string | null;
  hometown: string | null;
  isPro: boolean;
  sharedSquads: SharedSquad[];
};

function avatarColor(id: string): string {
  const COLORS = ["#A855F7", "#6366F1", "#EC4899", "#F97316", "#10B981", "#3B82F6", "#EF4444"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function UserProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { authToken, currentUser } = useAuth();
  const { friends, sentRequests, addFriend, removeFriend } = useData();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friendLoading, setFriendLoading] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const isSelf = id === currentUser?.id;
  const isFriend = friends.includes(id ?? "");
  const isPending = !isFriend && sentRequests.includes(id ?? "");
  // Blocking severs the friendship on the server, so the cached friends list
  // goes stale the moment a block lands. friendCtaFor keeps the button honest.
  const friendCta = friendCtaFor({ blocked, isFriend, isPending, isSelf });

  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/api/users/${id}/profile`, {
          headers: buildAuthHeaders(authToken),
        });
        if (!res.ok) {
          setError("Couldn't load profile.");
          return;
        }
        const data = (await res.json()) as UserProfile;
        if (active) setProfile(data);
        // Seed the block state from the server so a profile opened AFTER a
        // block (or from another device) doesn't offer friend actions that
        // the server will refuse.
        try {
          const blockRes = await fetch(`${API_BASE}/api/users/${id}/block`, {
            headers: buildAuthHeaders(authToken),
          });
          if (blockRes.ok) {
            const blockData = (await blockRes.json()) as { blocked?: boolean };
            if (active) setBlocked(Boolean(blockData.blocked));
          }
        } catch {
          // Non-fatal: the server still enforces the block on every action.
        }
      } catch {
        if (active) setError("Network error. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id, authToken]);

  async function handleToggleFriend() {
    if (!id || !profile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFriendLoading(true);
    try {
      if (isFriend) {
        await removeFriend(id);
      } else {
        await addFriend(id);
      }
    } finally {
      setFriendLoading(false);
    }
  }

  function handleBlock() {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Block user?",
      `${profile?.name ?? "This user"} won't be able to interact with you and you won't see their content.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await fetch(`${API_BASE}/api/users/${id}/block`, {
                method: "POST",
                headers: buildAuthHeaders(authToken),
              });
              setBlocked(true);
            } catch {
              Alert.alert("Couldn't block user", "Please check your connection and try again.");
            }
          },
        },
      ],
    );
  }

  function handleReportProfile() {
    if (!id) return;
    Alert.alert("Report profile", "Why are you reporting this?", [
      {
        text: "Spam",
        onPress: () =>
          void fetch(`${API_BASE}/api/reports`, {
            method: "POST",
            headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
            body: JSON.stringify({ contentType: "profile", contentId: id, targetUserId: id, reason: "spam" }),
          }).then(() => Alert.alert("Report submitted", "Thanks for letting us know.")),
      },
      {
        text: "Inappropriate content",
        onPress: () =>
          void fetch(`${API_BASE}/api/reports`, {
            method: "POST",
            headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
            body: JSON.stringify({ contentType: "profile", contentId: id, targetUserId: id, reason: "inappropriate_content" }),
          }).then(() => Alert.alert("Report submitted", "Thanks for letting us know.")),
      },
      {
        text: "Harassment",
        onPress: () =>
          void fetch(`${API_BASE}/api/reports`, {
            method: "POST",
            headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
            body: JSON.stringify({ contentType: "profile", contentId: id, targetUserId: id, reason: "harassment" }),
          }).then(() => Alert.alert("Report submitted", "Thanks for letting us know.")),
      },
      {
        text: "Other",
        onPress: () =>
          void fetch(`${API_BASE}/api/reports`, {
            method: "POST",
            headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
            body: JSON.stringify({ contentType: "profile", contentId: id, targetUserId: id, reason: "other" }),
          }).then(() => Alert.alert("Report submitted", "Thanks for letting us know.")),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/(tabs)" as never); } }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={26} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/(tabs)" as never); } }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={26} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="person-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{error ?? "Profile not found."}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/(tabs)" as never); } }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{profile.name}</Text>
        <View style={{ width: 26, alignItems: "flex-end" }}>
          <FriendRulesInfo size={20} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {/* Avatar + name card */}
        <View style={[styles.profileCard, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <View style={styles.avatarWrap}>
            <ProAvatar
              initials={initials(profile.name)}
              color={avatarColor(profile.id)}
              imageUrl={profile.profileImageUrl}
              size={88}
              fontSize={30}
              isPro={profile.isPro}
              onPress={
                profile.profileImageUrl
                  ? () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setAvatarOpen(true);
                    }
                  : undefined
              }
            />
          </View>
          <Text style={[styles.name, { color: colors.foreground }]}>{profile.name}</Text>
          {profile.friendCode && (
            <Text style={[styles.code, { color: colors.mutedForeground }]}>{profile.friendCode}</Text>
          )}

          {profile.hometown ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={15} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{profile.hometown}</Text>
            </View>
          ) : null}

          {!isSelf && (
            <>
              {friendCta !== "none" && (
              <TouchableOpacity
                onPress={handleToggleFriend}
                disabled={friendLoading || friendCta === "pending"}
                style={[
                  styles.friendBtn,
                  {
                    backgroundColor:
                      friendCta === "remove" ? colors.card : friendCta === "pending" ? colors.muted : colors.primary,
                    borderColor:
                      friendCta === "remove" ? colors.border : friendCta === "pending" ? colors.border : colors.primary,
                  },
                ]}
              >
                {friendLoading ? (
                  <ActivityIndicator size="small" color={friendCta === "remove" ? colors.foreground : "#fff"} />
                ) : (
                  <>
                    <Ionicons
                      name={
                        friendCta === "remove"
                          ? "person-remove-outline"
                          : friendCta === "pending"
                            ? "time-outline"
                            : "person-add-outline"
                      }
                      size={16}
                      color={friendCta === "add" ? "#fff" : colors.foreground}
                    />
                    <Text
                      style={[
                        styles.friendBtnText,
                        { color: friendCta === "add" ? "#fff" : colors.foreground },
                      ]}
                    >
                      {friendCta === "remove"
                        ? "Remove friend"
                        : friendCta === "pending"
                          ? "Request sent"
                          : "Add friend"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              )}
              <View style={styles.modRow}>
                {!blocked ? (
                  <TouchableOpacity onPress={handleBlock} hitSlop={6} style={styles.modBtn}>
                    <Ionicons name="ban-outline" size={14} color={colors.mutedForeground} />
                    <Text style={[styles.modBtnText, { color: colors.mutedForeground }]}>Block</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.modBtnText, { color: colors.mutedForeground }]}>Blocked</Text>
                )}
                <Text style={[styles.modSep, { color: colors.mutedForeground }]}>·</Text>
                <TouchableOpacity onPress={handleReportProfile} hitSlop={6} style={styles.modBtn}>
                  <Ionicons name="flag-outline" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.modBtnText, { color: colors.mutedForeground }]}>Report</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        <View style={{ padding: 20 }}>
          {/* Bio */}
          {profile.bio ? (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Bio</Text>
              <Text style={[styles.sectionBody, { color: colors.foreground }]}>{profile.bio}</Text>
            </View>
          ) : null}

          {/* Shared squads */}
          {profile.sharedSquads.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                Squads in common
              </Text>
              {profile.sharedSquads.map((sq) => (
                <TouchableOpacity
                  key={sq.id}
                  onPress={() => router.push(`/squad/${sq.id}` as never)}
                  style={[styles.squadRow, { borderTopColor: colors.border }]}
                >
                  <View style={[styles.squadEmoji, { backgroundColor: sq.color + "30" }]}>
                    <Text style={{ fontSize: 18 }}>{sq.emoji}</Text>
                  </View>
                  <Text style={[styles.squadName, { color: colors.foreground }]} numberOfLines={1}>
                    {sq.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Empty state */}
          {!profile.bio && profile.sharedSquads.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="person-circle-outline" size={52} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {isSelf ? "Add a bio and hometown to your profile." : "Nothing to show here yet."}
              </Text>
              {isSelf && (
                <TouchableOpacity
                  onPress={() => router.push("/settings/edit-profile" as never)}
                  style={[styles.editBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={styles.editBtnText}>Edit Profile</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <ImageViewerModal
        visible={avatarOpen}
        uri={profile.profileImageUrl}
        onClose={() => setAvatarOpen(false)}
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
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 15, textAlign: "center" },
  profileCard: {
    alignItems: "center",
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  avatarWrap: { marginBottom: 4 },
  name: { fontSize: 22, fontWeight: "700" },
  code: { fontSize: 13, marginTop: -4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  metaText: { fontSize: 14 },
  friendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 8,
  },
  friendBtnText: { fontSize: 14, fontWeight: "600" },
  section: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
    overflow: "hidden",
  },
  sectionLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, textTransform: "uppercase" },
  sectionBody: { fontSize: 15, lineHeight: 22, paddingHorizontal: 16, paddingBottom: 16 },
  squadRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  squadEmoji: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  squadName: { flex: 1, fontSize: 15, fontWeight: "500" },
  emptyState: { alignItems: "center", paddingTop: 32, gap: 12 },
  emptyText: { fontSize: 15, textAlign: "center", maxWidth: 260 },
  editBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, marginTop: 4 },
  editBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  modRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  modBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  modBtnText: { fontSize: 13 },
  modSep: { fontSize: 13 },
});
