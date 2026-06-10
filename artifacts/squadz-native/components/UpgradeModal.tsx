import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

export type UpgradeTrigger =
  | "squad_limit"
  | "dm_gate"
  | "photos"
  | "moments"
  | "feed"
  | "general";

interface Props {
  visible: boolean;
  trigger: UpgradeTrigger;
  onClose: () => void;
  onUpgradeSuccess?: () => void;
}

const TRIGGER_COPY: Record<UpgradeTrigger, { headline: string; sub: string; icon: string }> = {
  squad_limit: {
    icon: "people",
    headline: "Unlock unlimited squads",
    sub: "Free accounts are limited to 2 squads. Squadz+ lets you create and join as many as you want.",
  },
  dm_gate: {
    icon: "chatbubble-ellipses",
    headline: "Read your messages",
    sub: "Direct messages are a Squadz+ feature. Upgrade to unlock your full inbox.",
  },
  photos: {
    icon: "images",
    headline: "Keep your memories forever",
    sub: "Free photo vault expires after 30 days. Squadz+ stores your squad photos permanently.",
  },
  moments: {
    icon: "aperture",
    headline: "Share Moments",
    sub: "Post 24-hour moments to your friends and squads with Squadz+.",
  },
  feed: {
    icon: "newspaper",
    headline: "Post to the Vibe Feed",
    sub: "Share what's going on with your squads. Upgrade to post and react.",
  },
  general: {
    icon: "star",
    headline: "Upgrade to Squadz+",
    sub: "Unlimited squads, permanent photo vault, Moments, full DMs, and more.",
  },
};

const PRO_BULLETS = [
  { icon: "people", label: "Unlimited squads & members" },
  { icon: "images", label: "Permanent photo vault" },
  { icon: "chatbubble-ellipses", label: "Full direct messages" },
  { icon: "aperture", label: "Moments (24h stories)" },
  { icon: "newspaper", label: "Vibe Feed posting & reactions" },
  { icon: "star", label: "Pro gold ring badge" },
];

export function UpgradeModal({ visible, trigger, onClose, onUpgradeSuccess }: Props) {
  const colors = useColors();
  const { authToken } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = TRIGGER_COPY[trigger];

  const handleUpgrade = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const headers = buildAuthHeaders(authToken);

      const productsRes = await fetch(`${API_BASE}/api/stripe/products-with-prices`, { headers });
      if (!productsRes.ok) throw new Error("Failed to load plans");
      const products = (await productsRes.json()) as Array<{
        prices: Array<{ id: string }>;
      }>;
      const priceId = products[0]?.prices[0]?.id;
      if (!priceId) throw new Error("No plan available");

      const checkoutRes = await fetch(`${API_BASE}/api/stripe/checkout`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      if (!checkoutRes.ok) {
        const body = (await checkoutRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to start checkout");
      }
      const { checkoutUrl } = (await checkoutRes.json()) as { checkoutUrl: string };
      onClose();
      const result = await WebBrowser.openBrowserAsync(checkoutUrl, {
        dismissButtonStyle: "cancel",
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
      });
      if (result.type === "cancel" || result.type === "dismiss") {
        onUpgradeSuccess?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 24),
            },
          ]}
        >
          <View style={styles.handle} />

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>

          <View
            style={[styles.iconCircle, { backgroundColor: "#FF5C3A20", borderColor: "#FF5C3A40" }]}
          >
            <Ionicons name={copy.icon as "star"} size={32} color="#FF5C3A" />
          </View>

          <Text style={[styles.headline, { color: colors.foreground }]}>{copy.headline}</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>{copy.sub}</Text>

          <View style={[styles.bullets, { borderColor: colors.border }]}>
            {PRO_BULLETS.map((b) => (
              <View key={b.label} style={styles.bulletRow}>
                <Ionicons name={b.icon as "star"} size={16} color="#FF5C3A" />
                <Text style={[styles.bulletLabel, { color: colors.foreground }]}>{b.label}</Text>
              </View>
            ))}
          </View>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.cta, loading && styles.ctaDisabled]}
            onPress={handleUpgrade}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaLabel}>
                {Platform.OS === "ios" ? "Upgrade to Squadz+" : "Upgrade — $4.99/mo"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.notNow}>
            <Text style={[styles.notNowLabel, { color: colors.mutedForeground }]}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginBottom: 16,
  },
  closeBtn: {
    position: "absolute",
    top: 20,
    right: 20,
    padding: 4,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  headline: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 14.5,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  bullets: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 20,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bulletLabel: {
    fontSize: 14.5,
    fontWeight: "600",
  },
  cta: {
    width: "100%",
    height: 54,
    borderRadius: 16,
    backgroundColor: "#FF5C3A",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    shadowColor: "#FF5C3A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  notNow: { paddingVertical: 8 },
  notNowLabel: { fontSize: 14, fontWeight: "500" },
  errorText: {
    color: "#FF6B6B",
    fontSize: 13,
    marginBottom: 8,
    textAlign: "center",
  },
});
