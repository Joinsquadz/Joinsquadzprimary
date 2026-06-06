import { getStripeSync } from './stripeClient';
import { storage } from './storage';
import { logger } from './lib/logger';
import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';

async function getManagedWebhookSecret(): Promise<string | null> {
  try {
    const result = await db.execute(
      sql`SELECT secret FROM stripe._managed_webhooks LIMIT 1`
    );
    return (result.rows[0]?.secret as string) ?? null;
  } catch {
    return null;
  }
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    // stripe-replit-sync syncs the event data into stripe.* tables
    const sync = await getStripeSync();

    // Before handing off, attempt to parse the event for user linkage.
    // We read the managed webhook secret from the DB (set by findOrCreateManagedWebhook).
    let customerId: string | null = null;
    let subscriptionId: string | null = null;

    try {
      const webhookSecret = await getManagedWebhookSecret();
      if (webhookSecret) {
        const { Stripe } = await import('stripe');
        const rawStripe = new Stripe('placeholder');
        const event = await rawStripe.webhooks.constructEventAsync(
          payload,
          signature,
          webhookSecret
        );

        if (
          event.type === 'customer.subscription.created' ||
          event.type === 'customer.subscription.updated' ||
          event.type === 'customer.subscription.deleted'
        ) {
          const sub = event.data.object as { id: string; customer: string | { id: string } };
          subscriptionId = sub.id;
          customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        } else if (event.type === 'checkout.session.completed') {
          const session = event.data.object as {
            customer: string | null;
            subscription: string | null;
          };
          customerId = session.customer;
          subscriptionId = session.subscription;
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Could not parse webhook event for user linkage');
    }

    await sync.processWebhook(payload, signature);

    // Link subscription back to the user record so GET /api/subscription is accurate
    if (customerId && subscriptionId) {
      try {
        const user = await storage.getUserByStripeCustomerId(customerId);
        if (user) {
          await storage.updateUserStripeInfo(user.id, { stripeSubscriptionId: subscriptionId });
          logger.info({ userId: user.id, subscriptionId }, 'Linked subscription to user');
        }
      } catch (err) {
        logger.warn({ err, customerId, subscriptionId }, 'Could not link subscription to user');
      }
    }
  }
}
