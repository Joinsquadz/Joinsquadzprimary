import { Router, type IRouter } from 'express';
import { storage } from '../storage';
import { requireAuth } from '../middleware/currentUser';
import { logger } from '../lib/logger';

const router: IRouter = Router();

const FREE_EVENT_LIMIT = 3;

router.get('/events/count', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const total = await storage.countUserEvents(userId);
    res.json({ count: total, limit: FREE_EVENT_LIMIT });
  } catch (err) {
    logger.error({ err }, 'Error fetching event count');
    res.status(500).json({ error: 'Failed to fetch event count' });
  }
});

router.post('/events', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const { email } = req.user as { id: string; email?: string };
    const { title } = req.body as { title?: string };

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, email ?? '');
    }

    const isPro = await (async () => {
      if (user!.stripeSubscriptionId) {
        const sub = await storage.getSubscription(user!.stripeSubscriptionId);
        return sub?.status === 'active' || sub?.status === 'trialing';
      }
      if (user!.stripeCustomerId) {
        const sub = await storage.getActiveSubscriptionByCustomerId(user!.stripeCustomerId);
        return !!sub;
      }
      return false;
    })();

    if (!isPro) {
      const eventCount = await storage.countUserEvents(userId);
      if (eventCount >= FREE_EVENT_LIMIT) {
        res.status(403).json({
          error: `Free plan is limited to ${FREE_EVENT_LIMIT} events. Upgrade to Pro to create unlimited events.`,
          requiresPro: true,
          count: eventCount,
          limit: FREE_EVENT_LIMIT,
        });
        return;
      }
    }

    const event = await storage.createEvent(userId, title.trim());
    res.status(201).json(event);
  } catch (err) {
    logger.error({ err }, 'Error creating event');
    res.status(500).json({ error: 'Failed to create event' });
  }
});

export default router;
