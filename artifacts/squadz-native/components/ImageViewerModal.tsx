import {
  Modal,
  View,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ImageViewerOverlayProps {
  /** Full image URI. */
  uri: string;
  /** Auth headers for protected (signed-URL proxy) images. Omit for public URLs. */
  headers?: Record<string, string>;
  onClose: () => void;
}

/**
 * Non-Modal fullscreen image overlay. Use this when the viewer must render on
 * top of an already-open RN `Modal` (e.g. the vault detail sheet) — stacking a
 * second `Modal` over one freezes iOS touch handling. Render it conditionally
 * as an absolutely-positioned sibling so it covers the whole screen.
 */
export function ImageViewerOverlay({ uri, headers, onClose }: ImageViewerOverlayProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop, styles.overlay]}>
      {/* Tap anywhere behind the image to dismiss */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close image" />
      <Image
        source={headers ? { uri, headers } : { uri }}
        style={{ width, height: height * 0.86 }}
        contentFit="contain"
        transition={150}
        cachePolicy="memory-disk"
      />
      <TouchableOpacity
        onPress={onClose}
        style={[styles.closeBtn, { top: insets.top + 12 }]}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close image"
      >
        <Ionicons name="close" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

interface ImageViewerModalProps {
  visible: boolean;
  /** Full image URI. When null/empty the modal stays closed. */
  uri: string | null;
  /** Auth headers for protected (signed-URL proxy) images. Omit for public URLs. */
  headers?: Record<string, string>;
  onClose: () => void;
}

/**
 * Fullscreen, dark-backdrop image viewer used to expand photos tapped in chat
 * and on profiles. Tapping the backdrop or the close (X) button dismisses it.
 *
 * Do NOT use this on a screen that is itself an open RN `Modal` — use
 * `ImageViewerOverlay` there instead (stacked Modals deadlock iOS touch input).
 */
export function ImageViewerModal({ visible, uri, headers, onClose }: ImageViewerModalProps) {
  return (
    <Modal
      visible={visible && !!uri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {!!uri && <ImageViewerOverlay uri={uri} headers={headers} onClose={onClose} />}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    zIndex: 100,
    elevation: 100,
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
});
