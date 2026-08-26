import { Router, type IRouter } from 'express';
import { storage } from '../storage';
import { requireAuth } from '../middleware/currentUser';
import { logger } from '../lib/logger';
import { buildProWelcomeHtml } from '../emailService';
import { getBaseUrl } from '../lib/urls';
import { getFoundingStatus } from '../lib/founding';
import { resolveProStatus } from '../lib/proStatus';

const router: IRouter = Router();

// Public, no-auth: how many Founding Member spots remain. Drives the landing
// page price + the in-app upgrade modal. Read-only — never claims a spot.
// Cached for 30 s so rapid page loads don't hit Stripe/DB on every request.
type FoundingStatus = Awaited<ReturnType<typeof getFoundingStatus>>;
let _foundingCache: { value: FoundingStatus; expiresAt: number } | null = null;

// Purchase-time guard: deliberately separate from the cached public display
// endpoint below. StoreKit/Play can still complete a sheet opened from stale UI,
// so the client must make its final package choice from a fresh counter read.
router.get('/subscription/founding-status/fresh', async (_req, res): Promise<void> => {
  try {
    const status = await getFoundingStatus();
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(status);
  } catch (err) {
    logger.error({ err }, 'Error fetching fresh founding status');
    res.status(500).json({ error: 'Failed to fetch founding status' });
  }
});

router.get('/subscription/founding-status', async (_req, res): Promise<void> => {
  try {
    const now = Date.now();
    const isTest = process.env.NODE_ENV === 'test';
    if (!isTest && _foundingCache && now <= _foundingCache.expiresAt) {
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
      res.json(_foundingCache.value);
      return;
    }
    const status = await getFoundingStatus();
    if (!isTest) {
      _foundingCache = { value: status, expiresAt: now + 30_000 };
    }
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
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

// Stripe payment creation is intentionally disabled. SquadZ+ is sold through
// RevenueCat/App Store/Google Play, and the shipped clients do not call these
// legacy web-billing endpoints.
router.post('/checkout', (_req, res): void => {
  res.status(410).json({
    error: 'Stripe Checkout has been permanently disabled',
    code: 'STRIPE_CHECKOUT_DISABLED',
  });
});

router.get('/subscription', requireAuth, async (req, res): Promise<void> => {
  try {
    const { id: userId } = req.user!;

    const user = await storage.getUser(userId);
    if (!user) {
      res.json({ subscription: null, isPro: false, tier: 'none' });
      return;
    }

    // Unified status: RevenueCat (mobile IAP) sets is_squadz_plus via webhook.
    // This is now the primary purchase surface, so check it first. There is no
    // Stripe subscription object for IAP users.
    if (user.isSquadzPlus) {
      // `tier` is provenance for the badge, never the access decision. A
      // subscriber whose tier we've never observed (legacy row, or an event
      // without a product id) still reports isPro:true and falls back to
      // 'standard' so the client never has to render an "unknown tier" state.
      const tier = user.squadzPlusTier === 'founding' ? 'founding' : 'standard';
      res.json({ subscription: null, isPro: true, source: 'revenuecat', tier });
      return;
    }

    // Dormant Stripe fallback (legacy / reactivatable web checkout).
    // Primary: check stored subscriptionId (set by webhook linkage)
    if (user.stripeSubscriptionId) {
      const subscription = await storage.getSubscription(user.stripeSubscriptionId);
      const isPro = subscription?.status === 'active' || subscription?.status === 'trialing';
      res.json({
        subscription,
        isPro: !!isPro,
        tier: isPro ? (user.squadzPlusTier === 'founding' ? 'founding' : 'standard') : 'none',
      });
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
        res.json({
          subscription,
          isPro: true,
          tier: user.squadzPlusTier === 'founding' ? 'founding' : 'standard',
        });
        return;
      }
    }

    res.json({ subscription: null, isPro: false, tier: 'none' });
  } catch (err) {
    logger.error({ err }, 'Error fetching subscription');
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

router.get('/calendar-sync', requireAuth, async (req, res): Promise<void> => {
  try {
    const { id: userId } = req.user!;

    const user = await storage.getUser(userId);
    const isPro = user ? await resolveProStatus(user) : false;

    if (!isPro) {
      res.status(403).json({ error: 'Calendar sync requires SquadZ Pro', requiresPro: true });
      return;
    }

    res.json({ synced: true, calendars: [] });
  } catch (err) {
    logger.error({ err }, 'Error in calendar sync');
    res.status(500).json({ error: 'Calendar sync failed' });
  }
});

router.post('/portal', (_req, res): void => {
  res.status(410).json({
    error: 'Stripe Billing Portal has been permanently disabled',
    code: 'STRIPE_PORTAL_DISABLED',
  });
});

// Dev-only: render the Pro welcome email HTML in the browser for visual testing.
// Gated to NODE_ENV=development — returns 404 in production.
router.get('/stripe/email-preview/pro-welcome', (req, res): void => {
  if (process.env.NODE_ENV !== 'development') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const planName = typeof req.query.planName === 'string' ? req.query.planName : 'SquadZ Pro';
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
