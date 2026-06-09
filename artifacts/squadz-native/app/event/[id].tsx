import { useState, useEffect, useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
  Share,
  Alert,
  ActivityIndicator,
  Switch,
  Animated,
} from "react-native";
import { SettleUp } from "@/components/SettleUp";
import { addEventToCalendar, parseEventStart } from "@/lib/calendar";
import { scheduleRsvpReminder } from "@/lib/reminders";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useEventStream } from "@/hooks/useEventStream";
import { useData, useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { ContactSheet } from "@/components/ContactSheet";
import { goingCount } from "@/lib/eventUtils";
import type { RsvpStatus } from "@/types";
import { useUserCache, type ResolvedUser } from "@/context/UserCacheContext";

type EventTab = "overview" | "guests" | "tasks" | "food" | "costs" | "chat" | "photos" | "admin";

const EMOJIS = ["🔥", "🎉", "🎮", "🏖️", "🍕", "🎸", "⚽", "🎬", "🍻", "🎊"];

const STATUS_LABEL: Record<RsvpStatus, string> = {
  going: "Going",
  maybe: "Maybe",
  notgoing: "Can't go",
};

export default function EventDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const {
    getEvent,
    setRsvp,
    updateEvent,
    cancelEvent,
    toggleTask,
    claimTask,
    addTask,
    addCost,
    markSharePaid,
    confirmShare,
    ownPaymentHandles,
    fetchPaymentHandles,
    addPoll,
    votePoll,
    sendMessage,
    refreshEvents,
    getSquad,
    currentUser,
    conflictEventId,
    conflictSnapshot,
    clearConflictEvent,
  } = useData();

  const event = getEvent(id ?? "");
  const initialTab: EventTab =
    tabParam === "costs" ? "costs"
    : tabParam === "guests" ? "guests"
    : tabParam === "tasks" ? "tasks"
    : tabParam === "chat" ? "chat"
    : tabParam === "photos" ? "photos"
    : "overview";
  const [tab, setTab] = useState<EventTab>(initialTab);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactMember, setContactMember] = useState<ResolvedUser | null>(null);
  const { resolveUser, prefetchUsers } = useUserCache();

  // Pre-load all user profiles referenced in this event
  useEffect(() => {
    if (!event) return;
    const s = getSquad(event.squadId);
    const ids = [
      event.hostId,
      ...(s?.memberIds ?? []),
      ...Object.keys(event.rsvps),
      ...event.tasks.filter((t) => t.assigneeId).map((t) => t.assigneeId!),
      ...event.costs.map((c) => c.paidById),
      ...event.messages.map((m) => m.senderId),
    ];
    prefetchUsers(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);
  const [availabilityTitle, setAvailabilityTitle] = useState<string | null>(null);
  const [newResponseCount, setNewResponseCount] = useState(0);
  const { authToken } = useAuth();

  const authHeaders = useCallback((): HeadersInit => {
    return buildAuthHeaders(authToken);
  }, [authToken]);


  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      const avKey = `availability_lastviewed_${id}`;
      Promise.all([
        fetch(`${API_BASE}/api/availability/polls/find?eventId=${id}`, { headers: authHeaders() })
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

  // SSE stream: instantly refreshes event data (RSVPs, messages, tasks, costs,
  // polls) when any teammate mutates the event — no polling lag.
  useEventStream({
    eventId: id ?? null,
    authToken,
    onUpdate: useCallback(() => { void refreshEvents(); }, [refreshEvents]),
  });

  // 30 s safety-net poll: catches any updates missed when the stream is
  // temporarily unavailable (network blip, proxy timeout, etc.).
  useEffect(() => {
    const interval = setInterval(() => { void refreshEvents(); }, 30000);
    return () => clearInterval(interval);
  }, [refreshEvents]);

  // Load payment handles when the Costs tab is opened, to power settle-up deep links.
  useEffect(() => {
    if (tab !== "costs" || !id) return;
    let active = true;
    void fetchPaymentHandles(id).then((h) => {
      if (active) setPaymentHandles(h);
    });
    return () => { active = false; };
  }, [tab, id, fetchPaymentHandles]);

  // Modals
  const [taskModal, setTaskModal] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [foodModal, setFoodModal] = useState(false);
  const [newFoodItem, setNewFoodItem] = useState("");

  const [costModal, setCostModal] = useState(false);
  const [costDesc, setCostDesc] = useState("");
  const [costTotal, setCostTotal] = useState("");
  const [costShares, setCostShares] = useState<Record<string, string>>({});
  const [splitMode, setSplitMode] = useState<"even" | "manual">("even");
  const [taskSaving, setTaskSaving] = useState(false);
  const [costSaving, setCostSaving] = useState(false);
  const [pollSaving, setPollSaving] = useState(false);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [paymentHandles, setPaymentHandles] = useState<
    Record<string, { venmo: string | null; cashapp: string | null; zelle: string | null }>
  >({});
  const [calBusy, setCalBusy] = useState(false);
  const [remBusy, setRemBusy] = useState(false);

  const [togglingTaskIds, setTogglingTaskIds] = useState<Set<string>>(new Set());
  const [claimingTaskIds, setClaimingTaskIds] = useState<Set<string>>(new Set());

  const handleToggleTask = useCallback(async (eventId: string, taskId: string) => {
    if (togglingTaskIds.has(taskId)) return;
    setTogglingTaskIds((prev) => new Set(prev).add(taskId));
    try {
      await toggleTask(eventId, taskId);
    } finally {
      setTogglingTaskIds((prev) => { const next = new Set(prev); next.delete(taskId); return next; });
    }
  }, [togglingTaskIds, toggleTask]);

  const handleClaimTask = useCallback(async (eventId: string, taskId: string) => {
    if (claimingTaskIds.has(taskId)) return;
    setClaimingTaskIds((prev) => new Set(prev).add(taskId));
    try {
      await claimTask(eventId, taskId);
    } finally {
      setClaimingTaskIds((prev) => { const next = new Set(prev); next.delete(taskId); return next; });
    }
  }, [claimingTaskIds, claimTask]);

  const [pollModal, setPollModal] = useState(false);
  const [pollQ, setPollQ] = useState("");
  const [pollOpts, setPollOpts] = useState<string[]>(["", ""]);

  const [editModal, setEditModal] = useState(false);
  const [edit, setEdit] = useState({ title: "", date: "", location: "", description: "", emoji: "🔥" });

  const [budgetModal, setBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");

  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);

  const conflictBannerAnim = useRef(new Animated.Value(0)).current;
  const titleHighlightAnim = useRef(new Animated.Value(0)).current;
  const dateHighlightAnim = useRef(new Animated.Value(0)).current;
  const locationHighlightAnim = useRef(new Animated.Value(0)).current;
  const descHighlightAnim = useRef(new Animated.Value(0)).current;
  const tasksHighlightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!id || conflictEventId !== id) return;
    clearConflictEvent();

    // Banner animation
    Animated.sequence([
      Animated.timing(conflictBannerAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.delay(2500),
      Animated.timing(conflictBannerAnim, { toValue: 0, duration: 350, useNativeDriver: false }),
    ]).start();

    if (!event) return;

    // Diff snapshot against the freshly-loaded event to find changed fields
    const fieldAnims: Animated.Value[] = [];
    if (conflictSnapshot && conflictSnapshot.eventId === id) {
      const s = conflictSnapshot;
      if (s.title !== event.title) fieldAnims.push(titleHighlightAnim);
      if (s.date !== event.date) fieldAnims.push(dateHighlightAnim);
      if (s.location !== event.location) fieldAnims.push(locationHighlightAnim);
      if (s.description !== event.description) fieldAnims.push(descHighlightAnim);
      if (JSON.stringify(s.tasks) !== JSON.stringify(event.tasks)) fieldAnims.push(tasksHighlightAnim);
    }
    // If snapshot is absent or nothing diffed, highlight all editable fields as a safe fallback
    const toAnimate = fieldAnims.length > 0
      ? fieldAnims
      : [titleHighlightAnim, dateHighlightAnim, locationHighlightAnim, descHighlightAnim, tasksHighlightAnim];

    toAnimate.forEach((anim) => {
      anim.setValue(0);
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.delay(2000),
        Animated.timing(anim, { toValue: 0, duration: 600, useNativeDriver: false }),
      ]).start();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictEventId, id]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const btnTop = topPad + 8;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never));

  if (!event) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Event not found</Text>
      </View>
    );
  }

  const isHost = event.hostId === currentUser.id;
  const squad = getSquad(event.squadId);

  function resolveForDisplay(userId: string): ResolvedUser {
    if (userId === currentUser.id) return currentUser as unknown as ResolvedUser;
    return resolveUser(userId);
  }

  const host = resolveForDisplay(event.hostId);
  const squadMembers = squad ? squad.memberIds.map((mid) => resolveForDisplay(mid)) : [resolveForDisplay(currentUser.id)];
  const squadName = squad?.name ?? event.squadName;
  const myRsvp = event.rsvps[currentUser.id] ?? null;

  // All RSVP'd users (includes invite-link joiners who aren't squad members)
  const costParticipants = Object.keys(event.rsvps).map((uid) => resolveUser(uid));

  const spent = event.costs.reduce((s, c) => s + c.amount, 0);
  const hasBudget = event.budget != null;
  const budgetVal = event.budget ?? 0;
  const budgetRemaining = budgetVal - spent;
  const budgetPct = budgetVal > 0 ? Math.min(100, (spent / budgetVal) * 100) : 0;
  const budgetPerPerson = budgetVal / Math.max(1, costParticipants.length);
  const budgetOver = budgetRemaining < 0;

  const attendees = Object.entries(event.rsvps).map(([uid, status]) => ({
    user: resolveForDisplay(uid),
    status,
  }));

  const statusColor = (s: RsvpStatus) =>
    s === "going" ? colors.green : s === "maybe" ? colors.gold : colors.destructive;

  const handleAddToCalendar = async () => {
    if (calBusy) return;
    const start = parseEventStart(event.date);
    if (!start) {
      Alert.alert("Can't add to calendar", "This event doesn't have a clear date yet.");
      return;
    }
    setCalBusy(true);
    try {
      const res = await addEventToCalendar({
        title: `${event.emoji} ${event.title}`.trim(),
        start,
        location: event.location || undefined,
        notes: event.description || undefined,
      });
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (res.method === "calendar") {
          Alert.alert("Added to calendar", `${event.title} is on your calendar.`);
        }
      } else {
        Alert.alert("Couldn't add to calendar", res.message ?? "Please try again.");
      }
    } catch {
      Alert.alert("Couldn't add to calendar", "Something went wrong. Please try again.");
    } finally {
      setCalBusy(false);
    }
  };

  const handleRemindRsvp = async () => {
    if (remBusy) return;
    const start = parseEventStart(event.date);
    if (!start) {
      Alert.alert("Can't set a reminder", "This event doesn't have a clear date yet.");
      return;
    }
    setRemBusy(true);
    try {
      const res = await scheduleRsvpReminder({ title: event.title, start });
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Reminder set", res.whenLabel ? `We'll nudge you on ${res.whenLabel}.` : "We'll remind you to RSVP.");
      } else {
        Alert.alert("No reminder set", res.message ?? "Please try again.");
      }
    } catch {
      Alert.alert("No reminder set", "Something went wrong. Please try again.");
    } finally {
      setRemBusy(false);
    }
  };

  const TABS: { key: EventTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "guests", label: "Guests" },
    { key: "tasks", label: "Tasks" },
    { key: "food", label: "🍕 Food" },
    { key: "costs", label: "Costs" },
    { key: "chat", label: "Chat" },
    { key: "photos", label: "📷 Photos" },
    ...(isHost ? [{ key: "admin" as EventTab, label: "Admin" }] : []),
  ];

  // ---- Cost modal helpers ----
  const openCostModal = () => {
    setCostDesc("");
    setCostTotal("");
    setCostShares({});
    setSplitMode("even");
    setSelectedParticipantIds(new Set(Object.keys(event.rsvps)));
    setCostModal(true);
  };
  const totalNum = parseFloat(costTotal) || 0;

  // Only include participants that the user has selected for this split
  const splitParticipants = costParticipants.filter((m) => selectedParticipantIds.has(m.id));

  const toggleSplitParticipant = (uid: string) => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  };

  // Compute even-split shares inline so they stay in sync with the total
  const evenShares: Record<string, string> = {};
  if (totalNum > 0 && splitParticipants.length > 0) {
    const per = Math.floor((totalNum / splitParticipants.length) * 100) / 100;
    let running = 0;
    splitParticipants.forEach((m, i) => {
      if (i === splitParticipants.length - 1) {
        evenShares[m.id] = (Math.round((totalNum - running) * 100) / 100).toFixed(2);
      } else {
        evenShares[m.id] = per.toFixed(2);
        running += per;
      }
    });
  }

  const activeShares = splitMode === "even" ? evenShares : costShares;
  const shareValues = splitParticipants.map((m) => parseFloat(activeShares[m.id] || "0") || 0);
  const hasNegative = shareValues.some((v) => v < 0);
  const assignedNum = shareValues.reduce((sum, v) => sum + v, 0);
  const remaining = totalNum - assignedNum;
  const covered = totalNum > 0 && splitParticipants.length > 0 && !hasNegative && Math.abs(remaining) < 0.01;

  const switchToManual = () => {
    // Copy current even-split values so the user has a good starting point
    setCostShares({ ...evenShares });
    setSplitMode("manual");
  };

  const saveCost = async () => {
    if (costSaving) return;
    if (!costDesc.trim()) {
      Alert.alert("Missing info", "Add a description for the expense.");
      return;
    }
    if (totalNum <= 0) {
      Alert.alert("Missing amount", "Enter a total greater than $0.");
      return;
    }
    if (splitParticipants.length === 0) {
      Alert.alert("No one selected", "Select at least one person to split the cost with.");
      return;
    }
    if (hasNegative) {
      Alert.alert("Invalid amount", "Shares can't be negative. Enter $0 or more for each person.");
      return;
    }
    if (!covered) {
      Alert.alert("Bill not covered", `Assign the full $${totalNum.toFixed(2)} across people. $${remaining.toFixed(2)} left.`);
      return;
    }
    const shares = splitParticipants
      .map((m) => ({ userId: m.id, amount: parseFloat(activeShares[m.id] || "0") || 0 }))
      .filter((s) => s.amount > 0);
    setCostSaving(true);
    try {
      const result = await addCost(event.id, { description: costDesc.trim(), amount: totalNum, shares });
      if (result.error) {
        Alert.alert("Couldn't save expense", result.error);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCostModal(false);
    } finally {
      setCostSaving(false);
    }
  };

  // ---- Task modal ----
  const saveTask = async () => {
    if (taskSaving || !newTask.trim()) return;
    setTaskSaving(true);
    try {
      const result = await addTask(event.id, newTask.trim());
      if (result.error) {
        Alert.alert("Couldn't save task", result.error);
        return;
      }
      setNewTask("");
      setTaskModal(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } finally {
      setTaskSaving(false);
    }
  };

  const saveFoodItem = async () => {
    if (!newFoodItem.trim()) return;
    const result = await addTask(event.id, newFoodItem.trim(), "food");
    if (result.error) {
      Alert.alert("Couldn't add food item", result.error);
      return;
    }
    setNewFoodItem("");
    setFoodModal(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ---- Poll modal ----
  const savePoll = async () => {
    if (pollSaving) return;
    const opts = pollOpts.map((o) => o.trim()).filter(Boolean);
    if (!pollQ.trim() || opts.length < 2) {
      Alert.alert("Incomplete poll", "Add a question and at least 2 options.");
      return;
    }
    setPollSaving(true);
    try {
      const result = await addPoll(event.id, pollQ.trim(), opts);
      if (result.error) {
        Alert.alert("Couldn't save poll", result.error);
        return;
      }
      setPollQ("");
      setPollOpts(["", ""]);
      setPollModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } finally {
      setPollSaving(false);
    }
  };

  // ---- Edit modal ----
  const openEdit = () => {
    setEdit({
      title: event.title,
      date: event.date,
      location: event.location,
      description: event.description,
      emoji: event.emoji,
    });
    setEditModal(true);
  };
  const saveEdit = () => {
    if (!edit.title.trim()) {
      Alert.alert("Missing info", "Event needs a title.");
      return;
    }
    updateEvent(event.id, {
      title: edit.title.trim(),
      date: edit.date.trim(),
      location: edit.location.trim(),
      description: edit.description.trim(),
      emoji: edit.emoji,
    });
    setEditModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const confirmCancel = () => {
    Alert.alert("Cancel event", `Cancel "${event.title}"? This can't be undone.`, [
      { text: "Keep event", style: "cancel" },
      {
        text: "Cancel event",
        style: "destructive",
        onPress: () => {
          cancelEvent(event.id);
          goBack();
        },
      },
    ]);
  };

  const openBudget = () => {
    setBudgetInput(event.budget != null ? String(event.budget) : "");
    setBudgetModal(true);
  };
  const saveBudget = () => {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val < 0) {
      Alert.alert("Invalid budget", "Enter a budget of $0 or more.");
      return;
    }
    updateEvent(event.id, { budget: val });
    setBudgetModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  const clearBudget = () => {
    updateEvent(event.id, { budget: undefined });
    setBudgetModal(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Hero */}
      <View style={[styles.hero, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={goBack} style={[styles.backBtn, { top: btnTop }]}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Share.share({ message: `Join ${event.title}! Code: ${event.inviteCode}` })}
          style={[styles.shareBtn, { top: btnTop }]}
        >
          <Ionicons name="share-outline" size={22} color="#fff" />
        </TouchableOpacity>
        {isHost && (
          <TouchableOpacity onPress={openEdit} style={[styles.gearBtn, { top: btnTop }]}>
            <Ionicons name="settings-outline" size={21} color="#fff" />
          </TouchableOpacity>
        )}
        <Text style={styles.heroEmoji}>{event.emoji}</Text>
        <Animated.View
          style={[
            styles.heroTitleRow,
            {
              backgroundColor: titleHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.28)"] }),
              borderRadius: 10,
              paddingHorizontal: 6,
              paddingVertical: 2,
            },
          ]}
        >
          <Text style={styles.heroTitle}>{event.title}</Text>
          {isHost && (
            <View style={styles.heroHostBadge}>
              <Ionicons name="star" size={11} color="#fff" />
              <Text style={styles.heroHostText}>You're hosting</Text>
            </View>
          )}
        </Animated.View>
        <Animated.View
          style={{
            backgroundColor: dateHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.28)"] }),
            borderRadius: 8,
            paddingHorizontal: 6,
            alignSelf: "center",
          }}
        >
          <Text style={styles.heroDate}>{event.date}</Text>
        </Animated.View>
        <Animated.View
          style={{
            backgroundColor: locationHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.28)"] }),
            borderRadius: 8,
            paddingHorizontal: 6,
            marginBottom: 14,
            alignSelf: "center",
          }}
        >
          <Text style={[styles.heroLocation, { marginBottom: 0 }]}>{event.location}</Text>
        </Animated.View>

        {/* RSVP buttons */}
        <View style={styles.rsvpRow}>
          {(["going", "maybe", "notgoing"] as RsvpStatus[]).map((v) => (
            <TouchableOpacity
              key={v}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setRsvp(event.id, v); }}
              style={[
                styles.rsvpBtn,
                {
                  backgroundColor: myRsvp === v ? statusColor(v) : "rgba(255,255,255,0.15)",
                  borderColor: myRsvp === v ? "transparent" : "rgba(255,255,255,0.3)",
                },
              ]}
            >
              <Ionicons
                name={v === "going" ? "checkmark" : v === "maybe" ? "help" : "close"}
                size={15}
                color="#fff"
              />
              <Text style={styles.rsvpText}>{STATUS_LABEL[v]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabBar, { borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 4 }}
      >
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(t.key); }}
            style={[
              styles.tabChip,
              {
                backgroundColor: tab === t.key ? colors.primary : "transparent",
                borderColor: tab === t.key ? colors.primary : "transparent",
              },
            ]}
          >
            <Text style={[styles.tabChipText, { color: tab === t.key ? "#fff" : colors.mutedForeground }]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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

      {/* Tab content */}
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={{ padding: 20, paddingBottom: botPad + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {tab === "overview" && (
          <View style={{ gap: 16 }}>
            <Animated.View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: descHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: [colors.border, "#F59E0B"] }),
                },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>About</Text>
              <Text style={[styles.cardBody, { color: event.description ? colors.foreground : colors.textDim }]}>
                {event.description || "No description yet."}
              </Text>
            </Animated.View>

            {/* Find the best time */}
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/availability", params: { eventId: event.id } } as never);
              }}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12 }]}
            >
              <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary + "20" }}>
                <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardBody, { color: colors.foreground, fontWeight: "700" }]}>{availabilityTitle ?? "Find the Best Time"}</Text>
                <Text style={[styles.cardBody, { color: colors.mutedForeground, fontSize: 13 }]}>Poll everyone & lock in when most can make it</Text>
              </View>
              {newResponseCount > 0 && (
                <View style={[styles.responseBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.responseBadgeText}>{newResponseCount}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </TouchableOpacity>

            {/* Calendar sync + RSVP reminder */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 10 }]}>
              <TouchableOpacity
                onPress={handleAddToCalendar}
                disabled={calBusy}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: calBusy ? 0.6 : 1 }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary + "20" }}>
                  {calBusy ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardBody, { color: colors.foreground, fontWeight: "700" }]}>Add to Calendar</Text>
                  <Text style={[styles.cardBody, { color: colors.mutedForeground, fontSize: 13 }]}>Save the date so you don't forget</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </TouchableOpacity>

              {myRsvp == null && (
                <>
                  <View style={{ height: 1, backgroundColor: colors.border }} />
                  <TouchableOpacity
                    onPress={handleRemindRsvp}
                    disabled={remBusy}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: remBusy ? 0.6 : 1 }}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.gold + "20" }}>
                      {remBusy ? (
                        <ActivityIndicator size="small" color={colors.gold} />
                      ) : (
                        <Ionicons name="notifications-outline" size={18} color={colors.gold} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardBody, { color: colors.foreground, fontWeight: "700" }]}>Remind me to RSVP</Text>
                      <Text style={[styles.cardBody, { color: colors.mutedForeground, fontSize: 13 }]}>Get a nudge before it starts</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Polls */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Polls</Text>
                <TouchableOpacity onPress={() => setPollModal(true)} style={styles.inlineAdd}>
                  <Ionicons name="add" size={16} color={colors.primary} />
                  <Text style={[styles.inlineAddText, { color: colors.primary }]}>New poll</Text>
                </TouchableOpacity>
              </View>
              {event.polls.length === 0 ? (
                <Text style={[styles.cardBody, { color: colors.textDim }]}>No polls yet. Start one to decide together.</Text>
              ) : (
                event.polls.map((poll) => {
                  const totalVotes = poll.options.reduce((s, o) => s + o.voterIds.length, 0);
                  return (
                    <View key={poll.id} style={{ gap: 8, marginTop: 4 }}>
                      <Text style={[styles.pollQ, { color: colors.foreground }]}>{poll.question}</Text>
                      {poll.options.map((o) => {
                        const pct = totalVotes ? Math.round((o.voterIds.length / totalVotes) * 100) : 0;
                        const voted = o.voterIds.includes(currentUser.id);
                        return (
                          <TouchableOpacity
                            key={o.id}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); votePoll(event.id, poll.id, o.id); }}
                            style={[styles.pollOpt, { borderColor: voted ? colors.primary : colors.border }]}
                          >
                            <View style={[styles.pollFill, { width: `${pct}%`, backgroundColor: colors.primary + "22" }]} />
                            <View style={styles.pollOptRow}>
                              <Ionicons
                                name={voted ? "radio-button-on" : "radio-button-off"}
                                size={16}
                                color={voted ? colors.primary : colors.textDim}
                              />
                              <Text style={[styles.pollOptLabel, { color: colors.foreground }]}>{o.label}</Text>
                              <Text style={[styles.pollPct, { color: colors.mutedForeground }]}>{pct}%</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                      <Text style={[styles.pollMeta, { color: colors.textDim }]}>
                        {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Host</Text>
              <View style={styles.hostRow}>
                <UserAvatar initials={host.initials} color={host.color} imageUrl={host.profileImageUrl} size={40} fontSize={14} />
                <Text style={[styles.hostName, { color: colors.foreground }]}>{host.name}{isHost ? " (You)" : ""}</Text>
              </View>
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Squad</Text>
              <Text style={[styles.cardBody, { color: colors.foreground }]}>{squadName}</Text>
            </View>

            {/* Invite code — visible to all members */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Invite friends</Text>
              <Text style={[styles.inviteCode, { color: colors.primary, marginBottom: 4 }]}>{event.inviteCode}</Text>
              <Text style={[styles.inviteLink, { color: colors.mutedForeground, marginBottom: 12 }]}>
                joinsquadz.com/join/{event.inviteCode}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  Share.share({ message: `Join ${event.title}! https://joinsquadz.com/join/${event.inviteCode}` });
                }}
                style={[styles.shareInviteBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}
              >
                <Ionicons name="share-outline" size={16} color={colors.primary} />
                <Text style={[styles.shareInviteText, { color: colors.primary }]}>Share invite link</Text>
              </TouchableOpacity>
            </View>

            {isHost && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name="globe-outline" size={20} color={colors.foreground} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground, textTransform: "none" }]}>Public event</Text>
                    <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                      {event.isPublic
                        ? "Visible on Discover — friends can join directly"
                        : "Only joinable via invite code"}
                    </Text>
                  </View>
                  <Switch
                    value={event.isPublic ?? false}
                    onValueChange={(v) => { updateEvent(event.id, { isPublic: v }); }}
                    trackColor={{ false: colors.border, true: colors.primary + "80" }}
                    thumbColor={event.isPublic ? colors.primary : colors.mutedForeground}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {tab === "guests" && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {goingCount(event)} going · {attendees.length} responded
            </Text>
            {attendees.map(({ user: u, status }) => (
              <TouchableOpacity
                key={u.id}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.selectionAsync();
                  setContactMember(u);
                  setContactOpen(true);
                }}
                style={[styles.guestRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={44} fontSize={15} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.guestName, { color: colors.foreground }]}>{u.name}{u.id === currentUser.id ? " (You)" : ""}</Text>
                  <Text style={[styles.guestStatus, { color: statusColor(status) }]}>{STATUS_LABEL[status]}</Text>
                </View>
                {u.id === event.hostId && (
                  <View style={[styles.hostBadge, { backgroundColor: colors.gold + "20", borderColor: colors.gold + "40" }]}>
                    <Text style={[styles.hostBadgeText, { color: colors.gold }]}>Host</Text>
                  </View>
                )}
                {u.id !== currentUser.id && (
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {tab === "tasks" && (
          <Animated.View
            style={{
              gap: 8,
              borderRadius: 14,
              borderWidth: 2,
              borderColor: tasksHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.8)"] }),
              padding: 2,
            }}
          >
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {event.tasks.filter((t) => t.done).length}/{event.tasks.length} complete
            </Text>
            {event.tasks.map((task) => {
              const assignee = task.assigneeId ? resolveForDisplay(task.assigneeId) : null;
              const toggling = togglingTaskIds.has(task.id);
              const claiming = claimingTaskIds.has(task.id);
              return (
                <View key={task.id} style={[styles.taskRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: toggling ? 0.6 : 1 }]}>
                  <TouchableOpacity
                    disabled={toggling}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void handleToggleTask(event.id, task.id); }}
                  >
                    {toggling ? (
                      <ActivityIndicator size={24} color={colors.primary} />
                    ) : (
                      <Ionicons
                        name={task.done ? "checkmark-circle" : "ellipse-outline"}
                        size={24}
                        color={task.done ? colors.green : colors.border}
                      />
                    )}
                  </TouchableOpacity>
                  <Text style={[styles.taskText, { color: task.done ? colors.mutedForeground : colors.foreground, textDecorationLine: task.done ? "line-through" : "none" }]}>
                    {task.title}
                  </Text>
                  {assignee ? (
                    <UserAvatar initials={assignee.initials} color={assignee.color} imageUrl={assignee.profileImageUrl} size={28} fontSize={10} />
                  ) : (
                    <TouchableOpacity
                      disabled={claiming}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void handleClaimTask(event.id, task.id); }}
                      style={[styles.claimBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40", opacity: claiming ? 0.6 : 1 }]}
                    >
                      {claiming ? (
                        <ActivityIndicator size={12} color={colors.primary} />
                      ) : (
                        <Text style={[styles.claimText, { color: colors.primary }]}>Claim</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            <TouchableOpacity
              onPress={() => setTaskModal(true)}
              style={[styles.addRow, { borderColor: colors.border }]}
            >
              <Ionicons name="add" size={20} color={colors.primary} />
              <Text style={[styles.addText, { color: colors.primary }]}>Add task</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {tab === "food" && (
          <View style={{ gap: 8 }}>
            {(() => {
              const foodItems = event.tasks.filter((t) => (t as { category?: string }).category === "food");
              const claimedCount = foodItems.filter((t) => t.assigneeId ?? t.done).length;
              return (
                <>
                  {foodItems.length > 0 && (
                    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                      {claimedCount}/{foodItems.length} claimed
                    </Text>
                  )}
                  {foodItems.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={{ fontSize: 36, marginBottom: 8 }}>🍕</Text>
                      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No food list yet</Text>
                      <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Add dishes and let people claim what they're bringing</Text>
                    </View>
                  ) : (
                    foodItems.map((task) => {
                      const assignee = task.assigneeId ? resolveForDisplay(task.assigneeId) : null;
                      const toggling = togglingTaskIds.has(task.id);
                      const claiming = claimingTaskIds.has(task.id);
                      return (
                        <View key={task.id} style={[styles.taskRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: toggling ? 0.6 : 1 }]}>
                          <TouchableOpacity
                            disabled={toggling}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void handleToggleTask(event.id, task.id); }}
                          >
                            {toggling ? (
                              <ActivityIndicator size={24} color={colors.primary} />
                            ) : (
                              <Ionicons
                                name={task.done ? "checkmark-circle" : "ellipse-outline"}
                                size={24}
                                color={task.done ? colors.green : colors.border}
                              />
                            )}
                          </TouchableOpacity>
                          <Text style={[styles.taskText, { color: task.done ? colors.mutedForeground : colors.foreground, textDecorationLine: task.done ? "line-through" : "none" }]}>
                            {task.title}
                          </Text>
                          {assignee ? (
                            <UserAvatar initials={assignee.initials} color={assignee.color} imageUrl={assignee.profileImageUrl} size={28} fontSize={10} />
                          ) : (
                            <TouchableOpacity
                              disabled={claiming}
                              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void handleClaimTask(event.id, task.id); }}
                              style={[styles.claimBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40", opacity: claiming ? 0.6 : 1 }]}
                            >
                              {claiming ? (
                                <ActivityIndicator size={12} color={colors.primary} />
                              ) : (
                                <Text style={[styles.claimText, { color: colors.primary }]}>I'll bring it</Text>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })
                  )}
                  <TouchableOpacity
                    onPress={() => setFoodModal(true)}
                    style={[styles.addRow, { borderColor: colors.border }]}
                  >
                    <Ionicons name="add" size={20} color={colors.primary} />
                    <Text style={[styles.addText, { color: colors.primary }]}>Add food item</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        )}

        {tab === "costs" && (
          <View style={{ gap: 8 }}>
            {hasBudget ? (
              <View style={[styles.budgetCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.budgetHead}>
                  <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Group budget</Text>
                  {isHost && (
                    <TouchableOpacity onPress={openBudget} style={styles.budgetEdit}>
                      <Ionicons name="create-outline" size={15} color={colors.primary} />
                      <Text style={[styles.budgetEditText, { color: colors.primary }]}>Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={[styles.budgetAmount, { color: colors.foreground }]}>${budgetVal.toFixed(2)}</Text>
                <View style={[styles.budgetTrack, { backgroundColor: colors.surfaceUp }]}>
                  <View style={[styles.budgetFill, { width: `${budgetPct}%`, backgroundColor: budgetOver ? colors.destructive : colors.green }]} />
                </View>
                <View style={styles.budgetMetaRow}>
                  <Text style={[styles.budgetMeta, { color: colors.mutedForeground }]}>${spent.toFixed(2)} spent</Text>
                  <Text style={[styles.budgetMeta, { color: budgetOver ? colors.destructive : colors.green }]}>
                    {budgetOver ? `$${Math.abs(budgetRemaining).toFixed(2)} over` : `$${budgetRemaining.toFixed(2)} left`}
                  </Text>
                </View>
                <Text style={[styles.budgetPer, { color: colors.textDim }]}>≈ ${budgetPerPerson.toFixed(2)} per person</Text>
              </View>
            ) : isHost ? (
              <TouchableOpacity onPress={openBudget} style={[styles.addRow, { borderColor: colors.border }]}>
                <Ionicons name="wallet-outline" size={20} color={colors.primary} />
                <Text style={[styles.addText, { color: colors.primary }]}>Set group budget</Text>
              </TouchableOpacity>
            ) : null}
            {event.costs.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="card-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No expenses yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Add a bill and split it with your squad</Text>
              </View>
            ) : (
              <>
                <View style={[styles.totalsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View>
                    <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Total spent</Text>
                    <Text style={[styles.totalsValue, { color: colors.foreground }]}>
                      ${event.costs.reduce((s, c) => s + c.amount, 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Your share</Text>
                    <Text style={[styles.totalsValue, { color: colors.primary }]}>
                      ${event.costs.reduce((s, c) => s + (c.shares.find((sh) => sh.userId === currentUser.id)?.amount ?? 0), 0).toFixed(2)}
                    </Text>
                  </View>
                </View>
                <SettleUp
                  costs={event.costs}
                  meId={currentUser.id}
                  eventTitle={event.title}
                  colors={colors}
                  handles={{
                    ...paymentHandles,
                    [currentUser.id]: {
                      venmo: ownPaymentHandles.venmo,
                      cashapp: ownPaymentHandles.cashapp,
                      zelle: ownPaymentHandles.zelle,
                    },
                  }}
                  resolveUser={resolveForDisplay}
                  onMarkPaid={(costId, paid) => markSharePaid(event.id, costId, paid)}
                  onConfirm={(costId, debtorId, confirmed) => confirmShare(event.id, costId, debtorId, confirmed)}
                />
                {event.costs.map((cost) => {
                  const payer = resolveForDisplay(cost.paidById);
                  const myShare = cost.shares.find((s) => s.userId === currentUser.id)?.amount ?? 0;
                  const shareIds = cost.shares.map((s) => s.userId);
                  const goingIds = Object.entries(event.rsvps)
                    .filter(([, status]) => status === "going")
                    .map(([uid]) => uid);
                  const isAllGuests =
                    goingIds.length > 0 &&
                    goingIds.length === shareIds.length &&
                    goingIds.every((uid) => shareIds.includes(uid));
                  const participantLabel = isAllGuests
                    ? "All guests"
                    : shareIds
                        .map((uid) => {
                          if (uid === currentUser.id) return "you";
                          const u = resolveForDisplay(uid);
                          return u.name.split(" ")[0];
                        })
                        .join(", ");
                  return (
                    <View key={cost.id} style={[styles.costRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.costDesc, { color: colors.foreground }]}>{cost.description}</Text>
                        <Text style={[styles.costPayer, { color: colors.mutedForeground }]}>
                          Paid by {payer.id === currentUser.id ? "you" : payer.name}
                        </Text>
                        <Text style={[styles.costPayer, { color: colors.mutedForeground }]} numberOfLines={2}>
                          Split with: {participantLabel}
                        </Text>
                      </View>
                      <View style={styles.costRight}>
                        <Text style={[styles.costTotal, { color: colors.foreground }]}>${cost.amount.toFixed(2)}</Text>
                        <Text style={[styles.costShare, { color: colors.mutedForeground }]}>
                          you owe ${myShare.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
            <TouchableOpacity
              onPress={openCostModal}
              style={[styles.addRow, { borderColor: colors.border }]}
            >
              <Ionicons name="add" size={20} color={colors.primary} />
              <Text style={[styles.addText, { color: colors.primary }]}>Add expense</Text>
            </TouchableOpacity>
          </View>
        )}

        {tab === "photos" && (
          <View style={{ gap: 16 }}>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/vault?eventId=${event.id}&eventName=${encodeURIComponent(event.title)}` as never);
              }}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.cardHeaderRow}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>📷 Event Photos</Text>
                  <Text style={[styles.cardBody, { color: colors.foreground }]}>View all photos from {event.title}</Text>
                  <Text style={[styles.cardTitle, { color: colors.mutedForeground, marginTop: 4 }]}>Stored in Photo Vault · private to squad members</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
              </View>
            </TouchableOpacity>
            <View style={styles.vaultPhotoGrid}>
              {[
                { color: "#FF6B3A", emoji: "🔥" },
                { color: "#7B6EF6", emoji: "🎳" },
                { color: "#F5A623", emoji: "🍕" },
              ].map((p, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push(`/vault?eventId=${event.id}&eventName=${encodeURIComponent(event.title)}` as never);
                  }}
                  style={[styles.vaultGridCell, { backgroundColor: p.color + "30" }]}
                  activeOpacity={0.8}
                >
                  <Text style={styles.vaultGridEmoji}>{p.emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push(`/vault?eventId=${event.id}&eventName=${encodeURIComponent(event.title)}` as never);
              }}
              style={[styles.vaultCta, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}
              activeOpacity={0.8}
            >
              <Ionicons name="images-outline" size={18} color={colors.primary} />
              <Text style={[styles.vaultCtaText, { color: colors.primary }]}>Open Photo Vault for this event</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </TouchableOpacity>
          </View>
        )}

        {tab === "chat" && (
          <View style={{ gap: 12 }}>
            {event.messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="chatbubbles-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Say hi to your squad below</Text>
              </View>
            ) : (
              event.messages.map((m) => {
                const sender = resolveForDisplay(m.senderId);
                const mine = m.senderId === currentUser.id;
                return (
                  <View key={m.id} style={[styles.msgRow, mine && { flexDirection: "row-reverse" }]}>
                    <UserAvatar initials={sender.initials} color={sender.color} imageUrl={sender.profileImageUrl} size={32} fontSize={11} />
                    <View style={[styles.msgBubble, { backgroundColor: mine ? colors.primary : colors.card, borderColor: colors.border }]}>
                      {!mine && <Text style={[styles.msgSender, { color: colors.mutedForeground }]}>{sender.name.split(" ")[0]}</Text>}
                      <Text style={[styles.msgText, { color: mine ? "#fff" : colors.foreground }]}>{m.text}</Text>
                      <Text style={[styles.msgTime, { color: mine ? "rgba(255,255,255,0.7)" : colors.textDim }]}>{m.time}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {tab === "admin" && (
          <View style={{ gap: 12 }}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Invite code</Text>
              <Text style={[styles.inviteCode, { color: colors.primary }]}>{event.inviteCode}</Text>
              <Text style={[styles.inviteLink, { color: colors.mutedForeground }]}>
                joinsquadz.com/join/{event.inviteCode}
              </Text>
              <TouchableOpacity
                onPress={() => Share.share({ message: `Join ${event.title}! https://joinsquadz.com/join/${event.inviteCode}` })}
                style={[styles.shareInviteBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}
              >
                <Ionicons name="share-outline" size={16} color={colors.primary} />
                <Text style={[styles.shareInviteText, { color: colors.primary }]}>Share invite</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={openEdit}
              style={[styles.adminRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="create-outline" size={20} color={colors.foreground} />
              <Text style={[styles.adminLabel, { color: colors.foreground }]}>Edit event details</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); Alert.alert("Reminder sent", "Your guests have been nudged about this event."); }}
              style={[styles.adminRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.foreground} />
              <Text style={[styles.adminLabel, { color: colors.foreground }]}>Send reminder to guests</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirmCancel}
              style={[styles.adminRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="trash-outline" size={20} color={colors.destructive} />
              <Text style={[styles.adminLabel, { color: colors.destructive }]}>Cancel event</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Chat composer */}
      {tab === "chat" && (
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: botPad + 10 }]}>
          <TextInput
            placeholder="Message your squad..."
            placeholderTextColor={colors.textDim}
            value={chatText}
            onChangeText={setChatText}
            style={[styles.composerInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />
          <TouchableOpacity
            onPress={async () => {
              if (chatSending || !chatText.trim()) return;
              const text = chatText.trim();
              setChatText("");
              setChatSending(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              try {
                const result = await sendMessage(event.id, text);
                if (result.error) {
                  setChatText(text);
                  Alert.alert("Couldn't send message", result.error);
                }
              } finally {
                setChatSending(false);
              }
            }}
            disabled={chatSending || !chatText.trim()}
            style={[styles.sendBtn, { backgroundColor: chatText.trim() && !chatSending ? colors.primary : colors.border }]}
          >
            {chatSending ? (
              <ActivityIndicator size="small" color={colors.textDim} />
            ) : (
              <Ionicons name="send" size={18} color={chatText.trim() ? "#fff" : colors.textDim} />
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Add Food Item Modal ---- */}
      <Modal visible={foodModal} transparent animationType="fade" onRequestClose={() => setFoodModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add to food list</Text>
            <TextInput
              placeholder="e.g. Chips & dip, veggie platter…"
              placeholderTextColor={colors.textDim}
              value={newFoodItem}
              onChangeText={setNewFoodItem}
              autoFocus
              style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setNewFoodItem(""); setFoodModal(false); }} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { void saveFoodItem(); }} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Add item</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Add Task Modal ---- */}
      <Modal visible={taskModal} transparent animationType="fade" onRequestClose={() => setTaskModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add a task</Text>
            <TextInput
              placeholder="e.g. Bring the speaker"
              placeholderTextColor={colors.textDim}
              value={newTask}
              onChangeText={setNewTask}
              autoFocus
              style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setNewTask(""); setTaskModal(false); }} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveTask}
                disabled={taskSaving}
                style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: taskSaving ? 0.6 : 1 }]}
              >
                {taskSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff" }]}>Add task</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Add Expense Modal ---- */}
      <Modal visible={costModal} transparent animationType="slide" onRequestClose={() => setCostModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add expense</Text>
            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
              You paid. Choose how to split the bill.
            </Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <TextInput
                placeholder="What's it for? (e.g. Pizza)"
                placeholderTextColor={colors.textDim}
                value={costDesc}
                onChangeText={setCostDesc}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              <View style={[styles.modalInput, styles.amountRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.dollar, { color: colors.mutedForeground }]}>$</Text>
                <TextInput
                  placeholder="0.00"
                  placeholderTextColor={colors.textDim}
                  value={costTotal}
                  onChangeText={setCostTotal}
                  keyboardType="decimal-pad"
                  style={[styles.amountInput, { color: colors.foreground }]}
                />
              </View>

              {/* Participant picker — only show when there are 2+ RSVP'd guests */}
              {costParticipants.length > 1 && (
                <>
                  <Text style={[styles.assignLabel, { color: colors.mutedForeground }]}>Who's included</Text>
                  {costParticipants.map((m) => {
                    const selected = selectedParticipantIds.has(m.id);
                    return (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => toggleSplitParticipant(m.id)}
                        style={[
                          styles.assignRow,
                          { borderColor: selected ? colors.primary + "50" : colors.border, backgroundColor: selected ? colors.primary + "08" : "transparent" },
                        ]}
                        activeOpacity={0.7}
                      >
                        <UserAvatar initials={m.initials} color={m.color} imageUrl={m.profileImageUrl} size={32} fontSize={11} />
                        <Text style={[styles.assignName, { color: colors.foreground, flex: 1 }]}>
                          {m.name.split(" ")[0]}{m.id === currentUser.id ? " (You)" : ""}
                        </Text>
                        <View style={[
                          styles.participantCheckbox,
                          { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : "transparent" },
                        ]}>
                          {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {splitParticipants.length === 0 && (
                    <Text style={[styles.assignLabel, { color: colors.destructive, marginTop: 2 }]}>
                      Select at least one person.
                    </Text>
                  )}
                </>
              )}

              {/* Split mode toggle */}
              <View style={[styles.splitToggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity
                  onPress={() => setSplitMode("even")}
                  style={[styles.splitToggleBtn, splitMode === "even" && { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.splitToggleText, { color: splitMode === "even" ? "#fff" : colors.mutedForeground }]}>
                    Split evenly
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={switchToManual}
                  style={[styles.splitToggleBtn, splitMode === "manual" && { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.splitToggleText, { color: splitMode === "manual" ? "#fff" : colors.mutedForeground }]}>
                    Enter manually
                  </Text>
                </TouchableOpacity>
              </View>

              {splitParticipants.length > 0 && (
                <>
                  <Text style={[styles.assignLabel, { color: colors.mutedForeground }]}>Who owes what</Text>
                  {splitParticipants.map((m) => (
                    <View key={m.id} style={[styles.assignRow, { borderColor: colors.border }]}>
                      <UserAvatar initials={m.initials} color={m.color} imageUrl={m.profileImageUrl} size={32} fontSize={11} />
                      <Text style={[styles.assignName, { color: colors.foreground }]}>{m.name.split(" ")[0]}{m.id === currentUser.id ? " (You)" : ""}</Text>
                      {splitMode === "even" ? (
                        <View style={[styles.assignInputWrap, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                          <Text style={[styles.dollar, { color: colors.primary }]}>$</Text>
                          <Text style={[styles.assignInput, { color: colors.primary, textAlignVertical: "center", paddingTop: 2 }]}>
                            {activeShares[m.id] ?? "—"}
                          </Text>
                        </View>
                      ) : (
                        <View style={[styles.assignInputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                          <Text style={[styles.dollar, { color: colors.textDim }]}>$</Text>
                          <TextInput
                            placeholder="0"
                            placeholderTextColor={colors.textDim}
                            value={costShares[m.id] ?? ""}
                            onChangeText={(v) => setCostShares((p) => ({ ...p, [m.id]: v }))}
                            keyboardType="decimal-pad"
                            style={[styles.assignInput, { color: colors.foreground }]}
                          />
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
            </ScrollView>

            <View style={[styles.coverageBar, { borderColor: covered ? colors.green : colors.border, backgroundColor: (covered ? colors.green : colors.gold) + "15" }]}>
              <Ionicons name={covered ? "checkmark-circle" : "alert-circle-outline"} size={16} color={covered ? colors.green : colors.gold} />
              <Text style={[styles.coverageText, { color: covered ? colors.green : colors.gold }]}>
                {covered
                  ? `Covered · $${totalNum.toFixed(2)} assigned`
                  : `$${assignedNum.toFixed(2)} of $${totalNum.toFixed(2)} · $${remaining.toFixed(2)} left`}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setCostModal(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveCost}
                disabled={totalNum <= 0 || !covered || costSaving}
                style={[styles.modalBtn, { backgroundColor: covered ? colors.primary : colors.border, opacity: (totalNum <= 0 || !covered || costSaving) ? 0.45 : 1 }]}
              >
                {costSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: covered ? "#fff" : colors.textDim }]}>Save expense</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- New Poll Modal ---- */}
      <Modal visible={pollModal} transparent animationType="slide" onRequestClose={() => setPollModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>New poll</Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <TextInput
                placeholder="Ask a question..."
                placeholderTextColor={colors.textDim}
                value={pollQ}
                onChangeText={setPollQ}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              {pollOpts.map((opt, i) => (
                <TextInput
                  key={i}
                  placeholder={`Option ${i + 1}`}
                  placeholderTextColor={colors.textDim}
                  value={opt}
                  onChangeText={(v) => setPollOpts((p) => p.map((o, idx) => (idx === i ? v : o)))}
                  style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                />
              ))}
              {pollOpts.length < 5 && (
                <TouchableOpacity onPress={() => setPollOpts((p) => [...p, ""])} style={[styles.addRow, { borderColor: colors.border, marginTop: 4 }]}>
                  <Ionicons name="add" size={18} color={colors.primary} />
                  <Text style={[styles.addText, { color: colors.primary }]}>Add option</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setPollQ(""); setPollOpts(["", ""]); setPollModal(false); }} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={savePoll}
                disabled={pollSaving}
                style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: pollSaving ? 0.6 : 1 }]}
              >
                {pollSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff" }]}>Create poll</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Edit Event Modal ---- */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit event</Text>
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.assignLabel, { color: colors.mutedForeground }]}>Icon</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {EMOJIS.map((e) => (
                  <TouchableOpacity
                    key={e}
                    onPress={() => setEdit((p) => ({ ...p, emoji: e }))}
                    style={[styles.emojiOption, { backgroundColor: edit.emoji === e ? colors.primary + "25" : colors.card, borderColor: edit.emoji === e ? colors.primary : colors.border }]}
                  >
                    <Text style={{ fontSize: 22 }}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput
                placeholder="Event title"
                placeholderTextColor={colors.textDim}
                value={edit.title}
                onChangeText={(v) => setEdit((p) => ({ ...p, title: v }))}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, marginTop: 12 }]}
              />
              <TextInput
                placeholder="Date & time"
                placeholderTextColor={colors.textDim}
                value={edit.date}
                onChangeText={(v) => setEdit((p) => ({ ...p, date: v }))}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              <TextInput
                placeholder="Location"
                placeholderTextColor={colors.textDim}
                value={edit.location}
                onChangeText={(v) => setEdit((p) => ({ ...p, location: v }))}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              <TextInput
                placeholder="Description"
                placeholderTextColor={colors.textDim}
                value={edit.description}
                onChangeText={(v) => setEdit((p) => ({ ...p, description: v }))}
                multiline
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, height: 90, textAlignVertical: "top" }]}
              />
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setEditModal(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveEdit} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Budget Modal ---- */}
      <Modal visible={budgetModal} transparent animationType="fade" onRequestClose={() => setBudgetModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Group budget</Text>
            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
              Set a target the whole squad can track against.
            </Text>
            <View style={[styles.modalInput, styles.amountRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.dollar, { color: colors.mutedForeground }]}>$</Text>
              <TextInput
                placeholder="0.00"
                placeholderTextColor={colors.textDim}
                value={budgetInput}
                onChangeText={setBudgetInput}
                keyboardType="decimal-pad"
                autoFocus
                style={[styles.amountInput, { color: colors.foreground }]}
              />
            </View>
            {hasBudget && (
              <TouchableOpacity onPress={clearBudget} style={[styles.addRow, { borderColor: colors.border, marginTop: 4 }]}>
                <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                <Text style={[styles.addText, { color: colors.destructive }]}>Remove budget</Text>
              </TouchableOpacity>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setBudgetModal(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveBudget} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save budget</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ContactSheet
        visible={contactOpen}
        member={contactMember}
        onClose={() => setContactOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { backgroundColor: "#FF5C3A", paddingHorizontal: 20, paddingBottom: 20, position: "relative" },
  backBtn: { position: "absolute", top: 0, left: 16, padding: 8, zIndex: 10 },
  shareBtn: { position: "absolute", top: 0, right: 16, padding: 8, zIndex: 10 },
  gearBtn: { position: "absolute", top: 0, right: 54, padding: 8, zIndex: 10 },
  budgetCard: { borderRadius: 14, borderWidth: 1, padding: 16 },
  budgetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  budgetEdit: { flexDirection: "row", alignItems: "center", gap: 3 },
  budgetEditText: { fontSize: 13, fontWeight: "700" },
  budgetAmount: { fontSize: 26, fontWeight: "900", marginTop: 4, marginBottom: 12 },
  budgetTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  budgetFill: { height: 8, borderRadius: 4 },
  budgetMetaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  budgetMeta: { fontSize: 13, fontWeight: "700" },
  budgetPer: { fontSize: 12, marginTop: 6 },
  heroEmoji: { fontSize: 48, textAlign: "center", marginTop: 20, marginBottom: 8 },
  heroTitleRow: { alignItems: "center", gap: 6, marginBottom: 4 },
  heroTitle: { fontSize: 24, fontWeight: "800", color: "#fff", textAlign: "center" },
  heroHostBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  heroHostText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  heroDate: { fontSize: 14, color: "rgba(255,255,255,0.85)", textAlign: "center", fontWeight: "600", marginBottom: 2 },
  heroLocation: { fontSize: 13, color: "rgba(255,255,255,0.75)", textAlign: "center", marginBottom: 14 },
  rsvpRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
  rsvpBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8 },
  rsvpText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  tabBar: { maxHeight: 52, borderBottomWidth: 1 },
  tabChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginVertical: 8 },
  tabChipText: { fontSize: 13, fontWeight: "700" },
  tabContent: { flex: 1 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  cardTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardBody: { fontSize: 15, lineHeight: 22 },
  inlineAdd: { flexDirection: "row", alignItems: "center", gap: 2 },
  inlineAddText: { fontSize: 13, fontWeight: "700" },
  pollQ: { fontSize: 15, fontWeight: "700", marginTop: 2 },
  pollOpt: { borderRadius: 10, borderWidth: 1.5, overflow: "hidden", justifyContent: "center", minHeight: 42 },
  pollFill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  pollOptRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  pollOptLabel: { flex: 1, fontSize: 14, fontWeight: "600" },
  pollPct: { fontSize: 13, fontWeight: "700" },
  pollMeta: { fontSize: 12, marginTop: 2 },
  hostRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  hostName: { fontSize: 15, fontWeight: "700" },
  sectionLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  guestRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  guestName: { fontSize: 14, fontWeight: "700" },
  guestStatus: { fontSize: 12, fontWeight: "600", marginTop: 1 },
  hostBadge: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  hostBadgeText: { fontSize: 11, fontWeight: "700" },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  taskText: { flex: 1, fontSize: 14 },
  claimBtn: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  claimText: { fontSize: 12, fontWeight: "700" },
  totalsCard: { flexDirection: "row", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 4 },
  totalsValue: { fontSize: 22, fontWeight: "900", marginTop: 2 },
  costRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14 },
  costDesc: { fontSize: 14, fontWeight: "700" },
  costPayer: { fontSize: 12, marginTop: 2 },
  costRight: { alignItems: "flex-end" },
  costTotal: { fontSize: 16, fontWeight: "800" },
  costShare: { fontSize: 12 },
  settleCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  settleHeader: { fontSize: 15, fontWeight: "800" },
  settleAllClear: { fontSize: 13 },
  settleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  settleName: { fontSize: 13, fontWeight: "600" },
  settleAmt: { fontSize: 15, fontWeight: "800", marginTop: 2 },
  settleActions: { flexDirection: "row", gap: 8 },
  payBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  payBtnText: { fontSize: 12, fontWeight: "800", color: "#fff" },
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", padding: 14 },
  addText: { fontSize: 14, fontWeight: "700" },
  inviteCode: { fontSize: 24, fontWeight: "800", letterSpacing: 2 },
  inviteLink: { fontSize: 12 },
  shareInviteBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start", marginTop: 4 },
  shareInviteText: { fontSize: 13, fontWeight: "700" },
  adminRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  adminLabel: { flex: 1, fontSize: 15 },
  emptyState: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center" },
  errorText: { textAlign: "center", marginTop: 80, fontSize: 16 },
  // vault photos
  proLoadingCenter: { alignItems: "center", paddingVertical: 40 },
  vaultPhotoGrid: { flexDirection: "row", gap: 6 },
  vaultGridCell: { flex: 1, aspectRatio: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", position: "relative" },
  vaultGridEmoji: { fontSize: 28 },
  vaultLockBadge: { position: "absolute", bottom: 6, right: 6, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  vaultLockCard: { borderRadius: 20, borderWidth: 1, padding: 24, alignItems: "center" },
  vaultLockIcon: { fontSize: 44, marginBottom: 12 },
  vaultLockTitle: { fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  vaultLockBody: { fontSize: 13, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  vaultFeaturePills: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  vaultPill: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  vaultPillText: { fontSize: 12 },
  vaultUpgradeBtn: { borderRadius: 14, padding: 16, alignItems: "center" },
  vaultUpgradeBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  vaultCta: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  vaultCtaText: { flex: 1, fontSize: 14, fontWeight: "700" },
  // chat
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgBubble: { maxWidth: "78%", borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  msgSender: { fontSize: 11, fontWeight: "700", marginBottom: 2 },
  msgText: { fontSize: 14, lineHeight: 19 },
  msgTime: { fontSize: 10, marginTop: 3, alignSelf: "flex-end" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  composerInput: { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, height: 44, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  // modals
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 20, gap: 12 },
  modalCardLarge: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 20, gap: 10 },
  modalTitle: { fontSize: 19, fontWeight: "800" },
  modalHint: { fontSize: 13, marginTop: -4 },
  modalInput: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, height: 50, fontSize: 15, marginTop: 8 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dollar: { fontSize: 16, fontWeight: "700" },
  amountInput: { flex: 1, fontSize: 16, fontWeight: "700", height: "100%" },
  splitToggle: { flexDirection: "row", borderRadius: 12, borderWidth: 1.5, marginTop: 10, overflow: "hidden" },
  splitToggleBtn: { flex: 1, paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  splitToggleText: { fontSize: 13, fontWeight: "700" },
  assignLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 14, marginBottom: 6 },
  assignRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1, borderColor: "transparent" },
  assignName: { flex: 1, fontSize: 14, fontWeight: "600" },
  participantCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  assignInputWrap: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, width: 100, height: 40 },
  assignInput: { flex: 1, fontSize: 14, fontWeight: "700", height: "100%" },
  coverageBar: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  coverageText: { fontSize: 13, fontWeight: "700" },
  emojiOption: { width: 48, height: 48, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 6 },
  modalBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 14 },
  modalBtnText: { fontSize: 15, fontWeight: "800" },
  responseBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", marginRight: 4 },
  responseBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  conflictBanner: { overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#F59E0B18" },
  conflictBannerText: { fontSize: 12, fontWeight: "700", color: "#B45309", letterSpacing: 0.2 },
});
