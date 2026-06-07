import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData } from "@/context/AppContext";
import { GradientButton } from "@/components/GradientButton";

type ContactItem = { id: string; name: string; phone: string };

const MOCK_CONTACTS: ContactItem[] = [
  { id: "mc1", name: "Aisha Williams", phone: "(555) 234-5678" },
  { id: "mc2", name: "Brandon Torres", phone: "(555) 345-6789" },
  { id: "mc3", name: "Carlos Reyes", phone: "(555) 456-7890" },
  { id: "mc4", name: "Diana Park", phone: "(555) 567-8901" },
  { id: "mc5", name: "Ethan Moore", phone: "(555) 678-9012" },
  { id: "mc6", name: "Fiona Zhang", phone: "(555) 789-0123" },
  { id: "mc7", name: "George Kim", phone: "(555) 890-1234" },
  { id: "mc8", name: "Hannah Lee", phone: "(555) 901-2345" },
  { id: "mc9", name: "Ivan Rodriguez", phone: "(555) 012-3456" },
  { id: "mc10", name: "Julia Martinez", phone: "(555) 123-4567" },
  { id: "mc11", name: "Kevin Brown", phone: "(555) 234-5679" },
  { id: "mc12", name: "Layla Johnson", phone: "(555) 345-6780" },
];

const AVATARS = ["🐶", "🦊", "🐻", "🐼", "🦁", "🐯", "🦝", "🐸", "🐙", "🦋", "🌈", "⚡"];
const INTERESTS = [
  { icon: "🍕", label: "Food" },
  { icon: "🏖️", label: "Outdoors" },
  { icon: "🎮", label: "Gaming" },
  { icon: "🎬", label: "Movies" },
  { icon: "🎵", label: "Music" },
  { icon: "🏋️", label: "Fitness" },
  { icon: "🎨", label: "Arts" },
  { icon: "✈️", label: "Travel" },
  { icon: "🍺", label: "Bars" },
  { icon: "🎤", label: "Live Events" },
  { icon: "🧩", label: "Board Games" },
  { icon: "🍳", label: "Cooking" },
];
const SQUAD_EMOJIS = ["🔥", "💼", "🎓", "🏡", "✈️", "🎮", "🍕", "🎉", "💪", "🌊", "🎵", "🦄"];
const SQUAD_CHIPS = ["Friend Group", "Coworkers", "Family", "College", "Roommates", "Sports"];

const GLOW_COLORS = ["#FF5C3A", "#A855F7", "#FFB547", "#2ECC8A", "#4A9EFF", "#2ECC8A"];
const STEP_ICONS = ["👋", "😊", "✨", "🔥", "⚡", "📲"];
const STEP_TITLES = ["What should we call you?", "Pick your vibe", "What do you love?", "Name your squad", "Choose your plan", "Invite your people"];
const STEP_DESCS = [
  "How your squad will see you",
  "Express yourself with an avatar",
  "Helps us suggest the best events (pick 3+)",
  "Create your first group to start planning",
  "You can upgrade or downgrade anytime",
  "Let your crew know Squadz is where it's at",
];
const TOTAL_STEPS = 6;

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { friendCode, currentUser } = useData();
  const params = useLocalSearchParams<{ inviteEventId?: string; inviteTitle?: string }>();

  const hasRealName = currentUser.id !== "me";
  const [step, setStep] = useState(hasRealName ? 1 : 0);
  const [name, setName] = useState(hasRealName ? currentUser.name.split(" ")[0] : "");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [squadEmoji, setSquadEmoji] = useState("🔥");
  const [squadName, setSquadName] = useState("");
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);

  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [contactSearch, setContactSearch] = useState("");
  const [contactsLoading, setContactsLoading] = useState(false);

  useEffect(() => {
    if (step !== 5) return;
    void loadContacts();
  }, [step]);

  async function loadContacts() {
    setContactsLoading(true);
    try {
      if (Platform.OS === "web") {
        setContacts(MOCK_CONTACTS);
        return;
      }
      const Contacts = await import("expo-contacts");
      const { status } = await Contacts.requestPermissionsAsync();
      if (status === "granted") {
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
          sort: Contacts.SortTypes.FirstName,
        });
        const items: ContactItem[] = data
          .filter((c) => c.name && c.phoneNumbers && c.phoneNumbers.length > 0)
          .slice(0, 60)
          .map((c) => ({
            id: c.id ?? String(Math.random()),
            name: c.name ?? "",
            phone: c.phoneNumbers![0].number ?? "",
          }));
        setContacts(items.length > 0 ? items : MOCK_CONTACTS);
      } else {
        setContacts(MOCK_CONTACTS);
      }
    } catch {
      setContacts(MOCK_CONTACTS);
    } finally {
      setContactsLoading(false);
    }
  }

  async function handleSendInvites() {
    if (selectedPhones.size === 0) { handleComplete(); return; }
    if (Platform.OS !== "web") {
      try {
        const SMS = await import("expo-sms");
        const available = await SMS.isAvailableAsync();
        if (available) {
          const phones = Array.from(selectedPhones);
          const msg = `Hey! I just joined Squadz — the app that actually gets people together 🎉 Add me as a friend with my code: ${friendCode}\nDownload the app: squadz.app`;
          await SMS.sendSMSAsync(phones, msg);
        }
      } catch {
        // user cancelled or unavailable — still complete onboarding
      }
    }
    handleComplete();
  }

  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
      c.phone.includes(contactSearch),
  );

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const glow = GLOW_COLORS[step];

  const handleComplete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    login();
    if (params.inviteEventId) {
      router.replace(`/event/${params.inviteEventId}` as never);
    } else {
      router.replace("/(tabs)" as never);
    }
  };

  const stepIcon = step === 1 ? (avatar ?? STEP_ICONS[1]) : STEP_ICONS[step];

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
            step > (hasRealName ? 1 : 0) ? setStep(step - 1) : router.back();
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
        {/* Step icon */}
        <View style={[styles.iconBox, { backgroundColor: glow + "22", borderColor: glow + "40" }]}>
          <Text style={styles.iconEmoji}>{stepIcon}</Text>
        </View>

        <Text style={[styles.h1, { color: colors.foreground }]}>{STEP_TITLES[step]}</Text>
        <Text style={[styles.desc, { color: colors.mutedForeground }]}>{STEP_DESCS[step]}</Text>

        {/* Step 0 — Name */}
        {step === 0 && (
          <View style={{ gap: 10 }}>
            <TextInput
              placeholder="First name"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
              autoFocus
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
            <TextInput
              placeholder="Last name (optional)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (status !== "granted") {
                  Alert.alert("Permission needed", "Allow photo access to add a profile picture.");
                  return;
                }
                const result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  allowsEditing: true,
                  aspect: [1, 1],
                  quality: 0.7,
                });
                if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
              }}
              style={[styles.photoRow, { backgroundColor: colors.card, borderColor: photoUri ? glow : colors.border }]}
            >
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoThumb} />
              ) : (
                <Text style={styles.photoIcon}>📷</Text>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.photoTitle, { color: colors.foreground }]}>{photoUri ? "Photo added" : "Upload a photo"}</Text>
                <Text style={[styles.photoSub, { color: colors.mutedForeground }]}>{photoUri ? "Tap to change" : "Optional · JPG, PNG"}</Text>
              </View>
              <View style={[styles.chooseBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.chooseBtnText, { color: colors.mutedForeground }]}>{photoUri ? "Change" : "Choose"}</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 1 — Avatar emoji */}
        {step === 1 && (
          <View style={styles.emojiGrid}>
            {AVATARS.map((a) => (
              <TouchableOpacity
                key={a}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAvatar(a); }}
                style={[
                  styles.emojiCell,
                  {
                    backgroundColor: avatar === a ? "#A855F722" : colors.card,
                    borderColor: avatar === a ? "#A855F7" : colors.border,
                    borderWidth: avatar === a ? 2 : 1,
                    shadowColor: avatar === a ? "#A855F7" : "transparent",
                    shadowOpacity: avatar === a ? 0.3 : 0,
                    shadowRadius: 10,
                    elevation: avatar === a ? 4 : 0,
                  },
                ]}
              >
                <Text style={styles.emojiCellText}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Step 2 — Interests */}
        {step === 2 && (
          <View>
            <View style={styles.chipsWrap}>
              {INTERESTS.map(({ icon, label }) => {
                const on = interests.has(label);
                return (
                  <TouchableOpacity
                    key={label}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const s = new Set(interests);
                      s.has(label) ? s.delete(label) : s.add(label);
                      setInterests(s);
                    }}
                    style={[
                      styles.interestChip,
                      {
                        backgroundColor: on ? "#FFB54718" : colors.card,
                        borderColor: on ? "#FFB547" : colors.border,
                        borderWidth: on ? 1.5 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.interestIcon}>{icon}</Text>
                    <Text style={[styles.interestLabel, { color: on ? "#FFB547" : colors.mutedForeground }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {interests.size > 0 && interests.size < 3 && (
              <Text style={{ color: "#FFB547", fontSize: 12, marginTop: 8 }}>{3 - interests.size} more to go!</Text>
            )}
            {interests.size >= 3 && (
              <Text style={{ color: colors.green, fontSize: 12, marginTop: 8 }}>Nice picks! You're all set.</Text>
            )}
          </View>
        )}

        {/* Step 3 — Squad name */}
        {step === 3 && (
          <View style={{ gap: 12 }}>
            <View style={styles.emojiGridSmall}>
              {SQUAD_EMOJIS.map((e) => (
                <TouchableOpacity
                  key={e}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSquadEmoji(e); }}
                  style={[
                    styles.squadEmojiCell,
                    {
                      backgroundColor: squadEmoji === e ? "#2ECC8A22" : colors.card,
                      borderColor: squadEmoji === e ? "#2ECC8A" : colors.border,
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
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSquadName(chip + " Squad"); }}
                  style={[styles.chipSmall, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.chipSmallText, { color: colors.mutedForeground }]}>{chip}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Step 4 — Plan */}
        {step === 4 && (
          <View style={{ gap: 12 }}>
            {/* Free */}
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPlan("free"); }}
              style={[styles.planCard, { backgroundColor: colors.card, borderColor: plan === "free" ? "#FF5C3A" : colors.border, borderWidth: plan === "free" ? 2 : 1 }]}
            >
              <View style={styles.planHeader}>
                <Text style={[styles.planName, { color: colors.foreground }]}>Free</Text>
                <Text style={[styles.planPrice, { color: colors.mutedForeground }]}>$0</Text>
              </View>
              {["Up to 3 events per year", "30-day photo storage", "Basic squad features", "In-app messaging"].map((f) => (
                <View key={f} style={styles.planFeature}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>·</Text>
                  <Text style={[styles.planFeatureText, { color: colors.mutedForeground }]}>{f}</Text>
                </View>
              ))}
              {plan === "free" && <Text style={{ marginTop: 10, fontSize: 12, color: "#FF5C3A", fontWeight: "700" }}>✓ Selected</Text>}
            </TouchableOpacity>

            {/* Pro */}
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPlan("pro"); }}
              style={[styles.planCard, { backgroundColor: plan === "pro" ? "#FF5C3A18" : colors.card, borderColor: plan === "pro" ? "#FF5C3A" : colors.border, borderWidth: plan === "pro" ? 2 : 1 }]}
            >
              <View style={styles.planHeader}>
                <Text style={[styles.planName, { color: colors.foreground }]}>Pro ⚡</Text>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <View style={[styles.bestValueBadge, { backgroundColor: "#FF5C3A" }]}>
                    <Text style={styles.bestValueText}>BEST VALUE</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 2 }}>
                    <Text style={[styles.planPrice, { color: colors.foreground }]}>$20</Text>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>/year</Text>
                  </View>
                </View>
              </View>
              {["Unlimited events per year", "Permanent photo vault", "Calendar sync & AI scheduling", "Custom invite codes", "Priority support"].map((f) => (
                <View key={f} style={styles.planFeature}>
                  <Text style={{ color: colors.green, fontWeight: "700", fontSize: 12 }}>✓</Text>
                  <Text style={[styles.planFeatureText, { color: colors.foreground }]}>{f}</Text>
                </View>
              ))}
              {plan === "pro" && <Text style={{ marginTop: 10, fontSize: 12, color: "#FF5C3A", fontWeight: "700" }}>✓ Selected</Text>}
            </TouchableOpacity>

            <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: "center" }}>
              No credit card required for free plan · Cancel Pro anytime
            </Text>
          </View>
        )}

        {/* Step 5 — Invite contacts */}
        {step === 5 && (
          <View style={{ gap: 12 }}>
            {/* Search + select controls */}
            <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.mutedForeground} style={{ marginLeft: 12 }} />
              <TextInput
                placeholder="Search contacts…"
                placeholderTextColor={colors.textDim}
                value={contactSearch}
                onChangeText={setContactSearch}
                style={[styles.searchInput, { color: colors.foreground }]}
              />
            </View>

            <View style={styles.selectBar}>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedPhones(new Set(filteredContacts.map((c) => c.phone)));
                }}
                style={[styles.selectBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}
              >
                <Text style={[styles.selectBtnText, { color: colors.primary }]}>Select All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedPhones(new Set()); }}
                style={[styles.selectBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.selectBtnText, { color: colors.mutedForeground }]}>Clear</Text>
              </TouchableOpacity>
              {selectedPhones.size > 0 && (
                <Text style={[styles.selectedCount, { color: colors.primary }]}>
                  {selectedPhones.size} selected
                </Text>
              )}
            </View>

            {contactsLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[{ color: colors.mutedForeground, fontSize: 13, marginTop: 10 }]}>Loading contacts…</Text>
              </View>
            ) : (
              filteredContacts.map((contact) => {
                const selected = selectedPhones.has(contact.phone);
                return (
                  <TouchableOpacity
                    key={contact.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const next = new Set(selectedPhones);
                      selected ? next.delete(contact.phone) : next.add(contact.phone);
                      setSelectedPhones(next);
                    }}
                    style={[
                      styles.contactRow,
                      {
                        backgroundColor: selected ? colors.primary + "14" : colors.card,
                        borderColor: selected ? colors.primary + "50" : colors.border,
                      },
                    ]}
                  >
                    <View style={[styles.contactAvatar, { backgroundColor: colors.primary + "22" }]}>
                      <Text style={[styles.contactInitial, { color: colors.primary }]}>
                        {contact.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.contactName, { color: colors.foreground }]}>{contact.name}</Text>
                      <Text style={[styles.contactPhone, { color: colors.mutedForeground }]}>{contact.phone}</Text>
                    </View>
                    <View
                      style={[
                        styles.checkbox,
                        {
                          backgroundColor: selected ? colors.primary : "transparent",
                          borderColor: selected ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Footer CTA */}
      <View style={[styles.footer, { paddingBottom: botPad + 16, borderTopColor: colors.border + "80" }]}>
        {step === 0 && (
          <GradientButton
            label={name.trim() ? `Nice to meet you, ${name.trim().split(" ")[0]}! →` : "Enter your name to continue"}
            onPress={() => setStep(1)}
            disabled={!name.trim()}
          />
        )}
        {step === 1 && (
          <GradientButton label="Looking good! Next →" onPress={() => setStep(2)} />
        )}
        {step === 2 && (
          <GradientButton label="Perfect picks! Next →" onPress={() => setStep(3)} disabled={interests.size < 3} />
        )}
        {step === 3 && (
          <View style={{ gap: 8 }}>
            <GradientButton
              label={squadName.trim() ? "Next: Choose Your Plan →" : "Name your squad first"}
              onPress={() => setStep(4)}
              disabled={!squadName.trim()}
            />
            <TouchableOpacity onPress={() => setStep(4)} style={{ alignItems: "center", padding: 4 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Skip squad for now</Text>
            </TouchableOpacity>
          </View>
        )}
        {step === 4 && (
          <GradientButton
            label={plan === "pro" ? "Start Pro — $20/year →" : plan === "free" ? "Next: Invite Friends →" : "Choose a plan to continue"}
            onPress={() => setStep(5)}
            disabled={!plan}
          />
        )}
        {step === 5 && (
          <View style={{ gap: 8 }}>
            <GradientButton
              label={
                selectedPhones.size > 0
                  ? `Send ${selectedPhones.size} Invite${selectedPhones.size !== 1 ? "s" : ""} via Text →`
                  : "Skip for now →"
              }
              onPress={() => { void handleSendInvites(); }}
            />
            <TouchableOpacity onPress={handleComplete} style={{ alignItems: "center", padding: 4 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Skip — I'll invite friends later</Text>
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
  photoRow: {
    borderRadius: 13, borderWidth: 1,
    padding: 12, flexDirection: "row", alignItems: "center", gap: 10,
  },
  photoIcon: { fontSize: 20 },
  photoThumb: { width: 36, height: 36, borderRadius: 18 },
  photoTitle: { fontSize: 13, fontWeight: "700" },
  photoSub: { fontSize: 11, marginTop: 1 },
  chooseBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  chooseBtnText: { fontSize: 12 },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  emojiCell: {
    width: "22%", aspectRatio: 1, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  emojiCellText: { fontSize: 28 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  interestChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22,
  },
  interestIcon: { fontSize: 14 },
  interestLabel: { fontSize: 13, fontWeight: "600" },
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
  planCard: {
    borderRadius: 16, padding: 18, position: "relative", overflow: "hidden",
  },
  planHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginBottom: 14,
  },
  planName: { fontSize: 16, fontWeight: "800" },
  planPrice: { fontSize: 18, fontWeight: "800" },
  planFeature: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5 },
  planFeatureText: { fontSize: 13 },
  bestValueBadge: {
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
    alignSelf: "flex-end",
  },
  bestValueText: { fontSize: 10, fontWeight: "800", color: "#fff" },
  footer: {
    paddingHorizontal: 22, paddingTop: 14, borderTopWidth: 1,
    gap: 8,
  },
  searchRow: {
    flexDirection: "row", alignItems: "center", borderRadius: 13, borderWidth: 1,
    height: 44, overflow: "hidden",
  },
  searchInput: { flex: 1, paddingHorizontal: 10, fontSize: 14, height: "100%" },
  selectBar: { flexDirection: "row", alignItems: "center", gap: 8 },
  selectBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  selectBtnText: { fontSize: 12, fontWeight: "700" },
  selectedCount: { fontSize: 12, fontWeight: "700", marginLeft: "auto" },
  contactRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1, padding: 12,
  },
  contactAvatar: {
    width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
  },
  contactInitial: { fontSize: 15, fontWeight: "800" },
  contactName: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  contactPhone: { fontSize: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
});
