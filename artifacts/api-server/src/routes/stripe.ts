import { Router, type IRouter } from 'express';
import { storage } from '../storage';
import { stripeService } from '../stripeService';
import { requireAuth } from '../middleware/currentUser';
import { logger } from '../lib/logger';
import { buildProWelcomeHtml } from '../emailService';
import { getBaseUrl } from '../lib/urls';
import { trackEvent } from '../services/analytics';
import { claimCheckoutTier, priceIdForTier, getFoundingStatus } from '../lib/founding';

const router: IRouter = Router();

// Public, no-auth: how many Founding Member spots remain. Drives the landing
// page price + the in-app upgrade modal. Read-only — never claims a spot.
router.get('/subscription/founding-status', async (_req, res): Promise<void> => {
  try {
    const status = await getFoundingStatus();
    res.json(status);
  } catch (err) {
    logger.error({ err }, 'Error fetching founding status');
    res.status(500).json({ error: 'Failed to fetch founding status' });
  }
});

// Products endpoint is public — listing plans is safe
router.get('/products-with-prices', async (_req, res): Promise<void> => {
  try {
    const rows = await storage.listProductsWithPrices();

    const productsMap = new Map<string, {
      id: string;
      name: string;
      description: string | null;
      active: boolean;
      prices: Array<{ id: string; unit_amount: number; currency: string; recurring: unknown; active: boolean }>;
    }>();

    for (const row of rows) {
      if (!productsMap.has(row.product_id as string)) {
        productsMap.set(row.product_id as string, {
          id: row.product_id as string,
          name: row.product_name as string,
          description: row.product_description as string | null,
          active: row.product_active as boolean,
          prices: [],
        });
      }
      if (row.price_id) {
        productsMap.get(row.product_id as string)!.prices.push({
          id: row.price_id as string,
          unit_amount: row.unit_amount as number,
          currency: row.currency as string,
          recurring: row.recurring,
          active: row.price_active as boolean,
        });
      }
    }

    res.json({ data: Array.from(productsMap.values()) });
  } catch (err) {
    logger.error({ err }, 'Error fetching products with prices');
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// All billing endpoints require authentication.
// User identity comes from the session (set by authMiddleware), never from the client.
router.post('/checkout', requireAuth, async (req, res): Promise<void> => {
  try {
    // The client no longer chooses the price — the server decides the tier
    // (founding vs standard) atomically and picks the matching price id from
    // env. Any priceId in the body is ignored on purpose so a client can't
    // self-select the cheaper founding price after the spots are gone.
    // requireAuth guarantees req.user is defined
    const { id: userId, email } = req.user!;

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, email ?? '');
    }

    // Block checkout if user already has an active subscription
    if (user.stripeSubscriptionId) {
      const existingSub = await storage.getSubscription(user.stripeSubscriptionId);
      if (existingSub?.status === 'active' || existingSub?.status === 'trialing') {
        res.status(400).json({ error: 'You already have an active Squadz Pro subscription' });
        return;
      }
    } else if (user.stripeCustomerId) {
      const existingSub = await storage.getActiveSubscriptionByCustomerId(user.stripeCustomerId);
      if (existingSub) {
        res.status(400).json({ error: 'You already have an active Squadz Pro subscription' });
        return;
      }
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeService.createCustomer(email ?? userId, userId);
      user = await storage.updateUserStripeInfo(userId, { stripeCustomerId: customer.id });
      customerId = customer.id;
    }

    if (!user.emailVerified) {
      res.status(403).json({
        error: 'Please verify your email address before subscribing. Check your inbox for a verification link.',
        requiresEmailVerification: true,
      });
      return;
    }

    // Server decides the tier atomically: claims a founding spot if any remain
    // (incrementing the counter under an advisory lock), else falls back to
    // standard. The matching price id comes from server env, never the client.
    const tier = await claimCheckoutTier();
    const priceId = priceIdForTier(tier);

    const baseUrl = getBaseUrl();
    const session = await stripeService.createCheckoutSession(
      customerId!,
      priceId,
      `${baseUrl}/home?checkout=success`,
      `${baseUrl}/home?checkout=cancel`,
    );

    trackEvent(userId, 'checkout_started', { priceId, tier });
    res.json({ url: session.url, tier, priceId });
  } catch (err) {
    logger.error({ err }, 'Error creating checkout session');
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.get('/subscription', requireAuth, async (req, res): Promise<void> => {
  try {
    const { id: userId } = req.user!;

    const user = await storage.getUser(userId);
    if (!user) {
      res.json({ subscription: null, isPro: false });
      return;
    }

    // Primary: check stored subscriptionId (set by webhook linkage)
    if (user.stripeSubscriptionId) {
      const subscription = await storage.getSubscription(user.stripeSubscriptionId);
      const isPro = subscription?.status === 'active' || subscription?.status === 'trialing';
      res.json({ subscription, isPro: !!isPro });
      return;
    }

    // Fallback: query stripe.subscriptions by customerId directly.
    // Handles the case where webhook hasn't fired yet or subscriptionId was never written.
    if (user.stripeCustomerId) {
      const subscription = await storage.getActiveSubscriptionByCustomerId(user.stripeCustomerId);
      if (subscription) {
        // Back-fill for fast future lookups
        await storage.updateUserStripeInfo(userId, {
          stripeSubscriptionId: subscription.id as string,
        });
        res.json({ subscription, isPro: true });
        return;
      }
    }

    res.json({ subscription: null, isPro: false });
  } catch (err) {
    logger.error({ err }, 'Error fetching subscription');
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

router.get('/calendar-sync', requireAuth, async (req, res): Promise<void> => {
  try {
    const { id: userId } = req.user!;

    const user = await storage.getUser(userId);
    let isPro = false;

    if (user?.stripeSubscriptionId) {
      const sub = await storage.getSubscription(user.stripeSubscriptionId);
      isPro = sub?.status === 'active' || sub?.status === 'trialing';
    } else if (user?.stripeCustomerId) {
      const sub = await storage.getActiveSubscriptionByCustomerId(user.stripeCustomerId);
      isPro = !!sub;
    }

    if (!isPro) {
      res.status(403).json({ error: 'Calendar sync requires Squadz Pro', requiresPro: true });
      return;
    }

    res.json({ synced: true, calendars: [] });
  } catch (err) {
    logger.error({ err }, 'Error in calendar sync');
    res.status(500).json({ error: 'Calendar sync failed' });
  }
});

router.post('/portal', requireAuth, async (req, res): Promise<void> => {
  try {
    const { id: userId } = req.user!;

    const user = await storage.getUser(userId);
    if (!user?.stripeCustomerId) {
      res.status(404).json({ error: 'No Stripe customer found for this user' });
      return;
    }

    const baseUrl = getBaseUrl();
    const session = await stripeService.createCustomerPortalSession(
      user.stripeCustomerId,
      `${baseUrl}/`,
    );

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, 'Error creating portal session');
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Dev-only: render the Pro welcome email HTML in the browser for visual testing.
// Gated to NODE_ENV=development — returns 404 in production.
router.get('/stripe/email-preview/pro-welcome', (req, res): void => {
  if (process.env.NODE_ENV !== 'development') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const planName = typeof req.query.planName === 'string' ? req.query.planName : 'Squadz Pro';
  const priceRaw = typeof req.query.price === 'string' ? req.query.price : '999';
  const renewalRaw = typeof req.query.renewalDate === 'string' ? req.query.renewalDate : '';

  const priceAmount = Math.round(parseFloat(priceRaw) * 100);
  const renewalDate = renewalRaw ? new Date(renewalRaw) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  if (isNaN(priceAmount) || priceAmount < 0) {
    res.status(400).json({ error: 'Invalid price — provide a positive number (e.g. price=9.99)' });
    return;
  }

  if (renewalRaw && isNaN(renewalDate.getTime())) {
    res.status(400).json({ error: 'Invalid renewalDate — use ISO 8601 format (e.g. renewalDate=2026-07-06)' });
    return;
  }

  const baseUrl = getBaseUrl();

  const html = buildProWelcomeHtml({
    toEmail: 'preview@example.com',
    planName,
    priceAmount,
    priceCurrency: 'usd',
    renewalDate,
    manageUrl: `${baseUrl}/home`,
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default router;
