import {
  usersTable,
  planIdeasTable,
  eventsTable,
  eventCreationsTable,
  photosTable,
  squadsTable,
  squadMutesTable,
  squadMemberHistoryTable,
  availabilityPollsTable,
  availabilityResponsesTable,
  availabilityNudgesTable,
  waitlistTable,
  conversationsTable,
  conversationParticipantsTable,
  conversationMessagesTable,
  pushTicketsTable,
  pushRetriesTable,
  feedPostsTable,
  momentsTable,
  friendshipsTable,
  userBlocksTable,
  objectUploadsTable,
  favoritesTable,
  vaultHeartsTable,
  vaultCommentsTable,
  type Photo,
  type VaultComment,
  type AvailabilityPoll,
  type AvailabilityResponse,
  type DbConversation,
  type DbConversationMessage,
  type DbEvent,
  type MessageAttachment,
} from '@workspace/db/schema';
import { eq, sql, count, and, or, gte, lt, lte, desc, asc, inArray, ne, isNull, isNotNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '@workspace/db';
import {
  canUserAccessEventRecord,
  eventChatAudience,
  type EventVisibilityFields,
} from './lib/eventVisibility';
import { DEFAULT_POLL_DAY_COUNT } from './lib/pollDefaults';

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

/** Raised when a poll attempts to bind two independent scopes at once. */
export class AvailabilityPollScopeError extends Error {
  constructor() {
    super('An availability poll must target exactly one scope');
    this.name = 'AvailabilityPollScopeError';
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
export function defaultPollDates(count = DEFAULT_POLL_DAY_COUNT, start: Date = new Date()): string[] {
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
  mediaType: photosTable.mediaType,
  caption: photosTable.caption,
  status: photosTable.status,
  savedFromPhotoId: photosTable.savedFromPhotoId,
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

  /**
   * All squad IDs the user is CURRENTLY a member of. Used to make trips (and
   * other squad-scoped resources) visible to every squad member without an RSVP.
   * Always re-read live (never trust a cached membership snapshot).
   */
  async getSquadIdsForUser(userId: string): Promise<string[]> {
    const rows = await db
      .select({ id: squadsTable.id })
      .from(squadsTable)
      .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`);
    return rows.map((r) => r.id);
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

  /**
   * Set the unified Squadz+ entitlement flag. Called by the RevenueCat webhook
   * (mobile IAP) — and, when reactivated, the dormant Stripe webhook — so all
   * Pro gating reads one field. Idempotent: writing the same value is a no-op.
   *
   * Unconditional: use this for authoritative full-state reconciliation (the
   * /iap/sync path, which reads RevenueCat's live subscriber state). For webhook
   * events, prefer `setSquadzPlusForPeriod`, which cannot be reordered.
   */
  async setSquadzPlus(
    userId: string,
    isSquadzPlus: boolean,
    periodEndMs?: number | null,
    tier?: "founding" | "standard" | null,
  ) {
    const [user] = await db
      .update(usersTable)
      .set({
        isSquadzPlus,
        // Keep the marker in step so a later webhook compares against the state
        // sync just established, rather than a stale period.
        ...(periodEndMs === undefined
          ? {}
          : { squadzPlusPeriodEndMs: periodEndMs === null ? null : String(periodEndMs) }),
        // Tier is provenance, not access. Only ever written when we actually
        // know it (`undefined`/`null` = "no information in this event"), so a
        // product-id-less event can't erase a known founding tier. Callers must
        // not pass null to mean "revoked" — revocation is `isSquadzPlus=false`,
        // and readers report tier 'none' whenever the flag is false.
        // Founding is permanent pricing provenance. This CASE makes the promise
        // race-safe even if another entitlement writer observes a stale user
        // record between its read and this update.
        ...(tier
          ? {
              squadzPlusTier: sql`CASE
                WHEN ${usersTable.squadzPlusTier} = 'founding' AND ${tier} = 'standard'
                  THEN 'founding'
                ELSE ${tier}
              END`,
            }
          : {}),
      })
      .where(eq(usersTable.id, userId))
      .returning();
    return user;
  }

  /**
   * Apply a webhook-driven entitlement change ONLY if the event describes a
   * period at least as new as the one already applied.
   *
   * RevenueCat delivery is unordered and retried, so a delayed EXPIRATION for an
   * old period routinely arrives AFTER the RENEWAL that replaced it. Both look
   * like "a past expiry" on the wire — the only way to tell them apart is to
   * compare against the period we last acted on. Without this, a paying
   * subscriber silently loses Squadz+ while still being billed.
   *
   * Returns whether the write was applied, so the caller can log stale drops.
   */
  async setSquadzPlusForPeriod(
    userId: string,
    isSquadzPlus: boolean,
    periodEndMs: number | null,
    tier?: "founding" | "standard" | null,
  ): Promise<{ applied: boolean }> {
    // No period on the event (some types omit it): fall back to an unconditional
    // write — we have nothing to order it by.
    if (periodEndMs == null) {
      await this.setSquadzPlus(userId, isSquadzPlus, undefined, tier);
      return { applied: true };
    }
    const next = String(periodEndMs);
    const [row] = await db
      .update(usersTable)
      // Tier rides the SAME period-guarded write as the flag, so a stale event
      // can't rewrite the tier of a newer period it lost the race to. Omitted
      // when unknown so a product-id-less event leaves the stored tier intact.
      .set({
        isSquadzPlus,
        squadzPlusPeriodEndMs: next,
        ...(tier
          ? {
              squadzPlusTier: sql`CASE
                WHEN ${usersTable.squadzPlusTier} = 'founding' AND ${tier} = 'standard'
                  THEN 'founding'
                ELSE ${tier}
              END`,
            }
          : {}),
      })
      .where(
        and(
          eq(usersTable.id, userId),
          // Apply when we've never recorded a period, or this event's period is
          // not older than the applied one. Compared numerically: the column is
          // text so string ordering would misrank different-length timestamps.
          or(
            isNull(usersTable.squadzPlusPeriodEndMs),
            sql`${usersTable.squadzPlusPeriodEndMs}::bigint <= ${periodEndMs}`,
          ),
        ),
      )
      .returning();
    return { applied: !!row };
  }

  /**
   * Plan slots a user has consumed in the trailing 12-month window: events AND
   * trips, created AND joined, read from the append-only `event_creations`
   * ledger. Because ledger rows are never deleted, deleting or leaving a plan
   * does NOT free a slot — a slot only frees once its row ages out past 12
   * months. This backs the free-tier plan cap.
   *
   * Delegates to lib/planLimit so this read-only surface (GET /events/count)
   * can never drift from the rule the create/join paths actually enforce — a
   * user must never be told "2 of 3 used" and then be refused.
   */
  async countUserEventCreationsInWindow(userId: string): Promise<number> {
    const { countPlanSlotsUsed } = await import("./lib/planLimit");
    return countPlanSlotsUsed(db, userId);
  }

  /**
   * Returns the ISO timestamp when the user's oldest counted plan slot in the
   * trailing 12-month window will expire, or null if there are no slots yet.
   * Used by GET /events/count so the UpgradeModal can show "Your oldest slot
   * frees up [date]" before a create attempt is made.
   */
  async getOldestEventCreationAt(userId: string): Promise<string | null> {
    const { nextPlanSlotAvailableAt } = await import("./lib/planLimit");
    return nextPlanSlotAvailableAt(db, userId);
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

  async addPhoto(
    uploaderId: string,
    url: string,
    eventId?: string,
    opts?: { squadId?: string | null; sharedToSquad?: boolean; mediaType?: string; caption?: string | null },
  ): Promise<Photo> {
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
      .values({
        uploaderId,
        url,
        eventId: eventId ?? null,
        squadId: opts?.squadId ?? null,
        sharedToSquad: opts?.sharedToSquad ?? false,
        mediaType: opts?.mediaType === "video" ? "video" : "image",
        caption: opts?.caption ?? null,
      })
      .returning();
    return photo;
  }

  /**
   * The personal copy this user has already made of `sourcePhotoId`, if any.
   * Makes "Save to my vault" idempotent: tapping save twice must not create a
   * second copy (nor a second storage object).
   */
  async getSavedCopy(userId: string, sourcePhotoId: number): Promise<Photo | null> {
    const [row] = await db
      .select()
      .from(photosTable)
      .where(
        and(
          eq(photosTable.uploaderId, userId),
          eq(photosTable.savedFromPhotoId, sourcePhotoId),
        ),
      );
    return row ?? null;
  }

  /** Source photo ids this user has already copied into their personal vault. */
  async getSavedSourcePhotoIds(userId: string): Promise<number[]> {
    const rows = await db
      .select({ sourceId: photosTable.savedFromPhotoId })
      .from(photosTable)
      .where(
        and(
          eq(photosTable.uploaderId, userId),
          isNotNull(photosTable.savedFromPhotoId),
        ),
      );
    return rows.map((r) => r.sourceId).filter((id): id is number => id !== null);
  }

  /**
   * Create the personal-vault copy of a photo the user can view.
   *
   * The copy is a first-class photo row OWNED BY THE SAVER, with no eventId,
   * no squadId and sharedToSquad = false — it is not part of any shared vault,
   * so it neither leaks into the source squad/event roll-ups nor dies with
   * them. `savedFromPhotoId` is a bare integer (no FK) precisely so deleting
   * the source cannot cascade the copy away.
   *
   * `url` must already point at an INDEPENDENT storage object (the caller
   * copies the bytes first) — pointing both rows at the same object would put
   * the copy one source-deletion away from a broken image.
   */
  async addSavedPhotoCopy(
    userId: string,
    sourcePhoto: Photo,
    url: string,
  ): Promise<Photo | null> {
    const [photo] = await db
      .insert(photosTable)
      .values({
        uploaderId: userId,
        url,
        eventId: null,
        squadId: null,
        sharedToSquad: false,
        mediaType: sourcePhoto.mediaType === "video" ? "video" : "image",
        caption: sourcePhoto.caption ?? null,
        savedFromPhotoId: sourcePhoto.id,
      })
      // Two simultaneous saves both pass the "already saved?" probe, so the
      // unique (uploader_id, saved_from_photo_id) index is what actually
      // enforces one copy per source. The loser gets no row back (rather than
      // a 500) and its caller cleans up the object it copied for nothing.
      .onConflictDoNothing({
        target: [photosTable.uploaderId, photosTable.savedFromPhotoId],
      })
      .returning();
    return photo ?? null;
  }

  /**
   * The curated squad vault roll-up the vault SCREEN reads
   * (GET /api/squads/:id/vault): every photo shared into this squad's vault
   * (`squadId = X AND sharedToSquad = true`), including event-less photos added
   * straight to the squad. `getPhotosBySquadId` is kept a lossless superset of
   * this set so the two squad-photo surfaces never disagree.
   */
  async getSquadVaultPhotos(squadId: string) {
    return db
      .select({
        id: photosTable.id,
        url: photosTable.url,
        eventId: photosTable.eventId,
        uploaderId: photosTable.uploaderId,
        mediaType: photosTable.mediaType,
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

  /**
   * Hard-delete a photo row the user OWNS. Used by "remove from my vault" for
   * personal saved copies (the row and its object exist only for the saver, so
   * there is nothing shared to preserve). Returns the deleted row, or null when
   * the id isn't theirs.
   */
  async deleteOwnPhoto(photoId: number, uploaderId: string): Promise<Photo | null> {
    const [photo] = await db
      .delete(photosTable)
      .where(and(eq(photosTable.id, photoId), eq(photosTable.uploaderId, uploaderId)))
      .returning();
    return photo ?? null;
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
   * Return EVERY photo belonging to a squad, scoped to the requesting user
   * (who must be listed in the squad's memberIds).
   *
   * "Belonging to a squad" is the union of two provenances, so this stays in
   * lockstep with `getSquadVaultPhotos` (the curated roll-up the vault screen
   * uses) — neither surface may silently drop a squad photo:
   *   1. Photos linked to an event that belongs to the squad (event roll-ups).
   *   2. Photos shared straight to the squad's vault with no event
   *      (`squadId = X AND sharedToSquad = true`).
   *
   * Historically this method only returned (1), so event-less "shared straight
   * to squad" photos vanished from any surface that read from here — a latent
   * trap if a screen ever falls back onto this endpoint. Both provenances are
   * now included so `GET /api/vault/photos?squadId=` and
   * `GET /api/squads/:id/vault` agree on the full squad photo set.
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
    const eventIds = events.map(e => e.id);

    // Event-less photos shared straight to the squad vault are ALWAYS included,
    // even when the squad has no events at all.
    const sharedToSquad = and(
      eq(photosTable.squadId, squadId),
      eq(photosTable.sharedToSquad, true),
    );
    const provenance =
      eventIds.length > 0
        ? or(inArray(photosTable.eventId, eventIds), sharedToSquad)
        : sharedToSquad;

    const photos = await db
      .select(enrichedPhotoColumns)
      .from(photosTable)
      .leftJoin(eventsTable, eq(photosTable.eventId, eventsTable.id))
      .where(provenance);

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
    return this.canUserViewPhoto(photo, userId);
  }

  /**
   * Shared visibility rule for a vault photo: the uploader, any current member
   * of the squad it's shared into, or the host/squad-members/invited-participants
   * of its linked event may view it. Fail-closed for everyone else.
   */
  private async canUserViewPhoto(photo: Photo, userId: string): Promise<boolean> {
    if (photo.uploaderId === userId) return true;

    if (photo.sharedToSquad && photo.squadId) {
      if (await this.isSquadMember(photo.squadId, userId)) return true;
    }

    if (photo.eventId) {
      const [event] = await db
        .select({ squadId: eventsTable.squadId, hostId: eventsTable.hostId, invitedUserIds: eventsTable.invitedUserIds })
        .from(eventsTable)
        .where(eq(eventsTable.id, photo.eventId));
      if (event) {
        if (event.hostId === userId) return true;
        if (event.squadId && (await this.isSquadMember(event.squadId, userId))) {
          return true;
        }
        // Personal trips (no squad) invite friends directly via invitedUserIds —
        // they must be able to see each other's photos in the shared trip vault.
        const invited = (event.invitedUserIds ?? []) as string[];
        if (invited.includes(userId)) return true;
      }
    }

    return false;
  }

  /** Fetch a vault photo row by id, or null. */
  async getPhotoById(photoId: number): Promise<Photo | null> {
    const [photo] = await db.select().from(photosTable).where(eq(photosTable.id, photoId));
    return photo ?? null;
  }

  // ---- Vault media interactions (captions, hearts, comments) ----

  /**
   * Update a vault photo's caption. Only the original uploader may edit it.
   * Returns the updated photo, or null if it doesn't exist / the caller isn't
   * the uploader.
   */
  async updatePhotoCaption(
    photoId: number,
    uploaderId: string,
    caption: string | null,
  ): Promise<Photo | null> {
    const [photo] = await db
      .update(photosTable)
      .set({ caption })
      .where(and(eq(photosTable.id, photoId), eq(photosTable.uploaderId, uploaderId)))
      .returning();
    return photo ?? null;
  }

  /**
   * Toggle a heart on a photo for a user. Idempotent per (photoId, userId):
   * hearting an already-hearted photo removes it. Returns the new state and the
   * total heart count.
   */
  async toggleHeart(photoId: number, userId: string): Promise<{ hearted: boolean; heartCount: number }> {
    // Atomic flip: attempt the delete first and use RETURNING to learn whether a
    // row actually existed. This avoids the read-then-write window where two
    // concurrent toggles could both observe "not hearted" and net to the wrong
    // state. If nothing was deleted, the photo was not hearted, so insert it
    // (onConflictDoNothing covers the race where a parallel insert won).
    const removed = await db
      .delete(vaultHeartsTable)
      .where(and(eq(vaultHeartsTable.photoId, photoId), eq(vaultHeartsTable.userId, userId)))
      .returning({ id: vaultHeartsTable.id });

    let hearted: boolean;
    if (removed.length > 0) {
      hearted = false;
    } else {
      await db
        .insert(vaultHeartsTable)
        .values({ photoId, userId })
        .onConflictDoNothing({ target: [vaultHeartsTable.photoId, vaultHeartsTable.userId] });
      hearted = true;
    }

    const [{ value }] = await db
      .select({ value: count() })
      .from(vaultHeartsTable)
      .where(eq(vaultHeartsTable.photoId, photoId));
    return { hearted, heartCount: Number(value) };
  }

  /**
   * The users who have hearted a photo, most-recent first, with display fields
   * for rendering a who-hearted list.
   */
  async getPhotoHearts(photoId: number) {
    return db
      .select({
        userId: vaultHeartsTable.userId,
        createdAt: vaultHeartsTable.createdAt,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
      })
      .from(vaultHeartsTable)
      .leftJoin(usersTable, eq(vaultHeartsTable.userId, usersTable.id))
      .where(eq(vaultHeartsTable.photoId, photoId))
      .orderBy(desc(vaultHeartsTable.createdAt));
  }

  /**
   * Add a comment to a photo. The caller must already be authorized to view the
   * photo (enforced by the route). Returns the new comment.
   */
  async addVaultComment(photoId: number, authorId: string, text: string): Promise<VaultComment> {
    const [comment] = await db
      .insert(vaultCommentsTable)
      .values({ photoId, authorId, text })
      .returning();
    return comment;
  }

  /**
   * Non-deleted comments on a photo, oldest-first (thread order), with author
   * display fields.
   */
  async getVaultComments(photoId: number) {
    return db
      .select({
        id: vaultCommentsTable.id,
        photoId: vaultCommentsTable.photoId,
        authorId: vaultCommentsTable.authorId,
        text: vaultCommentsTable.text,
        createdAt: vaultCommentsTable.createdAt,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
      })
      .from(vaultCommentsTable)
      .leftJoin(usersTable, eq(vaultCommentsTable.authorId, usersTable.id))
      .where(and(eq(vaultCommentsTable.photoId, photoId), isNull(vaultCommentsTable.deletedAt)))
      .orderBy(asc(vaultCommentsTable.createdAt));
  }

  /** Fetch a single non-deleted comment by id, or null. */
  async getVaultComment(commentId: number): Promise<VaultComment | null> {
    const [comment] = await db
      .select()
      .from(vaultCommentsTable)
      .where(and(eq(vaultCommentsTable.id, commentId), isNull(vaultCommentsTable.deletedAt)));
    return comment ?? null;
  }

  /**
   * Soft-delete a comment. Allowed for the comment's author or the photo's
   * uploader. Returns true if a row was updated.
   */
  async softDeleteVaultComment(commentId: number, userId: string): Promise<boolean> {
    const comment = await this.getVaultComment(commentId);
    if (!comment) return false;
    const photo = await this.getPhotoById(comment.photoId);
    const canDelete = comment.authorId === userId || photo?.uploaderId === userId;
    if (!canDelete) return false;
    await db
      .update(vaultCommentsTable)
      .set({ deletedAt: new Date() })
      .where(eq(vaultCommentsTable.id, commentId));
    return true;
  }

  /**
   * Batch-load heart counts, the caller's hearted set, and comment counts for a
   * page of photos, so list endpoints can enrich without N+1 queries.
   */
  async getVaultInteractionStats(
    photoIds: number[],
    userId: string,
  ): Promise<{
    heartCounts: Map<number, number>;
    heartedIds: Set<number>;
    commentCounts: Map<number, number>;
  }> {
    const heartCounts = new Map<number, number>();
    const heartedIds = new Set<number>();
    const commentCounts = new Map<number, number>();
    if (photoIds.length === 0) return { heartCounts, heartedIds, commentCounts };

    const [heartRows, mineRows, commentRows] = await Promise.all([
      db
        .select({ photoId: vaultHeartsTable.photoId, value: count() })
        .from(vaultHeartsTable)
        .where(inArray(vaultHeartsTable.photoId, photoIds))
        .groupBy(vaultHeartsTable.photoId),
      db
        .select({ photoId: vaultHeartsTable.photoId })
        .from(vaultHeartsTable)
        .where(and(inArray(vaultHeartsTable.photoId, photoIds), eq(vaultHeartsTable.userId, userId))),
      db
        .select({ photoId: vaultCommentsTable.photoId, value: count() })
        .from(vaultCommentsTable)
        .where(and(inArray(vaultCommentsTable.photoId, photoIds), isNull(vaultCommentsTable.deletedAt)))
        .groupBy(vaultCommentsTable.photoId),
    ]);

    for (const r of heartRows) heartCounts.set(r.photoId, Number(r.value));
    for (const r of mineRows) heartedIds.add(r.photoId);
    for (const r of commentRows) commentCounts.set(r.photoId, Number(r.value));
    return { heartCounts, heartedIds, commentCounts };
  }

  /** Whether `userId` may view photo `photoId` (see canUserViewPhoto). */
  async canUserViewPhotoById(photoId: number, userId: string): Promise<boolean> {
    const photo = await this.getPhotoById(photoId);
    if (!photo) return false;
    return this.canUserViewPhoto(photo, userId);
  }

  // ---- Favorites (personal, reference-only bookmarks) ----

  /**
   * Bookmark a photo for a user. Idempotent (unique userId+photoId) — re-favoriting
   * is a no-op. Never copies or moves the underlying media. Authorization (the user
   * can actually view the photo) is enforced by the caller.
   */
  async addFavorite(userId: string, photoId: number): Promise<void> {
    await db
      .insert(favoritesTable)
      .values({ userId, photoId })
      .onConflictDoNothing({ target: [favoritesTable.userId, favoritesTable.photoId] });
  }

  /** Remove a user's bookmark of a photo. No-op if it wasn't favorited. */
  async removeFavorite(userId: string, photoId: number): Promise<void> {
    await db
      .delete(favoritesTable)
      .where(and(eq(favoritesTable.userId, userId), eq(favoritesTable.photoId, photoId)));
  }

  /** Mutual friend ids for a user (friendships are stored symmetrically). */
  async getFriendIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ friendId: friendshipsTable.friendId })
      .from(friendshipsTable)
      .where(eq(friendshipsTable.ownerId, userId));
    return rows.map((r) => r.friendId);
  }

  /** Set of photo ids the user has favorited, for flagging list responses. */
  async getUserFavoritePhotoIds(userId: string): Promise<Set<number>> {
    const rows = await db
      .select({ photoId: favoritesTable.photoId })
      .from(favoritesTable)
      .where(eq(favoritesTable.userId, userId));
    return new Set(rows.map(r => r.photoId));
  }

  /**
   * Every photo the user has favorited, across all squads, enriched with event
   * labels and ordered most-recent-upload first. Each item keeps its squadId so
   * the client can open it in its original squad context.
   */
  async getUserFavorites(userId: string): Promise<EnrichedPhoto[]> {
    return db
      .select(enrichedPhotoColumns)
      .from(favoritesTable)
      .innerJoin(photosTable, eq(favoritesTable.photoId, photosTable.id))
      .leftJoin(eventsTable, eq(photosTable.eventId, eventsTable.id))
      .where(eq(favoritesTable.userId, userId))
      .orderBy(desc(photosTable.uploadedAt));
  }

  /**
   * Fetch a vault photo row by its object path (e.g. "/objects/..."), or null if
   * the path is not a vault photo. Used by the object-serving route to apply the
   * 14-day free-tier lock at read time, so an old vault URL can never be fetched
   * directly by a free user.
   */
  async getPhotoByUrl(objectPath: string): Promise<Photo | null> {
    const [photo] = await db
      .select()
      .from(photosTable)
      .where(eq(photosTable.url, objectPath));
    return photo ?? null;
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
        .where(
          and(
            eq(availabilityPollsTable.eventId, opts.eventId),
            isNull(availabilityPollsTable.convertedEventId),
          ),
        )
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
            isNull(availabilityPollsTable.convertedEventId),
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
    participantIds?: string[] | null;
    title?: string;
    days?: string[];
    slots?: string[];
    kind?: "event" | "trip";
    tripLengthDays?: number | null;
  }): Promise<AvailabilityPoll> {
    // A poll is either for a squad or for an event. Keeping both IDs on one row
    // makes the access rule an accidental union, allowing a member of an
    // unrelated squad to read and answer an event poll. The route rejects this
    // too, but enforce the invariant here for every storage caller.
    if (
      (input.squadId && input.eventId) ||
      ((input.squadId || input.eventId) && input.participantIds?.length)
    ) {
      throw new AvailabilityPollScopeError();
    }
    const values: Record<string, unknown> = {
      createdBy: input.createdBy,
      squadId: input.squadId ?? null,
      eventId: input.eventId ?? null,
      participantIds:
        input.participantIds && input.participantIds.length ? input.participantIds : null,
    };
    if (input.title) values.title = input.title;
    // Polls coordinate on concrete calendar dates. When the caller doesn't
    // supply an explicit set, default to a sensible upcoming range.
    values.days = input.days && input.days.length ? input.days : defaultPollDates();
    if (input.slots && input.slots.length) values.slots = input.slots;
    // Explicit poll type — no longer inferred from the "All day" slot sentinel.
    if (input.kind) values.kind = input.kind;
    // Only trips carry a length. NULL on an event poll, and NULL on a trip poll
    // created without one (which then behaves like the legacy single-day trips).
    if (input.tripLengthDays != null) values.tripLengthDays = input.tripLengthDays;
    const [poll] = await db
      .insert(availabilityPollsTable)
      .values(values as typeof availabilityPollsTable.$inferInsert)
      .returning();
    return poll;
  }

  async updateAvailabilityPoll(
    pollId: string,
    updates: {
      title?: string;
      days?: string[];
      slots?: string[];
      /** A number sets the length; explicit `null` CLEARS it (back to
       *  single-best-day ranking); `undefined` leaves it alone. */
      tripLengthDays?: number | null;
    },
    updatedBy?: string,
  ): Promise<AvailabilityPoll> {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (updatedBy) setValues.updatedBy = updatedBy;
    if (updates.title !== undefined) setValues.title = updates.title;
    if (updates.days && updates.days.length) setValues.days = updates.days;
    if (updates.slots && updates.slots.length) setValues.slots = updates.slots;
    // Null is a real value here (SQL NULL), so the guard is on `undefined`
    // alone — a `!= null` check would make clearing impossible.
    if (updates.tripLengthDays !== undefined) setValues.tripLengthDays = updates.tripLengthDays;

    const [updated] = await db
      .update(availabilityPollsTable)
      .set(setValues as Partial<typeof availabilityPollsTable.$inferInsert>)
      .where(eq(availabilityPollsTable.id, pollId))
      .returning();

    // A grid-preserving edit (title, or a trip's LENGTH) can't put any cell out
    // of range, so skip the trim scan entirely. This is what keeps changing how
    // long the trip is from touching anyone's answers: cell identity is
    // `<date>-All day` either way, and only the ranking changes.
    if (!updates.days && !updates.slots) return updated;

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

  /**
   * List ACTIVE (not-yet-converted) polls for the "Existing" chooser.
   * - eventId → all polls bound to that event.
   * - squadId → all squad-scoped polls for that squad (eventId IS NULL).
   * - createdBy (no squadId) → the caller's personal/ad-hoc polls
   *   (squadId & eventId both NULL). Converted polls are always excluded.
   *
   * Event scope is a real list, not `findAvailabilityPoll` + 1: an event can
   * carry several active polls (a host re-asking after a date slip), and
   * collapsing them to the newest silently hides the board people already
   * answered on.
   */
  async listAvailabilityPolls(opts: {
    squadId?: string;
    eventId?: string;
    createdBy?: string;
  }): Promise<AvailabilityPoll[]> {
    const conds = [isNull(availabilityPollsTable.convertedEventId)];
    if (opts.eventId) {
      conds.push(eq(availabilityPollsTable.eventId, opts.eventId));
    } else if (opts.squadId) {
      conds.push(eq(availabilityPollsTable.squadId, opts.squadId));
      conds.push(sql`${availabilityPollsTable.eventId} IS NULL`);
    } else if (opts.createdBy) {
      conds.push(sql`${availabilityPollsTable.squadId} IS NULL`);
      conds.push(sql`${availabilityPollsTable.eventId} IS NULL`);
      conds.push(eq(availabilityPollsTable.createdBy, opts.createdBy));
    } else {
      return [];
    }
    return db
      .select()
      .from(availabilityPollsTable)
      .where(and(...conds))
      .orderBy(desc(availabilityPollsTable.createdAt));
  }

  /** Count responses per poll for a set of poll ids (for list summaries). */
  async countResponsesForPolls(pollIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (pollIds.length === 0) return out;
    const rows = await db
      .select({
        pollId: availabilityResponsesTable.pollId,
        count: sql<number>`count(*)::int`,
      })
      .from(availabilityResponsesTable)
      .where(inArray(availabilityResponsesTable.pollId, pollIds))
      .groupBy(availabilityResponsesTable.pollId);
    for (const r of rows) out.set(r.pollId, Number(r.count));
    return out;
  }

  /**
   * Newest response timestamp per poll, for list summaries.
   *
   * The squad/event screens show a "new responses since you last looked" badge.
   * That used to be derived from the single poll `/find` returned, so responses
   * on every other active poll were invisible. Summaries carry the timestamp so
   * the badge can span all of the caller's polls in the scope.
   */
  async lastResponseAtForPolls(pollIds: string[]): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    if (pollIds.length === 0) return out;
    const rows = await db
      .select({
        pollId: availabilityResponsesTable.pollId,
        lastAt: sql<string>`max(${availabilityResponsesTable.updatedAt})`,
      })
      .from(availabilityResponsesTable)
      .where(inArray(availabilityResponsesTable.pollId, pollIds))
      .groupBy(availabilityResponsesTable.pollId);
    for (const r of rows) {
      if (r.lastAt) out.set(r.pollId, new Date(r.lastAt));
    }
    return out;
  }

  /** Hard-delete a poll. Responses and nudges cascade via FK. Creator-only
   *  gating is enforced at the route layer. */
  async deleteAvailabilityPoll(pollId: string): Promise<void> {
    await db.delete(availabilityPollsTable).where(eq(availabilityPollsTable.id, pollId));
  }

  /**
   * Claim a poll's conversion slot for `eventId` so it drops out of the
   * "Existing" chooser.
   *
   * Exactly-once: the stamp only lands while `converted_event_id` IS NULL, so
   * two concurrent "lock in this time" taps cannot both believe they created
   * the poll's plan. The loser gets back the winner's event id and must show
   * that plan instead of its own duplicate.
   *
   * Re-stamping with the SAME event id is treated as success (idempotent
   * retry), so a client that retries a dropped response is not punished.
   */
  async claimAvailabilityPollConversion(
    pollId: string,
    eventId: string,
  ): Promise<{ claimed: boolean; convertedEventId: string | null }> {
    const [won] = await db
      .update(availabilityPollsTable)
      .set({ convertedEventId: eventId })
      .where(
        and(eq(availabilityPollsTable.id, pollId), isNull(availabilityPollsTable.convertedEventId)),
      )
      .returning({ convertedEventId: availabilityPollsTable.convertedEventId });
    if (won) return { claimed: true, convertedEventId: eventId };

    // Lost the race (or already converted earlier) — report the winning id.
    const [existing] = await db
      .select({ convertedEventId: availabilityPollsTable.convertedEventId })
      .from(availabilityPollsTable)
      .where(eq(availabilityPollsTable.id, pollId));
    const convertedEventId = existing?.convertedEventId ?? null;
    return { claimed: convertedEventId === eventId, convertedEventId };
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
  /**
   * Access rule for an availability poll.
   *
   * Scoped polls (squadId and/or eventId) are gated on LIVE membership with NO
   * creator exception: a creator who leaves the squad loses access to the poll
   * they made, exactly like any other ex-member. Granting the creator access
   * first — as this used to — let a departed organizer keep reading a squad's
   * availability indefinitely.
   *
   * Ad-hoc polls (neither squadId nor eventId) have no membership to evaluate,
   * so they keep creator access plus their explicit participantIds roster and
   * remain open-by-UUID for invite-link sharing. Without that branch they would
   * be orphaned and unreachable by anyone, including the person who made them.
   */
  async canAccessAvailabilityPoll(poll: AvailabilityPoll, userId: string): Promise<boolean> {
    const scoped = Boolean(poll.squadId || poll.eventId);
    const event = poll.eventId ? await this.getEvent(poll.eventId) : null;

    // Legacy/corrupt rows can still contain both IDs. They are only safe when
    // the squad is exactly the event's squad; an unrelated squad must never
    // grant access through the poll's second scope. Fail closed for a deleted
    // event or a mismatched (event, squad) pair.
    if (poll.squadId && poll.eventId && (!event || event.squadId !== poll.squadId)) {
      return false;
    }

    if (poll.squadId && (await this.isSquadMember(poll.squadId, userId))) return true;
    if (poll.eventId) {
      if (event) {
        if (event.hostId === userId) return true;
        if (event.squadId && (await this.isSquadMember(event.squadId, userId))) return true;
        // Presence of an RSVP key is not participation: the map keeps a row for
        // everyone who ever answered, so a "notgoing" decline was granting the
        // person who explicitly bailed permanent read access to the squad's
        // availability. Only an active status counts.
        const status = (event.rsvps as Record<string, unknown> | null | undefined)?.[userId];
        if (status === "going" || status === "maybe") return true;
      }
    }

    // Scoped poll and none of the live-membership checks matched.
    if (scoped) return false;

    // Ad-hoc poll: creator + explicit roster, then open-by-UUID for link shares.
    if (poll.createdBy === userId) return true;
    const roster = (poll.participantIds ?? null) as string[] | null;
    if (roster && roster.includes(userId)) return true;
    return true;
  }

  // ---- Availability Nudges ----

  /** Returns the most recent nudge from `fromUserId` → `toUserId` in this poll
   *  within `windowMs`, or null if none exists. Used for debounce checks. */
  async getRecentNudge(
    pollId: string,
    fromUserId: string,
    toUserId: string,
    windowMs: number,
  ): Promise<{ sentAt: Date } | null> {
    const since = new Date(Date.now() - windowMs);
    const [row] = await db
      .select({ sentAt: availabilityNudgesTable.sentAt })
      .from(availabilityNudgesTable)
      .where(
        and(
          eq(availabilityNudgesTable.pollId, pollId),
          eq(availabilityNudgesTable.fromUserId, fromUserId),
          eq(availabilityNudgesTable.toUserId, toUserId),
          gte(availabilityNudgesTable.sentAt, since),
        ),
      )
      .orderBy(desc(availabilityNudgesTable.sentAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * Record a nudge from `fromUserId` → `toUserId` in this poll, enforcing the
   * debounce window in the same statement.
   *
   * The table carries a UNIQUE (poll_id, to_user_id) constraint, so a plain
   * INSERT throws on every nudge after the first — the debounce window would
   * expire and the next legitimate nudge would 500. This upserts instead, and
   * only refreshes `sent_at` when the previous nudge is already older than the
   * window. That makes the debounce atomic: two simultaneous taps produce one
   * nudge and one 429, never a duplicate push or an unhandled unique violation.
   *
   * Returns `applied: false` with the existing `sentAt` when the window is
   * still open, so the caller can compute an accurate retry-after.
   */
  async createNudge(
    pollId: string,
    fromUserId: string,
    toUserId: string,
    debounceMs: number,
  ): Promise<{ applied: boolean; sentAt: Date }> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - debounceMs);
    const [row] = await db
      .insert(availabilityNudgesTable)
      .values({ pollId, fromUserId, toUserId, sentAt: now })
      .onConflictDoUpdate({
        target: [availabilityNudgesTable.pollId, availabilityNudgesTable.toUserId],
        set: { fromUserId, sentAt: now },
        setWhere: lt(availabilityNudgesTable.sentAt, cutoff),
      })
      .returning({ sentAt: availabilityNudgesTable.sentAt });
    if (row) return { applied: true, sentAt: row.sentAt };

    // Conflict target matched but the setWhere guard rejected the update — the
    // previous nudge is still inside the debounce window.
    const [existing] = await db
      .select({ sentAt: availabilityNudgesTable.sentAt })
      .from(availabilityNudgesTable)
      .where(
        and(
          eq(availabilityNudgesTable.pollId, pollId),
          eq(availabilityNudgesTable.toUserId, toUserId),
        ),
      );
    return { applied: false, sentAt: existing?.sentAt ?? now };
  }

  /** Returns the most recent time `toUserId` was nudged in this poll within
   *  the last 24 hours, or null if no recent nudge exists. Used to surface a
   *  banner to the nudged member when they open the availability screen. */
  async getLatestNudgeForUser(
    pollId: string,
    toUserId: string,
  ): Promise<Date | null> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ sentAt: availabilityNudgesTable.sentAt })
      .from(availabilityNudgesTable)
      .where(
        and(
          eq(availabilityNudgesTable.pollId, pollId),
          eq(availabilityNudgesTable.toUserId, toUserId),
          gte(availabilityNudgesTable.sentAt, since),
        ),
      )
      .orderBy(desc(availabilityNudgesTable.sentAt))
      .limit(1);
    return row?.sentAt ?? null;
  }

  /** Returns the last nudge sent from `fromUserId` to each target in `toUserIds`
   *  within `windowMs`, keyed by toUserId. Used for per-member debounce info
   *  returned to the creator so the UI can pre-disable buttons. */
  async getRecentNudgesFromUser(
    pollId: string,
    fromUserId: string,
    toUserIds: string[],
    windowMs: number,
  ): Promise<Map<string, Date>> {
    if (toUserIds.length === 0) return new Map();
    const since = new Date(Date.now() - windowMs);
    const rows = await db
      .select({ toUserId: availabilityNudgesTable.toUserId, sentAt: availabilityNudgesTable.sentAt })
      .from(availabilityNudgesTable)
      .where(
        and(
          eq(availabilityNudgesTable.pollId, pollId),
          eq(availabilityNudgesTable.fromUserId, fromUserId),
          inArray(availabilityNudgesTable.toUserId, toUserIds),
          gte(availabilityNudgesTable.sentAt, since),
        ),
      )
      .orderBy(desc(availabilityNudgesTable.sentAt));

    const result = new Map<string, Date>();
    for (const row of rows) {
      if (!result.has(row.toUserId)) result.set(row.toUserId, row.sentAt);
    }
    return result;
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

  /**
   * W-01: Returns true if two users have ever shared a squad. Uses the
   * append-only squad_member_history table which survives member removal,
   * letting former squadmates keep their existing DM thread.
   */
  async doUsersShareSquadHistory(userA: string, userB: string): Promise<boolean> {
    const result = await db.execute(sql`
      SELECT 1 FROM squad_member_history h1
      INNER JOIN squad_member_history h2 ON h1.squad_id = h2.squad_id
      WHERE h1.user_id = ${userA} AND h2.user_id = ${userB}
      LIMIT 1
    `);
    return (result.rows?.length ?? 0) > 0;
  }

  /**
   * Returns true when the two users are friends. Friendship rows are written
   * symmetrically (one per direction), so a single-direction lookup is enough.
   */
  async areUsersFriends(userA: string, userB: string): Promise<boolean> {
    const [row] = await db
      .select({ id: friendshipsTable.id })
      .from(friendshipsTable)
      .where(and(eq(friendshipsTable.ownerId, userA), eq(friendshipsTable.friendId, userB)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * Private DMs are friends-only.
   *
   * This replaces the earlier shared-squad-history rule: sharing a squad now
   * grants group-chat access only, never a private thread. Friendship is the
   * sole key, so an existing thread between people who are not (or are no
   * longer) friends is not resumable either — otherwise unfriending, or a
   * block that drops the friendship, would leave a usable back door.
   */
  async canInitiateDm(userId: string, otherUserId: string): Promise<boolean> {
    return this.areUsersFriends(userId, otherUserId);
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

  // ---- Per-plan (event / trip) chat threads ----

  /** Live squad roster reader shared by the plan visibility helpers below. */
  private async squadMemberIds(squadId: string): Promise<string[]> {
    const squad = await this.getSquad(squadId);
    return (squad?.memberIds ?? []) as string[];
  }

  /**
   * Can this user see/touch this plan? Thin delegate to the shared rule in
   * lib/eventVisibility so plan access and plan CHAT access can never drift.
   */
  async canUserAccessEventRecord(
    event: EventVisibilityFields,
    userId: string,
  ): Promise<boolean> {
    return canUserAccessEventRecord(event, userId, (id) => this.squadMemberIds(id));
  }

  /** Everyone who currently belongs in the plan's chat thread. */
  private async eventChatAudience(event: EventVisibilityFields): Promise<string[]> {
    return eventChatAudience(event, (id) => this.squadMemberIds(id));
  }

  /**
   * Get-or-create the chat thread for a plan (event OR trip). Returns null when
   * the plan doesn't exist or the requesting user can't currently see it.
   *
   * Retry-safe: the unique index on `event_id` plus ON CONFLICT DO NOTHING means
   * two concurrent opens converge on one thread (the loser re-reads the winner's
   * row) — exactly the pattern squad threads use.
   */
  async getOrCreateEventConversation(
    eventId: string,
    userId: string,
  ): Promise<DbConversation | null> {
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
    if (!event) return null;
    if (!(await this.canUserAccessEventRecord(event, userId))) return null;

    let [convo] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.eventId, eventId));
    if (!convo) {
      [convo] = await db
        .insert(conversationsTable)
        .values({ type: 'event', eventId, createdBy: event.hostId })
        .onConflictDoNothing({ target: conversationsTable.eventId })
        .returning();
      if (!convo) {
        // Lost the create race — re-read the row the other request inserted.
        [convo] = await db
          .select()
          .from(conversationsTable)
          .where(eq(conversationsTable.eventId, eventId));
      }
    }
    if (!convo) return null;
    await this.ensureParticipants(convo.id, await this.eventChatAudience(event));
    return convo;
  }

  /**
   * Re-sync an event thread's participant rows from the plan's CURRENT audience.
   * Called before a send so a squadmate added after the thread was created still
   * receives the push and sees the thread in their inbox.
   *
   * Participant rows are append-only (same contract as squad threads): removal
   * is enforced by re-checking live visibility on read, never by pruning rows.
   */
  async syncEventConversationParticipants(conversationId: string, eventId: string): Promise<void> {
    const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
    if (!event) return;
    await this.ensureParticipants(conversationId, await this.eventChatAudience(event));
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

  /**
   * Batch version of getOrCreateSquadConversation for listConversationsForUser.
   * Issues at most 3 DB round trips regardless of squad count:
   *   1. SELECT — find which squads already have conversation rows
   *   2. INSERT — batch-create missing conversations (ON CONFLICT DO NOTHING)
   *   3. SELECT — recover any rows lost to an INSERT race
   * Then ensureParticipants runs in parallel (not sequentially) for each squad.
   */
  private async ensureSquadConversationsBatch(
    squads: Array<{ id: string; memberIds: unknown }>,
    userId: string,
  ): Promise<void> {
    if (squads.length === 0) return;
    const squadIds = squads.map((s) => s.id);

    const existing = await db
      .select({ squadId: conversationsTable.squadId, id: conversationsTable.id })
      .from(conversationsTable)
      .where(inArray(conversationsTable.squadId, squadIds));

    const convoIdBySquadId = new Map(existing.map((c) => [c.squadId!, c.id]));

    const missingIds = squadIds.filter((id) => !convoIdBySquadId.has(id));
    if (missingIds.length > 0) {
      const inserted = await db
        .insert(conversationsTable)
        .values(
          missingIds.map((squadId) => ({
            type: "squad" as const,
            squadId,
            createdBy: userId,
          })),
        )
        .onConflictDoNothing({ target: conversationsTable.squadId })
        .returning({ id: conversationsTable.id, squadId: conversationsTable.squadId });

      for (const row of inserted) {
        if (row.squadId) convoIdBySquadId.set(row.squadId, row.id);
      }

      // Any ID still missing lost the INSERT race to another instance — fetch now.
      const stillMissing = missingIds.filter((id) => !convoIdBySquadId.has(id));
      if (stillMissing.length > 0) {
        const recovered = await db
          .select({ squadId: conversationsTable.squadId, id: conversationsTable.id })
          .from(conversationsTable)
          .where(inArray(conversationsTable.squadId, stillMissing));
        for (const row of recovered) {
          if (row.squadId) convoIdBySquadId.set(row.squadId, row.id);
        }
      }
    }

    // Ensure participant rows for all members — parallel, not sequential.
    await Promise.all(
      squads.map((squad) => {
        const convoId = convoIdBySquadId.get(squad.id);
        if (!convoId) return;
        const memberIds = (squad.memberIds ?? []) as string[];
        return this.ensureParticipants(convoId, memberIds);
      }),
    );
  }

  /**
   * Return unread-message counts for multiple conversations in a single query.
   * Replaces N parallel countUnreadInConversation calls in listConversationsForUser.
   * Uses a JOIN on conversation_participants so each conversation's last_read_at
   * is read in the same pass — no extra per-conversation round trips.
   */
  private async batchCountUnread(
    conversationIds: string[],
    userId: string,
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await db
      .select({
        conversationId: conversationMessagesTable.conversationId,
        unreadCount: count(),
      })
      .from(conversationMessagesTable)
      .innerJoin(
        conversationParticipantsTable,
        and(
          eq(
            conversationParticipantsTable.conversationId,
            conversationMessagesTable.conversationId,
          ),
          eq(conversationParticipantsTable.userId, userId),
        ),
      )
      .where(
        and(
          inArray(conversationMessagesTable.conversationId, conversationIds),
          ne(conversationMessagesTable.senderId, userId),
          sql`(${conversationParticipantsTable.lastReadAt} IS NULL OR ${conversationMessagesTable.createdAt} > ${conversationParticipantsTable.lastReadAt})`,
        ),
      )
      .groupBy(conversationMessagesTable.conversationId);
    return new Map(rows.map((r) => [r.conversationId, Number(r.unreadCount)]));
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

  // Ensure the requesting user has access: a direct participant, a current
  // member of the bound squad, or someone who can currently see the bound plan
  // (members/audience are re-synced as participants here so newly-added people
  // gain access without an explicit join).
  //
  // Participant rows are NEVER pruned, so for squad and event threads the row
  // alone must never be trusted — live membership/visibility is re-checked on
  // every access.
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
    if (convo.type === "event" && convo.eventId) {
      const [event] = await db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.id, convo.eventId));
      if (!event) return null;
      if (!(await this.canUserAccessEventRecord(event, userId))) return null;
      await this.ensureParticipants(conversationId, [userId]);
      return convo;
    }
    if (await this.isConversationParticipant(conversationId, userId)) return convo;
    return null;
  }

  /**
   * Live authorization for an EXISTING direct thread.
   *
   * `getConversationForMember` is NOT sufficient for a DM: participant rows are
   * append-only, so they still say "member" after an unfriend or a block. A
   * private thread is only open while the two people are currently friends and
   * neither has blocked the other. Returns the reason access is denied, or null
   * when the thread is open. Every DM surface (read, send, SSE stream, read
   * receipts, attachment bytes) must go through this.
   */
  async directThreadDenialReason(
    conversationId: string,
    userId: string,
  ): Promise<"blocked" | "not_friends" | null> {
    const participants = await this.getConversationParticipants(conversationId);
    const otherIds = participants.map((p) => p.userId).filter((uid) => uid !== userId);
    if (otherIds.length === 0) return null;

    const [blockedByUser, blockersOfUser] = await Promise.all([
      db
        .select({ id: userBlocksTable.blockedId })
        .from(userBlocksTable)
        .where(eq(userBlocksTable.blockerId, userId)),
      db
        .select({ id: userBlocksTable.blockerId })
        .from(userBlocksTable)
        .where(eq(userBlocksTable.blockedId, userId)),
    ]);
    const blocked = new Set<string>([
      ...blockedByUser.map((r) => r.id),
      ...blockersOfUser.map((r) => r.id),
    ]);
    if (otherIds.some((uid) => blocked.has(uid))) return "blocked";

    const friendship = await Promise.all(
      otherIds.map((uid) => this.areUsersFriends(userId, uid)),
    );
    if (friendship.some((isFriend) => !isFriend)) return "not_friends";
    return null;
  }

  /**
   * Full access check for any conversation kind: membership first, then the
   * live friends-only/block rule for direct threads. Squad and event chats stay
   * membership-based and are unaffected by blocks.
   */
  async canAccessConversation(conversationId: string, userId: string): Promise<boolean> {
    const convo = await this.getConversationForMember(conversationId, userId);
    if (!convo) return false;
    if (convo.type !== "direct") return true;
    return (await this.directThreadDenialReason(conversationId, userId)) === null;
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
    await this.ensureSquadConversationsBatch(squads, userId);

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

    // Load the plans behind any event threads so their rows can be gated on
    // CURRENT visibility and enriched with the plan's title/emoji.
    const eventIds = [
      ...new Set(
        rows
          .filter(({ convo }) => convo.type === "event" && convo.eventId)
          .map(({ convo }) => convo.eventId as string),
      ),
    ];
    const eventById = new Map<string, DbEvent>();
    if (eventIds.length > 0) {
      const evs = await db.select().from(eventsTable).where(inArray(eventsTable.id, eventIds));
      for (const e of evs) eventById.set(e.id, e);
    }

    // Squad and event participant rows are never pruned on removal, so a stale
    // row can remain after a user leaves a squad or loses access to a plan. Gate
    // both on CURRENT visibility (squadById / the live plan record) so removed
    // members no longer see the thread, its preview, or unread counts. Direct
    // conversations remain governed by the participant row itself.
    const visibleRows = rows.filter(({ convo }) => {
      if (convo.type === "squad") {
        return convo.squadId != null && squadById.has(convo.squadId);
      }
      if (convo.type === "event") {
        if (convo.eventId == null) return false;
        const event = eventById.get(convo.eventId);
        // A cancelled plan's chat is closed and drops out of the inbox, and an
        // empty thread (opened but never used) stays hidden — matching how plan
        // chats have always surfaced here.
        if (!event || event.cancelled) return false;
        if (convo.lastMessageSenderId === "") return false;
        return this.canSeeEventWithSquadIds(event, userId, squadById);
      }
      return true;
    });

    // Single JOIN query replaces N parallel countUnreadInConversation calls.
    const unreadByConvoId = await this.batchCountUnread(
      visibleRows.map(({ convo }) => convo.id),
      userId,
    );

    const enriched = await Promise.all(
      visibleRows.map(async ({ convo }) => {
        const unreadCount = unreadByConvoId.get(convo.id) ?? 0;
        const base = {
          id: convo.id,
          type: convo.type,
          lastMessageAt: convo.lastMessageAt,
          lastMessagePreview: convo.lastMessagePreview,
          lastMessageSenderId: convo.lastMessageSenderId,
          unreadCount,
          // Only set for plan threads; lets the client route the row back to the
          // event/trip detail screen rather than the generic chat screen.
          eventId: null as string | null,
          eventType: null as string | null,
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
        if (convo.type === "event" && convo.eventId) {
          const event = eventById.get(convo.eventId);
          return {
            ...base,
            eventId: convo.eventId,
            eventType: event?.type ?? "event",
            squadId: event?.squadId || null,
            title: event?.title ?? "Plan",
            emoji: event?.emoji ?? (event?.type === "trip" ? "✈️" : "🎉"),
            color: null as string | null,
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

  /**
   * In-memory variant of canUserAccessEventRecord for list paths that have
   * already loaded the user's CURRENT squads — same rule, zero extra queries.
   */
  private canSeeEventWithSquadIds(
    event: Pick<DbEvent, 'hostId' | 'invitedUserIds' | 'squadId' | 'type' | 'rsvps'>,
    userId: string,
    mySquads: Map<string, unknown>,
  ): boolean {
    if (event.hostId === userId) return true;
    if (((event.invitedUserIds ?? []) as string[]).includes(userId)) return true;
    if (event.squadId && mySquads.has(event.squadId)) return true;
    if (event.type === 'trip') return false;
    return userId in ((event.rsvps ?? {}) as Record<string, string>);
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
    const currentSquads = new Map<string, true>(
      (
        await db
          .select({ id: squadsTable.id })
          .from(squadsTable)
          .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`)
      ).map((s) => [s.id, true as const]),
    );
    const rows = await db
      .select({
        conversationId: conversationParticipantsTable.conversationId,
        lastReadAt: conversationParticipantsTable.lastReadAt,
        type: conversationsTable.type,
        squadId: conversationsTable.squadId,
        eventId: conversationsTable.eventId,
      })
      .from(conversationParticipantsTable)
      .innerJoin(
        conversationsTable,
        eq(conversationParticipantsTable.conversationId, conversationsTable.id),
      )
      .where(eq(conversationParticipantsTable.userId, userId));

    // Same stale-participant-row problem as squads: gate plan threads on the
    // live plan record so a removed/uninvited user's badge stops counting them.
    const eventIds = [
      ...new Set(
        rows.filter((r) => r.type === "event" && r.eventId).map((r) => r.eventId as string),
      ),
    ];
    const eventById = new Map<string, DbEvent>();
    if (eventIds.length > 0) {
      const evs = await db.select().from(eventsTable).where(inArray(eventsTable.id, eventIds));
      for (const e of evs) eventById.set(e.id, e);
    }

    let total = 0;
    for (const row of rows) {
      if (row.type === "squad" && (row.squadId == null || !currentSquads.has(row.squadId))) {
        continue;
      }
      if (row.type === "event") {
        const event = row.eventId ? eventById.get(row.eventId) : undefined;
        if (!event || event.cancelled) continue;
        if (!this.canSeeEventWithSquadIds(event, userId, currentSquads)) continue;
      }
      total += await this.countUnreadInConversation(row.conversationId, userId, row.lastReadAt);
    }
    return total;
  }

  // Cursor-paginated: returns the newest page of messages BEFORE the cursor
  // message (exclusive), in ascending order within the page. `hasMore` tells
  // the client whether an older page exists. Cursor is a message id (stable
  // under concurrent inserts, unlike a bare timestamp).
  async getConversationMessages(
    conversationId: string,
    opts?: { before?: string; limit?: number },
  ): Promise<{ messages: DbConversationMessage[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
    // BUG-02: exclude messages that have been auto-hidden by the moderation threshold.
    const conditions = [
      eq(conversationMessagesTable.conversationId, conversationId),
      ne(conversationMessagesTable.status, 'hidden'),
    ];
    if (opts?.before) {
      const [cursorMsg] = await db
        .select()
        .from(conversationMessagesTable)
        .where(
          and(
            eq(conversationMessagesTable.id, opts.before),
            eq(conversationMessagesTable.conversationId, conversationId),
          ),
        );
      if (cursorMsg) {
        // Tuple comparison (createdAt, id) < (cursor.createdAt, cursor.id):
        // deterministic even when several messages share a timestamp.
        conditions.push(
          sql`(${conversationMessagesTable.createdAt}, ${conversationMessagesTable.id}) < (${cursorMsg.createdAt}, ${cursorMsg.id})`,
        );
      }
    }
    const rows = await db
      .select()
      .from(conversationMessagesTable)
      .where(and(...conditions))
      .orderBy(desc(conversationMessagesTable.createdAt), desc(conversationMessagesTable.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: page, hasMore };
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
      // canAccessConversation, not getConversationForMember: a direct thread's
      // participant row survives an unfriend/block, so membership alone would
      // keep handing out the attachment bytes of a closed DM.
      if (await this.canAccessConversation(row.conversationId, userId)) return true;
    }
    return false;
  }

  /**
   * Record the owner of a freshly-issued upload path. Idempotent: the path is
   * server-generated and only handed to the requester, so the first (and only)
   * writer is the legitimate owner. Re-recording a path keeps the original owner.
   */
  async recordUpload(ownerId: string, objectPath: string): Promise<void> {
    await db
      .insert(objectUploadsTable)
      .values({ ownerId, objectPath })
      .onConflictDoNothing({ target: objectUploadsTable.objectPath });
  }

  /**
   * Drop an upload-provenance row, but ONLY if the given user owns it.
   *
   * The mirror of recordUpload: when the object it points at is deleted, the
   * row must go too. A provenance row outliving its bytes makes account
   * deletion chase an object that is already gone, and (worse) keeps claiming
   * ownership of a path the storage layer is free to hand out again.
   */
  async deleteUploadRecord(ownerId: string, objectPath: string): Promise<void> {
    await db
      .delete(objectUploadsTable)
      .where(
        and(
          eq(objectUploadsTable.objectPath, objectPath),
          eq(objectUploadsTable.ownerId, ownerId),
        ),
      );
  }

  /**
   * How many photo rows still point at this exact object path. Guards
   * byte-deletion: an object referenced by any surviving row must never be
   * removed, no matter who owns the provenance.
   */
  async countPhotosByUrl(url: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(photosTable)
      .where(eq(photosTable.url, url));
    return Number(row?.value ?? 0);
  }

  /** Returns the user who uploaded the given object path, or null if unknown. */
  async getUploadOwner(objectPath: string): Promise<string | null> {
    const [row] = await db
      .select({ ownerId: objectUploadsTable.ownerId })
      .from(objectUploadsTable)
      .where(eq(objectUploadsTable.objectPath, objectPath));
    return row?.ownerId ?? null;
  }

  async canUserViewFeedMedia(objectPath: string, userId: string): Promise<boolean> {
    const posts = await db
      .select({ authorId: feedPostsTable.authorId, audience: feedPostsTable.audience })
      .from(feedPostsTable)
      .where(and(eq(feedPostsTable.mediaUrl, objectPath), isNull(feedPostsTable.deletedAt)));
    if (posts.length === 0) return false;

    for (const post of posts) {
      if (post.authorId === userId) return true;
      if (post.audience === "friends") {
        const [row] = await db
          .select({ ownerId: friendshipsTable.ownerId })
          .from(friendshipsTable)
          .where(
            and(
              eq(friendshipsTable.ownerId, post.authorId),
              eq(friendshipsTable.friendId, userId),
            ),
          );
        if (row) return true;
      } else if (await this.isSquadMember(post.audience, userId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether `userId` may load the media behind a moment's stored objectPath.
   * Mirrors the moment audience rules: the author always can; a "friends"
   * moment is visible to the author's friends; a squad moment is visible to
   * current squad members. Without this, the /storage/objects/* route 403s
   * moment media for everyone (author included) → black screen / video error.
   */
  /**
   * Whether `userId` may load the image behind a cost receipt's stored object
   * path. Delegates to the canonical `canUserAccessEventRecord` visibility rule
   * so receipt access stays in sync with plan access and can never drift.
   * Fails closed for unknown paths (no event references this objectPath).
   */
  async canUserViewReceiptMedia(objectPath: string, userId: string): Promise<boolean> {
    // Use a text-search filter to quickly narrow down events that might contain
    // this path in their costs JSON, then verify with an exact match.
    const rows = await db
      .select()
      .from(eventsTable)
      .where(sql`${eventsTable.costs}::text LIKE ${"%" + objectPath + "%"}`);

    for (const event of rows) {
      const costs = (event.costs ?? []) as Array<{ receiptUrl?: string | null }>;
      const referenced = costs.some((c) => c.receiptUrl === objectPath);
      if (!referenced) continue; // text-match coincidence, skip

      const canAccess = await canUserAccessEventRecord(
        event,
        userId,
        (squadId) => this.squadMemberIds(squadId),
      );
      if (canAccess) return true;
    }
    return false;
  }

  async canUserViewMomentMedia(objectPath: string, userId: string): Promise<boolean> {
    const moments = await db
      .select({ authorId: momentsTable.authorId, audience: momentsTable.audience })
      .from(momentsTable)
      .where(and(eq(momentsTable.mediaUrl, objectPath), isNull(momentsTable.deletedAt)));
    if (moments.length === 0) return false;

    for (const moment of moments) {
      if (moment.authorId === userId) return true;
      if (moment.audience === "friends") {
        const [row] = await db
          .select({ ownerId: friendshipsTable.ownerId })
          .from(friendshipsTable)
          .where(
            and(
              eq(friendshipsTable.ownerId, moment.authorId),
              eq(friendshipsTable.friendId, userId),
            ),
          );
        if (row) return true;
      } else if (await this.isSquadMember(moment.audience, userId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns whether `userId` is currently permitted to see the reported content.
   * Used by POST /reports to prevent coordinated harassment: 3 accounts who have
   * never legitimately viewed an item cannot trigger auto-hide via reports.
   * - profile: any authenticated user can view any profile
   * - photo: delegates to canUserViewPhotoById
   * - post/moment: author, friend (audience="friends"), or current squad member
   * - message: must be a current member of the conversation (live membership check)
   */
  async canUserViewReportedContent(
    contentType: "post" | "moment" | "message" | "photo" | "profile" | "idea",
    contentId: string,
    userId: string,
  ): Promise<boolean> {
    switch (contentType) {
      case "profile":
        return true;

      case "photo": {
        const numId = Number(contentId);
        if (Number.isNaN(numId)) return false;
        return this.canUserViewPhotoById(numId, userId);
      }

      case "post": {
        const [post] = await db
          .select({ authorId: feedPostsTable.authorId, audience: feedPostsTable.audience })
          .from(feedPostsTable)
          .where(and(eq(feedPostsTable.id, contentId), isNull(feedPostsTable.deletedAt)));
        if (!post) return false;
        if (post.authorId === userId) return true;
        if (post.audience === "friends") {
          const [row] = await db
            .select({ ownerId: friendshipsTable.ownerId })
            .from(friendshipsTable)
            .where(
              and(
                eq(friendshipsTable.ownerId, post.authorId),
                eq(friendshipsTable.friendId, userId),
              ),
            );
          return !!row;
        }
        return this.isSquadMember(post.audience, userId);
      }

      case "moment": {
        const [moment] = await db
          .select({ authorId: momentsTable.authorId, audience: momentsTable.audience })
          .from(momentsTable)
          .where(and(eq(momentsTable.id, contentId), isNull(momentsTable.deletedAt)));
        if (!moment) return false;
        if (moment.authorId === userId) return true;
        if (moment.audience === "friends") {
          const [row] = await db
            .select({ ownerId: friendshipsTable.ownerId })
            .from(friendshipsTable)
            .where(
              and(
                eq(friendshipsTable.ownerId, moment.authorId),
                eq(friendshipsTable.friendId, userId),
              ),
            );
          return !!row;
        }
        return this.isSquadMember(moment.audience, userId);
      }

      case "message": {
        const [msg] = await db
          .select({ conversationId: conversationMessagesTable.conversationId })
          .from(conversationMessagesTable)
          .where(eq(conversationMessagesTable.id, contentId));
        if (!msg) return false;
        // Deliberately membership-based, NOT canAccessConversation: this gates
        // whether you may REPORT a message, and the common abuse pattern is
        // "send something awful, then block/unfriend". Closing the DM must not
        // also close the report path for a message you legitimately received.
        const convo = await this.getConversationForMember(msg.conversationId, userId);
        return convo !== null;
      }

      case "idea": {
        const [idea] = await db
          .select({
            planId: planIdeasTable.planId,
            submittedByUserId: planIdeasTable.submittedByUserId,
          })
          .from(planIdeasTable)
          .where(eq(planIdeasTable.id, contentId));
        if (!idea) return false;
        if (idea.submittedByUserId === userId) return true;
        const [event] = await db
          .select()
          .from(eventsTable)
          .where(eq(eventsTable.id, idea.planId));
        if (!event) return false;
        if (event.hostId === userId) return true;
        if (((event.invitedUserIds ?? []) as string[]).includes(userId)) return true;
        if (event.squadId && (await this.isSquadMember(event.squadId, userId))) return true;
        // Plain events also grant access via an rsvp key; trips deliberately don't.
        if (event.type !== "trip" && userId in ((event.rsvps ?? {}) as Record<string, string>)) {
          return true;
        }
        return false;
      }

      default:
        return false;
    }
  }

  // ---- Per-squad notification mutes ----

  /**
   * Returns all squads the given user has muted, with id, name, and emoji.
   * Used by the notifications settings screen to show a "Muted Squads" list.
   */
  async getMutedSquadsForUser(userId: string): Promise<{ id: string; name: string; emoji: string }[]> {
    const rows = await db
      .select({ id: squadsTable.id, name: squadsTable.name, emoji: squadsTable.emoji })
      .from(squadMutesTable)
      .innerJoin(squadsTable, eq(squadMutesTable.squadId, squadsTable.id))
      .where(eq(squadMutesTable.userId, userId))
      .orderBy(squadsTable.name);
    return rows;
  }

  /** Returns true if the given user has muted squad-join notifications for this squad. */
  async isSquadMutedForUser(squadId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ userId: squadMutesTable.userId })
      .from(squadMutesTable)
      .where(and(eq(squadMutesTable.squadId, squadId), eq(squadMutesTable.userId, userId)));
    return Boolean(row);
  }

  /** Mutes or unmutes squad-join notifications for a user+squad pair. */
  async setSquadMute(userId: string, squadId: string, muted: boolean): Promise<void> {
    if (muted) {
      await db
        .insert(squadMutesTable)
        .values({ userId, squadId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(squadMutesTable)
        .where(and(eq(squadMutesTable.userId, userId), eq(squadMutesTable.squadId, squadId)));
    }
  }

  /** Returns all squad IDs that the given user has muted. */
  async getMutedSquadIdsForUser(userId: string): Promise<string[]> {
    const rows = await db
      .select({ squadId: squadMutesTable.squadId })
      .from(squadMutesTable)
      .where(eq(squadMutesTable.userId, userId));
    return rows.map((r) => r.squadId);
  }

  /**
   * Returns the subset of `userIds` that have NOT muted this squad.
   * Used to filter push-notification recipients in the join/add handlers.
   */
  async filterUnmutedForSquad(userIds: string[], squadId: string): Promise<string[]> {
    if (userIds.length === 0) return [];
    const muted = await db
      .select({ userId: squadMutesTable.userId })
      .from(squadMutesTable)
      .where(
        and(
          eq(squadMutesTable.squadId, squadId),
          inArray(squadMutesTable.userId, userIds),
        ),
      );
    const mutedSet = new Set(muted.map((r) => r.userId));
    return userIds.filter((id) => !mutedSet.has(id));
  }

  // ---- Push tokens ----

  async savePushToken(userId: string, token: string): Promise<void> {
    await db
      .update(usersTable)
      .set({ pushToken: token })
      .where(eq(usersTable.id, userId));
  }

  async getPushToken(userId: string): Promise<string | null> {
    const rows = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    return rows[0]?.pushToken ?? null;
  }

  async clearPushTokenForUser(userId: string): Promise<void> {
    await db
      .update(usersTable)
      .set({ pushToken: null })
      .where(eq(usersTable.id, userId));
  }

  async clearPushToken(token: string): Promise<void> {
    await db
      .update(usersTable)
      .set({ pushToken: null })
      .where(eq(usersTable.pushToken, token));
  }

  async getPushTokensForUsers(
    userIds: string[],
    opts: {
      requireNotifyReminders?: boolean;
      requireNotifySquadJoin?: boolean;
      requireNotifySquadLeave?: boolean;
      requireNotifyMessages?: boolean;
      requireNotifyEventInvites?: boolean;
      requireNotifyFriendActivity?: boolean;
      requireNotifyPayments?: boolean;
    } = {},
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const conditions = [inArray(usersTable.id, userIds)];
    if (opts.requireNotifyReminders) {
      conditions.push(eq(usersTable.notifyReminders, true));
    }
    if (opts.requireNotifySquadJoin) {
      conditions.push(eq(usersTable.notifySquadJoin, true));
    }
    if (opts.requireNotifySquadLeave) {
      conditions.push(eq(usersTable.notifySquadLeave, true));
    }
    if (opts.requireNotifyMessages) {
      conditions.push(eq(usersTable.notifyMessages, true));
    }
    if (opts.requireNotifyEventInvites) {
      conditions.push(eq(usersTable.notifyEventInvites, true));
    }
    if (opts.requireNotifyFriendActivity) {
      conditions.push(eq(usersTable.notifyFriendActivity, true));
    }
    if (opts.requireNotifyPayments) {
      conditions.push(eq(usersTable.notifyPayments, true));
    }
    const rows = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(and(...conditions));
    return rows.map((r) => r.pushToken).filter((t): t is string => Boolean(t));
  }

  /**
   * Same filtering as getPushTokensForUsers, but returns each recipient's
   * effective display timezone alongside their token so notification copy can
   * be composed in the *reader's* local time rather than one shared string.
   *
   * `timezone` is null when the user has never had one resolved; callers fall
   * back to the event's stored timezone (the creator's) for those recipients.
   */
  async getPushRecipientsForUsers(
    userIds: string[],
    opts: {
      requireNotifyReminders?: boolean;
      requireNotifySquadJoin?: boolean;
      requireNotifySquadLeave?: boolean;
      requireNotifyMessages?: boolean;
      requireNotifyEventInvites?: boolean;
      requireNotifyFriendActivity?: boolean;
      requireNotifyPayments?: boolean;
    } = {},
  ): Promise<Array<{ userId: string; pushToken: string; timezone: string | null }>> {
    if (userIds.length === 0) return [];
    const conditions = [inArray(usersTable.id, userIds)];
    if (opts.requireNotifyReminders) conditions.push(eq(usersTable.notifyReminders, true));
    if (opts.requireNotifySquadJoin) conditions.push(eq(usersTable.notifySquadJoin, true));
    if (opts.requireNotifySquadLeave) conditions.push(eq(usersTable.notifySquadLeave, true));
    if (opts.requireNotifyMessages) conditions.push(eq(usersTable.notifyMessages, true));
    if (opts.requireNotifyEventInvites) conditions.push(eq(usersTable.notifyEventInvites, true));
    if (opts.requireNotifyFriendActivity) conditions.push(eq(usersTable.notifyFriendActivity, true));
    if (opts.requireNotifyPayments) conditions.push(eq(usersTable.notifyPayments, true));
    const rows = await db
      .select({
        userId: usersTable.id,
        pushToken: usersTable.pushToken,
        timezone: usersTable.timezone,
      })
      .from(usersTable)
      .where(and(...conditions));
    return rows
      .filter((r): r is { userId: string; pushToken: string; timezone: string | null } =>
        Boolean(r.pushToken))
      .map((r) => ({ userId: r.userId, pushToken: r.pushToken, timezone: r.timezone ?? null }));
  }

  /**
   * Events eligible for an automatic "starting soon" reminder scan: not
   * cancelled, no reminder sent yet, and with a concrete (non-TBD) date string.
   * The caller best-effort parses the free-form `date` text to decide whether
   * the event falls inside the reminder window.
   */
  async getEventsPendingReminder(): Promise<DbEvent[]> {
    return db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.cancelled, false),
          isNull(eventsTable.reminderSentAt),
          ne(eventsTable.date, ""),
          ne(eventsTable.date, "TBD"),
          // SQL-level time-window guard: skip events whose machine-readable
          // eventAt is more than 2 h in the future (the reminder lead window).
          // Events with no eventAt (TBD / text-only date) are kept for the
          // JS-level text parser. Bounds the SELECT as the events table grows.
          or(isNull(eventsTable.eventAt), sql`${eventsTable.eventAt} <= NOW() + interval '2 hours'`),
        ),
      );
  }

  /** Mark an event as having had its automatic reminder sent (fire-once).
   *  Use for retirement (past events) only. For live sends, use
   *  tryClaimEventReminderSend / unclaimEventReminderSend instead. */
  async markEventReminderSent(eventId: string): Promise<void> {
    await db
      .update(eventsTable)
      .set({ reminderSentAt: new Date() })
      .where(eq(eventsTable.id, eventId));
  }

  /**
   * Atomically claim the reminder-send slot for this instance.
   *
   * Sets reminderSentAt = NOW() only when it is still NULL, preventing a
   * second concurrent instance from claiming the same event. Returns true if
   * this caller won; false if another instance beat it (caller should skip).
   */
  async tryClaimEventReminderSend(eventId: string): Promise<boolean> {
    const [row] = await db
      .update(eventsTable)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(eventsTable.id, eventId), isNull(eventsTable.reminderSentAt)))
      .returning({ id: eventsTable.id });
    return Boolean(row);
  }

  /** Clear the reminder sent marker so the next scan can retry.
   *  Called when the send fails after a successful claim. */
  async unclaimEventReminderSend(eventId: string): Promise<void> {
    await db
      .update(eventsTable)
      .set({ reminderSentAt: null })
      .where(eq(eventsTable.id, eventId));
  }

  /** Events eligible for the 3-day-out heads-up reminder (fire-once via
   *  threeDayReminderSentAt). Only returns events whose toggle is on. */
  async getEventsPending3DayReminder(): Promise<DbEvent[]> {
    return db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.cancelled, false),
          eq(eventsTable.remind3DaysToggle, true),
          isNull(eventsTable.threeDayReminderSentAt),
          ne(eventsTable.date, ""),
          ne(eventsTable.date, "TBD"),
          // SQL-level guard is deliberately broader than the calendar-day
          // window. Around DST, three calendar days can exceed 72 elapsed
          // hours; the scanner applies the timezone-aware exact check.
          // Events without eventAt are kept for JS parsing.
          or(isNull(eventsTable.eventAt), sql`${eventsTable.eventAt} <= NOW() + interval '96 hours'`),
        ),
      );
  }

  async markEvent3DayReminderSent(eventId: string): Promise<void> {
    await db
      .update(eventsTable)
      .set({ threeDayReminderSentAt: new Date() })
      .where(eq(eventsTable.id, eventId));
  }

  async tryClaimEvent3DayReminderSend(eventId: string): Promise<boolean> {
    const [row] = await db
      .update(eventsTable)
      .set({ threeDayReminderSentAt: new Date() })
      .where(and(eq(eventsTable.id, eventId), isNull(eventsTable.threeDayReminderSentAt)))
      .returning({ id: eventsTable.id });
    return Boolean(row);
  }

  async unclaimEvent3DayReminderSend(eventId: string): Promise<void> {
    await db
      .update(eventsTable)
      .set({ threeDayReminderSentAt: null })
      .where(eq(eventsTable.id, eventId));
  }

  /** Stamp the cooldown time for a manual host/co-admin reminder. Each type
   *  ("general" or "rsvp") has its own independent cooldown column so firing
   *  one doesn't block the other. */
  async markManualReminderSent(eventId: string, type: 'general' | 'rsvp'): Promise<void> {
    const field =
      type === 'general'
        ? { manualReminderGeneralSentAt: new Date() }
        : { manualReminderRsvpSentAt: new Date() };
    await db.update(eventsTable).set(field).where(eq(eventsTable.id, eventId));
  }

  /**
   * BUG-03: atomic cooldown check-and-set.  Instead of the caller reading
   * `sentAt`, checking the elapsed time, then updating in a separate statement
   * (a classic TOCTOU race that two concurrent co-admin calls can both pass),
   * we push the whole check into the WHERE clause of a single UPDATE.
   *
   * Only one concurrent caller can win — the second UPDATE finds no eligible
   * row (because the winner has already written a `sentAt` within the cooldown
   * window) and gets back an empty RETURNING set.
   *
   * Returns `{ won: true }` for the winner and
   * `{ won: false, retryAfterMs }` for the loser.
   */
  async markManualReminderSentAtomic(
    eventId: string,
    type: 'general' | 'rsvp',
    cooldownMs: number,
  ): Promise<{ won: boolean; retryAfterMs?: number }> {
    const now = new Date();
    const threshold = new Date(now.getTime() - cooldownMs);
    const field =
      type === 'general'
        ? { manualReminderGeneralSentAt: now }
        : { manualReminderRsvpSentAt: now };
    const sentAtCol =
      type === 'general' ? eventsTable.manualReminderGeneralSentAt : eventsTable.manualReminderRsvpSentAt;

    const [updated] = await db
      .update(eventsTable)
      .set(field)
      .where(
        and(
          eq(eventsTable.id, eventId),
          or(isNull(sentAtCol), lt(sentAtCol, threshold)),
        ),
      )
      .returning({ sentAt: sentAtCol });

    if (updated) return { won: true };

    // Lost the race — compute how long the caller should wait.
    const [current] = await db
      .select({ sentAt: sentAtCol })
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId));
    const retryAfterMs = current?.sentAt
      ? Math.max(0, cooldownMs - (Date.now() - new Date(current.sentAt as Date).getTime()))
      : 0;
    return { won: false, retryAfterMs };
  }

  /** Stamp the current time as the last poll-update notification timestamp.
   *  Call AFTER a successful push fan-out so a server restart in between
   *  doesn't prevent the next push from going out. */
  async markPollUpdateNotified(pollId: string): Promise<void> {
    await db
      .update(availabilityPollsTable)
      .set({ pollUpdateNotifiedAt: new Date() })
      .where(eq(availabilityPollsTable.id, pollId));
  }

  /** Events eligible for a post-event "drop your photos" recap prompt
   *  (fire-once via recapPromptSentAt). */
  async getEventsPendingRecap(): Promise<DbEvent[]> {
    return db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.cancelled, false),
          isNull(eventsTable.recapPromptSentAt),
          ne(eventsTable.date, ""),
          ne(eventsTable.date, "TBD"),
          // SQL-level guard: recap timing uses a trip's end when present and
          // otherwise its event start. Rows without either timestamp stay in
          // the candidate set for JS-level legacy display-date parsing.
          or(
            and(isNull(eventsTable.endAt), isNull(eventsTable.eventAt)),
            sql`COALESCE(${eventsTable.endAt}, ${eventsTable.eventAt}) <= NOW() - interval '3 hours'`,
          ),
        ),
      );
  }

  async markEventRecapSent(eventId: string): Promise<void> {
    await db
      .update(eventsTable)
      .set({ recapPromptSentAt: new Date() })
      .where(eq(eventsTable.id, eventId));
  }

  async tryClaimEventRecapSend(eventId: string): Promise<boolean> {
    const [row] = await db
      .update(eventsTable)
      .set({ recapPromptSentAt: new Date() })
      .where(and(eq(eventsTable.id, eventId), isNull(eventsTable.recapPromptSentAt)))
      .returning({ id: eventsTable.id });
    return Boolean(row);
  }

  async unclaimEventRecapSend(eventId: string): Promise<void> {
    await db
      .update(eventsTable)
      .set({ recapPromptSentAt: null })
      .where(eq(eventsTable.id, eventId));
  }

  /** Availability polls that have not yet had their automatic "almost there"
   *  organizer nudge sent (fire-once via nudgeSentAt). Only returns polls in
   *  the eligible age window [2h, 7d] so the SELECT stays bounded. */
  async getPollsPendingNudge(): Promise<AvailabilityPoll[]> {
    return db
      .select()
      .from(availabilityPollsTable)
      .where(
        and(
          isNull(availabilityPollsTable.nudgeSentAt),
          // SQL-level age window matching POLL_NUDGE_MIN_AGE_MS (2h) and
          // POLL_NUDGE_MAX_AGE_MS (7d). Polls outside this range are either
          // too new (skip) or too old (JS retires them); both are harmless to
          // exclude from the SELECT. Bounds the scan as polls accumulate.
          sql`${availabilityPollsTable.createdAt} <= NOW() - interval '2 hours'`,
          sql`${availabilityPollsTable.createdAt} >= NOW() - interval '7 days'`,
        ),
      );
  }

  async markPollNudgeSent(pollId: string): Promise<void> {
    await db
      .update(availabilityPollsTable)
      .set({ nudgeSentAt: new Date() })
      .where(eq(availabilityPollsTable.id, pollId));
  }

  async tryClaimPollNudgeSend(pollId: string): Promise<boolean> {
    const [row] = await db
      .update(availabilityPollsTable)
      .set({ nudgeSentAt: new Date() })
      .where(and(eq(availabilityPollsTable.id, pollId), isNull(availabilityPollsTable.nudgeSentAt)))
      .returning({ id: availabilityPollsTable.id });
    return Boolean(row);
  }

  async unclaimPollNudgeSend(pollId: string): Promise<void> {
    await db
      .update(availabilityPollsTable)
      .set({ nudgeSentAt: null })
      .where(eq(availabilityPollsTable.id, pollId));
  }

  /** Best-effort invitee roster for a poll, used to compute response ratios for
   *  the automatic organizer nudge. Ad-hoc polls use their explicit
   *  participantIds; squad polls use current squad membership; event polls use
   *  the event's RSVP keys plus its host. Returns [] when it can't be derived. */
  async getAvailabilityPollRoster(poll: AvailabilityPoll): Promise<string[]> {
    const ids = new Set<string>();
    if (Array.isArray(poll.participantIds) && poll.participantIds.length > 0) {
      for (const id of poll.participantIds) ids.add(id);
    }
    if (poll.squadId) {
      const squad = await this.getSquad(poll.squadId);
      for (const id of ((squad?.memberIds ?? []) as string[])) ids.add(id);
    }
    if (poll.eventId) {
      const event = await this.getEvent(poll.eventId);
      if (event) {
        ids.add(event.hostId);
        for (const uid of Object.keys((event.rsvps ?? {}) as Record<string, string>)) ids.add(uid);
      }
    }
    return [...ids];
  }

  async storePushTicket(ticketId: string, pushToken: string): Promise<void> {
    await db
      .insert(pushTicketsTable)
      .values({ ticketId, pushToken })
      .onConflictDoNothing();
  }

  async deletePushTickets(ticketIds: string[]): Promise<void> {
    if (ticketIds.length === 0) return;
    await db
      .delete(pushTicketsTable)
      .where(inArray(pushTicketsTable.ticketId, ticketIds));
  }

  async loadAllPushTickets(): Promise<Map<string, string>> {
    // Expo push receipts expire after ~24 h. Tickets older than 48 h can never
    // produce a useful receipt check; loading them wastes memory and startup
    // time proportionally to historical push volume. Bound by the indexed
    // createdAt column so cost scales with recent activity, not total history.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(pushTicketsTable)
      .where(gte(pushTicketsTable.createdAt, cutoff));
    return new Map(rows.map((r) => [r.ticketId, r.pushToken]));
  }

  /**
   * Insert multiple push tickets in sequential chunks.
   * Keeps per-query row counts reasonable and bounds the pool usage from a
   * large fan-out (500 recipients → 10 sequential INSERTs of 50 rows each,
   * rather than 500 concurrent fire-and-forget single-row INSERTs).
   */
  async storePushTicketsBatch(
    tickets: Array<{ ticketId: string; pushToken: string }>,
  ): Promise<void> {
    if (tickets.length === 0) return;
    const CHUNK = 50;
    for (let i = 0; i < tickets.length; i += CHUNK) {
      await db
        .insert(pushTicketsTable)
        .values(tickets.slice(i, i + CHUNK))
        .onConflictDoNothing();
    }
  }

  /**
   * Record deliveries still owed to specific devices after a partial send.
   *
   * Keyed by (dedupeKey, pushToken): re-enqueueing the same failure updates the
   * existing row instead of stacking a second alert for that device.
   */
  async enqueuePushRetries(
    entries: Array<{
      dedupeKey: string;
      pushToken: string;
      payload: { title: string; body: string; data?: Record<string, unknown> };
      nextAttemptAt: Date;
      lastError?: string | null;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const CHUNK = 50;
    for (let i = 0; i < entries.length; i += CHUNK) {
      await db
        .insert(pushRetriesTable)
        .values(
          entries.slice(i, i + CHUNK).map((e) => ({
            id: randomUUID(),
            dedupeKey: e.dedupeKey,
            pushToken: e.pushToken,
            payload: e.payload,
            attempts: 0,
            lastError: e.lastError ?? null,
            nextAttemptAt: e.nextAttemptAt,
          })),
        )
        .onConflictDoUpdate({
          target: [pushRetriesTable.dedupeKey, pushRetriesTable.pushToken],
          set: {
            nextAttemptAt: sql`excluded.next_attempt_at`,
            lastError: sql`excluded.last_error`,
          },
        });
    }
  }

  /** Owed deliveries whose backoff has elapsed, oldest first. */
  async getDuePushRetries(limit = 200): Promise<
    Array<{
      id: string;
      dedupeKey: string;
      pushToken: string;
      payload: { title: string; body: string; data?: Record<string, unknown> };
      attempts: number;
    }>
  > {
    const rows = await db
      .select()
      .from(pushRetriesTable)
      .where(lte(pushRetriesTable.nextAttemptAt, new Date()))
      .orderBy(asc(pushRetriesTable.nextAttemptAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      dedupeKey: r.dedupeKey,
      pushToken: r.pushToken,
      payload: r.payload,
      attempts: r.attempts,
    }));
  }

  /** Delivered, or permanently given up — either way the device is no longer owed. */
  async deletePushRetries(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.delete(pushRetriesTable).where(inArray(pushRetriesTable.id, ids));
  }

  /** Still failing: bump the attempt counter and push the next try out. */
  async reschedulePushRetry(
    id: string,
    nextAttemptAt: Date,
    lastError: string | null,
  ): Promise<void> {
    await db
      .update(pushRetriesTable)
      .set({ attempts: sql`${pushRetriesTable.attempts} + 1`, nextAttemptAt, lastError })
      .where(eq(pushRetriesTable.id, id));
  }

  /** Drop everything owed to a device that no longer exists. */
  async deletePushRetriesForToken(pushToken: string): Promise<void> {
    await db.delete(pushRetriesTable).where(eq(pushRetriesTable.pushToken, pushToken));
  }
}

export const storage = new Storage();
