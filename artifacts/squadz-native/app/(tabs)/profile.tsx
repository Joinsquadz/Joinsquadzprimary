import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { UserAvatar } from "@/components/UserAvatar";
import { EVENTS, SQUADS } from "@/data/mock";
import { router } from "expo-router";

type SettingItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  color?: string;
  onPress?: () => void;
};

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 84 : 100);

  const myEvents = EVENTS.filter((e) => e.attendeeIds.includes("me"));
  const mySquads = SQUADS;

  const SETTINGS: SettingItem[][] = [
    [
      { icon: "person-outline", label: "Edit Profile", onPress: () => {} },
      { icon: "notifications-outline", label: "Notifications", onPress: () => {} },
      { icon: "lock-closed-outline", label: "Privacy", onPress: () => {} },
    ],
    [
      { icon: "flash", label: "Upgrade to Pro", value: "$20/yr", color: colors.gold, onPress: () => Alert.alert("Pro", "Upgrade to Pro for unlimited events, photo vault, and more!") },
    ],
    [
      { icon: "help-circle-outline", label: "Help & Support", onPress: () => {} },
      { icon: "star-outline", label: "Rate SquadZ", onPress: () => {} },
    ],
    [
      {
        icon: "log-out-outline", label: "Sign Out", color: colors.destructive,
        onPress: () => Alert.alert("Sign Out", "Are you sure?", [
          { text: "Cancel", style: "cancel" },
          { text: "Sign Out", style: "destructive", onPress: () => { logout(); router.replace("/login" as never); } },
        ]),
      },
    ],
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <View style={[styles.profileCard, { paddingTop: topPad + 20, borderBottomColor: colors.border }]}>
          <UserAvatar initials={currentUser.initials} color={currentUser.color} size={80} fontSize={28} />
          <Text style={[styles.name, { color: colors.foreground }]}>{currentUser.name}</Text>
          <View style={styles.statsRow}>
            {[
              { value: myEvents.length.toString(), label: "Events" },
              { value: mySquads.length.toString(), label: "Squads" },
              { value: "Mar '24", label: "Joined" },
            ].map((s, i) => (
              <View key={i} style={styles.stat}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* My Events */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My Events</Text>
          <View style={styles.eventsGrid}>
            {myEvents.slice(0, 4).map((e) => (
              <TouchableOpacity
                key={e.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/event/${e.id}` as never); }}
                style={[styles.eventMini, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={styles.eventEmoji}>{e.emoji}</Text>
                <Text style={[styles.eventTitle, { color: colors.foreground }]} numberOfLines={1}>{e.title}</Text>
                <Text style={[styles.eventDate, { color: colors.mutedForeground }]} numberOfLines={1}>{e.date}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Settings */}
        {SETTINGS.map((group, gi) => (
          <View key={gi} style={styles.settingsGroup}>
            {group.map((item, ii) => (
              <TouchableOpacity
                key={ii}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); item.onPress?.(); }}
                style={[
                  styles.settingRow,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  ii === 0 && styles.settingFirst,
                  ii === group.length - 1 && styles.settingLast,
                  ii > 0 && { borderTopWidth: 0 },
                ]}
              >
                <Ionicons name={item.icon} size={20} color={item.color ?? colors.foreground} />
                <Text style={[styles.settingLabel, { color: item.color ?? colors.foreground, flex: 1 }]}>{item.label}</Text>
                {item.value && (
                  <Text style={[styles.settingValue, { color: colors.gold }]}>{item.value}</Text>
                )}
                {!item.color && <Ionicons name="chevron-forward" size={16} color={colors.textDim} />}
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  profileCard: { alignItems: "center", paddingHorizontal: 24, paddingBottom: 24, borderBottomWidth: 1 },
  name: { fontSize: 22, fontWeight: "800", marginTop: 12, marginBottom: 16 },
  statsRow: { flexDirection: "row", gap: 32 },
  stat: { alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 12 },
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  eventsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  eventMini: { width: "48%", borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  eventEmoji: { fontSize: 22 },
  eventTitle: { fontSize: 14, fontWeight: "700" },
  eventDate: { fontSize: 12 },
  settingsGroup: { paddingHorizontal: 20, paddingTop: 20 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderWidth: 1 },
  settingFirst: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  settingLast: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  settingLabel: { fontSize: 15 },
  settingValue: { fontSize: 13, fontWeight: "700" },
});
