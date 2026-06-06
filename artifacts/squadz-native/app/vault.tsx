import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { PLACEHOLDER_PHOTOS, FILTERS, photoFilename, type VaultPhoto } from "@/constants/photos";
import { downloadPhoto } from "@/lib/downloadPhoto";

const VAULT_FILTER_KEY = "vault:activeFilter";
const VAULT_SELECTED_KEY = "vault:selectedPhoto";
const VAULT_SCROLL_KEY = "vault:scrollY";

function resolveApiBase(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined;
  if (extra?.apiBase) return extra.apiBase;
  if (Platform.OS === "web") return "";
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "";
}

const API_BASE = resolveApiBase();

export default function VaultScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState("All");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const initialized = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const saveScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { squadId, squadName, eventId, eventName } = useLocalSearchParams<{
    squadId?: string;
    squadName?: string;
    eventId?: string;
    eventName?: string;
  }>();

  const isContextual = !!(squadId || eventId);

  const filterLabel = eventName
    ? decodeURIComponent(eventName)
    : squadName
    ? decodeURIComponent(squadName)
    : null;

  const decodedSquadName = squadName ? decodeURIComponent(squadName as string) : "";
  const decodedEventName = eventName ? decodeURIComponent(eventName as string) : "";

  const filteredPhotos = PLACEHOLDER_PHOTOS.filter((p) => {
    if (eventId) {
      if (decodedEventName) {
        const hasExactMatch = PLACEHOLDER_PHOTOS.some(
          (ph) => ph.label.toLowerCase() === decodedEventName.toLowerCase(),
        );
        if (hasExactMatch) return p.label.toLowerCase() === decodedEventName.toLowerCase();
        const hasPartialMatch = PLACEHOLDER_PHOTOS.some(
          (ph) =>
            ph.label.toLowerCase().includes(decodedEventName.toLowerCase()) ||
            decodedEventName.toLowerCase().includes(ph.label.toLowerCase()),
        );
        if (hasPartialMatch) {
          return (
            p.label.toLowerCase().includes(decodedEventName.toLowerCase()) ||
            decodedEventName.toLowerCase().includes(p.label.toLowerCase())
          );
        }
      }
      const hash = [...(eventId as string)].reduce((acc, c) => acc + c.charCodeAt(0), 0);
      return p.id % 3 === hash % 3;
    }
    if (squadId) {
      if (decodedSquadName && PLACEHOLDER_PHOTOS.some((ph) => ph.squad === decodedSquadName)) {
        return p.squad === decodedSquadName;
      }
      return true;
    }
    if (activeFilter !== "All") return p.squad === activeFilter;
    return true;
  });

  const activeFilters = isContextual ? [] : FILTERS;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  useEffect(() => {
    if (isContextual) {
      initialized.current = true;
      return;
    }
    Promise.all([
      AsyncStorage.getItem(VAULT_FILTER_KEY),
      AsyncStorage.getItem(VAULT_SELECTED_KEY),
      AsyncStorage.getItem(VAULT_SCROLL_KEY),
    ]).then(([savedFilter, savedSelected, savedScroll]) => {
      if (savedFilter && FILTERS.includes(savedFilter)) {
        setActiveFilter(savedFilter);
      }
      if (savedSelected) {
        const id = parseInt(savedSelected, 10);
        if (!isNaN(id) && PLACEHOLDER_PHOTOS.some(p => p.id === id)) {
          setSelected(id);
        }
      }
      initialized.current = true;

      if (savedScroll) {
        const y = parseFloat(savedScroll);
        if (!isNaN(y) && y > 0) {
          setTimeout(() => {
            scrollRef.current?.scrollTo({ y, animated: false });
          }, 100);
        }
      }
    });
  }, [isContextual]);

  useEffect(() => {
    if (!initialized.current || isContextual) return;
    AsyncStorage.setItem(VAULT_FILTER_KEY, activeFilter);
  }, [activeFilter, isContextual]);

  useEffect(() => {
    if (!initialized.current || isContextual) return;
    if (selected === null) {
      AsyncStorage.removeItem(VAULT_SELECTED_KEY);
    } else {
      AsyncStorage.setItem(VAULT_SELECTED_KEY, String(selected));
    }
  }, [selected, isContextual]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isContextual) return;
    scrollYRef.current = e.nativeEvent.contentOffset.y;
    if (saveScrollTimer.current) clearTimeout(saveScrollTimer.current);
    saveScrollTimer.current = setTimeout(() => {
      AsyncStorage.setItem(VAULT_SCROLL_KEY, String(scrollYRef.current));
    }, 300);
  }, [isContextual]);

  const authHeaders = useCallback((): HeadersInit => {
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  }, [authToken]);

  useEffect(() => {
    fetch(`${API_BASE}/api/subscription`, { headers: authHeaders(), credentials: "include" })
      .then((r) => {
        if (!r.ok) {
          setIsPro(false);
          return;
        }
        return r.json();
      })
      .then((d?: { isPro?: boolean }) => {
        if (d !== undefined) setIsPro(!!d.isPro);
      })
      .catch(() => setIsPro(false));
  }, [authHeaders]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const handleDownload = useCallback(
    async (photo: VaultPhoto) => {
      if (downloadingId !== null) return;
      setDownloadingId(photo.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await downloadPhoto(photo.url, photoFilename(photo));
      setDownloadingId(null);
      if (result === "saved") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(Platform.OS === "web" ? "Photo downloaded" : "Saved to your photos");
      } else if (result === "denied") {
        showToast("Photo library permission needed");
      } else {
        showToast("Couldn't download photo");
      }
    },
    [downloadingId, showToast],
  );

  const selectedPhoto = filteredPhotos.find((p) => p.id === selected) ?? null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>📷 Photo Vault</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {filterLabel ? filterLabel : "Private squad memories"}
          </Text>
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
              Upload unlimited squad photos. They're private, organized by event, and downloadable to
              your device anytime — only visible to squad members.
            </Text>
            <View style={styles.featurePills}>
              {["🖼️ Private gallery", "📁 By event", "⬇️ Download anytime"].map((f) => (
                <View key={f} style={[styles.pill, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.pillText, { color: colors.mutedForeground }]}>{f}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.grid}>
            {PLACEHOLDER_PHOTOS.map((p) => (
              <View key={p.id} style={styles.gridCell}>
                <Image source={{ uri: p.url }} style={styles.gridImage} contentFit="cover" transition={150} blurRadius={18} />
                <View style={styles.lockOverlay}>
                  <Ionicons name="lock-closed" size={18} color="#fff" />
                </View>
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.back();
            }}
            style={[styles.upgradeBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.85}
          >
            <Text style={styles.upgradeBtnText}>⚡ Upgrade to Pro — $20/year</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, { paddingBottom: botPad + 24 }]}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={100}
        >
          <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>
            {filteredPhotos.length} photos · tap to view details
          </Text>

          {activeFilters.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterRow}
              contentContainerStyle={{ gap: 8 }}
            >
              {activeFilters.map((f) => (
                <TouchableOpacity
                  key={f}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setActiveFilter(f);
                  }}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: activeFilter === f ? colors.primary : colors.card,
                      borderColor: activeFilter === f ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.filterChipText, { color: activeFilter === f ? "#fff" : colors.mutedForeground }]}>
                    {f}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {filterLabel && (
            <View style={[styles.filterBadge, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}>
              <Ionicons name={eventId ? "calendar-outline" : "people-outline"} size={14} color={colors.primary} />
              <Text style={[styles.filterBadgeText, { color: colors.primary }]}>{filterLabel}</Text>
              <TouchableOpacity onPress={() => router.push("/vault" as never)}>
                <Ionicons name="close" size={14} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.grid}>
            {filteredPhotos.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelected(selected === p.id ? null : p.id);
                }}
                style={[styles.gridCell, { borderWidth: 2, borderColor: selected === p.id ? colors.primary : "transparent" }]}
                activeOpacity={0.85}
              >
                <Image source={{ uri: p.url }} style={styles.gridImage} contentFit="cover" transition={150} />
                <TouchableOpacity
                  onPress={() => handleDownload(p)}
                  disabled={downloadingId !== null}
                  style={styles.tileDownload}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {downloadingId === p.id ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons name="download-outline" size={15} color="#fff" />
                  )}
                </TouchableOpacity>
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
              <Image source={{ uri: selectedPhoto.url }} style={styles.detailImage} contentFit="cover" transition={150} />
              <View style={styles.detailBody}>
                <Text style={[styles.detailTitle, { color: colors.foreground }]}>
                  {selectedPhoto.emoji} {selectedPhoto.label}
                </Text>
                <Text style={[styles.detailMeta, { color: colors.mutedForeground }]}>
                  {selectedPhoto.squad} · {selectedPhoto.date}
                </Text>
                <TouchableOpacity
                  onPress={() => handleDownload(selectedPhoto)}
                  disabled={downloadingId !== null}
                  style={[styles.detailDownloadBtn, { backgroundColor: colors.primary, opacity: downloadingId !== null ? 0.6 : 1 }]}
                  activeOpacity={0.85}
                >
                  {downloadingId === selectedPhoto.id ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons name="download-outline" size={16} color="#fff" />
                  )}
                  <Text style={styles.detailDownloadText}>Download to device</Text>
                </TouchableOpacity>
              </View>
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

      {toast && (
        <View style={[styles.toast, { bottom: botPad + 32, backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.toastText, { color: colors.foreground }]}>{toast}</Text>
        </View>
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
  proBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  proBadgeText: { fontSize: 10, fontWeight: "900", fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 20 },
  lockCard: { borderRadius: 20, borderWidth: 1, padding: 28, alignItems: "center", marginBottom: 20 },
  lockIcon: { fontSize: 56, marginBottom: 14 },
  lockTitle: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center", marginBottom: 10 },
  lockBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, marginBottom: 20 },
  featurePills: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  pill: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  upgradeBtn: {
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  upgradeBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15, fontWeight: "800" },
  countLabel: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 12 },
  filterRow: { marginBottom: 16, flexGrow: 0 },
  filterBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 14,
    alignSelf: "flex-start",
  },
  filterBadgeText: { fontSize: 13, fontWeight: "700" },
  filterChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7, flexShrink: 0 },
  filterChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  gridCell: {
    width: "31.8%",
    aspectRatio: 1,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#1A1A26",
  },
  gridImage: { width: "100%", height: "100%" },
  lockOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#00000055" },
  tileDownload: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00000080",
  },
  checkBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden", marginBottom: 16 },
  detailImage: { width: "100%", height: 220 },
  detailBody: { padding: 16 },
  detailTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4 },
  detailMeta: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 14 },
  detailDownloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
  },
  detailDownloadText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold", fontSize: 14 },
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
  toast: {
    position: "absolute",
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 11,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  toastText: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
