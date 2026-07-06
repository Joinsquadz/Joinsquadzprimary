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
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { useUserCache } from "@/context/UserCacheContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { startProCheckout } from "@/lib/checkout";
import { ProAvatar } from "@/components/ProAvatar";

export type UpgradeTrigger =
  | "squad_limit"
  | "photos"
  | "events"
  | "general";

interface Props {
  visible: boolean;
  trigger: UpgradeTrigger;
  onClose: () => void;
  onUpgradeSuccess?: () => void;
  /** Optional context-specific headline (e.g. "Upgrade to join 🎿 Ski Crew"). */
  headline?: string;
}

// Display-only price labels. The real charge is enforced server-side from the
// Stripe price env vars — these strings just mirror those amounts in the UI.
const STANDARD_PRICE = "$29.99";
const FOUNDING_PRICE = "$19.99";
// Orange gradient used by all primary upgrade CTAs.
const CTA_GRADIENT = ["#FF6B2C", "#FF8050"] as const;
// Gold gradient for the founding badge + celebration ring.
const GOLD_GRADIENT = ["#FFE08A", "#F5C242", "#C8941A"] as const;
// Backoff delays (ms) for polling the subscription after returning from checkout.
const POLL_DELAYS = [0, 1000, 2000, 3000, 4000];
// Max time we'll wait on founding-status before falling back to standard price.
const FOUNDING_STATUS_TIMEOUT = 1000;

const TRIGGER_COPY: Record<UpgradeTrigger, { headline: string; sub: string }> = {
  squad_limit: {
    headline: "Unlock unlimited squads",
    sub: "Free accounts are capped at 2 squads. Squadz+ lets you create and join as many as you want.",
  },
  photos: {
    headline: "Keep your memories forever",
    sub: "Your personal vault and saved favorites are a Squadz+ feature. Keep all your uploads in one place and save photos from any squad forever.",
  },
  events: {
    headline: "Plan without limits",
    sub: "Free accounts can only plan a few events. Squadz+ unlocks unlimited events so you keep the momentum going.",
  },
  general: {
    headline: "Upgrade to Squadz+",
    sub: "Everything Squadz has to offer, unlocked — one membership, all your squads.",
  },
};

// What free accounts get (shown for comparison).
const FREE_FEATURES = [
  "Up to 2 squads",
  "Event RSVPs & basic planning",
  "Group chat, Vibe Feed & Moments",
];

// Benefits unlocked by Squadz+.
const PRO_BENEFITS: Array<{ icon: string; label: string; gold?: boolean }> = [
  { icon: "people", label: "Unlimited squads & events" },
  { icon: "images", label: "Personal vault + saved favorites" },
  { icon: "ribbon", label: "Gold Ring Indicator", gold: true },
];

type FoundingStatus = { spotsRemaining: number; isFoundingAvailable: boolean };
type Phase = "idle" | "checkout" | "confirming" | "failed" | "celebrate";

const welcomeSeenKey = (subId: string) => `hasSeenUpgradeWelcome_${subId}`;

export function UpgradeModal({ visible, trigger, onClose, onUpgradeSuccess, headline }: Props) {
  const colors = useColors();
  const { authToken, currentUser } = useAuth();
  const { refreshUsers } = useUserCache();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [founding, setFounding] = useState<FoundingStatus | null>(null);
  // True between launching checkout and the next app-foreground, so we know the
  // foreground event is a checkout return and should confirm the upgrade.
  const awaitingUpgrade = useRef(false);
  const copy = TRIGGER_COPY[trigger];

  const firstName = currentUser.name?.trim().split(/\s+/)[0] ?? "";
  const isFounding = !!founding?.isFoundingAvailable && founding.spotsRemaining > 0;
  const priceLabel = isFounding ? FOUNDING_PRICE : STANDARD_PRICE;

  // Pull live founding-status when the sheet opens. Bounded to 1s so we never
  // block the UI: if it's slow we just show standard pricing.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FOUNDING_STATUS_TIMEOUT);
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/subscription/founding-status`, {
          signal: controller.signal,
        });
        if (!r.ok) return;
        const d = (await r.json()) as Partial<FoundingStatus>;
        if (
          !cancelled &&
          typeof d.spotsRemaining === "number" &&
          typeof d.isFoundingAvailable === "boolean"
        ) {
          setFounding({ spotsRemaining: d.spotsRemaining, isFoundingAvailable: d.isFoundingAvailable });
        }
      } catch {
        // Timeout / network error → stay on standard pricing.
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [visible]);

  const fetchSubscription = useCallback(async (): Promise<{ isPro: boolean; subId: string | null }> => {
    try {
      const r = await fetch(`${API_BASE}/api/subscription`, {
        headers: buildAuthHeaders(authToken),
        credentials: "include",
      });
      if (!r.ok) return { isPro: false, subId: null };
      const d = (await r.json()) as {
        isPro?: boolean;
        subscription?: { id?: string; stripeSubscriptionId?: string } | null;
      };
      const subId = d.subscription?.stripeSubscriptionId ?? d.subscription?.id ?? null;
      return { isPro: !!d.isPro, subId };
    } catch {
      return { isPro: false, subId: null };
    }
  }, [authToken]);

  // The Stripe webhook that flips the subscription to active can lag the browser
  // return by a moment, so poll a few times with backoff before giving up.
  const confirmLoop = useCallback(async () => {
    setPhase("confirming");
    setError(null);
    for (const delay of POLL_DELAYS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const { isPro, subId } = await fetchSubscription();
      if (isPro) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Bust the shared user cache so the Pro gold ring resolves immediately
        // on every avatar across the app, not just after a manual refresh.
        if (currentUser.id) refreshUsers([currentUser.id]);
        onUpgradeSuccess?.();
        // Show the celebration once per subscription. If we can't resolve a sub
        // id, or it's already been seen, fall back to simply closing.
        if (subId) {
          try {
            const seen = await AsyncStorage.getItem(welcomeSeenKey(subId));
            if (!seen) {
              await AsyncStorage.setItem(welcomeSeenKey(subId), "1");
              setPhase("celebrate");
              return;
            }
          } catch {
            // Storage failure → skip celebration, just close.
          }
        }
        setPhase("idle");
        onClose();
        return;
      }
    }
    setPhase("failed");
    setError("Almost there — if you finished checkout, tap Refresh status.");
  }, [fetchSubscription, onUpgradeSuccess, onClose, refreshUsers, currentUser.id]);

  // Reset transient state whenever the parent closes the modal. Clearing
  // `founding` here means each fresh open re-fetches status and, if that fetch
  // is slow/unavailable, falls back to standard pricing instead of showing a
  // stale founding price from a previous session.
  useEffect(() => {
    if (!visible) {
      setPhase("idle");
      setError(null);
      setFounding(null);
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

  const handleCelebrateDone = useCallback(() => {
    setPhase("idle");
    onClose();
  }, [onClose]);

  // ---- Celebration screen (full-screen) -----------------------------------
  if (phase === "celebrate") {
    return (
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
        <View style={[styles.celebrateRoot, { backgroundColor: colors.background }]}>
          <View style={styles.celebrateInner}>
            <ProAvatar
              initials={currentUser.initials}
              color={currentUser.color}
              imageUrl={currentUser.profileImageUrl}
              size={120}
              fontSize={44}
              isPro
            />
            <Text style={styles.celebrateEmoji}>🎉</Text>
            <Text style={[styles.celebrateTitle, { color: colors.foreground }]}>
              {firstName ? `Welcome to Squadz+, ${firstName}!` : "Welcome to Squadz+!"}
            </Text>
            <Text style={[styles.celebrateSub, { color: colors.mutedForeground }]}>
              You've unlocked everything — unlimited squads, a permanent vault, and your gold ring indicator.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.ctaWrap, styles.celebrateCta, { paddingBottom: Math.max(insets.bottom, 24) }]}
            onPress={handleCelebrateDone}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={GOLD_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cta}
            >
              <Text style={[styles.ctaLabel, { color: "#3A2A00" }]}>Let's go</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // ---- Upgrade sheet -------------------------------------------------------
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

          <View style={[styles.iconCircle, { backgroundColor: "#FF6B2C20", borderColor: "#FF6B2C40" }]}>
            <Ionicons name="star" size={30} color="#FF6B2C" />
          </View>

          <Text style={[styles.headline, { color: colors.foreground }]}>{headline ?? copy.headline}</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>{copy.sub}</Text>

          <View style={styles.tierWrap}>
            {/* Free tier */}
            <View style={[styles.tierSection, { borderColor: colors.border }]}>
              <Text style={[styles.tierLabel, { color: colors.mutedForeground }]}>Included free</Text>
              {FREE_FEATURES.map((f) => (
                <View key={f} style={styles.bulletRow}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.mutedForeground} />
                  <Text style={[styles.bulletLabel, { color: colors.mutedForeground }]}>{f}</Text>
                </View>
              ))}
            </View>
            {/* Pro tier */}
            <View style={[styles.tierSection, { borderColor: "#FF6B2C40", backgroundColor: "#FF6B2C08" }]}>
              <Text style={[styles.tierLabel, { color: "#FF6B2C" }]}>Squadz+ unlocks</Text>
              {PRO_BENEFITS.map((b) => (
                <View key={b.label} style={styles.bulletRow}>
                  <Ionicons
                    name={b.icon as "star"}
                    size={16}
                    color={b.gold ? colors.gold : "#FF6B2C"}
                  />
                  <Text style={[styles.bulletLabel, { color: colors.foreground }]}>{b.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Pricing block — founding (discounted) vs standard. */}
          <View style={styles.priceBlock}>
            {isFounding ? (
              <>
                <View style={styles.priceRow}>
                  <Text style={[styles.priceStrike, { color: colors.mutedForeground }]}>
                    {STANDARD_PRICE}
                  </Text>
                  <Text style={[styles.priceNow, { color: colors.foreground }]}>{FOUNDING_PRICE}</Text>
                  <Text style={[styles.priceInterval, { color: colors.mutedForeground }]}>/year</Text>
                </View>
                <LinearGradient
                  colors={GOLD_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.foundingBadge}
                >
                  <Ionicons name="flame" size={13} color="#3A2A00" />
                  <Text style={styles.foundingBadgeText}>
                    Founding price — {founding!.spotsRemaining} of 500 spots left
                  </Text>
                </LinearGradient>
              </>
            ) : (
              <View style={styles.priceRow}>
                <Text style={[styles.priceNow, { color: colors.foreground }]}>{STANDARD_PRICE}</Text>
                <Text style={[styles.priceInterval, { color: colors.mutedForeground }]}>/year</Text>
              </View>
            )}
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
                  {phase === "failed" ? "Refresh status" : `Upgrade to Squadz+ — ${priceLabel}/year`}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <Text style={[styles.fineprint, { color: colors.mutedForeground }]}>
            Cancel anytime. Billed annually.
          </Text>

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
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  headline: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 14.5,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  tierWrap: {
    width: "100%",
    gap: 8,
    marginBottom: 16,
  },
  tierSection: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  tierLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bulletLabel: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  priceBlock: {
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  priceStrike: {
    fontSize: 16,
    fontWeight: "600",
    textDecorationLine: "line-through",
    marginBottom: 3,
  },
  priceNow: {
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  priceInterval: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 5,
  },
  foundingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  foundingBadgeText: {
    color: "#3A2A00",
    fontSize: 12.5,
    fontWeight: "800",
  },
  ctaWrap: {
    width: "100%",
    marginBottom: 10,
    borderRadius: 16,
    shadowColor: "#FF6B2C",
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
  fineprint: {
    fontSize: 12.5,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 6,
  },
  notNow: { paddingVertical: 8 },
  notNowLabel: { fontSize: 14, fontWeight: "500" },
  errorText: {
    color: "#FF6B6B",
    fontSize: 13,
    marginBottom: 8,
    textAlign: "center",
  },
  celebrateRoot: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "center",
  },
  celebrateInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  celebrateEmoji: {
    fontSize: 40,
    marginTop: 4,
  },
  celebrateTitle: {
    fontSize: 26,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.6,
  },
  celebrateSub: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  celebrateCta: {
    shadowColor: "#F5C242",
  },
});
