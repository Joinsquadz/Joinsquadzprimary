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
import { useAuth } from "@/context/AppContext";

const AVATAR_COLORS = ["#FF5C3A", "#4A9EFF", "#2ECC8A", "#A855F7", "#FFB547", "#FF6B9D"];
const INTERESTS = ["Music", "Food", "Sports", "Gaming", "Travel", "Art", "Outdoors", "Film"];

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const params = useLocalSearchParams<{ inviteEventId?: string; inviteTitle?: string }>();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const handleComplete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    login();
    if (params.inviteEventId) {
      router.replace(`/event/${params.inviteEventId}` as never);
    } else {
      router.replace("/(tabs)" as never);
    }
  };

  const StepDots = () => (
    <View style={styles.dots}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: i === step ? colors.primary : colors.border },
            i === step && styles.dotActive,
          ]}
        />
      ))}
    </View>
  );

  const Btn = ({
    label,
    onPress,
    disabled = false,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        { backgroundColor: disabled ? colors.border : colors.primary },
      ]}
    >
      <Text style={[styles.btnText, { color: disabled ? colors.textDim : "#fff" }]}>{label}</Text>
    </TouchableOpacity>
  );

  if (step === 0) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <StepDots />
        <View style={styles.content}>
          <Text style={styles.stepLabel}>Step 1 of 5</Text>
          <Text style={[styles.h1, { color: colors.foreground }]}>What's your name?</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            How should your squad know you?
          </Text>
          <TextInput
            placeholder="Your name"
            placeholderTextColor={colors.textDim}
            value={name}
            onChangeText={setName}
            autoFocus
            style={[
              styles.nameInput,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
            ]}
          />
        </View>
        <View style={[styles.footer, { paddingBottom: botPad + 16 }]}>
          <Btn label="Continue →" onPress={() => setStep(1)} disabled={!name.trim()} />
        </View>
      </View>
    );
  }

  if (step === 1) {
    const initials = name.trim().split(" ").map((p) => p[0]?.toUpperCase() ?? "").join("").slice(0, 2);
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <StepDots />
        <View style={styles.content}>
          <Text style={styles.stepLabel}>Step 2 of 5</Text>
          <Text style={[styles.h1, { color: colors.foreground }]}>Pick your vibe</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Choose your avatar color</Text>
          <View style={[styles.avatarPreview, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarInitials}>{initials || "JP"}</Text>
          </View>
          <View style={styles.colorGrid}>
            {AVATAR_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAvatarColor(c); }}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: c, borderWidth: avatarColor === c ? 3 : 0, borderColor: "#fff" },
                ]}
              />
            ))}
          </View>
        </View>
        <View style={[styles.footer, { paddingBottom: botPad + 16 }]}>
          <Btn label="Continue →" onPress={() => setStep(2)} />
        </View>
      </View>
    );
  }

  if (step === 2) {
    const toggle = (interest: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedInterests((prev) =>
        prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
      );
    };
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <StepDots />
        <View style={styles.content}>
          <Text style={styles.stepLabel}>Step 3 of 5</Text>
          <Text style={[styles.h1, { color: colors.foreground }]}>What's your scene?</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Pick interests to find events you'll love</Text>
          <View style={styles.interestGrid}>
            {INTERESTS.map((interest) => {
              const active = selectedInterests.includes(interest);
              return (
                <TouchableOpacity
                  key={interest}
                  onPress={() => toggle(interest)}
                  style={[
                    styles.interestChip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.interestText, { color: active ? "#fff" : colors.mutedForeground }]}>
                    {interest}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View style={[styles.footer, { paddingBottom: botPad + 16 }]}>
          <Btn label="Continue →" onPress={() => setStep(3)} />
        </View>
      </View>
    );
  }

  if (step === 3) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <StepDots />
        <View style={styles.content}>
          <Text style={styles.stepLabel}>Step 4 of 5</Text>
          <Text style={[styles.h1, { color: colors.foreground }]}>Find your squad</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            You can create or join squads after signing up
          </Text>
          <View style={[styles.squadCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.squadIcon, { backgroundColor: colors.primary + "20" }]}>
              <Ionicons name="people-outline" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.squadCardTitle, { color: colors.foreground }]}>Your squads are waiting</Text>
            <Text style={[styles.squadCardSub, { color: colors.mutedForeground }]}>
              Create a squad with friends or join one with an invite code
            </Text>
          </View>
        </View>
        <View style={[styles.footer, { paddingBottom: botPad + 16 }]}>
          <Btn label="Continue →" onPress={() => setStep(4)} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <StepDots />
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.stepLabel}>Step 5 of 5</Text>
        <Text style={[styles.h1, { color: colors.foreground }]}>Choose your plan</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>You can always upgrade later</Text>

        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPlan("free"); }}
          style={[styles.planCard, { backgroundColor: colors.card, borderColor: plan === "free" ? colors.primary : colors.border }]}
        >
          <View style={styles.planHeader}>
            <Text style={[styles.planName, { color: colors.foreground }]}>Free</Text>
            <Text style={[styles.planPrice, { color: colors.foreground }]}>$0</Text>
          </View>
          {["Up to 3 squads", "10 events/month", "Basic task lists"].map((f) => (
            <View key={f} style={styles.planFeature}>
              <Ionicons name="checkmark" size={16} color={colors.green} />
              <Text style={[styles.planFeatureText, { color: colors.mutedForeground }]}>{f}</Text>
            </View>
          ))}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPlan("pro"); }}
          style={[styles.planCard, { backgroundColor: colors.card, borderColor: plan === "pro" ? colors.gold : colors.border }]}
        >
          <View style={[styles.bestValue, { backgroundColor: colors.gold }]}>
            <Text style={styles.bestValueText}>BEST VALUE</Text>
          </View>
          <View style={styles.planHeader}>
            <Text style={[styles.planName, { color: colors.foreground }]}>Pro</Text>
            <Text style={[styles.planPrice, { color: colors.gold }]}>$20/yr</Text>
          </View>
          {["Unlimited squads & events", "Photo vault (forever)", "AI best-time finder", "Split costs auto", "Priority support"].map((f) => (
            <View key={f} style={styles.planFeature}>
              <Ionicons name="checkmark-circle" size={16} color={colors.green} />
              <Text style={[styles.planFeatureText, { color: colors.mutedForeground }]}>{f}</Text>
            </View>
          ))}
        </TouchableOpacity>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: botPad + 16 }]}>
        <Btn
          label={plan === "pro" ? "Start Pro — $20/year →" : plan === "free" ? "Start Free →" : "Choose a plan to continue"}
          onPress={handleComplete}
          disabled={!plan}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dots: { flexDirection: "row", gap: 6, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotActive: { width: 20 },
  stepLabel: { fontSize: 12, color: "#555566", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  h1: { fontSize: 28, fontWeight: "800", marginBottom: 8 },
  sub: { fontSize: 14, lineHeight: 20, marginBottom: 28 },
  footer: { paddingHorizontal: 24 },
  btn: { borderRadius: 14, padding: 15, alignItems: "center" },
  btnText: { fontSize: 16, fontWeight: "800" },
  nameInput: { borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 16, fontSize: 17, height: 54 },
  avatarPreview: { width: 96, height: 96, borderRadius: 30, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 24 },
  avatarInitials: { fontSize: 36, fontWeight: "800", color: "#fff" },
  colorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  colorSwatch: { width: 48, height: 48, borderRadius: 24 },
  interestGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  interestChip: { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 8 },
  interestText: { fontSize: 14, fontWeight: "600" },
  squadCard: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: "center", gap: 12 },
  squadIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  squadCardTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  squadCardSub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  planCard: { borderRadius: 16, borderWidth: 2, padding: 18, marginBottom: 12, position: "relative" },
  planHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  planName: { fontSize: 20, fontWeight: "800" },
  planPrice: { fontSize: 20, fontWeight: "800" },
  planFeature: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  planFeatureText: { fontSize: 14 },
  bestValue: { position: "absolute", top: -10, right: 16, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  bestValueText: { fontSize: 10, fontWeight: "800", color: "#000" },
});
