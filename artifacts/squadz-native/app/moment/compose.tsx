import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import AttachmentVideo from "@/components/AttachmentVideo";
import { SnapConfirm, type SnapConfirmHandle } from "@/components/SnapConfirm";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { stripMediaExif } from "@/lib/imageUtils";

const MAX_VIDEO_MS = 60 * 1000;

type Picked = {
  uri: string;
  mediaType: "photo" | "video";
  fileName: string;
  mimeType: string;
  fileSize: number;
  durationMs: number | null;
};

export default function MomentComposeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authToken } = useAuth();

  const [picked, setPicked] = useState<Picked | null>(null);
  const [posting, setPosting] = useState(false);
  const snapRef = useRef<SnapConfirmHandle>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + 16;

  const pick = useCallback(async (kind: "photo" | "video") => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to share a moment.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === "video" ? ["videos"] : ["images"],
      allowsMultipleSelection: false,
      quality: 0.8,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets.length) return;
    const asset = result.assets[0];
    const isVideo = kind === "video" || asset.type === "video";
    const durationMs = asset.duration ?? null;
    if (isVideo && durationMs && durationMs > MAX_VIDEO_MS) {
      Alert.alert("Too long", "Moments can be up to 60 seconds.");
      return;
    }
    setPicked({
      uri: asset.uri,
      mediaType: isVideo ? "video" : "photo",
      fileName: asset.fileName ?? (isVideo ? "moment.mp4" : "moment.jpg"),
      mimeType: asset.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg"),
      fileSize: asset.fileSize ?? 0,
      durationMs: isVideo ? durationMs : null,
    });
  }, []);

  const handlePost = useCallback(async () => {
    if (!picked || posting || !authToken) return;
    setPosting(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // 1. Request a signed upload URL.
      const urlRes = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: picked.fileName,
          size: picked.fileSize,
          contentType: picked.mimeType,
        }),
      });
      if (!urlRes.ok) {
        Alert.alert("Couldn't upload", "Please try again.");
        return;
      }
      const { uploadURL, objectPath } = (await urlRes.json()) as {
        uploadURL: string;
        objectPath: string;
      };

      // 2. Strip EXIF metadata from photos, then PUT the media bytes.
      const { uri: uploadUri, mimeType: uploadMimeType } = await stripMediaExif(picked.uri, picked.mimeType);
      const fileRes = await fetch(uploadUri);
      const blob = await fileRes.blob();
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": uploadMimeType },
      });
      if (!putRes.ok) {
        Alert.alert("Couldn't upload", "Please try again.");
        return;
      }

      // 3. Create the moment.
      const res = await fetch(`${API_BASE}/api/moments`, {
        method: "POST",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: objectPath,
          mediaType: picked.mediaType,
          ...(picked.durationMs ? { durationMs: Math.round(picked.durationMs) } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        Alert.alert("Couldn't share", body.error ?? "Please try again.");
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      snapRef.current?.snap("Shared!");
      setTimeout(() => { if (router.canGoBack()) { router.back(); } else { router.replace("/(tabs)/feed" as never); } }, 850);
    } catch {
      Alert.alert("Couldn't share", "Please check your connection and try again.");
    } finally {
      setPosting(false);
    }
  }, [picked, posting, authToken]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <SnapConfirm ref={snapRef} />
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/(tabs)/feed" as never); } }} hitSlop={8} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>New Moment</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
      >
        {/* Media preview / picker */}
        {picked ? (
          <View style={[styles.preview, { borderColor: colors.border }]}>
            {picked.mediaType === "video" ? (
              <AttachmentVideo uri={picked.uri} style={StyleSheet.absoluteFillObject} />
            ) : (
              <Image source={{ uri: picked.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            )}
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => setPicked(null)}
              hitSlop={8}
            >
              <Ionicons name="close" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.pickRow}>
            <TouchableOpacity
              style={[styles.pickCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => void pick("photo")}
              activeOpacity={0.85}
            >
              <Ionicons name="image-outline" size={30} color={colors.primary} />
              <Text style={[styles.pickLabel, { color: colors.foreground }]}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pickCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => void pick("video")}
              activeOpacity={0.85}
            >
              <Ionicons name="videocam-outline" size={30} color={colors.primary} />
              <Text style={[styles.pickLabel, { color: colors.foreground }]}>Video</Text>
              <Text style={[styles.pickHint, { color: colors.mutedForeground }]}>up to 60s</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          onPress={() => void handlePost()}
          disabled={!picked || posting}
          style={[
            styles.postBtn,
            { backgroundColor: colors.primary, opacity: !picked || posting ? 0.5 : 1 },
          ]}
          activeOpacity={0.85}
        >
          {posting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.postBtnText}>Share with friends</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerBtn: { width: 40, alignItems: "flex-start" },
  title: { fontSize: 18, fontWeight: "800" },

  preview: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  clearBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },

  pickRow: { flexDirection: "row", gap: 12 },
  pickCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 32,
    alignItems: "center",
    gap: 8,
  },
  pickLabel: { fontSize: 15, fontWeight: "700" },
  pickHint: { fontSize: 12, fontWeight: "500" },

  postBtn: {
    marginTop: 28,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  postBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
