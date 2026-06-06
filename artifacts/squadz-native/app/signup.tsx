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
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { GradientButton } from "@/components/GradientButton";

type Screen = "options" | "email" | "otp";

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

  if (screen === "otp") {
    return (
      <View style={[styles.screen, bg, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => setScreen("email")} style={styles.back}>
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
          <GradientButton onPress={() => setScreen("otp")} label="Create Account →" style={styles.btnSpacing} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, bg]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
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
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setScreen("email"); }}
            style={[styles.socialBtn, { backgroundColor: "#1877F2" }]}
          >
            <Ionicons name="logo-facebook" size={20} color="#fff" />
            <Text style={[styles.socialBtnText, { color: "#fff" }]}>Continue with Facebook</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setScreen("email"); }}
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
  center: { flex: 1, paddingHorizontal: 24, justifyContent: "center" },
  form: { paddingHorizontal: 24, paddingTop: 16 },
  logoSection: { paddingHorizontal: 24, paddingBottom: 28 },
  logoText: { fontSize: 40, fontWeight: "800", marginBottom: 6 },
  logoSub: { fontSize: 28, fontWeight: "800", lineHeight: 34, marginBottom: 6 },
  logoMeta: { fontSize: 14 },
  authSection: { paddingHorizontal: 24 },
  iconBox: {
    width: 72, height: 72, borderRadius: 22, borderWidth: 1,
    alignItems: "center", justifyContent: "center", marginBottom: 20, alignSelf: "center",
  },
  h1: { fontSize: 26, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  sub: { fontSize: 14, marginBottom: 32, textAlign: "center", lineHeight: 20 },
  socialBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, borderRadius: 14, padding: 15, marginBottom: 10,
  },
  socialBtnText: { fontSize: 15, fontWeight: "700" },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 6 },
  divLine: { flex: 1, height: 1 },
  divText: { fontSize: 12 },
  otpRow: { flexDirection: "row", gap: 8, marginBottom: 32 },
  otpBox: {
    width: 44, height: 54, borderRadius: 13, borderWidth: 2,
    fontSize: 22, fontWeight: "700", textAlign: "center",
  },
  btnSpacing: { marginTop: 12 },
  inputRow: {
    flexDirection: "row", alignItems: "center", borderRadius: 13,
    borderWidth: 1.5, paddingHorizontal: 14, marginBottom: 12, height: 52, gap: 10,
  },
  input: { flex: 1, fontSize: 15, height: 50 },
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
