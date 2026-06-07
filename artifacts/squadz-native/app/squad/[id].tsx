import { useState, useEffect, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Modal,
  TextInput,
  Share,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth } from "@/context/AppContext";
import { useMessages } from "@/context/MessagesContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { EventCard } from "@/components/EventCard";
import { goingCount } from "@/data/mock";
import { useUserCache } from "@/context/UserCacheContext";

const EMOJIS = ["🔥", "🎉", "🎮", "🏖️", "🍕", "🎸", "⚽", "🎬", "🍻", "🎊", "🏀", "🎲", "🧗", "🎤", "🏠", "💼"];

export default function SquadDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { events, getSquad, updateSquad, leaveSquad, currentUser } = useData();
  const { resolveUser, prefetchUsers } = useUserCache();
  const { getSquadConversation } = useMessages();
  const { authToken } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [openingChat, setOpeningChat] = useState(false);
  const [availabilityTitle, setAvailabilityTitle] = useState<string | null>(null);

  const authHeaders = useCallback((): Record<string, string> => ({
    "Content-Type": "application/json",
    ...buildAuthHeaders(authToken),
  }), [authToken]);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      fetch(`${API_BASE}/api/availability/polls/find?squadId=${id}`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : null)
        .then((d?: { poll?: { title?: string } } | null) => {
          if (active) setAvailabilityTitle(d?.poll?.title ?? null);
        })
        .catch(() => { /* leave existing title on error */ });
      return () => { active = false; };
    }, [id, authHeaders])
  );

  async function handleOpenChat(squadId: string) {
    if (openingChat) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpeningChat(true);
    const convoId = await getSquadConversation(squadId);
    setOpeningChat(false);
    if (convoId) {
      router.push(`/conversation/${convoId}` as never);
    } else {
      Alert.alert("Couldn't open chat", "Please try again in a moment.");
    }
  }

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const btnTop = topPad + 8;

  const squad = getSquad(id ?? "s1");

  // Pre-load member profiles
  useEffect(() => {
    if (squad) prefetchUsers(squad.memberIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squad?.id]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("🔥");

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never));

  if (!squad) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <TouchableOpacity onPress={goBack} style={[styles.backBtn, { top: btnTop }]}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ color: colors.foreground, textAlign: "center", marginTop: 80 }}>Squad not found</Text>
      </View>
    );
  }

  const members = squad.memberIds.map((mid) => {
    if (mid === currentUser.id) return currentUser as unknown as ReturnType<typeof resolveUser>;
    return resolveUser(mid);
  });
  const squadEvents = events.filter((e) => e.squadId === squad.id);
  const inviteLink = `getsquadz.com/squad/${squad.id}`;

  const shareInvite = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({
      message: `Join my squad "${squad.emoji} ${squad.name}" on Squadz! ${inviteLink}`,
    });
  };

  const openSettings = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditName(squad.name);
    setEditEmoji(squad.emoji);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    if (!editName.trim()) {
      Alert.alert("Missing info", "Squad needs a name.");
      return;
    }
    updateSquad(squad.id, { name: editName.trim(), emoji: editEmoji });
    setSettingsOpen(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const confirmLeave = () => {
    Alert.alert("Leave squad", `Leave "${squad.name}"? You'll need a new invite to rejoin.`, [
      { text: "Stay", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () => {
          leaveSquad(squad.id);
          setSettingsOpen(false);
          goBack();
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: squad.color, paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={goBack} style={[styles.backBtn, { top: btnTop }]}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={openSettings} style={[styles.gearBtn, { top: btnTop }]}>
          <Ionicons name="settings-outline" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.heroEmoji}>{squad.emoji}</Text>
        <Text style={styles.heroName}>{squad.name}</Text>
        <Text style={styles.heroMeta}>{members.length} members</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: botPad + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Invite banner */}
        <TouchableOpacity
          onPress={shareInvite}
          style={[styles.inviteBanner, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "30" }]}
        >
          <View style={[styles.inviteIcon, { backgroundColor: colors.primary + "20" }]}>
            <Ionicons name="share-social-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.inviteTitle, { color: colors.foreground }]}>Invite friends</Text>
            <Text style={[styles.inviteSub, { color: colors.mutedForeground }]}>{inviteLink}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </TouchableOpacity>

        {/* Members */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>Members</Text>
        <View style={styles.membersGrid}>
          {members.map((m) => (
            <View key={m.id} style={[styles.memberCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <UserAvatar initials={m.initials} color={m.color} imageUrl={m.profileImageUrl} size={44} fontSize={15} />
              <Text style={[styles.memberName, { color: colors.foreground }]} numberOfLines={1}>
                {m.name.split(" ")[0]}
              </Text>
            </View>
          ))}
          <TouchableOpacity
            onPress={shareInvite}
            style={[styles.memberCard, styles.addMember, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.addIcon, { backgroundColor: colors.primary + "20" }]}>
              <Ionicons name="person-add-outline" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.memberName, { color: colors.primary }]}>Invite</Text>
          </TouchableOpacity>
        </View>

        {/* Group chat */}
        <TouchableOpacity
          onPress={() => handleOpenChat(squad.id)}
          disabled={openingChat}
          style={[styles.photosRow, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12 }]}
        >
          <View style={[styles.photosIcon, { backgroundColor: colors.primary + "20" }]}>
            <Ionicons name="chatbubbles-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.photosTitle, { color: colors.foreground }]}>Group Chat</Text>
            <Text style={[styles.photosSub, { color: colors.mutedForeground }]}>Message the whole squad</Text>
          </View>
          {openingChat ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
          )}
        </TouchableOpacity>

        {/* Photos */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(`/vault?squadId=${squad.id}&squadName=${encodeURIComponent(squad.name)}` as never);
          }}
          style={[styles.photosRow, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.photosIcon, { backgroundColor: colors.primary + "20" }]}>
            <Ionicons name="images-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.photosTitle, { color: colors.foreground }]}>Squad Photos</Text>
            <Text style={[styles.photosSub, { color: colors.mutedForeground }]}>View vault · private memories</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </TouchableOpacity>

        {/* Find the best time */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: "/availability", params: { squadId: squad.id } } as never);
          }}
          style={[styles.photosRow, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}
        >
          <View style={[styles.photosIcon, { backgroundColor: colors.primary + "20" }]}>
            <Ionicons name="sparkles-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.photosTitle, { color: colors.foreground }]}>{availabilityTitle ?? "Find the Best Time"}</Text>
            <Text style={[styles.photosSub, { color: colors.mutedForeground }]}>Poll the squad · pick a time everyone's free</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </TouchableOpacity>

        {/* Events */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>Events</Text>
        {squadEvents.length === 0 ? (
          <View style={styles.emptyEvents}>
            <Ionicons name="calendar-outline" size={36} color={colors.textDim} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No events yet</Text>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/create"); }}
              style={[styles.emptyCta, { borderColor: colors.border }]}
            >
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text style={[styles.emptyCtaText, { color: colors.primary }]}>Plan an event</Text>
            </TouchableOpacity>
          </View>
        ) : (
          squadEvents.map((e) => (
            <EventCard
              key={e.id}
              id={e.id}
              emoji={e.emoji}
              title={e.title}
              date={e.date}
              location={e.location}
              hostId={e.hostId}
              attendeeCount={goingCount(e)}
            />
          ))
        )}
      </ScrollView>

      {/* ---- Settings Modal ---- */}
      <Modal visible={settingsOpen} transparent animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Squad settings</Text>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Name</Text>
            <TextInput
              placeholder="Squad name"
              placeholderTextColor={colors.textDim}
              value={editName}
              onChangeText={setEditName}
              style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Icon</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {EMOJIS.map((e) => (
                <TouchableOpacity
                  key={e}
                  onPress={() => setEditEmoji(e)}
                  style={[styles.emojiOption, { backgroundColor: editEmoji === e ? colors.primary + "25" : colors.card, borderColor: editEmoji === e ? colors.primary : colors.border }]}
                >
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity onPress={shareInvite} style={[styles.actionRow, { borderColor: colors.border }]}>
              <Ionicons name="share-social-outline" size={20} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.foreground }]}>Share invite link</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>

            <TouchableOpacity onPress={confirmLeave} style={[styles.actionRow, { borderColor: colors.border }]}>
              <Ionicons name="exit-outline" size={20} color={colors.destructive} />
              <Text style={[styles.actionText, { color: colors.destructive }]}>Leave squad</Text>
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setSettingsOpen(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveSettings} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { paddingHorizontal: 20, paddingBottom: 24, alignItems: "center", position: "relative" },
  backBtn: { position: "absolute", top: 0, left: 16, padding: 8, zIndex: 10 },
  gearBtn: { position: "absolute", top: 0, right: 16, padding: 8, zIndex: 10 },
  heroEmoji: { fontSize: 52, marginTop: 12, marginBottom: 8 },
  heroName: { fontSize: 24, fontWeight: "800", color: "#fff", textAlign: "center" },
  heroMeta: { fontSize: 14, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  inviteBanner: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  inviteIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  inviteTitle: { fontSize: 15, fontWeight: "800" },
  inviteSub: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  membersGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  memberCard: { borderRadius: 14, borderWidth: 1, padding: 14, alignItems: "center", gap: 8, width: "30%" },
  addMember: {},
  addIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  memberName: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  emptyEvents: { alignItems: "center", paddingTop: 24, gap: 10 },
  emptyText: { fontSize: 14 },
  emptyCta: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 9 },
  emptyCtaText: { fontSize: 14, fontWeight: "700" },
  photosRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 20 },
  photosIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  photosTitle: { fontSize: 15, fontWeight: "800" },
  photosSub: { fontSize: 12, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 20 },
  modalTitle: { fontSize: 20, fontWeight: "800", marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },
  modalInput: { borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, height: 50, fontSize: 15, marginBottom: 12 },
  emojiOption: { width: 48, height: 48, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 13, borderWidth: 1, padding: 14, marginTop: 12 },
  actionText: { fontSize: 15, fontWeight: "600", flex: 1 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  modalBtn: { flex: 1, borderRadius: 13, padding: 14, alignItems: "center" },
  modalBtnText: { fontSize: 15, fontWeight: "800" },
});
