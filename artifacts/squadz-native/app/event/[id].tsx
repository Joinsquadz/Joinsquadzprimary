import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Share,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { UserAvatar } from "@/components/UserAvatar";
import { getEventById, getUserById, USERS } from "@/data/mock";

type EventTab = "overview" | "guests" | "tasks" | "costs" | "admin";

export default function EventDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<EventTab>("overview");
  const [rsvp, setRsvp] = useState<"yes" | "no" | null>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const event = getEventById(id ?? "e1");

  if (!event) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Event not found</Text>
      </View>
    );
  }

  const host = getUserById(event.hostId);
  const attendees = event.attendeeIds.map(getUserById);
  const TABS: { key: EventTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "guests", label: "Guests" },
    { key: "tasks", label: "Tasks" },
    { key: "costs", label: "Costs" },
    { key: "admin", label: "Admin" },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Hero */}
      <View style={[styles.hero, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Share.share({ message: `Join ${event.title}! Code: ${event.inviteCode}` })}
          style={styles.shareBtn}
        >
          <Ionicons name="share-outline" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.heroEmoji}>{event.emoji}</Text>
        <Text style={styles.heroTitle}>{event.title}</Text>
        <Text style={styles.heroDate}>{event.date}</Text>
        <Text style={styles.heroLocation}>{event.location}</Text>

        {/* RSVP buttons */}
        <View style={styles.rsvpRow}>
          {(["yes", "no"] as const).map((v) => (
            <TouchableOpacity
              key={v}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setRsvp(v); }}
              style={[
                styles.rsvpBtn,
                {
                  backgroundColor: rsvp === v
                    ? (v === "yes" ? colors.green : colors.destructive)
                    : "rgba(255,255,255,0.15)",
                  borderColor: rsvp === v
                    ? "transparent"
                    : "rgba(255,255,255,0.3)",
                },
              ]}
            >
              <Ionicons
                name={v === "yes" ? "checkmark" : "close"}
                size={16}
                color="#fff"
              />
              <Text style={styles.rsvpText}>{v === "yes" ? "Going" : "Can't go"}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabBar, { borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 4 }}
      >
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(t.key); }}
            style={[
              styles.tabChip,
              {
                backgroundColor: tab === t.key ? colors.primary : "transparent",
                borderColor: tab === t.key ? colors.primary : "transparent",
              },
            ]}
          >
            <Text style={[styles.tabChipText, { color: tab === t.key ? "#fff" : colors.mutedForeground }]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Tab content */}
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={{ padding: 20, paddingBottom: botPad + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {tab === "overview" && (
          <View style={{ gap: 16 }}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>About</Text>
              <Text style={[styles.cardBody, { color: colors.foreground }]}>{event.description}</Text>
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Host</Text>
              <View style={styles.hostRow}>
                <UserAvatar initials={host.initials} color={host.color} size={40} fontSize={14} />
                <Text style={[styles.hostName, { color: colors.foreground }]}>{host.name}</Text>
              </View>
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Squad</Text>
              <Text style={[styles.cardBody, { color: colors.foreground }]}>{event.squadName}</Text>
            </View>
          </View>
        )}

        {tab === "guests" && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {attendees.length} attending
            </Text>
            {attendees.map((u) => (
              <View key={u.id} style={[styles.guestRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <UserAvatar initials={u.initials} color={u.color} size={44} fontSize={15} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.guestName, { color: colors.foreground }]}>{u.name}</Text>
                  <Text style={[styles.guestStatus, { color: colors.green }]}>Going</Text>
                </View>
                {u.id === event.hostId && (
                  <View style={[styles.hostBadge, { backgroundColor: colors.gold + "20", borderColor: colors.gold + "40" }]}>
                    <Text style={[styles.hostBadgeText, { color: colors.gold }]}>Host</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {tab === "tasks" && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {event.tasks.filter((t) => t.done).length}/{event.tasks.length} complete
            </Text>
            {event.tasks.map((task) => {
              const assignee = getUserById(task.assigneeId);
              return (
                <View key={task.id} style={[styles.taskRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Ionicons
                    name={task.done ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={task.done ? colors.green : colors.border}
                  />
                  <Text style={[styles.taskText, { color: task.done ? colors.mutedForeground : colors.foreground, textDecorationLine: task.done ? "line-through" : "none" }]}>
                    {task.title}
                  </Text>
                  <UserAvatar initials={assignee.initials} color={assignee.color} size={28} fontSize={10} />
                </View>
              );
            })}
            <TouchableOpacity
              onPress={() => Alert.alert("Add task", "Task creation coming soon!")}
              style={[styles.addRow, { borderColor: colors.border }]}
            >
              <Ionicons name="add" size={20} color={colors.primary} />
              <Text style={[styles.addText, { color: colors.primary }]}>Add task</Text>
            </TouchableOpacity>
          </View>
        )}

        {tab === "costs" && (
          <View style={{ gap: 8 }}>
            {event.costs.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="card-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No expenses yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Split costs with your squad</Text>
              </View>
            ) : (
              event.costs.map((cost) => {
                const payer = getUserById(cost.paidById);
                const myShare = cost.amount / cost.splitWith.length;
                return (
                  <View key={cost.id} style={[styles.costRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.costDesc, { color: colors.foreground }]}>{cost.description}</Text>
                      <Text style={[styles.costPayer, { color: colors.mutedForeground }]}>Paid by {payer.name}</Text>
                    </View>
                    <View style={styles.costRight}>
                      <Text style={[styles.costTotal, { color: colors.foreground }]}>${cost.amount}</Text>
                      <Text style={[styles.costShare, { color: colors.mutedForeground }]}>
                        ${myShare.toFixed(2)} each
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
            <TouchableOpacity
              onPress={() => Alert.alert("Add expense", "Expense tracking coming soon!")}
              style={[styles.addRow, { borderColor: colors.border }]}
            >
              <Ionicons name="add" size={20} color={colors.primary} />
              <Text style={[styles.addText, { color: colors.primary }]}>Add expense</Text>
            </TouchableOpacity>
          </View>
        )}

        {tab === "admin" && (
          <View style={{ gap: 12 }}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Invite code</Text>
              <Text style={[styles.inviteCode, { color: colors.primary }]}>{event.inviteCode}</Text>
              <Text style={[styles.inviteLink, { color: colors.mutedForeground }]}>
                getsquadz.com/join/{event.inviteCode}
              </Text>
              <TouchableOpacity
                onPress={() => Share.share({ message: `Join ${event.title}! getsquadz.com/join/${event.inviteCode}` })}
                style={[styles.shareInviteBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}
              >
                <Ionicons name="share-outline" size={16} color={colors.primary} />
                <Text style={[styles.shareInviteText, { color: colors.primary }]}>Share invite</Text>
              </TouchableOpacity>
            </View>
            {[
              { icon: "create-outline" as const, label: "Edit event details" },
              { icon: "notifications-outline" as const, label: "Send reminder to guests" },
              { icon: "trash-outline" as const, label: "Cancel event", danger: true },
            ].map((a) => (
              <TouchableOpacity
                key={a.label}
                onPress={() => Alert.alert(a.label, "Coming soon!")}
                style={[styles.adminRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name={a.icon} size={20} color={a.danger ? colors.destructive : colors.foreground} />
                <Text style={[styles.adminLabel, { color: a.danger ? colors.destructive : colors.foreground }]}>
                  {a.label}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { backgroundColor: "#FF5C3A", paddingHorizontal: 20, paddingBottom: 20, position: "relative" },
  backBtn: { position: "absolute", top: 0, left: 16, padding: 8, zIndex: 10 },
  shareBtn: { position: "absolute", top: 0, right: 16, padding: 8, zIndex: 10 },
  heroEmoji: { fontSize: 48, textAlign: "center", marginTop: 20, marginBottom: 8 },
  heroTitle: { fontSize: 24, fontWeight: "800", color: "#fff", textAlign: "center", marginBottom: 4 },
  heroDate: { fontSize: 14, color: "rgba(255,255,255,0.85)", textAlign: "center", fontWeight: "600", marginBottom: 2 },
  heroLocation: { fontSize: 13, color: "rgba(255,255,255,0.75)", textAlign: "center", marginBottom: 14 },
  rsvpRow: { flexDirection: "row", gap: 10, justifyContent: "center" },
  rsvpBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 18, paddingVertical: 8 },
  rsvpText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  tabBar: { maxHeight: 52, borderBottomWidth: 1 },
  tabChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginVertical: 8 },
  tabChipText: { fontSize: 13, fontWeight: "700" },
  tabContent: { flex: 1 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  cardTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  cardBody: { fontSize: 15, lineHeight: 22 },
  hostRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  hostName: { fontSize: 15, fontWeight: "700" },
  sectionLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  guestRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  guestName: { fontSize: 14, fontWeight: "700" },
  guestStatus: { fontSize: 12 },
  hostBadge: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  hostBadgeText: { fontSize: 11, fontWeight: "700" },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  taskText: { flex: 1, fontSize: 14 },
  costRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14 },
  costDesc: { fontSize: 14, fontWeight: "700" },
  costPayer: { fontSize: 12, marginTop: 2 },
  costRight: { alignItems: "flex-end" },
  costTotal: { fontSize: 16, fontWeight: "800" },
  costShare: { fontSize: 12 },
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", padding: 14 },
  addText: { fontSize: 14, fontWeight: "700" },
  inviteCode: { fontSize: 24, fontWeight: "800", letterSpacing: 2 },
  inviteLink: { fontSize: 12 },
  shareInviteBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start", marginTop: 4 },
  shareInviteText: { fontSize: 13, fontWeight: "700" },
  adminRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  adminLabel: { flex: 1, fontSize: 15 },
  emptyState: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 14 },
  errorText: { textAlign: "center", marginTop: 80, fontSize: 16 },
});
