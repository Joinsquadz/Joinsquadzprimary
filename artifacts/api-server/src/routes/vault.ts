import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/currentUser";
import { storage, type EnrichedPhoto } from "../storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const PHOTO_VAULT_DAYS = 30;

const AddVaultPhotoBody = z.object({
  url: z.string().min(1),
  eventId: z.string().optional(),
});

const VaultPhotosQuery = z.object({
  squadId: z.string().optional(),
  eventId: z.string().optional(),
});

async function resolveProStatus(user: NonNullable<Awaited<ReturnType<typeof storage.getUser>>>) {
  if (user.stripeSubscriptionId) {
    const sub = await storage.getSubscription(user.stripeSubscriptionId);
    return sub?.status === "active" || sub?.status === "trialing";
  }
  if (user.stripeCustomerId) {
    const sub = await storage.getActiveSubscriptionByCustomerId(user.stripeCustomerId);
    return !!sub;
  }
  return false;
}

/**
 * GET /api/vault/photos
 *
 * Returns photos the authenticated user has access to, optionally scoped to a
 * squad or a single event.
 *
 * Query params:
 *   squadId  — filter to photos from events belonging to this squad (user must be a member)
 *   eventId  — filter to photos from a single event (user must be host)
 *
 * When neither param is provided, returns all photos uploaded by the user.
 *
 * Response: { photos: Photo[], isPro: boolean }
 * Expired photos (>30 days) are returned with locked:true and no url for non-Pro users.
 */
router.get("/vault/photos", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;

    const parsed = VaultPhotosQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters" });
      return;
    }
    const { squadId, eventId } = parsed.data;

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, (req.user as { id: string; email?: string }).email ?? "");
    }

    const isPro = await resolveProStatus(user);

    let rawPhotos: EnrichedPhoto[] = [];

    if (eventId) {
      const event = await storage.getEvent(eventId);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      if (event.hostId !== userId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      rawPhotos = await storage.getPhotosByEventId(eventId);
    } else if (squadId) {
      const result = await storage.getPhotosBySquadId(squadId, userId);
      if (!result.authorized) {
        res.status(403).json({ error: "Not a member of this squad" });
        return;
      }
      rawPhotos = result.photos;
    } else {
      rawPhotos = await storage.getPhotosByUploaderId(userId);
    }

    const cutoff = new Date(Date.now() - PHOTO_VAULT_DAYS * 24 * 60 * 60 * 1000);
    const photos = rawPhotos.map(photo => {
      const locked = !isPro && photo.uploadedAt < cutoff;
      // Event labels are not sensitive, so keep them on locked photos too. This
      // lets clients label and squad-filter photos (incl. ones over 30 days)
      // without refetching events. Only the url is withheld when locked.
      return locked
        ? {
            id: photo.id,
            eventId: photo.eventId,
            uploadedAt: photo.uploadedAt,
            eventTitle: photo.eventTitle,
            eventEmoji: photo.eventEmoji,
            squadName: photo.squadName,
            locked: true as const,
          }
        : { ...photo, locked: false as const };
    });

    res.json({ photos, isPro });
  } catch (err) {
    logger.error({ err }, "Error fetching vault photos");
    res.status(500).json({ error: "Failed to fetch vault photos" });
  }
});

/**
 * POST /api/vault/photos
 *
 * Save a photo URL to the vault (Pro users only). The URL should be an object
 * storage path returned by POST /api/storage/uploads/request-url.
 */
router.post("/vault/photos", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, (req.user as { id: string; email?: string }).email ?? "");
    }

    const isPro = await resolveProStatus(user);

    if (!isPro) {
      res.status(403).json({ error: "Photo Vault requires a Pro subscription", requiresPro: true });
      return;
    }

    const parsedBody = AddVaultPhotoBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: parsedBody.error.message });
      return;
    }

    const photo = await storage.addPhoto(userId, parsedBody.data.url, parsedBody.data.eventId);
    res.status(201).json({ photo });
  } catch (err) {
    logger.error({ err }, "Error saving vault photo");
    res.status(500).json({ error: "Failed to save photo" });
  }
});

export default router;
