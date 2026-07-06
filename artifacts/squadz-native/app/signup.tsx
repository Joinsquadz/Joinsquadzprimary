import { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  StatusBar,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { SquadzIcon } from "@/components/SquadzIcon";
import { GradientButton } from "@/components/GradientButton";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { fonts } from "@/constants/fonts";

export default function SignupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { registerWithEmail } = useAuth();
  const params = useLocalSearchParams<{
    inviteCode?: string;
    inviteTitle?: string;
    inviteEmoji?: string;
    inviteHost?: string;
    inviteEventId?: string;
    publicSquadId?: string;
    joinEventCode?: string;
    squadCode?: string;
    squadName?: string;
    squadEmoji?: string;
  }>();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const hasInvite = !!params.inviteCode;
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const bg = { backgroundColor: colors.background };
  const cardBg = { backgroundColor: colors.card, borderColor: colors.border };

  const handleCreateAccount = async () => {
    setErrorMsg(null);
    const trimmedEmail = email.trim();
    const trimmedFirst = firstName.trim();
    if (!trimmedFirst) {
      const msg = "Enter your first name to continue.";
      Alert.alert("What's your name?", msg);
      setErrorMsg(msg);
      return;
    }
    if (!trimmedEmail) {
      const msg = "Enter your email address to create an account.";
      Alert.alert("Email required", msg);
      setErrorMsg(msg);
      return;
    }
    if (password.length < 8) {
      const msg = "Use at least 8 characters for your password.";
      Alert.alert("Password too short", msg);
      setErrorMsg(msg);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    const result = await registerWithEmail({
      email: trimmedEmail,
      password,
      firstName: trimmedFirst,
      lastName: lastName.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    setLoading(false);
    if (!result.ok) {
      const msg = result.error ?? "Please try again.";
      Alert.alert("Couldn't create account", msg);
      setErrorMsg(msg);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Registration already established the session (without flipping the
    // logged-in flag); onboarding finishes setup and logs the user in.
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
    } else if (params.joinEventCode) {
      router.replace({
        pathname: "/onboarding",
        params: { joinEventCode: params.joinEventCode },
      } as never);
    } else if (params.squadCode) {
      router.replace({
        pathname: "/onboarding",
        params: {
          squadCode: params.squadCode,
          ...(params.squadName ? { squadName: params.squadName } : {}),
          ...(params.squadEmoji ? { squadEmoji: params.squadEmoji } : {}),
        },
      } as never);
    } else if (params.publicSquadId) {
      router.replace({
        pathname: "/onboarding",
        params: { publicSquadId: params.publicSquadId },
      } as never);
    } else {
      router.replace("/onboarding" as never);
    }
  };

  return (
    <View style={[styles.screen, bg]}>
      <StatusBar barStyle="light-content" />
      <GlowBlobs />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{ flexGrow: 1, paddingTop: topPad, paddingBottom: botPad + 16 }}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={[styles.backArrow, { color: colors.mutedForeground }]}>←</Text>
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

        {!hasInvite && !!params.squadCode && !!params.squadName && (
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
            <Text style={styles.inviteEmoji}>{params.squadEmoji ?? "👥"}</Text>
            <View style={styles.inviteText}>
              <Text style={[styles.inviteLabel, { color: colors.primary }]}>You've been invited to join</Text>
              <Text style={[styles.inviteTitle, { color: colors.foreground }]}>{params.squadName}</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>You'll join right after you sign up</Text>
            </View>
            <Text style={{ fontSize: 18 }}>🎉</Text>
          </View>
        )}

        <View style={{ alignItems: "center", marginBottom: 24, paddingHorizontal: 24 }}>
          <SquadzIcon size={56} style={{ borderRadius: 16, marginBottom: 16 }} />
          <Text style={[styles.serifHeadingLg, { color: colors.foreground, textAlign: "center", marginBottom: 6 }]}>
            Create your account
          </Text>
          {hasInvite && (
          <Text style={[styles.sub, { color: colors.mutedForeground, textAlign: "center" }]}>
            {`Join ${params.inviteTitle} and start planning`}
          </Text>
        )}
        </View>

        <View style={{ paddingHorizontal: 24 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={[styles.inputRow, cardBg, { flex: 1 }]}>
              <Text style={styles.inputIcon}>🙂</Text>
              <TextInput
                placeholder="First name"
                placeholderTextColor={colors.textDim}
                returnKeyType="next"
                onSubmitEditing={() => lastNameRef.current?.focus()}
                value={firstName}
                onChangeText={setFirstName}
                style={[styles.input, { color: colors.foreground }]}
              />
            </View>
            <View style={[styles.inputRow, cardBg, { flex: 1 }]}>
              <TextInput
                ref={lastNameRef}
                placeholder="Last name"
                placeholderTextColor={colors.textDim}
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                value={lastName}
                onChangeText={setLastName}
                style={[styles.input, { color: colors.foreground }]}
              />
            </View>
          </View>

          <View style={[styles.inputRow, cardBg]}>
            <Text style={styles.inputIcon}>✉️</Text>
            <TextInput
              ref={emailRef}
              placeholder="Email address"
              placeholderTextColor={colors.textDim}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
              value={email}
              onChangeText={setEmail}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>

          <View style={[styles.inputRow, cardBg]}>
            <Text style={styles.inputIcon}>📱</Text>
            <TextInput
              ref={phoneRef}
              placeholder="Phone number (optional)"
              placeholderTextColor={colors.textDim}
              keyboardType="phone-pad"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              value={phone}
              onChangeText={setPhone}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>

          <View style={[styles.inputRow, cardBg]}>
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput
              ref={passwordRef}
              placeholder="Password (8+ chars)"
              placeholderTextColor={colors.textDim}
              secureTextEntry
              autoComplete="password-new"
              returnKeyType="done"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleCreateAccount}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>

          <Text style={[styles.hint, { color: colors.textDim }]}>
            We'll email you a link to confirm your address — you can start using SquadZ right away.
          </Text>

          {errorMsg ? (
            <View style={{ backgroundColor: "#FF3B3018", borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#FF3B3040" }}>
              <Text style={{ color: "#FF3B30", fontSize: 13, textAlign: "center" }}>{errorMsg}</Text>
            </View>
          ) : null}
          <GradientButton
            onPress={handleCreateAccount}
            disabled={loading}
            label={loading ? "Creating account…" : "Create Account →"}
          />
        </View>

        <View style={{ alignItems: "center", marginTop: 20, paddingHorizontal: 24 }}>
          <TouchableOpacity
            onPress={() =>
              router.push(
                hasInvite
                  ? ({ pathname: "/login", params } as never)
                  : ("/login" as never),
              )
            }
          >
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
              Already have an account?{"  "}
              <Text style={{ color: colors.primary, fontWeight: "700" }}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.terms, { color: colors.textDim }]}>
          By continuing you agree to our Terms & Privacy Policy
        </Text>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function GlowBlobs() {
  return (
    <>
      <View style={[styles.blob, { top: -80, right: -50, width: 260, height: 260, backgroundColor: "#FF6B2C", opacity: 0.1 }]} />
      <View style={[styles.blob, { bottom: 100, left: -60, width: 200, height: 200, backgroundColor: "#A855F7", opacity: 0.08 }]} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { paddingHorizontal: 20, paddingVertical: 12, width: 60 },
  backArrow: { fontSize: 24 },
  blob: { position: "absolute", borderRadius: 999 },

  serifHeadingLg: {
    fontFamily: fonts.display,
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
  hint: { fontSize: 12, lineHeight: 18, marginBottom: 16 },

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
