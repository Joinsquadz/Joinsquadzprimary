import { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { useVaultPhotos } from "@/hooks/useVaultPhotos";
import { SkeletonBox } from "@/components/SkeletonBox";
import type { Event } from "@/types";

type EventVaultPhoto = {
  id: number;
  url?: string;
  mediaType?: "image" | "video";
  locked?: boolean;
};

const PREVIEW_COUNT = 6;

/**
 * Shared photo-vault entry point for an event or trip. The actual vault lives
 * at /vault?eventId=... — this is the in-screen CTA + preview grid. It fetches
 * up to six real thumbnails for the event; the emoji placeholders only show as a
 * zero-state before anyone has added photos.
 */
export function EventVaultPanel({ event, authToken }: { event: Event; authToken: string | null }) {
  const colors = useColors();

  const { photos, loading } = useVaultPhotos<EventVaultPhoto>({
    authToken,
    eventId: event.id,
    enabled: !!authToken,
  });

  const previews = useMemo(
    () => photos.filter((p) => !p.locked && !!p.url).slice(0, PREVIEW_COUNT),
    [photos],
  );

  const authHeaders = useMemo(() => buildAuthHeaders(authToken), [authToken]);
  const thumbUrl = (objectPath: string) => `${API_BASE}/api/storage${objectPath}`;

  const open = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
    Haptics.impactAsync(style);
    router.push(`/vault?eventId=${event.id}&eventName=${encodeURIComponent(event.title)}` as never);
  };

  const hasPhotos = previews.length > 0;

  return (
    <View style={{ gap: 16 }}>
      <TouchableOpacity onPress={() => open()} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>📷 Trip Vault</Text>
            <Text style={[styles.cardBody, { color: colors.foreground }]}>
              {hasPhotos
                ? `${photos.filter((p) => !p.locked && !!p.url).length} photo${photos.filter((p) => !p.locked && !!p.url).length === 1 ? "" : "s"} from ${event.title}`
                : `View all photos from ${event.title}`}
            </Text>
            <Text style={[styles.cardTitle, { color: colors.mutedForeground, marginTop: 4 }]}>Stored in Photo Vault · private to squad members</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
        </View>
      </TouchableOpacity>

      {loading && !hasPhotos ? (
        <View style={styles.previewGrid}>
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} style={styles.previewCell}>
              <SkeletonBox height={0} borderRadius={12} style={{ height: "100%" }} />
            </View>
          ))}
        </View>
      ) : hasPhotos ? (
        <View style={styles.previewGrid}>
          {previews.map((p) => (
            <TouchableOpacity
              key={p.id}
              onPress={() => open()}
              style={[styles.previewCell, { backgroundColor: colors.card }]}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: thumbUrl(p.url as string), headers: authHeaders }}
                style={styles.previewImage}
                contentFit="cover"
                transition={150}
              />
              {p.mediaType === "video" && (
                <View style={styles.videoBadge}>
                  <Ionicons name="play" size={12} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.previewGrid}>
          {[
            { color: "#FF6B3A", emoji: "🏖️" },
            { color: "#7B6EF6", emoji: "🍹" },
            { color: "#F5A623", emoji: "🌅" },
          ].map((p, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => open()}
              style={[styles.previewCell, styles.placeholderCell, { backgroundColor: p.color + "30" }]}
              activeOpacity={0.8}
            >
              <Text style={styles.vaultGridEmoji}>{p.emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        onPress={() => open(Haptics.ImpactFeedbackStyle.Medium)}
        style={[styles.vaultCta, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}
        activeOpacity={0.8}
      >
        <Ionicons name="images-outline" size={18} color={colors.primary} />
        <Text style={[styles.vaultCtaText, { color: colors.primary }]}>
          {hasPhotos ? "Open Photo Vault for this trip" : "Add the first photos to this vault"}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  cardTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardBody: { fontSize: 15, lineHeight: 22 },
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  previewCell: {
    width: "31.8%",
    aspectRatio: 1,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },
  placeholderCell: { alignItems: "center", justifyContent: "center" },
  previewImage: { width: "100%", height: "100%" },
  videoBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  vaultGridEmoji: { fontSize: 28 },
  vaultCta: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  vaultCtaText: { flex: 1, fontSize: 14, fontWeight: "700" },
});
