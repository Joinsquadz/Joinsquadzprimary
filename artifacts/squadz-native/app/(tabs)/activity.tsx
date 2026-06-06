import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

type Tab = "reminders" | "feed";

const REMINDERS = [
  { id: "r1", icon: "flame-outline" as const, color: "#FF5C3A", title: "Rooftop BBQ is tomorrow!", sub: "RSVP before 5 PM tonight", action: "RSVP", eventId: "e1" },
  { id: "r2", icon: "list-outline" as const, color: "#FFB547", title: "2 tasks still open", sub: "Game Night · Jun 11", action: "View", eventId: "e2" },
  { id: "r3", icon: "game-controller-outline" as const, color: "#4A9EFF", title: "Game Night in 3 days", sub: "Marcus's Place · 7:00 PM", action: "View", eventId: "e2" },
  { id: "r4", icon: "person-add-outline" as const, color: "#A855F7", title: "Alex Chen wants to join", sub: "The Usual Suspects", action: "Review", eventId: null },
];

const FEED = [
  { id: "f1", time: "2h ago", text: "Marcus Chen added a new poll to Rooftop BBQ", emoji: "🗳️" },
  { id: "f2", time: "4h ago", text: "Sarah Kim RSVP'd to Beach Day", emoji: "🏖️" },
  { id: "f3", time: "Yesterday", text: "Jamie Lee created Birthday Bash in Work Crew", emoji: "🎉" },
  { id: "f4", time: "2 days ago", text: "Alex Chen completed the task 'Set up TV'", emoji: "✅" },
  { id: "f5", time: "3 days ago", text: "You joined The Usual Suspects", emoji: "🔥" },
];

export default function ActivityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("reminders");

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 100);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Activity</Text>
        <View style={[styles.tabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(["reminders", "feed"] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(t); }}
              style={[styles.tabBtn, tab === t && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.tabText, { color: tab === t ? "#fff" : colors.mutedForeground }]}>
                {t === "reminders" ? "Reminders" : "Feed"}
              </Text>
              {t === "reminders" && (
                <View style={[styles.tabBadge, { backgroundColor: tab === t ? "#fff30" : colors.primary }]}>
                  <Text style={[styles.tabBadgeText, { color: tab === t ? colors.primary : "#fff" }]}>4</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
      >
        {tab === "reminders"
          ? REMINDERS.map((r) => (
              <View key={r.id} style={[styles.reminderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.reminderIcon, { backgroundColor: r.color + "20" }]}>
                  <Ionicons name={r.icon} size={22} color={r.color} />
                </View>
                <View style={styles.reminderBody}>
                  <Text style={[styles.reminderTitle, { color: colors.foreground }]}>{r.title}</Text>
                  <Text style={[styles.reminderSub, { color: colors.mutedForeground }]}>{r.sub}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (r.eventId) router.push(`/event/${r.eventId}` as never);
                  }}
                  style={[styles.reminderAction, { backgroundColor: r.color + "20", borderColor: r.color + "40" }]}
                >
                  <Text style={[styles.reminderActionText, { color: r.color }]}>{r.action}</Text>
                </TouchableOpacity>
              </View>
            ))
          : FEED.map((f) => (
              <View key={f.id} style={[styles.feedItem, { borderBottomColor: colors.border }]}>
                <Text style={styles.feedEmoji}>{f.emoji}</Text>
                <View style={styles.feedBody}>
                  <Text style={[styles.feedText, { color: colors.foreground }]}>{f.text}</Text>
                  <Text style={[styles.feedTime, { color: colors.textDim }]}>{f.time}</Text>
                </View>
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  title: { fontSize: 28, fontWeight: "900", marginBottom: 12 },
  tabs: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3, gap: 2 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, paddingVertical: 8 },
  tabText: { fontSize: 14, fontWeight: "700" },
  tabBadge: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  tabBadgeText: { fontSize: 10, fontWeight: "800" },
  reminderCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10,
  },
  reminderIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  reminderBody: { flex: 1 },
  reminderTitle: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  reminderSub: { fontSize: 12 },
  reminderAction: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  reminderActionText: { fontSize: 12, fontWeight: "700" },
  feedItem: { flexDirection: "row", gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  feedEmoji: { fontSize: 20, marginTop: 1 },
  feedBody: { flex: 1 },
  feedText: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  feedTime: { fontSize: 12 },
});
