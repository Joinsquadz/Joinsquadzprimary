import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  Share,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData, SquadLimitError } from "@/context/AppContext";
import { GradientButton } from "@/components/GradientButton";
import { useTips } from "@/context/TipsContext";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { IconPicker } from "@/components/IconPicker";
import { EMOJI_CHOICES } from "@/constants/emojis";

const SQUAD_COLORS = ["#FF5C3A", "#A855F7", "#2ECC8A", "#4A9EFF", "#FFB547", "#FF5C3A"];
const SQUAD_CHIPS = ["Friend Group", "Coworkers", "Family", "College", "Roommates", "Sports"];

const GLOW_COLORS = ["#2ECC8A", "#A855F7"];
const STEP_ICONS = ["🔥", "📲"];
const STEP_TITLES = ["Create your first squad", "Invite your crew"];
const STEP_DESCS = [
  "A squad is your group. Your crew joins next so SquadZ can find when everyone's actually free.",
  "SquadZ only works its magic once your people are in. Get 2+ friends in to unlock your first overlap.",
];
const TOTAL_STEPS = 2;

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { friendCode, currentUser, addSquad, squads } = useData();
  const { armTour } = useTips();
  const params = useLocalSearchParams<{ inviteEventId?: string; inviteTitle?: string; publicSquadId?: string; joinEventCode?: string; squadCode?: string; inviteCode?: string }>();

  // Users arriving from a shared invite link should NOT be asked to build their
  // own squad — fast-track them straight into the squad/event they were invited
  // to. Getting the *second* person in is the whole point.
  const isJoining = !!(params.squadCode || params.publicSquadId || params.joinEventCode || params.inviteEventId || params.inviteCode);

  const hasRealName = currentUser.id !== "me";
  // The name is collected during signup, so onboarding no longer asks for it.
  const firstName = hasRealName ? currentUser.name.split(" ")[0] : "";
  const [step, setStep] = useState(0);
  const [squadEmoji, setSquadEmoji] = useState("🔥");
  const [squadName, setSquadName] = useState("");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdSquadId, setCreatedSquadId] = useState<string | null>(null);

  // Resume an abandoned onboarding: if a squad already exists (created in a
  // previous session before the app was closed), skip the create step and drop
  // the user on the invite step pointed at that squad. Runs once, and never
  // fights an in-session create (createdSquadId/creating set) or the invited
  // fast-path (handled separately below).
  const resumeApplied = useRef(false);
  useEffect(() => {
    if (resumeApplied.current || isJoining) return;
    if (createdSquadId || creating) return;
    if (squads.length > 0) {
      resumeApplied.current = true;
      setCreatedSquadId(squads[0]!.id);
      setStep(1);
    }
  }, [squads, createdSquadId, creating, isJoining]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const glow = GLOW_COLORS[step] ?? GLOW_COLORS[0];

  const createdSquad = createdSquadId ? squads.find((s) => s.id === createdSquadId) ?? null : null;
  const inviteCode = createdSquad?.inviteCode ?? null;
  const inviteLink = createdSquad
    ? inviteCode
      ? `https://joinsquadz.com/squad/join?code=${inviteCode}`
      : `https://joinsquadz.com/squad/${createdSquad.id}`
    : `https://joinsquadz.com`;

  const shareMessage = createdSquad
    ? `Join my squad "${createdSquad.emoji} ${createdSquad.name}" on SquadZ — let's find a time we're all actually free 🎉\n${inviteLink}${inviteCode ? `\nInvite code: ${inviteCode}` : ""}`
    : `I'm on SquadZ — let's plan our next hangout and find a time everyone's free. Add me with my code ${friendCode}\nhttps://joinsquadz.com`;

  const handleComplete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    login();
    if (params.inviteEventId) {
      router.replace(`/event/${params.inviteEventId}` as never);
    } else if (params.joinEventCode) {
      router.replace({ pathname: "/join/[inviteCode]", params: { inviteCode: params.joinEventCode } } as never);
    } else if (params.squadCode) {
      armTour();
      router.replace({ pathname: "/squad/join", params: { code: params.squadCode } } as never);
    } else if (params.publicSquadId) {
      armTour();
      router.replace({ pathname: "/squad/join-public", params: { id: params.publicSquadId } } as never);
    } else if (createdSquadId) {
      armTour();
      router.replace({ pathname: "/squad/[id]", params: { id: createdSquadId } } as never);
    } else {
      router.replace("/(tabs)" as never);
    }
  };

  async function handleCreateSquad() {
    if (!squadName.trim() || creating) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCreating(true);
    try {
      const emojiIndex = EMOJI_CHOICES.indexOf(squadEmoji);
      const color = SQUAD_COLORS[Math.max(0, emojiIndex) % SQUAD_COLORS.length] ?? "#FF5C3A";
      const id = await addSquad({ name: squadName.trim(), emoji: squadEmoji, color, isPublic: false });
      setCreatedSquadId(id);
      setCreating(false);
      setStep(1);
    } catch (err) {
      setCreating(false);
      if (err instanceof SquadLimitError) {
        Alert.alert(
          "Squad limit reached",
          "You've hit the free-plan squad limit. Upgrade to Squadz+ for unlimited squads.",
          [{ text: "OK" }],
        );
      } else {
        Alert.alert("Something went wrong", "Couldn't create your squad. Please try again.", [{ text: "OK" }]);
      }
    }
  }

  async function handleCopy() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleShare() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await Share.share({ message: shareMessage });
      if (result.action === Share.sharedAction) {
        handleComplete();
      }
    } catch {
      // user dismissed the share sheet — stay on the step so they can retry
    }
  }

  // ── Invited-user fast path ────────────────────────────────────────────────
  if (isJoining) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={[styles.glowTopRight, { backgroundColor: "#2ECC8A" }]} pointerEvents="none" />
        <View style={[styles.glowBottomLeft, { backgroundColor: "#4A9EFF" }]} pointerEvents="none" />
        <View style={styles.joinWrap}>
          <View style={[styles.iconBox, { backgroundColor: "#2ECC8A22", borderColor: "#2ECC8A40", width: 84, height: 84, borderRadius: 26 }]}>
            <Text style={{ fontSize: 40 }}>🎉</Text>
          </View>
          <Text style={[styles.h1, { color: colors.foreground, fontSize: 28, textAlign: "center" }]}>
            {hasRealName ? `You're in, ${firstName}!` : "You're in!"}
          </Text>
          <Text style={[styles.desc, { color: colors.mutedForeground, textAlign: "center", fontSize: 15, marginBottom: 28 }]}>
            {params.inviteTitle
              ? `Let's get you into ${params.inviteTitle} and find a time that works for everyone.`
              : "Let's get you into your squad and find a time that works for everyone."}
          </Text>
        </View>
        <View style={[styles.footer, { paddingBottom: botPad + 16, borderTopColor: colors.border + "80" }]}>
          <GradientButton label="Let's go →" onPress={handleComplete} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Background glow orbs */}
      <View style={[styles.glowTopRight, { backgroundColor: glow }]} pointerEvents="none" />
      <View style={[styles.glowBottomLeft, { backgroundColor: step % 2 === 0 ? "#A855F7" : "#4A9EFF" }]} pointerEvents="none" />

      {/* Step dots + back */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            step > 0 ? setStep(step - 1) : router.back();
          }}
          style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.backArrow, { color: colors.mutedForeground }]}>←</Text>
        </TouchableOpacity>
        <View style={styles.dots}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === step ? glow : i < step ? glow + "70" : colors.border,
                  width: i === step ? 24 : 10,
                },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.stepCounter, { color: colors.mutedForeground }]}>{step + 1} of {TOTAL_STEPS}</Text>
      </View>

      {/* Content */}
      <KeyboardAwareScrollViewCompat style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[styles.iconBox, { backgroundColor: glow + "22", borderColor: glow + "40" }]}>
          <Text style={styles.iconEmoji}>{STEP_ICONS[step]}</Text>
        </View>

        <Text style={[styles.h1, { color: colors.foreground }]}>{STEP_TITLES[step]}</Text>
        <Text style={[styles.desc, { color: colors.mutedForeground }]}>{STEP_DESCS[step]}</Text>

        {/* Step 0 — Squad */}
        {step === 0 && (
          <View style={{ gap: 12 }}>
            <IconPicker value={squadEmoji} onChange={setSquadEmoji} />
            <TextInput
              placeholder="Squad name, e.g. The Usual Suspects"
              placeholderTextColor={colors.mutedForeground}
              value={squadName}
              onChangeText={setSquadName}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={styles.chipsWrap}>
              {SQUAD_CHIPS.map((chip) => (
                <TouchableOpacity
                  key={chip}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSquadName(chip); }}
                  style={[styles.chipSmall, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.chipSmallText, { color: colors.mutedForeground }]}>{chip}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Step 1 — Invite crew (the climax) */}
        {step === 1 && (
          <View style={{ gap: 14 }}>
            {/* Squad confirmation */}
            {createdSquad && (
              <View style={[styles.squadConfirm, { backgroundColor: createdSquad.color + "18", borderColor: createdSquad.color + "40" }]}>
                <Text style={styles.squadConfirmEmoji}>{createdSquad.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.squadConfirmName, { color: colors.foreground }]}>{createdSquad.name}</Text>
                  <Text style={[styles.squadConfirmSub, { color: colors.mutedForeground }]}>
                    {createdSquad.memberIds?.length === 1 ? "Just you so far — invite your crew below" : `${createdSquad.memberIds?.length ?? 1} members`}
                  </Text>
                </View>
                <Ionicons name="checkmark-circle" size={22} color={createdSquad.color} />
              </View>
            )}

            {/* Invite link card with copy + share */}
            <View style={[styles.linkCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.linkLabel, { color: colors.mutedForeground }]}>Invite link</Text>
              <View style={styles.linkRow}>
                <Text style={[styles.linkValue, { color: colors.foreground }]} numberOfLines={1} ellipsizeMode="tail">
                  {inviteLink}
                </Text>
                <TouchableOpacity
                  onPress={() => { void handleCopy(); }}
                  style={[styles.copyBtn, { backgroundColor: copied ? "#2ECC8A18" : colors.background, borderColor: copied ? "#2ECC8A60" : colors.border }]}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={copied ? "checkmark" : "copy-outline"}
                    size={16}
                    color={copied ? "#2ECC8A" : colors.mutedForeground}
                  />
                  <Text style={[styles.copyBtnText, { color: copied ? "#2ECC8A" : colors.mutedForeground }]}>
                    {copied ? "Copied!" : "Copy"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Share action row */}
            <TouchableOpacity
              onPress={() => { void handleShare(); }}
              activeOpacity={0.8}
              style={[styles.shareRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.shareIcon, { backgroundColor: "#A855F720" }]}>
                <Ionicons name="share-social-outline" size={20} color="#A855F7" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.shareRowTitle, { color: colors.foreground }]}>Send to your crew</Text>
                <Text style={[styles.shareRowSub, { color: colors.mutedForeground }]}>iMessage, WhatsApp, Instagram…</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </TouchableOpacity>

            <View style={styles.trustRow}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.mutedForeground} />
              <Text style={[styles.trustText, { color: colors.mutedForeground }]}>
                Private link — only people you send it to can join.
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: 32 }} />
      </KeyboardAwareScrollViewCompat>

      {/* Footer CTA */}
      <View style={[styles.footer, { paddingBottom: botPad + 16, borderTopColor: colors.border + "80" }]}>
        {step === 0 && (
          <View style={{ gap: 8 }}>
            <GradientButton
              label={creating ? "Creating squad…" : squadName.trim() ? "Create Squad → Invite Crew" : "Name your squad first"}
              onPress={() => { void handleCreateSquad(); }}
              disabled={!squadName.trim() || creating}
            />
            <TouchableOpacity onPress={() => setStep(1)} style={{ alignItems: "center", padding: 4 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Skip — I'll make a squad later</Text>
            </TouchableOpacity>
          </View>
        )}
        {step === 1 && (
          <GradientButton
            label={createdSquad ? "Done — take me to my squad →" : "Skip for now"}
            onPress={handleComplete}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  glowTopRight: {
    position: "absolute", top: -60, right: -40,
    width: 240, height: 240, borderRadius: 120,
    opacity: 0.13,
  },
  glowBottomLeft: {
    position: "absolute", bottom: -40, left: -40,
    width: 200, height: 200, borderRadius: 100,
    opacity: 0.08,
  },
  topBar: {
    flexDirection: "row", alignItems: "center",
    gap: 12, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 8,
  },
  backBtn: {
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  backArrow: { fontSize: 16 },
  dots: { flexDirection: "row", gap: 6, flex: 1 },
  dot: { height: 4, borderRadius: 2 },
  stepCounter: { fontSize: 12, fontWeight: "700" },
  body: { flex: 1, paddingHorizontal: 22 },
  joinWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 8 },
  iconBox: {
    width: 64, height: 64, borderRadius: 20,
    borderWidth: 1, alignItems: "center", justifyContent: "center",
    marginBottom: 14, marginTop: 4,
  },
  iconEmoji: { fontSize: 30 },
  h1: { fontSize: 24, fontWeight: "800", marginBottom: 4, lineHeight: 30 },
  desc: { fontSize: 13, marginBottom: 20, lineHeight: 18 },
  input: {
    borderRadius: 13, borderWidth: 1.5,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 15,
  },
  trustRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, paddingVertical: 4,
  },
  trustText: { fontSize: 12, flex: 1, lineHeight: 16 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipSmall: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  chipSmallText: { fontSize: 12 },
  squadConfirm: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 14,
  },
  squadConfirmEmoji: { fontSize: 30 },
  squadConfirmName: { fontSize: 16, fontWeight: "800" },
  squadConfirmSub: { fontSize: 12, marginTop: 2 },
  linkCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  linkLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  linkValue: { fontSize: 13, fontWeight: "600", flex: 1 },
  copyBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  copyBtnText: { fontSize: 13, fontWeight: "700" },
  shareRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  shareIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  shareRowTitle: { fontSize: 15, fontWeight: "800" },
  shareRowSub: { fontSize: 12, marginTop: 2 },
  footer: {
    paddingHorizontal: 22, paddingTop: 14, borderTopWidth: 1,
    gap: 8,
  },
});
