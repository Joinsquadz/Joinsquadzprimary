import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AppContext";

/**
 * Global live-connection status banner driven by the shared squad SSE stream
 * (AppContext). Shows a slim "Reconnecting…" strip while the stream is
 * re-establishing and a tappable "Tap to retry" strip once it has given up
 * (error). Renders nothing while connected. Mirrors the per-screen banner used
 * on the conversation / squad detail screens, surfaced app-wide on Home + Feed.
 */
export function LiveStatusBanner() {
  const { squadStreamStatus, retrySquadStream } = useAuth();

  if (squadStreamStatus === "reconnecting") {
    return (
      <View style={styles.banner} pointerEvents="none">
        <ActivityIndicator size="small" color="#6B7280" style={{ marginRight: 6 }} />
        <Text style={styles.bannerText}>Reconnecting…</Text>
      </View>
    );
  }

  if (squadStreamStatus === "error") {
    return (
      <TouchableOpacity style={styles.banner} onPress={retrySquadStream} activeOpacity={0.7}>
        <Ionicons
          name="cloud-offline-outline"
          size={14}
          color="#6B7280"
          style={{ marginRight: 6 }}
        />
        <Text style={styles.bannerText}>Live updates unavailable · Tap to retry</Text>
      </TouchableOpacity>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    backgroundColor: "#6B728012",
  },
  bannerText: { fontSize: 12, fontWeight: "600", color: "#6B7280", letterSpacing: 0.2 },
});
