import { usersTable, eventsTable, photosTable } from '@workspace/db/schema';
import { eq, sql, count } from 'drizzle-orm';
import { db } from '@workspace/db';

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

  async countUserEvents(hostId: string): Promise<number> {
    const [row] = await db
      .select({ total: count() })
      .from(eventsTable)
      .where(eq(eventsTable.hostId, hostId));
    return row?.total ?? 0;
  }

  async createEvent(hostId: string, title: string) {
    const [event] = await db
      .insert(eventsTable)
      .values({ hostId, title })
      .returning();
    return event;
  }

  async getEvent(eventId: number) {
    const [event] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId));
    return event ?? null;
  }

  async getPhotosByEventId(eventId: number) {
    return db
      .select()
      .from(photosTable)
      .where(eq(photosTable.eventId, eventId));
  }
}

export const storage = new Storage();
