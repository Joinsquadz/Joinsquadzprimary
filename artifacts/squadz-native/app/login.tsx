import { useState, useEffect, useRef } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useColors } from "@/hooks/useColors";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/AppContext";
import { SquadzIcon } from "@/components/SquadzIcon";
import { GradientButton } from "@/components/GradientButton";

WebBrowser.maybeCompleteAuthSession();

type Screen = "splash" | "options" | "social-phone" | "email" | "phone" | "otp";

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

// When the web app runs inside the Replit canvas preview (a cross-origin
// iframe), the Replit login page can't be framed, so sign-in happens in a
// top-level tab. That tab carries this marker in its returnTo URL and relays
// the minted session token back to the iframe (same origin) via postMessage so
// the embedded preview signs in too.
const AUTH_RELAY_PARAM = "squadz_auth_relay";
const AUTH_NONCE_PARAM = "squadz_auth_nonce";
const AUTH_MESSAGE_TYPE = "squadz-auth-token";

function generateCodeVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// True when the web app is running inside any iframe (the Replit preview/canvas
// embeds the Expo app in one). The OIDC redirect can't complete framed: frames
// commonly have partitioned/blocked web storage (so the PKCE verifier can't be
// persisted) and the Replit login page refuses to render inside a frame. A
// cross-origin frame may even make `window.top` access throw — that's handled
// as the embedded case too. When embedded we must run sign-in in a top tab.
function isEmbeddedWeb(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // Accessing window.top across origins can itself throw — that only happens
    // when we're embedded, so treat it as embedded.
    return true;
  }
}

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

  const hasInvite = !!params.inviteCode;
  const [screen, setScreen] = useState<Screen>(hasInvite ? "options" : "splash");
  const [prevScreen, setPrevScreen] = useState<Screen>("options");
  const [provider, setProvider] = useState<"facebook" | "google" | null>(null);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [oidcLoading, setOidcLoading] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const bg = { backgroundColor: colors.background };
  const cardBg = { backgroundColor: colors.card, borderColor: colors.border };

  // Random nonce minted when this iframe opens a relay login tab; the relay tab
  // echoes it back in its postMessage so a different same-origin window can't
  // force a session (fixation) by posting an arbitrary token.
  const relayNonceRef = useRef<string | null>(null);

  // Finish a successful web sign-in: persist the session token and route into
  // the app. Shared by the URL-fragment handler (standalone / relay tab) and the
  // postMessage handler (the embedded canvas iframe receiving a relayed token).
  const completeWebLogin = (token: string) => {
    setOidcLoading(true);
    login(token);
    if (hasInvite && params.inviteEventId) {
      router.replace(`/event/${params.inviteEventId}` as never);
    } else {
      router.replace("/(tabs)" as never);
    }
  };

  // On web the OIDC flow is delegated to the server bouncer (see
  // handleReplitLogin). The server runs the whole flow on the main domain and
  // redirects back here with the minted session token in the URL fragment
  // (`#token=…`) or `#error=…`. Read it on mount, then clean the URL.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    const frag = new URLSearchParams(hash.slice(1));
    const token = frag.get("token");
    const err = frag.get("error");
    if (!token && !err) return;

    const search = new URLSearchParams(window.location.search);
    const isRelayTab = search.get(AUTH_RELAY_PARAM) === "1";
    const relayNonce = search.get(AUTH_NONCE_PARAM);

    // Strip the fragment (and relay markers) immediately so a refresh can't
    // replay the token.
    try {
      search.delete(AUTH_RELAY_PARAM);
      search.delete(AUTH_NONCE_PARAM);
      const qs = search.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    } catch {
      /* non-fatal */
    }

    // This tab was opened from the embedded canvas preview to run the login that
    // can't be framed. Relay the token back to the opener (the iframe, same
    // origin) so the preview itself signs in. We still sign in locally below so
    // this tab is usable too if the handoff doesn't land.
    if (token && isRelayTab && window.opener) {
      try {
        window.opener.postMessage(
          { type: AUTH_MESSAGE_TYPE, token, nonce: relayNonce },
          window.location.origin,
        );
      } catch {
        /* non-fatal — fall through to local sign-in */
      }
    }

    if (err || !token) {
      Alert.alert(
        "Sign In Failed",
        "Could not complete sign in. Please try again.",
      );
      return;
    }

    completeWebLogin(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Embedded-iframe (canvas preview) side of the relay: listen for the session
  // token postMessaged by the top-level login tab and sign in here. Both windows
  // share the Expo origin, so a direct window-handle message crosses even though
  // their storage is partitioned by the cross-origin embed.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { type?: string; token?: string; nonce?: string }
        | null;
      if (!data || data.type !== AUTH_MESSAGE_TYPE || !data.token) return;
      // Only accept a token for the sign-in attempt this iframe initiated.
      if (!relayNonceRef.current || data.nonce !== relayNonceRef.current) return;
      relayNonceRef.current = null;
      completeWebLogin(data.token);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the user opened the login tab but came back without finishing, clear the
  // "Signing in…" state so the button is usable again. (A successful sign-in
  // navigates away before this matters.)
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onFocus = () => setOidcLoading(false);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const handleReplitLogin = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Web: delegate the whole OIDC flow to the server bouncer. The Expo web app
    // runs on a subdomain that the Replit provider won't accept as a
    // redirect_uri, so the server runs the flow on the main domain and returns
    // the session token in the URL fragment. We only need to reach the Replit
    // login page at the top level — it refuses to render inside a frame, so when
    // embedded in the Replit preview we open it in a new tab.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const base = window.location.href.split("#")[0];
      if (isEmbeddedWeb()) {
        // The Replit login page can't be framed, so run sign-in in a top-level
        // tab. Mark its returnTo so that tab relays the session token back to
        // this iframe (same origin) via postMessage — see the message listener
        // above. We deliberately omit `noopener` so the relay tab keeps a handle
        // to this window.
        const nonce = generateCodeVerifier();
        relayNonceRef.current = nonce;
        const relayUrl = new URL(base);
        relayUrl.searchParams.set(AUTH_RELAY_PARAM, "1");
        relayUrl.searchParams.set(AUTH_NONCE_PARAM, nonce);
        const loginUrl = `${API_BASE}/api/mobile-auth/web-login?returnTo=${encodeURIComponent(relayUrl.toString())}`;
        const opened = window.open(loginUrl, "_blank");
        if (!opened) {
          Alert.alert(
            "Allow pop-ups to sign in",
            "Sign-in opens a Replit login page that can't run inside this preview. Allow pop-ups for this page (or open the preview in its own browser tab), then tap sign in again.",
          );
          return;
        }
        setOidcLoading(true);
        Alert.alert(
          "Finishing sign-in",
          "We opened the Replit login in a new tab. Complete it there and you'll be signed in here automatically.",
        );
        return;
      }
      setOidcLoading(true);
      const loginUrl = `${API_BASE}/api/mobile-auth/web-login?returnTo=${encodeURIComponent(base)}`;
      window.location.assign(loginUrl);
      return;
    }

    // Native (iOS/Android): run the OIDC flow through the server bouncer so the
    // provider only ever sees a redirect_uri on the main domain (the only host
    // it accepts). A direct exp:// / squadz-native:// redirect_uri is rejected
    // by the Replit provider. The bouncer mints the session and redirects back
    // to this app's deep link with `#token=…`, which the auth session captures.
    setOidcLoading(true);
    try {
      const returnUrl = Linking.createURL("/login");
      const loginUrl = `${API_BASE}/api/mobile-auth/web-login?returnTo=${encodeURIComponent(returnUrl)}`;
      const result = await WebBrowser.openAuthSessionAsync(loginUrl, returnUrl);
      if (result.type !== "success") {
        setOidcLoading(false);
        return;
      }

      const hashIndex = result.url.indexOf("#");
      const frag = new URLSearchParams(
        hashIndex >= 0 ? result.url.slice(hashIndex + 1) : "",
      );
      const token = frag.get("token");
      const err = frag.get("error");
      if (err || !token) {
        Alert.alert(
          "Sign In Failed",
          "Could not complete sign in. Please try again.",
        );
        setOidcLoading(false);
        return;
      }

      login(token);
      if (hasInvite && params.inviteEventId) {
        router.replace(`/event/${params.inviteEventId}` as never);
      } else {
        router.replace("/(tabs)" as never);
      }
    } catch {
      Alert.alert("Sign In Failed", "Something went wrong. Please try again.");
      setOidcLoading(false);
    }
  };

  const handleVerify = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    login();
    if (hasInvite && params.inviteEventId) {
      router.replace(`/event/${params.inviteEventId}` as never);
    } else {
      router.replace("/(tabs)" as never);
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
        <GlowBlobs />
        <HeaderWrapper>
          <TouchableOpacity onPress={() => setScreen("options")} style={[styles.socialHeaderBack, { top: topPad + 12 }]}>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 20, fontWeight: "700" }}>←</Text>
          </TouchableOpacity>
          <View style={{ alignItems: "center", paddingBottom: 20 }}>
            <Text style={styles.providerLabel}>
              {isFB ? "Facebook" : "Google"} connected ✓
            </Text>
            <Text style={[styles.serifHeading, { color: "#fff", marginBottom: 0, textAlign: "center" }]}>
              Welcome back, Alex!
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
              <Text style={[{ color: colors.foreground, fontWeight: "700", fontSize: 15, marginBottom: 2 }]}>
                Alex Johnson
              </Text>
              <Text style={[{ color: colors.textDim, fontSize: 12 }]} numberOfLines={1}>
                {mockEmail}
              </Text>
            </View>
            <View style={[styles.verifiedBadge, { backgroundColor: colors.green + "18" }]}>
              <Text style={{ color: colors.green, fontSize: 11, fontWeight: "700" }}>✓ Verified</Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Verify it's you</Text>
          <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
            We'll send a one-time code to your registered phone number.
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

          <Text style={[{ fontSize: 12, color: colors.textDim, textAlign: "center", marginTop: 12, lineHeight: 18 }]}>
            Standard SMS rates may apply.
          </Text>
        </ScrollView>
      </View>
    );
  }

  // ── OTP screen ────────────────────────────────────────────────────────
  if (screen === "otp") {
    return (
      <View style={[styles.screen, bg, { paddingTop: topPad }]}>
        <GlowBlobs />
        <TouchableOpacity onPress={() => setScreen(prevScreen)} style={styles.back}>
          <Text style={[styles.backArrow, { color: colors.mutedForeground }]}>←</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <View style={[styles.iconBox, { backgroundColor: colors.purple + "25", borderColor: colors.purple + "40" }]}>
            <Text style={{ fontSize: 36 }}>💬</Text>
          </View>
          <Text style={[styles.serifHeading, { color: colors.foreground }]}>Check your texts</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Enter the 6-digit code we sent you</Text>
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
                    backgroundColor: d ? colors.primary + "25" : colors.surfaceUp,
                    borderColor: d ? colors.primary : colors.border,
                    color: colors.foreground,
                  },
                ]}
              />
            ))}
          </View>
          {hasInvite && (
            <View style={[styles.inviteBanner, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "35" }]}>
              <Text style={styles.inviteEmoji}>{params.inviteEmoji}</Text>
              <View style={styles.inviteText}>
                <Text style={[styles.inviteLabel, { color: colors.primary }]}>After sign in, you'll join</Text>
                <Text style={[styles.inviteTitle, { color: colors.foreground }]}>{params.inviteTitle}</Text>
              </View>
            </View>
          )}
          <GradientButton
            onPress={handleVerify}
            label={hasInvite ? `Join ${params.inviteTitle} →` : "Verify & Sign In →"}
          />
          <TouchableOpacity style={{ marginTop: 18, alignItems: "center" }}>
            <Text style={[{ fontSize: 13, color: colors.mutedForeground }]}>
              Didn't get it?{"  "}
              <Text style={{ color: colors.primary }}>Resend code</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Phone screen ──────────────────────────────────────────────────────
  if (screen === "phone") {
    return (
      <View style={[styles.screen, bg, { paddingTop: topPad }]}>
        <GlowBlobs />
        <TouchableOpacity onPress={() => setScreen("email")} style={styles.back}>
          <Text style={[styles.backArrow, { color: colors.mutedForeground }]}>←</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>📱</Text>
          <Text style={[styles.serifHeading, { color: colors.foreground }]}>Verify your phone</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            We'll send a 6-digit code to confirm it's really you
          </Text>
          <View style={styles.phoneRow}>
            <View style={[styles.countryCode, cardBg]}>
              <Text style={[{ color: colors.foreground, fontSize: 15, fontWeight: "700" }]}>+1</Text>
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
          <GradientButton onPress={() => goToOtp("phone")} label="Send Code →" />
        </View>
      </View>
    );
  }

  // ── Email screen ──────────────────────────────────────────────────────
  if (screen === "email") {
    return (
      <View style={[styles.screen, bg, { paddingTop: topPad }]}>
        <GlowBlobs />
        <TouchableOpacity onPress={() => setScreen("options")} style={styles.back}>
          <Text style={[styles.backArrow, { color: colors.mutedForeground }]}>←</Text>
        </TouchableOpacity>
        <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>✉️</Text>
          <Text style={[styles.serifHeading, { color: colors.foreground }]}>Sign in with email</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Enter your credentials, then verify your phone
          </Text>
          <View style={[styles.inputRow, cardBg]}>
            <Text style={styles.inputIcon}>✉️</Text>
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
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput
              placeholder="Password"
              placeholderTextColor={colors.textDim}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>
          <TouchableOpacity
            style={{ alignSelf: "flex-end", marginBottom: 20 }}
            onPress={() => {
              const target = email.trim();
              Alert.alert(
                "Reset Password",
                target
                  ? `We'll send a reset link to ${target} if an account exists.`
                  : "Enter your email above and we'll send you a reset link.",
                [{ text: "OK" }],
              );
            }}
          >
            <Text style={[{ fontSize: 13, color: colors.primary }]}>Forgot password?</Text>
          </TouchableOpacity>
          <GradientButton onPress={() => setScreen("phone")} label="Continue →" />
        </ScrollView>
      </View>
    );
  }

  // ── Options screen (auth buttons) ────────────────────────────────────
  if (screen === "options") {
    return (
      <View style={[styles.screen, bg]}>
        <StatusBar barStyle="light-content" />
        <GlowBlobs />
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: topPad, paddingBottom: botPad + 16 }} keyboardShouldPersistTaps="handled">
          <View style={styles.optionsHeader}>
            <TouchableOpacity onPress={() => !hasInvite && setScreen("splash")} style={styles.back}>
              {!hasInvite && <Text style={[styles.backArrow, { color: colors.mutedForeground }]}>←</Text>}
            </TouchableOpacity>

            {hasInvite && (
              <View style={[styles.inviteBanner, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "35", marginHorizontal: 24, marginBottom: 20 }]}>
                <Text style={styles.inviteEmoji}>{params.inviteEmoji}</Text>
                <View style={styles.inviteText}>
                  <Text style={[styles.inviteLabel, { color: colors.primary }]}>You've been invited to join</Text>
                  <Text style={[styles.inviteTitle, { color: colors.foreground }]}>{params.inviteTitle}</Text>
                  <Text style={[{ fontSize: 12, color: colors.mutedForeground }]}>Hosted by {params.inviteHost}</Text>
                </View>
                <Text style={{ fontSize: 18 }}>🎉</Text>
              </View>
            )}

            <Text style={[styles.serifHeadingLg, { color: colors.foreground, textAlign: "center", marginBottom: 6 }]}>
              {hasInvite ? "Sign in to join →" : "Welcome back 👋"}
            </Text>
            <Text style={[styles.sub, { color: colors.mutedForeground, textAlign: "center", marginBottom: 28, paddingHorizontal: 24 }]}>
              {hasInvite ? `Sign in to accept your invite to ${params.inviteTitle}` : "Sign in to your squad"}
            </Text>
          </View>

          <View style={{ paddingHorizontal: 24, gap: 10 }}>
            <TouchableOpacity
              onPress={handleReplitLogin}
              disabled={oidcLoading}
              style={[styles.socialBtn, { backgroundColor: "#FF5C3A", opacity: oidcLoading ? 0.7 : 1 }]}
            >
              {oidcLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={{ fontSize: 18 }}>⚡</Text>
              }
              <Text style={[styles.socialBtnText, { color: "#fff" }]}>
                {oidcLoading ? "Signing in…" : "Continue with Replit"}
              </Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={[styles.divLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.divText, { color: colors.textDim }]}>or demo with</Text>
              <View style={[styles.divLine, { backgroundColor: colors.border }]} />
            </View>

            <TouchableOpacity
              onPress={() => goSocial("facebook")}
              style={[styles.socialBtn, { backgroundColor: "#1877F2" }]}
            >
              <Ionicons name="logo-facebook" size={20} color="#fff" />
              <Text style={[styles.socialBtnText, { color: "#fff" }]}>Continue with Facebook</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => goSocial("google")}
              style={[styles.socialBtn, { backgroundColor: colors.surfaceUp, borderWidth: 1.5, borderColor: colors.border }]}
            >
              <Ionicons name="logo-google" size={20} color={colors.foreground} />
              <Text style={[styles.socialBtnText, { color: colors.foreground }]}>Continue with Google</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setScreen("email"); }}
              style={[styles.socialBtn, { backgroundColor: colors.surfaceUp, borderWidth: 1, borderColor: colors.border }]}
            >
              <Text style={{ fontSize: 18 }}>✉️</Text>
              <Text style={[styles.socialBtnText, { color: colors.foreground }]}>Email & Phone Number</Text>
            </TouchableOpacity>
          </View>

          <View style={{ alignItems: "center", marginTop: 20, paddingHorizontal: 24 }}>
            <TouchableOpacity onPress={() => router.push("/signup")}>
              <Text style={[{ fontSize: 13, color: colors.mutedForeground }]}>
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

  // ── Splash screen (landing page) ──────────────────────────────────────
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
            label={oidcLoading ? "Signing in…" : "Get Started — It's Free ✨"}
            onPress={handleReplitLogin}
          />
          <TouchableOpacity
            onPress={handleReplitLogin}
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

  // Options / auth
  optionsHeader: {},
  socialBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, borderRadius: 14, padding: 14,
  },
  socialBtnText: { fontSize: 15, fontWeight: "700" },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 2 },
  divLine: { flex: 1, height: 1 },
  divText: { fontSize: 12 },

  // Phone input
  phoneRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  countryCode: { borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, justifyContent: "center", height: 52 },
  phoneInput: { flex: 1, borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, fontSize: 15, height: 52 },

  // Shared
  serifHeading: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 6,
  },
  serifHeadingLg: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 30,
    fontWeight: "700",
  },
  sub: { fontSize: 14, lineHeight: 20 },
  center: { flex: 1, paddingHorizontal: 24, justifyContent: "center" },
  form: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  iconBox: {
    width: 72, height: 72, borderRadius: 22, borderWidth: 1,
    alignItems: "center", justifyContent: "center", marginBottom: 20, alignSelf: "center",
  },
  otpRow: { flexDirection: "row", gap: 8, marginBottom: 28 },
  otpBox: {
    width: 44, height: 54, borderRadius: 13, borderWidth: 2,
    fontSize: 22, fontWeight: "700", textAlign: "center",
  },
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
