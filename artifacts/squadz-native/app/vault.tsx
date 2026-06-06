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
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";

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

interface VaultPhoto {
  id: number;
  url: string;
  uploadedAt: string;
  eventId?: string | null;
}

export default function VaultScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [photos, setPhotos] = useState<VaultPhoto[]>([]);
  const [isUploading, setIsUploading] = useState(false);
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

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  // Restore scroll position and selected photo from AsyncStorage on mount
  useEffect(() => {
    if (isContextual) {
      initialized.current = true;
      return;
    }
    Promise.all([
      AsyncStorage.getItem(VAULT_SELECTED_KEY),
      AsyncStorage.getItem(VAULT_SCROLL_KEY),
    ]).then(([savedSelected, savedScroll]) => {
      if (savedSelected) {
        const id = parseInt(savedSelected, 10);
        if (!isNaN(id)) setSelected(id);
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

  // Persist selected photo ID
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

  const fetchPhotos = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/vault/photos`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { photos: VaultPhoto[] };
      setPhotos(data.photos ?? []);
    } catch {
      // silently fail
    }
  }, [authHeaders]);

  useEffect(() => {
    if (isPro) fetchPhotos();
  }, [isPro, fetchPhotos]);

  const handleUpload = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo library access to upload photos.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets.length) return;

      setIsUploading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      for (const asset of result.assets) {
        try {
          const urlRes = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
              name: asset.fileName ?? "photo.jpg",
              size: asset.fileSize ?? 0,
              contentType: asset.mimeType ?? "image/jpeg",
            }),
          });

          if (!urlRes.ok) continue;
          const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };

          const fileRes = await fetch(asset.uri);
          const blob = await fileRes.blob();

          const putRes = await fetch(uploadURL, {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
          });

          if (!putRes.ok) continue;

          await fetch(`${API_BASE}/api/vault/photos`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ url: objectPath }),
          });
        } catch {
          // skip failed individual uploads
        }
      }

      await fetchPhotos();
    } catch (err) {
      Alert.alert("Upload failed", "Could not upload photos. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }, [authHeaders, fetchPhotos]);

  const selectedPhoto = photos.find(p => p.id === selected) ?? null;
  const imageUrl = (objectPath: string) => `${API_BASE}/api/storage${objectPath}`;

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

          <View style={styles.blurGrid}>
            {[...Array(6)].map((_, i) => (
              <View key={i} style={[styles.gridCell, { backgroundColor: colors.card, opacity: 0.35 }]}>
                <Ionicons name="image-outline" size={28} color={colors.mutedForeground} />
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
            {photos.length} {photos.length === 1 ? "photo" : "photos"} · tap to view
          </Text>

          {photos.length > 0 ? (
            <View style={styles.grid}>
              {photos.map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelected(selected === p.id ? null : p.id); }}
                  style={[styles.gridCell, { borderWidth: 2, borderColor: selected === p.id ? colors.primary : "transparent" }]}
                  activeOpacity={0.8}
                >
                  <Image
                    source={{ uri: imageUrl(p.url) }}
                    style={styles.gridImage}
                    contentFit="cover"
                  />
                  {selected === p.id && (
                    <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
                      <Ionicons name="checkmark" size={10} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={[styles.emptyState, { borderColor: colors.border }]}>
              <Text style={styles.emptyIcon}>📷</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No photos yet</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Upload your first squad memory below</Text>
            </View>
          )}

          {selectedPhoto && (
            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.detailTitle, { color: colors.foreground }]}>
                {new Date(selectedPhoto.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </Text>
              <Text style={[styles.detailMeta, { color: colors.mutedForeground }]}>
                {selectedPhoto.eventId ? `Event ${selectedPhoto.eventId}` : "Vault photo"}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.uploadBtn, { borderColor: colors.border }]}
            activeOpacity={0.7}
            onPress={handleUpload}
            disabled={isUploading}
          >
            {isUploading ? (
              <ActivityIndicator color={colors.mutedForeground} />
            ) : (
              <Ionicons name="add" size={28} color={colors.mutedForeground} />
            )}
            <Text style={[styles.uploadLabel, { color: colors.mutedForeground }]}>
              {isUploading ? "Uploading…" : "Upload photos"}
            </Text>
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4, borderRadius: 14, overflow: "hidden", marginBottom: 16 },
  gridCell: {
    width: "31.8%",
    aspectRatio: 1,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#1A1A26",
  },
  gridImage: { width: "100%", height: "100%" },
  blurGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 },
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
  detailCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden", marginBottom: 16, padding: 16 },
  detailTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4 },
  detailMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  emptyState: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4 },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 24,
    marginTop: 8,
  },
  uploadLabel: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  uploadSub: { fontSize: 12, fontFamily: "Inter_400Regular", position: "absolute", bottom: 8 },
  toast: {
    position: "absolute",
    left: 20,
    right: 20,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  toastText: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
