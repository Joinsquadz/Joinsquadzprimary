import { Router, type IRouter, type Request, type Response } from "express";
import { eq, count, or, sql, and, gte, isNull, inArray, asc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  eventsTable,
  eventCreationsTable,
  usersTable,
  eventInvitesTable,
  activityTable,
  availabilityPollsTable,
} from "@workspace/db";
import type { ItineraryStop, PackingItem } from "@workspace/db";
import { storage } from "../storage";
import { canUserAccessEventRecord } from "../lib/eventVisibility";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";
import { emitEventUpdate, onEventUpdate } from "../lib/eventUpdates";
import { recordActivitySafe, removeActivity } from "../lib/activity";
import { parseEventStart, relativeDayLabel, formatEventTimeIn } from "../lib/eventDate";
import { groupRecipientsByZone } from "../lib/eventReminders";
import { resolveProStatus } from "../lib/proStatus";
import {
  FREE_PLAN_LIMIT,
  withPlanSlot,
  type Executor as PlanExecutor,
  countPlanSlotsUsed,
  nextPlanSlotAvailableAt,
  planLimitResponse,
} from "../lib/planLimit";
import {
  isWholeCent,
  isValidCostAmounts,
  WHOLE_CENT_MESSAGE,
} from "@workspace/cost-math";

const router: IRouter = Router();

function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined): string {
  if (!user) return "Someone";
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return user.email?.split("@")[0] ?? "Someone";
}

// Returns the subset of `targetIds` that `inviterId` is actually allowed to
// invite: their friends, or current members of the given squad. Used so an
// invite can never grant access to an arbitrary user id. De-duplicated.
async function filterInvitableTargets(
  inviterId: string,
  targetIds: string[],
  squadId?: string | null,
): Promise<string[]> {
  const unique = [...new Set(targetIds)];
  if (unique.length === 0) return [];
  const allowed = new Set<string>(await storage.getFriendIds(inviterId));
  if (squadId) {
    const squad = await storage.getSquad(squadId);
    for (const m of (squad?.memberIds ?? []) as string[]) allowed.add(m);
  }
  return unique.filter((id) => allowed.has(id));
}

// Fire-and-forget push to friends who were invited directly (not via the squad
// fan-out). Respects the Event Invites preference and squad mute.
// `pendingAcceptance` = the invitee has an unaccepted event_invites row and does
// NOT yet have access to the plan. Sending them to the plan detail screen would
// 403, so their tap must land on Activity where the Accept button lives.
// Create-time invites are written straight into invitedUserIds (real access), so
// those keep routing to the plan itself.
async function notifyInvitees(
  event: typeof eventsTable.$inferSelect,
  inviterId: string,
  inviteeIds: string[],
  pendingAcceptance = false,
): Promise<void> {
  try {
    const recipients = [...new Set(inviteeIds)].filter((id) => id !== inviterId);
    if (recipients.length === 0) return;
    const unmuted = event.squadId
      ? await storage.filterUnmutedForSquad(recipients, event.squadId)
      : recipients;
    const tokens = await storage.getPushTokensForUsers(unmuted, {
      requireNotifyEventInvites: true,
    });
    if (tokens.length === 0) return;
    const inviter = await storage.getUser(inviterId);
    const kind = event.type === "trip" ? "a trip" : "an event";
    await sendPushNotifications(
      tokens,
      {
        title: `${event.emoji} ${event.title}`,
        body: `${displayName(inviter)} invited you to ${kind}`,
        data: pendingAcceptance
          ? { screen: "activity", eventId: event.id }
          : {
              screen: event.type === "trip" ? "trip" : "event",
              eventId: event.id,
            },
      },
      { onStaleToken: (token) => storage.clearPushToken(token) },
    );
  } catch (err) {
    logger.error({ err }, "Error sending personal invite push notifications");
  }
}

const RSVP_LABEL: Record<string, string> = {
  going: "is going",
  maybe: "might come",
  notgoing: "can't make it",
};

// Free users may take part in up to FREE_EVENT_LIMIT PLANS — events and trips
// combined, whether they created them or joined them — within a trailing
// 12-month window. Enforced against the append-only event_creations ledger, so
// deleting an event or leaving one does not free a slot until its ledger row
// ages out of the window. The counting rules live in lib/planLimit.ts and are
// shared with every join path (invite accept, RSVP going, invite-code join).
const FREE_EVENT_LIMIT = FREE_PLAN_LIMIT;

type EventExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * Thrown inside the create transaction when the source poll was already
 * converted by a concurrent (or earlier) request. Rolls back the half-created
 * event so one poll can never yield two plans; the handler then returns the
 * plan that actually won the claim.
 */
class PollAlreadyConvertedError extends Error {
  constructor(readonly convertedEventId: string | null) {
    super("Availability poll already converted");
    this.name = "PollAlreadyConvertedError";
  }
}

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `SQ-${out}`;
}

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const CreateEventBody = z.object({
  type: z.enum(["event", "trip"]).default("event"),
  emoji: z.string().default("🎉"),
  // .trim() rejects whitespace-only titles that would render as blank cards.
  title: z.string().trim().min(1),
  date: z.string().default("TBD"),
  eventAt: z.string().datetime().optional(),
  // Trip date range (machine-readable). For trips, eventAt defaults to startAt.
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().default(false),
  coverStyle: z.string().default(""),
  location: z.string().default("TBD"),
  squadId: z.string().default(""),
  squadName: z.string().default("Personal"),
  hostId: z.string().optional(),
  description: z.string().default(""),
  inviteCode: z.string().optional(),
  isPublic: z.boolean().default(false),
  // IANA timezone string from the creator's device (e.g. "America/Los_Angeles").
  // Stored on the event so the day-of reminder scanner can compute "today" vs
  // "tomorrow" in the creator's locale rather than server UTC.
  timezone: z.string().optional(),
  // Friends invited directly at creation time (by user id). They gain access
  // immediately and are notified, in addition to any squad members.
  invitedUserIds: z.array(z.string().min(1)).default([]),
  // Whether the automated 3-day-out reminder should fire for this event.
  remind3DaysToggle: z.boolean().default(true),
  // Set when this plan is being created FROM a "Find the Best Time" poll. The
  // poll's conversion slot is claimed inside the create transaction, so a
  // double-tap (or a retried request) can never turn one poll into two plans.
  sourcePollId: z.string().min(1).max(120).optional(),
  // Template stops are accepted only at trip creation. The server adds trusted
  // ids/authorship/order before inserting them with the trip and poll claim.
  // This replaces a fragile post-create sequence of itinerary writes.
  initialItinerary: z.array(z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().max(40).optional(),
    title: z.string().trim().min(1).max(200),
    placeName: z.string().max(200).optional(),
    category: z.enum(["food", "activity", "lodging", "travel", "other"]).optional(),
  })).max(100).optional(),
});

// Body for inviting friends to an existing event/trip after creation.
const InviteUsersBody = z.object({
  userIds: z.array(z.string().min(1)).min(1),
});

const UpdateEventBody = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  date: z.string().optional(),
  eventAt: z.string().datetime().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  coverStyle: z.string().optional(),
  location: z.string().optional(),
  emoji: z.string().optional(),
  budget: z.number().optional(),
  isPublic: z.boolean().optional(),
  // Re-associate a trip/event with a squad (or clear it with ""). Host-only —
  // co-admins cannot move an event between squads.
  squadId: z.string().optional(),
  // Cancel (or un-cancel) the event. Host-only — co-admins cannot cancel.
  cancelled: z.boolean().optional(),
  timezone: z.string().optional(),
  // version is required so concurrent edits are serialised via compare-and-swap
  // rather than one edit silently overwriting the other.
  version: z.number().int(),
  // Toggle the automated 3-day-out reminder on or off after creation.
  remind3DaysToggle: z.boolean().optional(),
});

const CoAdminBody = z.object({ userId: z.string().min(1) });

// ── Itinerary (trip) request bodies ──────────────────────────────────────────
const STOP_CATEGORIES = ["food", "activity", "lodging", "travel", "other"] as const;

const AddStopBody = z.object({
  day: z.string().min(1), // ISO calendar date the stop belongs to
  time: z.string().default(""),
  endTime: z.string().default(""),
  title: z.string().trim().min(1),
  placeName: z.string().default(""),
  address: z.string().default(""),
  note: z.string().default(""),
  category: z.enum(STOP_CATEGORIES).default("other"),
  status: z.enum(["confirmed", "proposed"]).default("confirmed"),
  cost: z.number().nullable().optional(),
  paidById: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  version: z.number().int(),
});

const PatchStopBody = z.object({
  day: z.string().optional(),
  time: z.string().optional(),
  endTime: z.string().optional(),
  title: z.string().trim().min(1).optional(),
  placeName: z.string().optional(),
  address: z.string().optional(),
  note: z.string().optional(),
  category: z.enum(STOP_CATEGORIES).optional(),
  status: z.enum(["confirmed", "proposed"]).optional(),
  cost: z.number().nullable().optional(),
  paidById: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  version: z.number().int(),
});

const VoteStopBody = z.object({ version: z.number().int() });
const ConfirmStopBody = z.object({ version: z.number().int() });

// ── Packing checklist request bodies ─────────────────────────────────────────
const AddPackingBody = z.object({
  label: z.string().trim().min(1),
  version: z.number().int(),
});
const PatchPackingBody = z.object({
  label: z.string().trim().min(1).optional(),
  done: z.boolean().optional(),
  assigneeId: z.string().nullable().optional(),
  version: z.number().int(),
});

const SetRsvpBody = z.object({
  userId: z.string().optional(),
  status: z.enum(["going", "maybe", "notgoing"]),
  version: z.number().int().optional(),
});

const AddTaskBody = z.object({
  title: z.string().trim().min(1),
  // version is required so concurrent task adds from a stale read yield 409
  // instead of silently overwriting tasks written by a concurrent user.
  version: z.number().int(),
  category: z.string().optional(),
});

const PatchTaskBody = z.object({
  done: z.boolean().optional(),
  assigneeId: z.string().nullable().optional(),
  // version is required so concurrent task toggles/claims are serialised via
  // compare-and-swap rather than one write silently overwriting the other.
  version: z.number().int(),
});

// Money must land on a whole cent: floats like 10.005 can never be split
// exactly, so they are rejected at the edge instead of rounded silently.
// isWholeCent and WHOLE_CENT_MESSAGE come from @workspace/cost-math so the
// server and mobile app share a single source of truth for this check.
const NonNegativeMoney = z.number().finite().nonnegative().refine(isWholeCent, WHOLE_CENT_MESSAGE);
const PositiveMoney = z.number().finite().positive().refine(isWholeCent, WHOLE_CENT_MESSAGE);
const BillDetailsBody = z.object({
  baseAmount: NonNegativeMoney.optional(),
  taxAmount: NonNegativeMoney.optional(),
  tipAmount: NonNegativeMoney.optional(),
  tipPercent: z.number().finite().min(0).max(1000).optional(),
  feeAmount: NonNegativeMoney.optional(),
}).strict().optional();
const CostFieldsBody = {
  description: z.string().min(1),
  amount: PositiveMoney,
  paidById: z.string(),
  shares: z.array(z.object({ userId: z.string(), amount: NonNegativeMoney })),
  billDetails: BillDetailsBody,
  // Optional object path for an attached receipt photo. Validated for upload
  // ownership before being stored so a user can't reference someone else's upload.
  receiptUrl: z.string().nullable().optional(),
};
const AddCostBody = z.object({
  ...CostFieldsBody,
  // version is required so a concurrent add from a stale read yields 409 instead
  // of silently overwriting the expense list that was written concurrently.
  version: z.number().int(),
});

const AddPollBody = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)),
  // version is required so concurrent poll creates are serialised properly.
  version: z.number().int(),
});

const VotePollBody = z.object({
  userId: z.string().optional(),
  optionId: z.string(),
  // version is required so concurrent votes from different users are serialised
  // via compare-and-swap rather than silently losing one another's choices.
  version: z.number().int(),
});

const JoinEventBody = z.object({
  inviteCode: z.string().min(1),
});

// Plan visibility. The rule itself lives in lib/eventVisibility because the
// plan CHAT thread has to evaluate exactly the same thing, and a second copy of
// it here would drift. In short: host, explicit personal invite, or CURRENT
// squad membership grant access to both trips and plain events; plain events
// additionally accept an existing RSVP key, while trips deliberately ignore the
// rsvps map so a stale key can't outlive squad removal.
export async function userCanAccessEvent(
  event: typeof eventsTable.$inferSelect,
  userId: string,
): Promise<boolean> {
  return canUserAccessEventRecord(event, userId, async (squadId) => {
    const squad = await storage.getSquad(squadId);
    return (squad?.memberIds ?? []) as string[];
  });
}

async function getEventAsMember(
  id: string,
  userId: string,
  res: Response,
): Promise<(typeof eventsTable.$inferSelect) | null> {
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return null;
  }
  if (!(await userCanAccessEvent(event, userId))) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  return event;
}

// Like getEventAsMember, but for MUTATING sub-resource routes: a cancelled
// event is read-only (410), matching the invite-code join guard. Settle-up
// actions (mark-paid / confirm) deliberately do NOT use this — debts on a
// cancelled event stay payable.
async function getEventAsMemberForWrite(
  id: string,
  userId: string,
  res: Response,
): Promise<(typeof eventsTable.$inferSelect) | null> {
  const event = await getEventAsMember(id, userId, res);
  if (!event) return null;
  if (event.cancelled) {
    res.status(410).json({ error: "This event was cancelled" });
    return null;
  }
  return event;
}

// "Help manage" rights: the host plus any co-admin may edit details, color and
// itinerary. Cancelling the event and changing co-admins stay host-only.
// Exported for the plan-ideas routes (organizer/co-admin gates share this rule).
export function canManageEvent(
  event: typeof eventsTable.$inferSelect,
  userId: string,
): boolean {
  return event.hostId === userId || ((event.coAdminIds ?? []) as string[]).includes(userId);
}

// The set of user IDs legitimately allowed to appear in an event's costs:
// the squad's members (for squad events) plus the host and anyone who RSVP'd.
// Used to reject costs that reference arbitrary/external user IDs (which would
// otherwise spoof debts, mis-fire "you owe" pushes, or leak payment handles).
async function allowedParticipantIds(
  event: typeof eventsTable.$inferSelect,
): Promise<Set<string>> {
  const ids = new Set<string>([event.hostId]);
  for (const k of Object.keys((event.rsvps ?? {}) as Record<string, string>)) ids.add(k);
  for (const u of ((event.invitedUserIds ?? []) as string[])) ids.add(u);
  if (event.squadId) {
    const squad = await storage.getSquad(event.squadId);
    if (squad) for (const m of squad.memberIds) ids.add(m);
  }
  return ids;
}

// GET /events/preview?code=<inviteCode> — public, read-only preview of an event
// for shareable invite deep-links so a friend can see what they're joining
// before they sign in. Only exposes non-sensitive fields (no chat, costs, or
// member PII). Mirrors the public-squad preview (GET /discover/squads/:id).
router.get("/events/preview", async (req: Request, res: Response): Promise<void> => {
  try {
    // Privacy: full event details (title, host, date, location, going-count)
    // require a signed-in user. Unauthenticated visitors get a 401 and the
    // client falls back to generic SquadZ branding — same policy as shared
    // squad links (generic landing preview, never real content).
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Sign in to see event details." });
      return;
    }
    const rawCode = req.query.code;
    const code = (Array.isArray(rawCode) ? rawCode[0] : rawCode) as string | undefined;
    if (!code || typeof code !== "string" || !code.trim()) {
      res.status(404).json({ error: "This invite isn't available." });
      return;
    }

    const [event] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.inviteCode, code.trim()));

    if (!event) {
      res.status(404).json({ error: "This invite isn't available." });
      return;
    }
    if (event.cancelled) {
      res.status(410).json({ error: "This event has been cancelled." });
      return;
    }

    let hostName: string | null = null;
    if (event.hostId) {
      const [host] = await db
        .select({
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
        })
        .from(usersTable)
        .where(eq(usersTable.id, event.hostId));
      hostName =
        [host?.firstName, host?.lastName].filter(Boolean).join(" ").trim() || null;
    }

    const rsvps = (event.rsvps ?? {}) as Record<string, string>;
    const goingCount = Object.values(rsvps).filter((s) => s === "going").length;

    res.json({
      emoji: event.emoji,
      title: event.title,
      // Trips live in the same table as events but have their own detail
      // screen; the client needs the plan type to route the accepted invite
      // to /trip/:id instead of /event/:id.
      type: event.type === "trip" ? "trip" : "event",
      hostName,
      // `date` is the creator's stored display text; the absolute fields let the
      // client render the start on the *viewer's* clock instead. Kept as a
      // fallback for all-day/TBD/legacy events that have no instant.
      date: event.date,
      eventAt: event.eventAt,
      startAt: event.startAt,
      allDay: event.allDay,
      location: event.location,
      goingCount,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching event preview");
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

// GET /events/count — requires auth, returns user's event count vs free limit.
// Also returns nextSlotAvailableAt so the client can show "your oldest slot
// frees up [date]" in the UpgradeModal without needing a failed create attempt.
router.get("/events/count", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const [total, nextSlotAvailableAt] = await Promise.all([
      storage.countUserEventCreationsInWindow(userId),
      storage.getOldestEventCreationAt(userId),
    ]);
    // `count` covers plans created AND joined — the ledger records both.
    res.json({ count: total, limit: FREE_EVENT_LIMIT, nextSlotAvailableAt });
  } catch (err) {
    logger.error({ err }, "Error fetching event count");
    res.status(500).json({ error: "Failed to fetch event count" });
  }
});

router.get("/events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  // The Trips·Events·Past hub needs past items too; everywhere else wants only
  // current/upcoming. `?includePast=1` drops the time filter (keeping the
  // who-can-see-it scoping) so the hub can render its "Past" segment.
  const includePast = req.query.includePast === "1" || req.query.includePast === "true";
  // Hide items once their time has fully passed: keep an item whose eventAt (or,
  // for trips, the last day of the range, endAt) is >= the start of today. Items
  // with no concrete time yet (eventAt IS NULL — still being planned / "TBD")
  // are always kept.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  try {
    // Squad items (trips AND plain events) are visible to every CURRENT member
    // of their squad, with no RSVP required.
    const squadIds = await storage.getSquadIdsForUser(userId);
    const visibility = or(
      eq(eventsTable.hostId, userId),
      // RSVP visibility is for plain events only — a trip must never be visible
      // via a stale RSVP key after the user is removed from its squad.
      and(sql`${eventsTable.type} <> 'trip'`, sql`${eventsTable.rsvps} ? ${userId}`),
      // An explicit personal invite makes the trip/event visible regardless of
      // squad membership (and is safe for trips: it's never written by an RSVP).
      sql`${eventsTable.invitedUserIds} ? ${userId}`,
      ...(squadIds.length > 0 ? [inArray(eventsTable.squadId, squadIds)] : []),
    );
    const notExpired = or(
      isNull(eventsTable.eventAt),
      gte(eventsTable.eventAt, startOfToday),
      gte(eventsTable.endAt, startOfToday),
    );

    // Paginate: default 100 events, client-supplied ?limit up to 200 and
    // ?offset for page-based fetching. Still returns a plain array
    // (backward-compatible). X-Has-More: 1 header signals more pages exist.
    const PAGE_SIZE = 100;
    const reqLimit = Number(req.query.limit);
    const limit = Number.isFinite(reqLimit) && reqLimit > 0
      ? Math.min(reqLimit, 200)
      : PAGE_SIZE;
    const reqOffset = Number(req.query.offset);
    const offset = Number.isFinite(reqOffset) && reqOffset > 0 ? Math.floor(reqOffset) : 0;

    const rows = await db
      .select()
      .from(eventsTable)
      .where(includePast ? visibility : and(visibility, notExpired))
      .orderBy(eventsTable.eventAt, eventsTable.createdAt)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    res.setHeader('X-Has-More', hasMore ? '1' : '0');
    res.json(events);
  } catch (err) {
    logger.error({ err }, "Error fetching event list");
    res.status(500).json({ error: "Failed to load events" });
  }
});

router.post("/events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const authUser = req.user as { id: string; email?: string };

  try {
    let user = await storage.getUser(authUser.id);
    if (!user) {
      user = await storage.upsertUser(authUser.id, authUser.email ?? "");
    }

    const isPro = await resolveProStatus(user!);

    const {
      inviteCode,
      hostId: _bodyHostId,
      eventAt,
      startAt,
      endAt,
      invitedUserIds: requestedInvites,
      sourcePollId,
      initialItinerary,
      ...rest
    } = parsed.data;
    const hostId = authUser.id;
    if (rest.type !== "trip" && initialItinerary?.length) {
      res.status(400).json({ error: "An itinerary can only be created with a trip." });
      return;
    }
    // A trip's start may arrive as `startAt` or (for callers that only set a
    // single time) as `eventAt`; either one anchors the range.
    const resolvedStartAt = rest.type === "trip" ? (startAt ?? eventAt) : startAt;
    if (rest.type === "trip" && !resolvedStartAt) {
      res.status(400).json({ error: "A trip needs a start date." });
      return;
    }
    // A trip is a complete inclusive date range. Normalize a missing end to the
    // start day and reject inverted values before creating any related rows.
    const resolvedEndAt = rest.type === "trip" ? (endAt ?? resolvedStartAt) : endAt;
    if (
      rest.type === "trip" &&
      resolvedStartAt &&
      resolvedEndAt &&
      new Date(resolvedEndAt).getTime() < new Date(resolvedStartAt).getTime()
    ) {
      res.status(400).json({ error: "A trip's end date can't be before its start date." });
      return;
    }
    // A plan may only be attached to a squad the creator is CURRENTLY in. An
    // unchecked squadId lets a caller drop a plan into a stranger squad's feed,
    // or strand it against a squad id that does not exist (nobody, including
    // the creator, can then resolve it). squadName is always taken from the
    // squad record so the denormalized copy can't be spoofed by the client.
    if (rest.squadId) {
      const targetSquad = await storage.getSquad(rest.squadId);
      if (!targetSquad) {
        res.status(404).json({ error: "That squad no longer exists." });
        return;
      }
      if (!((targetSquad.memberIds ?? []) as string[]).includes(hostId)) {
        res.status(403).json({ error: "You can only create plans in a squad you're in." });
        return;
      }
      rest.squadName = targetSquad.name;
    } else {
      rest.squadName = "Personal";
    }
    // Only allow inviting people the host can actually reach: their friends or
    // current members of the squad this is being created in. Anything else is
    // silently dropped (never invite arbitrary user ids).
    const invitedUserIds = await filterInvitableTargets(
      hostId,
      requestedInvites.filter((u) => u !== hostId),
      rest.squadId,
    );
    // For trips, eventAt defaults to startAt so existing reminder/expiry logic
    // (which keys on eventAt) still works; endAt drives range-aware expiry.
    const resolvedEventAt = eventAt ?? (rest.type === "trip" ? resolvedStartAt : undefined);
    const initialStops: ItineraryStop[] = (initialItinerary ?? []).map((stop, index) => ({
      id: `s${Date.now()}-${index}`,
      day: stop.day,
      time: stop.time ?? "",
      title: stop.title,
      placeName: stop.placeName ?? "",
      category: stop.category ?? "other",
      status: "confirmed",
      endTime: "",
      address: "",
      note: "",
      cost: null,
      paidById: null,
      assigneeId: null,
      createdBy: hostId,
      votes: [],
      // Preserve template order within a day while still giving each day its
      // own zero-based ordering, matching the regular itinerary endpoint.
      sortOrder: (initialItinerary ?? []).slice(0, index).filter((prior) => prior.day === stop.day).length,
    }));
    const insertValues = {
      ...rest,
      hostId,
      invitedUserIds,
      inviteCode: inviteCode ?? randomCode(),
      // Trips have no RSVP UI (access is squad-membership based), so the organizer
      // would otherwise show as "0 going". Seed the host as going at creation so
      // the count reflects them immediately. Events deliberately leave the host
      // unset and prompt them to RSVP, so they are not seeded here.
      ...(rest.type === "trip" ? { rsvps: { [hostId]: "going" } } : {}),
      ...(resolvedEventAt ? { eventAt: new Date(resolvedEventAt) } : {}),
      ...(resolvedStartAt ? { startAt: new Date(resolvedStartAt) } : {}),
      ...(resolvedEndAt ? { endAt: new Date(resolvedEndAt) } : {}),
      ...(initialStops.length > 0 ? { itinerary: initialStops } : {}),
    };

    // Only the poll's creator converts it into a plan (mirrors POST
    // /availability/polls/:id/convert). An unknown poll id, or one belonging to
    // someone else, is ignored rather than failing the create — the plan is
    // still valid, it just isn't credited as this poll's conversion.
    let claimPollId: string | null = null;
    if (sourcePollId) {
      const sourcePoll = await storage.getAvailabilityPoll(sourcePollId);
      if (sourcePoll && sourcePoll.createdBy === hostId) claimPollId = sourcePoll.id;
    }

    // Enforce the free-tier event cap and append the ledger row atomically. A
    // per-user advisory lock serializes a user's concurrent creates so the
    // count-then-insert cannot race past the limit (mirrors the squad cap). Pro
    // users skip the cap. Under unit-test mocks db.transaction is absent, so we
    // fall back to a direct, unenforced insert (the cap is covered elsewhere).
    const runCreate = async (
      executor: EventExecutor,
      inTransaction: boolean,
    ): Promise<
      | { ok: true; event: typeof eventsTable.$inferSelect }
      | { ok: false; count: number; nextSlotAvailableAt: string | null }
    > => {
      if (!isPro && inTransaction) {
        await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${hostId}))`);
        // Shared with the JOIN side (lib/planLimit.ts) so creating and joining
        // draw from the SAME pool of free plan slots. The count excludes
        // "orphaned quick-cancels" — an event cancelled within an hour of its
        // ledger entry with no invites and no RSVPs is a pure mis-tap.
        const used = await countPlanSlotsUsed(executor, hostId);
        if (used >= FREE_EVENT_LIMIT) {
          // Surface when the oldest counted slot frees up so the client can
          // show "try again after <date>" without an extra API call.
          return {
            ok: false,
            count: used,
            nextSlotAvailableAt: await nextPlanSlotAvailableAt(executor, hostId),
          };
        }
      }
      const [created] = await executor.insert(eventsTable).values(insertValues).returning();
      await executor
        .insert(eventCreationsTable)
        .values({ userId: hostId, eventId: created.id, source: "create" });

      // Exactly-once poll conversion. The claim lives in the SAME transaction
      // as the insert: stamping the poll only while converted_event_id IS NULL
      // means two concurrent "lock in this time" taps contend on one row, and
      // the loser's event is rolled back instead of becoming a duplicate plan.
      // Claiming after the event exists (the old client-side /convert call)
      // could only ever re-stamp the poll — both events had already been made.
      if (claimPollId) {
        const [claimed] = await executor
          .update(availabilityPollsTable)
          .set({ convertedEventId: created.id })
          .where(
            and(
              eq(availabilityPollsTable.id, claimPollId),
              isNull(availabilityPollsTable.convertedEventId),
            ),
          )
          .returning({ convertedEventId: availabilityPollsTable.convertedEventId });
        if (!claimed) {
          const [existing] = await executor
            .select({ convertedEventId: availabilityPollsTable.convertedEventId })
            .from(availabilityPollsTable)
            .where(eq(availabilityPollsTable.id, claimPollId));
          throw new PollAlreadyConvertedError(existing?.convertedEventId ?? null);
        }
      }
      return { ok: true, event: created };
    };

    const result =
      typeof db.transaction === "function"
        ? await db.transaction((tx) => runCreate(tx, true))
        : await runCreate(db, false);

    if (!result.ok) {
      res.status(403).json(
        planLimitResponse({
          count: result.count,
          limit: FREE_EVENT_LIMIT,
          nextSlotAvailableAt: result.nextSlotAvailableAt,
        }),
      );
      return;
    }

    const event = result.event;
    res.status(201).json(event);

    // Fire-and-forget: notify the friends invited directly at creation time.
    const directInviteeIds = new Set(invitedUserIds);
    if (directInviteeIds.size > 0) {
      void notifyInvitees(event, hostId, [...directInviteeIds]);
    }

    // Fire-and-forget: a squad event invites the rest of the squad.
    if (event.squadId) {
      void (async () => {
        try {
          const squad = await storage.getSquad(event.squadId);
          // Direct invitees have already been notified above. A person may be
          // both explicitly invited and a squad member; never send them the
          // same plan invite twice.
          const memberIds = [...new Set((squad?.memberIds ?? []) as string[])].filter(
            (m) => m !== hostId && !directInviteeIds.has(m),
          );
          if (memberIds.length === 0) return;
          // Respect both per-squad mute and the Event Invites preference.
          const unmuted = await storage.filterUnmutedForSquad(memberIds, event.squadId);
          const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifyEventInvites: true });
          if (tokens.length === 0) return;

          const host = await storage.getUser(hostId);
          await sendPushNotifications(
            tokens,
            {
              title: `${event.emoji} ${event.title}`,
              body: `${displayName(host)} invited you to ${event.type === "trip" ? "a trip" : "an event"}`,
              data: { screen: event.type === "trip" ? "trip" : "event", eventId: event.id },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
        } catch (err) {
          logger.error({ err }, "Error sending event-invite push notifications");
        }
      })();
    }
  } catch (err) {
    // The source poll was already turned into a plan by a concurrent request —
    // this create was rolled back. Return the winning plan so the client lands
    // on it instead of reporting a failure or retrying into a duplicate.
    if (err instanceof PollAlreadyConvertedError) {
      const existingId = err.convertedEventId;
      const existing = existingId ? await storage.getEvent(existingId) : null;
      if (existing) {
        res.status(200).json({ ...existing, alreadyConverted: true });
      } else {
        res.status(409).json({
          error: "This poll has already been turned into a plan.",
          convertedEventId: existingId,
          alreadyConverted: true,
        });
      }
      return;
    }
    logger.error({ err }, "Error creating event");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to create event" });
    }
  }
});

// POST /events/join — requires auth, joins an event by invite code
router.post("/events/join", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = JoinEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req.user as { id: string }).id;
  const { inviteCode } = parsed.data;

  const [existing] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.inviteCode, inviteCode));

  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  if (existing.cancelled) {
    res.status(410).json({ error: "This event has been cancelled" });
    return;
  }

  const rsvps = (existing.rsvps ?? {}) as Record<string, string>;
  if (userId in rsvps) {
    // Already-going is a terminal success for the client: it opens the plan
    // instead of showing an error, so it needs the id AND the plan type
    // (trips have their own detail route).
    res.status(409).json({
      error: "You're already going to this event",
      id: existing.id,
      type: existing.type === "trip" ? "trip" : "event",
    });
    return;
  }

  // Joining a plan consumes a free-tier plan slot, exactly like creating one.
  // The RSVP write runs INSIDE the claim's transaction so the ledger row and
  // the join commit together — a failed or zero-row update must not burn a slot.
  const slot = await withPlanSlot(
    userId,
    existing.id,
    // Atomic per-user merge (see /events/:id/rsvp): write only this user's key
    // so concurrent invite-link joins can't clobber each other's RSVP.
    (tx) =>
      tx
        .update(eventsTable)
        .set({
          rsvps: sql`COALESCE(${eventsTable.rsvps}, '{}'::jsonb) || ${JSON.stringify({ [userId]: "going" })}::jsonb`,
          version: sql`${eventsTable.version} + 1`,
        })
        .where(eq(eventsTable.id, existing.id))
        .returning(),
    // Zero rows = the plan was deleted between the lookup and the write; the
    // user never joined, so they must not be charged.
    (rows) => rows.length > 0,
  );
  if (!slot.ok) {
    res.status(403).json(planLimitResponse(slot));
    return;
  }
  const [event] = slot.value;
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  res.json(event);
  emitEventUpdate(existing.id);
  recordActivitySafe({
    recipientId: event.hostId,
    actorId: userId,
    type: "rsvp",
    subjectType: "event",
    subjectId: event.id,
    meta: { rsvpStatus: "going", subjectName: event.title, subjectEmoji: event.emoji },
    dedupe: true,
  });

  // Fire-and-forget: joining by invite code is an RSVP, so tell the host
  // someone is going (skip the self-host case).
  if (event.hostId !== userId) {
    void (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers([event.hostId], { requireNotifyFriendActivity: true });
        if (tokens.length === 0) return;
        const responder = await storage.getUser(userId);
        const label = RSVP_LABEL["going"] ?? "is going";
        await sendPushNotifications(
          tokens,
          {
            title: `${event.emoji} ${event.title}`,
            body: `${displayName(responder)} ${label}`,
            data: { screen: event.type === "trip" ? "trip" : "event", eventId: event.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending join RSVP push notification");
      }
    })();
  }
});

router.get("/events/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!(await userCanAccessEvent(event, userId))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  res.json(event);
});

router.patch("/events/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = UpdateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!canManageEvent(existing, userId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const { version: clientVersion, ...fieldsToUpdate } = parsed.data;
  // Cancelling (or un-cancelling) is host-only — co-admins cannot cancel.
  if (
    fieldsToUpdate.cancelled !== undefined &&
    fieldsToUpdate.cancelled !== existing.cancelled &&
    existing.hostId !== userId
  ) {
    res.status(403).json({ error: "Only the host can cancel this event." });
    return;
  }
  // A cancelled event is read-only except for the host un-cancelling it.
  if (existing.cancelled && fieldsToUpdate.cancelled !== false) {
    res.status(410).json({ error: "This event was cancelled" });
    return;
  }
  // Re-associating the event with a different squad is a structural change
  // reserved for the host; co-admins only get details/color/itinerary.
  if (
    fieldsToUpdate.squadId !== undefined &&
    fieldsToUpdate.squadId !== existing.squadId &&
    existing.hostId !== userId
  ) {
    res.status(403).json({ error: "Only the host can change which squad this belongs to." });
    return;
  }
  // When the host moves the event to a squad, the target squad must actually
  // exist AND the host must be a CURRENT member of it. Without this check a
  // host could attach their event to any squad id (including one they were
  // removed from, or one that does not exist), which either leaks the plan into
  // a stranger squad's feed or strands it against a dangling squad id that no
  // one — including the host — can resolve. The denormalized squadName is
  // always taken from the squad record, never from the client.
  if (
    fieldsToUpdate.squadId !== undefined &&
    fieldsToUpdate.squadId !== existing.squadId
  ) {
    if (fieldsToUpdate.squadId) {
      const targetSquad = await storage.getSquad(fieldsToUpdate.squadId);
      if (!targetSquad) {
        res.status(404).json({ error: "That squad no longer exists." });
        return;
      }
      if (!((targetSquad.memberIds ?? []) as string[]).includes(userId)) {
        res.status(403).json({ error: "You can only move this to a squad you're in." });
        return;
      }
      (fieldsToUpdate as Record<string, unknown>).squadName = targetSquad.name;
    } else {
      (fieldsToUpdate as Record<string, unknown>).squadName = "Personal";
    }
  }
  const patch: Record<string, unknown> = {
    ...fieldsToUpdate,
    version: sql`${eventsTable.version} + 1`,
  };
  if (fieldsToUpdate.budget !== undefined) {
    patch.budget = String(fieldsToUpdate.budget);
  }
  if (fieldsToUpdate.eventAt !== undefined) {
    patch.eventAt = new Date(fieldsToUpdate.eventAt);
  }
  if (fieldsToUpdate.startAt !== undefined) {
    patch.startAt = fieldsToUpdate.startAt === null ? null : new Date(fieldsToUpdate.startAt);
  }
  if (fieldsToUpdate.endAt !== undefined) {
    patch.endAt = fieldsToUpdate.endAt === null ? null : new Date(fieldsToUpdate.endAt);
  }
  const [event] = await db.update(eventsTable)
    .set(patch)
    .where(and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion)))
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);

  // Audience for edit/cancel pushes: everyone who has RSVP'd (any status) plus
  // explicitly invited users, excluding the editor. Squad events respect the
  // per-squad mute; the Event Invites preference gates delivery (consistent
  // with the other event-lifecycle pushes).
  const collectEditAudience = async (): Promise<string[]> => {
    const audience = new Set<string>(Object.keys((event.rsvps ?? {}) as Record<string, string>));
    for (const uid of ((event.invitedUserIds ?? []) as string[])) audience.add(uid);
    audience.add(event.hostId);
    audience.delete(userId);
    const recipients = [...audience];
    if (recipients.length === 0) return [];
    return event.squadId
      ? await storage.filterUnmutedForSquad(recipients, event.squadId)
      : recipients;
  };

  // ── Cancellation push (fires exactly once: only on the false→true edge) ────
  const justCancelled = fieldsToUpdate.cancelled === true && !existing.cancelled;
  if (justCancelled) {
    void (async () => {
      try {
        const unmuted = await collectEditAudience();
        if (unmuted.length === 0) return;
        const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifyEventInvites: true });
        if (tokens.length === 0) return;
        const hasCosts = ((event.costs ?? []) as unknown[]).length > 0;
        await sendPushNotifications(
          tokens,
          {
            title: `${event.title} was cancelled`,
            body: hasCosts
              ? "This plan is off. Any costs already logged still appear in settle-up."
              : "This plan is off.",
            data: { screen: event.type === "trip" ? "trip" : "event", eventId: event.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending event-cancelled push notifications");
      }
    })();
    return; // A cancel edit never also fires a material-edit push.
  }

  // ── Material-edit push (date/time, location, title) ────────────────────────
  // Fire-and-forget: when a concrete time is locked in from TBD, keep the
  // celebratory "time is set" copy; other material edits get "[Event] was
  // updated" with a body prioritizing time > place > title. Debounced: material
  // edits within a 5-minute window collapse into one push (poll-update pattern).
  if (event.cancelled) return; // no edit pushes on a cancelled event
  const newDate = parsed.data.date?.trim();
  const dateChanged =
    newDate !== undefined &&
    newDate !== "" &&
    newDate.toUpperCase() !== "TBD" &&
    newDate !== existing.date;
  const eventAtChanged =
    fieldsToUpdate.eventAt !== undefined &&
    new Date(fieldsToUpdate.eventAt).getTime() !== (existing.eventAt ? new Date(existing.eventAt as unknown as string).getTime() : NaN);
  const timeChanged = dateChanged || eventAtChanged;
  const locationChanged =
    fieldsToUpdate.location !== undefined &&
    fieldsToUpdate.location.trim() !== "" &&
    fieldsToUpdate.location !== existing.location;
  const titleChanged =
    fieldsToUpdate.title !== undefined &&
    fieldsToUpdate.title.trim() !== "" &&
    fieldsToUpdate.title !== existing.title;
  const wasTbd = !existing.date || existing.date.trim() === "" || existing.date.trim().toUpperCase() === "TBD";
  const dateLockedIn = dateChanged && wasTbd;

  if (timeChanged || locationChanged || titleChanged) {
    const MATERIAL_EDIT_COOLDOWN_MS = 5 * 60 * 1000;
    // Atomic cooldown stamp: this UPDATE only fires when the cooldown window
    // has elapsed (or has never been set). Two concurrent PATCH requests race
    // on this single statement — the DB serialises them, and only the winner
    // gets a RETURNING row. The loser sees 0 rows and skips the push, closing
    // the read-then-write race in the old check-then-stamp pattern.
    const [stamped] = await db
      .update(eventsTable)
      .set({ materialEditNotifiedAt: new Date() })
      .where(
        and(
          eq(eventsTable.id, id),
          or(
            isNull(eventsTable.materialEditNotifiedAt),
            sql`${eventsTable.materialEditNotifiedAt} < NOW() - make_interval(secs => ${MATERIAL_EDIT_COOLDOWN_MS / 1000})`,
          ),
        ),
      )
      .returning({ id: eventsTable.id });
    void (async () => {
      if (!stamped) return; // cooldown active — another concurrent edit already won the stamp race
      try {
        const unmuted = await collectEditAudience();
        if (unmuted.length === 0) return;
        const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifyEventInvites: true });
        if (tokens.length === 0) return;
        // Body prioritizes time > place > title when several fields changed.
        const body = timeChanged
          ? `New time: ${newDate ?? event.date}`
          : locationChanged
            ? `New location: ${event.location}`
            : `New name: ${event.title}`;
        await sendPushNotifications(
          tokens,
          dateLockedIn
            ? {
                title: `${event.emoji} ${event.title}`,
                body: `The time is set: ${newDate}`,
                data: { screen: event.type === "trip" ? "trip" : "event", eventId: event.id },
              }
            : {
                title: `${event.title} was updated`,
                body,
                data: { screen: event.type === "trip" ? "trip" : "event", eventId: event.id },
              },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending event-updated push notifications");
      }
    })();
  }
});

// Grant a co-admin "help manage" rights. Host-only. The target must already be
// able to access the event (squad member or personally invited), so we don't
// accidentally grant management to an outsider.
router.post("/events/:id/co-admins", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = CoAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const targetId = parsed.data.userId;
  const [existing] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (existing.hostId !== userId) {
    res.status(403).json({ error: "Only the host can change co-admins." });
    return;
  }
  if (targetId === existing.hostId) {
    res.status(400).json({ error: "The host already manages this." });
    return;
  }
  if (!(await userCanAccessEvent(existing, targetId))) {
    res.status(400).json({ error: "Only people on this event can be made co-admins." });
    return;
  }
  const current = (existing.coAdminIds ?? []) as string[];
  if (current.includes(targetId)) {
    res.json(existing);
    return;
  }
  // Atomic, dedupe-safe append so concurrent grants can't duplicate or lose entries.
  const [event] = await db
    .update(eventsTable)
    .set({
      coAdminIds: sql`CASE WHEN ${eventsTable.coAdminIds} @> ${JSON.stringify([targetId])}::jsonb THEN ${eventsTable.coAdminIds} ELSE ${eventsTable.coAdminIds} || ${JSON.stringify([targetId])}::jsonb END`,
      version: sql`${eventsTable.version} + 1`,
    })
    .where(eq(eventsTable.id, id))
    .returning();
  res.json(event);
  emitEventUpdate(id);

  void (async () => {
    try {
      const tokens = await storage.getPushTokensForUsers([targetId]);
      if (tokens.length === 0) return;
      await sendPushNotifications(
        tokens,
        {
          title: `${event.emoji} ${event.title}`,
          body: `You're now a co-admin — you can help manage this ${event.type === "trip" ? "trip" : "event"}.`,
          data: { screen: event.type === "trip" ? "trip" : "event", eventId: event.id },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
    } catch (err) {
      logger.error({ err }, "Error sending co-admin-added push notification");
    }
  })();
});

// Revoke a co-admin. Host-only.
router.delete("/events/:id/co-admins/:userId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const targetId = parseId(req.params.userId);
  const userId = (req.user as { id: string }).id;
  const [existing] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (existing.hostId !== userId) {
    res.status(403).json({ error: "Only the host can change co-admins." });
    return;
  }
  const current = (existing.coAdminIds ?? []) as string[];
  if (!current.includes(targetId)) {
    res.json(existing);
    return;
  }
  // Atomic removal so concurrent revocations can't lose updates (no read-modify-write).
  const [event] = await db
    .update(eventsTable)
    .set({
      coAdminIds: sql`COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements_text(${eventsTable.coAdminIds}) AS elem WHERE elem <> ${targetId}), '[]'::jsonb)`,
      version: sql`${eventsTable.version} + 1`,
    })
    .where(eq(eventsTable.id, id))
    .returning();
  res.json(event);
  emitEventUpdate(id);
});

router.delete("/events/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const [existing] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (existing.hostId !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  await db.delete(eventsTable).where(eq(eventsTable.id, id));
  emitEventUpdate(id);
  res.sendStatus(204);
});

router.post("/events/:id/rsvp", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = SetRsvpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  // Past events don't accept new RSVPs or RSVP changes: RSVP is a plan-ahead
  // action, and late flips would silently corrupt the historical attendance
  // record (and settle-up assumptions). Trips are considered past after endAt.
  const eventEnd = existing.endAt ?? existing.eventAt;
  if (eventEnd && new Date(eventEnd as unknown as string).getTime() < Date.now()) {
    res.status(410).json({ error: "This event already happened — RSVPs are closed." });
    return;
  }
  const { status } = parsed.data;
  // Atomic per-user RSVP merge: each user only ever writes their OWN key in the
  // rsvps JSON map, so we merge that single key server-side (`||`) instead of a
  // read-modify-write of the whole object. This removes the whole-row version
  // gate that made concurrent RSVPs from different users spuriously 409 (a
  // disjoint-key "conflict") and also closes the lost-update window.
  const rsvpWrite = (executor: PlanExecutor) =>
    executor
      .update(eventsTable)
      .set({
        rsvps: sql`COALESCE(${eventsTable.rsvps}, '{}'::jsonb) || ${JSON.stringify({ [userId]: status })}::jsonb`,
        version: sql`${eventsTable.version} + 1`,
      })
      .where(eq(eventsTable.id, id))
      .returning();

  let event;
  if (status === "going") {
    // RSVPing "going" is how you take part in a plan you were invited to, so it
    // consumes a free-tier plan slot (idempotent per plan — changing your mind
    // and coming back never charges twice, and the host's create already claimed
    // their own row). The RSVP write runs inside the claim transaction so a
    // failed write can't leave a slot spent on a plan they never joined.
    // maybe/notgoing are not participation and cost nothing.
    const slot = await withPlanSlot(
      userId,
      id,
      (tx) => rsvpWrite(tx),
      (rows) => rows.length > 0,
    );
    if (!slot.ok) {
      res.status(403).json(planLimitResponse(slot));
      return;
    }
    [event] = slot.value;
  } else {
    [event] = await rsvpWrite(db);
  }
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
  // Activity feed only celebrates "going" RSVPs. If the user switches away from
  // going (to maybe/notgoing), pull any existing row so the host's feed and the
  // RSVP-momentum banner never show a stale "is going" for someone who backed out.
  if (parsed.data.status === "going") {
    recordActivitySafe({
      recipientId: event.hostId,
      actorId: userId,
      type: "rsvp",
      subjectType: "event",
      subjectId: event.id,
      meta: { rsvpStatus: "going", subjectName: event.title, subjectEmoji: event.emoji },
      dedupe: true,
    });
  } else {
    removeActivity({
      recipientId: event.hostId,
      actorId: userId,
      type: "rsvp",
      subjectId: event.id,
    });
  }

  // Fire-and-forget: tell the host who responded and how (skip self-RSVP).
  if (event.hostId !== userId) {
    void (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers([event.hostId], { requireNotifyFriendActivity: true });
        if (tokens.length === 0) return;
        const responder = await storage.getUser(userId);
        const label = RSVP_LABEL[parsed.data.status] ?? "responded";
        await sendPushNotifications(
          tokens,
          {
            title: `${event.emoji} ${event.title}`,
            body: `${displayName(responder)} ${label}`,
            data: { screen: event.type === "trip" ? "trip" : "event", eventId: event.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending RSVP push notification");
      }
    })();
  }
});

// POST /events/:id/invite — invite one or more friends directly to this
// trip/event. The inviter must already have access; each target must be a
// friend of the inviter OR a current member of the squad (others are dropped).
// Newly-invited people gain access immediately and are push-notified.
router.post("/events/:id/invite", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = InviteUsersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;

  const targets = await filterInvitableTargets(
    userId,
    parsed.data.userIds.filter((u) => u !== existing.hostId),
    existing.squadId,
  );
  // Candidates = chosen friends/squad-members who don't already have access.
  // (Someone already in invitedUserIds is genuinely a member — no invite needed.)
  const alreadyInvited = new Set((existing.invitedUserIds ?? []) as string[]);
  const candidates: string[] = [];
  for (const t of targets) {
    if (alreadyInvited.has(t)) continue;
    if (await userCanAccessEvent(existing, t)) continue;
    candidates.push(t);
  }

  if (candidates.length === 0) {
    res.json({ ok: true, inviteCount: 0 });
    return;
  }

  // Inspect any existing invite rows so a prior accept/decline can't silently
  // block a re-invite. The unique (eventId, invitedUserId) constraint means a
  // plain onConflictDoNothing would drop these and return a fake success.
  const existingInvites = await db
    .select()
    .from(eventInvitesTable)
    .where(and(eq(eventInvitesTable.eventId, id), inArray(eventInvitesTable.invitedUserId, candidates)));
  const statusByUser = new Map(existingInvites.map((r) => [r.invitedUserId, r.status]));

  // "accepted" but not in invitedUserIds = drifted access; repair it directly
  // (grant access now) instead of issuing another invite that can't be accepted.
  const toRepair = candidates.filter((t) => statusByUser.get(t) === "accepted");
  // Everyone else (no row, or a prior pending/declined row) gets a fresh pending
  // invite via upsert, so a previously-declined person can be re-invited.
  const toInvite = candidates.filter((t) => statusByUser.get(t) !== "accepted");

  if (toRepair.length > 0) {
    await db
      .update(eventsTable)
      .set({
        invitedUserIds: sql`(
          SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
          FROM jsonb_array_elements(
            COALESCE(${eventsTable.invitedUserIds}, '[]'::jsonb) || ${JSON.stringify(toRepair)}::jsonb
          ) AS elem
        )`,
        version: sql`${eventsTable.version} + 1`,
      })
      .where(eq(eventsTable.id, id));
    emitEventUpdate(id);
  }

  // Create/refresh pending event_invite rows — invitees see these in their
  // Activity tab and can Accept or Decline. They gain access on acceptance.
  let inserted: (typeof eventInvitesTable.$inferSelect)[] = [];
  if (toInvite.length > 0) {
    const inviteRows = toInvite.map((invitedUserId) => ({
      eventId: id,
      inviterUserId: userId,
      invitedUserId,
      eventTitle: existing.title,
      eventEmoji: existing.emoji ?? "🗓️",
    }));
    inserted = await db
      .insert(eventInvitesTable)
      .values(inviteRows)
      .onConflictDoUpdate({
        target: [eventInvitesTable.eventId, eventInvitesTable.invitedUserId],
        set: {
          status: "pending",
          inviterUserId: userId,
          eventTitle: existing.title,
          eventEmoji: existing.emoji ?? "🗓️",
          createdAt: sql`now()`,
        },
        // Never downgrade an already-accepted invite back to pending. Guards the
        // TOCTOU window where a target accepts between the select above and this
        // upsert — that row is left untouched (and excluded from `inserted`).
        setWhere: sql`${eventInvitesTable.status} <> 'accepted'`,
      })
      .returning();
  }

  res.json({ ok: true, inviteCount: inserted.length + toRepair.length });

  for (const inv of inserted) {
    recordActivitySafe({
      recipientId: inv.invitedUserId,
      actorId: userId,
      type: "event_invite",
      subjectType: "event",
      subjectId: inv.id,
      meta: {
        subjectName: existing.title,
        subjectEmoji: existing.emoji ?? "🗓️",
        eventId: id,
        // The Activity accept action needs this to choose the correct detail
        // route. Trips share the events table but intentionally have their own
        // mobile screen.
        planType: existing.type,
      },
    });
  }

  // Push notify invitees — same helper as creation-time invites (#14/#15) so
  // title, preference gate (requireNotifyEventInvites), and mute logic match.
  if (inserted.length > 0) {
    // These are PENDING invites — the invitee has no plan access until they
    // accept, so route the tap to Activity (Accept lives there), not the plan.
    void notifyInvitees(existing, userId, inserted.map((i) => i.invitedUserId), true);
  }
});

// DELETE /events/:id/invite/:userId — remove a personal invite. Allowed for the
// host (uninvite anyone) or the invitee themselves (leave). This only revokes
// the explicit invite grant; squad members keep their squad-based access.
router.delete("/events/:id/invite/:userId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const targetId = parseId(req.params.userId);
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (existing.hostId !== userId && targetId !== userId) {
    res.status(403).json({ error: "Only the host can remove other people's invites" });
    return;
  }
  // Atomic remove of the single id from the jsonb array; bump version.
  const [event] = await db.update(eventsTable)
    .set({
      invitedUserIds: sql`(
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(${eventsTable.invitedUserIds}, '[]'::jsonb)) AS elem
        WHERE elem <> ${JSON.stringify(targetId)}::jsonb
      )`,
      version: sql`${eventsTable.version} + 1`,
    })
    .where(eq(eventsTable.id, id))
    .returning();
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  // Delete the invite row so the person can be re-invited later without hitting
  // the onConflictDoNothing guard in the POST /invite route.
  await db.delete(eventInvitesTable)
    .where(and(eq(eventInvitesTable.eventId, id), eq(eventInvitesTable.invitedUserId, targetId)));
  res.json(event);
  emitEventUpdate(id);
});

router.post("/events/:id/tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = AddTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  const { version: clientVersion, title, category } = parsed.data;
  const tasks = [
    ...(existing.tasks as unknown[]),
    { id: `t${Date.now()}`, title, category: category ?? null, assigneeId: null, done: false },
  ];
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ tasks, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

router.patch("/events/:id/tasks/:taskId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const taskId = parseId(req.params.taskId);
  const userId = (req.user as { id: string }).id;
  const parsed = PatchTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  const { version: clientVersion, ...taskFields } = parsed.data;
  const currentTasks = existing.tasks as Array<{ id: string; done: boolean; assigneeId: string | null; title: string }>;
  // A taskId that isn't on this event used to fall through the map untouched:
  // the row was still rewritten and the version bumped, so the client got a 200
  // plus a bumped version for a task that was never edited (typically one a
  // collaborator had just deleted). Fail explicitly instead of silently no-op'ing.
  if (!currentTasks.some((t) => t.id === taskId)) {
    res.status(404).json({ error: "That to-do no longer exists — refresh to see the latest." });
    return;
  }
  const tasks = currentTasks.map(
    (t) => (t.id === taskId ? { ...t, ...taskFields } : t),
  );
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ tasks, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

router.post("/events/:id/costs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = AddCostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { amount, shares } = parsed.data;
  if (!isValidCostAmounts(amount, shares, parsed.data.billDetails)) {
    res.status(400).json({ error: "Invalid cost: amount must be positive and shares must sum to total" });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  // Every referenced user (payer + each share) must be a legitimate participant
  // of this event, and each user may appear at most once. This blocks spoofing
  // arbitrary debts, mis-firing "you owe" pushes, and leaking payment handles.
  const allowed = await allowedParticipantIds(existing);
  if (!allowed.has(parsed.data.paidById)) {
    res.status(400).json({ error: "The payer must be a member of this event" });
    return;
  }
  const seenShareUsers = new Set<string>();
  for (const s of shares as Array<{ userId: string }>) {
    if (!allowed.has(s.userId)) {
      res.status(400).json({ error: "A share references someone who isn't a member of this event" });
      return;
    }
    if (seenShareUsers.has(s.userId)) {
      res.status(400).json({ error: "Each person can appear at most once in a cost split" });
      return;
    }
    seenShareUsers.add(s.userId);
  }
  // Verify the caller owns the receipt upload so they can't reference someone
  // else's private object and use the cost ACL to view it.
  if (parsed.data.receiptUrl) {
    const owner = await storage.getUploadOwner(parsed.data.receiptUrl);
    if (owner !== userId) {
      res.status(403).json({ error: "You can only attach a receipt photo that you uploaded" });
      return;
    }
  }
  const { version: clientVersion, ...costFields } = parsed.data;
  const newCost = { id: `c${Date.now()}`, ...costFields };
  const costs = [...(existing.costs as unknown[]), newCost];
  const [event] = await db.update(eventsTable)
    .set({ costs, version: sql`${eventsTable.version} + 1` })
    .where(and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion)))
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);

  // Fire-and-forget: tell each person who now owes a share that they owe the payer.
  void (async () => {
    try {
      const payerId = newCost.paidById;
      const debtors = newCost.shares.filter(
        (s: { userId: string; amount: number }) => s.userId !== payerId && s.amount > 0,
      );
      if (debtors.length === 0) return;
      const payer = await storage.getUser(payerId);
      const payerName = displayName(payer);
      for (const debtor of debtors) {
        const tokens = await storage.getPushTokensForUsers([debtor.userId], { requireNotifyPayments: true });
        if (tokens.length === 0) continue;
        await sendPushNotifications(
          tokens,
          {
            title: "💸 New expense to settle",
            body: `You owe ${payerName} $${debtor.amount.toFixed(2)} for ${newCost.description}`,
            data: { screen: existing.type === "trip" ? "trip" : "event", eventId: id, tab: "costs" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      }
    } catch (err) {
      logger.error({ err }, "Error sending expense-share push notifications");
    }
  })();
});

type StoredShare = { userId: string; amount: number; paidAt?: string | null; confirmedAt?: string | null };
type StoredBillDetails = { baseAmount?: number; taxAmount?: number; tipAmount?: number; tipPercent?: number; feeAmount?: number };
type StoredCost = { id: string; description: string; amount: number; paidById: string; shares: StoredShare[]; billDetails?: StoredBillDetails; receiptUrl?: string | null };

const MarkPaidBody = z.object({ paid: z.boolean(), version: z.number().int().optional() });
const ConfirmShareBody = z.object({ confirmed: z.boolean(), version: z.number().int().optional() });

// A debtor marks (or un-marks) their OWN share of a cost as paid. Records who/when.
// Cannot change a share the creditor has already confirmed.
router.post("/events/:id/costs/:costId/mark-paid", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const costId = parseId(req.params.costId);
  const userId = (req.user as { id: string }).id;
  const parsed = MarkPaidBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const costs = existing.costs as StoredCost[];
  const cost = costs.find((c) => c.id === costId);
  if (!cost) {
    res.status(404).json({ error: "Cost not found" });
    return;
  }
  if (cost.paidById === userId) {
    res.status(400).json({ error: "The payer has nothing to mark as paid" });
    return;
  }
  const share = cost.shares.find((s) => s.userId === userId);
  if (!share || share.amount <= 0) {
    res.status(400).json({ error: "You have no share to settle on this expense" });
    return;
  }
  if (share.confirmedAt) {
    res.status(409).json({ error: "This payment was already confirmed by the payer" });
    return;
  }
  const wasUnpaid = !share.paidAt;
  share.paidAt = parsed.data.paid ? new Date().toISOString() : null;
  const nextCosts = costs.map((c) =>
    c.id !== costId ? c : { ...c, shares: cost.shares.map((s) => (s.userId === userId ? share : s)) },
  );
  const clientVersion = parsed.data.version;
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ costs: nextCosts, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);

  // Fire-and-forget: notify the creditor when a debtor newly marks a share paid.
  if (parsed.data.paid && wasUnpaid) {
    void (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers([cost.paidById], { requireNotifyPayments: true });
        if (tokens.length === 0) return;
        const debtor = await storage.getUser(userId);
        await sendPushNotifications(
          tokens,
          {
            title: "✅ Payment marked as sent",
            body: `${displayName(debtor)} marked $${share.amount.toFixed(2)} as paid for ${cost.description}`,
            data: { screen: existing.type === "trip" ? "trip" : "event", eventId: id, tab: "costs" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending payment-marked push notification");
      }
    })();
  }
});

// The creditor (cost payer) confirms a debtor's payment, or un-marks it (resets
// the share to unpaid) when the money never arrived.
router.post("/events/:id/costs/:costId/shares/:shareUserId/confirm", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const costId = parseId(req.params.costId);
  const shareUserId = parseId(req.params.shareUserId);
  const userId = (req.user as { id: string }).id;
  const parsed = ConfirmShareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const costs = existing.costs as StoredCost[];
  const cost = costs.find((c) => c.id === costId);
  if (!cost) {
    res.status(404).json({ error: "Cost not found" });
    return;
  }
  if (cost.paidById !== userId) {
    res.status(403).json({ error: "Only the payer can confirm or un-mark a payment" });
    return;
  }
  const share = cost.shares.find((s) => s.userId === shareUserId);
  if (!share) {
    res.status(404).json({ error: "Share not found" });
    return;
  }
  if (parsed.data.confirmed) {
    if (!share.paidAt) {
      res.status(409).json({ error: "This share has not been marked as paid yet" });
      return;
    }
    share.confirmedAt = new Date().toISOString();
  } else {
    // Un-mark: reset to fully unpaid so the debtor must pay again.
    share.paidAt = null;
    share.confirmedAt = null;
  }
  const nextCosts = costs.map((c) =>
    c.id !== costId ? c : { ...c, shares: cost.shares.map((s) => (s.userId === shareUserId ? share : s)) },
  );
  const clientVersion = parsed.data.version;
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ costs: nextCosts, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

// Member-authorized lookup of payment handles for everyone referenced in an
// event, so the settle-up UI can deep-link into Venmo/Cash App/Zelle.
router.get("/events/:id/payment-handles", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  // Only expose handles for legitimate event participants — never arbitrary IDs
  // that may have been injected into costs.
  const allowed = await allowedParticipantIds(existing);
  const users = await storage.getUsers([...allowed]);
  const handles: Record<string, { venmo: string | null; cashapp: string | null; zelle: string | null }> = {};
  for (const u of users) {
    handles[u.id] = {
      venmo: u.venmoHandle ?? null,
      cashapp: u.cashappHandle ?? null,
      zelle: u.zelleHandle ?? null,
    };
  }
  res.json({ handles });
});

router.post("/events/:id/polls", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = AddPollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  const { version: clientVersion, question, options } = parsed.data;
  const pollId = `p${Date.now()}`;
  const polls = [
    ...(existing.polls as unknown[]),
    {
      id: pollId,
      question,
      options: options.map((label: string, i: number) => ({ id: `po${Date.now()}${i}`, label, voterIds: [] })),
    },
  ];
  const [event] = await db.update(eventsTable)
    .set({ polls, version: sql`${eventsTable.version} + 1` })
    .where(and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion)))
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

router.post("/events/:id/polls/:pollId/vote", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const pollId = parseId(req.params.pollId);
  const userId = (req.user as { id: string }).id;
  const parsed = VotePollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  const { optionId, version: clientVersion } = parsed.data;
  const allPolls = existing.polls as Array<{ id: string; closed?: boolean }>;
  const targetPoll = allPolls.find((p) => p.id === pollId);
  if (!targetPoll) {
    res.status(404).json({ error: "Poll not found" });
    return;
  }
  if (targetPoll.closed) {
    res.status(400).json({ error: "This poll is closed — voting has ended." });
    return;
  }
  const polls = (
    existing.polls as Array<{ id: string; question: string; options: Array<{ id: string; label: string; voterIds: string[] }> }>
  ).map((poll) =>
    poll.id !== pollId
      ? poll
      : {
          ...poll,
          options: poll.options.map((o) => ({
            ...o,
            voterIds:
              o.id === optionId
                ? Array.from(new Set([...o.voterIds, userId]))
                : o.voterIds.filter((v) => v !== userId),
          })),
        },
  );
  const [event] = await db.update(eventsTable)
    .set({ polls, version: sql`${eventsTable.version} + 1` })
    .where(and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion)))
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

// PATCH /events/:id/polls/:pollId — host/co-admin closes (or reopens) a poll.
// Closed polls reject votes server-side and render results-only in the client.
const PatchPollBody = z.object({
  closed: z.boolean(),
  version: z.number().int().optional(),
});
router.patch("/events/:id/polls/:pollId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const pollId = parseId(req.params.pollId);
  const userId = (req.user as { id: string }).id;
  const parsed = PatchPollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (!canManageEvent(existing, userId)) {
    res.status(403).json({ error: "Only the host or a co-admin can close a poll." });
    return;
  }
  const currentPolls = existing.polls as Array<{ id: string; closed?: boolean }>;
  if (!currentPolls.some((p) => p.id === pollId)) {
    res.status(404).json({ error: "Poll not found" });
    return;
  }
  const polls = currentPolls.map((p) => (p.id === pollId ? { ...p, closed: parsed.data.closed } : p));
  const clientVersion = parsed.data.version;
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ polls, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

// ── Cost edit & delete (settle-up integrity) ─────────────────────────────────

// Shared authz for editing/removing a cost: the person who paid it or the
// event host.
function canEditCost(event: typeof eventsTable.$inferSelect, cost: StoredCost, userId: string): boolean {
  return cost.paidById === userId || event.hostId === userId;
}

// paidById is immutable on edit, so it is intentionally not accepted here.
const { paidById: _paidByIdField, ...EditableCostFields } = CostFieldsBody;
const EditCostBody = z.object({
  ...EditableCostFields,
  version: z.number().int().optional(),
});

// PATCH /events/:id/costs/:costId — edit description/amount/shares (full share
// replacement). Blocked once any share has a payment in progress. paidById is
// immutable; the cost id is preserved.
router.patch("/events/:id/costs/:costId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const costId = parseId(req.params.costId);
  const userId = (req.user as { id: string }).id;
  const parsed = EditCostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { amount, shares } = parsed.data;
  if (!isValidCostAmounts(amount, shares, parsed.data.billDetails)) {
    res.status(400).json({ error: "Invalid cost: amount must be positive and shares must sum to total" });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  const costs = existing.costs as StoredCost[];
  const cost = costs.find((c) => c.id === costId);
  if (!cost) {
    res.status(404).json({ error: "Cost not found" });
    return;
  }
  if (!canEditCost(existing, cost, userId)) {
    res.status(403).json({ error: "Only the person who paid or the host can edit this cost" });
    return;
  }
  if (cost.shares.some((s) => s.paidAt)) {
    res.status(409).json({
      error: "This cost has payments in progress. Ask people to unmark payments first, or delete and recreate it.",
      paymentsInProgress: true,
    });
    return;
  }
  // Same participant validation as cost creation.
  const allowed = await allowedParticipantIds(existing);
  const seenShareUsers = new Set<string>();
  for (const s of shares) {
    if (!allowed.has(s.userId)) {
      res.status(400).json({ error: "A share references someone who isn't a member of this event" });
      return;
    }
    if (seenShareUsers.has(s.userId)) {
      res.status(400).json({ error: "Each person can appear at most once in a cost split" });
      return;
    }
    seenShareUsers.add(s.userId);
  }
  // Verify receipt ownership when a new receiptUrl is being set.
  if (parsed.data.receiptUrl) {
    const owner = await storage.getUploadOwner(parsed.data.receiptUrl);
    if (owner !== userId) {
      res.status(403).json({ error: "You can only attach a receipt photo that you uploaded" });
      return;
    }
  }
  // Determine the receipt URL to store:
  //  - explicit string  → new/existing receipt
  //  - explicit null    → clear the receipt
  //  - undefined        → keep whatever was stored before
  const receiptUrl =
    parsed.data.receiptUrl !== undefined ? parsed.data.receiptUrl : cost.receiptUrl;
  const updatedCost: StoredCost = {
    id: cost.id,
    description: parsed.data.description,
    amount,
    paidById: cost.paidById, // immutable
    shares: shares.map((s) => ({ userId: s.userId, amount: s.amount })),
    ...(parsed.data.billDetails ? { billDetails: parsed.data.billDetails } : {}),
    ...(receiptUrl != null ? { receiptUrl } : {}),
  };
  const nextCosts = costs.map((c) => (c.id === costId ? updatedCost : c));
  const clientVersion = parsed.data.version;
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ costs: nextCosts, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);

  // Fire-and-forget: tell each non-zero debtor in the NEW shares (except the
  // editor) that the cost changed. Respects the payments preference.
  void (async () => {
    try {
      const debtors = updatedCost.shares.filter(
        (s) => s.userId !== updatedCost.paidById && s.userId !== userId && s.amount > 0,
      );
      if (debtors.length === 0) return;
      const editor = await storage.getUser(userId);
      const editorName = displayName(editor);
      for (const debtor of debtors) {
        const tokens = await storage.getPushTokensForUsers([debtor.userId], { requireNotifyPayments: true });
        if (tokens.length === 0) continue;
        await sendPushNotifications(
          tokens,
          {
            title: `${editorName} updated a cost`,
            body: `Your share of '${updatedCost.description}' is now $${debtor.amount.toFixed(2)} for ${existing.title}`,
            data: { screen: existing.type === "trip" ? "trip" : "event", eventId: id, tab: "costs" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      }
    } catch (err) {
      logger.error({ err }, "Error sending cost-updated push notifications");
    }
  })();
});

// DELETE /events/:id/costs/:costId — remove a cost from the split entirely.
// Allowed at any time regardless of paid/confirmed state.
router.delete("/events/:id/costs/:costId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const costId = parseId(req.params.costId);
  const userId = (req.user as { id: string }).id;
  const clientVersion = typeof req.body?.version === "number" ? req.body.version : undefined;
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  const costs = existing.costs as StoredCost[];
  const cost = costs.find((c) => c.id === costId);
  if (!cost) {
    res.status(404).json({ error: "Cost not found" });
    return;
  }
  if (!canEditCost(existing, cost, userId)) {
    res.status(403).json({ error: "Only the person who paid or the host can delete this cost" });
    return;
  }
  const nextCosts = costs.filter((c) => c.id !== costId);
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ costs: nextCosts, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);

  // Fire-and-forget: tell all non-zero debtors (except the deleter) the cost
  // was removed. Respects the payments preference.
  void (async () => {
    try {
      const debtors = cost.shares.filter(
        (s) => s.userId !== cost.paidById && s.userId !== userId && s.amount > 0,
      );
      if (debtors.length === 0) return;
      const payer = await storage.getUser(cost.paidById);
      const payerName = displayName(payer);
      for (const debtor of debtors) {
        const tokens = await storage.getPushTokensForUsers([debtor.userId], { requireNotifyPayments: true });
        if (tokens.length === 0) continue;
        await sendPushNotifications(
          tokens,
          {
            title: `${payerName} removed a cost`,
            body: `'${cost.description}' ($${cost.amount.toFixed(2)}) was deleted from ${existing.title}`,
            data: { screen: existing.type === "trip" ? "trip" : "event", eventId: id, tab: "costs" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      }
    } catch (err) {
      logger.error({ err }, "Error sending cost-deleted push notifications");
    }
  })();
});

// Plan chat used to live in the `events.messages` JSON column and every send
// bumped the shared event version (so two people typing at once collided with a
// 409, and the whole history had to be shipped with the event). It now lives in
// a paginated conversation thread — see GET /conversations/event/:eventId and
// POST /conversations/:id/messages. There is deliberately no
// POST /events/:id/messages any more: chat must never touch the event version.

// GET /events/:id/stream — SSE endpoint for real-time event updates.
// Members connect while the event detail screen is focused. Any mutation
// (RSVP, patch, join, tasks, costs, polls) calls emitEventUpdate(id)
// which pushes an "update" event to all connected watchers immediately.
// Chat is NOT one of them: plan messages stream over the conversation SSE.
router.get("/events/:id/stream", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;

  // Verify access before opening the stream.
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!(await userCanAccessEvent(event, userId))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // SSE response headers.
  // no-transform stops the compression middleware from buffering the stream.
  // X-Accel-Buffering: no disables nginx / Replit proxy buffering.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Confirm connection to the client.
  res.write("event: connected\ndata: {}\n\n");

  let closed = false;
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const closeStream = (): void => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  // Authorization at connection time is not enough: membership and invite
  // access can change while this socket remains open. Re-check before each
  // payload and on idle heartbeats, failing closed if the DB cannot confirm it.
  const stillAllowed = async (): Promise<boolean> => {
    try {
      const [current] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
      return !!current && (await userCanAccessEvent(current, userId));
    } catch (err) {
      logger.error({ err, eventId: id }, "Error revalidating event stream access");
      return false;
    }
  };

  const revokeStream = (): void => {
    if (closed) return;
    // A terminal frame tells mobile clients this is an access change, not a
    // temporary network failure that should trigger endless reconnects.
    res.write('event: authorization_revoked\ndata: {"code":"AUTHORIZATION_REVOKED"}\n\n');
    closeStream();
  };

  unsubscribe = onEventUpdate(id, () => {
    void (async () => {
      if (closed) return;
      if (!(await stillAllowed())) {
        revokeStream();
        return;
      }
      if (!closed) res.write(`event: update\ndata: {"eventId":"${id}"}\n\n`);
    })();
  });

  // Keep-alive heartbeat every 25 s to prevent proxy/mobile connection timeouts.
  // It also makes idle streams respect access removal promptly.
  heartbeat = setInterval(() => {
    void (async () => {
      if (closed) return;
      if (!(await stillAllowed())) {
        revokeStream();
        return;
      }
      if (!closed) res.write(": heartbeat\n\n");
    })();
  }, 25000);

  req.on("close", closeStream);
});

router.get('/events/:id/photos', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const eventId = parseId(req.params['id']);

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, (req.user as { id: string; email?: string }).email ?? '');
    }

    const isPro = await (async () => {
      if (user!.stripeSubscriptionId) {
        const sub = await storage.getSubscription(user!.stripeSubscriptionId);
        return sub?.status === 'active' || sub?.status === 'trialing';
      }
      if (user!.stripeCustomerId) {
        const sub = await storage.getActiveSubscriptionByCustomerId(user!.stripeCustomerId);
        return !!sub;
      }
      return false;
    })();

    const event = await storage.getEvent(eventId);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    if (!(await userCanAccessEvent(event, userId))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Event vault photos are open to anyone with event access (no time lock).
    const photos = await storage.getPhotosByEventId(eventId);
    res.json({ photos, isPro });
  } catch (err) {
    logger.error({ err }, 'Error fetching event photos');
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// ── Itinerary stops (trips) ──────────────────────────────────────────────────
// Every member of the trip's squad can manage the itinerary (authz via
// getEventAsMember, which grants live squad members access without an RSVP).
// Each write is version-checked against the shared events row so concurrent
// edits to the JSON column can't clobber each other (409 → client refetches).
//
// Itinerary + packing live only on trip events, so every handler also rejects
// non-trip events (after the membership check) to keep that behavior scoped to
// the trip resource type on the shared events object.
function ensureTripEvent(existing: { type?: string | null }, res: Response): boolean {
  if (existing.type !== "trip") {
    res.status(400).json({ error: "Itinerary and packing are only available on trips" });
    return false;
  }
  return true;
}

// A stop's money fields (paidById/assigneeId) attribute a payment/owed amount to
// a user, so — like event costs — they may only reference a legitimate trip
// participant. Otherwise a member could spoof a debt onto someone who isn't on
// the trip. null/unset clears the field and is always allowed.
async function ensureStopParticipants(
  existing: typeof eventsTable.$inferSelect,
  fields: { paidById?: string | null; assigneeId?: string | null },
  res: Response,
): Promise<boolean> {
  const refs = [fields.paidById, fields.assigneeId].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (refs.length === 0) return true;
  const allowed = await allowedParticipantIds(existing);
  for (const ref of refs) {
    if (!allowed.has(ref)) {
      res.status(400).json({ error: "Cost fields must reference a member of this trip" });
      return false;
    }
  }
  return true;
}

router.post("/events/:id/itinerary", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = AddStopBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (!ensureTripEvent(existing, res)) return;
  if (!(await ensureStopParticipants(existing, parsed.data, res))) return;
  const { version: clientVersion, day, ...rest } = parsed.data;
  const current = (existing.itinerary ?? []) as ItineraryStop[];
  // Order new stops after the last stop already on that day.
  const sortOrder = current
    .filter((s) => s.day === day)
    .reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
  const stop: ItineraryStop = {
    id: `s${Date.now()}`,
    day,
    time: rest.time,
    endTime: rest.endTime,
    title: rest.title,
    placeName: rest.placeName,
    address: rest.address,
    note: rest.note,
    category: rest.category,
    status: rest.status,
    cost: rest.cost ?? null,
    paidById: rest.paidById ?? null,
    assigneeId: rest.assigneeId ?? null,
    createdBy: userId,
    votes: [],
    sortOrder,
  };
  const itinerary = [...current, stop];
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ itinerary, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

router.patch("/events/:id/itinerary/:stopId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const stopId = parseId(req.params.stopId);
  const userId = (req.user as { id: string }).id;
  const parsed = PatchStopBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (!ensureTripEvent(existing, res)) return;
  if (!(await ensureStopParticipants(existing, parsed.data, res))) return;
  const { version: clientVersion, cost, ...stopFields } = parsed.data;
  const current = (existing.itinerary ?? []) as ItineraryStop[];
  if (!current.some((s) => s.id === stopId)) {
    res.status(404).json({ error: "Stop not found" });
    return;
  }
  const itinerary = current.map((s) =>
    s.id === stopId ? { ...s, ...stopFields, ...(cost !== undefined ? { cost } : {}) } : s,
  );
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ itinerary, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

router.delete("/events/:id/itinerary/:stopId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const stopId = parseId(req.params.stopId);
  const userId = (req.user as { id: string }).id;
  const clientVersion = typeof req.body?.version === "number" ? req.body.version : undefined;
  if (clientVersion === undefined) {
    res.status(400).json({ error: "version is required" });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (!ensureTripEvent(existing, res)) return;
  const current = (existing.itinerary ?? []) as ItineraryStop[];
  const target = current.find((s) => s.id === stopId);
  if (!target) {
    res.status(404).json({ error: "Stop not found" });
    return;
  }
  // Only the trip host or the stop's author can remove it.
  if (existing.hostId !== userId && target.createdBy !== userId) {
    res.status(403).json({ error: "Only the host or the person who added this stop can remove it" });
    return;
  }
  const itinerary = current.filter((s) => s.id !== stopId);
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ itinerary, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

router.post("/events/:id/itinerary/:stopId/vote", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const stopId = parseId(req.params.stopId);
  const userId = (req.user as { id: string }).id;
  const parsed = VoteStopBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (!ensureTripEvent(existing, res)) return;
  const { version: clientVersion } = parsed.data;
  const current = (existing.itinerary ?? []) as ItineraryStop[];
  if (!current.some((s) => s.id === stopId)) {
    res.status(404).json({ error: "Stop not found" });
    return;
  }
  // Toggle this user's upvote on the proposed stop.
  const itinerary = current.map((s) => {
    if (s.id !== stopId) return s;
    const votes = s.votes.includes(userId)
      ? s.votes.filter((v) => v !== userId)
      : [...s.votes, userId];
    return { ...s, votes };
  });
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ itinerary, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

router.post("/events/:id/itinerary/:stopId/confirm", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const stopId = parseId(req.params.stopId);
  const userId = (req.user as { id: string }).id;
  const parsed = ConfirmStopBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (!ensureTripEvent(existing, res)) return;
  const { version: clientVersion } = parsed.data;
  const current = (existing.itinerary ?? []) as ItineraryStop[];
  if (!current.some((s) => s.id === stopId)) {
    res.status(404).json({ error: "Stop not found" });
    return;
  }
  const itinerary = current.map((s) =>
    s.id === stopId ? { ...s, status: "confirmed" as const } : s,
  );
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ itinerary, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

// ── Packing checklist (trips) ────────────────────────────────────────────────

router.post("/events/:id/packing", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = AddPackingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (!ensureTripEvent(existing, res)) return;
  const { version: clientVersion, label } = parsed.data;
  const current = (existing.packing ?? []) as PackingItem[];
  const item: PackingItem = {
    id: `p${Date.now()}`,
    label,
    done: false,
    assigneeId: null,
    createdBy: userId,
  };
  const packing = [...current, item];
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ packing, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

router.patch("/events/:id/packing/:itemId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  const userId = (req.user as { id: string }).id;
  const parsed = PatchPackingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (!ensureTripEvent(existing, res)) return;
  const { version: clientVersion, ...itemFields } = parsed.data;
  const current = (existing.packing ?? []) as PackingItem[];
  if (!current.some((p) => p.id === itemId)) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const packing = current.map((p) => (p.id === itemId ? { ...p, ...itemFields } : p));
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ packing, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

router.delete("/events/:id/packing/:itemId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  const userId = (req.user as { id: string }).id;
  const clientVersion = typeof req.body?.version === "number" ? req.body.version : undefined;
  if (clientVersion === undefined) {
    res.status(400).json({ error: "version is required" });
    return;
  }
  const existing = await getEventAsMemberForWrite(id, userId, res);
  if (!existing) return;
  if (!ensureTripEvent(existing, res)) return;
  const current = (existing.packing ?? []) as PackingItem[];
  const target = current.find((p) => p.id === itemId);
  if (!target) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (existing.hostId !== userId && target.createdBy !== userId) {
    res.status(403).json({ error: "Only the host or the person who added this item can remove it" });
    return;
  }
  const packing = current.filter((p) => p.id !== itemId);
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ packing, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

// ── Manual organizer reminder ─────────────────────────────────────────────────
const ManualReminderBody = z.object({
  type: z.enum(["general", "rsvp"]),
});

const MANUAL_REMINDER_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per type

// POST /events/:id/remind — host or co-admin sends a manual push reminder.
// "general" reaches going + maybe RSVPs; "rsvp" reaches those who haven't
// responded yet (squad members ∪ invitedUserIds minus rsvp'd). Each type has an
// independent 1-hour cooldown. Returns {retryAfterMs} on 429.
router.post("/events/:id/remind", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const id = parseId(req.params.id);

  try {
    const event = await getEventAsMemberForWrite(id, userId, res);
    if (!event) return;

    if (!canManageEvent(event, userId)) {
      res.status(403).json({ error: "Only the host or a co-admin can send manual reminders." });
      return;
    }

    const parsed = ManualReminderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { type } = parsed.data;

    // Check independent per-type cooldown.
    const now = Date.now();
    const lastSent =
      type === "general" ? event.manualReminderGeneralSentAt : event.manualReminderRsvpSentAt;
    if (lastSent != null) {
      const elapsed = now - new Date(lastSent as Date).getTime();
      if (elapsed < MANUAL_REMINDER_COOLDOWN_MS) {
        const retryAfterMs = MANUAL_REMINDER_COOLDOWN_MS - elapsed;
        res.status(429).json({ error: "Reminder sent recently — please wait before sending another.", retryAfterMs });
        return;
      }
    }

    // Require a parseable start so the body copy can include a date label.
    const nowDate = new Date();
    const start = event.eventAt
      ? (() => { const t = event.eventAt instanceof Date ? event.eventAt : new Date(event.eventAt as string); return Number.isNaN(t.getTime()) ? null : t; })()
      : parseEventStart(event.date, nowDate);
    if (!start) {
      res.status(400).json({ error: "Event doesn't have a clear date yet — can't send a timed reminder." });
      return;
    }

    const eventTz = (event as { timezone?: string | null }).timezone ?? null;

    const rsvps = (event.rsvps ?? {}) as Record<string, string>;
    let audienceIds: string[];

    if (type === "general") {
      // going + maybe RSVPs, excluding the sender.
      audienceIds = Object.entries(rsvps)
        .filter(([uid, status]) => uid !== userId && (status === "going" || status === "maybe"))
        .map(([uid]) => uid);
    } else {
      // BUG-10: "Remind to RSVP" is only meaningful for guests — exclude the
      // host AND all co-admins unconditionally, regardless of whether they have
      // an RSVP row.  Organizers are not expected to RSVP to their own event.
      const organizerIds = new Set<string>([event.hostId, ...((event.coAdminIds ?? []) as string[])]);
      const respondedIds = new Set(Object.keys(rsvps));
      const potentialIds = new Set<string>();
      if (event.squadId) {
        const squad = await storage.getSquad(event.squadId);
        if (squad) for (const mid of squad.memberIds) potentialIds.add(mid);
      }
      for (const uid of ((event.invitedUserIds ?? []) as string[])) potentialIds.add(uid);
      // Exclude sender, organizers, and anyone who already responded.
      audienceIds = [...potentialIds].filter(
        (uid) => uid !== userId && !organizerIds.has(uid) && !respondedIds.has(uid),
      );
    }

    // BUG-06: when the audience is empty (everyone has already responded, or
    // the event has no guests yet), return immediately WITHOUT stamping the
    // cooldown — the host should not lose their next reminder slot for a no-op.
    if (audienceIds.length === 0) {
      res.json({ ok: true, sent: 0, allResponded: true });
      return;
    }

    // Respect per-squad mute preferences.
    const filteredIds = event.squadId
      ? await storage.filterUnmutedForSquad(audienceIds, event.squadId)
      : audienceIds;

    // BUG-03: atomic check-and-set so two concurrent co-admin "Remind Everyone"
    // taps can't both pass the cooldown gate.  The UPDATE WHERE clause makes the
    // check and the stamp a single atomic DB operation — only the first caller
    // wins; the second gets { won: false }.
    const stampResult = await storage.markManualReminderSentAtomic(event.id, type, MANUAL_REMINDER_COOLDOWN_MS);
    if (!stampResult.won) {
      res.status(429).json({
        error: "Reminder sent recently — please wait before sending another.",
        retryAfterMs: stampResult.retryAfterMs ?? MANUAL_REMINDER_COOLDOWN_MS,
      });
      return;
    }

    res.json({ ok: true });

    void (async () => {
      try {
        const recipients = await storage.getPushRecipientsForUsers(filteredIds, { requireNotifyReminders: true });
        if (recipients.length === 0) return;

        // Each recipient reads the time on their own clock. Recipients with no
        // saved timezone inherit the event's stored (creator's) zone; with
        // neither we fall back to the event's own date text, which is always
        // accurate. See relativeDayLabel for why UTC is not a safe default.
        let okCount = 0;
        for (const group of groupRecipientsByZone(recipients, eventTz)) {
          const relativeTime =
            relativeDayLabel(nowDate, start, group.timezone)
            ?? formatEventTimeIn(start, group.timezone)
            ?? event.date;
          const whenPhrase =
            relativeTime === "today" || relativeTime === "tomorrow"
              ? relativeTime
              : `on ${relativeTime}`;
          const body =
            type === "general"
              ? `${event.emoji} ${event.title} is ${whenPhrase} — don't forget!`
              : `${event.emoji} ${event.title} is ${whenPhrase} — RSVP so the squad knows you're in.`;
          const result = await sendPushNotifications(
            group.tokens,
            {
              title: `${event.emoji} ${event.title}`,
              body,
              data: { screen: event.type === "trip" ? "trip" : "event", eventId: event.id },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
          okCount += result.okCount;
        }
        logger.info({ eventId: event.id, type, okCount }, "Manual event reminder sent");
      } catch (err) {
        logger.error({ err, eventId: event.id, type }, "Manual reminder push failed");
      }
    })();
  } catch (err) {
    req.log.error({ err }, "Error in POST /events/:id/remind");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
