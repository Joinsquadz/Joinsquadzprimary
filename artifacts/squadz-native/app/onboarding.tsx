import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  ScrollView,
  Share,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData } from "@/context/AppContext";
import { GradientButton } from "@/components/GradientButton";
import { useTips } from "@/context/TipsContext";

const SQUAD_EMOJIS = ["🔥", "💼", "🎓", "🏡", "✈️", "🎮", "🍕", "🎉", "💪", "🌊", "🎵", "🦄"];
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
      const color = SQUAD_COLORS[SQUAD_EMOJIS.indexOf(squadEmoji) % SQUAD_COLORS.length] ?? "#FF5C3A";
      const id = await addSquad({ name: squadName.trim(), emoji: squadEmoji, color, isPublic: false });
      setCreatedSquadId(id);
    } finally {
      setCreating(false);
      setStep(1);
    }
  }

  async function handleShare() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({ message: shareMessage });
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
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[styles.iconBox, { backgroundColor: glow + "22", borderColor: glow + "40" }]}>
          <Text style={styles.iconEmoji}>{STEP_ICONS[step]}</Text>
        </View>

        <Text style={[styles.h1, { color: colors.foreground }]}>{STEP_TITLES[step]}</Text>
        <Text style={[styles.desc, { color: colors.mutedForeground }]}>{STEP_DESCS[step]}</Text>

        {/* Step 0 — Squad */}
        {step === 0 && (
          <View style={{ gap: 12 }}>
            <View style={styles.emojiGridSmall}>
              {SQUAD_EMOJIS.map((e) => (
                <TouchableOpacity
                  key={e}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSquadEmoji(e); }}
                  style={[
                    styles.squadEmojiCell,
                    {
                      backgroundColor: squadEmoji === e ? "#FF5C3A22" : colors.card,
                      borderColor: squadEmoji === e ? "#FF5C3A" : colors.border,
                      borderWidth: squadEmoji === e ? 2 : 1,
                    },
                  ]}
                >
                  <Text style={styles.squadEmojiText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
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
            {/* Why inviting unlocks value */}
            <View style={[styles.whyCard, { backgroundColor: "#FF5C3A12", borderColor: "#FF5C3A35" }]}>
              <Text style={styles.whyEmoji}>🗓️</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.whyTitle, { color: colors.foreground }]}>Why invite now?</Text>
                <Text style={[styles.whyText, { color: colors.mutedForeground }]}>
                  SquadZ finds the time everyone's actually free — that only works once your crew is in. Get 2+ friends in to unlock your overlap and lock in your first plan.
                </Text>
              </View>
            </View>

            {/* Invite link */}
            <View style={[styles.linkCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.linkLabel, { color: colors.mutedForeground }]}>
                {createdSquad ? "Your squad invite link" : "Your invite link"}
              </Text>
              <Text style={[styles.linkValue, { color: colors.foreground }]} numberOfLines={1}>{inviteLink}</Text>
              {inviteCode ? (
                <Text style={[styles.linkCode, { color: colors.primary }]}>Invite code: {inviteCode}</Text>
              ) : null}
            </View>

            <View style={styles.trustRow}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.mutedForeground} />
              <Text style={[styles.trustText, { color: colors.mutedForeground }]}>
                Private link — only people you send it to can join.
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

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
          <View style={{ gap: 8 }}>
            <GradientButton
              label="Share invite link →"
              onPress={() => { void handleShare(); }}
            />
            <TouchableOpacity onPress={handleComplete} style={{ alignItems: "center", padding: 4 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {createdSquad ? "Done — take me to my squad" : "Skip for now"}
              </Text>
            </TouchableOpacity>
          </View>
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
  emojiGridSmall: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  squadEmojiCell: {
    width: "14%", aspectRatio: 1, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  squadEmojiText: { fontSize: 20 },
  chipSmall: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  chipSmallText: { fontSize: 12 },
  whyCard: {
    flexDirection: "row", gap: 12, borderRadius: 16, borderWidth: 1, padding: 16,
  },
  whyEmoji: { fontSize: 26 },
  whyTitle: { fontSize: 15, fontWeight: "800", marginBottom: 4 },
  whyText: { fontSize: 13, lineHeight: 18 },
  linkCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 6 },
  linkLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  linkValue: { fontSize: 14, fontWeight: "600" },
  linkCode: { fontSize: 13, fontWeight: "700" },
  footer: {
    paddingHorizontal: 22, paddingTop: 14, borderTopWidth: 1,
    gap: 8,
  },
});
