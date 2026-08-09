import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";

/**
 * In-context friend request affordance.
 *
 * Sharing a squad or a plan does NOT make two people friends, and private DMs
 * are friends-only — so anywhere a roster shows someone you're not friends
 * with, this badge lets you send the request without leaving the screen.
 * Renders nothing for yourself or for people you're already friends with.
 */
export function AddFriendBadge({ userId }: { userId: string }) {
  const colors = useColors();
  const { friends, sentRequests, addFriend } = useData();

  const isFriend = friends.includes(userId);
  const isPending = !isFriend && sentRequests.includes(userId);

  if (isFriend) return null;

  if (isPending) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel="Friend request sent"
        style={[styles.badge, { backgroundColor: colors.muted, borderColor: colors.border }]}
      >
        <Ionicons name="time-outline" size={10} color={colors.mutedForeground} />
        <Text style={[styles.text, { color: colors.mutedForeground }]}>Sent</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Add friend"
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        addFriend(userId);
      }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[styles.badge, { backgroundColor: colors.primary + "1F", borderColor: colors.primary + "55" }]}
    >
      <Ionicons name="person-add-outline" size={10} color={colors.primary} />
      <Text style={[styles.text, { color: colors.primary }]}>Add</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
  },
  text: { fontSize: 9, fontWeight: "700" },
});
