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
  KeyboardAvoidingView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTips } from "@/context/TipsContext";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useSquadStream } from "@/hooks/useSquadStream";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { runSquadPoll, squadSignature } from "@/lib/squadLiveRefresh";
import { useData, useAuth, type FoundUser } from "@/context/AppContext";
import { FindTimeChooser } from "@/components/FindTimeChooser";
import { useMutedSquads } from "@/context/MutedSquadsContext";
import { useMessages } from "@/context/MessagesContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { ProAvatar } from "@/components/ProAvatar";
import { ContactSheet } from "@/components/ContactSheet";
import { EventCard } from "@/components/EventCard";
import { TripCard } from "@/components/TripCard";
import { SquadzPlusBanner } from "@/components/SquadzPlusBanner";
import { goingCount } from "@/lib/eventUtils";
import { useUserCache, type ResolvedUser } from "@/context/UserCacheContext";

import { IconPicker } from "@/components/IconPicker";

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
  const { events, squads, getSquad, updateSquad, regenerateInviteCode, leaveSquad, currentUser, addMemberByFriendCode, removeMember, conflictSquadId, clearConflictSquad, refreshSquads, addSquadCoAdmin, removeSquadCoAdmin } = useData();
  const { resolveUser, prefetchUsers, seedUser } = useUserCache();
  const { getSquadConversation } = useMessages();
  const { authToken } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [findTimeOpen, setFindTimeOpen] = useState(false);

  // Per-screen SSE for live status feedback (reconnecting indicator).
  // The global AppContext stream already handles data refreshes; this connection
  // adds the status value so the UI can tell the user when the feed is down.
  const { status: streamStatus, retry: retryStream } = useSquadStream({
    squadId: id ?? null,
    authToken,
    onUpdate: refreshSquads,
  });
  // Only show "Reconnecting…" if the stream is still down after 3s.
  const showReconnecting = useDelayedFlag(streamStatus === "reconnecting", 3000);

  const [openingChat, setOpeningChat] = useState(false);
  const [availabilityTitle, setAvailabilityTitle] = useState<string | null>(null);
  const [newResponseCount, setNewResponseCount] = useState(0);

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<FoundUser[]>([]);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [confirmingAdd, setConfirmingAdd] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const [memberProfileOpen, setMemberProfileOpen] = useState(false);
  const [profileMember, setProfileMember] = useState<ResolvedUser | null>(null);

  const [showLongPressHint, setShowLongPressHint] = useState(false);
  const hintOpacity = useRef(new Animated.Value(0)).current;
  const conflictBannerAnim = useRef(new Animated.Value(0)).current;

  const openMemberProfile = (member: ResolvedUser) => {
    setProfileMember(member);
    setMemberProfileOpen(true);
  };

  const resetAddMemberModal = () => {
    setNameQuery("");
    setSearchError(null);
    setSearchResults([]);
    setAddingUserId(null);
    setSearchLoading(false);
    setSelectedToAdd(new Set());
    setConfirmingAdd(false);
  };

  const toggleSelectToAdd = (user: FoundUser) => {
    if (!squad || squad.memberIds.includes(user.id)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedToAdd((prev) => {
      const next = new Set(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.add(user.id);
      return next;
    });
  };

  const handleConfirmAddSelected = async () => {
    const toAdd = searchResults.filter((u) => selectedToAdd.has(u.id));
    if (toAdd.length === 0) return;
    setConfirmingAdd(true);
    setSearchError(null);
    let firstError: string | null = null;
    for (const user of toAdd) {
      const result = await handleAddUser(user);
      if (result?.error && !firstError) firstError = result.error;
    }
    setConfirmingAdd(false);
    setSelectedToAdd(new Set());
    if (firstError) setSearchError(firstError);
  };

  const handleSearch = async () => {
    const q = nameQuery.trim();
    if (q.length < 2) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", ...buildAuthHeaders(authToken) };
      const res = await fetch(`${API_BASE}/api/users/search?q=${encodeURIComponent(q)}`, { headers, signal: controller.signal });
      const data = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const errMsg = data && typeof data === "object" && "error" in data ? String((data as { error?: unknown }).error ?? "") : "";
        setSearchError(errMsg || "Search failed. Please try again.");
      } else if (Array.isArray(data)) {
        setSearchResults(data as FoundUser[]);
        if (data.length === 0) setSearchError("No users found. Try a different name.");
      } else {
        setSearchError("Search failed. Please try again.");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setSearchError("Search timed out. Check your connection and try again.");
      } else {
        setSearchError("Network error. Please try again.");
      }
    } finally {
      clearTimeout(timeoutId);
      setSearchLoading(false);
    }
  };

  const handleAddUser = async (user: FoundUser): Promise<{ error?: string } | undefined> => {
    if (!id || !user.friendCode) return;
    setAddingUserId(user.id);
    const squadBeforeAdd = getSquad(id);
    const result = await addMemberByFriendCode(id, user.friendCode);
    setAddingUserId(null);
    if (result.error) {
      return { error: result.error };
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (squadBeforeAdd) {
        const newMemberIds = squadBeforeAdd.memberIds.includes(user.id)
          ? squadBeforeAdd.memberIds
          : [...squadBeforeAdd.memberIds, user.id];
        lastSquadSigRef.current = squadSignature({
          name: squadBeforeAdd.name,
          emoji: squadBeforeAdd.emoji,
          description: squadBeforeAdd.description ?? null,
          color: squadBeforeAdd.color,
          isPublic: squadBeforeAdd.isPublic,
          membersCanInvite: squadBeforeAdd.membersCanInvite,
          memberIds: newMemberIds,
        });
      }
    }
    return undefined;
  };

  const authHeaders = useCallback((): Record<string, string> => ({
    "Content-Type": "application/json",
    ...buildAuthHeaders(authToken),
  }), [authToken]);

  // Fetch enriched member list on focus and seed the user cache so names/avatars
  // appear immediately without waiting for the separate batch-fetch.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      type EnrichedMember = { id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null; isPro?: boolean };
      fetch(`${API_BASE}/api/squads/${id}`, { headers: authHeaders() })
        .then((r) => (r.ok ? (r.json() as Promise<{ members?: EnrichedMember[] }>) : null))
        .catch(() => null)
        .then((data) => {
          if (!active || !data?.members) return;
          data.members.forEach((m) => {
            const firstName = m.firstName ?? "";
            const lastName = m.lastName ?? "";
            const name = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
            const initials =
              firstName && lastName
                ? `${firstName[0]}${lastName[0]}`.toUpperCase()
                : firstName
                ? firstName.slice(0, 2).toUpperCase()
                : "U?";
            let hash = 0;
            for (const c of m.id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
            const COLORS = ["#FF5C3A","#A855F7","#2ECC8A","#FFB547","#4A9EFF","#E91E8C","#00BCD4","#FF9800","#8BC34A","#9C27B0"];
            const color = COLORS[Math.abs(hash) % COLORS.length];
            seedUser({ id: m.id, name, initials, color: color ?? "#FF5C3A", profileImageUrl: m.profileImageUrl ?? null, isPro: m.isPro ?? false });
          });
        });
      return () => { active = false; };
    }, [id, authHeaders, seedUser])
  );

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

  const playConflictBanner = useCallback(() => {
    conflictBannerAnim.stopAnimation();
    Animated.sequence([
      Animated.timing(conflictBannerAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.delay(2500),
      Animated.timing(conflictBannerAnim, { toValue: 0, duration: 350, useNativeDriver: false }),
    ]).start();
  }, [conflictBannerAnim]);

  useEffect(() => {
    if (!id || conflictSquadId !== id) return;
    clearConflictSquad();
    playConflictBanner();
  }, [conflictSquadId, id, clearConflictSquad, playConflictBanner]);

  // ── Real-time squad updates via global SSE ───────────────────────────────
  // AppContext opens a single SSE connection to /api/squads/stream that covers
  // all of the user's squads. When a remote mutation arrives, AppContext calls
  // refreshSquads() which updates the squads array in state. This effect
  // watches the version field of this squad and plays the "Refreshed" banner
  // whenever it changes — no screen-scoped SSE connection needed.
  const currentSquadVersion = getSquad(id ?? "")?.version;
  const prevSquadVersionRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (prevSquadVersionRef.current === undefined) {
      prevSquadVersionRef.current = currentSquadVersion;
      return;
    }
    if (currentSquadVersion !== prevSquadVersionRef.current) {
      prevSquadVersionRef.current = currentSquadVersion;
      playConflictBanner();
    }
  }, [currentSquadVersion, playConflictBanner]);

  // ── 60 s safety-net poll ─────────────────────────────────────────────────
  // Catches any update that arrives while the SSE connection is temporarily
  // down (e.g. brief network drop, proxy timeout between heartbeats).
  const lastSquadSigRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;

      const poll = () =>
        runSquadPoll({
          id,
          apiBase: API_BASE,
          getHeaders: authHeaders,
          getLastSig: () => lastSquadSigRef.current,
          setLastSig: (sig) => { lastSquadSigRef.current = sig; },
          isActive: () => active,
          refreshSquads,
          onChanged: playConflictBanner,
        });

      void poll();
      const interval = setInterval(() => void poll(), 60000);
      return () => {
        active = false;
        clearInterval(interval);
        lastSquadSigRef.current = null;
      };
    }, [id, authHeaders, refreshSquads, playConflictBanner])
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

  const squad = getSquad(id ?? "");

  // Pre-load member profiles
  useEffect(() => {
    if (squad) prefetchUsers(squad.memberIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squad?.id]);

  const { mutedSquadIds, setSquadMuted } = useMutedSquads();

  // First-run welcome tips tour (anchored coach marks).
  const { activeIndex, tips, setSquadAnchor, clearSquadAnchors, maybeStartTour } = useTips();
  const scrollRef = useRef<ScrollView>(null);
  const eventsAnchorRef = useRef<View>(null);
  const pollAnchorRef = useRef<View>(null);
  const chatAnchorRef = useRef<View>(null);
  const eventsContentY = useRef(0);
  const pollContentY = useRef(0);
  const chatContentY = useRef(0);

  // Start the tour once the squad has loaded (no-op unless armed at onboarding
  // and not yet seen by this user).
  useEffect(() => {
    if (squad) maybeStartTour();
  }, [squad, maybeStartTour]);

  // When a squad-screen tip activates, scroll its target into view and measure
  // it so the floating card can anchor against it.
  useEffect(() => {
    if (activeIndex === null) return;
    const tip = tips[activeIndex];
    if (!tip || tip.place !== "squad" || !tip.target) return;
    const target = tip.target;
    const contentY =
      target === "events"
        ? eventsContentY.current
        : target === "poll"
          ? pollContentY.current
          : chatContentY.current;
    const anchorRef =
      target === "events" ? eventsAnchorRef : target === "poll" ? pollAnchorRef : chatAnchorRef;
    scrollRef.current?.scrollTo({ y: Math.max(0, contentY - 140), animated: true });
    const t = setTimeout(() => {
      anchorRef.current?.measureInWindow((x, y, width, height) => {
        setSquadAnchor(target, { x, y, width, height });
      });
    }, 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  // Drop stale anchors when leaving the screen.
  useEffect(() => {
    return () => clearSquadAnchors();
  }, [clearSquadAnchors]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editEmoji, setEditEmoji] = useState("🔥");
  const [muted, setMuted] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [newInviteCode, setNewInviteCode] = useState<string | null>(null);
  const newInviteDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (mid === currentUser.id) {
      return {
        id: currentUser.id,
        name: currentUser.name,
        initials: currentUser.initials,
        color: currentUser.color,
        profileImageUrl: currentUser.profileImageUrl ?? null,
        isPro: resolveUser(currentUser.id).isPro,
      };
    }
    return resolveUser(mid);
  });
  const squadEvents = events.filter((e) => e.squadId === squad.id);

  const creatorId = squad.creatorId ?? squad.memberIds[0] ?? null;
  const isCreator = currentUser.id === creatorId;

  // Co-admins: any member (except the creator) can be promoted. Only the creator
  // manages this list. Co-admins can edit details, manage members, and the link.
  const squadCoAdminIds = squad.coAdminIds ?? [];
  const squadCoAdmins = squadCoAdminIds.map((uid) => resolveUser(uid));
  const squadCoAdminCandidates = squad.memberIds
    .filter((uid) => uid !== creatorId && !squadCoAdminIds.includes(uid))
    .map((uid) => resolveUser(uid));

  const handleRemoveMember = (memberId: string, memberName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(`Remove ${memberName}`, `Remove ${memberName} from "${squad.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setRemovingMemberId(memberId);
          const result = await removeMember(squad.id, memberId);
          setRemovingMemberId(null);
          if (result.error) Alert.alert("Error", result.error);
          else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Pre-seed the poll baseline so the next tick doesn't mistake our own
            // optimistic member removal for a remote change and fire a spurious banner.
            lastSquadSigRef.current = squadSignature({
              name: squad.name,
              emoji: squad.emoji,
              description: squad.description ?? null,
              color: squad.color,
              isPublic: squad.isPublic,
              membersCanInvite: squad.membersCanInvite,
              memberIds: squad.memberIds.filter((mid) => mid !== memberId),
            });
          }
        },
      },
    ]);
  };

  const handleLeaveSquad = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const isLastMember = squad.memberIds.length <= 1;
    const leaveMessage = isCreator
      ? isLastMember
        ? `You're the organizer and the only member. Leaving "${squad.name}" will delete it permanently.`
        : `You're the organizer of "${squad.name}". Leaving will transfer ownership to the longest-standing member, and you'll need a new invite to rejoin.`
      : `Leave "${squad.name}"? You'll need a new invite to rejoin.`;
    Alert.alert("Leave squad", leaveMessage, [
      { text: "Stay", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          setRemovingMemberId(currentUser.id);
          const result = await removeMember(squad.id, currentUser.id);
          setRemovingMemberId(null);
          if (result.error) Alert.alert("Error", result.error);
          else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Pre-seed the poll baseline so the next tick doesn't mistake our own
            // optimistic leave for a remote change and fire a spurious banner.
            lastSquadSigRef.current = squadSignature({
              name: squad.name,
              emoji: squad.emoji,
              description: squad.description ?? null,
              color: squad.color,
              isPublic: squad.isPublic,
              membersCanInvite: squad.membersCanInvite,
              memberIds: squad.memberIds.filter((mid) => mid !== currentUser.id),
            });
            goBack();
          }
        },
      },
    ]);
  };
  const inviteCode = squad.inviteCode ?? null;
  const inviteLink = inviteCode ? `https://joinsquadz.com/squad/join?code=${inviteCode}` : `https://joinsquadz.com/squad/${squad.id}`;

  const shareInvite = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({
      message: inviteCode
        ? `Join my squad "${squad.emoji} ${squad.name}" on SquadZ!\n\nUse invite code: ${inviteCode}\n${inviteLink}`
        : `Join my squad "${squad.emoji} ${squad.name}" on SquadZ! ${inviteLink}`,
    });
  };

  const publicLink = `https://joinsquadz.com/squad/join-public?id=${squad.id}`;
  const sharePublicLink = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({
      message: `Join "${squad.emoji} ${squad.name}" on SquadZ — anyone can join!\n${publicLink}`,
    });
  };

  const openSettings = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditName(squad.name);
    setEditDescription(squad.description ?? "");
    setEditEmoji(squad.emoji);
    // Seed local switch state from the shared context (no network round-trip needed)
    setMuted(mutedSquadIds.has(squad.id));
    setSettingsOpen(true);
  };

  const toggleMute = async (value: boolean) => {
    setMuteLoading(true);
    setMuted(value);
    // Optimistically update the shared context so the squads list badge
    // reflects the change immediately, regardless of navigation path.
    setSquadMuted(squad.id, value);
    try {
      await fetch(`${API_BASE}/api/squads/${squad.id}/mute`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ muted: value }),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Roll back both the local and shared state on failure
      setMuted(!value);
      setSquadMuted(squad.id, !value);
    } finally {
      setMuteLoading(false);
    }
  };

  const saveSettings = () => {
    if (!editName.trim()) {
      Alert.alert("Missing info", "Squad needs a name.");
      return;
    }
    const name = editName.trim();
    const desc = editDescription.trim();
    updateSquad(squad.id, { name, description: desc || null, emoji: editEmoji });
    // Pre-seed the poll baseline so the next tick doesn't mistake our own
    // optimistic write for a remote change and show a spurious "Refreshed" banner.
    lastSquadSigRef.current = squadSignature({
      name,
      emoji: editEmoji,
      description: desc || null,
      color: squad.color,
      isPublic: squad.isPublic,
      membersCanInvite: squad.membersCanInvite,
      memberIds: squad.memberIds,
    });
    setSettingsOpen(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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

      {/* Stream reconnecting indicator */}
      {showReconnecting && (
        <View style={styles.reconnectBanner} pointerEvents="none">
          <ActivityIndicator size="small" color="#6B7280" style={{ marginRight: 6 }} />
          <Text style={styles.reconnectBannerText}>Reconnecting…</Text>
        </View>
      )}
      {streamStatus === "error" && (
        <TouchableOpacity
          style={styles.reconnectBanner}
          onPress={retryStream}
          activeOpacity={0.7}
        >
          <Ionicons name="cloud-offline-outline" size={14} color="#6B7280" style={{ marginRight: 6 }} />
          <Text style={styles.reconnectBannerText}>Live updates unavailable · Tap to retry</Text>
        </TouchableOpacity>
      )}

      {/* Conflict refresh banner */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.conflictBanner,
          {
            height: conflictBannerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 40] }),
            opacity: conflictBannerAnim,
          },
        ]}
      >
        <Text style={styles.conflictBannerText}>↻ Refreshed — showing latest version</Text>
      </Animated.View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 20, paddingBottom: botPad + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Ambient Squadz+ benefit nudge for free members */}
        <SquadzPlusBanner
          trigger="squad_limit"
          message="Squadz+ — unlimited squads, permanent vault & more"
          style={{ marginTop: 12 }}
        />

        {/* Find the best time — primary action, surfaced near the top */}
        <View
          ref={pollAnchorRef}
          collapsable={false}
          onLayout={(e) => {
            pollContentY.current = e.nativeEvent.layout.y;
          }}
          style={{ marginTop: 12 }}
        >
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setFindTimeOpen(true);
          }}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={[squad.color, squad.color + "CC"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.findTimeCta}
          >
            <View style={styles.findTimeIcon}>
              <Ionicons name="sparkles" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.findTimeTitle}>{availabilityTitle ?? "Find the Best Time"}</Text>
              <Text style={styles.findTimeSub}>Poll the squad · pick a time everyone's free</Text>
            </View>
            {newResponseCount > 0 ? (
              <View style={styles.findTimeBadge}>
                <Text style={styles.findTimeBadgeText}>{newResponseCount}</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#fff" />
            )}
          </LinearGradient>
        </TouchableOpacity>
        {availabilityTitle !== null && (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: "/availability", params: { squadId: squad.id, from: "create" } } as never);
            }}
            style={styles.newPollLink}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={14} color={colors.mutedForeground} />
            <Text style={[styles.newPollLinkText, { color: colors.mutedForeground }]}>Start a new poll</Text>
          </TouchableOpacity>
        )}
        </View>

        {/* Members — horizontal avatar row */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 24 }]}>Members</Text>
        {showLongPressHint && (
          <Animated.View style={[styles.longPressHint, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "35", opacity: hintOpacity }]}>
            <Ionicons name="hand-left-outline" size={14} color={colors.primary} />
            <Text style={[styles.longPressHintText, { color: colors.primary }]}>Long-press a member to remove</Text>
          </Animated.View>
        )}
        <View style={styles.membersRow}>
          {members.map((m) => {
            const isSelf = m.id === currentUser.id;
            const showRemoveBtn = isCreator && !isSelf && m.id !== creatorId;
            const isBeingRemoved = removingMemberId === m.id;
            return (
              <View key={m.id} style={{ position: "relative", alignItems: "center" }}>
                <TouchableOpacity
                  onPress={!isSelf ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/user/${m.id}` as never); } : undefined}
                  onLongPress={isSelf && !isCreator ? handleLeaveSquad : undefined}
                  delayLongPress={400}
                  style={styles.memberAvatar}
                  activeOpacity={isSelf ? 1 : 0.7}
                >
                  {isBeingRemoved ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ height: 44, width: 44 }} />
                  ) : (
                    <ProAvatar initials={m.initials} color={m.color} imageUrl={m.profileImageUrl} size={44} fontSize={15} isPro={m.isPro} />
                  )}
                </TouchableOpacity>
                <Text style={[styles.memberAvatarName, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {m.id === currentUser.id ? "You" : m.name.split(" ")[0]}
                </Text>
                {showRemoveBtn && (
                  <TouchableOpacity
                    onPress={() => handleRemoveMember(m.id, m.name.split(" ")[0])}
                    style={[styles.removeMemberBtn, { backgroundColor: colors.destructive }]}
                    hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                  >
                    <Ionicons name="close" size={10} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          {(isCreator || (squad.membersCanInvite ?? false)) && (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                resetAddMemberModal();
                setAddMemberOpen(true);
              }}
              style={{ alignItems: "center" }}
            >
              <View style={[styles.memberAddCircle, { borderColor: colors.border }]}>
                <Ionicons name="add" size={20} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.memberAvatarName, { color: colors.mutedForeground }]}>Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Group chat + Vault — grouped card */}
        <View
          ref={chatAnchorRef}
          collapsable={false}
          onLayout={(e) => {
            chatContentY.current = e.nativeEvent.layout.y;
          }}
          style={{ marginTop: 20 }}
        >
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>Squad</Text>
          <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => handleOpenChat(squad.id)}
              disabled={openingChat}
              activeOpacity={0.7}
              style={styles.groupRow}
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
            <View style={[styles.groupDivider, { backgroundColor: colors.border }]} />
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/vault?squadId=${squad.id}&squadName=${encodeURIComponent(squad.name)}` as never);
              }}
              activeOpacity={0.7}
              style={styles.groupRow}
            >
              <View style={[styles.photosIcon, { backgroundColor: colors.primary + "20" }]}>
                <Ionicons name="images-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.photosTitle, { color: colors.foreground }]}>Squad Vault</Text>
                <Text style={[styles.photosSub, { color: colors.mutedForeground }]}>View vault · private memories</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </TouchableOpacity>
            <View style={[styles.groupDivider, { backgroundColor: colors.border }]} />
            <TouchableOpacity
              onPress={shareInvite}
              activeOpacity={0.7}
              style={styles.groupRow}
            >
              <View style={[styles.photosIcon, { backgroundColor: colors.primary + "20" }]}>
                <Ionicons name="person-add-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.photosTitle, { color: colors.foreground }]}>Invite friends</Text>
                <Text style={[styles.photosSub, { color: colors.mutedForeground }]}>Share a link to add them</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </TouchableOpacity>
            {squad.isPublic && (
              <>
                <View style={[styles.groupDivider, { backgroundColor: colors.border }]} />
                <TouchableOpacity
                  onPress={sharePublicLink}
                  activeOpacity={0.7}
                  style={styles.groupRow}
                >
                  <View style={[styles.photosIcon, { backgroundColor: colors.primary + "20" }]}>
                    <Ionicons name="globe-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.photosTitle, { color: colors.foreground }]}>Share publicly</Text>
                    <Text style={[styles.photosSub, { color: colors.mutedForeground }]}>Anyone with the link can join</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Events */}
        <View
          ref={eventsAnchorRef}
          collapsable={false}
          onLayout={(e) => {
            eventsContentY.current = e.nativeEvent.layout.y;
          }}
          style={{ marginTop: 24 }}
        >
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Plans</Text>
        </View>
        {squadEvents.length === 0 ? (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push({ pathname: "/create", params: { prefillSquad: squad.id } } as never);
            }}
            activeOpacity={0.9}
            style={{ marginTop: 4 }}
          >
            <LinearGradient
              colors={[squad.color, squad.color + "CC"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.findTimeCta}
            >
              <View style={styles.findTimeIcon}>
                <Ionicons name="add" size={24} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.findTimeTitle}>Plan together</Text>
                <Text style={styles.findTimeSub}>No plans yet · start an event or a trip</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          squadEvents.map((e) =>
            e.type === "trip" ? (
              <TripCard key={e.id} trip={e} />
            ) : (
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
            ),
          )
        )}
      </ScrollView>

      <FindTimeChooser
        visible={findTimeOpen}
        scope={{ type: "squad", squadId: squad.id }}
        onClose={() => setFindTimeOpen(false)}
        onStartNew={() =>
          router.push({ pathname: "/availability", params: { squadId: squad.id, from: "create" } } as never)
        }
      />

      {/* ---- Member Profile Sheet ---- */}
      <ContactSheet
        visible={memberProfileOpen}
        member={profileMember}
        onClose={() => setMemberProfileOpen(false)}
      />

      {/* ---- Add Member Modal ---- */}
      <Modal
        visible={addMemberOpen}
        transparent
        animationType="slide"
        onRequestClose={() => { setAddMemberOpen(false); resetAddMemberModal(); }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.modalCard, styles.addMemberCard, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            {/* Persistent close (X) — left side, always visible above scrolling content */}
            <TouchableOpacity
              onPress={() => { setAddMemberOpen(false); resetAddMemberModal(); }}
              style={[styles.modalCloseBtn, { backgroundColor: colors.card }]}
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={colors.foreground} />
            </TouchableOpacity>

            <Text style={[styles.modalTitle, styles.addMemberTitle, { color: colors.foreground }]}>Add members</Text>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Search by name</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              <TextInput
                placeholder="Type a name…"
                placeholderTextColor={colors.textDim}
                value={nameQuery}
                onChangeText={(t) => {
                  setNameQuery(t);
                  setSearchError(null);
                  if (!t.trim()) setSearchResults([]);
                }}
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => { void handleSearch(); }}
                style={[styles.modalInput, { flex: 1, marginBottom: 0, backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              <TouchableOpacity
                onPress={() => { void handleSearch(); }}
                disabled={searchLoading || nameQuery.trim().length < 2}
                style={[styles.searchBtn, { backgroundColor: colors.primary, opacity: (nameQuery.trim().length < 2 || searchLoading) ? 0.5 : 1 }]}
              >
                {searchLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="search-outline" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>

            {searchError && (
              <View style={[styles.lookupError, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "40" }]}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
                <Text style={[styles.lookupErrorText, { color: colors.destructive }]}>{searchError}</Text>
              </View>
            )}

            {searchResults.length > 0 && (
              <ScrollView style={styles.addMemberResults} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {searchResults.map((user) => {
                  const alreadyMember = squad.memberIds.includes(user.id);
                  const isSelected = selectedToAdd.has(user.id);
                  const isAdding = addingUserId === user.id;
                  return (
                    <TouchableOpacity
                      key={user.id}
                      onPress={() => { if (!alreadyMember) toggleSelectToAdd(user); }}
                      disabled={alreadyMember || confirmingAdd}
                      style={[
                        styles.foundUserCard,
                        {
                          backgroundColor: isSelected ? colors.primary + "12" : colors.card,
                          borderColor: isSelected ? colors.primary : alreadyMember ? colors.border : colors.border,
                          opacity: alreadyMember ? 0.5 : 1,
                        },
                      ]}
                    >
                      <UserAvatar
                        initials={getFriendCodeInitials(user)}
                        color="#A855F7"
                        imageUrl={user.profileImageUrl}
                        size={40}
                        fontSize={14}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.foundUserName, { color: colors.foreground }]}>{getFriendCodeDisplayName(user)}</Text>
                        {user.friendCode && (
                          <Text style={[styles.foundUserCode, { color: colors.mutedForeground }]}>{user.friendCode}</Text>
                        )}
                      </View>
                      {alreadyMember ? (
                        <Text style={[styles.foundUserCode, { color: colors.mutedForeground }]}>In squad</Text>
                      ) : isAdding ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <View style={[
                          styles.addResultBtn,
                          {
                            backgroundColor: isSelected ? colors.primary : "transparent",
                            borderWidth: 1.5,
                            borderColor: isSelected ? colors.primary : colors.border,
                          },
                        ]}>
                          <Ionicons
                            name={isSelected ? "checkmark" : "add"}
                            size={16}
                            color={isSelected ? "#fff" : colors.foreground}
                          />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {selectedToAdd.size > 0 && (
              <TouchableOpacity
                onPress={() => { void handleConfirmAddSelected(); }}
                disabled={confirmingAdd}
                style={[styles.modalBtn, { backgroundColor: colors.primary, marginTop: 16 }]}
              >
                {confirmingAdd ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff" }]}>
                    Add {selectedToAdd.size} {selectedToAdd.size === 1 ? "member" : "members"}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => { setAddMemberOpen(false); resetAddMemberModal(); }}
              style={[styles.modalBtn, { backgroundColor: selectedToAdd.size > 0 ? "transparent" : colors.primary, borderWidth: selectedToAdd.size > 0 ? 1 : 0, borderColor: colors.border, marginTop: selectedToAdd.size > 0 ? 8 : 16 }]}
            >
              <Text style={[styles.modalBtnText, { color: selectedToAdd.size > 0 ? colors.foreground : "#fff" }]}>
                {selectedToAdd.size > 0 ? "Cancel" : "Done"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---- Settings Modal ---- */}
      <Modal
        visible={settingsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setSettingsOpen(false);
          setNewInviteCode(null);
          if (newInviteDismissTimer.current) clearTimeout(newInviteDismissTimer.current);
        }}
      >
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

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>About this squad</Text>
            <TextInput
              placeholder="What's this squad about? (optional)"
              placeholderTextColor={colors.textDim}
              value={editDescription}
              onChangeText={(t) => t.length <= 280 && setEditDescription(t)}
              style={[styles.modalInput, styles.modalTextArea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              multiline
              maxLength={280}
            />

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Icon</Text>
            <IconPicker value={editEmoji} onChange={setEditEmoji} />

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

            {isCreator && (
              <View style={[styles.actionRow, { borderColor: colors.border }]}>
                <Ionicons name="person-add-outline" size={20} color={colors.foreground} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionText, { color: colors.foreground }]}>Members can invite others</Text>
                  <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>
                    {squad.membersCanInvite ? "All members can add people to this squad" : "Only you can add people to this squad"}
                  </Text>
                </View>
                <Switch
                  value={squad.membersCanInvite ?? false}
                  onValueChange={(v) => {
                    updateSquad(squad.id, { membersCanInvite: v });
                    lastSquadSigRef.current = squadSignature({ ...squad, membersCanInvite: v });
                  }}
                  trackColor={{ false: colors.border, true: colors.primary + "80" }}
                  thumbColor={squad.membersCanInvite ? colors.primary : colors.mutedForeground}
                />
              </View>
            )}

            {isCreator && (
              <View style={[styles.coAdminCard, { borderColor: colors.border }]}>
                <Text style={[styles.actionText, { color: colors.foreground }]}>Co-admins</Text>
                <Text style={[styles.actionSub, { color: colors.mutedForeground, marginBottom: 6 }]}>
                  Co-admins can edit details, manage members, and the invite link. Only you can delete the squad or change co-admins.
                </Text>
                {squadCoAdmins.map((u) => (
                  <View key={u.id} style={[styles.coAdminRow, { borderColor: colors.border }]}>
                    <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={30} />
                    <Text style={[styles.coAdminName, { color: colors.foreground }]} numberOfLines={1}>{u.name}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.selectionAsync();
                        void removeSquadCoAdmin(squad.id, u.id).then((r) => {
                          if (r.error) Alert.alert("Couldn't update", r.error);
                          else void refreshSquads();
                        });
                      }}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                ))}
                {squadCoAdminCandidates.length === 0 ? (
                  <Text style={[styles.actionSub, { color: colors.mutedForeground, marginTop: 6 }]}>
                    Add more members to the squad — then you can make them co-admins.
                  </Text>
                ) : (
                  squadCoAdminCandidates.map((u) => (
                    <TouchableOpacity
                      key={u.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        void addSquadCoAdmin(squad.id, u.id).then((r) => {
                          if (r.error) Alert.alert("Couldn't update", r.error);
                          else void refreshSquads();
                        });
                      }}
                      activeOpacity={0.8}
                      style={[styles.coAdminRow, { borderColor: colors.border }]}
                    >
                      <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={30} />
                      <Text style={[styles.coAdminName, { color: colors.foreground }]} numberOfLines={1}>{u.name}</Text>
                      <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}

            {isCreator && (
              <View style={[styles.actionRow, { borderColor: colors.border }]}>
                <Ionicons name="globe-outline" size={20} color={colors.foreground} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionText, { color: colors.foreground }]}>Public squad</Text>
                  <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>
                    {squad.isPublic ? "Visible on Discover — friends can join directly" : "Only joinable via invite link"}
                  </Text>
                </View>
                <Switch
                  value={squad.isPublic ?? false}
                  onValueChange={(v) => {
                    updateSquad(squad.id, { isPublic: v });
                    lastSquadSigRef.current = squadSignature({ ...squad, isPublic: v });
                  }}
                  trackColor={{ false: colors.border, true: colors.primary + "80" }}
                  thumbColor={squad.isPublic ? colors.primary : colors.mutedForeground}
                />
              </View>
            )}

            <TouchableOpacity onPress={shareInvite} style={[styles.actionRow, { borderColor: colors.border }]}>
              <Ionicons name="share-social-outline" size={20} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.foreground }]}>Share invite link</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>

            {isCreator && (
              <TouchableOpacity
                onPress={async () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  Alert.alert(
                    "Regenerate invite link?",
                    "The old link will stop working immediately. Anyone who hasn't joined yet will need the new link.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Regenerate",
                        style: "destructive",
                        onPress: async () => {
                          setRegenerating(true);
                          const result = await regenerateInviteCode(squad.id);
                          setRegenerating(false);
                          if (result.error) {
                            Alert.alert("Error", result.error);
                          } else {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            const freshCode = result.inviteCode ?? squad.inviteCode ?? null;
                            setNewInviteCode(freshCode);
                            if (newInviteDismissTimer.current) clearTimeout(newInviteDismissTimer.current);
                            newInviteDismissTimer.current = setTimeout(() => setNewInviteCode(null), 6000);
                            // Pre-seed the poll baseline so the next tick doesn't
                            // mistake our own invite-code regeneration for a remote
                            // change and show a spurious "Refreshed" banner.
                            lastSquadSigRef.current = squadSignature({
                              name: squad.name,
                              emoji: squad.emoji,
                              description: squad.description,
                              color: squad.color,
                              isPublic: squad.isPublic,
                              membersCanInvite: squad.membersCanInvite,
                              memberIds: squad.memberIds,
                            });
                          }
                        },
                      },
                    ],
                  );
                }}
                disabled={regenerating}
                style={[styles.actionRow, { borderColor: colors.border, opacity: regenerating ? 0.6 : 1 }]}
              >
                {regenerating ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <Ionicons name="refresh-outline" size={20} color={colors.destructive} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionText, { color: colors.destructive }]}>Regenerate invite link</Text>
                  <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>Revoke the current link and create a new one</Text>
                </View>
              </TouchableOpacity>
            )}

            {newInviteCode && (
              <View style={[styles.newLinkRow, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "35" }]}>
                <View style={[styles.newLinkIconWrap, { backgroundColor: colors.primary + "20" }]}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.newLinkLabel, { color: colors.primary }]}>New link ready</Text>
                  <Text style={[styles.newLinkCode, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {`joinsquadz.com/squad/join?code=${newInviteCode}`}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    Share.share({
                      message: `Join my squad "${squad.emoji} ${squad.name}" on SquadZ!\n\nUse invite code: ${newInviteCode}\nhttps://joinsquadz.com/squad/join?code=${newInviteCode}`,
                    });
                  }}
                  style={[styles.shareNowBtn, { backgroundColor: colors.primary }]}
                >
                  <Ionicons name="share-social-outline" size={14} color="#fff" />
                  <Text style={styles.shareNowBtnText}>Share now</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity onPress={() => { setSettingsOpen(false); handleLeaveSquad(); }} style={[styles.actionRow, { borderColor: colors.border }]}>
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
  sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  sectionLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  groupCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  groupDivider: { height: 1 },
  membersRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  memberAvatar: { alignItems: "center", paddingVertical: 4, paddingHorizontal: 6 },
  memberAvatarName: { fontSize: 11, fontWeight: "600", textAlign: "center", marginTop: 5, maxWidth: 56 },
  memberAddCircle: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  removeMemberBtn: { position: "absolute", top: -2, right: 2, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", zIndex: 10 },
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
  addMemberCard: { maxHeight: "82%", flexShrink: 1 },
  addMemberTitle: { textAlign: "center", paddingHorizontal: 44 },
  addMemberResults: { flexShrink: 1, flexGrow: 0 },
  modalCloseBtn: { position: "absolute", top: 14, left: 14, zIndex: 10, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  modalTitle: { fontSize: 20, fontWeight: "800", marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },
  modalInput: { borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, height: 50, fontSize: 15, marginBottom: 12 },
  modalTextArea: { height: undefined, minHeight: 76, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top" },
  emojiOption: { width: 48, height: 48, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 13, borderWidth: 1, padding: 14, marginTop: 12 },
  actionText: { fontSize: 15, fontWeight: "600" },
  actionSub: { fontSize: 12, marginTop: 2 },
  coAdminCard: { borderRadius: 13, borderWidth: 1, padding: 14, marginTop: 12 },
  coAdminRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingVertical: 10 },
  coAdminName: { flex: 1, fontSize: 15, fontWeight: "600" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 20 },
  modalBtn: { flex: 1, borderRadius: 13, padding: 14, alignItems: "center" },
  modalBtnText: { fontSize: 15, fontWeight: "800" },
  searchBtn: { width: 50, height: 50, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  lookupError: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 4 },
  lookupErrorText: { fontSize: 13, fontWeight: "600", flex: 1 },
  foundUserCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1.5, padding: 12, marginBottom: 8 },
  foundUserName: { fontSize: 14, fontWeight: "800" },
  foundUserCode: { fontSize: 12, marginTop: 2 },
  addResultBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  addResultBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  findTimeCta: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 16 },
  findTimeIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  findTimeTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  findTimeSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
  findTimeBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
  findTimeBadgeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  newPollLink: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end", marginTop: 6, paddingVertical: 2, paddingHorizontal: 4 },
  newPollLinkText: { fontSize: 12, fontWeight: "600" },
  longPressHint: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 11, marginBottom: 10, alignSelf: "flex-start" },
  longPressHintText: { fontSize: 12, fontWeight: "600" },
  newLinkRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 13, borderWidth: 1, padding: 12, marginTop: 12 },
  newLinkIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  newLinkLabel: { fontSize: 13, fontWeight: "700" },
  newLinkCode: { fontSize: 11, marginTop: 2 },
  shareNowBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  shareNowBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  profileFriendCode: { fontSize: 13, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginTop: 4, overflow: "hidden" },
  reconnectBanner: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 6, backgroundColor: "#6B728012" },
  reconnectBannerText: { fontSize: 12, fontWeight: "600", color: "#6B7280", letterSpacing: 0.2 },
  conflictBanner: { overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#F59E0B18" },
  conflictBannerText: { fontSize: 12, fontWeight: "700", color: "#B45309", letterSpacing: 0.2 },
});
