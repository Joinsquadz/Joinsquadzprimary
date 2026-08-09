import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const RULES: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: "chatbubble-ellipses-outline",
    title: "Direct messages are for friends",
    body: "You can only start or continue a private chat with someone once you're both friends. This is enforced on our servers, not just hidden in the app.",
  },
  {
    icon: "people-outline",
    title: "Squad chat works for everyone in the squad",
    body: "Anyone in a squad can post in that squad's group chat, friends or not. Leaving the squad ends that access.",
  },
  {
    icon: "person-add-outline",
    title: "Sharing a squad isn't the same as being friends",
    body: "Joining a squad or a plan with someone never adds them as a friend. Send a friend request from their profile or the member list, and they choose whether to accept.",
  },
  {
    icon: "ban-outline",
    title: "Blocking cuts the private connection both ways",
    body: "Blocking removes the friendship, cancels any pending requests, and hides each of you from the other's profile, feed and DMs. You'll still both see messages in a squad chat you share — leave the squad if you want that to stop.",
  },
];

/**
 * Tappable info icon that explains what friends can do that non-friends can't.
 * Used anywhere the friends-only rules could otherwise look like a bug (the
 * friends screen, a profile with no message button, member lists).
 */
export function FriendRulesInfo({ size = 16 }: { size?: number }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="How friends and messaging work"
        onPress={() => setOpen(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="information-circle-outline" size={size} color={colors.mutedForeground} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.foreground }]}>Friends vs. squadmates</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setOpen(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {RULES.map((rule) => (
                <View key={rule.title} style={styles.row}>
                  <View style={[styles.iconWrap, { backgroundColor: colors.primary + "1A" }]}>
                    <Ionicons name={rule.icon} size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{rule.title}</Text>
                    <Text style={[styles.rowBody, { color: colors.mutedForeground }]}>{rule.body}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setOpen(false)}
              style={[styles.doneBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.doneText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 12,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: "800" },
  row: { flexDirection: "row", gap: 12, paddingVertical: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  rowBody: { fontSize: 13, lineHeight: 19 },
  doneBtn: { borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  doneText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
