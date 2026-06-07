import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  StatusBar,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { SquadzIcon } from "@/components/SquadzIcon";
import { GradientButton } from "@/components/GradientButton";

type Screen = "splash" | "signin";

const AVATAR_FACES = [
  { letter: "M", color: "#FF5C3A" },
  { letter: "K", color: "#A855F7" },
  { letter: "T", color: "#2ECC8A" },
  { letter: "A", color: "#FFB547" },
  { letter: "R", color: "#4A9EFF" },
];

const PILLS = [
  { icon: "🗓️", label: "Events", color: "#FF5C3A" },
  { icon: "🍔", label: "Food Plans", color: "#FFB547" },
  { icon: "💸", label: "Split Costs", color: "#2ECC8A" },
  { icon: "🗳️", label: "Polls", color: "#4A9EFF" },
  { icon: "💬", label: "Group Chat", color: "#A855F7" },
];

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { loginWithEmail, forgotPassword } = useAuth();
  const params = useLocalSearchParams<{
    inviteCode?: string;
    inviteTitle?: string;
    inviteEmoji?: string;
    inviteHost?: string;
    inviteEventId?: string;
  }>();

  const hasInvite = !!params.inviteCode;
  const [screen, setScreen] = useState<Screen>(hasInvite ? "signin" : "splash");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const bg = { backgroundColor: colors.background };
  const cardBg = { backgroundColor: colors.card, borderColor: colors.border };

  const handleSignIn = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert("Missing details", "Enter your email and password to sign in.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    const result = await loginWithEmail(trimmedEmail, password);
    setLoading(false);
    if (!result.ok) {
      Alert.alert("Sign in failed", result.error ?? "Incorrect email or password.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (hasInvite && params.inviteEventId) {
      router.replace(`/event/${params.inviteEventId}` as never);
    } else {
      router.replace("/(tabs)" as never);
    }
  };

  const handleForgotPassword = async () => {
    const target = email.trim();
    if (!target) {
      Alert.alert("Enter your email", "Type your email above and we'll send you a reset link.");
      return;
    }
    setSendingReset(true);
    const result = await forgotPassword(target);
    setSendingReset(false);
    if (!result.ok) {
      Alert.alert("Couldn't send reset", result.error ?? "Please try again in a moment.");
      return;
    }
    Alert.alert(
      "Check your email",
      `If an account exists for ${target}, we've sent a link to reset your password.`,
    );
  };

  // ── Sign-in screen ───────────────────────────────────────────────────────
  if (screen === "signin") {
    return (
      <View style={[styles.screen, bg]}>
        <StatusBar barStyle="light-content" />
        <GlowBlobs />
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingTop: topPad, paddingBottom: botPad + 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            onPress={() => !hasInvite && setScreen("splash")}
            style={styles.back}
          >
            {!hasInvite && <Text style={[styles.backArrow, { color: colors.mutedForeground }]}>←</Text>}
          </TouchableOpacity>

          {hasInvite && (
            <View
              style={[
                styles.inviteBanner,
                {
                  backgroundColor: colors.primary + "18",
                  borderColor: colors.primary + "35",
                  marginHorizontal: 24,
                  marginBottom: 20,
                },
              ]}
            >
              <Text style={styles.inviteEmoji}>{params.inviteEmoji}</Text>
              <View style={styles.inviteText}>
                <Text style={[styles.inviteLabel, { color: colors.primary }]}>You've been invited to join</Text>
                <Text style={[styles.inviteTitle, { color: colors.foreground }]}>{params.inviteTitle}</Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Hosted by {params.inviteHost}</Text>
              </View>
              <Text style={{ fontSize: 18 }}>🎉</Text>
            </View>
          )}

          <View style={{ alignItems: "center", marginBottom: 28, paddingHorizontal: 24 }}>
            <SquadzIcon size={56} style={{ borderRadius: 16, marginBottom: 16 }} />
            <Text style={[styles.serifHeadingLg, { color: colors.foreground, textAlign: "center", marginBottom: 6 }]}>
              {hasInvite ? "Sign in to join →" : "Welcome back 👋"}
            </Text>
            <Text style={[styles.sub, { color: colors.mutedForeground, textAlign: "center" }]}>
              {hasInvite ? `Sign in to accept your invite to ${params.inviteTitle}` : "Sign in to your squad"}
            </Text>
          </View>

          <View style={{ paddingHorizontal: 24 }}>
            <View style={[styles.inputRow, cardBg]}>
              <Text style={styles.inputIcon}>✉️</Text>
              <TextInput
                placeholder="Email address"
                placeholderTextColor={colors.textDim}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                style={[styles.input, { color: colors.foreground }]}
              />
            </View>
            <View style={[styles.inputRow, cardBg]}>
              <Text style={styles.inputIcon}>🔒</Text>
              <TextInput
                placeholder="Password"
                placeholderTextColor={colors.textDim}
                secureTextEntry
                autoComplete="password"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={handleSignIn}
                style={[styles.input, { color: colors.foreground }]}
              />
            </View>

            <TouchableOpacity
              style={{ alignSelf: "flex-end", marginBottom: 20, paddingVertical: 4 }}
              onPress={handleForgotPassword}
              disabled={sendingReset}
            >
              <Text style={{ fontSize: 13, color: colors.primary }}>
                {sendingReset ? "Sending…" : "Forgot password?"}
              </Text>
            </TouchableOpacity>

            <GradientButton
              onPress={handleSignIn}
              disabled={loading}
              label={loading ? "Signing in…" : hasInvite ? `Join ${params.inviteTitle} →` : "Sign In →"}
            />
          </View>

          <View style={{ alignItems: "center", marginTop: 20, paddingHorizontal: 24 }}>
            <TouchableOpacity
              onPress={() =>
                router.push(
                  hasInvite
                    ? ({ pathname: "/signup", params } as never)
                    : ("/signup" as never),
                )
              }
            >
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                New here?{"  "}
                <Text style={{ color: colors.primary, fontWeight: "700" }}>Create account</Text>
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.terms, { color: colors.textDim }]}>
            By continuing you agree to our Terms & Privacy Policy
          </Text>
        </ScrollView>
      </View>
    );
  }

  // ── Splash screen (landing page) ──────────────────────────────────────────
  return (
    <View style={[styles.screen, bg]}>
      <StatusBar barStyle="light-content" />

      <View style={[styles.blob, { top: -80, right: -50, width: 280, height: 280, backgroundColor: "#FF5C3A", opacity: 0.13 }]} />
      <View style={[styles.blob, { top: 200, left: -80, width: 220, height: 220, backgroundColor: "#A855F7", opacity: 0.09 }]} />
      <View style={[styles.blob, { bottom: 160, right: -30, width: 180, height: 180, backgroundColor: "#FFB547", opacity: 0.08 }]} />

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingTop: topPad + 20, paddingBottom: botPad + 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoSection}>
          <View style={styles.iconWrapper}>
            <View style={[styles.iconGlow, { backgroundColor: "#FF5C3A" }]} />
            <SquadzIcon size={92} style={styles.appIcon} />
          </View>
          <Text style={styles.wordmark}>squadz</Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
            Stop texting. Start actually hanging.
          </Text>
        </View>

        <View style={[styles.socialProof, { backgroundColor: colors.surfaceUp, borderColor: colors.border }]}>
          <View style={styles.avatarStack}>
            {AVATAR_FACES.map((a, i) => (
              <View
                key={a.letter}
                style={[styles.avatarBubble, { backgroundColor: a.color, marginLeft: i > 0 ? -9 : 0, zIndex: 5 - i }]}
              >
                <Text style={styles.avatarLetter}>{a.letter}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.socialProofText, { color: colors.mutedForeground }]}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>50k+ squads</Text> planning smarter
          </Text>
        </View>

        <View style={styles.pillsWrap}>
          {PILLS.map((p) => (
            <View key={p.label} style={[styles.pill, { backgroundColor: p.color + "18", borderColor: p.color + "38" }]}>
              <Text style={[styles.pillText, { color: p.color }]}>{p.icon}{"  "}{p.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.ctaSection}>
          <GradientButton
            label="Get Started — It's Free ✨"
            onPress={() => router.push("/signup")}
          />
          <TouchableOpacity
            onPress={() => setScreen("signin")}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
              I already have an account
            </Text>
          </TouchableOpacity>
          <Text style={[styles.freeNote, { color: colors.textDim }]}>
            Free forever · No credit card needed
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function GlowBlobs() {
  return (
    <>
      <View style={[styles.blob, { top: -80, right: -50, width: 260, height: 260, backgroundColor: "#FF5C3A", opacity: 0.1 }]} />
      <View style={[styles.blob, { bottom: 100, left: -60, width: 200, height: 200, backgroundColor: "#4A9EFF", opacity: 0.08 }]} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { paddingHorizontal: 20, paddingVertical: 12, width: 60 },
  backArrow: { fontSize: 24 },
  blob: { position: "absolute", borderRadius: 999 },

  // Logo / splash
  logoSection: { alignItems: "center", marginBottom: 20, paddingHorizontal: 24 },
  iconWrapper: { position: "relative", alignItems: "center", justifyContent: "center", marginBottom: 18 },
  iconGlow: { position: "absolute", width: 120, height: 120, borderRadius: 60, opacity: 0.35 },
  appIcon: { width: 92, height: 92, borderRadius: 24 },
  wordmark: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 48,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: -2,
    lineHeight: 52,
    marginBottom: 8,
  },
  tagline: { fontSize: 15, textAlign: "center" },

  // Social proof
  socialProof: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 28,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: "center",
    marginBottom: 18,
  },
  avatarStack: { flexDirection: "row" },
  avatarBubble: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#1A1A26",
  },
  avatarLetter: { fontSize: 10, fontWeight: "800", color: "#000" },
  socialProofText: { fontSize: 13 },

  // Feature pills
  pillsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", paddingHorizontal: 20, marginBottom: 32 },
  pill: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 6 },
  pillText: { fontSize: 12, fontWeight: "600" },

  // CTAs
  ctaSection: { paddingHorizontal: 24, gap: 10 },
  secondaryBtn: { borderRadius: 15, borderWidth: 1.5, padding: 15, alignItems: "center" },
  secondaryBtnText: { fontSize: 15, fontWeight: "700" },
  freeNote: { textAlign: "center", fontSize: 11, marginTop: 2 },

  // Shared
  serifHeadingLg: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 30,
    fontWeight: "700",
  },
  sub: { fontSize: 14, lineHeight: 20 },
  inputRow: {
    flexDirection: "row", alignItems: "center", borderRadius: 13,
    borderWidth: 1.5, paddingHorizontal: 14, marginBottom: 12, height: 52, gap: 10,
  },
  inputIcon: { fontSize: 16 },
  input: { flex: 1, fontSize: 15, height: 50 },
  inviteBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  inviteEmoji: { fontSize: 22 },
  inviteText: { flex: 1, gap: 2 },
  inviteTitle: { fontSize: 15, fontWeight: "800" },
  inviteLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  terms: { textAlign: "center", fontSize: 12, marginTop: 16, lineHeight: 18, paddingHorizontal: 24 },
});
