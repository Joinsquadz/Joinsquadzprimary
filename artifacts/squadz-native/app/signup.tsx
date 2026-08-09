import { useState, useRef, createElement } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  StatusBar,
  Alert,
  Modal,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AppContext";
import { SquadzIcon } from "@/components/SquadzIcon";
import { GradientButton } from "@/components/GradientButton";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { fonts } from "@/constants/fonts";
import { MIN_SIGNUP_AGE, ageOn, isValidDobString, toDobString } from "@/lib/age";

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

  // T207: single name field — split into first/last only at the API boundary
  // so the account model (firstName/lastName) is untouched. Phone is deferred
  // entirely (it was already optional; users can add it later in settings).
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Age gate: DOB is collected once and sent to the server, which stores only
  // a 13+ marker plus the birth year. Empty string = not chosen yet.
  const [dob, setDob] = useState("");
  const [dobPickerOpen, setDobPickerOpen] = useState(false);
  const [dobDraft, setDobDraft] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - MIN_SIGNUP_AGE);
    return d;
  });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const hasInvite = !!params.inviteCode;
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const bg = { backgroundColor: colors.background };
  const cardBg = { backgroundColor: colors.card, borderColor: colors.border };

  const handleCreateAccount = async () => {
    setErrorMsg(null);
    const trimmedEmail = email.trim();
    const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
    const trimmedFirst = nameParts[0] ?? "";
    const restName = nameParts.slice(1).join(" ");
    if (!trimmedFirst) {
      const msg = "Enter your name to continue.";
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
    if (!dob || !isValidDobString(dob)) {
      const msg = "Add your date of birth to continue.";
      Alert.alert("Date of birth required", msg);
      setErrorMsg(msg);
      return;
    }
    const age = ageOn(dob);
    if (age === null) {
      const msg = "That date of birth doesn't look right.";
      Alert.alert("Check your date of birth", msg);
      setErrorMsg(msg);
      return;
    }
    if (age < MIN_SIGNUP_AGE) {
      // Mirrors the server's 403 UNDER_MIN_AGE — the server is the real gate.
      const msg = `You need to be at least ${MIN_SIGNUP_AGE} to use SquadZ.`;
      Alert.alert("Sorry, you're too young", msg);
      setErrorMsg(msg);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    const result = await registerWithEmail({
      email: trimmedEmail,
      password,
      firstName: trimmedFirst,
      lastName: restName || undefined,
      dateOfBirth: dob,
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
        <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/login" as never); } }} style={styles.back}>
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
          <View style={[styles.inputRow, cardBg]}>
            <Text style={styles.inputIcon}>🙂</Text>
            <TextInput
              placeholder="Your name"
              placeholderTextColor={colors.textDim}
              autoComplete="name"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              value={fullName}
              onChangeText={setFullName}
              style={[styles.input, { color: colors.foreground }]}
            />
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
              onSubmitEditing={() => passwordRef.current?.focus()}
              value={email}
              onChangeText={setEmail}
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

          {/* Date of birth — SquadZ is 13+. Web gets the native date input;
              iOS/Android get the platform picker. */}
          {Platform.OS === "web" ? (
            <View style={[styles.inputRow, cardBg]}>
              <Text style={styles.inputIcon}>🎂</Text>
              {createElement("input", {
                type: "date",
                "aria-label": "Date of birth",
                value: dob,
                max: toDobString(new Date()),
                onChange: (e: { target: { value: string } }) => setDob(e.target.value),
                style: {
                  flex: 1,
                  height: 50,
                  fontSize: 15,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: dob ? colors.foreground : colors.textDim,
                },
              })}
            </View>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Date of birth"
              onPress={() => setDobPickerOpen(true)}
              style={[styles.inputRow, cardBg]}
            >
              <Text style={styles.inputIcon}>🎂</Text>
              <Text
                style={[
                  styles.input,
                  { color: dob ? colors.foreground : colors.textDim, paddingTop: 16 },
                ]}
              >
                {dob ? dob : "Date of birth"}
              </Text>
            </TouchableOpacity>
          )}

          <Text style={[styles.hint, { color: colors.textDim }]}>
            {`You must be ${MIN_SIGNUP_AGE} or older to use SquadZ. We'll email you a link to confirm your address — you can start using SquadZ right away.`}
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

      {/* iOS: spinner in a sheet with an explicit Done (no swipe-dismiss). */}
      {Platform.OS === "ios" && dobPickerOpen && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setDobPickerOpen(false)}>
          <View style={styles.pickerOverlay}>
            <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
              <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => setDobPickerOpen(false)} style={styles.pickerBtn}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>Cancel</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>
                  Date of birth
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setDob(toDobString(dobDraft));
                    setDobPickerOpen(false);
                  }}
                  style={styles.pickerBtn}
                >
                  <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "700" }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={dobDraft}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                onChange={(_, d) => { if (d) setDobDraft(d); }}
                themeVariant="dark"
                style={{ width: "100%", height: 200 }}
              />
            </View>
          </View>
        </Modal>
      )}

      {Platform.OS === "android" && dobPickerOpen && (
        <DateTimePicker
          value={dobDraft}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={(_, d) => {
            setDobPickerOpen(false);
            if (d) {
              setDobDraft(d);
              setDob(toDobString(d));
            }
          }}
        />
      )}
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

  pickerOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  pickerSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8 },
  pickerToolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1,
  },
  pickerBtn: { paddingHorizontal: 8, paddingVertical: 6 },
});
