import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import type { ResolvedUser } from "@/context/UserCacheContext";

type MemberProfileData = {
  name: string;
  friendCode: string | null;
  profileImageUrl: string | null;
  sharedSquads: Array<{ id: string; name: string; emoji: string; color: string }>;
};

interface ContactSheetProps {
  visible: boolean;
  member: ResolvedUser | null;
  onClose: () => void;
}

/**
 * Shared contact / member profile sheet used from squad and event screens.
 * Always renders a persistent close (X) and is fully scrollable so the close
 * affordance can never be pushed off-screen by long content.
 */
export function ContactSheet({ visible, member, onClose }: ContactSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const { authToken } = useAuth();
  const {
    squads,
    currentUser,
    addMemberByFriendCode,
    friends,
    addFriend,
    removeFriend,
  } = useData();

  const [profileData, setProfileData] = useState<MemberProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [quickAddingSquadId, setQuickAddingSquadId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !member) return;
    let active = true;
    setProfileData(null);
    setProfileLoading(true);
    const headers = { "Content-Type": "application/json", ...buildAuthHeaders(authToken) };
    fetch(`${API_BASE}/api/users/${member.id}/profile`, { headers })
      .then((res) => (res.ok ? (res.json() as Promise<MemberProfileData>) : null))
      .then((data) => { if (active && data) setProfileData(data); })
      .catch(() => { /* leave null — sheet shows cached name/initials */ })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [visible, member, authToken]);

  if (!member) return null;

  const isSelf = member.id === currentUser.id;
  const isFriend = friends.includes(member.id);

  const handleQuickAdd = async (squadId: string, friendCode: string) => {
    setQuickAddingSquadId(squadId);
    await addMemberByFriendCode(squadId, friendCode);
    setQuickAddingSquadId(null);
  };

  const toggleFriend = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isFriend) removeFriend(member.id);
    else addFriend(member.id);
  };

  const canAddTo = profileData?.friendCode
    ? squads.filter(
        (s) =>
          s.memberIds.includes(currentUser.id) &&
          !s.memberIds.includes(member.id) &&
          (s.creatorId === currentUser.id || (s.membersCanInvite ?? false)),
      )
    : [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
          {/* Persistent close — always visible above scrolling content */}
          <TouchableOpacity
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: colors.card }]}
            accessibilityLabel="Close"
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={colors.foreground} />
          </TouchableOpacity>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8 }}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <UserAvatar
                initials={member.initials}
                color={member.color}
                imageUrl={profileData?.profileImageUrl ?? member.profileImageUrl}
                size={72}
                fontSize={24}
              />
              <Text style={[styles.name, { color: colors.foreground }]}>
                {profileData?.name ?? member.name}{isSelf ? " (You)" : ""}
              </Text>
              {profileData?.friendCode ? (
                <Text style={[styles.friendCode, { color: colors.mutedForeground, backgroundColor: colors.card }]}>
                  #{profileData.friendCode}
                </Text>
              ) : null}
            </View>

            {profileLoading && !profileData ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
            ) : null}

            {/* Add / remove friend */}
            {!isSelf && (
              <TouchableOpacity
                onPress={toggleFriend}
                style={[
                  styles.friendBtn,
                  isFriend
                    ? { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
                    : { backgroundColor: colors.primary },
                ]}
              >
                <Ionicons
                  name={isFriend ? "checkmark-circle" : "person-add"}
                  size={18}
                  color={isFriend ? colors.primary : "#fff"}
                />
                <Text style={[styles.friendBtnText, { color: isFriend ? colors.foreground : "#fff" }]}>
                  {isFriend ? "Friends" : "Add friend"}
                </Text>
              </TouchableOpacity>
            )}

            {/* Shared squads */}
            {profileData && profileData.sharedSquads.length > 0 && (
              <>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Shared SquadZ</Text>
                {profileData.sharedSquads.map((sq) => (
                  <View key={sq.id} style={[styles.row, { borderColor: colors.border }]}>
                    <Text style={{ fontSize: 20 }}>{sq.emoji}</Text>
                    <Text style={[styles.rowName, { color: colors.foreground, flex: 1 }]}>{sq.name}</Text>
                  </View>
                ))}
              </>
            )}

            {/* Quick-add to other squads */}
            {canAddTo.length > 0 && profileData?.friendCode && (
              <>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 12 }]}>Add to another Squad</Text>
                {canAddTo.map((sq) => (
                  <TouchableOpacity
                    key={sq.id}
                    onPress={() => { void handleQuickAdd(sq.id, profileData.friendCode!); }}
                    disabled={quickAddingSquadId === sq.id}
                    style={[styles.row, { borderColor: colors.primary + "50", opacity: quickAddingSquadId === sq.id ? 0.6 : 1 }]}
                  >
                    <Text style={{ fontSize: 20 }}>{sq.emoji}</Text>
                    <Text style={[styles.rowName, { color: colors.foreground, flex: 1 }]}>{sq.name}</Text>
                    {quickAddingSquadId === sq.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <View style={[styles.addPill, { backgroundColor: colors.primary }]}>
                        <Ionicons name="add" size={14} color="#fff" />
                        <Text style={styles.addPillText}>Add</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  card: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: "82%",
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 20, fontWeight: "800", marginTop: 12, marginBottom: 2, textAlign: "center" },
  friendCode: { fontSize: 13, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: "hidden", marginTop: 2 },
  friendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 4,
  },
  friendBtnText: { fontSize: 15, fontWeight: "700" },
  fieldLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 13, padding: 12, marginBottom: 8 },
  rowName: { fontSize: 14, fontWeight: "600" },
  addPill: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  addPillText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
