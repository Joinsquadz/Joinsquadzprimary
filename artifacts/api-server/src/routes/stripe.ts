import { Router, type IRouter } from 'express';
import { storage } from '../storage';
import { stripeService } from '../stripeService';
import { requireAuth } from '../middleware/currentUser';
import { logger } from '../lib/logger';

const router: IRouter = Router();

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
    const { priceId } = req.body as { priceId: string };
    // requireAuth guarantees req.user is defined
    const { id: userId, email } = req.user!;

    if (!priceId) {
      res.status(400).json({ error: 'priceId is required' });
      return;
    }

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, email ?? '');
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeService.createCustomer(email ?? userId, userId);
      user = await storage.updateUserStripeInfo(userId, { stripeCustomerId: customer.id });
      customerId = customer.id;
    }

    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    const session = await stripeService.createCheckoutSession(
      customerId!,
      priceId,
      `${baseUrl}/home?checkout=success`,
      `${baseUrl}/home?checkout=cancel`,
    );

    res.json({ url: session.url });
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

router.post('/portal', requireAuth, async (req, res): Promise<void> => {
  try {
    const { id: userId } = req.user!;

    const user = await storage.getUser(userId);
    if (!user?.stripeCustomerId) {
      res.status(404).json({ error: 'No Stripe customer found for this user' });
      return;
    }

    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
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

export default router;
