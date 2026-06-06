import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { GradientButton } from "@/components/GradientButton";

type Screen = "options" | "social-phone" | "email" | "otp";

export default function SignupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    inviteCode?: string;
    inviteTitle?: string;
    inviteEmoji?: string;
    inviteHost?: string;
    inviteEventId?: string;
  }>();

  const [screen, setScreen] = useState<Screen>("options");
  const [prevScreen, setPrevScreen] = useState<Screen>("options");
  const [provider, setProvider] = useState<"facebook" | "google" | null>(null);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);

  const hasInvite = !!params.inviteCode;
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const bg = { backgroundColor: colors.background };
  const cardBg = { backgroundColor: colors.card, borderColor: colors.border };

  const handleVerify = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (hasInvite) {
      router.replace({
        pathname: "/onboarding",
        params: {
          inviteCode: params.inviteCode,
          inviteTitle: params.inviteTitle,
          inviteEmoji: params.inviteEmoji,
          inviteHost: params.inviteHost,
          inviteEventId: params.inviteEventId,
        },
      } as never);
    } else {
      router.replace("/onboarding" as never);
    }
  };

  const goSocial = (p: "facebook" | "google") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setProvider(p);
    setScreen("social-phone");
  };

  const goToOtp = (from: Screen) => {
    setPrevScreen(from);
    setScreen("otp");
  };

  // ── Social-phone screen ────────────────────────────────────────────────
  if (screen === "social-phone") {
    const isFB = provider === "facebook";
    const providerColor = isFB ? "#1877F2" : "#4285F4";
    const mockEmail = isFB ? "alex.johnson@facebook.com" : "alex.johnson@gmail.com";

    const HeaderWrapper = ({ children }: { children: React.ReactNode }) =>
      isFB ? (
        <View style={[styles.socialHeader, { paddingTop: topPad + 16, backgroundColor: "#1877F2" }]}>
          {children}
        </View>
      ) : (
        <LinearGradient
          colors={["#4285F4", "#34A853"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.socialHeader, { paddingTop: topPad + 16 }]}
        >
          {children}
        </LinearGradient>
      );

    return (
      <View style={[styles.screen, bg]}>
        <HeaderWrapper>
          <TouchableOpacity onPress={() => setScreen("options")} style={styles.socialHeaderBack}>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 20, fontWeight: "700" }}>←</Text>
          </TouchableOpacity>
          <View style={{ alignItems: "center", paddingBottom: 20 }}>
            <Text style={styles.providerLabel}>
              {isFB ? "Facebook" : "Google"} connected ✓
            </Text>
            <Text style={[styles.serifH, { color: "#fff", textAlign: "center" }]}>
              Almost there, Alex!
            </Text>
          </View>
        </HeaderWrapper>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Profile card */}
          <View style={[styles.profileCard, cardBg]}>
            <View style={{ position: "relative" }}>
              <View style={[styles.avatarCircle, { backgroundColor: providerColor }]}>
                <Text style={styles.avatarInitials}>AJ</Text>
              </View>
              <View style={[styles.providerBadge, { backgroundColor: providerColor }]}>
                <Ionicons
                  name={isFB ? "logo-facebook" : "logo-google"}
                  size={10}
                  color="#fff"
                />
              </View>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15, marginBottom: 2 }}>
                Alex Johnson
              </Text>
              <Text style={{ color: colors.textDim, fontSize: 12 }} numberOfLines={1}>
                {mockEmail}
              </Text>
            </View>
            <View style={[styles.verifiedBadge, { backgroundColor: colors.green + "18" }]}>
              <Text style={{ color: colors.green, fontSize: 11, fontWeight: "700" }}>✓ Verified</Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Add your phone number</Text>
          <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
            We'll send a one-time code to verify it's really you.
          </Text>

          <View style={styles.phoneRow}>
            <View style={[styles.countryCode, cardBg]}>
              <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>+1</Text>
            </View>
            <TextInput
              placeholder="(555) 000-0000"
              placeholderTextColor={colors.textDim}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              style={[styles.phoneInput, cardBg, { color: colors.foreground }]}
            />
          </View>

          <GradientButton
            onPress={() => goToOtp("social-phone")}
            label="Send Verification Code →"
          />

          <Text style={{ fontSize: 12, color: colors.textDim, textAlign: "center", marginTop: 12, lineHeight: 18 }}>
            Standard SMS rates may apply. Your number is never shared.
          </Text>
        </ScrollView>
      </View>
    );
  }

  // ── OTP screen ────────────────────────────────────────────────────────
  if (screen === "otp") {
    return (
      <View style={[styles.screen, bg, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => setScreen(prevScreen)} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.center}>
          <View style={[styles.iconBox, { backgroundColor: colors.green + "20", borderColor: colors.green + "40" }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.green} />
          </View>
          <Text style={[styles.h1, { color: colors.foreground }]}>Check your texts</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Enter the 6-digit code we sent you
          </Text>
          <View style={styles.otpRow}>
            {otp.map((d, i) => (
              <TextInput
                key={i}
                value={d}
                maxLength={1}
                keyboardType="number-pad"
                onChangeText={(v) => {
                  const n = [...otp];
                  n[i] = v.replace(/\D/, "");
                  setOtp(n);
                }}
                style={[
                  styles.otpBox,
                  {
                    backgroundColor: d ? colors.green + "20" : colors.card,
                    borderColor: d ? colors.green : colors.border,
                    color: colors.foreground,
                  },
                ]}
              />
            ))}
          </View>
          <GradientButton onPress={handleVerify} label="Verify & Continue →" style={styles.btnSpacing} />
        </View>
      </View>
    );
  }

  // ── Email screen ──────────────────────────────────────────────────────
  if (screen === "email") {
    return (
      <View style={[styles.screen, bg, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => setScreen("options")} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={[styles.h1, { color: colors.foreground }]}>Create your account</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Set up your email and password</Text>
          <View style={[styles.inputRow, cardBg]}>
            <Ionicons name="mail-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              placeholder="Email address"
              placeholderTextColor={colors.textDim}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>
          <View style={[styles.inputRow, cardBg]}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              placeholder="Password (8+ chars)"
              placeholderTextColor={colors.textDim}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>
          <GradientButton onPress={() => goToOtp("email")} label="Create Account →" style={styles.btnSpacing} />
        </ScrollView>
      </View>
    );
  }

  // ── Options screen (default) ──────────────────────────────────────────
  return (
    <View style={[styles.screen, bg]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
        <View style={[styles.logoSection, { paddingTop: topPad }]}>
          <Text style={[styles.logoText, { color: colors.primary }]}>SquadZ</Text>
          <Text style={[styles.logoSub, { color: colors.foreground }]}>
            {hasInvite ? "Create your account" : "Your squad awaits"}
          </Text>
          <Text style={[styles.logoMeta, { color: colors.mutedForeground }]}>
            {hasInvite
              ? `Join ${params.inviteTitle} and start planning`
              : "Join 50,000+ squads planning smarter"}
          </Text>
          {hasInvite && (
            <View style={[styles.inviteBanner, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30" }]}>
              <Text style={styles.inviteEmoji}>{params.inviteEmoji}</Text>
              <View style={styles.inviteText}>
                <Text style={[styles.inviteLabel, { color: colors.primary }]}>You've been invited to join</Text>
                <Text style={[styles.inviteTitle, { color: colors.foreground }]}>{params.inviteTitle}</Text>
                <Text style={[{ fontSize: 12, color: colors.mutedForeground }]}>Hosted by {params.inviteHost}</Text>
              </View>
            </View>
          )}
        </View>

        <View style={[styles.authSection, { paddingBottom: botPad + 16 }]}>
          <TouchableOpacity
            onPress={() => goSocial("facebook")}
            style={[styles.socialBtn, { backgroundColor: "#1877F2" }]}
          >
            <Ionicons name="logo-facebook" size={20} color="#fff" />
            <Text style={[styles.socialBtnText, { color: "#fff" }]}>Continue with Facebook</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => goSocial("google")}
            style={[styles.socialBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
          >
            <Ionicons name="logo-google" size={20} color={colors.foreground} />
            <Text style={[styles.socialBtnText, { color: colors.foreground }]}>Continue with Google</Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={[styles.divLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.divText, { color: colors.textDim }]}>or sign up with</Text>
            <View style={[styles.divLine, { backgroundColor: colors.border }]} />
          </View>

          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setScreen("email"); }}
            style={[styles.socialBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
          >
            <Ionicons name="mail-outline" size={20} color={colors.foreground} />
            <Text style={[styles.socialBtnText, { color: colors.foreground }]}>Email & Phone Number</Text>
          </TouchableOpacity>

          <View style={[styles.featureBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[
              { icon: "flash-outline" as const, text: "Plan events in minutes, not group threads" },
              { icon: "fast-food-outline" as const, text: "Coordinate food — who brings what" },
              { icon: "card-outline" as const, text: "Split costs automatically" },
              { icon: "checkmark-circle-outline" as const, text: "Settle debates with one-tap polls" },
            ].map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <Ionicons name={f.icon} size={18} color={colors.primary} />
                <Text style={[styles.featureText, { color: colors.mutedForeground }]}>{f.text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity onPress={() => router.push("/login")} style={styles.signupRow}>
            <Text style={[{ fontSize: 14, color: colors.mutedForeground }]}>
              Already have an account?{"  "}
              <Text style={{ color: colors.primary, fontWeight: "700" }}>Sign in</Text>
            </Text>
          </TouchableOpacity>

          <Text style={[styles.terms, { color: colors.textDim }]}>
            By continuing you agree to our Terms & Privacy Policy
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { padding: 16, width: 56 },

  // Social-phone header
  socialHeader: {
    paddingHorizontal: 20,
    paddingBottom: 0,
    position: "relative",
  },
  socialHeaderBack: {
    position: "absolute",
    top: 16,
    left: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  providerLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  serifH: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 0,
  },

  // Profile card
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { color: "#fff", fontSize: 20, fontWeight: "800" },
  providerBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#1A1A26",
    alignItems: "center",
    justifyContent: "center",
  },
  verifiedBadge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },

  // Section labels
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  sectionSub: { fontSize: 13, marginBottom: 16, lineHeight: 20 },

  // Phone input
  phoneRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  countryCode: { borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, justifyContent: "center", height: 52 },
  phoneInput: { flex: 1, borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, fontSize: 15, height: 52 },

  // Logo section
  logoSection: { paddingHorizontal: 24, paddingBottom: 28 },
  logoText: { fontSize: 40, fontWeight: "800", marginBottom: 6 },
  logoSub: { fontSize: 28, fontWeight: "800", lineHeight: 34, marginBottom: 6 },
  logoMeta: { fontSize: 14 },
  authSection: { paddingHorizontal: 24 },

  // OTP
  center: { flex: 1, paddingHorizontal: 24, justifyContent: "center" },
  form: { paddingHorizontal: 24, paddingTop: 16 },
  iconBox: {
    width: 72, height: 72, borderRadius: 22, borderWidth: 1,
    alignItems: "center", justifyContent: "center", marginBottom: 20, alignSelf: "center",
  },
  h1: { fontSize: 26, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  sub: { fontSize: 14, marginBottom: 32, textAlign: "center", lineHeight: 20 },
  otpRow: { flexDirection: "row", gap: 8, marginBottom: 32 },
  otpBox: {
    width: 44, height: 54, borderRadius: 13, borderWidth: 2,
    fontSize: 22, fontWeight: "700", textAlign: "center",
  },
  btnSpacing: { marginTop: 12 },

  // Email form
  inputRow: {
    flexDirection: "row", alignItems: "center", borderRadius: 13,
    borderWidth: 1.5, paddingHorizontal: 14, marginBottom: 12, height: 52, gap: 10,
  },
  input: { flex: 1, fontSize: 15, height: 50 },

  // Social buttons
  socialBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, borderRadius: 14, padding: 15, marginBottom: 10,
  },
  socialBtnText: { fontSize: 15, fontWeight: "700" },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 6 },
  divLine: { flex: 1, height: 1 },
  divText: { fontSize: 12 },

  // Feature box
  featureBox: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 10, gap: 10 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureText: { fontSize: 13, flex: 1 },

  signupRow: { alignItems: "center", marginTop: 20 },
  terms: { textAlign: "center", fontSize: 12, marginTop: 12, lineHeight: 18 },
  inviteBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 16,
  },
  inviteEmoji: { fontSize: 24 },
  inviteText: { flex: 1, gap: 2 },
  inviteTitle: { fontSize: 15, fontWeight: "800" },
  inviteLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
});
