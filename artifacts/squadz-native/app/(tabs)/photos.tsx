import { useState, useCallback, useEffect } from "react";
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
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useToast } from "@/context/ToastContext";
import { downloadPhoto } from "@/lib/downloadPhoto";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { useVaultPhotos } from "@/hooks/useVaultPhotos";
import { upgradeCtaLabel, useSquadzPlusPriceLabel } from "@/lib/squadzPlusPrice";

type LivePhoto = {
  id: number;
  eventId: string | null;
  uploadedAt: string;
  url?: string;
  uploaderId?: string;
  eventTitle: string | null;
  eventEmoji: string | null;
  squadName: string | null;
  locked: boolean;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function photoFilename(photo: LivePhoto): string {
  const slug = (photo.eventTitle ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `squadz-${slug || "photo"}-${photo.id}.jpg`;
}

export default function PhotosTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken, isPro, onEntitlementInvalidate } = useAuth();
  const {
    photos,
    loading: photosLoading,
    refetch: loadPhotos,
  } = useVaultPhotos<LivePhoto>({ authToken });

  // The roll-up is gated server-side, so its payload (and `requiresPro`) is
  // stale after an unlock or a lapse. Subscribing to the shared invalidation
  // boundary means an upgrade completed on ANY screen refreshes this grid.
  useEffect(
    () =>
      onEntitlementInvalidate((targets) => {
        if (targets.includes("vault-access")) void loadPhotos();
      }),
    [onEntitlementInvalidate, loadPhotos],
  );
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const upgradePriceLabel = useSquadzPlusPriceLabel();
  const [selected, setSelected] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState("All");
  const [downloadingId, setDownloadingId] = useState<number | "all" | null>(null);
  const { showToast } = useToast();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + 96;

  const authHeaders = useCallback(
    (): Record<string, string> => buildAuthHeaders(authToken),
    [authToken],
  );

  const imageUrl = useCallback((objectPath: string) => `${API_BASE}/api/storage${objectPath}`, []);

  // Only photos that have an accessible image (unlocked + url present) can be shown/downloaded.
  const viewablePhotos = photos.filter((p) => !p.locked && !!p.url);

  const squadNames = Array.from(
    new Set(viewablePhotos.map((p) => p.squadName).filter((s): s is string => !!s)),
  );
  const filters = ["All", ...squadNames];

  const filteredPhotos = viewablePhotos.filter(
    (p) => activeFilter === "All" || p.squadName === activeFilter,
  );

  const handleDownload = useCallback(
    async (photo: LivePhoto) => {
      if (downloadingId !== null || !photo.url) return;
      setDownloadingId(photo.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await downloadPhoto(imageUrl(photo.url), photoFilename(photo), authHeaders());
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
    [downloadingId, showToast, imageUrl, authHeaders],
  );

  const handleDownloadAll = useCallback(async () => {
    if (downloadingId !== null) return;
    setDownloadingId("all");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    let saved = 0;
    let denied = false;
    for (const photo of filteredPhotos) {
      if (!photo.url) continue;
      const result = await downloadPhoto(imageUrl(photo.url), photoFilename(photo), authHeaders());
      if (result === "saved") saved += 1;
      if (result === "denied") {
        denied = true;
        break;
      }
    }
    setDownloadingId(null);
    if (denied) {
      showToast("Photo library permission needed");
    } else if (saved > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(`Saved ${saved} photo${saved === 1 ? "" : "s"}`);
    } else {
      showToast("Couldn't download photos");
    }
  }, [downloadingId, filteredPhotos, showToast, imageUrl, authHeaders]);

  const selectedPhoto = filteredPhotos.find((p) => p.id === selected) ?? null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>📷 Vault</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Every memory from your squadz & events
          </Text>
        </View>
        {isPro && (
          <View style={[styles.proBadge, { backgroundColor: colors.gold + "22", borderColor: colors.gold + "60" }]}>
            <Text style={[styles.proBadgeText, { color: colors.gold }]}>PRO</Text>
          </View>
        )}
      </View>

      {isPro === null || photosLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : !isPro ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: botPad }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.lockCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.lockIcon}>🔒</Text>
            <Text style={[styles.lockTitle, { color: colors.foreground }]}>Your photo gallery is a Pro feature</Text>
            <Text style={[styles.lockBody, { color: colors.mutedForeground }]}>
              See every photo from all your squadz and events in one place — and download any of them
              to your device, anytime.
            </Text>
            <View style={styles.featurePills}>
              {["🖼️ All in one place", "⬇️ Download anytime", "🔐 Private to you"].map((f) => (
                <View key={f} style={[styles.pill, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.pillText, { color: colors.mutedForeground }]}>{f}</Text>
                </View>
              ))}
            </View>
          </View>

          {viewablePhotos.length > 0 && (
            <View style={styles.grid}>
              {viewablePhotos.map((p) => (
                <View key={p.id} style={styles.gridCell}>
                  <Image
                    source={{ uri: imageUrl(p.url as string), headers: authHeaders() }}
                    style={styles.gridImage}
                    contentFit="cover"
                    transition={150}
                    blurRadius={18}
                  />
                  <View style={styles.lockOverlay}>
                    <Ionicons name="lock-closed" size={18} color="#fff" />
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setUpgradeVisible(true);
            }}
            style={[styles.upgradeBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.85}
          >
            <Text style={styles.upgradeBtnText}>{upgradeCtaLabel(upgradePriceLabel)}</Text>
          </TouchableOpacity>

          <UpgradeModal
            visible={upgradeVisible}
            trigger="photos"
            onClose={() => setUpgradeVisible(false)}
            // Entitlement itself is updated globally by UpgradeModal; this callback
            // only does the screen-specific refetch.
            onUpgradeSuccess={() => { void loadPhotos(); }}
          />
        </ScrollView>
      ) : viewablePhotos.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 44, marginBottom: 12 }}>🖼️</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No photos yet</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Photos you add to your events will show up here automatically.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: botPad }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.countRow}>
            <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>
              {filteredPhotos.length} photo{filteredPhotos.length === 1 ? "" : "s"} · tap to view
            </Text>
            <TouchableOpacity
              onPress={handleDownloadAll}
              disabled={downloadingId !== null || filteredPhotos.length === 0}
              style={[styles.downloadAllBtn, { borderColor: colors.border, opacity: downloadingId !== null ? 0.5 : 1 }]}
              activeOpacity={0.7}
            >
              {downloadingId === "all" ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Ionicons name="download-outline" size={16} color={colors.primary} />
              )}
              <Text style={[styles.downloadAllText, { color: colors.primary }]}>Download all</Text>
            </TouchableOpacity>
          </View>

          {filters.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterRow}
              contentContainerStyle={{ gap: 8 }}
            >
              {filters.map((f) => (
                <TouchableOpacity
                  key={f}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setActiveFilter(f);
                    setSelected(null);
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
                <Image
                  source={{ uri: imageUrl(p.url as string), headers: authHeaders() }}
                  style={styles.gridImage}
                  contentFit="cover"
                  transition={150}
                />
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

          {selectedPhoto && selectedPhoto.url && (
            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Image
                source={{ uri: imageUrl(selectedPhoto.url), headers: authHeaders() }}
                style={styles.detailImage}
                contentFit="cover"
                transition={150}
              />
              <View style={styles.detailBody}>
                <Text style={[styles.detailTitle, { color: colors.foreground }]}>
                  {selectedPhoto.eventEmoji ? `${selectedPhoto.eventEmoji} ` : ""}
                  {selectedPhoto.eventTitle ?? "Untitled event"}
                </Text>
                <Text style={[styles.detailMeta, { color: colors.mutedForeground }]}>
                  {selectedPhoto.squadName ?? "Your squad"} · {formatDate(selectedPhoto.uploadedAt)}
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
  headerText: { flex: 1 },
  title: { fontSize: 26, fontWeight: "700", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  proBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  proBadgeText: { fontSize: 10, fontWeight: "900", fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  emptyTitle: { fontSize: 19, fontWeight: "800", fontFamily: "Inter_700Bold", marginBottom: 8, textAlign: "center" },
  emptyBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
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
  countRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  countLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  downloadAllBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  downloadAllText: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_600SemiBold" },
  filterRow: { marginBottom: 16, flexGrow: 0 },
  filterChip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7, flexShrink: 0 },
  filterChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
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
  detailCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden", marginTop: 18 },
  detailImage: { width: "100%", height: 220 },
  detailBody: { padding: 16 },
  detailTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 4 },
  detailMeta: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 14 },
  detailDownloadBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12 },
  detailDownloadText: { color: "#fff", fontWeight: "700", fontFamily: "Inter_700Bold", fontSize: 14 },
});
