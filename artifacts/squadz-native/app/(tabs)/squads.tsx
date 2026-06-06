import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";
import { getUserById } from "@/data/mock";

export default function SquadsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { squads, events } = useData();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 100);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>SquadZ</Text>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/create"); }}
          style={[styles.newBtn, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>
          {squads.length} squad{squads.length !== 1 ? "s" : ""}
        </Text>

        {squads.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 52, marginBottom: 14 }}>👥</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No squads yet</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Create a squad and invite your people
            </Text>
          </View>
        ) : (
          squads.map((squad) => {
            const squadEvents = events.filter((e) => e.squadId === squad.id);
            const members = squad.memberIds.slice(0, 5).map(getUserById);
            return (
              <TouchableOpacity
                key={squad.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push(`/squad/${squad.id}`); }}
                style={[styles.squadCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.squadIcon, { backgroundColor: squad.color + "22", borderColor: squad.color + "30", borderWidth: 1 }]}>
                  <Text style={{ fontSize: 30 }}>{squad.emoji}</Text>
                </View>
                <View style={styles.squadBody}>
                  <Text style={[styles.squadName, { color: colors.foreground }]}>{squad.name}</Text>
                  <Text style={[styles.squadMeta, { color: colors.mutedForeground }]}>
                    {squad.memberIds.length} members · {squadEvents.length} event{squadEvents.length !== 1 ? "s" : ""}
                  </Text>
                  <View style={styles.memberAvatars}>
                    {members.map((m, i) => (
                      <View
                        key={m.id}
                        style={[
                          styles.memberAvatar,
                          { backgroundColor: m.color, marginLeft: i > 0 ? -7 : 0, borderColor: colors.card },
                        ]}
                      >
                        <Text style={styles.memberInitial}>{m.initials[0]}</Text>
                      </View>
                    ))}
                    {squad.memberIds.length > 5 && (
                      <View style={[styles.memberAvatar, { backgroundColor: colors.surfaceUp, marginLeft: -7, borderColor: colors.card }]}>
                        <Text style={[styles.memberInitial, { color: colors.mutedForeground }]}>
                          +{squad.memberIds.length - 5}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </TouchableOpacity>
            );
          })
        )}

        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/create"); }}
          style={[styles.createBtn, { borderColor: colors.primary + "40" }]}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
          <Text style={[styles.createBtnText, { color: colors.primary }]}>Create a new squad</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  title: { fontSize: 28, fontWeight: "900" },
  newBtn: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  countLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  squadCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 10,
  },
  squadIcon: { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  squadBody: { flex: 1, gap: 3 },
  squadName: { fontSize: 16, fontWeight: "800" },
  squadMeta: { fontSize: 12 },
  memberAvatars: { flexDirection: "row", marginTop: 4 },
  memberAvatar: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2,
  },
  memberInitial: { fontSize: 9, fontWeight: "800", color: "#fff" },
  empty: { alignItems: "center", paddingTop: 60, paddingBottom: 40 },
  emptyTitle: { fontSize: 20, fontWeight: "800", marginBottom: 8 },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed", padding: 16, marginTop: 6,
  },
  createBtnText: { fontSize: 15, fontWeight: "700" },
});
