import { useState, useEffect, useCallback, useRef } from "react";
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
import { UpgradeModal } from "@/components/UpgradeModal";
import { API_BASE } from "@/lib/api";
import { savePendingInviteCode, clearPendingInviteCode } from "@/lib/pendingInvite";
import type { Squad } from "@/types";

type SquadPreview = {
  name: string;
  emoji: string;
  memberCount: number;
  creatorFirstName: string | null;
};

/**
 * Private squad invite deep-link target (`/squad/join?code=XXX`).
 *
 * Growth-critical flow: the rich preview (squad name, emoji, member count,
 * who started it) loads WITHOUT auth so invitees see what they're joining
 * before being asked to sign up. After auth they bounce back here with
 * `auto=1` and the accept happens automatically — tapping the invite link is
 * the explicit intent. The join always goes through the server's
 * cap-consuming join-via-code path; at the free squad cap the upgrade prompt
 * shows with the squad context instead of silently failing.
 */
export default function SquadJoinScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { joinSquadByCode, isLoggedIn } = useData();
  const { isLoggedIn: authIsLoggedIn } = useAuth();
  const params = useLocalSearchParams<{ code?: string; auto?: string }>();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [joinedSquad, setJoinedSquad] = useState<Squad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [preview, setPreview] = useState<SquadPreview | null>(null);

  const code = params.code?.trim().toUpperCase() ?? null;
  const loggedIn = isLoggedIn || authIsLoggedIn;

  // B6: persist the pending invite code for logged-out visitors so the
  // deep-link survives onboarding even across a cold start (24h expiry).
  useEffect(() => {
    if (code && !loggedIn) void savePendingInviteCode(code);
  }, [code, loggedIn]);

  // Unauthenticated read-only preview so the invitee sees the squad before
  // signing up. Non-fatal on failure — we fall back to the generic hero.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/squads/preview?code=${encodeURIComponent(code)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as SquadPreview;
          if (!cancelled) setPreview(data);
        } else if (res.status === 404 && !cancelled) {
          setRevoked(true);
        }
      } catch {
        // Fall back to the generic invite hero.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const handleJoin = useCallback(async () => {
    if (!code || joining) return;
    setJoining(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await joinSquadByCode(code);
      // Any definitive server response consumes the stored pending code.
      void clearPendingInviteCode();
      if (result.revoked) {
        setRevoked(true);
      } else if (result.limit) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setShowUpgrade(true);
      } else if (result.error) {
        setError(result.error);
      } else if (result.squad) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Land directly inside the squad — the welcome moment lives there,
        // not on an interstitial screen. Already-members skip the welcome.
        router.replace({
          pathname: "/squad/[id]",
          params: result.alreadyMember
            ? { id: result.squad.id }
            : { id: result.squad.id, welcome: "1" },
        } as never);
      } else {
        setJoined(true);
        setJoinedSquad(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      setJoining(false);
    }
  }, [code, joining, joinSquadByCode]);

  // Auto-accept when returning from login/signup: the invite-link tap was the
  // explicit intent, so don't make the user tap "Accept" again. Runs once.
  const autoTried = useRef(false);
  useEffect(() => {
    if (params.auto === "1" && loggedIn && code && !autoTried.current) {
      autoTried.current = true;
      void handleJoin();
    }
  }, [params.auto, loggedIn, code, handleJoin]);

  const goHome = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)" as never);
    }
  };

  const goToSquad = () => {
    if (joinedSquad) {
      router.replace(`/squad/${joinedSquad.id}` as never);
    } else {
      router.replace("/(tabs)" as never);
    }
  };

  const authParams = {
    squadCode: code ?? "",
    ...(preview ? { squadName: preview.name, squadEmoji: preview.emoji } : {}),
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
            This invite link is missing a code. Ask for a new one.
          </Text>
          <TouchableOpacity onPress={goHome} style={[styles.btn, { backgroundColor: colors.primary, marginTop: 24 }]}>
            <Text style={[styles.btnText, { color: "#fff" }]}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (revoked) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <TouchableOpacity onPress={goHome} style={[styles.backBtn, { top: topPad + 8 }]}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.centerWrap}>
          <View style={[styles.revokedIcon, { backgroundColor: colors.destructive + "15" }]}>
            <Ionicons name="link-outline" size={40} color={colors.destructive} />
          </View>
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>Link Revoked</Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
            This invite link is no longer valid — the squad creator may have regenerated it. Ask them for a fresh link.
          </Text>
          <TouchableOpacity onPress={goHome} style={[styles.btn, { backgroundColor: colors.primary, marginTop: 28 }]}>
            <Text style={[styles.btnText, { color: "#fff" }]}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (joined) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.centerWrap}>
          <View style={[styles.successIcon, { backgroundColor: colors.green + "20" }]}>
            <Ionicons name="checkmark-circle" size={56} color={colors.green} />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>
            You joined the squad!
          </Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground, marginTop: 8 }]}>
            You're now a member. Check the squad for events, chats, and more.
          </Text>
          <TouchableOpacity
            onPress={goToSquad}
            style={[styles.btn, { backgroundColor: colors.primary, marginTop: 24 }]}
          >
            <Text style={[styles.btnText, { color: "#fff" }]}>Go to Squads →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const memberLine = preview
    ? `${preview.memberCount} ${preview.memberCount === 1 ? "member" : "members"}${
        preview.creatorFirstName ? ` · started by ${preview.creatorFirstName}` : ""
      }`
    : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <TouchableOpacity onPress={goHome} style={[styles.backBtn, { top: topPad + 8 }]}>
        <Ionicons name="chevron-back" size={24} color="#fff" />
      </TouchableOpacity>

      <View style={[styles.hero, { paddingTop: topPad + 20 }]}>
        <Text style={[styles.heroLabel, { color: "rgba(255,255,255,0.7)" }]}>YOU'RE INVITED</Text>
        <Text style={styles.heroEmoji}>{preview?.emoji ?? "👥"}</Text>
        <Text style={[styles.heroTitle, { color: "#fff" }]}>
          {preview ? preview.name : "Join a Squad"}
        </Text>
        <Text style={[styles.heroCopy, { color: "rgba(255,255,255,0.85)" }]}>
          {memberLine ?? "Tap below to join using your invite link"}
        </Text>
      </View>

      <View style={[styles.body, { paddingBottom: botPad + 24 }]}>
        {!preview && (
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

        {loggedIn ? (
          <TouchableOpacity
            onPress={handleJoin}
            disabled={joining}
            style={[styles.btn, { backgroundColor: joining ? colors.mutedForeground : colors.primary, opacity: joining ? 0.7 : 1 }]}
          >
            {joining ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={[styles.btnText, { color: "#fff" }]}>
                {preview ? `Join ${preview.emoji} ${preview.name} →` : "Accept Invite →"}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/signup", params: authParams } as never)}
              style={[styles.btn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.btnText, { color: "#fff" }]}>Create Account to Join →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/login", params: authParams } as never)}
              style={[styles.authBtn, { borderColor: colors.primary }]}
            >
              <Text style={[styles.authBtnText, { color: colors.primary }]}>
                I already have an account
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <UpgradeModal
        visible={showUpgrade}
        trigger="squad_limit"
        headline={preview ? `Upgrade to join ${preview.emoji} ${preview.name}` : undefined}
        onClose={() => setShowUpgrade(false)}
      />
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
  authBtn: { borderRadius: 12, borderWidth: 1.5, padding: 13, alignItems: "center", marginBottom: 16 },
  authBtnText: { fontSize: 14, fontWeight: "700" },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  successIcon: {
    width: 100,
    height: 100,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  revokedIcon: {
    width: 88,
    height: 88,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  successTitle: { fontSize: 26, fontWeight: "800", textAlign: "center" },
  errorTitle: { fontSize: 22, fontWeight: "800", marginTop: 16, textAlign: "center" },
  errorSub: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8 },
});
