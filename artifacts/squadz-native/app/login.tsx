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
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";

type Screen = "options" | "email" | "phone" | "otp";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
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

  const handleVerify = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    login();
    if (hasInvite && params.inviteEventId) {
      router.replace(`/event/${params.inviteEventId}` as never);
    } else {
      router.replace("/(tabs)" as never);
    }
  };

  const bg = { backgroundColor: colors.background };
  const cardBg = { backgroundColor: colors.card, borderColor: colors.border };

  if (screen === "otp") {
    return (
      <View style={[styles.screen, bg, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => setScreen("phone")} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.center}>
          <View style={[styles.iconBox, { backgroundColor: colors.purple + "20", borderColor: colors.purple + "40" }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.purple} />
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
                    backgroundColor: d ? colors.primary + "20" : colors.card,
                    borderColor: d ? colors.primary : colors.border,
                    color: colors.foreground,
                  },
                ]}
              />
            ))}
          </View>
          {hasInvite && (
            <View style={[styles.inviteBanner, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30" }]}>
              <Text style={styles.inviteEmoji}>{params.inviteEmoji}</Text>
              <View style={styles.inviteText}>
                <Text style={[styles.inviteLabel, { color: colors.primary }]}>After sign in, you'll join</Text>
                <Text style={[styles.inviteTitle, { color: colors.foreground }]}>{params.inviteTitle}</Text>
              </View>
            </View>
          )}
          <TouchableOpacity onPress={handleVerify} style={[styles.btn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.btnText, { color: "#fff" }]}>
              {hasInvite ? `Join ${params.inviteTitle} →` : "Verify & Sign In →"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resend}>
            <Text style={[{ color: colors.mutedForeground, fontSize: 14 }]}>
              Didn't get it?{"  "}
              <Text style={{ color: colors.primary }}>Resend code</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (screen === "phone") {
    return (
      <View style={[styles.screen, bg, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => setScreen("email")} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={[styles.h1, { color: colors.foreground }]}>Verify your phone</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            We'll text a 6-digit code to confirm it's you
          </Text>
          <View style={styles.phoneRow}>
            <View style={[styles.countryCode, cardBg]}>
              <Text style={[{ color: colors.foreground, fontSize: 15, fontWeight: "700" }]}>+1</Text>
            </View>
            <TextInput
              placeholder="(555) 000-0000"
              placeholderTextColor={colors.textDim}
              keyboardType="phone-pad"
              style={[styles.phoneInput, cardBg, { color: colors.foreground }]}
            />
          </View>
          <TouchableOpacity onPress={() => setScreen("otp")} style={[styles.btn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.btnText, { color: "#fff" }]}>Send Code →</Text>
          </TouchableOpacity>
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
          <Text style={[styles.h1, { color: colors.foreground }]}>Sign in with email</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Enter your credentials</Text>
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
              placeholder="Password"
              placeholderTextColor={colors.textDim}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>
          <TouchableOpacity onPress={() => setScreen("phone")} style={[styles.btn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.btnText, { color: "#fff" }]}>Continue →</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, bg]}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.logoSection, { paddingTop: topPad }]}>
          <Text style={[styles.logoText, { color: colors.primary }]}>SquadZ</Text>
          <Text style={[styles.logoSub, { color: colors.mutedForeground }]}>
            {hasInvite ? "You've been invited to join" : "Sign in to your squad"}
          </Text>
          {hasInvite && (
            <View style={[styles.inviteBanner, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30", marginTop: 16 }]}>
              <Text style={styles.inviteEmoji}>{params.inviteEmoji}</Text>
              <View style={styles.inviteText}>
                <Text style={[styles.inviteTitle, { color: colors.foreground }]}>{params.inviteTitle}</Text>
                <Text style={[styles.inviteLabel, { color: colors.mutedForeground }]}>Hosted by {params.inviteHost}</Text>
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
            <Text style={[styles.divText, { color: colors.textDim }]}>or sign in with</Text>
            <View style={[styles.divLine, { backgroundColor: colors.border }]} />
          </View>

          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setScreen("email"); }}
            style={[styles.socialBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
          >
            <Ionicons name="mail-outline" size={20} color={colors.foreground} />
            <Text style={[styles.socialBtnText, { color: colors.foreground }]}>Email & Phone Number</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/signup")} style={styles.signupRow}>
            <Text style={[{ fontSize: 14, color: colors.mutedForeground }]}>
              New here?{"  "}
              <Text style={{ color: colors.primary, fontWeight: "700" }}>Create account</Text>
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
  logoSection: { paddingHorizontal: 24, paddingBottom: 32 },
  logoText: { fontSize: 40, fontWeight: "800", marginBottom: 6 },
  logoSub: { fontSize: 15 },
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
  btn: { borderRadius: 14, padding: 15, alignItems: "center", marginTop: 12 },
  btnText: { fontSize: 16, fontWeight: "800" },
  resend: { marginTop: 20, alignItems: "center" },
  phoneRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  countryCode: {
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14,
    justifyContent: "center", height: 52,
  },
  phoneInput: { flex: 1, borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, fontSize: 15, height: 52 },
  inputRow: {
    flexDirection: "row", alignItems: "center", borderRadius: 13,
    borderWidth: 1.5, paddingHorizontal: 14, marginBottom: 12, height: 52, gap: 10,
  },
  input: { flex: 1, fontSize: 15, height: 50 },
  signupRow: { alignItems: "center", marginTop: 20 },
  terms: { textAlign: "center", fontSize: 12, marginTop: 16, lineHeight: 18 },
  inviteBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  inviteEmoji: { fontSize: 24 },
  inviteText: { flex: 1 },
  inviteTitle: { fontSize: 15, fontWeight: "800" },
  inviteLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
});
