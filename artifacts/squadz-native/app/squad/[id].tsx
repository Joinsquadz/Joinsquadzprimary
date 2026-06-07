import { useState, useEffect, useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  Animated,
  Switch,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth, type FoundUser } from "@/context/AppContext";
import { useMessages } from "@/context/MessagesContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { EventCard } from "@/components/EventCard";
import { goingCount } from "@/lib/eventUtils";
import { useUserCache } from "@/context/UserCacheContext";

const EMOJIS = ["🔥", "🎉", "🎮", "🏖️", "🍕", "🎸", "⚽", "🎬", "🍻", "🎊", "🏀", "🎲", "🧗", "🎤", "🏠", "💼"];

function getFriendCodeDisplayName(u: FoundUser): string {
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  if (u.firstName) return u.firstName;
  return "Unknown User";
}

function getFriendCodeInitials(u: FoundUser): string {
  if (u.firstName && u.lastName) return `${u.firstName[0]}${u.lastName[0]}`.toUpperCase();
  if (u.firstName) return u.firstName.slice(0, 2).toUpperCase();
  return "?";
}

export default function SquadDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { events, getSquad, updateSquad, leaveSquad, currentUser, addMemberByFriendCode, removeMember } = useData();
  const { resolveUser, prefetchUsers } = useUserCache();
  const { getSquadConversation } = useMessages();
  const { authToken } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [openingChat, setOpeningChat] = useState(false);
  const [availabilityTitle, setAvailabilityTitle] = useState<string | null>(null);
  const [newResponseCount, setNewResponseCount] = useState(0);

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  const [showLongPressHint, setShowLongPressHint] = useState(false);
  const hintOpacity = useRef(new Animated.Value(0)).current;

  const resetAddMemberModal = () => {
    setFriendCodeInput("");
    setLookupError(null);
    setFoundUser(null);
    setAddLoading(false);
    setLookupLoading(false);
  };

  const lookupFriendCode = async () => {
    const code = friendCodeInput.trim().toUpperCase();
    if (!code) return;
    setLookupLoading(true);
    setLookupError(null);
    setFoundUser(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", ...buildAuthHeaders(authToken) };
      const res = await fetch(`${API_BASE}/api/users/by-friend-code/${encodeURIComponent(code)}`, { headers });
      const data = (await res.json().catch(() => ({}))) as FoundUser & { error?: string };
      if (!res.ok) {
        setLookupError(data.error ?? "No user found with that code.");
      } else {
        setFoundUser(data);
      }
    } catch {
      setLookupError("Network error. Please try again.");
    } finally {
      setLookupLoading(false);
    }
  };

  const confirmAddMember = async () => {
    if (!foundUser || !id) return;
    setAddLoading(true);
    const result = await addMemberByFriendCode(id, friendCodeInput.trim().toUpperCase());
    setAddLoading(false);
    if (result.error) {
      setLookupError(result.error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAddMemberOpen(false);
      resetAddMemberModal();
    }
  };

  const authHeaders = useCallback((): Record<string, string> => ({
    "Content-Type": "application/json",
    ...buildAuthHeaders(authToken),
  }), [authToken]);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      const avKey = `availability_lastviewed_${id}`;
      Promise.all([
        fetch(`${API_BASE}/api/availability/polls/find?squadId=${id}`, { headers: authHeaders() })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null),
        AsyncStorage.getItem(avKey).catch(() => null),
      ]).then(([d, stored]: [{ poll?: { title?: string; createdBy?: string }; members?: { id: string; respondedAt: string | null }[] } | null, string | null]) => {
        if (!active) return;
        setAvailabilityTitle(d?.poll?.title ?? null);
        if (d?.poll?.createdBy === currentUser.id && stored) {
          const lastViewedAt = new Date(Number(stored));
          const count = (d.members ?? []).filter((m) => {
            if (m.id === currentUser.id) return false;
            if (!m.respondedAt) return false;
            return new Date(m.respondedAt) > lastViewedAt;
          }).length;
          setNewResponseCount(count);
        } else {
          setNewResponseCount(0);
        }
      });
      return () => { active = false; };
    }, [id, authHeaders, currentUser.id])
  );

  useEffect(() => {
    if (!id) return;
    const squadData = getSquad(id);
    if (!squadData) return;
    const creatorUserId = squadData.memberIds[0] ?? null;
    if (currentUser.id !== creatorUserId) return;
    const hintKey = `hint_member_longpress_seen_${currentUser.id}`;
    AsyncStorage.getItem(hintKey).then((val) => {
      if (val) return;
      setShowLongPressHint(true);
      Animated.sequence([
        Animated.timing(hintOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(2500),
        Animated.timing(hintOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(() => {
        setShowLongPressHint(false);
        AsyncStorage.setItem(hintKey, "1").catch(() => {});
      });
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, currentUser.id]);

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
  const [muted, setMuted] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);

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

  const creatorId = squad.creatorId ?? squad.memberIds[0] ?? null;
  const isCreator = currentUser.id === creatorId;

  const handleMemberLongPress = (memberId: string, memberName: string) => {
    const isSelf = memberId === currentUser.id;
    if (!isCreator && !isSelf) return;
    const isTarget = memberId === creatorId && isCreator;
    if (isTarget) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const label = isSelf ? "Leave squad" : `Remove ${memberName}`;
    const message = isSelf
      ? `Leave "${squad.name}"? You'll need a new invite to rejoin.`
      : `Remove ${memberName} from "${squad.name}"?`;
    Alert.alert(label, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: isSelf ? "Leave" : "Remove",
        style: "destructive",
        onPress: async () => {
          const result = await removeMember(squad.id, memberId);
          if (result.error) {
            Alert.alert("Error", result.error);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            if (isSelf) goBack();
          }
        },
      },
    ]);
  };
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
    // Load current mute status
    fetch(`${API_BASE}/api/squads/${squad.id}/mute`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { muted?: boolean } | null) => {
        if (d != null) setMuted(Boolean(d.muted));
      })
      .catch(() => null);
  };

  const toggleMute = async (value: boolean) => {
    setMuteLoading(true);
    setMuted(value);
    try {
      await fetch(`${API_BASE}/api/squads/${squad.id}/mute`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ muted: value }),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setMuted(!value);
    } finally {
      setMuteLoading(false);
    }
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
        {showLongPressHint && (
          <Animated.View style={[styles.longPressHint, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "35", opacity: hintOpacity }]}>
            <Ionicons name="hand-left-outline" size={14} color={colors.primary} />
            <Text style={[styles.longPressHintText, { color: colors.primary }]}>Long-press a member to remove</Text>
          </Animated.View>
        )}
        <View style={styles.membersGrid}>
          {members.map((m) => {
            const canInteract = isCreator ? m.id !== creatorId : m.id === currentUser.id;
            return (
              <TouchableOpacity
                key={m.id}
                onLongPress={() => handleMemberLongPress(m.id, m.name.split(" ")[0])}
                delayLongPress={400}
                disabled={!canInteract}
                style={[styles.memberCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                activeOpacity={canInteract ? 0.7 : 1}
              >
                <UserAvatar initials={m.initials} color={m.color} imageUrl={m.profileImageUrl} size={44} fontSize={15} />
                <Text style={[styles.memberName, { color: colors.foreground }]} numberOfLines={1}>
                  {m.name.split(" ")[0]}
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              resetAddMemberModal();
              setAddMemberOpen(true);
            }}
            style={[styles.memberCard, styles.addMember, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.addIcon, { backgroundColor: colors.primary + "20" }]}>
              <Ionicons name="person-add-outline" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.memberName, { color: colors.primary }]}>Add</Text>
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
          {newResponseCount > 0 && (
            <View style={[styles.responseBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.responseBadgeText}>{newResponseCount}</Text>
            </View>
          )}
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

      {/* ---- Add Member Modal ---- */}
      <Modal
        visible={addMemberOpen}
        transparent
        animationType="slide"
        onRequestClose={() => { setAddMemberOpen(false); resetAddMemberModal(); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add by friend code</Text>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Friend Code</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              <TextInput
                placeholder="e.g. SQ-AB12"
                placeholderTextColor={colors.textDim}
                value={friendCodeInput}
                onChangeText={(t) => {
                  setFriendCodeInput(t);
                  setLookupError(null);
                  setFoundUser(null);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[styles.modalInput, { flex: 1, marginBottom: 0, backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              <TouchableOpacity
                onPress={() => { void lookupFriendCode(); }}
                disabled={lookupLoading || !friendCodeInput.trim()}
                style={[styles.searchBtn, { backgroundColor: colors.primary, opacity: (!friendCodeInput.trim() || lookupLoading) ? 0.5 : 1 }]}
              >
                {lookupLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="search-outline" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>

            {lookupError && (
              <View style={[styles.lookupError, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "40" }]}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
                <Text style={[styles.lookupErrorText, { color: colors.destructive }]}>{lookupError}</Text>
              </View>
            )}

            {foundUser && !lookupError && (
              <View style={[styles.foundUserCard, { backgroundColor: colors.card, borderColor: colors.primary + "40" }]}>
                <UserAvatar
                  initials={getFriendCodeInitials(foundUser)}
                  color="#A855F7"
                  imageUrl={foundUser.profileImageUrl}
                  size={44}
                  fontSize={15}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.foundUserName, { color: colors.foreground }]}>{getFriendCodeDisplayName(foundUser)}</Text>
                  <Text style={[styles.foundUserCode, { color: colors.mutedForeground }]}>{foundUser.friendCode}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              </View>
            )}

            <View style={[styles.modalActions, { marginTop: foundUser || lookupError ? 16 : 4 }]}>
              <TouchableOpacity
                onPress={() => { setAddMemberOpen(false); resetAddMemberModal(); }}
                style={[styles.modalBtn, { backgroundColor: colors.card }]}
              >
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { void confirmAddMember(); }}
                disabled={!foundUser || addLoading}
                style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: (!foundUser || addLoading) ? 0.5 : 1 }]}
              >
                {addLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff" }]}>Add to Squad</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

            <View style={[styles.actionRow, { borderColor: colors.border }]}>
              <Ionicons name={muted ? "notifications-off-outline" : "notifications-outline"} size={20} color={colors.foreground} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionText, { color: colors.foreground }]}>Mute notifications</Text>
                <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>
                  {muted ? "New member alerts silenced for this squad" : "Get alerts when someone joins this squad"}
                </Text>
              </View>
              {muteLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Switch
                  value={muted}
                  onValueChange={(v) => { void toggleMute(v); }}
                  trackColor={{ false: colors.border, true: colors.primary + "80" }}
                  thumbColor={muted ? colors.primary : colors.mutedForeground}
                />
              )}
            </View>

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
  actionText: { fontSize: 15, fontWeight: "600" },
  actionSub: { fontSize: 12, marginTop: 2 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  modalBtn: { flex: 1, borderRadius: 13, padding: 14, alignItems: "center" },
  modalBtnText: { fontSize: 15, fontWeight: "800" },
  searchBtn: { width: 50, height: 50, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  lookupError: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 4 },
  lookupErrorText: { fontSize: 13, fontWeight: "600", flex: 1 },
  foundUserCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1.5, padding: 14, marginBottom: 4 },
  foundUserName: { fontSize: 15, fontWeight: "800" },
  foundUserCode: { fontSize: 12, marginTop: 2 },
  responseBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", marginRight: 4 },
  responseBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  longPressHint: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 11, marginBottom: 10, alignSelf: "flex-start" },
  longPressHintText: { fontSize: 12, fontWeight: "600" },
});
