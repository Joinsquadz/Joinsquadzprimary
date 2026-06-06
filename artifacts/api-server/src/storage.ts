import { usersTable, eventsTable, photosTable, squadsTable, type Photo } from '@workspace/db/schema';
import { eq, sql, count, and, gte, lt, desc, inArray } from 'drizzle-orm';
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

  async getPhotosByEventId(eventId: string): Promise<Photo[]> {
    return db
      .select()
      .from(photosTable)
      .where(eq(photosTable.eventId, eventId));
  }

  async getPhotosByUploaderId(uploaderId: string): Promise<Photo[]> {
    return db
      .select()
      .from(photosTable)
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
  ): Promise<{ photos: Photo[]; authorized: boolean }> {
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
      .select()
      .from(photosTable)
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
}

export const storage = new Storage();
