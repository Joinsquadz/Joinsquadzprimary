import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { KeyboardDismissControl } from "@/components/KeyboardDismissControl";
import { useToast } from "@/context/ToastContext";
import { API_BASE, buildAuthHeaders, resolveUploadedUrl } from "@/lib/api";
import AttachmentVideo from "@/components/AttachmentVideo";

const SHARE_MAX = 1000;

export type VaultShareTarget = {
  id: number;
  url: string;
  mediaType?: "image" | "video";
};

type Props = {
  visible: boolean;
  target: VaultShareTarget | null;
  authToken: string | null;
  onClose: () => void;
  onShared?: () => void;
};

const resolveMedia = (url: string): string => {
  const r = resolveUploadedUrl(url);
  return /^https?:\/\//i.test(r) ? r : `${API_BASE}${r}`;
};

/**
 * Composer for sharing a vault photo/video out to the user's Vibe feed. The
 * media is pre-filled and the audience is LOCKED to Friends (vault shares are a
 * friends-only surface). The original vault item is never modified — posting
 * creates a new friends-audience feed post referencing the same media.
 */
export default function VaultShareComposer({ visible, target, authToken, onClose, onShared }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (visible) setText("");
  }, [visible, target?.id]);

  const submit = async () => {
    if (!target || posting) return;
    setPosting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${API_BASE}/api/vault/photos/${target.id}/share`, {
        method: "POST",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!res.ok) throw new Error("share failed");
      showToast("Shared to your friends' Vibe feed.", { durationMs: 3000 });
      onShared?.();
      onClose();
    } catch {
      showToast("Couldn't share. Please try again.", { durationMs: 2500 });
    } finally {
      setPosting(false);
    }
  };

  if (!target) return null;

  const isVideo = target.mediaType === "video";
  const mediaUri = resolveMedia(target.url);
  const headers = buildAuthHeaders(authToken);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.kav}
        >
          <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} hitSlop={10}>
                <Text style={[styles.cancel, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.title, { color: colors.foreground }]}>Share to Vibe</Text>
              <TouchableOpacity
                onPress={submit}
                disabled={posting}
                style={[styles.postBtn, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
              >
                {posting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.postBtnText}>Post</Text>}
              </TouchableOpacity>
            </View>

            <View style={styles.body}>
              <View style={styles.preview}>
                {isVideo ? (
                  <AttachmentVideo uri={mediaUri} headers={headers} style={styles.previewMedia} />
                ) : (
                  <Image
                    source={{ uri: mediaUri, headers }}
                    style={styles.previewMedia}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={150}
                  />
                )}
              </View>
              <TextInput
                value={text}
                onChangeText={(t) => setText(t.slice(0, SHARE_MAX))}
                placeholder="Add a caption for your friends..."
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground }]}
                multiline
                maxLength={SHARE_MAX}
                autoFocus
              />
            </View>

            {/* Audience — locked to Friends */}
            <View style={[styles.audienceRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Ionicons name="people" size={18} color={colors.primary} />
              <View style={styles.audienceText}>
                <Text style={[styles.audienceLabel, { color: colors.foreground }]}>Friends</Text>
                <Text style={[styles.audienceSub, { color: colors.mutedForeground }]}>
                  Vault shares go to your friends only
                </Text>
              </View>
              <Ionicons name="lock-closed" size={15} color={colors.mutedForeground} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
      <KeyboardDismissControl />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  kav: { width: "100%" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#888", alignSelf: "center", marginBottom: 12, opacity: 0.5 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  cancel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  title: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  postBtn: { paddingVertical: 7, paddingHorizontal: 18, borderRadius: 20, minWidth: 64, alignItems: "center" },
  postBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  body: { flexDirection: "row", gap: 12, marginBottom: 16 },
  preview: { width: 84, height: 84, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  previewMedia: { width: "100%", height: "100%" },
  input: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", lineHeight: 22, minHeight: 84, textAlignVertical: "top" },
  audienceRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  audienceText: { flex: 1 },
  audienceLabel: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  audienceSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
