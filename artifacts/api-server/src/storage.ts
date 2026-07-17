import {
  usersTable,
  eventsTable,
  eventCreationsTable,
  photosTable,
  squadsTable,
  squadMutesTable,
  availabilityPollsTable,
  availabilityResponsesTable,
  availabilityNudgesTable,
  waitlistTable,
  conversationsTable,
  conversationParticipantsTable,
  conversationMessagesTable,
  pushTicketsTable,
  feedPostsTable,
  momentsTable,
  friendshipsTable,
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
import { eq, sql, count, and, or, gte, lt, desc, asc, inArray, ne, isNull } from 'drizzle-orm';
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
  mediaType: photosTable.mediaType,
  caption: photosTable.caption,
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
   */
  async setSquadzPlus(userId: string, isSquadzPlus: boolean) {
    const [user] = await db
      .update(usersTable)
      .set({ isSquadzPlus })
      .where(eq(usersTable.id, userId))
      .returning();
    return user;
  }

  /**
   * Count events a user created within the trailing 12-month window, read from
   * the append-only `event_creations` ledger. Because ledger rows are never
   * deleted, deleting an event does NOT free a slot — a slot only frees once its
   * ledger row ages out past 12 months. This backs the free-tier event cap.
   */
  async countUserEventCreationsInWindow(userId: string): Promise<number> {
    const windowStart = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ total: count() })
      .from(eventCreationsTable)
      .where(
        and(
          eq(eventCreationsTable.userId, userId),
          gte(eventCreationsTable.createdAt, windowStart),
        ),
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
  }): Promise<AvailabilityPoll> {
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

  /**
   * List ACTIVE (not-yet-converted) polls for the "Existing" chooser.
   * - squadId → all squad-scoped polls for that squad (eventId IS NULL).
   * - createdBy (no squadId) → the caller's personal/ad-hoc polls
   *   (squadId & eventId both NULL). Converted polls are always excluded.
   */
  async listAvailabilityPolls(opts: {
    squadId?: string;
    createdBy?: string;
  }): Promise<AvailabilityPoll[]> {
    const conds = [isNull(availabilityPollsTable.convertedEventId)];
    if (opts.squadId) {
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

  /** Hard-delete a poll. Responses and nudges cascade via FK. Creator-only
   *  gating is enforced at the route layer. */
  async deleteAvailabilityPoll(pollId: string): Promise<void> {
    await db.delete(availabilityPollsTable).where(eq(availabilityPollsTable.id, pollId));
  }

  /** Mark a poll converted into a concrete event/trip so it drops out of the
   *  "Existing" chooser. */
  async markAvailabilityPollConverted(pollId: string, eventId: string): Promise<void> {
    await db
      .update(availabilityPollsTable)
      .set({ convertedEventId: eventId })
      .where(eq(availabilityPollsTable.id, pollId));
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
    // Non-squad polls are open to any authenticated user who has the poll ID.
    // The UUID acts as the access token for invite-by-link sharing.
    if (!poll.squadId) return true;
    return false;
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

  /** Records a new nudge from `fromUserId` → `toUserId` in this poll. */
  async createNudge(pollId: string, fromUserId: string, toUserId: string): Promise<void> {
    await db
      .insert(availabilityNudgesTable)
      .values({ pollId, fromUserId, toUserId });
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
        ),
      );
  }

  /** Mark an event as having had its automatic reminder sent (fire-once). */
  async markEventReminderSent(eventId: string): Promise<void> {
    await db
      .update(eventsTable)
      .set({ reminderSentAt: new Date() })
      .where(eq(eventsTable.id, eventId));
  }

  /** Events eligible for a "day-of" heads-up reminder (fire-once via
   *  dayOfReminderSentAt). Same date-parseability gate as the soon reminder. */
  async getEventsPendingDayOfReminder(): Promise<DbEvent[]> {
    return db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.cancelled, false),
          isNull(eventsTable.dayOfReminderSentAt),
          ne(eventsTable.date, ""),
          ne(eventsTable.date, "TBD"),
        ),
      );
  }

  async markEventDayOfReminderSent(eventId: string): Promise<void> {
    await db
      .update(eventsTable)
      .set({ dayOfReminderSentAt: new Date() })
      .where(eq(eventsTable.id, eventId));
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
        ),
      );
  }

  async markEventRecapSent(eventId: string): Promise<void> {
    await db
      .update(eventsTable)
      .set({ recapPromptSentAt: new Date() })
      .where(eq(eventsTable.id, eventId));
  }

  /** Availability polls that have not yet had their automatic "almost there"
   *  organizer nudge sent (fire-once via nudgeSentAt). */
  async getPollsPendingNudge(): Promise<AvailabilityPoll[]> {
    return db
      .select()
      .from(availabilityPollsTable)
      .where(isNull(availabilityPollsTable.nudgeSentAt));
  }

  async markPollNudgeSent(pollId: string): Promise<void> {
    await db
      .update(availabilityPollsTable)
      .set({ nudgeSentAt: new Date() })
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
    const rows = await db.select().from(pushTicketsTable);
    return new Map(rows.map((r) => [r.ticketId, r.pushToken]));
  }
}

export const storage = new Storage();
