import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/currentUser";
import { storage, type EnrichedPhoto } from "../storage";
import { emitSquadUpdate } from "../lib/squadEvents";
import { emitVaultPhotoUpdate, onVaultPhotoUpdate } from "../lib/vaultEvents";
import { emitFeedUpdate } from "../lib/feedEvents";
import { sendPushNotifications } from "../lib/pushNotifications";
import { shouldSendNotification } from "../lib/notificationDebounce";
import { db, feedPostsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { copyStorageObject } from "../services/objectStorage";
import { deleteOwnedMediaObject } from "../lib/accountMediaCleanup";
import { recordActivitySafe, removeActivity } from "../lib/activity";
import { getBlockedAndBlockerIds } from "./moderation";

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
 *   squadId  — ALL photos belonging to this squad (user must be a member): both
 *              event roll-ups AND event-less photos shared straight to the squad
 *              vault. Kept lossless (see storage.getPhotosBySquadId) so it agrees
 *              with GET /api/squads/:id/vault and never silently drops a photo.
 *   eventId  — filter to photos from a single event (squad members for squad events; host for personal events)
 *
 * When neither param is provided, returns all photos uploaded by the user.
 *
 * Response: { photos: Photo[], isPro: boolean, requiresPro?: boolean }
 * The personal roll-up (no squad/event scope) is SquadZ+ only — free users get
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

    // Personal vault roll-up (no squad/event scope) is a SquadZ+ feature. Free
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

    // For squad/event views: filter out photos from blocked users and hidden content.
    // Personal vault (no scope) shows the user's own photos regardless of status
    // so they can see moderation outcomes.
    if (squadId || eventId) {
      const blockedIds = await getBlockedAndBlockerIds(userId);
      const blockedSet = new Set(blockedIds);
      rawPhotos = rawPhotos.filter(
        (p) => !blockedSet.has(p.uploaderId) && p.status !== "hidden",
      );
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

    // Provenance alone is NOT enough for an event roll-up: it only proves the
    // caller owns the bytes, not that they belong to the plan. Without this
    // check any user could post their own media into a stranger's event vault
    // (the GET side already gates on membership, so it would show up for
    // everyone who can see that event). Mirrors the read rule exactly.
    if (eventId) {
      const event = await storage.getEvent(eventId);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      const canContribute = event.squadId
        ? await storage.isSquadMemberPublic(event.squadId, userId)
        : event.hostId === userId ||
          ((event.invitedUserIds ?? []) as string[]).includes(userId);
      if (!canContribute) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const photo = await storage.addPhoto(userId, url, eventId, { mediaType, caption: caption || null });
    res.status(201).json({ photo });
  } catch (err) {
    logger.error({ err }, "Error saving vault photo");
    res.status(500).json({ error: "Failed to save photo" });
  }
});

const SaveToVaultBody = z.object({ photoId: z.number().int().positive() });

/**
 * Is this caller entitled to the PERSONAL vault?
 *
 * The personal vault (roll-up + saves) is the SquadZ+ entitlement; the shared
 * squad vault is free for members. `GET /vault/photos` already gates the
 * roll-up, so the save endpoints must apply the same check server-side — the
 * mobile UI gate is trivially bypassable by calling the API directly, and a
 * free user who could save would keep the copies until they upgraded.
 */
async function callerIsPro(req: Request): Promise<boolean> {
  const { id, email } = req.user as { id: string; email?: string };
  const user = (await storage.getUser(id)) ?? (await storage.upsertUser(id, email ?? ""));
  return resolveProStatus(user);
}

/** The single entrance gate the personal-vault surfaces share. */
function proRequired(res: Response): void {
  res.status(403).json({
    error: "Saving to your personal vault is a SquadZ+ feature.",
    code: "PRO_REQUIRED",
    requiresPro: true,
  });
}

/**
 * GET /api/vault/saves — the SOURCE photo ids this user has already copied into
 * their personal vault. Lets a squad/event grid render "Saved" state without an
 * N+1 lookup per tile.
 *
 * Free users get an empty list (not a 403): the grid simply renders nothing as
 * saved, and the save action itself is what surfaces the upgrade prompt.
 */
router.get("/vault/saves", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    if (!(await callerIsPro(req))) {
      res.json({ sourceIds: [], requiresPro: true });
      return;
    }
    const sourceIds = await storage.getSavedSourcePhotoIds(userId);
    res.json({ sourceIds });
  } catch (err) {
    logger.error({ err }, "Error listing vault saves");
    res.status(500).json({ error: "Failed to load your saves" });
  }
});

/**
 * POST /api/vault/saves  { photoId }
 *
 * "Save to my vault" — make a DURABLE PERSONAL COPY of a photo/video the user
 * can currently see (squad vault, trip roll-up, event vault).
 *
 * This is deliberately NOT a favorite. A favorite is a reference: it points at
 * someone else's row and evaporates the moment they delete the media or the
 * squad is torn down. A save copies the underlying storage object and inserts a
 * fresh photo row owned by the saver, with no squad/event linkage — so the copy
 * survives deletion of the source, of the event, and of the squad.
 *
 * Authorization is "can you see it right now" (canUserViewPhotoById), evaluated
 * against LIVE membership — the same rule that lets the user view the media in
 * the first place. A user who was removed from the squad can no longer save.
 *
 * Idempotent: saving the same source twice returns the existing copy
 * (200 + alreadySaved) rather than duplicating bytes and rows.
 */
router.post("/vault/saves", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const parsed = SaveToVaultBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid photoId" });
      return;
    }
    const { photoId } = parsed.data;

    // Entitlement before anything else: no copy, no bytes, no row for a free
    // user calling the API directly around the mobile gate.
    if (!(await callerIsPro(req))) {
      proRequired(res);
      return;
    }

    const source = await storage.getPhotoById(photoId);
    if (!source || !(await storage.canUserViewPhotoById(photoId, userId))) {
      res.status(403).json({ error: "You can only save media you have access to." });
      return;
    }
    if (source.status === "hidden") {
      res.status(403).json({ error: "This media isn't available." });
      return;
    }

    // Idempotency first: re-saving must not burn another storage object.
    const existing = await storage.getSavedCopy(userId, photoId);
    if (existing) {
      res.json({ photo: existing, alreadySaved: true });
      return;
    }

    // A save must own INDEPENDENT bytes, and photos.url is globally unique — so
    // "reuse the source URL" is not a legal fallback for anything. Vault media
    // is private object storage, which we can copy. A public https URL (legacy
    // rows, avatar-bucket assets) has no private object to copy, and inserting
    // a second row at the same URL would violate the unique constraint, so it
    // is refused explicitly rather than 500ing.
    if (/^https?:\/\//i.test(source.url)) {
      res.status(422).json({
        error: "This media can't be saved to your vault.",
        code: "UNSUPPORTED_MEDIA",
      });
      return;
    }
    const copiedUrl = await copyStorageObject(source.url);
    if (!copiedUrl) {
      res.status(503).json({ error: "Couldn't save this right now. Please try again." });
      return;
    }

    // Record provenance BEFORE the row exists so the copy is never an orphan
    // object: account deletion resolves media ownership from object_uploads,
    // not from path prefixes, so an unrecorded copy would survive the saver's
    // account purge forever.
    await storage.recordUpload(userId, copiedUrl);

    const photo = await storage.addSavedPhotoCopy(userId, source, copiedUrl);
    if (!photo) {
      // A concurrent save won the unique (uploader, source) race. Our copied
      // object is now referenced by nothing, so release it here — otherwise
      // every racing double-tap would leak a private object forever.
      await storage.deleteUploadRecord(userId, copiedUrl);
      await deleteOwnedMediaObject(userId, copiedUrl);
      const winner = await storage.getSavedCopy(userId, photoId);
      res.json({ photo: winner, alreadySaved: true });
      return;
    }
    res.status(201).json({ photo, alreadySaved: false });
  } catch (err) {
    logger.error({ err }, "Error saving photo to personal vault");
    res.status(500).json({ error: "Failed to save to your vault" });
  }
});

/**
 * DELETE /api/vault/saves/:photoId — remove the personal copy made from source
 * `photoId` (the id the client already has on the item it is looking at).
 * No-op if it was never saved.
 *
 * Un-saving must undo the WHOLE of the save, not just the row. A save allocates
 * three things — a copied storage object, an object_uploads provenance row and
 * a photo row — so dropping only the photo row would leak the bytes on every
 * save/un-save cycle and leave a provenance row pointing at an object nothing
 * references (which then misdirects account-deletion cleanup).
 *
 * Order matters: the row goes first (inside the user's request, so the UI is
 * immediately truthful), then provenance, then the bytes. If the byte delete
 * fails it is queued for the retry worker rather than failing the request —
 * the user's intent has already been honoured.
 */
router.delete("/vault/saves/:photoId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const sourceId = parsePhotoId(req.params.photoId);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      res.status(400).json({ error: "Invalid photoId" });
      return;
    }
    const copy = await storage.getSavedCopy(userId, sourceId);
    if (!copy) {
      res.json({ ok: true, removed: false });
      return;
    }
    const removed = await storage.deleteOwnPhoto(copy.id, userId);
    if (!removed) {
      // Scoped by uploaderId: someone else's row is never touched, and there is
      // nothing of ours to clean up.
      res.json({ ok: true, removed: false });
      return;
    }

    const url = removed.url;
    const isPublicUrl = /^https?:\/\//i.test(url);
    if (!isPublicUrl) {
      // Never delete bytes another row still points at. A save copies the
      // object, so normally nothing else does — but a re-save racing this
      // delete, or a copy made before copying existed, must not be broken.
      const stillReferenced = await storage.countPhotosByUrl(url);
      if (stillReferenced === 0) {
        await storage.deleteUploadRecord(userId, url);
        await deleteOwnedMediaObject(userId, url);
      }
    }
    res.json({ ok: true, removed: true });
  } catch (err) {
    logger.error({ err }, "Error removing saved vault copy");
    res.status(500).json({ error: "Failed to remove from your vault" });
  }
});

const FavoriteBody = z.object({ photoId: z.number().int().positive() });

/**
 * GET /api/vault/favorites
 *
 * Every photo/video the user has bookmarked, across all squads. Reference-only:
 * favorites point back at the original item (squadId/eventId preserved).
 * Favorites are a SquadZ+ feature — free users get an empty list with
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

    // Favorites are a SquadZ+ feature — free users hit the same entrance gate.
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

    // Favorites are a SquadZ+ feature — gate the write too, not just the GET
    // list. Otherwise a free client could POST favorites it can never see.
    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, (req.user as { id: string; email?: string }).email ?? "");
    }
    if (!(await resolveProStatus(user))) {
      res.status(403).json({ error: "Saving favorites is a SquadZ+ feature.", requiresPro: true });
      return;
    }

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

    // Fire-and-forget: record/remove activity for the photo's uploader.
    void (async () => {
      const photo = await storage.getPhotoById(photoId);
      if (!photo || photo.uploaderId === userId) return;
      if (result.hearted) {
        recordActivitySafe({
          recipientId: photo.uploaderId,
          actorId: userId,
          type: "vault_reaction",
          subjectType: "vault_photo",
          subjectId: String(photoId),
          meta: {
            thumbUrl: photo.url,
            photoId,
            squadId: photo.squadId ? String(photo.squadId) : undefined,
          },
          dedupe: true,
        });
      } else {
        removeActivity({
          recipientId: photo.uploaderId,
          actorId: userId,
          type: "vault_reaction",
          subjectId: String(photoId),
        });
      }
    })();
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

    recordActivitySafe({
      recipientId: photo.uploaderId,
      actorId: userId,
      type: "vault_comment",
      subjectType: "vault_photo",
      subjectId: String(photoId),
      meta: {
        commentPreview: parsed.data.text.slice(0, 80),
        thumbUrl: photo.url,
        photoId,
        squadId: photo.squadId ? String(photo.squadId) : undefined,
      },
    });

    // Fire-and-forget: notify the uploader (never the commenter themselves),
    // gated on the friend-activity notification preference.
    if (photo.uploaderId !== userId) {
      void (async () => {
        try {
          // 2-minute debounce: suppress duplicate "X commented" pushes when
          // someone leaves several comments in quick succession on the same photo.
          if (!(await shouldSendNotification(userId, photo.uploaderId, "vault_comment", 2 * 60 * 1000))) return;
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
              data: {
                screen: "vault",
                photoId: String(photoId),
                ...(photo.squadId ? { squadId: String(photo.squadId) } : {}),
                ...(photo.eventId ? { eventId: String(photo.eventId) } : {}),
              },
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

    // Copy the underlying storage object so the feed post owns an independent
    // binary. If the original vault item is later deleted, the share stays
    // intact. Falls back to referencing the original path when the object can't
    // be copied (non-Supabase path or storage not configured).
    const copiedUrl = await copyStorageObject(photo.url);
    const mediaUrl = copiedUrl ?? photo.url;

    // Record provenance for the COPY before it is referenced by a post. Media
    // ownership is resolved from object_uploads (never a path prefix), so an
    // unrecorded copy would survive the sharer's account purge forever as an
    // orphan private object. Only the copy gets a record — when the copy fails
    // we fall back to the original path, which is already owned by its uploader.
    if (copiedUrl) {
      await storage.recordUpload(userId, copiedUrl);
    }

    const [post] = await db
      .insert(feedPostsTable)
      .values({
        authorId: userId,
        text,
        audience: "friends",
        mediaUrl,
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
