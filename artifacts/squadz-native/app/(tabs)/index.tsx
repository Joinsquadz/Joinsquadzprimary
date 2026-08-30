import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Platform,
  Share,
  Modal,
  Alert,
  RefreshControl,
  Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData, SquadLimitError } from "@/context/AppContext";
import { UpgradeModal } from "@/components/UpgradeModal";
import { EventCard } from "@/components/EventCard";
import { TripCard } from "@/components/TripCard";
import { SkeletonBox } from "@/components/SkeletonBox";
import { goingCount, attendingIds } from "@/lib/eventUtils";
import { useUserCache } from "@/context/UserCacheContext";
import type { ResolvedUser } from "@/context/UserCacheContext";
import { useActivity } from "@/context/ActivityContext";
import { ProAvatar } from "@/components/ProAvatar";
import { UserAvatar } from "@/components/UserAvatar";
import { GradientButton } from "@/components/GradientButton";
import { LiveStatusBanner } from "@/components/LiveStatusBanner";
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { claimOnce } from "@/lib/seenFlags";
import { API_BASE } from "@/lib/api";
import { STOP_VOTING_ENABLED } from "@/lib/tripApi";
import { useToast } from "@/context/ToastContext";
import { useTimezone } from "@/context/TimezoneContext";
import { todayKey } from "@/lib/tripUtils";

/** Open the platform maps app pointed at a freeform location string. */
function openMaps(location: string) {
  const q = encodeURIComponent(location);
  const url =
    Platform.OS === "ios"
      ? `http://maps.apple.com/?q=${q}`
      : Platform.OS === "android"
        ? `geo:0,0?q=${q}`
        : `https://www.google.com/maps/search/?api=1&query=${q}`;
  Linking.openURL(url).catch(() => {});
}

type DiscoverEvent = { id: string; emoji: string; title: string; date: string; inviteCode: string };
type DiscoverSquad = { id: string; emoji: string; name: string; color: string; memberIds: string[] };

type SuggestionAction =
  | { kind: "create-squad" }
  | { kind: "create-event"; squadId?: string; squadName?: string; prefillTitle?: string; prefillEmoji?: string }
  | { kind: "open-event"; eventId: string };

type Suggestion = {
  id: string;
  emoji: string;
  title: string;
  why: string;
  type: string;
  action: SuggestionAction;
};

const SUGGESTION_COLORS: Record<string, string> = {
  Plan: "#A855F7",
  RSVP: "#FF6B2C",
  Squad: "#22C55E",
};
const suggestionColor = (type: string) => SUGGESTION_COLORS[type] ?? "#A855F7";

// Web-only clipboard copy via a hidden textarea + execCommand("copy"). This is
// the one copy path that works inside the cross-origin preview iframe (where
// navigator.clipboard.writeText is blocked). No-op/false on native.
function webCopy(text: string): boolean {
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, authToken, apiFetch } = useAuth();
  const { unreadCount: unreadActivity } = useActivity();
  const { events, squads, friends, eventsLoading, squadsLoading, joinEvent, joinSquad, friendCode, refreshEvents, refreshSquads } = useData();
  const { showToast } = useToast();
  const { formatEventTime } = useTimezone();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshEvents(), refreshSquads()]);
    } finally {
      // A rejected refresh must never leave the native RefreshControl spinning
      // forever. The individual loaders retain the last good data on failure.
      setRefreshing(false);
    }
  }, [refreshEvents, refreshSquads]);
  const [discoverEvents, setDiscoverEvents] = useState<DiscoverEvent[]>([]);
  const [discoverSquads, setDiscoverSquads] = useState<DiscoverSquad[]>([]);
  const [streaks, setStreaks] = useState<{ monthlyPlan: number; stayInTouch: number } | null>(null);
  const [streakCelebration, setStreakCelebration] = useState<
    { emoji: string; title: string; subtitle: string } | null
  >(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [fabOpen, setFabOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<
    "find-time" | "find-time-kind" | "invite" | "invite-choose" | "invite-link" | null
  >(null);
  // After "Find a time", the user first picks Event vs Trip. We remember which
  // target they tapped (a brand-new ad-hoc plan, or a specific squad) so the
  // kind choice can route into the right flow. Events are day + time-slot
  // focused; trips are date-range focused.
  const [kindTarget, setKindTarget] = useState<
    { type: "newplan" } | { type: "squad"; squadId: string } | null
  >(null);
  const [planKind, setPlanKind] = useState<"event" | "trip">("event");
  // The actual invite message + link to reveal, so the user can always read,
  // select, copy, or share it — even in the web preview where the native Share
  // sheet and clipboard API are blocked by the cross-origin iframe.
  const [inviteReveal, setInviteReveal] = useState<{ title: string; message: string } | null>(null);
  // Ad-hoc "new plan" participant picker (T3): choose exactly who's planning.
  const [participantSheetOpen, setParticipantSheetOpen] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [upgradeVisible, setUpgradeVisible] = useState(false);

  useEffect(() => {
    if (!authToken) return;
    apiFetch("/api/streaks")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { monthlyPlan: number; stayInTouch: number } | null) => {
        if (!data) return;
        setStreaks(data);
        // B5: celebrate a streak milestone full-screen, once per value reached.
        void (async () => {
          if (data.monthlyPlan >= 2 && (await claimOnce(`streakmonthly_${data.monthlyPlan}`, currentUser.id))) {
            setStreakCelebration({
              emoji: "🔥",
              title: `${data.monthlyPlan}-month streak!`,
              subtitle: "You've planned something with your squad every month. Keep the fire going!",
            });
          } else if (
            data.stayInTouch >= 2 &&
            (await claimOnce(`streaktouch_${data.stayInTouch}`, currentUser.id))
          ) {
            setStreakCelebration({
              emoji: "💬",
              title: `${data.stayInTouch}-week streak!`,
              subtitle: "You've stayed in touch with your crew week after week. Nice work!",
            });
          }
        })();
      })
      .catch(() => {});
  }, [authToken, currentUser.id, apiFetch]);

  useEffect(() => {
    if (!authToken) return;
    apiFetch("/api/discover")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { events?: DiscoverEvent[]; squads?: DiscoverSquad[] } | null) => {
        if (data) {
          setDiscoverEvents(data.events ?? []);
          setDiscoverSquads(data.squads ?? []);
        }
      })
      .catch(() => {});
  }, [authToken, apiFetch]);

  useEffect(() => {
    if (!authToken) return;
    apiFetch("/api/suggestions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Suggestion[] | null) => {
        if (Array.isArray(data)) setSuggestions(data);
      })
      .catch(() => {});
  }, [authToken, events, squads, apiFetch]);

  const { resolveUser, prefetchUsers } = useUserCache();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const upNext = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Sort a shallow copy: events with a concrete eventAt timestamp first
    // (ascending — soonest first), TBD / no-timestamp events after.
    const sorted = [...events].sort((a, b) => {
      const aMs = a.eventAt ? new Date(a.eventAt).getTime() : Infinity;
      const bMs = b.eventAt ? new Date(b.eventAt).getTime() : Infinity;
      return aMs - bMs;
    });
    return sorted.find((e) => {
      if (e.eventAt) return new Date(e.eventAt) >= todayStart;
      // No eventAt — show TBD events (genuinely undated future plans).
      if (!e.date || e.date === "Date TBD" || e.date === "TBD") return true;
      // The app's display format ("Jun 12 · 7:00 PM") doesn't parse via
      // new Date() — treat unparseable strings as past to avoid surfacing
      // stale events. The server already filters past eventAt rows.
      const parsed = new Date(e.date);
      if (isNaN(parsed.getTime())) return false;
      const endOfDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + 1);
      return endOfDay >= now;
    }) ?? null;
  }, [events]);

  // Minute ticker so the day-of countdown stays fresh while the screen is open.
  const [nowMinute, setNowMinute] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMinute(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Day-of takeover: when the Up Next plan is today (or in progress right now),
  // the hero switches to a live variant — countdown/"Happening now", one-tap
  // maps, today's itinerary stops for trips, and a shortcut to the plan's chat.
  const dayOf = useMemo(() => {
    if (!upNext) return null;
    const startIso = upNext.eventAt ?? upNext.startAt ?? null;
    if (!startIso) return null;
    const start = new Date(startIso);
    if (isNaN(start.getTime())) return null;
    const now = new Date(nowMinute);
    // Trips span multiple days; plain events get a generous 4h window.
    const endIso = upNext.endAt ?? null;
    const end = endIso ? new Date(new Date(endIso).setHours(23, 59, 59, 999)) : new Date(start.getTime() + 4 * 3600_000);
    const sameDay =
      start.getFullYear() === now.getFullYear() &&
      start.getMonth() === now.getMonth() &&
      start.getDate() === now.getDate();
    const inProgress = now >= start && now <= end;
    // Revert once the plan is over — even if it's still the same calendar day.
    if (now > end) return null;
    if (!sameDay && !inProgress) return null;
    let statusLabel: string;
    if (inProgress) {
      statusLabel = "Happening now";
    } else {
      const mins = Math.max(1, Math.round((start.getTime() - now.getTime()) / 60_000));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      statusLabel = h > 0 ? `Today · starts in ${h}h${m > 0 ? ` ${m}m` : ""}` : `Today · starts in ${m}m`;
    }
    const todayStops =
      upNext.type === "trip"
        ? upNext.itinerary.filter((s) => s.day === todayKey() && s.status === "confirmed").slice(0, 3)
        : [];
    return { inProgress, statusLabel, todayStops };
  }, [upNext, nowMinute]);

  // Count events/trips that actually fall within the current week (today
  // through the upcoming Sunday). Used for an accurate header subgreeting —
  // `events` itself is every upcoming plan, which may be months out.
  const eventsThisWeek = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysUntilSunday = (7 - todayStart.getDay()) % 7;
    const weekEnd = new Date(todayStart);
    weekEnd.setDate(todayStart.getDate() + daysUntilSunday);
    weekEnd.setHours(23, 59, 59, 999);
    return events.filter((e) => {
      const iso = e.eventAt ?? e.startAt ?? null;
      if (!iso) return false;
      const d = new Date(iso);
      if (isNaN(d.getTime())) return false;
      return d >= todayStart && d <= weekEnd;
    }).length;
  }, [events]);

  type EventBalance = {
    eventId: string;
    eventEmoji: string;
    eventTitle: string;
    iOwe: number;
    owedToMe: number;
  };

  const outstandingBalances = useMemo<EventBalance[]>(() => {
    const meId = currentUser.id;
    const result: EventBalance[] = [];
    for (const ev of events) {
      // D3: cancelled events are excluded from settle-up (display-only filter).
      if (ev.cancelled) continue;
      if (!ev.costs || ev.costs.length === 0) continue;
      let iOwe = 0;
      let owedToMe = 0;
      for (const cost of ev.costs) {
        for (const share of cost.shares) {
          if (cost.paidById !== meId && share.userId === meId && share.amount > 0) {
            if (!share.paidAt) {
              iOwe += share.amount;
            }
          } else if (cost.paidById === meId && share.userId !== meId && share.amount > 0) {
            if (!share.confirmedAt) {
              owedToMe += share.amount;
            }
          }
        }
      }
      iOwe = Math.round(iOwe * 100) / 100;
      owedToMe = Math.round(owedToMe * 100) / 100;
      if (iOwe >= 0.01 || owedToMe >= 0.01) {
        result.push({ eventId: ev.id, eventEmoji: ev.emoji, eventTitle: ev.title, iOwe, owedToMe });
      }
    }
    return result;
  }, [events, currentUser.id]);

  // "Find a time" always opens the chooser so the user can start a FRESH plan
  // (T12 — never auto-jumps to a squad's last pending board) and decide whether
  // it's for a whole squad or an ad-hoc group they pick (T3).
  const handleFindTime = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPickerMode("find-time");
  };

  // Start a brand-new squad-scoped poll: first ask Event vs Trip, then route.
  const startSquadPoll = (squadId: string) => {
    setKindTarget({ type: "squad", squadId });
    setPickerMode("find-time-kind");
  };

  // "New plan — pick people": ask Event vs Trip first, then pick the crew.
  const startNewPlan = () => {
    setKindTarget({ type: "newplan" });
    setPickerMode("find-time-kind");
  };

  // The user picked Event or Trip. Route into the appropriate flow: squad polls
  // jump straight to the availability board; an ad-hoc "new plan" first opens the
  // participant picker (its launch carries the chosen kind through).
  const chooseKind = (kind: "event" | "trip") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const target = kindTarget;
    setPickerMode(null);
    setKindTarget(null);
    if (target?.type === "squad") {
      router.push({
        pathname: "/availability",
        params: { squadId: target.squadId, from: "create", kind },
      } as never);
      return;
    }
    setPlanKind(kind);
    setSelectedParticipants(new Set());
    setTimeout(() => setParticipantSheetOpen(true), Platform.OS === "ios" ? 350 : 0);
  };

  // Launch the ad-hoc availability poll with the chosen invitees + plan kind.
  const launchParticipantPoll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setParticipantSheetOpen(false);
    const csv = [...selectedParticipants].join(",");
    router.push({
      pathname: "/availability",
      params: { from: "create", adhoc: "1", participantIds: csv, kind: planKind },
    } as never);
  };

  // Copy the invite message to the clipboard. Works on native and, when the
  // preview iframe permits it, on web too. If the clipboard is blocked the link
  // is still visible/selectable in the reveal sheet, so the user is never stuck.
  const copyInvite = async (message: string) => {
    if (Platform.OS === "web") {
      // Try the legacy execCommand path FIRST while still inside the tap
      // gesture — navigator.clipboard is blocked in the cross-origin preview
      // iframe, but a hidden-textarea + execCommand("copy") works there.
      if (webCopy(message)) {
        showToast("Invite link copied — paste it anywhere to share 📋");
        return;
      }
      try {
        const nav = (globalThis as { navigator?: Navigator }).navigator;
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(message);
          showToast("Invite link copied — paste it anywhere to share 📋");
          return;
        }
      } catch {
        // fall through to the manual-select hint
      }
      showToast("Couldn't copy automatically — select the link to copy it");
      return;
    }
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(message);
      showToast("Invite link copied — paste it anywhere to share 📋");
    } catch {
      showToast("Couldn't copy automatically — select the link to copy it");
    }
  };

  // Open the native share sheet (native only). Unavailable in the web preview's
  // cross-origin iframe, so the reveal sheet hides this button on web.
  const shareInviteNative = async (message: string) => {
    try {
      await Share.share({ message });
    } catch {
      // user dismissed the share sheet
    }
  };

  const signupInviteMessage = () =>
    `I'm on SquadZ — let's plan our next hangout and find a time everyone's free. Add me with my code ${friendCode}\nhttps://joinsquadz.com`;

  const squadInviteMessage = (squad: (typeof squads)[0]) => {
    const link = squad.inviteCode
      ? `https://joinsquadz.com/squad/join?code=${squad.inviteCode}`
      : `https://joinsquadz.com/squad/${squad.id}`;
    return `Join my squad "${squad.emoji} ${squad.name}" on SquadZ — let's find a time we're all actually free 🎉\n${link}`;
  };

  const showSignupInvite = () => {
    setInviteReveal({ title: "Invite a friend to SquadZ", message: signupInviteMessage() });
    setPickerMode("invite-link");
  };

  const showSquadInvite = (squad: (typeof squads)[0]) => {
    setInviteReveal({ title: `Invite to ${squad.emoji} ${squad.name}`, message: squadInviteMessage(squad) });
    setPickerMode("invite-link");
  };

  // "Invite crew" opens a chooser: invite into an existing squad, or just send a
  // friend a signup link with no squad attached (T1).
  const handleInvite = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPickerMode("invite-choose");
  };

  // From the invite chooser: route to the right squad-invite flow by squad count.
  const inviteToSquad = () => {
    if (squads.length === 0) {
      showSignupInvite();
      return;
    }
    if (squads.length === 1) {
      showSquadInvite(squads[0]);
      return;
    }
    setPickerMode("invite");
  };

  // Who's attending the "Up Next" card. Trips have no RSVP UI, so count the
  // roster (squad members + invitees + host) instead of the rsvps map, which
  // would only ever show the host.
  const upNextGoingIds = useMemo(() => {
    if (!upNext) return [];
    const sq = squads.find((s) => s.id === upNext.squadId);
    return attendingIds(upNext, sq?.memberIds ?? []);
  }, [upNext, squads]);

  // "Needs you" — pending actions across the user's plans, each a one-tap deep
  // link: unanswered RSVPs, open votes on proposed trip stops, polls not voted.
  const needsYou = useMemo(() => {
    const me = currentUser.id;
    const items: { key: string; icon: keyof typeof Ionicons.glyphMap; tint: string; title: string; sub: string; route: string }[] = [];
    for (const e of events) {
      if (e.cancelled) continue;
      if (e.type === "event" && e.hostId !== me && e.rsvps[me] === undefined) {
        items.push({
          key: `rsvp-${e.id}`, icon: "help-circle", tint: "#FF6B2C",
          title: `RSVP to ${e.title}`, sub: formatEventTime(e) || "Date TBD",
          route: `/event/${e.id}`,
        });
      }
      // Stop-vote "needs you" nudge — hidden while stop voting is soft-deprecated.
      // Ideas is the replacement suggest-and-vote surface. Re-enable via STOP_VOTING_ENABLED.
      if (STOP_VOTING_ENABLED && e.type === "trip") {
        const openVotes = e.itinerary.filter((s) => s.status === "proposed" && s.createdBy !== me && !s.votes.includes(me));
        if (openVotes.length > 0) {
          items.push({
            key: `votes-${e.id}`, icon: "heart", tint: "#A855F7",
            title: `${openVotes.length} stop${openVotes.length !== 1 ? "s" : ""} to vote on`, sub: e.title,
            route: `/trip/${e.id}`,
          });
        }
      }
      const openPolls = e.polls.filter((p) => !p.options.some((o) => o.voterIds.includes(me)));
      if (openPolls.length > 0) {
        items.push({
          key: `polls-${e.id}`, icon: "stats-chart", tint: "#4A9EFF",
          title: openPolls.length === 1 ? openPolls[0].question : `${openPolls.length} polls need your vote`, sub: e.title,
          route: e.type === "trip" ? `/trip/${e.id}` : `/event/${e.id}`,
        });
      }
    }
    return items.slice(0, 4);
  }, [events, currentUser.id]);

  // Pre-load user profiles shown in the hero card attendee pips
  const upNextGoingKey = upNextGoingIds.join(",");
  useEffect(() => {
    if (upNextGoingIds.length > 0) prefetchUsers(upNextGoingIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upNextGoingKey]);

  // T206: while Home is idle, warm the user cache for the details the user is
  // most likely to tap next — Up Next attendees are handled above; this covers
  // the member rosters of the top squads so squad/event screens open with
  // avatars/names already resolved (no spinner beat).
  const topSquadMembersKey = useMemo(
    () => squads.slice(0, 3).flatMap((s) => s.memberIds).join(","),
    [squads],
  );
  useEffect(() => {
    if (!topSquadMembersKey) return;
    const t = setTimeout(() => {
      const ids = [...new Set(topSquadMembersKey.split(","))].filter(Boolean);
      if (ids.length > 0) prefetchUsers(ids);
    }, 400);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topSquadMembersKey]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.foreground }]}>
            Hey, {currentUser.name.split(" ")[0]} 👋
          </Text>
          <Text style={[styles.subGreeting, { color: colors.mutedForeground }]}>
            {squads.length} squad{squads.length !== 1 ? "s" : ""} · {eventsThisWeek > 0
              ? `${eventsThisWeek} event${eventsThisWeek !== 1 ? "s" : ""} this week`
              : `${events.length} upcoming`}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/activity"); }}
            style={[styles.bellBtn, { backgroundColor: colors.card }]}
            accessibilityRole="button"
            accessibilityLabel="Notifications and recent activity"
            hitSlop={8}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.foreground} />
            {unreadActivity > 0 ? (
              <View style={[styles.bellBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
                <Text style={styles.bellBadgeText}>{unreadActivity > 99 ? "99+" : unreadActivity}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/profile"); }}
            accessibilityLabel="Your profile"
          >
            <ProAvatar
              initials={currentUser.initials}
              color={currentUser.color}
              imageUrl={currentUser.profileImageUrl}
              size={40}
              fontSize={15}
              isPro={resolveUser(currentUser.id).isPro}
            />
          </TouchableOpacity>
        </View>
      </View>

      <LiveStatusBanner />

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === "web" ? 84 : 100) }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Quick actions — always-present primary actions */}
        <View style={[styles.section, { flexDirection: "row", gap: 12 }]}>
          <TouchableOpacity
            onPress={handleFindTime}
            activeOpacity={0.85}
            style={[styles.quickAction, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}
          >
            <View style={[styles.quickIcon, { backgroundColor: colors.primary + "22" }]}>
              <Ionicons name="sparkles" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.quickTitle, { color: colors.foreground }]}>Find a time</Text>
            <Text style={[styles.quickSub, { color: colors.mutedForeground }]}>When's everyone free?</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { void handleInvite(); }}
            activeOpacity={0.85}
            style={[styles.quickAction, { backgroundColor: "#2ECC8A12", borderColor: "#2ECC8A30" }]}
          >
            <View style={[styles.quickIcon, { backgroundColor: "#2ECC8A22" }]}>
              <Ionicons name="person-add" size={20} color="#2ECC8A" />
            </View>
            <Text style={[styles.quickTitle, { color: colors.foreground }]}>Invite crew</Text>
            <Text style={[styles.quickSub, { color: colors.mutedForeground }]}>Better with friends</Text>
          </TouchableOpacity>
        </View>

        {/* Hero "Up Next" card */}
        {eventsLoading ? (
          <View style={styles.section}>
            <SkeletonBox height={160} borderRadius={22} />
          </View>
        ) : upNext ? (
          <View style={styles.section}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push(upNext.type === "trip" ? `/trip/${upNext.id}` : `/event/${upNext.id}`); }}
              activeOpacity={0.92}
            >
              <LinearGradient
                colors={["#FF6B2C", "#FF8C3A"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroCard}
              >
                {/* Decorative circle */}
                <View style={styles.heroCircle} />
                <View style={[styles.heroTag, { backgroundColor: dayOf ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.25)" }]}>
                  <Text style={styles.heroTagText}>
                    {dayOf ? (dayOf.inProgress ? "🔴 " : "⏰ ") + dayOf.statusLabel : "⚡ Up Next"}
                  </Text>
                </View>
                <Text style={styles.heroTitle}>{upNext.emoji} {upNext.title}</Text>
                {dayOf && upNext.location && upNext.location !== "TBD" ? (
                  <TouchableOpacity
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openMaps(upNext.location); }}
                    style={styles.heroLocBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${upNext.location} in maps`}
                  >
                    <Ionicons name="navigate" size={13} color="#fff" />
                    <Text style={styles.heroLocText} numberOfLines={1}>{upNext.location}</Text>
                    <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.8)" />
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.heroSub}>{upNext.location} · {formatEventTime(upNext)}</Text>
                )}
                {dayOf && dayOf.todayStops.length > 0 ? (
                  <View style={styles.heroStops}>
                    {dayOf.todayStops.map((s) => (
                      <View key={s.id} style={styles.heroStopRow}>
                        <View style={styles.heroStopDot} />
                        {s.time ? <Text style={styles.heroStopTime}>{s.time}</Text> : null}
                        <Text style={styles.heroStopTitle} numberOfLines={1}>{s.title}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <View style={styles.heroFooter}>
                  <View style={styles.heroPeople}>
                    {upNextGoingIds
                      .slice(0, 5)
                      .map((uid, i) => {
                        const u = resolveUser(uid);
                        return (
                          <TouchableOpacity
                            key={uid}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              router.push((uid === currentUser.id ? "/profile" : `/user/${uid}`) as never);
                            }}
                            style={[styles.heroPip, { marginLeft: i > 0 ? -8 : 0 }]}
                            accessibilityLabel={`Open ${u.name}'s profile`}
                          >
                            <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={24} fontSize={11} />
                          </TouchableOpacity>
                        );
                      })}
                  </View>
                  {dayOf ? (
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        router.push((upNext.type === "trip" ? `/trip/${upNext.id}?tab=chat` : `/event/${upNext.id}?tab=chat`) as never);
                      }}
                      style={styles.heroChatBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Open plan chat"
                    >
                      <Ionicons name="chatbubble" size={13} color="#FF6B2C" />
                      <Text style={styles.heroChatText}>Chat</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.heroGoingText}>{upNextGoingIds.length} going</Text>
                  )}
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.section}>
            <View style={[styles.emptyHero, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={styles.emptyHeroEmoji}>{squads.length === 0 ? "👋" : "🗓️"}</Text>
              <Text style={[styles.emptyHeroTitle, { color: colors.foreground }]}>
                {squads.length === 0 ? "Let's get your crew together" : "No plans yet — start one"}
              </Text>
              <Text style={[styles.emptyHeroSub, { color: colors.mutedForeground }]}>
                {squads.length === 0
                  ? "Create a squad and invite your friends to find the time everyone's free."
                  : "Pick a time everyone's free, then turn it into a plan."}
              </Text>
              {squads.length === 0 && (
                // Non-interactive product preview: a miniature plan card with an
                // availability heat strip so the empty state shows what SquadZ does.
                <View pointerEvents="none" style={[styles.previewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <View style={styles.previewCardTop}>
                    <Text style={styles.previewCardEmoji}>🍕</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.previewCardTitle, { color: colors.foreground }]}>Pizza night</Text>
                      <Text style={[styles.previewCardMeta, { color: colors.mutedForeground }]}>Fri 7:00 PM · 4 going</Text>
                    </View>
                    <View style={[styles.previewCardBadge, { backgroundColor: "#2ECC8A22" }]}>
                      <Text style={[styles.previewCardBadgeText, { color: "#2ECC8A" }]}>Best time</Text>
                    </View>
                  </View>
                  <View style={styles.previewHeatRow}>
                    {[0.2, 0.4, 0.5, 0.8, 1, 0.9, 0.5].map((v, i) => (
                      <View
                        key={i}
                        style={[
                          styles.previewHeatCell,
                          { backgroundColor: v >= 0.8 ? "#FF6B2C" : `rgba(255,107,44,${0.12 + v * 0.35})` },
                        ]}
                      />
                    ))}
                  </View>
                  <Text style={[styles.previewHeatLabel, { color: colors.textDim }]}>Everyone's free Friday evening</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={squads.length === 0 ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/squad/create" as never); } : handleFindTime}
                activeOpacity={0.9}
                style={{ width: "100%" }}
              >
                <LinearGradient colors={["#FF6B2C", "#FF8C3A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.emptyHeroBtn}>
                  <Text style={styles.emptyHeroBtnText}>{squads.length === 0 ? "Create your first squad" : "Find a time"}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Needs you — pending RSVPs, votes, polls */}
        {needsYou.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 10 }]}>Needs you</Text>
            <View style={{ gap: 8 }}>
              {needsYou.map((item) => (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(item.route as never); }}
                  activeOpacity={0.85}
                  style={[styles.needsRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                >
                  <View style={[styles.needsIcon, { backgroundColor: item.tint + "18" }]}>
                    <Ionicons name={item.icon} size={16} color={item.tint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.needsTitle, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
                    <Text style={[styles.needsSub, { color: colors.mutedForeground }]} numberOfLines={1}>{item.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Streaks */}
        {streaks !== null && (streaks.monthlyPlan > 0 || streaks.stayInTouch > 0) ? (
          <View style={[styles.section, { flexDirection: "row", gap: 12 }]}>
            {/* Monthly plan streak */}
            <View style={[styles.streakCard, { backgroundColor: colors.card, borderColor: "#FFB23E40", flex: 1 }]}>
              <View style={styles.streakCardTop}>
                <Text style={styles.streakEmoji}>🔥</Text>
                <Text style={[styles.streakCount, { color: "#FFB23E" }]}>
                  {streaks.monthlyPlan > 0 ? streaks.monthlyPlan : "—"}
                </Text>
              </View>
              <Text style={[styles.streakLabel, { color: colors.foreground }]}>
                {streaks.monthlyPlan === 1 ? "month" : "months"}
              </Text>
              <Text style={[styles.streakSub, { color: colors.mutedForeground }]}>Monthly plan streak</Text>
            </View>
            {/* Stay in touch streak */}
            <View style={[styles.streakCard, { backgroundColor: colors.card, borderColor: "#4A9EFF40", flex: 1 }]}>
              <View style={styles.streakCardTop}>
                <Text style={styles.streakEmoji}>💬</Text>
                <Text style={[styles.streakCount, { color: "#4A9EFF" }]}>
                  {streaks.stayInTouch > 0 ? streaks.stayInTouch : "—"}
                </Text>
              </View>
              <Text style={[styles.streakLabel, { color: colors.foreground }]}>
                {streaks.stayInTouch === 1 ? "week" : "weeks"}
              </Text>
              <Text style={[styles.streakSub, { color: colors.mutedForeground }]}>Stay-in-touch streak</Text>
            </View>
          </View>
        ) : streaks !== null ? (
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.streakNudge, { backgroundColor: colors.card, borderColor: "#FFB23E40" }]}
              onPress={() => {
                router.push({ pathname: "/create", params: { from: "home" } } as never);
              }}
            >
              <Text style={styles.streakEmoji}>🔥</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.streakLabel, { color: colors.foreground }]}>Start your streak</Text>
                <Text style={[styles.streakSub, { color: colors.mutedForeground }]}>Plan something with your squad this month</Text>
              </View>
              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>+</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* My Squads */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My SquadZ</Text>
            {!squadsLoading && (
              <TouchableOpacity onPress={() => router.push("/(tabs)/squads")}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>See all →</Text>
              </TouchableOpacity>
            )}
          </View>
          {squadsLoading ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              {[130, 130, 130].map((w, i) => (
                <SkeletonBox key={i} width={w} height={120} borderRadius={16} />
              ))}
            </View>
          ) : (
            <FlatList
              data={squads}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(s) => s.id}
              contentContainerStyle={{ gap: 10, paddingRight: 20 }}
              ListFooterComponent={
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/create"); }}
                  style={[styles.squadBubble, styles.newSquadBubble, { borderColor: colors.primary + "50" }]}
                >
                  <View style={[styles.squadEmoji, { backgroundColor: colors.primary + "20" }]}>
                    <Ionicons name="add" size={26} color={colors.primary} />
                  </View>
                  <Text style={[styles.squadName, { color: colors.primary }]}>New</Text>
                </TouchableOpacity>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/squad/${item.id}`); }}
                  style={[styles.squadBubble, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.squadEmoji, { backgroundColor: item.color + "20" }]}>
                    <Text style={styles.squadEmojiText}>{item.emoji}</Text>
                  </View>
                  <Text style={[styles.squadName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[styles.squadCount, { color: colors.mutedForeground }]}>
                    {item.memberIds.length} members
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>

        {/* Upcoming Events */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Upcoming</Text>
            <TouchableOpacity onPress={() => router.navigate("/(tabs)/events")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>See all →</Text>
            </TouchableOpacity>
          </View>
          {eventsLoading ? (
            <View style={{ flexDirection: "row", gap: 12 }}>
              {[0, 1].map((i) => (
                <SkeletonBox key={i} width={260} height={140} borderRadius={16} />
              ))}
            </View>
          ) : (
          <FlatList
            data={events.slice(0, 3)}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(e) => e.id}
            contentContainerStyle={{ gap: 12, paddingRight: 20 }}
            renderItem={({ item }) => (
              item.type === "trip" ? (
                <View style={{ width: 260 }}>
                  <TripCard trip={item} />
                </View>
              ) : (
                <EventCard
                  id={item.id}
                  emoji={item.emoji}
                  title={item.title}
                  date={item.date}
                  eventAt={item.eventAt}
                  startAt={item.startAt}
                  allDay={item.allDay}
                  location={item.location}
                  hostId={item.hostId}
                  attendeeCount={goingCount(item)}
                  horizontal
                />
              )
            )}
          />
          )}
        </View>

        {/* Balances */}
        {outstandingBalances.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>💸 Balances</Text>
              <Text style={[styles.seeAll, { color: colors.mutedForeground }]}>Outstanding</Text>
            </View>
            <View style={{ gap: 10 }}>
              {outstandingBalances.map((b) => {
                const net = Math.round((b.owedToMe - b.iOwe) * 100) / 100;
                const isPositive = net >= 0.01;
                const isNegative = net <= -0.01;
                const accentColor = isPositive ? "#2ECC8A" : isNegative ? "#FF6B2C" : colors.mutedForeground;
                return (
                  <TouchableOpacity
                    key={b.eventId}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({ pathname: `/event/${b.eventId}`, params: { tab: "costs" } } as never);
                    }}
                    activeOpacity={0.8}
                    style={[styles.balanceRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.balanceEmoji, { backgroundColor: accentColor + "18" }]}>
                      <Text style={{ fontSize: 20 }}>{b.eventEmoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.balanceTitle, { color: colors.foreground }]} numberOfLines={1}>{b.eventTitle}</Text>
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                        {b.iOwe >= 0.01 && (
                          <Text style={[styles.balanceChip, { color: "#FF6B2C" }]}>You owe ${b.iOwe.toFixed(2)}</Text>
                        )}
                        {b.owedToMe >= 0.01 && (
                          <Text style={[styles.balanceChip, { color: "#2ECC8A" }]}>Owed to you ${b.owedToMe.toFixed(2)}</Text>
                        )}
                      </View>
                    </View>
                    <View style={[styles.balanceNetBadge, { backgroundColor: accentColor + "18" }]}>
                      <Text style={[styles.balanceNetText, { color: accentColor }]}>
                        {net >= 0 ? "+" : ""}${net.toFixed(2)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* For You — live, data-driven suggestions */}
        {eventsLoading && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>✦ For You</Text>
            <View style={{ gap: 10 }}>
              <SkeletonBox height={64} borderRadius={14} />
              <SkeletonBox height={64} borderRadius={14} />
            </View>
          </View>
        )}
        {!eventsLoading && suggestions.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>✦ For You</Text>
            <View style={{ gap: 10 }}>
              {suggestions.map((s) => {
                const color = suggestionColor(s.type);
                return (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const a = s.action;
                      if (a.kind === "create-squad") {
                        router.push("/squad/create");
                      } else if (a.kind === "open-event") {
                        router.push(`/event/${a.eventId}`);
                      } else {
                        router.push({
                          pathname: "/create",
                          params: {
                            from: "home",
                            ...(a.prefillTitle ? { prefillTitle: a.prefillTitle } : {}),
                            ...(a.prefillEmoji ? { prefillEmoji: a.prefillEmoji } : {}),
                            ...(a.squadId ? { prefillSquad: a.squadId } : {}),
                          },
                        } as never);
                      }
                    }}
                    style={[styles.suggestionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.suggestionIcon, { backgroundColor: color + "22" }]}>
                      <Text style={{ fontSize: 22 }}>{s.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suggestionTitle, { color: colors.foreground }]}>{s.title}</Text>
                      <Text style={[styles.suggestionSub, { color: colors.mutedForeground }]}>{s.why}</Text>
                    </View>
                    <View style={[styles.suggestionTag, { backgroundColor: color + "22" }]}>
                      <Text style={[styles.suggestionTagText, { color }]}>{s.type}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Discover */}
        {(discoverEvents.length > 0 || discoverSquads.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>🔍 Discover</Text>
                <Text style={[styles.discoverSubtitle, { color: colors.mutedForeground }]}>Public events & squads to join</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 20 }}>
              {discoverEvents.map((ev) => (
                <TouchableOpacity
                  key={ev.id}
                  style={[styles.discoverCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    await joinEvent(ev.inviteCode);
                    router.push(`/event/${ev.id}` as never);
                  }}
                  activeOpacity={0.85}
                >
                  <View style={[styles.discoverIconWrap, { backgroundColor: colors.primary + "18" }]}>
                    <Text style={styles.discoverEmoji}>{ev.emoji}</Text>
                  </View>
                  <Text style={[styles.discoverTitle, { color: colors.foreground }]} numberOfLines={2}>{ev.title}</Text>
                  <Text style={[styles.discoverSub, { color: colors.mutedForeground }]} numberOfLines={1}>{formatEventTime(ev)}</Text>
                  <View style={[styles.discoverJoinBtn, { backgroundColor: colors.primary }]}>
                    <Text style={styles.discoverJoinText}>Join →</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {discoverSquads.map((sq) => (
                <TouchableOpacity
                  key={sq.id}
                  style={[styles.discoverCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    try {
                      const result = await joinSquad(sq.id);
                      if (result.error) {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                        return;
                      }
                      router.push(`/squad/${sq.id}` as never);
                    } catch (err) {
                      if (err instanceof SquadLimitError) {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        setUpgradeVisible(true);
                        return;
                      }
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <View style={[styles.discoverIconWrap, { backgroundColor: (sq.color ?? colors.primary) + "22" }]}>
                    <Text style={styles.discoverEmoji}>{sq.emoji}</Text>
                  </View>
                  <Text style={[styles.discoverTitle, { color: colors.foreground }]} numberOfLines={2}>{sq.name}</Text>
                  <Text style={[styles.discoverSub, { color: colors.mutedForeground }]}>{sq.memberIds?.length ?? 0} members</Text>
                  <View style={[styles.discoverJoinBtn, { backgroundColor: sq.color ?? colors.primary }]}>
                    <Text style={styles.discoverJoinText}>Join →</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {/* FAB speed-dial backdrop */}
      {fabOpen && (
        <TouchableOpacity
          style={styles.fabBackdrop}
          activeOpacity={1}
          onPress={() => setFabOpen(false)}
        />
      )}

      {/* FAB speed-dial */}
      <View style={styles.fabGroup}>
        {fabOpen && (
          <>
            <View style={styles.fabOption}>
              <View style={[styles.fabOptionLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.fabOptionText, { color: colors.foreground }]}>New Squad</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setFabOpen(false);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push("/squad/create" as never);
                }}
                style={[styles.fabMini, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={{ fontSize: 22 }}>👥</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.fabOption}>
              <View style={[styles.fabOptionLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.fabOptionText, { color: colors.foreground }]}>New Event</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setFabOpen(false);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push({ pathname: "/create", params: { from: "home" } } as never);
                }}
                style={[styles.fabMini, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={{ fontSize: 22 }}>🎉</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setFabOpen((v) => !v);
          }}
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.primary }]}
        >
          <Text style={[styles.fabText, fabOpen && { transform: [{ rotate: "45deg" }] }]}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Squad picker — shared by "Find a time" and "Invite crew" */}
      <Modal
        visible={pickerMode !== null}
        transparent
        animationType="slide"
        onRequestClose={() => { setPickerMode(null); setInviteReveal(null); }}
      >
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => { setPickerMode(null); setInviteReveal(null); }}
        />
        <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 12 }]}>
          <View style={[styles.pickerHandle, { backgroundColor: colors.border }]} />
          {pickerMode === "invite-choose" ? (
            <>
              <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Invite crew</Text>
              <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
                How do you want to bring people in?
              </Text>
              <TouchableOpacity
                style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                onPress={inviteToSquad}
                activeOpacity={0.8}
              >
                <View style={[styles.pickerSquadEmoji, { backgroundColor: colors.primary + "20" }]}>
                  <Ionicons name="people" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerSquadName, { color: colors.foreground }]}>Invite to a squad</Text>
                  <Text style={[styles.pickerSquadCount, { color: colors.mutedForeground }]}>
                    Add someone to one of your squads
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                onPress={showSignupInvite}
                activeOpacity={0.8}
              >
                <View style={[styles.pickerSquadEmoji, { backgroundColor: colors.primary + "20" }]}>
                  <Ionicons name="person-add" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerSquadName, { color: colors.foreground }]}>Invite a friend to SquadZ</Text>
                  <Text style={[styles.pickerSquadCount, { color: colors.mutedForeground }]}>
                    Send a signup link — no squad needed
                  </Text>
                </View>
                <Ionicons name="share-outline" size={18} color={colors.primary} />
              </TouchableOpacity>
            </>
          ) : pickerMode === "find-time" ? (
            <>
              <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Find a time</Text>
              <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
                Start a fresh plan and see when everyone's free
              </Text>
              <TouchableOpacity
                style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                onPress={startNewPlan}
                activeOpacity={0.8}
              >
                <View style={[styles.pickerSquadEmoji, { backgroundColor: colors.primary + "20" }]}>
                  <Ionicons name="sparkles" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerSquadName, { color: colors.foreground }]}>New plan — pick people</Text>
                  <Text style={[styles.pickerSquadCount, { color: colors.mutedForeground }]}>
                    Choose exactly who's in on this one
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
              {squads.map((sq) => (
                <TouchableOpacity
                  key={sq.id}
                  style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); startSquadPoll(sq.id); }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.pickerSquadEmoji, { backgroundColor: sq.color + "20" }]}>
                    <Text style={{ fontSize: 22 }}>{sq.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pickerSquadName, { color: colors.foreground }]}>{sq.name}</Text>
                    <Text style={[styles.pickerSquadCount, { color: colors.mutedForeground }]}>
                      {sq.memberIds.length} member{sq.memberIds.length !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </>
          ) : pickerMode === "find-time-kind" ? (
            <>
              <Text style={[styles.pickerTitle, { color: colors.foreground }]}>What are you planning?</Text>
              <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
                Pick the kind of plan and we'll set up the right way to find a time.
              </Text>
              <TouchableOpacity
                style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                onPress={() => chooseKind("event")}
                activeOpacity={0.8}
              >
                <View style={[styles.pickerSquadEmoji, { backgroundColor: colors.primary + "20" }]}>
                  <Ionicons name="calendar" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerSquadName, { color: colors.foreground }]}>Event</Text>
                  <Text style={[styles.pickerSquadCount, { color: colors.mutedForeground }]}>
                    Pick a day and the time slots that work
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                onPress={() => chooseKind("trip")}
                activeOpacity={0.8}
              >
                <View style={[styles.pickerSquadEmoji, { backgroundColor: colors.primary + "20" }]}>
                  <Ionicons name="airplane" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerSquadName, { color: colors.foreground }]}>Trip</Text>
                  <Text style={[styles.pickerSquadCount, { color: colors.mutedForeground }]}>
                    Find the date range everyone's free
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </>
          ) : pickerMode === "invite-link" ? (
            <>
              <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
                {inviteReveal?.title ?? "Invite crew"}
              </Text>
              <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
                Send this to bring people in — or copy the link below.
              </Text>
              <View style={[styles.inviteLinkBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text selectable style={[styles.inviteLinkText, { color: colors.foreground }]}>
                  {inviteReveal?.message ?? ""}
                </Text>
              </View>
              {Platform.OS !== "web" ? (
                <TouchableOpacity
                  style={[styles.inviteBtn, { backgroundColor: colors.primary }]}
                  activeOpacity={0.85}
                  onPress={() => { if (inviteReveal) void shareInviteNative(inviteReveal.message); }}
                >
                  <Ionicons name="share-outline" size={18} color="#fff" />
                  <Text style={styles.inviteBtnText}>Share…</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.inviteBtn,
                  Platform.OS === "web"
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border },
                ]}
                activeOpacity={0.85}
                onPress={() => { if (inviteReveal) void copyInvite(inviteReveal.message); }}
              >
                <Ionicons
                  name="copy-outline"
                  size={18}
                  color={Platform.OS === "web" ? "#fff" : colors.foreground}
                />
                <Text
                  style={[
                    styles.inviteBtnText,
                    Platform.OS === "web" ? null : { color: colors.foreground },
                  ]}
                >
                  Copy link
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.inviteDone}
                activeOpacity={0.7}
                onPress={() => { setPickerMode(null); setInviteReveal(null); }}
              >
                <Text style={[styles.inviteDoneText, { color: colors.mutedForeground }]}>Done</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Which squad?</Text>
              <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
                Share an invite link for this squad
              </Text>
              {squads.map((sq) => (
                <TouchableOpacity
                  key={sq.id}
                  style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    showSquadInvite(sq);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.pickerSquadEmoji, { backgroundColor: sq.color + "20" }]}>
                    <Text style={{ fontSize: 22 }}>{sq.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pickerSquadName, { color: colors.foreground }]}>{sq.name}</Text>
                    <Text style={[styles.pickerSquadCount, { color: colors.mutedForeground }]}>
                      {sq.memberIds.length} member{sq.memberIds.length !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <Ionicons name="share-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      </Modal>

      <ParticipantPickerModal
        visible={participantSheetOpen}
        friends={friends}
        selected={selectedParticipants}
        onToggle={(id) => {
          Haptics.selectionAsync();
          setSelectedParticipants((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          });
        }}
        onClose={() => setParticipantSheetOpen(false)}
        onConfirm={launchParticipantPoll}
        resolveUser={resolveUser}
        colors={colors}
        insets={insets}
      />

      <UpgradeModal
        visible={upgradeVisible}
        trigger="squad_limit"
        onClose={() => setUpgradeVisible(false)}
      />
      <CelebrationOverlay
        visible={streakCelebration !== null}
        emoji={streakCelebration?.emoji ?? "🔥"}
        title={streakCelebration?.title ?? ""}
        subtitle={streakCelebration?.subtitle}
        ctaLabel="Keep it up"
        onClose={() => setStreakCelebration(null)}
      />
    </View>
  );
}

function ParticipantPickerModal({
  visible,
  friends,
  selected,
  onToggle,
  onClose,
  onConfirm,
  resolveUser,
  colors,
  insets,
}: {
  visible: boolean;
  friends: string[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  resolveUser: (id: string) => ResolvedUser;
  colors: ReturnType<typeof useColors>;
  insets: { bottom: number };
}) {
  const count = selected.size;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 12, maxHeight: "80%" }]}>
        <View style={[styles.pickerHandle, { backgroundColor: colors.border }]} />
        <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Who's in on this plan?</Text>
        <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
          Pick the friends planning this one. You can always share the link after.
        </Text>
        {friends.length === 0 ? (
          <View style={{ paddingVertical: 28, alignItems: "center" }}>
            <Ionicons name="people-outline" size={32} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, marginTop: 10, textAlign: "center" }}>
              Add friends first, or just start the plan and share the link.
            </Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {friends.map((id) => {
              const u = resolveUser(id);
              const on = selected.has(id);
              return (
                <TouchableOpacity
                  key={id}
                  style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                  onPress={() => onToggle(id)}
                  activeOpacity={0.8}
                >
                  <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={40} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.pickerSquadName, { color: colors.foreground }]}>{u.name}</Text>
                  </View>
                  <Ionicons
                    name={on ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={on ? colors.primary : colors.mutedForeground}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        <View style={{ marginTop: 16 }}>
          <GradientButton
            label={count > 0 ? `Find a time with ${count} ${count === 1 ? "person" : "people"}` : "Start plan & share link"}
            onPress={onConfirm}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  greeting: { fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  subGreeting: { fontSize: 13, marginTop: 2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", position: "relative",
  },
  bellBadge: {
    position: "absolute", top: 2, right: 2,
    minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  bellBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  body: { flex: 1 },
  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: "800" },
  seeAll: { fontSize: 13, fontWeight: "600" },
  coach: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  coachEmoji: { fontSize: 18 },
  coachText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  quickAction: {
    flex: 1, borderRadius: 16, borderWidth: 1, padding: 14, gap: 6,
  },
  quickIcon: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: "center", justifyContent: "center", marginBottom: 2,
  },
  quickTitle: { fontSize: 15, fontWeight: "800" },
  quickSub: { fontSize: 12 },
  emptyHero: {
    borderRadius: 22, borderWidth: 1, padding: 22, alignItems: "center", gap: 8,
  },
  emptyHeroEmoji: { fontSize: 36 },
  emptyHeroTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyHeroSub: { fontSize: 13, textAlign: "center", lineHeight: 18, marginBottom: 8 },
  previewCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 12, marginBottom: 14, gap: 8 },
  previewCardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  previewCardEmoji: { fontSize: 24 },
  previewCardTitle: { fontSize: 14, fontWeight: "800" },
  previewCardMeta: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  previewCardBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  previewCardBadgeText: { fontSize: 10, fontWeight: "800" },
  previewHeatRow: { flexDirection: "row", gap: 4 },
  previewHeatCell: { flex: 1, height: 18, borderRadius: 4 },
  previewHeatLabel: { fontSize: 10, fontWeight: "600" },
  emptyHeroBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  emptyHeroBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  heroCard: {
    borderRadius: 22, padding: 20, overflow: "hidden",
  },
  heroCircle: {
    position: "absolute", right: -30, top: -30,
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  heroTag: {
    alignSelf: "flex-start", borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8,
  },
  heroTagText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#fff", marginBottom: 4 },
  heroSub: { fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 14 },
  heroLocBtn: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 12 },
  heroLocText: { fontSize: 13, fontWeight: "700", color: "#fff", maxWidth: 220 },
  heroStops: { marginBottom: 12, gap: 5 },
  heroStopRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  heroStopDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.75)" },
  heroStopTime: { fontSize: 12, fontWeight: "800", color: "rgba(255,255,255,0.85)" },
  heroStopTitle: { fontSize: 12, fontWeight: "600", color: "#fff", flexShrink: 1 },
  heroChatBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#fff", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  heroChatText: { fontSize: 12, fontWeight: "800", color: "#FF6B2C" },
  needsRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  needsIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  needsTitle: { fontSize: 14, fontWeight: "700" },
  needsSub: { fontSize: 12, marginTop: 1 },
  heroFooter: { flexDirection: "row", alignItems: "center" },
  heroPeople: { flexDirection: "row" },
  heroPip: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#FF6B2C",
  },
  heroGoingText: { marginLeft: 8, fontSize: 12, color: "rgba(255,255,255,0.8)" },
  streakCard: {
    borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 4,
  },
  streakCardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  streakEmoji: { fontSize: 22 },
  streakCount: { fontSize: 28, fontWeight: "900" },
  streakLabel: { fontSize: 13, fontWeight: "700" },
  streakSub: { fontSize: 11, marginTop: 1 },
  streakNudge: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1.5, padding: 16,
  },
  squadBubble: {
    borderRadius: 16, borderWidth: 1, padding: 14, width: 130,
    alignItems: "center", gap: 8,
  },
  newSquadBubble: { borderStyle: "dashed", justifyContent: "center" },
  squadEmoji: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  squadEmojiText: { fontSize: 24 },
  squadName: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  squadCount: { fontSize: 12, textAlign: "center" },
  suggestionCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 16, borderWidth: 1, padding: 14,
  },
  suggestionIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  suggestionTitle: { fontSize: 15, fontWeight: "700" },
  suggestionSub: { fontSize: 12, marginTop: 2 },
  suggestionTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  suggestionTagText: { fontSize: 11, fontWeight: "700" },
  discoverSubtitle: { fontSize: 12, marginTop: 2 },
  discoverCard: {
    width: 152, borderRadius: 16, borderWidth: 1, padding: 14,
    gap: 8, justifyContent: "space-between",
  },
  discoverIconWrap: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  discoverEmoji: { fontSize: 22 },
  discoverTitle: { fontSize: 14, fontWeight: "700", lineHeight: 18 },
  discoverSub: { fontSize: 12 },
  discoverJoinBtn: { borderRadius: 10, paddingVertical: 7, alignItems: "center" },
  discoverJoinText: { fontSize: 12, fontWeight: "800", color: "#fff" },
  fabBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  fabGroup: {
    position: "absolute", bottom: 90, right: 24,
    alignItems: "flex-end", gap: 14, zIndex: 11,
  },
  fabOption: { flexDirection: "row", alignItems: "center", gap: 10 },
  fabOptionLabel: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
  },
  fabOptionText: { fontSize: 13, fontWeight: "700" },
  fabMini: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: "center", justifyContent: "center", borderWidth: 1.5,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  fabText: { fontSize: 26, color: "#fff", lineHeight: 30 },
  pickerBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
  },
  pickerSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20,
  },
  pickerHandle: {
    width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16,
  },
  pickerTitle: { fontSize: 18, fontWeight: "800", marginBottom: 4 },
  pickerSub: { fontSize: 13, marginBottom: 16 },
  pickerRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 14, borderBottomWidth: 1,
  },
  pickerSquadEmoji: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  pickerSquadName: { fontSize: 15, fontWeight: "700" },
  pickerSquadCount: { fontSize: 12, marginTop: 2 },
  inviteLinkBox: {
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16,
  },
  inviteLinkText: { fontSize: 13, lineHeight: 19 },
  inviteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 14, marginBottom: 10,
  },
  inviteBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  inviteDone: { alignItems: "center", paddingVertical: 10, marginBottom: 2 },
  inviteDoneText: { fontSize: 14, fontWeight: "600" },
  balanceRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  balanceEmoji: {
    width: 44, height: 44, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  balanceTitle: { fontSize: 14, fontWeight: "700" },
  balanceChip: { fontSize: 12, fontWeight: "600" },
  balanceNetBadge: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  balanceNetText: { fontSize: 13, fontWeight: "800" },
});
