import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/currentUser";
import { storage, type EnrichedPhoto } from "../storage";
import { emitSquadUpdate } from "../lib/squadEvents";
import { emitVaultPhotoUpdate, onVaultPhotoUpdate } from "../lib/vaultEvents";
import { emitFeedUpdate } from "../lib/feedEvents";
import { sendPushNotifications } from "../lib/pushNotifications";
import { db, feedPostsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const CAPTION_MAX = 300;

const AddVaultPhotoBody = z.object({
  url: z.string().min(1),
  eventId: z.string().optional(),
  // T11: when provided (and no eventId), the media is added straight to this
  // squad's shared vault — no event roll-up required. Member-only.
  squadId: z.string().optional(),
  mediaType: z.enum(["image", "video"]).optional(),
  caption: z.string().trim().max(CAPTION_MAX).optional(),
});

/**
 * Enrich a page of vault photos with their interaction stats (heart count,
 * whether the caller has hearted, comment count) in a single batched query, so
 * every vault list response carries the same interaction shape.
 */
async function enrichWithInteractions<T extends { id: number }>(
  photos: T[],
  userId: string,
): Promise<(T & { heartCount: number; hearted: boolean; commentCount: number })[]> {
  const { heartCounts, heartedIds, commentCounts } = await storage.getVaultInteractionStats(
    photos.map((p) => p.id),
    userId,
  );
  return photos.map((p) => ({
    ...p,
    heartCount: heartCounts.get(p.id) ?? 0,
    hearted: heartedIds.has(p.id),
    commentCount: commentCounts.get(p.id) ?? 0,
  }));
}

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
 *   eventId  — filter to photos from a single event (squad members for squad events; host for personal events)
 *
 * When neither param is provided, returns all photos uploaded by the user.
 *
 * Response: { photos: Photo[], isPro: boolean, requiresPro?: boolean }
 * The personal roll-up (no squad/event scope) is Squadz+ only — free users get
 * an empty list with requiresPro:true (a single entrance gate, no per-item
 * locks). Squad/event-scoped reads are open to members regardless of subscription.
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

    // Personal vault roll-up (no squad/event scope) is a Squadz+ feature. Free
    // users see the tab but hit a single entrance gate — no per-item locks.
    if (!squadId && !eventId && !isPro) {
      res.json({ photos: [], isPro: false, requiresPro: true });
      return;
    }

    let rawPhotos: EnrichedPhoto[] = [];

    if (eventId) {
      const event = await storage.getEvent(eventId);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      // Event photos belong to the whole squad — any *current* member may view
      // them, not just the host. Personal events (no squad) stay host-only.
      const canView = event.squadId
        ? await storage.isSquadMemberPublic(event.squadId, userId)
        : event.hostId === userId;
      if (!canView) {
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

    const favoriteIds = await storage.getUserFavoritePhotoIds(userId);
    const withFavorites = rawPhotos.map(photo => ({
      ...photo,
      favorited: favoriteIds.has(photo.id),
    }));
    const photos = await enrichWithInteractions(withFavorites, userId);

    res.json({ photos, isPro });
  } catch (err) {
    logger.error({ err }, "Error fetching vault photos");
    res.status(500).json({ error: "Failed to fetch vault photos" });
  }
});

/**
 * POST /api/vault/photos
 *
 * Save a photo URL to the vault. The URL should be an object storage path
 * returned by POST /api/storage/uploads/request-url.
 *
 * Vault uploads are not time-gated and not Pro-gated: squad/event vault content
 * is free for members. The only gate is provenance — you may only add media you
 * uploaded.
 */
router.post("/vault/photos", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;

    const parsedBody = AddVaultPhotoBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: parsedBody.error.message });
      return;
    }

    const { url, eventId, squadId, mediaType, caption } = parsedBody.data;

    // Provenance: only add media you uploaded. A vault url with no existing photo
    // row (e.g. another user's moment/message object path) would otherwise let a
    // user create a row they "own" and self-authorize read access via the photo
    // ACL. Public uploads (full https URLs) carry no private path to forge.
    const verifyProvenance = async (): Promise<boolean> => {
      if (/^https?:\/\//i.test(url)) return true;
      const owner = await storage.getUploadOwner(url);
      return owner === userId;
    };

    // T11 — Direct-to-squad-vault upload. No event roll-up required: any current
    // member of the squad may add media straight to its shared vault. This path
    // is intentionally independent of Pro status (membership is the gate).
    if (squadId && !eventId) {
      const isMember = await storage.isSquadMemberPublic(squadId, userId);
      if (!isMember) {
        res.status(403).json({ error: "Not a member of this squad" });
        return;
      }
      if (!(await verifyProvenance())) {
        res.status(403).json({ error: "You can only add media you uploaded." });
        return;
      }
      const photo = await storage.addPhoto(userId, url, undefined, {
        squadId,
        sharedToSquad: true,
        mediaType,
        caption: caption || null,
      });
      emitSquadUpdate(squadId);
      res.status(201).json({ photo });
      return;
    }

    // Vault uploads are no longer time-gated. Squad/event vault content is free
    // for members; the only gate is provenance — you may only add media you
    // uploaded (this also blocks forging another user's object path).
    if (!(await verifyProvenance())) {
      res.status(403).json({ error: "You can only add media you uploaded." });
      return;
    }

    const photo = await storage.addPhoto(userId, url, eventId, { mediaType, caption: caption || null });
    res.status(201).json({ photo });
  } catch (err) {
    logger.error({ err }, "Error saving vault photo");
    res.status(500).json({ error: "Failed to save photo" });
  }
});

const FavoriteBody = z.object({ photoId: z.number().int().positive() });

/**
 * GET /api/vault/favorites
 *
 * Every photo/video the user has bookmarked, across all squads. Reference-only:
 * favorites point back at the original item (squadId/eventId preserved).
 * Favorites are a Squadz+ feature — free users get an empty list with
 * requiresPro:true (a single entrance gate, no per-item locks).
 */
router.get("/vault/favorites", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, (req.user as { id: string; email?: string }).email ?? "");
    }
    const isPro = await resolveProStatus(user);

    // Favorites are a Squadz+ feature — free users hit the same entrance gate.
    if (!isPro) {
      res.json({ photos: [], isPro: false, requiresPro: true });
      return;
    }

    const rawPhotos = await storage.getUserFavorites(userId);
    const withFavorites = rawPhotos.map(photo => ({ ...photo, favorited: true as const }));
    const photos = await enrichWithInteractions(withFavorites, userId);

    res.json({ photos, isPro });
  } catch (err) {
    logger.error({ err }, "Error fetching favorites");
    res.status(500).json({ error: "Failed to fetch favorites" });
  }
});

/**
 * POST /api/vault/favorites  { photoId }
 *
 * Bookmark a photo/video. The user must be able to view it (member of its squad,
 * host/member of its event, or its uploader). Idempotent — favoriting twice is a
 * no-op. Favoriting is private and never notifies anyone.
 */
router.post("/vault/favorites", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const parsed = FavoriteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid photoId" });
      return;
    }
    const { photoId } = parsed.data;

    if (!(await storage.canUserViewPhotoById(photoId, userId))) {
      res.status(403).json({ error: "You can only favorite media you have access to." });
      return;
    }

    await storage.addFavorite(userId, photoId);
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error adding favorite");
    res.status(500).json({ error: "Failed to add favorite" });
  }
});

/**
 * DELETE /api/vault/favorites/:photoId
 *
 * Remove a bookmark. No-op (still 200) if it wasn't favorited.
 */
router.delete("/vault/favorites/:photoId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const photoId = Number(req.params.photoId);
    if (!Number.isInteger(photoId) || photoId <= 0) {
      res.status(400).json({ error: "Invalid photoId" });
      return;
    }

    await storage.removeFavorite(userId, photoId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error removing favorite");
    res.status(500).json({ error: "Failed to remove favorite" });
  }
});

// ---- Vault media interactions: captions, hearts, comments, share-to-Vibe ----

function parsePhotoId(raw: unknown): number {
  return Number(Array.isArray(raw) ? raw[0] : raw);
}

const CaptionBody = z.object({ caption: z.string().trim().max(CAPTION_MAX) });

/**
 * PATCH /api/vault/photos/:id/caption  { caption }
 *
 * Edit a photo's caption. Only the original uploader may edit it (403 otherwise).
 * Max 300 chars; an empty string clears the caption.
 */
router.patch("/vault/photos/:id/caption", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const photoId = parsePhotoId(req.params.id);
    if (!Number.isInteger(photoId) || photoId <= 0) {
      res.status(400).json({ error: "Invalid photo id" });
      return;
    }
    const parsed = CaptionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const caption = parsed.data.caption.length > 0 ? parsed.data.caption : null;
    const photo = await storage.updatePhotoCaption(photoId, userId, caption);
    if (!photo) {
      res.status(403).json({ error: "You can only edit captions on media you uploaded." });
      return;
    }
    emitVaultPhotoUpdate(photoId);
    res.json({ photo });
  } catch (err) {
    logger.error({ err }, "Error updating caption");
    res.status(500).json({ error: "Failed to update caption" });
  }
});

/**
 * POST /api/vault/photos/:id/heart
 *
 * Toggle a heart on a photo. Anyone who can view the media may heart it.
 * Returns the new state and total count.
 */
router.post("/vault/photos/:id/heart", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const photoId = parsePhotoId(req.params.id);
    if (!Number.isInteger(photoId) || photoId <= 0) {
      res.status(400).json({ error: "Invalid photo id" });
      return;
    }
    if (!(await storage.canUserViewPhotoById(photoId, userId))) {
      res.status(403).json({ error: "You can only heart media you have access to." });
      return;
    }
    const result = await storage.toggleHeart(photoId, userId);
    emitVaultPhotoUpdate(photoId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Error toggling heart");
    res.status(500).json({ error: "Failed to toggle heart" });
  }
});

/**
 * GET /api/vault/photos/:id/hearts
 *
 * The list of users who have hearted a photo (most-recent first). View-gated.
 */
router.get("/vault/photos/:id/hearts", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const photoId = parsePhotoId(req.params.id);
    if (!Number.isInteger(photoId) || photoId <= 0) {
      res.status(400).json({ error: "Invalid photo id" });
      return;
    }
    if (!(await storage.canUserViewPhotoById(photoId, userId))) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const hearts = await storage.getPhotoHearts(photoId);
    res.json({ hearts });
  } catch (err) {
    logger.error({ err }, "Error fetching hearts");
    res.status(500).json({ error: "Failed to fetch hearts" });
  }
});

/**
 * GET /api/vault/photos/:id/comments
 *
 * Non-deleted comments on a photo, oldest-first. View-gated.
 */
router.get("/vault/photos/:id/comments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const photoId = parsePhotoId(req.params.id);
    if (!Number.isInteger(photoId) || photoId <= 0) {
      res.status(400).json({ error: "Invalid photo id" });
      return;
    }
    if (!(await storage.canUserViewPhotoById(photoId, userId))) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const comments = await storage.getVaultComments(photoId);
    res.json({ comments });
  } catch (err) {
    logger.error({ err }, "Error fetching comments");
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

const CommentBody = z.object({ text: z.string().trim().min(1).max(1000) });

/**
 * POST /api/vault/photos/:id/comments  { text }
 *
 * Add a comment to a photo. View-gated. Notifies the photo's uploader (unless
 * the commenter is the uploader, and gated on their friend-activity pref).
 */
router.post("/vault/photos/:id/comments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const photoId = parsePhotoId(req.params.id);
    if (!Number.isInteger(photoId) || photoId <= 0) {
      res.status(400).json({ error: "Invalid photo id" });
      return;
    }
    const parsed = CommentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const photo = await storage.getPhotoById(photoId);
    if (!photo || !(await storage.canUserViewPhotoById(photoId, userId))) {
      res.status(403).json({ error: "You can only comment on media you have access to." });
      return;
    }

    const comment = await storage.addVaultComment(photoId, userId, parsed.data.text);
    emitVaultPhotoUpdate(photoId);
    res.status(201).json({ comment });

    // Fire-and-forget: notify the uploader (never the commenter themselves),
    // gated on the friend-activity notification preference.
    if (photo.uploaderId !== userId) {
      void (async () => {
        try {
          const tokens = await storage.getPushTokensForUsers([photo.uploaderId], {
            requireNotifyFriendActivity: true,
          });
          if (tokens.length === 0) return;
          const author = await storage.getUser(userId);
          const name = [author?.firstName, author?.lastName].filter(Boolean).join(" ").trim()
            || author?.email?.split("@")[0]
            || "Someone";
          const preview = parsed.data.text.length > 80
            ? `${parsed.data.text.slice(0, 77)}...`
            : parsed.data.text;
          await sendPushNotifications(
            tokens,
            {
              title: `${name} commented`,
              body: preview,
              data: { screen: "vault", photoId: String(photoId) },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
        } catch (err) {
          logger.error({ err }, "Error sending comment notification");
        }
      })();
    }
  } catch (err) {
    logger.error({ err }, "Error adding comment");
    res.status(500).json({ error: "Failed to add comment" });
  }
});

/**
 * DELETE /api/vault/photos/:id/comments/:commentId
 *
 * Soft-delete a comment. Allowed for the comment's author or the photo's
 * uploader (403 otherwise).
 */
router.delete(
  "/vault/photos/:id/comments/:commentId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req.user as { id: string }).id;
      const commentId = parsePhotoId(req.params.commentId);
      if (!Number.isInteger(commentId) || commentId <= 0) {
        res.status(400).json({ error: "Invalid comment id" });
        return;
      }
      const ok = await storage.softDeleteVaultComment(commentId, userId);
      if (!ok) {
        res.status(403).json({ error: "You can only delete your own comments." });
        return;
      }
      const photoId = parsePhotoId(req.params.id);
      if (Number.isInteger(photoId) && photoId > 0) emitVaultPhotoUpdate(photoId);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Error deleting comment");
      res.status(500).json({ error: "Failed to delete comment" });
    }
  },
);

const ShareBody = z.object({ text: z.string().trim().max(1000).optional() });

/**
 * POST /api/vault/photos/:id/share  { text? }
 *
 * Share a vault photo/video out to the user's Vibe feed (friends-audience). The
 * user must be able to VIEW the media (member of its squad / event / uploader) —
 * this is the authorization, so the feed post may reference media the sharer did
 * not upload (it bypasses the feed's own owner check, justified by vault access).
 * The original vault item is left untouched. Returns the new post.
 */
router.post("/vault/photos/:id/share", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const photoId = parsePhotoId(req.params.id);
    if (!Number.isInteger(photoId) || photoId <= 0) {
      res.status(400).json({ error: "Invalid photo id" });
      return;
    }
    const parsed = ShareBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const photo = await storage.getPhotoById(photoId);
    if (!photo || !(await storage.canUserViewPhotoById(photoId, userId))) {
      res.status(403).json({ error: "You can only share media you have access to." });
      return;
    }

    const text = parsed.data.text ?? "";
    const mediaType = photo.mediaType === "video" ? "video" : "photo";

    const [post] = await db
      .insert(feedPostsTable)
      .values({
        authorId: userId,
        text,
        audience: "friends",
        mediaUrl: photo.url,
        mediaType,
      })
      .returning();

    res.status(201).json({ post });

    // Fire-and-forget: fan out SSE + push to the sharer's friends.
    void (async () => {
      try {
        const friendIds = (await storage.getFriendIds(userId)).filter((id) => id !== userId);
        friendIds.forEach((id) => emitFeedUpdate(id));
        emitFeedUpdate(userId);
        if (friendIds.length === 0) return;
        const tokens = await storage.getPushTokensForUsers(friendIds, {
          requireNotifyFriendActivity: true,
        });
        if (tokens.length === 0) return;
        const author = await storage.getUser(userId);
        const name = author?.firstName ?? "Someone";
        const preview = text.length > 0
          ? (text.length > 80 ? `${text.slice(0, 77)}...` : text)
          : mediaType === "video" ? "🎥 Shared a clip" : "📷 Shared a photo";
        await sendPushNotifications(
          tokens,
          { title: name, body: preview, data: { screen: "feed" } },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error fanning out vault share");
      }
    })();
  } catch (err) {
    logger.error({ err }, "Error sharing vault photo");
    res.status(500).json({ error: "Failed to share photo" });
  }
});

/**
 * GET /api/vault/photos/:id/stream — SSE stream of interaction updates for a
 * single photo (caption edits, hearts, comments). Drives the detail screen's
 * real-time refresh. View-gated.
 */
router.get("/vault/photos/:id/stream", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const photoId = parsePhotoId(req.params.id);
  if (!Number.isInteger(photoId) || photoId <= 0) {
    res.status(400).json({ error: "Invalid photo id" });
    return;
  }
  if (!(await storage.canUserViewPhotoById(photoId, userId))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write("event: connected\ndata: {}\n\n");

  const unsubscribe = onVaultPhotoUpdate(photoId, () => {
    res.write(`event: update\ndata: {}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
