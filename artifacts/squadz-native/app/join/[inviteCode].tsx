import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { savePendingEventCode, clearPendingEventCode } from "@/lib/pendingInvite";

type EventPreview = {
  emoji: string;
  title: string;
  hostName: string | null;
  date: string;
  location: string;
  goingCount: number;
};

/**
 * Event invite deep-link target.
 *
 * Shared event links (`joinsquadz.com/join/<inviteCode>`) open here via iOS
 * universal links / Android app links. The screen accepts the invite by code
 * and routes straight to the event on success. Logged-out friends are sent to
 * sign in / sign up carrying the code so they land back here afterwards.
 */
export default function EventJoinScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isLoggedIn, refreshEvents } = useData();
  const { isLoggedIn: authIsLoggedIn, authToken } = useAuth();
  const params = useLocalSearchParams<{ inviteCode?: string }>();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const code = params.inviteCode?.trim().toUpperCase() ?? null;
  const loggedIn = isLoggedIn || authIsLoggedIn;

  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EventPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  // Fetch a read-only preview so a SIGNED-IN visitor can see what they're
  // joining (title, host, date, location) before committing. Privacy: the
  // server requires auth for event details — logged-out visitors get a 401
  // and we show the generic SquadZ invite hero instead (they sign in first
  // and bounce back here, at which point the preview loads).
  const fetchPreview = useCallback(async () => {
    if (!code) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/events/preview?code=${encodeURIComponent(code)}`, {
        headers: buildAuthHeaders(authToken),
      });
      if (res.ok) {
        const data = (await res.json()) as EventPreview;
        setPreview(data);
      } else if (res.status === 410) {
        setError("This event has been cancelled.");
      }
    } catch {
      // Non-fatal: fall back to the generic invite hero if the preview fails.
    } finally {
      setPreviewLoading(false);
    }
  }, [code, authToken]);

  useEffect(() => {
    void fetchPreview();
  }, [fetchPreview]);

  // Logged-out friends sign in / up first, then bounce back to this screen.
  // Persist the code first so it survives a cold start mid-signup (router
  // params are lost if the app restarts during the auth flow).
  useEffect(() => {
    if (!loggedIn && code) {
      void savePendingEventCode(code);
      router.replace({ pathname: "/login", params: { joinEventCode: code } } as never);
    }
  }, [loggedIn, code]);

  const handleJoin = async () => {
    if (!code || joining) return;
    setJoining(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${API_BASE}/api/events/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders(authToken) },
        body: JSON.stringify({ inviteCode: code }),
      });
      if (res.status === 409) {
        // Already going — just open the event. Terminal success: clear the
        // persisted code so later logins don't bounce back to this screen.
        void clearPendingEventCode();
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        await refreshEvents();
        if (body.id) router.replace(`/event/${body.id}` as never);
        else router.replace("/(tabs)" as never);
        return;
      }
      if (res.status === 404) {
        void clearPendingEventCode();
        setError("Code not found. Double-check the link and try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      if (res.status === 410) {
        void clearPendingEventCode();
        setError("This event has been cancelled.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      const event = (await res.json()) as { id?: string };
      void clearPendingEventCode();
      await refreshEvents();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (event.id) router.replace(`/event/${event.id}` as never);
      else router.replace("/(tabs)" as never);
    } catch {
      setError("Could not connect. Please check your connection.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setJoining(false);
    }
  };

  const goHome = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)" as never);
  };

  if (!code) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <TouchableOpacity onPress={goHome} style={[styles.backBtn, { top: topPad + 8 }]}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.centerWrap}>
          <Ionicons name="link-outline" size={48} color={colors.textDim} />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>Invalid Link</Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
            This invite link is missing a code. Ask the host for a new one.
          </Text>
          <TouchableOpacity onPress={goHome} style={[styles.btn, { backgroundColor: colors.primary, marginTop: 24 }]}>
            <Text style={[styles.btnText, { color: "#fff" }]}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // While the logged-out redirect or the preview fetch is in flight, show a
  // spinner instead of the accept UI (avoids a flash of the join button before
  // bouncing to login or before the event details load).
  if (!loggedIn || previewLoading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <TouchableOpacity onPress={goHome} style={[styles.backBtn, { top: topPad + 8 }]}>
        <Ionicons name="chevron-back" size={24} color="#fff" />
      </TouchableOpacity>

      <View style={[styles.hero, { paddingTop: topPad + 20 }]}>
        <Text style={[styles.heroLabel, { color: "rgba(255,255,255,0.7)" }]}>YOU'RE INVITED</Text>
        <Text style={styles.heroEmoji}>{preview?.emoji ?? "🎉"}</Text>
        <Text style={[styles.heroTitle, { color: "#fff" }]}>{preview?.title ?? "Join the Event"}</Text>
        {preview?.hostName ? (
          <Text style={[styles.heroCopy, { color: "rgba(255,255,255,0.85)" }]}>
            Hosted by {preview.hostName}
          </Text>
        ) : (
          <Text style={[styles.heroCopy, { color: "rgba(255,255,255,0.8)" }]}>
            Tap below to RSVP using your invite link
          </Text>
        )}
      </View>

      <View style={[styles.body, { paddingBottom: botPad + 24 }]}>
        {preview ? (
          <View style={[styles.detailsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.detailRow}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text style={[styles.detailText, { color: colors.foreground }]}>{preview.date}</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={18} color={colors.primary} />
              <Text style={[styles.detailText, { color: colors.foreground }]}>{preview.location}</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="people-outline" size={18} color={colors.primary} />
              <Text style={[styles.detailText, { color: colors.foreground }]}>
                {preview.goingCount} going
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.codeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>Invite code</Text>
            <Text style={[styles.code, { color: colors.primary }]}>{code}</Text>
          </View>
        )}

        {error && (
          <View style={[styles.errorBanner, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "40" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          onPress={handleJoin}
          disabled={joining}
          style={[styles.btn, { backgroundColor: joining ? colors.mutedForeground : colors.primary, opacity: joining ? 0.7 : 1 }]}
        >
          {joining ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={[styles.btnText, { color: "#fff" }]}>Accept Invite →</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  backBtn: {
    position: "absolute",
    left: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    backgroundColor: "#FF6B2C",
    paddingHorizontal: 24,
    paddingBottom: 28,
    alignItems: "center",
  },
  heroLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1.5, marginBottom: 8 },
  heroEmoji: { fontSize: 52, marginBottom: 8 },
  heroTitle: { fontSize: 28, fontWeight: "800", textAlign: "center" },
  heroCopy: { fontSize: 14, marginTop: 6, textAlign: "center" },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  codeCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
  },
  codeLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  code: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 3,
  },
  detailsCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  detailText: { fontSize: 15, fontWeight: "600", flex: 1 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { fontSize: 13, fontWeight: "500", flex: 1 },
  btn: { borderRadius: 14, padding: 15, alignItems: "center", marginBottom: 12 },
  btnText: { fontSize: 16, fontWeight: "800" },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  errorTitle: { fontSize: 22, fontWeight: "800", marginTop: 16, textAlign: "center" },
  errorSub: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8 },
});
