import { useState, useEffect, useCallback, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  AppState,
} from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { startProCheckout } from "@/lib/checkout";

export type UpgradeTrigger =
  | "squad_limit"
  | "dm_gate"
  | "photos"
  | "events"
  | "moments"
  | "feed"
  | "general";

interface Props {
  visible: boolean;
  trigger: UpgradeTrigger;
  onClose: () => void;
  onUpgradeSuccess?: () => void;
}

// Canonical price shown on every upgrade CTA across the app.
const PRICE_LABEL = "$20/year";
const CTA_LABEL = `Upgrade to Squadz+ — ${PRICE_LABEL}`;
// Orange gradient used by all primary upgrade CTAs.
const CTA_GRADIENT = ["#FF5C3A", "#FF8050"] as const;
// Backoff delays (ms) for polling the subscription after returning from checkout.
const POLL_DELAYS = [0, 1000, 2000, 3000, 4000];

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
  events: {
    icon: "calendar",
    headline: "Plan without limits",
    sub: "Free accounts can only plan a few events. Squadz+ unlocks unlimited events so you can keep the momentum going.",
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

type Phase = "idle" | "checkout" | "confirming" | "failed";

export function UpgradeModal({ visible, trigger, onClose, onUpgradeSuccess }: Props) {
  const colors = useColors();
  const { authToken } = useAuth();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // True between launching checkout and the next app-foreground, so we know the
  // foreground event is a checkout return and should confirm the upgrade.
  const awaitingUpgrade = useRef(false);
  const copy = TRIGGER_COPY[trigger];

  const checkPro = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch(`${API_BASE}/api/subscription`, {
        headers: buildAuthHeaders(authToken),
        credentials: "include",
      });
      if (!r.ok) return false;
      const d = (await r.json()) as { isPro?: boolean };
      return !!d.isPro;
    } catch {
      return false;
    }
  }, [authToken]);

  // The Stripe webhook that flips the subscription to active can lag the browser
  // return by a moment, so poll a few times with backoff before giving up.
  const confirmLoop = useCallback(async () => {
    setPhase("confirming");
    setError(null);
    for (const delay of POLL_DELAYS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (await checkPro()) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhase("idle");
        onUpgradeSuccess?.();
        onClose();
        return;
      }
    }
    setPhase("failed");
    setError("Almost there — if you finished checkout, tap Refresh status.");
  }, [checkPro, onUpgradeSuccess, onClose]);

  // Reset transient state whenever the parent closes the modal.
  useEffect(() => {
    if (!visible) {
      setPhase("idle");
      setError(null);
      awaitingUpgrade.current = false;
    }
  }, [visible]);

  // On return from the external checkout browser, confirm the upgrade landed.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && awaitingUpgrade.current) {
        awaitingUpgrade.current = false;
        void confirmLoop();
      }
    });
    return () => sub.remove();
  }, [confirmLoop]);

  const handleUpgrade = useCallback(async () => {
    if (phase === "checkout" || phase === "confirming") return;
    setPhase("checkout");
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    awaitingUpgrade.current = true;
    const result = await startProCheckout(authToken);
    if (!result.ok) {
      awaitingUpgrade.current = false;
      setError(result.error);
    }
    // On success the browser is now open; the AppState listener confirms on
    // return. Drop back to idle so the CTA isn't stuck spinning underneath it.
    setPhase("idle");
  }, [authToken, phase]);

  const busy = phase === "checkout" || phase === "confirming";
  // While a checkout is starting or being confirmed, block dismissal so the
  // `!visible` reset can't clear `awaitingUpgrade` before the app returns.
  const handleDismiss = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleDismiss}
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

          <TouchableOpacity style={styles.closeBtn} onPress={handleDismiss} disabled={busy} hitSlop={12}>
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

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={styles.ctaWrap}
            onPress={phase === "failed" ? confirmLoop : handleUpgrade}
            disabled={busy}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={CTA_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.cta, busy && styles.ctaDisabled]}
            >
              {phase === "checkout" ? (
                <ActivityIndicator color="#fff" />
              ) : phase === "confirming" ? (
                <View style={styles.ctaRow}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.ctaLabel}>Confirming your upgrade…</Text>
                </View>
              ) : (
                <Text style={styles.ctaLabel}>
                  {phase === "failed" ? "Refresh status" : CTA_LABEL}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleDismiss} style={styles.notNow} disabled={busy}>
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
  ctaWrap: {
    width: "100%",
    marginBottom: 12,
    borderRadius: 16,
    shadowColor: "#FF5C3A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  cta: {
    width: "100%",
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  ctaDisabled: { opacity: 0.7 },
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
