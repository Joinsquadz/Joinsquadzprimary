import { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { UpgradeModal } from "@/components/UpgradeModal";
import { TRIP_TEMPLATES } from "@/lib/tripTemplates";
import { coverFor } from "@/lib/tripUtils";

export default function TripStartScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // Entitlement comes from the global store — this screen used to fetch its own
  // copy of /api/subscription, which meant a purchase made elsewhere in the app
  // (or from its own UpgradeModal) never unlocked the templates here.
  const { isPro } = useAuth();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const startBlank = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace("/create?mode=trip" as never);
  }, []);

  const startTemplate = useCallback(
    (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (!isPro) {
        setShowUpgrade(true);
        return;
      }
      router.replace(`/create?mode=trip&templateId=${id}` as never);
    },
    [isPro],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/events" as never))}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          style={styles.headerBack}
        >
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Start a Trip</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={startBlank} activeOpacity={0.85} style={styles.blankCard}>
          <LinearGradient
            colors={coverFor("sunset")}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.blankInner}
          >
            <View style={styles.blankIcon}>
              <Ionicons name="add" size={28} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.blankTitle}>Start from scratch</Text>
              <Text style={styles.blankSub}>Build your own itinerary day by day</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.templatesHead}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Start from a template</Text>
          {!isPro ? (
            <View style={[styles.proPill, { backgroundColor: colors.gold + "22" }]}>
              <Ionicons name="star" size={11} color={colors.gold} />
              <Text style={[styles.proPillText, { color: colors.gold }]}>SquadZ+</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
          Preloaded itineraries you can tweak — saves you the blank-page stare.
        </Text>

        <View style={styles.templateGrid}>
          {TRIP_TEMPLATES.map((t) => (
            <TouchableOpacity
              key={t.id}
              onPress={() => startTemplate(t.id)}
              activeOpacity={0.85}
              style={[styles.templateCard, { borderColor: colors.border }]}
            >
              <LinearGradient
                colors={coverFor(t.coverStyle)}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.templateCover}
              >
                <Text style={styles.templateEmoji}>{t.emoji}</Text>
                {!isPro ? (
                  <View style={styles.lockBadge}>
                    <Ionicons name="lock-closed" size={12} color="#fff" />
                  </View>
                ) : null}
              </LinearGradient>
              <View style={[styles.templateBody, { backgroundColor: colors.card }]}>
                <Text style={[styles.templateTitle, { color: colors.foreground }]}>{t.title}</Text>
                <Text style={[styles.templateTagline, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {t.tagline}
                </Text>
                <Text style={[styles.templateMeta, { color: colors.mutedForeground }]}>
                  {t.nights} nights · {t.stops.length} stops
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <UpgradeModal
        visible={showUpgrade}
        trigger="events"
        onClose={() => setShowUpgrade(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  headerBack: { padding: 4, marginLeft: -4 },
  title: { fontSize: 28, fontWeight: "900" },
  blankCard: { borderRadius: 18, overflow: "hidden", marginBottom: 28 },
  blankInner: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18 },
  blankIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center",
  },
  blankTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  blankSub: { color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: "600", marginTop: 2 },
  templatesHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "800" },
  proPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  proPillText: { fontSize: 11, fontWeight: "800" },
  sectionSub: { fontSize: 13, lineHeight: 18, marginBottom: 16 },
  templateGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  templateCard: { width: "47%", borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  templateCover: { height: 84, alignItems: "center", justifyContent: "center" },
  templateEmoji: { fontSize: 36 },
  lockBadge: {
    position: "absolute", top: 8, right: 8,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center",
  },
  templateBody: { padding: 12 },
  templateTitle: { fontSize: 15, fontWeight: "800" },
  templateTagline: { fontSize: 12, marginTop: 2 },
  templateMeta: { fontSize: 11, fontWeight: "600", marginTop: 6 },
});
