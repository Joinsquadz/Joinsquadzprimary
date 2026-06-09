import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type InviterProfile = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  friendCode: string;
};

export default function AddFriendViaLinkScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { isLoggedIn, authToken } = useAuth();
  const { friends, addFriend, friendCode: myCode } = useData();

  const [inviter, setInviter] = useState<InviterProfile | null>(null);
  const [loadingInviter, setLoadingInviter] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const normalizedCode = (code ?? "").toUpperCase().trim();

  useEffect(() => {
    if (!normalizedCode) {
      setNotFound(true);
      setLoadingInviter(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/add/friend/${encodeURIComponent(normalizedCode)}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = await res.json() as InviterProfile;
        if (!cancelled) setInviter(data);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoadingInviter(false);
      }
    })();

    return () => { cancelled = true; };
  }, [normalizedCode]);

  useEffect(() => {
    if (inviter && isLoggedIn && friends.includes(inviter.id)) {
      setAdded(true);
    }
  }, [inviter, isLoggedIn, friends]);

  async function handleAddFriend() {
    if (!inviter || adding) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/by-friend-code/${encodeURIComponent(normalizedCode)}`, {
        headers: buildAuthHeaders(authToken),
      });
      if (res.status === 404) {
        Alert.alert("Code Not Found", "This friend code is no longer valid.");
        return;
      }
      if (!res.ok) {
        Alert.alert("Something went wrong", "Couldn't add this friend. Please try again.");
        return;
      }
      const found = await res.json() as { id: string };
      addFriend(found.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdded(true);
    } catch {
      Alert.alert("Network Error", "Couldn't connect. Please check your connection.");
    } finally {
      setAdding(false);
    }
  }

  const inviterName = inviter
    ? [inviter.firstName, inviter.lastName].filter(Boolean).join(" ") || "Someone"
    : "Someone";

  const initials = inviter
    ? `${inviter.firstName?.[0] ?? ""}${inviter.lastName?.[0] ?? ""}`.toUpperCase() || "?"
    : "?";

  const isSelf = isLoggedIn && inviter?.friendCode === myCode;

  if (loadingInviter) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (notFound) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🔍</Text>
        <Text style={[styles.heading, { color: colors.foreground }]}>Link not found</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          This invite link has expired or is invalid.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace("/(tabs)" as never)}
          style={[styles.btn, { backgroundColor: colors.primary, marginTop: 28 }]}
        >
          <Text style={styles.btnText}>Go to SquadZ</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (added) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: colors.background }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.green + "20" }]}>
          <Ionicons name="checkmark-circle" size={56} color={colors.green} />
        </View>
        <Text style={[styles.heading, { color: colors.foreground, marginTop: 16 }]}>
          {isSelf ? "That's you!" : `You and ${inviterName} are friends!`}
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          {isSelf
            ? "You can't add yourself as a friend."
            : "You're now connected on SquadZ."}
        </Text>
        <TouchableOpacity
          onPress={() => router.replace("/friends" as never)}
          style={[styles.btn, { backgroundColor: colors.primary, marginTop: 28 }]}
        >
          <Text style={styles.btnText}>View Friends →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.replace("/(tabs)" as never)}
          style={{ marginTop: 14 }}
        >
          <Text style={[styles.link, { color: colors.mutedForeground }]}>Go to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.hero, { paddingTop: topPad + 24, paddingBottom: 40 }]}>
        {inviter?.profileImageUrl ? (
          <Image
            source={{ uri: inviter.profileImageUrl }}
            style={styles.heroAvatar}
          />
        ) : (
          <View style={[styles.heroAvatarFallback, { backgroundColor: colors.primary }]}>
            <Text style={styles.heroAvatarInitials}>{initials}</Text>
          </View>
        )}
        <Text style={[styles.heroLabel, { color: "rgba(255,255,255,0.75)" }]}>
          FRIEND INVITE
        </Text>
        <Text style={[styles.heroName, { color: "#fff" }]}>{inviterName}</Text>
        <Text style={[styles.heroCode, { color: "rgba(255,255,255,0.6)" }]}>
          {normalizedCode}
        </Text>
      </View>

      <View style={[styles.body, { paddingBottom: botPad + 24 }]}>
        {isSelf ? (
          <>
            <Text style={[styles.note, { color: colors.mutedForeground, textAlign: "center", marginBottom: 24 }]}>
              This is your own invite link. Share it with friends so they can add you!
            </Text>
            <TouchableOpacity
              onPress={() => router.replace("/friends" as never)}
              style={[styles.btn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.btnText}>Go to Friends</Text>
            </TouchableOpacity>
          </>
        ) : isLoggedIn ? (
          <>
            <Text style={[styles.note, { color: colors.mutedForeground, textAlign: "center", marginBottom: 24 }]}>
              Tap the button below to connect with {inviterName} on SquadZ.
            </Text>
            <TouchableOpacity
              onPress={() => { void handleAddFriend(); }}
              disabled={adding}
              style={[styles.btn, { backgroundColor: adding ? colors.mutedForeground : colors.primary, opacity: adding ? 0.7 : 1 }]}
            >
              {adding ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="person-add-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.btnText}>Add {inviterName?.split(" ")[0]} as a Friend</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.note, { color: colors.mutedForeground, textAlign: "center", marginBottom: 24 }]}>
              {inviterName} wants to connect with you on SquadZ. Sign up or log in to add them.
            </Text>
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/signup", params: { friendCode: normalizedCode } } as never)}
              style={[styles.btn, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.btnText}>Create Account</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/login", params: { friendCode: normalizedCode } } as never)}
              style={[styles.btnOutline, { borderColor: colors.primary, marginTop: 12 }]}
            >
              <Text style={[styles.btnText, { color: colors.primary }]}>Sign In</Text>
            </TouchableOpacity>
            <Text style={[styles.note, { color: colors.textDim, marginTop: 20, textAlign: "center" }]}>
              After signing in, use code{" "}
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>{normalizedCode}</Text>
              {" "}in the Friends screen to add them.
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  hero: {
    backgroundColor: "#FF5C3A",
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 6,
  },
  heroAvatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 12 },
  heroAvatarFallback: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  heroAvatarInitials: { color: "#fff", fontSize: 28, fontWeight: "800" },
  heroLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  heroName: { fontSize: 26, fontWeight: "800", textAlign: "center" },
  heroCode: { fontSize: 14, letterSpacing: 1.5, fontVariant: ["tabular-nums"] },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 32, alignItems: "stretch" },
  heading: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  sub: { fontSize: 14, textAlign: "center", lineHeight: 20, marginTop: 8 },
  note: { fontSize: 14, lineHeight: 20 },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderRadius: 14, paddingVertical: 15,
  },
  btnOutline: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderRadius: 14, paddingVertical: 15, borderWidth: 1.5,
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  link: { fontSize: 14, fontWeight: "600" },
  successIcon: {
    width: 100, height: 100, borderRadius: 32,
    alignItems: "center", justifyContent: "center",
  },
});
