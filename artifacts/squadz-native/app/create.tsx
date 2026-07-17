import { createElement, useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Modal,
  Switch,
  Share,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useData, useAuth } from "@/context/AppContext";
import { FindTimeChooser } from "@/components/FindTimeChooser";
import { useUserCache } from "@/context/UserCacheContext";
import { UpgradeModal } from "@/components/UpgradeModal";
import { IconPicker } from "@/components/IconPicker";
import FriendPickerSheet from "@/components/FriendPickerSheet";
import { UserAvatar } from "@/components/UserAvatar";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { addStop } from "@/lib/tripApi";
import { TRIP_COVER_KEYS, TRIP_COVERS, formatTripRange, dayKey } from "@/lib/tripUtils";
import { getTemplate } from "@/lib/tripTemplates";
import { findMyConflicts, getPlanSpan } from "@/lib/conflicts";
import ConflictBanner from "@/components/ConflictBanner";

function formatPickedDay(d: Date): string {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Date → "YYYY-MM-DD" for an HTML <input type="date"> (web range picker). */
function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" from an HTML date input → local Date (noon, to dodge DST edges). */
function fromDateInputValue(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Combine a calendar day with a wall-clock time (defaults to 9am) → ISO. */
function dayAt(d: Date, hour: number): string {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0);
  return out.toISOString();
}

/**
 * Smart-default start suggestions for a plain event: tonight at 7 PM (when
 * it's still early enough) and the upcoming Saturday at 7 PM. One tap fills
 * the date — the user can always Edit afterwards.
 */
function quickStartSuggestions(): { label: string; date: Date }[] {
  const now = new Date();
  const out: { label: string; date: Date }[] = [];
  if (now.getHours() < 17) {
    out.push({ label: "Tonight · 7 PM", date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0, 0, 0) });
  }
  // Next Saturday (skip today-if-Saturday only when 7 PM already passed).
  let diff = (6 - now.getDay() + 7) % 7;
  if (diff === 0 && now.getHours() >= 17) diff = 7;
  if (diff > 0 || now.getHours() < 17) {
    const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, 19, 0, 0, 0);
    // Avoid duplicating the "Tonight" chip when today IS Saturday.
    if (!(diff === 0 && out.length > 0)) {
      out.push({ label: `Sat · 7 PM`, date: sat });
    }
  }
  return out;
}

function formatPickedDate(d: Date): string {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const mm = m.toString().padStart(2, "0");
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} · ${h12}:${mm} ${ampm}`;
}

function Field({
  icon,
  placeholder,
  value,
  onChangeText,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name={icon} size={20} color={colors.mutedForeground} />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        value={value}
        onChangeText={onChangeText}
        style={[styles.fieldInput, { color: colors.foreground }]}
      />
    </View>
  );
}

export default function CreateEventScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addEvent, squads, events, currentUser } = useData();
  const { authToken } = useAuth();
  const { resolveUser } = useUserCache();
  const prefill = useLocalSearchParams<{ prefillDate?: string; prefillEventAt?: string; prefillSquad?: string; prefillTitle?: string; prefillEmoji?: string; prefillPollId?: string; prefillTripStart?: string; mode?: string; templateId?: string }>();
  const [findTimeOpen, setFindTimeOpen] = useState(false);
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const template = getTemplate(prefill.templateId);
  // "trip" builds a multi-day trip with an itinerary; "event" is a one-off.
  const [kind, setKind] = useState<"event" | "trip">(
    prefill.mode === "trip" || prefill.templateId ? "trip" : "event",
  );

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  // Trip date range + presentation. When coming from a "Find the Best Time" poll
  // resolved into a Trip, seed the start with the winning day (date only — trips
  // don't carry a time). The end stays open for the user to pick.
  const [tripStart, setTripStart] = useState<Date | null>(
    prefill.prefillTripStart && /^\d{4}-\d{2}-\d{2}$/.test(prefill.prefillTripStart)
      ? new Date(`${prefill.prefillTripStart}T12:00:00`)
      : null,
  );
  const [tripEnd, setTripEnd] = useState<Date | null>(null);
  const [allDay, setAllDay] = useState(true);
  const [coverStyle, setCoverStyle] = useState<string>(template?.coverStyle ?? "sunset");
  const [rangeStep, setRangeStep] = useState<"start" | "end" | null>(null);
  const [rangeTmp, setRangeTmp] = useState(new Date());
  // Machine-readable ISO start, set whenever a concrete time is chosen via the
  // picker (or prefilled from the availability "best time"). Cleared when the
  // user clears or manually edits the freeform date text, since it no longer
  // corresponds to a parseable instant.
  const [eventAtISO, setEventAtISO] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [selectedSquad, setSelectedSquad] = useState<string | null>(null);
  const [selectedEmoji, setSelectedEmoji] = useState("🔥");

  const [isPublic, setIsPublic] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [myEventCount, setMyEventCount] = useState(0);
  const [eventLimit, setEventLimit] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [invitedUserIds, setInvitedUserIds] = useState<string[]>([]);
  const [showInvitePicker, setShowInvitePicker] = useState(false);
  // Progressive disclosure: location/description/visibility/invites live
  // behind a "More options" expander so the fast path is title → date → squad.
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  // Post-create beat (T204): brief created-state with a "Share with the squad"
  // affordance before landing on the plan. Sharing only happens on explicit tap.
  const [createdBeat, setCreatedBeat] = useState<{ id: string; kind: "event" | "trip"; title: string; emoji: string } | null>(null);

  // Smart default: preselect the most-recently-planned squad (the squad of the
  // user's latest plan), falling back to the only/first squad. Never overrides
  // an explicit prefill or a user choice.
  useEffect(() => {
    if (prefill.prefillSquad || squads.length === 0) return;
    const latest = [...events]
      .filter((e) => e.squadId && squads.some((s) => s.id === e.squadId))
      .sort((a, b) => (b.eventAt ?? b.startAt ?? "").localeCompare(a.eventAt ?? a.startAt ?? ""))[0];
    const target = latest?.squadId ?? squads[0].id;
    setSelectedSquad((cur) => cur ?? target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squads.length, events.length, prefill.prefillSquad]);

  // Smart default: a plain event left untouched still yields a valid plan —
  // start defaults to the upcoming Saturday at 7 PM (editable/clearable).
  useEffect(() => {
    if (prefill.prefillDate || prefill.prefillEventAt || prefill.templateId) return;
    if (kind !== "event") return;
    if (eventAtISO !== undefined || date) return;
    const sat = quickStartSuggestions().find((s) => s.label.startsWith("Sat"))?.date;
    if (!sat) return;
    setEventAtISO(sat.toISOString());
    setDate(formatPickedDate(sat));
    setPickerDate(sat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atLimit = !isPro && eventLimit !== null && myEventCount >= eventLimit;

  // Live, private conflict check against the user's own plans while they pick
  // dates. Purely informational — never blocks creation.
  const draftConflicts = useMemo(() => {
    const candidate =
      kind === "trip"
        ? tripStart
          ? getPlanSpan({
              type: "trip",
              date: "",
              startAt: dayAt(tripStart, 9),
              endAt: dayAt(tripEnd ?? tripStart, 18),
            })
          : null
        : getPlanSpan({ type: "event", date, eventAt: eventAtISO });
    return findMyConflicts({
      candidate,
      plans: events,
      userId: currentUser.id,
      squads,
    });
  }, [kind, tripStart, tripEnd, date, eventAtISO, events, currentUser.id, squads]);

  const authHeaders = useCallback((): HeadersInit => {
    return buildAuthHeaders(authToken);
  }, [authToken]);

  useEffect(() => {
    fetch(`${API_BASE}/api/subscription`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : { isPro: false })
      .then((data: { isPro?: boolean }) => setIsPro(data.isPro ?? false))
      .catch(() => setIsPro(false));
  }, [authHeaders]);

  useEffect(() => {
    fetch(`${API_BASE}/api/events/count`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then((data: { count: number; limit?: number } | null) => {
        if (data) {
          setMyEventCount(data.count);
          if (typeof data.limit === "number") setEventLimit(data.limit);
        }
      })
      .catch(() => {});
  }, [authHeaders]);

  const [pickerDate, setPickerDate] = useState(new Date());
  const [pickerStep, setPickerStep] = useState<"date" | "time" | null>(null);
  // Optional event end time. Only relevant for plain events with a concrete
  // start (eventAtISO). Stored as ISO; the picker scratch lives in endPickerDate.
  const [endAtISO, setEndAtISO] = useState<string | undefined>(undefined);
  const [endPickerDate, setEndPickerDate] = useState(new Date());
  const [endPickerStep, setEndPickerStep] = useState<"date" | "time" | null>(null);

  // Apply a time / squad chosen via the "Find the Best Time" picker, or a
  // title / emoji passed from an AI suggestion on the Home screen.
  useEffect(() => {
    if (prefill.prefillDate) setDate(prefill.prefillDate);
    if (prefill.prefillEventAt) setEventAtISO(prefill.prefillEventAt);
    if (prefill.prefillSquad) setSelectedSquad(prefill.prefillSquad);
    if (prefill.prefillTitle) setTitle(prefill.prefillTitle);
    if (prefill.prefillEmoji) setSelectedEmoji(prefill.prefillEmoji);
  }, [prefill.prefillDate, prefill.prefillEventAt, prefill.prefillSquad, prefill.prefillTitle, prefill.prefillEmoji]);

  // Seed title/emoji/cover from a chosen template (once).
  useEffect(() => {
    if (!template) return;
    setTitle((t) => t || template.title);
    setSelectedEmoji(template.emoji);
    setCoverStyle(template.coverStyle);
  }, [template]);

  const resetForm = () => {
    setTitle(""); setLocation(""); setDate(""); setEventAtISO(undefined); setDescription("");
    setEndAtISO(undefined);
    setSelectedSquad(null); setSelectedEmoji("🔥");
    setTripStart(null); setTripEnd(null); setAllDay(true); setCoverStyle("sunset");
    setPickerDate(new Date());
  };

  const handleCreate = async () => {
    setCreateError(null);
    if (!title.trim()) {
      setCreateError("Please add an event title.");
      return;
    }
    if (atLimit) {
      setShowUpgradeModal(true);
      return;
    }
    if (kind === "trip" && !tripStart) {
      setCreateError("Please pick the trip's start date.");
      return;
    }
    setCreating(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      let id: string;
      if (kind === "trip" && tripStart) {
        const end = tripEnd ?? tripStart;
        const startISO = dayAt(tripStart, 9);
        const endISO = dayAt(end, 18);
        id = await addEvent({
          title: title.trim(), emoji: selectedEmoji,
          date: formatTripRange({ startAt: startISO, endAt: endISO }),
          location: location.trim(), description: description.trim(),
          squadId: selectedSquad, isPublic,
          type: "trip", startAt: startISO, endAt: endISO, allDay, coverStyle,
          invitedUserIds, timezone: deviceTimezone,
        });
        // Templates are a Squadz+ feature: only materialize their stops for pro
        // users. This re-checks entitlement server-trust-free at create time so
        // the deep-link /create?mode=trip&templateId=… path can't hand template
        // content to a non-pro user who bypassed the template picker UI gate.
        // Thread the event version through each append so the version-checked
        // itinerary route accepts them (a freshly created event starts at v1).
        if (template && isPro) {
          let v = 1;
          for (const s of template.stops) {
            const day = new Date(tripStart);
            day.setDate(day.getDate() + s.dayIndex);
            const r = await addStop(id, authToken, {
              day: dayKey(day), time: s.time, title: s.title,
              placeName: s.placeName, category: s.category, status: "confirmed",
            }, v);
            if (r.event && typeof r.event.version === "number") v = r.event.version;
          }
        }
      } else {
        id = await addEvent({
          title: title.trim(), emoji: selectedEmoji,
          date: date.trim(), eventAt: eventAtISO,
          // Only send an end time when there's a concrete start to anchor it to.
          endAt: eventAtISO ? endAtISO : undefined,
          location: location.trim(),
          description: description.trim(), squadId: selectedSquad,
          isPublic, invitedUserIds, timezone: deviceTimezone,
        });
      }
      fetch(`${API_BASE}/api/events/count`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : null)
        .then((data: { count: number; limit?: number } | null) => {
          if (data) {
            setMyEventCount(data.count);
            if (typeof data.limit === "number") setEventLimit(data.limit);
          }
        })
        .catch(() => {});
      // If this event/trip was created from a "Find the Best Time" poll, mark the
      // poll converted so it drops out of the squad/personal "Existing" lists.
      if (prefill.prefillPollId && id) {
        fetch(`${API_BASE}/api/availability/polls/${prefill.prefillPollId}/convert`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ eventId: id }),
        }).catch(() => {});
      }
      const beat = { id, kind: kind === "trip" ? ("trip" as const) : ("event" as const), title: title.trim(), emoji: selectedEmoji };
      resetForm();
      setCreatedBeat(beat);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const openRangePicker = (step: "start" | "end") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRangeTmp(step === "start" ? (tripStart ?? new Date()) : (tripEnd ?? tripStart ?? new Date()));
    setRangeStep(step);
  };

  const applyRange = (step: "start" | "end", picked: Date) => {
    if (step === "start") {
      setTripStart(picked);
      // Seed the end date from a template's suggested length the first time a
      // start day is chosen; otherwise just keep end ≥ start.
      if (template && !tripEnd) {
        const seeded = new Date(picked);
        seeded.setDate(seeded.getDate() + template.nights);
        setTripEnd(seeded);
      } else if (tripEnd && tripEnd < picked) {
        setTripEnd(picked);
      }
    } else {
      if (tripStart && picked < tripStart) setTripEnd(tripStart);
      else setTripEnd(picked);
    }
  };

  const confirmRange = (picked: Date) => {
    if (rangeStep) applyRange(rangeStep, picked);
    setRangeStep(null);
  };

  const onWebRangeChange = (step: "start" | "end", value: string) => {
    const d = fromDateInputValue(value);
    if (d) applyRange(step, d);
  };

  const handleRangeAndroid = (_: DateTimePickerEvent, d?: Date) => {
    if (!d) { setRangeStep(null); return; }
    confirmRange(d);
  };

  const openDatePicker = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerStep("date");
  };

  const handleIOSConfirm = () => {
    if (pickerStep === "date") {
      setPickerStep("time");
    } else {
      setDate(formatPickedDate(pickerDate));
      setEventAtISO(pickerDate.toISOString());
      setPickerStep(null);
    }
  };

  const handleAndroidChange = (_: DateTimePickerEvent, d?: Date) => {
    if (!d) { setPickerStep(null); return; }
    const updated = new Date(pickerDate);
    if (pickerStep === "date") {
      updated.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      setPickerDate(updated);
      setTimeout(() => setPickerStep("time"), 50);
    } else {
      updated.setHours(d.getHours(), d.getMinutes());
      setPickerDate(updated);
      setDate(formatPickedDate(updated));
      setEventAtISO(updated.toISOString());
      setPickerStep(null);
    }
  };

  const clearDate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDate("");
    setEventAtISO(undefined);
    setPickerDate(new Date());
    // An end time without a start is meaningless — clear it too.
    setEndAtISO(undefined);
  };

  const openEndPicker = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Default the end picker to the start time + 1h so the common case is one tap.
    const base = eventAtISO ? new Date(eventAtISO) : new Date();
    const seed = endAtISO ? new Date(endAtISO) : new Date(base.getTime() + 60 * 60 * 1000);
    setEndPickerDate(seed);
    setEndPickerStep("date");
  };

  const handleEndIOSConfirm = () => {
    if (endPickerStep === "date") {
      setEndPickerStep("time");
    } else {
      setEndAtISO(endPickerDate.toISOString());
      setEndPickerStep(null);
    }
  };

  const handleEndAndroidChange = (_: DateTimePickerEvent, d?: Date) => {
    if (!d) { setEndPickerStep(null); return; }
    const updated = new Date(endPickerDate);
    if (endPickerStep === "date") {
      updated.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      setEndPickerDate(updated);
      setTimeout(() => setEndPickerStep("time"), 50);
    } else {
      updated.setHours(d.getHours(), d.getMinutes());
      setEndPickerDate(updated);
      setEndAtISO(updated.toISOString());
      setEndPickerStep(null);
    }
  };

  const clearEnd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEndAtISO(undefined);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never))}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          style={styles.headerBack}
        >
          <Ionicons name="chevron-back" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>{kind === "trip" ? "New Trip" : "New Event"}</Text>
      </View>

      {atLimit && (
        <View style={[styles.limitBanner, { backgroundColor: colors.primary + "18", borderBottomColor: colors.primary + "40" }]}>
          <Ionicons name="flash" size={14} color={colors.primary} />
          <Text style={[styles.limitBannerText, { color: colors.primary }]}>
            Free plan: {myEventCount}/{eventLimit} events used — upgrade for unlimited
          </Text>
          <TouchableOpacity onPress={() => setShowUpgradeModal(true)} style={[styles.limitBannerBtn, { borderColor: colors.primary + "60" }]}>
            <Text style={[styles.limitBannerBtnText, { color: colors.primary }]}>Upgrade</Text>
          </TouchableOpacity>
        </View>
      )}

      {createError && (
        <View style={[styles.limitBanner, { backgroundColor: "#FF3B3018", borderBottomColor: "#FF3B3040" }]}>
          <Ionicons name="alert-circle-outline" size={14} color="#FF3B30" />
          <Text style={[styles.limitBannerText, { color: "#FF3B30", flex: 1 }]}>{createError}</Text>
          <TouchableOpacity onPress={() => setCreateError(null)}>
            <Ionicons name="close" size={16} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      )}

      <KeyboardAwareScrollViewCompat
        style={styles.body}
        contentContainerStyle={{ paddingBottom: botPad + 80 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>What are you planning?</Text>
          <View style={[styles.kindRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {(["event", "trip"] as const).map((k) => {
              const active = kind === k;
              return (
                <TouchableOpacity
                  key={k}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setKind(k); }}
                  style={[styles.kindOption, active && { backgroundColor: colors.primary }]}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={k === "trip" ? "airplane" : "calendar"}
                    size={16}
                    color={active ? "#fff" : colors.mutedForeground}
                  />
                  <Text style={[styles.kindText, { color: active ? "#fff" : colors.mutedForeground }]}>
                    {k === "trip" ? "Trip" : "Event"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {kind === "trip" ? (
            <Text style={[styles.kindHint, { color: colors.mutedForeground }]}>
              Multi-day plan with a shared itinerary, budget & packing list.
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{kind === "trip" ? "Trip icon" : "Event icon"}</Text>
          <IconPicker value={selectedEmoji} onChange={setSelectedEmoji} />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>{kind === "trip" ? "Trip name" : "Event name"}</Text>
          <Field icon="text-outline" placeholder={kind === "trip" ? "Where are you headed?" : "What are you planning?"} value={title} onChangeText={setTitle} colors={colors} />
        </View>

        {kind === "trip" ? (
          <>
            <View style={styles.section}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Dates</Text>
              {Platform.OS === "web" ? (
                <View style={styles.rangeRow}>
                  <View style={[styles.rangeBtn, { backgroundColor: colors.card, borderColor: tripStart ? colors.primary : colors.border }]}>
                    <Text style={[styles.rangeLabel, { color: colors.mutedForeground }]}>Start</Text>
                    {createElement("input", {
                      type: "date",
                      value: toDateInputValue(tripStart),
                      max: toDateInputValue(tripEnd),
                      onChange: (e: { target: { value: string } }) => onWebRangeChange("start", e.target.value),
                      style: { ...webDateInputStyle, color: tripStart ? colors.foreground : colors.textDim },
                    })}
                  </View>
                  <View style={[styles.rangeBtn, { backgroundColor: colors.card, borderColor: tripEnd ? colors.primary : colors.border }]}>
                    <Text style={[styles.rangeLabel, { color: colors.mutedForeground }]}>End</Text>
                    {createElement("input", {
                      type: "date",
                      value: toDateInputValue(tripEnd),
                      min: toDateInputValue(tripStart),
                      onChange: (e: { target: { value: string } }) => onWebRangeChange("end", e.target.value),
                      style: { ...webDateInputStyle, color: tripEnd ? colors.foreground : colors.textDim },
                    })}
                  </View>
                </View>
              ) : (
                <View style={styles.rangeRow}>
                  <TouchableOpacity
                    onPress={() => openRangePicker("start")}
                    style={[styles.rangeBtn, { backgroundColor: colors.card, borderColor: tripStart ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.rangeLabel, { color: colors.mutedForeground }]}>Start</Text>
                    <Text style={[styles.rangeValue, { color: tripStart ? colors.foreground : colors.textDim }]}>
                      {tripStart ? formatPickedDay(tripStart) : "Pick a day"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => openRangePicker("end")}
                    style={[styles.rangeBtn, { backgroundColor: colors.card, borderColor: tripEnd ? colors.primary : colors.border }]}
                  >
                    <Text style={[styles.rangeLabel, { color: colors.mutedForeground }]}>End</Text>
                    <Text style={[styles.rangeValue, { color: tripEnd ? colors.foreground : colors.textDim }]}>
                      {tripEnd ? formatPickedDay(tripEnd) : tripStart ? "Same day" : "Pick a day"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {tripStart ? (
                <Text style={[styles.rangePreview, { color: colors.primary }]}>
                  {formatTripRange({ startAt: dayAt(tripStart, 9), endAt: dayAt(tripEnd ?? tripStart, 18) })}
                </Text>
              ) : null}
              <View style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
                <Ionicons name="time-outline" size={20} color={colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleTitle, { color: colors.foreground }]}>All-day trip</Text>
                  <Text style={[styles.toggleSub, { color: colors.mutedForeground }]}>Times live on each itinerary stop</Text>
                </View>
                <Switch
                  value={allDay}
                  onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAllDay(v); }}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Cover</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {TRIP_COVER_KEYS.map((key) => {
                  const grad = TRIP_COVERS[key];
                  const active = coverStyle === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCoverStyle(key); }}
                      activeOpacity={0.85}
                    >
                      <LinearGradient
                        colors={grad}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={[styles.coverSwatch, active && { borderColor: colors.foreground, borderWidth: 3 }]}
                      >
                        {active ? <Ionicons name="checkmark" size={20} color="#fff" /> : null}
                      </LinearGradient>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </>
        ) : (
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Date & time</Text>
          {Platform.OS === "web" ? (
            <Field icon="calendar-outline" placeholder="e.g. Sat, Jun 7 · 5:00 PM" value={date} onChangeText={(t) => { setDate(t); setEventAtISO(undefined); }} colors={colors} />
          ) : date ? (
            <View style={[styles.dateDisplay, { backgroundColor: colors.card, borderColor: colors.primary }]}>
              <Ionicons name="calendar" size={20} color={colors.primary} />
              <Text style={[styles.dateText, { color: colors.foreground }]}>{date}</Text>
              <TouchableOpacity onPress={openDatePicker} style={[styles.editDateBtn, { borderColor: colors.border }]}>
                <Text style={[styles.editDateText, { color: colors.mutedForeground }]}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={clearDate}>
                <Ionicons name="close-circle" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={openDatePicker}
              style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.mutedForeground} />
              <Text style={[styles.dateBtnText, { color: colors.textDim }]}>Tap to select date & time</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>
          )}
          {!date && (
            <View style={styles.quickChipRow}>
              {quickStartSuggestions().map((sug) => (
                <TouchableOpacity
                  key={sug.label}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setDate(formatPickedDate(sug.date));
                    setEventAtISO(sug.date.toISOString());
                    setPickerDate(sug.date);
                  }}
                  style={[styles.quickChip, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "40" }]}
                >
                  <Ionicons name="flash-outline" size={13} color={colors.primary} />
                  <Text style={[styles.quickChipText, { color: colors.primary }]}>{sug.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (!selectedSquad) {
                Alert.alert("Pick a squad first", "Choose a squad below so we can poll everyone's availability.");
                return;
              }
              setFindTimeOpen(true);
            }}
            style={[styles.bestTimeBtn, { borderColor: colors.primary + "55", backgroundColor: colors.primary + "10" }]}
          >
            <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
            <Text style={[styles.bestTimeText, { color: colors.primary }]}>Find the best time with your squad</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </TouchableOpacity>

          {/* Optional end time — only meaningful once a concrete start is set. */}
          {eventAtISO ? (
            <View style={{ marginTop: 12 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>End time (optional)</Text>
              {Platform.OS === "web" ? (
                <Field
                  icon="time-outline"
                  placeholder="e.g. Sat, Jun 7 · 8:00 PM"
                  value={endAtISO ? formatPickedDate(new Date(endAtISO)) : ""}
                  onChangeText={() => {}}
                  colors={colors}
                />
              ) : endAtISO ? (
                <View style={[styles.dateDisplay, { backgroundColor: colors.card, borderColor: colors.primary }]}>
                  <Ionicons name="time" size={20} color={colors.primary} />
                  <Text style={[styles.dateText, { color: colors.foreground }]}>{formatPickedDate(new Date(endAtISO))}</Text>
                  <TouchableOpacity onPress={openEndPicker} style={[styles.editDateBtn, { borderColor: colors.border }]}>
                    <Text style={[styles.editDateText, { color: colors.mutedForeground }]}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={clearEnd}>
                    <Ionicons name="close-circle" size={20} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={openEndPicker}
                  style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Ionicons name="time-outline" size={20} color={colors.mutedForeground} />
                  <Text style={[styles.dateBtnText, { color: colors.textDim }]}>Add an end time</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                </TouchableOpacity>
              )}
            </View>
          ) : null}
        </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Squad</Text>
          <View style={styles.squadList}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/create"); }}
              style={[styles.newSquadRow, { borderColor: colors.primary + "50" }]}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={[styles.newSquadText, { color: colors.primary }]}>New squad</Text>
            </TouchableOpacity>
            {squads.map((s) => (
              <TouchableOpacity
                key={s.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedSquad(s.id === selectedSquad ? null : s.id); }}
                style={[
                  styles.squadOption,
                  { backgroundColor: selectedSquad === s.id ? colors.primary + "15" : colors.card, borderColor: selectedSquad === s.id ? colors.primary : colors.border },
                ]}
              >
                <Text style={styles.squadOptionEmoji}>{s.emoji}</Text>
                <View style={styles.squadOptionBody}>
                  <Text style={[styles.squadOptionName, { color: colors.foreground }]}>{s.name}</Text>
                  <Text style={[styles.squadOptionCount, { color: colors.mutedForeground }]}>{s.memberIds.length} members</Text>
                </View>
                {selectedSquad === s.id && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Progressive disclosure: everything optional lives behind one expander. */}
        {!showMoreOptions ? (
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowMoreOptions(true); }}
            style={[styles.moreOptionsBtn, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Show more options"
          >
            <Ionicons name="options-outline" size={16} color={colors.mutedForeground} />
            <Text style={[styles.moreOptionsText, { color: colors.mutedForeground }]}>
              More options — location, description, visibility, invites…
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.textDim} />
          </TouchableOpacity>
        ) : (
        <>
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Location</Text>
          <Field icon="location-outline" placeholder="Where is it happening?" value={location} onChangeText={setLocation} colors={colors} />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Description</Text>
          <View style={[styles.field, styles.fieldMultiline, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="document-text-outline" size={20} color={colors.mutedForeground} style={{ marginTop: 2 }} />
            <TextInput
              placeholder="What's the plan? (optional)"
              placeholderTextColor={colors.textDim}
              value={description}
              onChangeText={setDescription}
              multiline
              style={[styles.fieldInput, { color: colors.foreground, height: 80, textAlignVertical: "top", paddingTop: 2 }]}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Visibility</Text>
          <View style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons
              name={isPublic ? "earth-outline" : "lock-closed-outline"}
              size={20}
              color={isPublic ? colors.primary : colors.mutedForeground}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleTitle, { color: colors.foreground }]}>Make this event public</Text>
              <Text style={[styles.toggleSub, { color: colors.mutedForeground }]}>
                {isPublic ? "Anyone can discover and join" : "Invite-only — only people with the link can join"}
              </Text>
            </View>
            <Switch
              value={isPublic}
              onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsPublic(v); }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Invite friends</Text>
          <Text style={[styles.inviteHint, { color: colors.mutedForeground }]}>
            Add specific friends to this {kind === "trip" ? "trip" : "event"}, even if they&apos;re not in the squad.
          </Text>
          {invitedUserIds.length > 0 && (
            <View style={styles.inviteChips}>
              {invitedUserIds.map((uid) => {
                const u = resolveUser(uid);
                return (
                  <View key={uid} style={[styles.inviteChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={22} />
                    <Text style={[styles.inviteChipName, { color: colors.foreground }]} numberOfLines={1}>{u.name}</Text>
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); setInvitedUserIds((prev) => prev.filter((x) => x !== uid)); }}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowInvitePicker(true); }}
            style={[styles.newSquadRow, { borderColor: colors.primary + "50" }]}
          >
            <Ionicons name="person-add-outline" size={20} color={colors.primary} />
            <Text style={[styles.newSquadText, { color: colors.primary }]}>
              {invitedUserIds.length > 0 ? "Add more friends" : "Invite friends"}
            </Text>
          </TouchableOpacity>
        </View>
        </>
        )}
      </KeyboardAwareScrollViewCompat>

      <FindTimeChooser
        visible={findTimeOpen}
        scope={{ type: "squad", squadId: selectedSquad ?? "" }}
        onClose={() => setFindTimeOpen(false)}
        onStartNew={() =>
          router.push({ pathname: "/availability", params: { squadId: selectedSquad ?? "", from: "create" } } as never)
        }
      />

      <FriendPickerSheet
        visible={showInvitePicker}
        title={kind === "trip" ? "Invite to trip" : "Invite to event"}
        confirmLabel="Add"
        excludeIds={invitedUserIds}
        onConfirm={(ids) => {
          setInvitedUserIds((prev) => [...new Set([...prev, ...ids])]);
          setShowInvitePicker(false);
        }}
        onClose={() => setShowInvitePicker(false)}
      />

      {createdBeat !== null && (
        <Modal visible transparent animationType="fade" onRequestClose={() => {
          const beat = createdBeat;
          setCreatedBeat(null);
          if (beat) router.replace((beat.kind === "trip" ? `/trip/${beat.id}` : `/event/${beat.id}`) as never);
        }}>
          <View style={styles.beatOverlay}>
            <View style={[styles.beatCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={styles.beatEmoji}>{createdBeat.emoji}</Text>
              <Text style={[styles.beatTitle, { color: colors.foreground }]}>
                {createdBeat.kind === "trip" ? "Trip created!" : "It's on!"}
              </Text>
              <Text style={[styles.beatSub, { color: colors.mutedForeground }]} numberOfLines={2}>
                {createdBeat.title} is live. Rally the crew.
              </Text>
              <TouchableOpacity
                activeOpacity={0.9}
                style={{ width: "100%" }}
                onPress={() => {
                  const beat = createdBeat;
                  const code = events.find((e) => e.id === beat.id)?.inviteCode;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  Share.share({
                    message: code
                      ? `${beat.emoji} ${beat.title} — you in? Join on SquadZ: https://joinsquadz.com/join/${code}`
                      : `${beat.emoji} ${beat.title} — you in? Join me on SquadZ!`,
                  }).finally(() => {
                    setCreatedBeat(null);
                    router.replace((beat.kind === "trip" ? `/trip/${beat.id}` : `/event/${beat.id}`) as never);
                  });
                }}
              >
                <LinearGradient
                  colors={["#FF6B2C", "#FFB23E"]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={styles.beatShareBtn}
                >
                  <Ionicons name="share-outline" size={18} color="#fff" />
                  <Text style={styles.beatShareText}>Share with the squad</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.beatViewBtn}
                onPress={() => {
                  const beat = createdBeat;
                  setCreatedBeat(null);
                  router.replace((beat.kind === "trip" ? `/trip/${beat.id}` : `/event/${beat.id}`) as never);
                }}
              >
                <Text style={[styles.beatViewText, { color: colors.mutedForeground }]}>
                  {createdBeat.kind === "trip" ? "View trip" : "View plan"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 8, backgroundColor: colors.background }]}>
        {draftConflicts.length > 0 && (
          <ConflictBanner conflicts={draftConflicts} style={{ marginBottom: 10 }} />
        )}
        {!isPro && eventLimit !== null && !atLimit && (
          <Text style={[styles.allowanceCaption, { color: colors.textDim }]}>
            {myEventCount}/{eventLimit} free plans used
          </Text>
        )}
        <TouchableOpacity
          onPress={handleCreate}
          disabled={!title.trim() || creating}
          activeOpacity={0.9}
          style={styles.createBtnWrap}
        >
          {title.trim() ? (
            <LinearGradient
              colors={["#FF6B2C", "#FF8050"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={[styles.createBtn, creating && { opacity: 0.7 }]}
            >
              <Ionicons name={creating ? "hourglass-outline" : "add-circle-outline"} size={20} color="#fff" />
              <Text style={[styles.createBtnText, { color: "#fff" }]}>
                {creating ? "Creating…" : kind === "trip" ? "Create Trip" : "Create Event"}
              </Text>
            </LinearGradient>
          ) : (
            <View style={[styles.createBtn, { backgroundColor: colors.card }]}>
              <Ionicons name="add-circle-outline" size={20} color={colors.textDim} />
              <Text style={[styles.createBtnText, { color: colors.textDim }]}>Add a title to continue</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {Platform.OS === "ios" && pickerStep !== null && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setPickerStep(null)}>
          <View style={styles.pickerOverlay}>
            <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
              <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => setPickerStep(null)} style={styles.pickerBtn}>
                  <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                </TouchableOpacity>
                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
                  {pickerStep === "date" ? "Select Date" : "Select Time"}
                </Text>
                <TouchableOpacity onPress={handleIOSConfirm} style={styles.pickerBtn}>
                  <Text style={[styles.pickerBtnText, { color: colors.primary, fontWeight: "700" }]}>
                    {pickerStep === "date" ? "Next →" : "Done"}
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerDate}
                mode={pickerStep}
                display="spinner"
                onChange={(_, d) => { if (d) setPickerDate(d); }}
                minimumDate={new Date()}
                themeVariant="dark"
                style={{ width: "100%", height: 200 }}
              />
            </View>
          </View>
        </Modal>
      )}

      {Platform.OS === "android" && pickerStep !== null && (
        <DateTimePicker
          value={pickerDate}
          mode={pickerStep}
          display="default"
          onChange={handleAndroidChange}
          minimumDate={new Date()}
        />
      )}

      {/* Optional event end-time picker (date → time), mirrors the start picker. */}
      {Platform.OS === "ios" && endPickerStep !== null && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setEndPickerStep(null)}>
          <View style={styles.pickerOverlay}>
            <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
              <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => setEndPickerStep(null)} style={styles.pickerBtn}>
                  <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                </TouchableOpacity>
                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
                  {endPickerStep === "date" ? "End date" : "End time"}
                </Text>
                <TouchableOpacity onPress={handleEndIOSConfirm} style={styles.pickerBtn}>
                  <Text style={[styles.pickerBtnText, { color: colors.primary, fontWeight: "700" }]}>
                    {endPickerStep === "date" ? "Next →" : "Done"}
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={endPickerDate}
                mode={endPickerStep}
                display="spinner"
                onChange={(_, d) => { if (d) setEndPickerDate(d); }}
                minimumDate={eventAtISO ? new Date(eventAtISO) : new Date()}
                themeVariant="dark"
                style={{ width: "100%", height: 200 }}
              />
            </View>
          </View>
        </Modal>
      )}

      {Platform.OS === "android" && endPickerStep !== null && (
        <DateTimePicker
          value={endPickerDate}
          mode={endPickerStep}
          display="default"
          onChange={handleEndAndroidChange}
          minimumDate={eventAtISO ? new Date(eventAtISO) : new Date()}
        />
      )}

      {/* Trip date-range picker (start / end). */}
      {Platform.OS === "ios" && rangeStep !== null && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setRangeStep(null)}>
          <View style={styles.pickerOverlay}>
            <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
              <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => setRangeStep(null)} style={styles.pickerBtn}>
                  <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                </TouchableOpacity>
                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
                  {rangeStep === "start" ? "Start date" : "End date"}
                </Text>
                <TouchableOpacity onPress={() => confirmRange(rangeTmp)} style={styles.pickerBtn}>
                  <Text style={[styles.pickerBtnText, { color: colors.primary, fontWeight: "700" }]}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={rangeTmp}
                mode="date"
                display="spinner"
                onChange={(_, d) => { if (d) setRangeTmp(d); }}
                minimumDate={rangeStep === "end" && tripStart ? tripStart : new Date()}
                themeVariant="dark"
                style={{ width: "100%", height: 200 }}
              />
            </View>
          </View>
        </Modal>
      )}

      {Platform.OS === "android" && rangeStep !== null && (
        <DateTimePicker
          value={rangeTmp}
          mode="date"
          display="default"
          onChange={handleRangeAndroid}
          minimumDate={rangeStep === "end" && tripStart ? tripStart : new Date()}
        />
      )}

      <UpgradeModal
        visible={showUpgradeModal}
        trigger="events"
        onClose={() => setShowUpgradeModal(false)}
        onUpgradeSuccess={() => setIsPro(true)}
      />
    </View>
  );
}

// Plain DOM style for the web-only <input type="date"> range fields. Kept out
// of StyleSheet.create because it's passed straight to a DOM element on web.
const webDateInputStyle = {
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: 15,
  fontWeight: 700,
  fontFamily: "inherit",
  width: "100%",
  padding: 0,
  cursor: "pointer",
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  headerBack: { padding: 4, marginLeft: -4 },
  title: { fontSize: 28, fontWeight: "900" },
  limitBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1,
  },
  limitBannerText: { flex: 1, fontSize: 12, fontWeight: "600" },
  limitBannerBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  limitBannerBtnText: { fontSize: 11, fontWeight: "700" },
  body: { flex: 1, paddingHorizontal: 20 },
  section: { paddingTop: 20 },
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  kindRow: { flexDirection: "row", borderRadius: 14, borderWidth: 1, padding: 4, gap: 4 },
  kindOption: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 10, paddingVertical: 11 },
  kindText: { fontSize: 14, fontWeight: "800" },
  kindHint: { fontSize: 12, marginTop: 8, lineHeight: 17 },
  rangeRow: { flexDirection: "row", gap: 10 },
  rangeBtn: { flex: 1, borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 11 },
  rangeLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  rangeValue: { fontSize: 15, fontWeight: "700" },
  rangePreview: { fontSize: 13, fontWeight: "700", marginTop: 10 },
  coverSwatch: { width: 64, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  field: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, height: 52,
  },
  fieldInput: { flex: 1, fontSize: 15 },
  fieldMultiline: { height: undefined, alignItems: "flex-start", paddingVertical: 12 },
  dateBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, height: 52,
  },
  dateBtnText: { flex: 1, fontSize: 15 },
  dateDisplay: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12,
  },
  dateText: { flex: 1, fontSize: 15, fontWeight: "600" },
  editDateBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  editDateText: { fontSize: 12 },
  bestTimeBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 11, marginTop: 10 },
  quickChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  quickChip: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  quickChipText: { fontSize: 13, fontWeight: "700" },
  moreOptionsBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", paddingHorizontal: 14, paddingVertical: 12, marginBottom: 24 },
  moreOptionsText: { flex: 1, fontSize: 13, fontWeight: "600" },
  bestTimeText: { flex: 1, fontSize: 14, fontWeight: "700" },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, padding: 14,
  },
  toggleTitle: { fontSize: 15, fontWeight: "700" },
  toggleSub: { fontSize: 12, marginTop: 2 },
  squadList: { gap: 8 },
  newSquadRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 13, borderWidth: 1.5, borderStyle: "dashed", padding: 14 },
  newSquadText: { fontSize: 14, fontWeight: "700" },
  inviteHint: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 10 },
  inviteChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  inviteChip: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 20, paddingVertical: 5, paddingLeft: 5, paddingRight: 10, maxWidth: "100%" },
  inviteChipName: { fontSize: 13, fontFamily: "Inter_500Medium", maxWidth: 120 },
  squadOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 13, borderWidth: 1.5, padding: 12,
  },
  squadOptionEmoji: { fontSize: 22 },
  squadOptionBody: { flex: 1 },
  squadOptionName: { fontSize: 14, fontWeight: "700" },
  squadOptionCount: { fontSize: 12 },
  bottomBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  allowanceCaption: { fontSize: 11, fontWeight: "600", textAlign: "center", marginBottom: 8 },
  beatOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 28 },
  beatCard: { width: "100%", maxWidth: 340, borderRadius: 24, borderWidth: 1, padding: 24, alignItems: "center", gap: 6 },
  beatEmoji: { fontSize: 44, marginBottom: 2 },
  beatTitle: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  beatSub: { fontSize: 13, textAlign: "center", lineHeight: 18, marginBottom: 14 },
  beatShareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14 },
  beatShareText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  beatViewBtn: { paddingVertical: 12, paddingHorizontal: 16 },
  beatViewText: { fontSize: 13, fontWeight: "600" },
  createBtnWrap: { borderRadius: 15, overflow: "hidden" },
  createBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 15, paddingVertical: 15 },
  createBtnText: { fontSize: 16, fontWeight: "800" },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  pickerToolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  pickerBtn: { minWidth: 60 },
  pickerBtnText: { fontSize: 16 },
  pickerTitle: { fontSize: 16, fontWeight: "700" },
  upgradeOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.78)", justifyContent: "flex-end" },
  upgradeSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 44 },
  upgradeIconWrap: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  upgradeIcon: { fontSize: 28 },
  upgradeTitle: { fontSize: 22, fontWeight: "800", marginBottom: 8 },
  upgradeBody: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  upgradePriceBadge: { borderWidth: 1.5, borderRadius: 16, padding: 16, alignItems: "center", marginBottom: 18 },
  upgradePriceAmount: { fontSize: 40, fontWeight: "900", lineHeight: 44 },
  upgradePriceSub: { fontSize: 13, marginTop: 2 },
  upgradeFeatureRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  upgradeCheck: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  upgradeCheckText: { fontSize: 11, color: "#000", fontWeight: "900" },
  upgradeFeatureText: { fontSize: 14 },
  upgradeCtaWrap: { borderRadius: 14, overflow: "hidden", marginTop: 6, marginBottom: 10 },
  upgradeCta: { paddingVertical: 15, alignItems: "center" },
  upgradeCtaText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  upgradeDismiss: { alignItems: "center", paddingVertical: 8 },
  upgradeDismissText: { fontSize: 13 },
});
