import {
  usersTable,
  eventsTable,
  photosTable,
  squadsTable,
  availabilityPollsTable,
  availabilityResponsesTable,
  waitlistTable,
  conversationsTable,
  conversationParticipantsTable,
  conversationMessagesTable,
  type Photo,
  type AvailabilityPoll,
  type AvailabilityResponse,
  type DbConversation,
  type DbConversationMessage,
  type MessageAttachment,
} from '@workspace/db/schema';
import { eq, sql, count, and, gte, lt, desc, asc, inArray, ne } from 'drizzle-orm';
import { db } from '@workspace/db';

/**
 * Thrown when a photo URL is already recorded under a different uploader.
 * Prevents a user from claiming another user's object path and then
 * self-authorizing access to its bytes via the read ACL.
 */
export class PhotoUrlConflictError extends Error {
  constructor() {
    super('Photo URL already claimed by another user');
    this.name = 'PhotoUrlConflictError';
  }
}

/** Format a Date as a local ISO date string ("YYYY-MM-DD"). */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Default column set for a new availability poll: the next `count` calendar
 * days starting today, as ISO date strings. Squads coordinate on real dates
 * rather than abstract weekdays.
 */
export function defaultPollDates(count = 7, start: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push(toISODate(d));
  }
  return out;
}

/**
 * A vault photo enriched with its linked event's display fields, joined in the
 * query so the API can label photos without the client refetching all events.
 * The event fields are null when the photo isn't tied to an event (or the
 * event was deleted).
 */
export type EnrichedPhoto = Photo & {
  eventTitle: string | null;
  eventEmoji: string | null;
  squadName: string | null;
};

const enrichedPhotoColumns = {
  id: photosTable.id,
  eventId: photosTable.eventId,
  uploaderId: photosTable.uploaderId,
  url: photosTable.url,
  squadId: photosTable.squadId,
  sharedToSquad: photosTable.sharedToSquad,
  uploadedAt: photosTable.uploadedAt,
  eventTitle: eventsTable.title,
  eventEmoji: eventsTable.emoji,
  squadName: eventsTable.squadName,
} as const;

export class Storage {
  async getProduct(productId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE id = ${productId}`
    );
    return result.rows[0] || null;
  }

  async listProductsWithPrices(active = true, limit = 20, offset = 0) {
    const result = await db.execute(
      sql`
        WITH paginated_products AS (
          SELECT id, name, description, metadata, active
          FROM stripe.products
          WHERE active = ${active}
          ORDER BY id
          LIMIT ${limit} OFFSET ${offset}
        )
        SELECT
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.active as product_active,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active as price_active
        FROM paginated_products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        ORDER BY p.id, pr.unit_amount
      `
    );
    return result.rows;
  }

  async getSubscription(subscriptionId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.subscriptions WHERE id = ${subscriptionId}`
    );
    return result.rows[0] || null;
  }

  /**
   * Look up the most recent active/trialing subscription for a Stripe customer ID.
   * This is the source of truth for Pro status — avoids relying on users.stripe_subscription_id.
   */
  async getActiveSubscriptionByCustomerId(stripeCustomerId: string) {
    const result = await db.execute(
      sql`
        SELECT * FROM stripe.subscriptions
        WHERE customer = ${stripeCustomerId}
          AND status IN ('active', 'trialing')
        ORDER BY created DESC
        LIMIT 1
      `
    );
    return result.rows[0] || null;
  }

  async getUser(id: string) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    return user;
  }

  async getUsers(ids: string[]) {
    if (ids.length === 0) return [];
    return db.select().from(usersTable).where(inArray(usersTable.id, ids));
  }

  async getSquad(id: string) {
    const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
    return squad ?? null;
  }

  async getUserByStripeCustomerId(stripeCustomerId: string) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.stripeCustomerId, stripeCustomerId));
    return user;
  }

  async upsertUser(id: string, email: string) {
    const [user] = await db
      .insert(usersTable)
      .values({ id, email })
      .onConflictDoUpdate({ target: usersTable.id, set: { email } })
      .returning();
    return user;
  }

  async updateUserStripeInfo(userId: string, stripeInfo: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  }) {
    const [user] = await db
      .update(usersTable)
      .set(stripeInfo)
      .where(eq(usersTable.id, userId))
      .returning();
    return user;
  }

  async countUserEventsThisYear(hostId: string): Promise<number> {
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const yearEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    const [row] = await db
      .select({ total: count() })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.hostId, hostId),
          gte(eventsTable.createdAt, yearStart),
          lt(eventsTable.createdAt, yearEnd),
        )
      );
    return row?.total ?? 0;
  }

  async createEvent(hostId: string, title: string, date: string, location: string, inviteCode: string) {
    const [event] = await db
      .insert(eventsTable)
      .values({ hostId, title, date, location, inviteCode })
      .returning();
    return event;
  }

  async getEvent(eventId: string) {
    const [event] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId));
    return event ?? null;
  }

  async getPhotosByEventId(eventId: string): Promise<EnrichedPhoto[]> {
    return db
      .select(enrichedPhotoColumns)
      .from(photosTable)
      .leftJoin(eventsTable, eq(photosTable.eventId, eventsTable.id))
      .where(eq(photosTable.eventId, eventId));
  }

  async getPhotosByUploaderId(uploaderId: string): Promise<EnrichedPhoto[]> {
    return db
      .select(enrichedPhotoColumns)
      .from(photosTable)
      .leftJoin(eventsTable, eq(photosTable.eventId, eventsTable.id))
      .where(eq(photosTable.uploaderId, uploaderId))
      .orderBy(desc(photosTable.uploadedAt));
  }

  async addPhoto(uploaderId: string, url: string, eventId?: string): Promise<Photo> {
    // Enforce object-URL provenance: each object path maps to exactly one photo
    // row (DB-unique on url). If the URL is already recorded, only its original
    // uploader may re-save it (idempotent retry); anyone else is rejected so
    // they cannot claim another user's object and self-authorize via the ACL.
    const [existing] = await db
      .select()
      .from(photosTable)
      .where(eq(photosTable.url, url));
    if (existing) {
      if (existing.uploaderId !== uploaderId) {
        throw new PhotoUrlConflictError();
      }
      return existing;
    }
    const [photo] = await db
      .insert(photosTable)
      .values({ uploaderId, url, eventId: eventId ?? null })
      .returning();
    return photo;
  }

  async getSquadVaultPhotos(squadId: string) {
    return db
      .select({
        id: photosTable.id,
        url: photosTable.url,
        eventId: photosTable.eventId,
        uploaderId: photosTable.uploaderId,
        uploadedAt: photosTable.uploadedAt,
        uploaderFirstName: usersTable.firstName,
        uploaderLastName: usersTable.lastName,
        uploaderImageUrl: usersTable.profileImageUrl,
      })
      .from(photosTable)
      .leftJoin(usersTable, eq(photosTable.uploaderId, usersTable.id))
      .where(and(eq(photosTable.squadId, squadId), eq(photosTable.sharedToSquad, true)))
      .orderBy(desc(photosTable.uploadedAt));
  }

  async setPhotosSharedToSquad(photoIds: number[], uploaderId: string, squadId: string) {
    if (photoIds.length === 0) return [];
    return db
      .update(photosTable)
      .set({ sharedToSquad: true, squadId })
      .where(and(inArray(photosTable.id, photoIds), eq(photosTable.uploaderId, uploaderId)))
      .returning();
  }

  async unsharePhotoFromSquad(photoId: number, uploaderId: string, squadId: string) {
    const [photo] = await db
      .update(photosTable)
      .set({ sharedToSquad: false, squadId: null })
      .where(
        and(
          eq(photosTable.id, photoId),
          eq(photosTable.uploaderId, uploaderId),
          eq(photosTable.squadId, squadId),
        ),
      )
      .returning();
    return photo ?? null;
  }

  /**
   * Return photos for all events belonging to a squad, scoped to the requesting user.
   * The user must be listed in the squad's memberIds.
   */
  async getPhotosBySquadId(
    squadId: string,
    userId: string,
  ): Promise<{ photos: EnrichedPhoto[]; authorized: boolean }> {
    const [squad] = await db
      .select()
      .from(squadsTable)
      .where(eq(squadsTable.id, squadId));

    if (!squad) return { photos: [], authorized: false };

    const memberIds = (squad.memberIds ?? []) as string[];
    if (!memberIds.includes(userId)) return { photos: [], authorized: false };

    const events = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(eq(eventsTable.squadId, squadId));

    if (events.length === 0) return { photos: [], authorized: true };

    const eventIds = events.map(e => e.id);
    const photos = await db
      .select(enrichedPhotoColumns)
      .from(photosTable)
      .leftJoin(eventsTable, eq(photosTable.eventId, eventsTable.id))
      .where(inArray(photosTable.eventId, eventIds));

    return { photos, authorized: true };
  }

  /**
   * Return photos for all events hosted by the given user (no squad filter).
   */
  async getPhotosByHostId(userId: string): Promise<Photo[]> {
    const events = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(eq(eventsTable.hostId, userId));

    if (events.length === 0) return [];

    const eventIds = events.map(e => e.id);
    return db
      .select()
      .from(photosTable)
      .where(inArray(photosTable.eventId, eventIds));
  }

  /**
   * Authorization check for serving a photo's underlying object bytes.
   * A user may view a photo if they uploaded it, it is curated into a squad
   * vault they belong to, or it belongs to an event they host or whose squad
   * they are a member of. Returns false for unknown object paths (fail closed).
   */
  async canUserViewPhotoByUrl(objectPath: string, userId: string): Promise<boolean> {
    const [photo] = await db
      .select()
      .from(photosTable)
      .where(eq(photosTable.url, objectPath));
    if (!photo) return false;

    if (photo.uploaderId === userId) return true;

    if (photo.sharedToSquad && photo.squadId) {
      if (await this.isSquadMember(photo.squadId, userId)) return true;
    }

    if (photo.eventId) {
      const [event] = await db
        .select({ squadId: eventsTable.squadId, hostId: eventsTable.hostId })
        .from(eventsTable)
        .where(eq(eventsTable.id, photo.eventId));
      if (event) {
        if (event.hostId === userId) return true;
        if (event.squadId && (await this.isSquadMember(event.squadId, userId))) {
          return true;
        }
      }
    }

    return false;
  }

  private async isSquadMember(squadId: string, userId: string): Promise<boolean> {
    if (!squadId) return false;
    const [squad] = await db
      .select({ memberIds: squadsTable.memberIds })
      .from(squadsTable)
      .where(eq(squadsTable.id, squadId));
    if (!squad) return false;
    return ((squad.memberIds ?? []) as string[]).includes(userId);
  }

  // ---- Availability ("Find the Best Time") ----

  async getAvailabilityPoll(pollId: string): Promise<AvailabilityPoll | null> {
    const [poll] = await db
      .select()
      .from(availabilityPollsTable)
      .where(eq(availabilityPollsTable.id, pollId));
    return poll ?? null;
  }

  async findAvailabilityPoll(opts: {
    squadId?: string;
    eventId?: string;
  }): Promise<AvailabilityPoll | null> {
    if (opts.eventId) {
      const [poll] = await db
        .select()
        .from(availabilityPollsTable)
        .where(eq(availabilityPollsTable.eventId, opts.eventId))
        .orderBy(desc(availabilityPollsTable.createdAt))
        .limit(1);
      return poll ?? null;
    }
    if (opts.squadId) {
      const [poll] = await db
        .select()
        .from(availabilityPollsTable)
        .where(
          and(
            eq(availabilityPollsTable.squadId, opts.squadId),
            sql`${availabilityPollsTable.eventId} IS NULL`,
          ),
        )
        .orderBy(desc(availabilityPollsTable.createdAt))
        .limit(1);
      return poll ?? null;
    }
    return null;
  }

  async createAvailabilityPoll(input: {
    createdBy: string;
    squadId?: string | null;
    eventId?: string | null;
    title?: string;
    days?: string[];
    slots?: string[];
  }): Promise<AvailabilityPoll> {
    const values: Record<string, unknown> = {
      createdBy: input.createdBy,
      squadId: input.squadId ?? null,
      eventId: input.eventId ?? null,
    };
    if (input.title) values.title = input.title;
    // Polls coordinate on concrete calendar dates. When the caller doesn't
    // supply an explicit set, default to a sensible upcoming range.
    values.days = input.days && input.days.length ? input.days : defaultPollDates();
    if (input.slots && input.slots.length) values.slots = input.slots;
    const [poll] = await db
      .insert(availabilityPollsTable)
      .values(values as typeof availabilityPollsTable.$inferInsert)
      .returning();
    return poll;
  }

  async updateAvailabilityPoll(
    pollId: string,
    updates: { title?: string; days?: string[]; slots?: string[] },
    updatedBy?: string,
  ): Promise<AvailabilityPoll> {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (updatedBy) setValues.updatedBy = updatedBy;
    if (updates.title !== undefined) setValues.title = updates.title;
    if (updates.days && updates.days.length) setValues.days = updates.days;
    if (updates.slots && updates.slots.length) setValues.slots = updates.slots;

    const [updated] = await db
      .update(availabilityPollsTable)
      .set(setValues as Partial<typeof availabilityPollsTable.$inferInsert>)
      .where(eq(availabilityPollsTable.id, pollId))
      .returning();

    // Trim all existing responses to only cells that fall within the new grid.
    const newDays = updated.days as string[];
    const newSlots = updated.slots as string[];
    const validCells = new Set<string>();
    for (const day of newDays) {
      for (const slot of newSlots) validCells.add(`${day}-${slot}`);
    }

    const responses = await db
      .select()
      .from(availabilityResponsesTable)
      .where(eq(availabilityResponsesTable.pollId, pollId));

    for (const resp of responses) {
      const trimmed = (resp.cells as string[]).filter((c) => validCells.has(c));
      if (trimmed.length !== (resp.cells as string[]).length) {
        // Only update `cells` — intentionally NOT touching `updatedAt` here.
        // `updatedAt` must reflect when the *user* last submitted, not when the
        // server trimmed out-of-grid cells.  The notification logic uses
        // `updatedAt` to decide who needs a nudge (anyone whose response
        // pre-dates the range change), so mutating it here would incorrectly
        // suppress push notifications for members whose old selections happened
        // to overlap the new grid.
        await db
          .update(availabilityResponsesTable)
          .set({ cells: trimmed })
          .where(
            and(
              eq(availabilityResponsesTable.pollId, pollId),
              eq(availabilityResponsesTable.userId, resp.userId),
            ),
          );
      }
    }

    return updated;
  }

  async getAvailabilityResponses(pollId: string): Promise<AvailabilityResponse[]> {
    return db
      .select()
      .from(availabilityResponsesTable)
      .where(eq(availabilityResponsesTable.pollId, pollId));
  }

  async upsertAvailabilityResponse(
    pollId: string,
    userId: string,
    cells: string[],
    source: 'manual' | 'calendar' = 'manual',
  ): Promise<AvailabilityResponse> {
    const [row] = await db
      .insert(availabilityResponsesTable)
      .values({ pollId, userId, cells, source })
      .onConflictDoUpdate({
        target: [availabilityResponsesTable.pollId, availabilityResponsesTable.userId],
        set: { cells, source, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  // Member-gating for a poll. Squad polls require squad membership. Event polls
  // require the host, an RSVP'd guest, or a member of the event's squad.
  async canAccessAvailabilityPoll(poll: AvailabilityPoll, userId: string): Promise<boolean> {
    if (poll.createdBy === userId) return true;
    if (poll.squadId && (await this.isSquadMember(poll.squadId, userId))) return true;
    if (poll.eventId) {
      const event = await this.getEvent(poll.eventId);
      if (event) {
        if (event.hostId === userId) return true;
        if (event.squadId && (await this.isSquadMember(event.squadId, userId))) return true;
        if (event.rsvps && Object.prototype.hasOwnProperty.call(event.rsvps, userId)) return true;
      }
    }
    return false;
  }

  // Add an email to the marketing waitlist. Idempotent: re-submitting the same
  // email is a no-op rather than an error.
  async addToWaitlist(email: string, source: string): Promise<void> {
    await db
      .insert(waitlistTable)
      .values({ email, source })
      .onConflictDoNothing({ target: waitlistTable.email });
  }

  async getWaitlistCount(): Promise<number> {
    const [row] = await db.select({ value: count() }).from(waitlistTable);
    return row?.value ?? 0;
  }

  // ---- Conversations (standalone messaging) ----

  // Stable, order-independent key for a 1:1 DM so get-or-create is idempotent
  // regardless of which user initiates.
  private directKey(a: string, b: string): string {
    return [a, b].sort().join("|");
  }

  async isSquadMemberPublic(squadId: string, userId: string): Promise<boolean> {
    return this.isSquadMember(squadId, userId);
  }

  // Get-or-create the 1:1 DM between two users. Both become participants.
  async getOrCreateDirectConversation(
    userId: string,
    otherUserId: string,
  ): Promise<DbConversation> {
    const key = this.directKey(userId, otherUserId);
    const [existing] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.directKey, key));
    if (existing) {
      await this.ensureParticipants(existing.id, [userId, otherUserId]);
      return existing;
    }
    const [created] = await db
      .insert(conversationsTable)
      .values({ type: "direct", directKey: key, createdBy: userId })
      .onConflictDoNothing({ target: conversationsTable.directKey })
      .returning();
    if (created) {
      await this.ensureParticipants(created.id, [userId, otherUserId]);
      return created;
    }
    // Lost a create race — re-read the row the other request inserted.
    const [row] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.directKey, key));
    await this.ensureParticipants(row.id, [userId, otherUserId]);
    return row;
  }

  // Get-or-create the chat thread for a squad. Participants are synced from the
  // squad's current members. Returns null when the squad doesn't exist or the
  // requesting user isn't a member.
  async getOrCreateSquadConversation(
    squadId: string,
    userId: string,
  ): Promise<DbConversation | null> {
    const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, squadId));
    if (!squad) return null;
    const memberIds = (squad.memberIds ?? []) as string[];
    if (!memberIds.includes(userId)) return null;

    let [convo] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.squadId, squadId));
    if (!convo) {
      [convo] = await db
        .insert(conversationsTable)
        .values({ type: "squad", squadId, createdBy: userId })
        .onConflictDoNothing({ target: conversationsTable.squadId })
        .returning();
      if (!convo) {
        [convo] = await db
          .select()
          .from(conversationsTable)
          .where(eq(conversationsTable.squadId, squadId));
      }
    }
    await this.ensureParticipants(convo.id, memberIds);
    return convo;
  }

  private async ensureParticipants(conversationId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await db
      .insert(conversationParticipantsTable)
      .values(userIds.map((userId) => ({ conversationId, userId })))
      .onConflictDoNothing({
        target: [
          conversationParticipantsTable.conversationId,
          conversationParticipantsTable.userId,
        ],
      });
  }

  async isConversationParticipant(conversationId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: conversationParticipantsTable.id })
      .from(conversationParticipantsTable)
      .where(
        and(
          eq(conversationParticipantsTable.conversationId, conversationId),
          eq(conversationParticipantsTable.userId, userId),
        ),
      );
    return !!row;
  }

  async getConversation(conversationId: string): Promise<DbConversation | null> {
    const [convo] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));
    return convo ?? null;
  }

  // Ensure the requesting user has access: a direct participant, or a current
  // member of the bound squad (members are re-synced as participants here so
  // newly-added squad members gain access without an explicit join).
  async getConversationForMember(
    conversationId: string,
    userId: string,
  ): Promise<DbConversation | null> {
    const convo = await this.getConversation(conversationId);
    if (!convo) return null;
    if (convo.type === "squad" && convo.squadId) {
      if (!(await this.isSquadMember(convo.squadId, userId))) return null;
      await this.ensureParticipants(conversationId, [userId]);
      return convo;
    }
    if (await this.isConversationParticipant(conversationId, userId)) return convo;
    return null;
  }

  async getConversationParticipants(conversationId: string) {
    return db
      .select({
        userId: conversationParticipantsTable.userId,
        lastReadAt: conversationParticipantsTable.lastReadAt,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
        profileImageUrl: usersTable.profileImageUrl,
      })
      .from(conversationParticipantsTable)
      .leftJoin(usersTable, eq(conversationParticipantsTable.userId, usersTable.id))
      .where(eq(conversationParticipantsTable.conversationId, conversationId));
  }

  // List every conversation the user can see: their DMs, plus a thread for each
  // squad they belong to (lazily created so squad chats always appear). Enriched
  // with display fields, unread count and the other participant for DMs.
  async listConversationsForUser(userId: string) {
    // Make sure each of the user's squads has a thread + participant row.
    const squads = await db
      .select()
      .from(squadsTable)
      .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`);
    for (const squad of squads) {
      await this.getOrCreateSquadConversation(squad.id, userId);
    }

    const rows = await db
      .select({
        convo: conversationsTable,
        lastReadAt: conversationParticipantsTable.lastReadAt,
      })
      .from(conversationParticipantsTable)
      .innerJoin(
        conversationsTable,
        eq(conversationParticipantsTable.conversationId, conversationsTable.id),
      )
      .where(eq(conversationParticipantsTable.userId, userId))
      .orderBy(desc(conversationsTable.lastMessageAt));

    const squadById = new Map(squads.map((s) => [s.id, s]));

    // Squad participant rows are never pruned on removal, so a stale row can
    // remain after a user leaves a squad. Gate squad conversations on CURRENT
    // membership (squadById holds only squads the user belongs to right now) so
    // removed members no longer see the thread, its preview, or unread counts.
    // Direct conversations remain governed by the participant row itself.
    const visibleRows = rows.filter(
      ({ convo }) =>
        convo.type !== "squad" || (convo.squadId != null && squadById.has(convo.squadId)),
    );

    const enriched = await Promise.all(
      visibleRows.map(async ({ convo, lastReadAt }) => {
        const unreadCount = await this.countUnreadInConversation(convo.id, userId, lastReadAt);
        const base = {
          id: convo.id,
          type: convo.type,
          lastMessageAt: convo.lastMessageAt,
          lastMessagePreview: convo.lastMessagePreview,
          lastMessageSenderId: convo.lastMessageSenderId,
          unreadCount,
        };
        if (convo.type === "squad" && convo.squadId) {
          const squad = squadById.get(convo.squadId);
          return {
            ...base,
            squadId: convo.squadId,
            title: squad?.name ?? "Squad",
            emoji: squad?.emoji ?? "👥",
            color: squad?.color ?? "#FF5C3A",
            otherUserId: null as string | null,
          };
        }
        // Direct: resolve the other participant for display.
        const [other] = await db
          .select({
            userId: conversationParticipantsTable.userId,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            email: usersTable.email,
            profileImageUrl: usersTable.profileImageUrl,
          })
          .from(conversationParticipantsTable)
          .leftJoin(usersTable, eq(conversationParticipantsTable.userId, usersTable.id))
          .where(
            and(
              eq(conversationParticipantsTable.conversationId, convo.id),
              ne(conversationParticipantsTable.userId, userId),
            ),
          )
          .limit(1);
        const name =
          [other?.firstName, other?.lastName].filter(Boolean).join(" ").trim() ||
          other?.email ||
          "Friend";
        return {
          ...base,
          squadId: null as string | null,
          title: name,
          emoji: null as string | null,
          color: null as string | null,
          otherUserId: other?.userId ?? null,
          otherUserImageUrl: other?.profileImageUrl ?? null,
        };
      }),
    );

    return enriched;
  }

  // Count messages in a conversation not sent by the user and newer than their
  // lastReadAt (all such messages when they've never read it).
  private async countUnreadInConversation(
    conversationId: string,
    userId: string,
    lastReadAt: Date | null,
  ): Promise<number> {
    const where = lastReadAt
      ? and(
          eq(conversationMessagesTable.conversationId, conversationId),
          ne(conversationMessagesTable.senderId, userId),
          sql`${conversationMessagesTable.createdAt} > ${lastReadAt}`,
        )
      : and(
          eq(conversationMessagesTable.conversationId, conversationId),
          ne(conversationMessagesTable.senderId, userId),
        );
    const [row] = await db.select({ value: count() }).from(conversationMessagesTable).where(where);
    return row?.value ?? 0;
  }

  // Total unread messages across all the user's conversations — drives the tab badge.
  async getTotalUnreadCount(userId: string): Promise<number> {
    // Current squad membership, so stale squad participant rows left behind after
    // a user is removed don't keep inflating their badge (see listConversationsForUser).
    const currentSquadIds = new Set(
      (
        await db
          .select({ id: squadsTable.id })
          .from(squadsTable)
          .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`)
      ).map((s) => s.id),
    );
    const rows = await db
      .select({
        conversationId: conversationParticipantsTable.conversationId,
        lastReadAt: conversationParticipantsTable.lastReadAt,
        type: conversationsTable.type,
        squadId: conversationsTable.squadId,
      })
      .from(conversationParticipantsTable)
      .innerJoin(
        conversationsTable,
        eq(conversationParticipantsTable.conversationId, conversationsTable.id),
      )
      .where(eq(conversationParticipantsTable.userId, userId));
    let total = 0;
    for (const row of rows) {
      if (row.type === "squad" && (row.squadId == null || !currentSquadIds.has(row.squadId))) {
        continue;
      }
      total += await this.countUnreadInConversation(row.conversationId, userId, row.lastReadAt);
    }
    return total;
  }

  async getConversationMessages(conversationId: string): Promise<DbConversationMessage[]> {
    return db
      .select()
      .from(conversationMessagesTable)
      .where(eq(conversationMessagesTable.conversationId, conversationId))
      .orderBy(asc(conversationMessagesTable.createdAt));
  }

  async addConversationMessage(
    conversationId: string,
    senderId: string,
    text: string,
    attachments: MessageAttachment[],
  ): Promise<DbConversationMessage> {
    const [message] = await db
      .insert(conversationMessagesTable)
      .values({ conversationId, senderId, text, attachments })
      .returning();
    const preview = text.trim()
      ? text.trim()
      : attachments.some((a) => a.kind === "video")
        ? "📹 Video"
        : "📷 Photo";
    await db
      .update(conversationsTable)
      .set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview.slice(0, 140),
        lastMessageSenderId: senderId,
      })
      .where(eq(conversationsTable.id, conversationId));
    // Sending implicitly marks the sender caught up.
    await this.markConversationRead(conversationId, senderId);
    return message;
  }

  async markConversationRead(conversationId: string, userId: string): Promise<void> {
    await db
      .update(conversationParticipantsTable)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationParticipantsTable.conversationId, conversationId),
          eq(conversationParticipantsTable.userId, userId),
        ),
      );
  }

  /**
   * Authorization check for serving a message attachment's object bytes. A user
   * may view the bytes only if they currently have access to a conversation
   * whose messages reference this object path. Access is evaluated with the
   * same membership-aware rule as message reads (`getConversationForMember`):
   * for squad threads the user must be a CURRENT squad member (stale
   * participant rows left behind after removal do not grant access); for DMs
   * the user must be a direct participant. Fails closed for unknown paths.
   */
  async canUserViewMessageAttachment(objectPath: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ conversationId: conversationMessagesTable.conversationId })
      .from(conversationMessagesTable)
      .where(
        sql`${conversationMessagesTable.attachments} @> ${JSON.stringify([{ url: objectPath }])}::jsonb`,
      );
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.conversationId)) continue;
      seen.add(row.conversationId);
      if (await this.getConversationForMember(row.conversationId, userId)) return true;
    }
    return false;
  }

  // ---- Push tokens ----

  async savePushToken(userId: string, token: string): Promise<void> {
    await db
      .update(usersTable)
      .set({ pushToken: token })
      .where(eq(usersTable.id, userId));
  }

  async getPushTokensForUsers(
    userIds: string[],
    opts: { requireNotifyReminders?: boolean } = {},
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const conditions = [inArray(usersTable.id, userIds)];
    if (opts.requireNotifyReminders) {
      conditions.push(eq(usersTable.notifyReminders, true));
    }
    const rows = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(and(...conditions));
    return rows.map((r) => r.pushToken).filter((t): t is string => Boolean(t));
  }
}

export const storage = new Storage();
