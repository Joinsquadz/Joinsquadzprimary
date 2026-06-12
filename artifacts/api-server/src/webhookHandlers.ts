import { getStripeSync } from './stripeClient';
import { storage } from './storage';
import { logger } from './lib/logger';
import { emailService } from './emailService';
import { redeemFoundingSpot } from './lib/founding';
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
    let isCheckoutCompleted = false;
    let checkoutTier: string | null = null;
    let invoicePaymentSucceededId: string | null = null;
    let invoicePaymentSucceededCustomerId: string | null = null;
    let invoicePaymentFailedId: string | null = null;
    let invoicePaymentFailedCustomerId: string | null = null;

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
            metadata: Record<string, string> | null;
          };
          customerId = session.customer;
          subscriptionId = session.subscription;
          checkoutTier = session.metadata?.tier ?? null;
          isCheckoutCompleted = true;
        } else if (event.type === 'invoice.payment_succeeded') {
          const invoice = event.data.object as unknown as {
            id: string;
            customer: string | { id: string } | null;
            subscription: string | null;
            billing_reason: string | null;
          };
          const cid = invoice.customer;
          const resolvedCustomerId = cid
            ? (typeof cid === 'string' ? cid : cid.id)
            : null;
          // Only send renewal receipts, not the initial subscription invoice
          // (which is covered by the checkout.session.completed welcome email)
          if (invoice.billing_reason === 'subscription_cycle' && resolvedCustomerId) {
            invoicePaymentSucceededId = invoice.id;
            invoicePaymentSucceededCustomerId = resolvedCustomerId;
          }
        } else if (event.type === 'invoice.payment_failed') {
          const invoice = event.data.object as {
            id: string;
            customer: string | { id: string } | null;
          };
          const cid = invoice.customer;
          const resolvedCustomerId = cid
            ? (typeof cid === 'string' ? cid : cid.id)
            : null;
          if (resolvedCustomerId) {
            invoicePaymentFailedId = invoice.id;
            invoicePaymentFailedCustomerId = resolvedCustomerId;
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Could not parse webhook event for user linkage');
    }

    // Sync Stripe data into the stripe.* schema tables (must happen before we query them)
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

    // Consume a Founding Member spot ONLY now that payment has actually
    // succeeded, and only for a founding-tier purchase. Idempotent per
    // subscription id, so Stripe re-delivering this event can't double-count.
    // On a transient failure we rethrow so the webhook returns non-2xx and
    // Stripe retries — because the redemption is idempotent, a retry can never
    // double-count, but without it a paid founding checkout would silently lose
    // its spot forever.
    if (isCheckoutCompleted && subscriptionId && checkoutTier === 'founding') {
      try {
        const consumed = await redeemFoundingSpot(subscriptionId);
        if (consumed) {
          logger.info({ subscriptionId }, 'Redeemed a founding member spot');
        }
      } catch (err) {
        logger.error(
          { err, subscriptionId },
          'Founding spot redemption failed — failing webhook so Stripe retries',
        );
        throw err;
      }
    }

    // Send the Pro welcome email on successful checkout.
    // This runs after sync.processWebhook so subscription/price data are in the DB.
    if (isCheckoutCompleted && subscriptionId && customerId) {
      await emailService.sendProWelcome(subscriptionId, customerId);
    }

    // Send renewal receipt on successful subscription renewal payment.
    if (invoicePaymentSucceededId && invoicePaymentSucceededCustomerId) {
      await emailService.sendRenewalReceipt(
        invoicePaymentSucceededId,
        invoicePaymentSucceededCustomerId
      );
    }

    // Send payment failure warning so the user can update their card.
    if (invoicePaymentFailedId && invoicePaymentFailedCustomerId) {
      await emailService.sendPaymentFailed(
        invoicePaymentFailedId,
        invoicePaymentFailedCustomerId
      );
    }
  }
}
