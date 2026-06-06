import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import Constants from "expo-constants";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";

function resolveApiBase(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined;
  if (extra?.apiBase) return extra.apiBase;
  if (Platform.OS === "web") return "";
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "";
}

const PLACEHOLDER_PHOTOS = [
  { id: 1, emoji: "🔥", label: "Rooftop BBQ", squad: "The Usual Suspects", date: "Jun 7", color: "#FF6B3A" },
  { id: 2, emoji: "🎳", label: "Bowling Night", squad: "College Crew", date: "May 24", color: "#7B6EF6" },
  { id: 3, emoji: "🍕", label: "Pizza Friday", squad: "Work Crew", date: "May 17", color: "#F5A623" },
  { id: 4, emoji: "🏖️", label: "Beach Day", squad: "Westside Fam", date: "Apr 30", color: "#4ECDC4" },
  { id: 5, emoji: "🎮", label: "Game Night", squad: "The Usual Suspects", date: "Apr 19", color: "#A78BFA" },
  { id: 6, emoji: "🍳", label: "Brunch Run", squad: "College Crew", date: "Apr 5", color: "#FB923C" },
];

const FILTERS = ["All", "The Usual Suspects", "College Crew", "Work Crew"];

const API_BASE = resolveApiBase();

export default function VaultScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState("All");

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const authHeaders = useCallback((): HeadersInit => {
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  }, [authToken]);

  useEffect(() => {
    fetch(`${API_BASE}/api/subscription`, { headers: authHeaders() })
      .then(r => {
        if (!r.ok) { setIsPro(false); return; }
        return r.json();
      })
      .then((d?: { isPro?: boolean }) => { if (d !== undefined) setIsPro(!!d.isPro); })
      .catch(() => setIsPro(false));
  }, [authHeaders]);

  const selectedPhoto = PLACEHOLDER_PHOTOS.find(p => p.id === selected) ?? null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>📷 Photo Vault</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Private squad memories</Text>
        </View>
        {isPro && (
          <View style={[styles.proBadge, { backgroundColor: colors.gold + "22", borderColor: colors.gold + "60" }]}>
            <Text style={[styles.proBadgeText, { color: colors.gold }]}>PRO</Text>
          </View>
        )}
      </View>

      {isPro === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : !isPro ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.lockCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.lockIcon}>🔒</Text>
            <Text style={[styles.lockTitle, { color: colors.foreground }]}>Photo Vault is a Pro feature</Text>
            <Text style={[styles.lockBody, { color: colors.mutedForeground }]}>
              Upload unlimited squad photos. They're private, organized by event, and stored securely — only visible to squad members.
            </Text>
            <View style={styles.featurePills}>
              {["🖼️ Private gallery", "📁 By event", "🔐 Members only"].map(f => (
                <View key={f} style={[styles.pill, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.pillText, { color: colors.mutedForeground }]}>{f}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.blurGrid}>
            {PLACEHOLDER_PHOTOS.map(p => (
              <View key={p.id} style={[styles.gridCell, { backgroundColor: p.color + "30", opacity: 0.35 }]}>
                <Text style={styles.gridEmoji}>{p.emoji}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.back(); }}
            style={[styles.upgradeBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.85}
          >
            <Text style={styles.upgradeBtnText}>⚡ Upgrade to Pro — $20/year</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>6 photos · tap to view details</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ gap: 8 }}>
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveFilter(f); }}
                style={[styles.filterChip, {
                  backgroundColor: activeFilter === f ? colors.primary : colors.card,
                  borderColor: activeFilter === f ? colors.primary : colors.border,
                }]}
              >
                <Text style={[styles.filterChipText, { color: activeFilter === f ? "#fff" : colors.mutedForeground }]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.grid}>
            {PLACEHOLDER_PHOTOS.map(p => (
              <TouchableOpacity
                key={p.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelected(selected === p.id ? null : p.id); }}
                style={[styles.gridCell, { backgroundColor: p.color + "30", borderWidth: 2, borderColor: selected === p.id ? colors.primary : "transparent" }]}
                activeOpacity={0.8}
              >
                <Text style={styles.gridEmoji}>{p.emoji}</Text>
                {selected === p.id && (
                  <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
                    <Ionicons name="checkmark" size={10} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {selectedPhoto && (
            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.detailTitle, { color: colors.foreground }]}>{selectedPhoto.emoji} {selectedPhoto.label}</Text>
              <Text style={[styles.detailMeta, { color: colors.mutedForeground }]}>{selectedPhoto.squad} · {selectedPhoto.date}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.uploadBtn, { borderColor: colors.border }]}
            activeOpacity={0.7}
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          >
            <Ionicons name="add" size={28} color={colors.mutedForeground} />
            <Text style={[styles.uploadLabel, { color: colors.mutedForeground }]}>Upload photos</Text>
            <Text style={[styles.uploadSub, { color: colors.mutedForeground }]}>Add memories from your last event</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { marginBottom: 2, marginRight: 4 },
  headerText: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  proBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 4,
  },
  proBadgeText: { fontSize: 10, fontWeight: "900", fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 20 },
  lockCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    marginBottom: 20,
  },
  lockIcon: { fontSize: 56, marginBottom: 14 },
  lockTitle: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 10 },
  lockBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, marginBottom: 20 },
  featurePills: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  pill: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  blurGrid: { flexDirection: "row", flexWrap: "wrap", borderRadius: 14, overflow: "hidden", marginBottom: 24, gap: 4 },
  upgradeBtn: {
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  upgradeBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15, fontWeight: "800" },
  countLabel: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  filterRow: { marginBottom: 16 },
  filterChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7, flexShrink: 0 },
  filterChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4, borderRadius: 14, overflow: "hidden", marginBottom: 16 },
  gridCell: {
    width: "31.5%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    position: "relative",
  },
  gridEmoji: { fontSize: 28 },
  checkBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  detailTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4 },
  detailMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  uploadBtn: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    gap: 6,
  },
  uploadLabel: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  uploadSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
