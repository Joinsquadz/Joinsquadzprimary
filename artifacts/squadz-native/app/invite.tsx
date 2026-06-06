import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { EVENTS, getUserById } from "@/data/mock";

export default function InviteScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ eventId?: string; code?: string }>();
  const [accepted, setAccepted] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const event = params.eventId ? EVENTS.find((e) => e.id === params.eventId) : EVENTS[0];
  const inviteCode = params.code ?? event?.inviteCode ?? "BBQ-7K2M";

  if (!event) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <Text style={{ color: colors.foreground, textAlign: "center", marginTop: 40 }}>
          Invalid invite link
        </Text>
      </View>
    );
  }

  const host = getUserById(event.hostId);
  const inviteParams = {
    inviteCode,
    inviteTitle: event.title,
    inviteEmoji: event.emoji,
    inviteHost: host.name,
    inviteEventId: event.id,
  };

  if (accepted) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.successWrap}>
          <View style={[styles.successIcon, { backgroundColor: colors.green + "20" }]}>
            <Ionicons name="checkmark-circle" size={56} color={colors.green} />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>You're in!</Text>
          <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
            You've joined {event.title}. See you there!
          </Text>
          <TouchableOpacity
            onPress={() => router.replace(`/event/${event.id}` as never)}
            style={[styles.btn, { backgroundColor: colors.primary, marginTop: 24 }]}
          >
            <Text style={[styles.btnText, { color: "#fff" }]}>View Event →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.hero, { paddingTop: topPad + 20 }]}>
        <Text style={[styles.heroLabel, { color: "rgba(255,255,255,0.7)" }]}>YOU'RE INVITED</Text>
        <Text style={styles.heroEmoji}>{event.emoji}</Text>
        <Text style={[styles.heroTitle, { color: "#fff" }]}>{event.title}</Text>
        <Text style={[styles.heroSquad, { color: "rgba(255,255,255,0.8)" }]}>{event.squadName}</Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: botPad + 24 }}>
        <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { icon: "person-outline" as const, text: `Hosted by ${host.name}` },
            { icon: "calendar-outline" as const, text: event.date },
            { icon: "location-outline" as const, text: event.location },
            { icon: "people-outline" as const, text: `${event.attendeeIds.length} going · ${event.squadName}` },
          ].map((row, i) => (
            <View key={i} style={[styles.detailRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <Ionicons name={row.icon} size={18} color={colors.primary} />
              <Text style={[styles.detailText, { color: colors.foreground }]}>{row.text}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>Invite code</Text>
          <Text style={[styles.code, { color: colors.primary }]}>{inviteCode}</Text>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert("Copied!", `Invite code ${inviteCode} copied.`);
            }}
            style={[styles.copyBtn, { borderColor: colors.primary }]}
          >
            <Ionicons name="copy-outline" size={16} color={colors.primary} />
            <Text style={[styles.copyText, { color: colors.primary }]}>Copy code</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setAccepted(true);
          }}
          style={[styles.btn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.btnText, { color: "#fff" }]}>Accept Invite →</Text>
        </TouchableOpacity>

        <View style={styles.altRow}>
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/signup", params: inviteParams } as never)}
            style={[styles.altBtn, { borderColor: colors.border, flex: 1 }]}
          >
            <Text style={[styles.altBtnText, { color: colors.mutedForeground }]}>Create Account</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/login", params: inviteParams } as never)}
            style={[styles.altBtn, { borderColor: colors.primary, flex: 1 }]}
          >
            <Text style={[styles.altBtnText, { color: colors.primary }]}>Sign In</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.note, { color: colors.textDim }]}>
          By joining you agree to the squad's terms. Invite expires in 7 days.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: {
    backgroundColor: "#FF5C3A",
    paddingHorizontal: 24,
    paddingBottom: 28,
    alignItems: "center",
  },
  heroLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1.5, marginBottom: 8 },
  heroEmoji: { fontSize: 52, marginBottom: 8 },
  heroTitle: { fontSize: 28, fontWeight: "800", textAlign: "center" },
  heroSquad: { fontSize: 14, marginTop: 4 },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  detailCard: { borderRadius: 16, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  detailText: { fontSize: 14, fontWeight: "500", flex: 1 },
  codeCard: { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: "center", marginBottom: 16 },
  codeLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  code: { fontSize: 28, fontWeight: "800", letterSpacing: 2, marginBottom: 12, fontVariant: ["tabular-nums"] },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 8 },
  copyText: { fontSize: 13, fontWeight: "700" },
  btn: { borderRadius: 14, padding: 15, alignItems: "center", marginBottom: 12 },
  btnText: { fontSize: 16, fontWeight: "800" },
  altRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  altBtn: { borderRadius: 12, borderWidth: 1.5, padding: 12, alignItems: "center" },
  altBtnText: { fontSize: 13, fontWeight: "700" },
  note: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  successIcon: { width: 100, height: 100, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  successTitle: { fontSize: 32, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  successSub: { fontSize: 15, textAlign: "center", lineHeight: 22 },
});
