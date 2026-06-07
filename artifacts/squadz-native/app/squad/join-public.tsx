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

type PublicSquadPreview = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  memberCount: number;
  isPublic: boolean;
};

export default function JoinPublicSquadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isLoggedIn, getSquad } = useData();
  const { isLoggedIn: authIsLoggedIn, authToken } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const squadId = params.id?.trim() ?? null;
  const loggedIn = isLoggedIn || authIsLoggedIn;

  const [preview, setPreview] = useState<PublicSquadPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const alreadyMember = !!(squadId && getSquad(squadId));

  const fetchPreview = useCallback(async () => {
    if (!squadId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/discover/squads/${squadId}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "This squad isn't available to join.");
      }
      const data = (await res.json()) as PublicSquadPreview;
      setPreview(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load this squad.");
    } finally {
      setLoading(false);
    }
  }, [squadId]);

  useEffect(() => {
    void fetchPreview();
  }, [fetchPreview]);

  const handleJoin = async () => {
    if (!squadId || joining) return;
    if (!loggedIn) {
      router.push({ pathname: "/login", params: { publicSquadId: squadId } } as never);
      return;
    }
    setJoining(true);
    setJoinError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${API_BASE}/api/squads/${squadId}/join`, {
        method: "POST",
        headers: buildAuthHeaders(authToken),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't join this squad.");
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJoined(true);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setJoinError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setJoining(false);
    }
  };

  const goHome = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)" as never);
  };

  const goToSquad = () => {
    if (squadId) router.replace(`/squad/${squadId}` as never);
    else router.replace("/(tabs)" as never);
  };

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <TouchableOpacity onPress={goHome} style={[styles.backBtn, { top: topPad + 8 }]}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!squadId || loadError || !preview) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <TouchableOpacity onPress={goHome} style={[styles.backBtn, { top: topPad + 8 }]}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.centerWrap}>
          <Ionicons name="link-outline" size={48} color={colors.textDim} />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>Squad Unavailable</Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
            {loadError ?? "This link is invalid or the squad is no longer public."}
          </Text>
          <TouchableOpacity onPress={goHome} style={[styles.btn, { backgroundColor: colors.primary, marginTop: 24 }]}>
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
            You're in {preview.emoji} {preview.name}!
          </Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground, marginTop: 8 }]}>
            You're now a member. Check the squad for events, chats, and more.
          </Text>
          <TouchableOpacity
            onPress={goToSquad}
            style={[styles.btn, { backgroundColor: colors.primary, marginTop: 24 }]}
          >
            <Text style={[styles.btnText, { color: "#fff" }]}>View Squad →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <TouchableOpacity onPress={goHome} style={[styles.backBtn, { top: topPad + 8 }]}>
        <Ionicons name="chevron-back" size={24} color="#fff" />
      </TouchableOpacity>

      <View style={[styles.hero, { backgroundColor: preview.color, paddingTop: topPad + 20 }]}>
        <Text style={[styles.heroLabel, { color: "rgba(255,255,255,0.75)" }]}>PUBLIC SQUAD</Text>
        <Text style={styles.heroEmoji}>{preview.emoji}</Text>
        <Text style={[styles.heroTitle, { color: "#fff" }]}>{preview.name}</Text>
        <Text style={[styles.heroCopy, { color: "rgba(255,255,255,0.85)" }]}>
          {preview.memberCount} member{preview.memberCount !== 1 ? "s" : ""}
        </Text>
      </View>

      <View style={[styles.body, { paddingBottom: botPad + 24 }]}>
        <Text style={[styles.invitedCopy, { color: colors.mutedForeground }]}>
          You've been invited to join this open squad. Jump in to plan events, chat, and share photos with the group.
        </Text>

        {joinError && (
          <View style={[styles.errorBanner, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "40" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{joinError}</Text>
          </View>
        )}

        {alreadyMember ? (
          <TouchableOpacity
            onPress={goToSquad}
            style={[styles.btn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.btnText, { color: "#fff" }]}>You're already in · View Squad →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleJoin}
            disabled={joining}
            style={[styles.btn, { backgroundColor: joining ? colors.mutedForeground : colors.primary, opacity: joining ? 0.7 : 1 }]}
          >
            {joining ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={[styles.btnText, { color: "#fff" }]}>
                {loggedIn ? "Join Squad →" : "Sign in to Join →"}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {!loggedIn && (
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/signup", params: { publicSquadId: squadId } } as never)}
            style={[styles.authBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.authBtnText, { color: colors.mutedForeground }]}>Create Account</Text>
          </TouchableOpacity>
        )}
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
    backgroundColor: "#FF5C3A",
    paddingHorizontal: 24,
    paddingBottom: 28,
    alignItems: "center",
  },
  heroLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1.5, marginBottom: 8 },
  heroEmoji: { fontSize: 52, marginBottom: 8 },
  heroTitle: { fontSize: 28, fontWeight: "800", textAlign: "center" },
  heroCopy: { fontSize: 14, marginTop: 6, textAlign: "center" },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },
  invitedCopy: { fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 20 },
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
  authBtn: { borderRadius: 12, borderWidth: 1.5, padding: 13, alignItems: "center" },
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
  successTitle: { fontSize: 26, fontWeight: "800", textAlign: "center" },
  errorTitle: { fontSize: 22, fontWeight: "800", marginTop: 16, textAlign: "center" },
  errorSub: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8 },
});
