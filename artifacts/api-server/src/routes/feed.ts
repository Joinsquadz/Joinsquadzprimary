import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, ne, notInArray, isNull, lt, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  feedPostsTable,
  feedReactionsTable,
  feedCommentsTable,
  friendshipsTable,
  squadsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";
import { shouldSendNotification } from "../lib/notificationDebounce";
import { emitFeedUpdate, onFeedUpdate } from "../lib/feedEvents";
import { recordActivitySafe, removeActivity } from "../lib/activity";
import { getBlockedAndBlockerIds } from "./moderation";

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const PAGE_SIZE = 30;

/** Mutual friend ids for a user (friendships are stored symmetrically). */
async function getFriendIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ friendId: friendshipsTable.friendId })
    .from(friendshipsTable)
    .where(eq(friendshipsTable.ownerId, userId));
  return rows.map((r) => r.friendId);
}

/** Squad ids the user is a member of. */
async function getSquadIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: squadsTable.id })
    .from(squadsTable)
    .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`);
  return rows.map((r) => r.id);
}

/**
 * Whether a user is allowed to view/interact with a post. The author always
 * can; a friends-post is visible to the author's friends; a squad-post is
 * visible to current members of that squad. Mirrors the GET /feed visibility
 * filter so per-post reaction/comment endpoints can't be reached by ID guessing
 * across audiences (IDOR).
 */
async function canViewPost(
  userId: string,
  post: typeof feedPostsTable.$inferSelect,
): Promise<boolean> {
  if (post.authorId === userId) return true;
  if (post.audience === "friends") {
    const friendIds = await getFriendIds(userId);
    return friendIds.includes(post.authorId);
  }
  const squadIds = await getSquadIds(userId);
  return squadIds.includes(post.audience);
}

/**
 * Notify the audience of a new feed post (friends or squad members), excluding
 * the author, gated on the friend-activity notification preference.
 */
async function notifyFeedAudience(authorId: string, audience: string): Promise<string[]> {
  let recipientIds: string[];
  if (audience === "friends") {
    recipientIds = await getFriendIds(authorId);
  } else {
    const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, audience));
    const memberIds = ((squad?.memberIds ?? []) as string[]).filter((id) => id !== authorId);
    recipientIds = await storage.filterUnmutedForSquad(memberIds, audience);
  }
  recipientIds = recipientIds.filter((id) => id !== authorId);
  return recipientIds;
}

/**
 * Everyone who can SEE a post (friends or current squad members), excluding the
 * author. Unlike notifyFeedAudience, this does NOT apply the squad mute filter:
 * mute only silences push notifications, while the feed itself still shows the
 * post (see the feed list visibility query). Used to drive live SSE refetch
 * nudges so reactions update for all viewers, muted or not.
 */
async function feedPostReaders(authorId: string, audience: string): Promise<string[]> {
  let recipientIds: string[];
  if (audience === "friends") {
    recipientIds = await getFriendIds(authorId);
  } else {
    const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, audience));
    recipientIds = ((squad?.memberIds ?? []) as string[]).filter((id) => id !== authorId);
  }
  return recipientIds.filter((id) => id !== authorId);
}

// GET /api/feed/stream — SSE stream of feed/moment updates for the user.
// The user receives an "update" whenever anyone in their audience (friends or
// squads) posts/reacts/comments, or posts a moment. Reuses one channel for
// both feed and moments to avoid proliferating SSE connections.
router.get("/feed/stream", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write("event: connected\ndata: {}\n\n");

  const unsubscribe = onFeedUpdate(userId, () => {
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

// GET /api/feed — audience-filtered, paginated reverse-chronological feed.
router.get("/feed", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;

    const [friendIds, blockedIds] = await Promise.all([
      getFriendIds(userId),
      getBlockedAndBlockerIds(userId),
    ]);
    const friendsAudienceAuthors = Array.from(new Set([userId, ...friendIds]));

    // Vibe posts are friends-only: a post is visible if it's a friends-post by
    // the viewer or a friend, OR authored by the viewer.
    const visibility = sql`(
      (${feedPostsTable.audience} = 'friends' AND ${feedPostsTable.authorId} IN (${sql.join(
        friendsAudienceAuthors.map((id) => sql`${id}`),
        sql`, `,
      )}))
      OR ${feedPostsTable.authorId} = ${userId}
    )`;

    const conditions = [
      isNull(feedPostsTable.deletedAt),
      ne(feedPostsTable.status, "hidden"),
      visibility,
    ];
    // Suppress posts from blocked users (both directions: viewer blocked them, or they blocked viewer).
    if (blockedIds.length > 0) {
      conditions.push(notInArray(feedPostsTable.authorId, blockedIds));
    }
    if (before && !Number.isNaN(before.getTime())) {
      conditions.push(lt(feedPostsTable.createdAt, before));
    }

    const posts = await db
      .select()
      .from(feedPostsTable)
      .where(and(...conditions))
      .orderBy(desc(feedPostsTable.createdAt))
      .limit(PAGE_SIZE);

    const postIds = posts.map((p) => p.id);

    // Batch-load reactions and comment counts for the page.
    const [reactions, commentCounts] = await Promise.all([
      postIds.length
        ? db.select().from(feedReactionsTable).where(inArray(feedReactionsTable.postId, postIds))
        : Promise.resolve([]),
      postIds.length
        ? db
            .select({
              postId: feedCommentsTable.postId,
              count: sql<number>`count(*)::int`,
            })
            .from(feedCommentsTable)
            .where(
              and(inArray(feedCommentsTable.postId, postIds), isNull(feedCommentsTable.deletedAt)),
            )
            .groupBy(feedCommentsTable.postId)
        : Promise.resolve([]),
    ]);

    const commentCountMap = new Map(commentCounts.map((c) => [c.postId, c.count]));
    const reactionsByPost = new Map<string, typeof reactions>();
    for (const r of reactions) {
      const arr = reactionsByPost.get(r.postId) ?? [];
      arr.push(r);
      reactionsByPost.set(r.postId, arr);
    }

    const items = posts.map((p) => {
      const postReactions = reactionsByPost.get(p.id) ?? [];
      const counts: Record<string, number> = {};
      const mine: string[] = [];
      for (const r of postReactions) {
        counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
        if (r.userId === userId) mine.push(r.emoji);
      }
      return {
        id: p.id,
        authorId: p.authorId,
        text: p.text,
        audience: p.audience,
        mediaUrl: p.mediaUrl,
        mediaType: p.mediaType,
        durationMs: p.durationMs,
        createdAt: p.createdAt,
        reactions: counts,
        myReactions: mine,
        commentCount: commentCountMap.get(p.id) ?? 0,
        canDelete: p.authorId === userId,
      };
    });

    res.json({
      posts: items,
      nextCursor: items.length === PAGE_SIZE ? items[items.length - 1].createdAt : null,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching feed");
    res.status(500).json({ error: "Failed to fetch feed" });
  }
});

const CreatePostBody = z
  .object({
    text: z.string().trim().max(1000).optional().default(""),
    mediaUrl: z.string().min(1).optional(),
    mediaType: z.enum(["photo", "video"]).optional(),
    durationMs: z.number().int().positive().optional(),
  })
  .refine((d) => d.text.length > 0 || Boolean(d.mediaUrl), {
    message: "A post needs text or media.",
  })
  .refine((d) => !d.mediaUrl || Boolean(d.mediaType), {
    message: "Media posts must include a mediaType.",
  });

// POST /api/feed/posts — create a post. Free and Pro users can both post.
router.post("/feed/posts", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const parsed = CreatePostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { text, mediaUrl, mediaType, durationMs } = parsed.data;

    // Vibe posts are always friends-only; ignore any client-sent audience.
    const audience = "friends";

    // Provenance: a post may only reference media the author uploaded. This stops
    // a user from pointing a post at someone else's private object and then
    // self-authorizing via the feed media ACL (the author can always view it).
    if (mediaUrl) {
      const owner = await storage.getUploadOwner(mediaUrl);
      if (owner !== userId) {
        res.status(403).json({ error: "You can only attach media you uploaded." });
        return;
      }
    }

    const [post] = await db
      .insert(feedPostsTable)
      .values({
        authorId: userId,
        text,
        audience,
        mediaUrl: mediaUrl ?? null,
        mediaType: mediaUrl ? (mediaType ?? null) : null,
        durationMs: mediaUrl && mediaType === "video" ? (durationMs ?? null) : null,
      })
      .returning();

    res.status(201).json({ id: post.id });

    // Push/notification preview: caption if present, else a media label.
    const preview =
      text.length > 0
        ? text.length > 80
          ? `${text.slice(0, 77)}...`
          : text
        : mediaType === "video"
          ? "🎥 Shared a clip"
          : "📷 Shared a photo";

    // Fire-and-forget: fan out SSE updates + push to the audience.
    void (async () => {
      try {
        const recipientIds = await notifyFeedAudience(userId, audience);
        recipientIds.forEach((id) => emitFeedUpdate(id));
        emitFeedUpdate(userId);

        if (recipientIds.length > 0) {
          const author = await storage.getUser(userId);
          const authorName = author?.firstName ?? "Someone";
          const tokens = await storage.getPushTokensForUsers(recipientIds, {
            requireNotifyFriendActivity: true,
          });
          if (tokens.length > 0) {
            await sendPushNotifications(
              tokens,
              {
                title: authorName,
                body: preview,
                data: { screen: "feed" },
              },
              { onStaleToken: (token) => storage.clearPushToken(token) },
            );
          }
        }
      } catch (err) {
        logger.error({ err }, "Error fanning out feed post");
      }
    })();
  } catch (err) {
    logger.error({ err }, "Error creating feed post");
    res.status(500).json({ error: "Failed to create post" });
  }
});

const EditPostBody = z.object({ text: z.string().trim().max(1000) });

// PATCH /api/feed/posts/:id — edit your own post's caption/text. Only the
// original author may edit (403 otherwise).
router.patch("/feed/posts/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;
    const parsed = EditPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
    if (!post || post.deletedAt) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    if (post.authorId !== userId) {
      res.status(403).json({ error: "You can only edit your own posts." });
      return;
    }
    const text = parsed.data.text;
    if (text.length === 0 && !post.mediaUrl) {
      res.status(400).json({ error: "A post needs text or media." });
      return;
    }
    const [updated] = await db
      .update(feedPostsTable)
      .set({ text })
      .where(eq(feedPostsTable.id, id))
      .returning();
    res.json({ id: updated.id, text: updated.text });
    emitFeedUpdate(userId);
    void (async () => {
      const recipientIds = await feedPostReaders(userId, post.audience);
      recipientIds.forEach((rid) => emitFeedUpdate(rid));
    })();
  } catch (err) {
    logger.error({ err }, "Error editing feed post");
    res.status(500).json({ error: "Failed to edit post" });
  }
});

// DELETE /api/feed/posts/:id — soft-delete your own post.
router.delete("/feed/posts/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;
    const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
    if (!post || post.deletedAt) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    if (post.authorId !== userId) {
      res.status(403).json({ error: "You can only delete your own posts." });
      return;
    }
    await db
      .update(feedPostsTable)
      .set({ deletedAt: new Date() })
      .where(eq(feedPostsTable.id, id));
    res.json({ ok: true });
    emitFeedUpdate(userId);
    void (async () => {
      const recipientIds = await feedPostReaders(userId, post.audience);
      recipientIds.forEach((rid) => emitFeedUpdate(rid));
    })();
  } catch (err) {
    logger.error({ err }, "Error deleting feed post");
    res.status(500).json({ error: "Failed to delete post" });
  }
});

const ReactionBody = z.object({ emoji: z.string().min(1).max(8) });

// POST /api/feed/posts/:id/reactions — toggle a reaction (idempotent add).
router.post(
  "/feed/posts/:id/reactions",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      const userId = (req.user as { id: string }).id;
      const parsed = ReactionBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
      if (!post || post.deletedAt) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      if (!(await canViewPost(userId, post))) {
        res.status(403).json({ error: "You can't react to this post." });
        return;
      }
      await db
        .insert(feedReactionsTable)
        .values({ postId: id, userId, emoji: parsed.data.emoji })
        .onConflictDoNothing();
      res.status(201).json({ ok: true });
      emitFeedUpdate(post.authorId);
      emitFeedUpdate(userId);
      recordActivitySafe({
        recipientId: post.authorId,
        actorId: userId,
        type: "vibe_reaction",
        subjectType: "post",
        subjectId: id,
        meta: { emoji: parsed.data.emoji, thumbUrl: post.mediaUrl ?? undefined },
        dedupe: true,
      });
      // Also nudge everyone else who can see this post so the reaction shows up
      // live for other viewers, not just the author and the reactor.
      void (async () => {
        const recipientIds = await feedPostReaders(post.authorId, post.audience);
        recipientIds.forEach((rid) => emitFeedUpdate(rid));
      })();
    } catch (err) {
      logger.error({ err }, "Error adding reaction");
      res.status(500).json({ error: "Failed to add reaction" });
    }
  },
);

// DELETE /api/feed/posts/:id/reactions/:emoji — remove your reaction.
router.delete(
  "/feed/posts/:id/reactions/:emoji",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      const emoji = decodeURIComponent(parseId(req.params.emoji));
      const userId = (req.user as { id: string }).id;
      await db
        .delete(feedReactionsTable)
        .where(
          and(
            eq(feedReactionsTable.postId, id),
            eq(feedReactionsTable.userId, userId),
            eq(feedReactionsTable.emoji, emoji),
          ),
        );
      res.json({ ok: true });
      const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
      if (post) {
        emitFeedUpdate(post.authorId);
        removeActivity({
          recipientId: post.authorId,
          actorId: userId,
          type: "vibe_reaction",
          subjectId: id,
        });
        // Nudge all other viewers too so the removed reaction updates live.
        void (async () => {
          const recipientIds = await feedPostReaders(post.authorId, post.audience);
          recipientIds.forEach((rid) => emitFeedUpdate(rid));
        })();
      }
      emitFeedUpdate(userId);
    } catch (err) {
      logger.error({ err }, "Error removing reaction");
      res.status(500).json({ error: "Failed to remove reaction" });
    }
  },
);

// GET /api/feed/posts/:id/comments — list comments for a post.
router.get(
  "/feed/posts/:id/comments",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      const userId = (req.user as { id: string }).id;
      const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
      if (!post || post.deletedAt) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      if (!(await canViewPost(userId, post))) {
        res.status(403).json({ error: "You can't view this post." });
        return;
      }
      const comments = await db
        .select({
          id: feedCommentsTable.id,
          authorId: feedCommentsTable.authorId,
          text: feedCommentsTable.text,
          createdAt: feedCommentsTable.createdAt,
        })
        .from(feedCommentsTable)
        .where(and(eq(feedCommentsTable.postId, id), isNull(feedCommentsTable.deletedAt)))
        .orderBy(feedCommentsTable.createdAt);
      res.json({ comments });
    } catch (err) {
      logger.error({ err }, "Error listing comments");
      res.status(500).json({ error: "Failed to list comments" });
    }
  },
);

const CommentBody = z.object({ text: z.string().trim().min(1).max(500) });

// POST /api/feed/posts/:id/comments — add a comment.
router.post(
  "/feed/posts/:id/comments",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      const userId = (req.user as { id: string }).id;
      const parsed = CommentBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, id));
      if (!post || post.deletedAt) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      if (!(await canViewPost(userId, post))) {
        res.status(403).json({ error: "You can't comment on this post." });
        return;
      }
      const [comment] = await db
        .insert(feedCommentsTable)
        .values({ postId: id, authorId: userId, text: parsed.data.text })
        .returning();
      res.status(201).json({
        id: comment.id,
        authorId: comment.authorId,
        text: comment.text,
        createdAt: comment.createdAt,
      });
      emitFeedUpdate(post.authorId);
      emitFeedUpdate(userId);
      recordActivitySafe({
        recipientId: post.authorId,
        actorId: userId,
        type: "vibe_comment",
        subjectType: "post",
        subjectId: id,
        meta: { commentPreview: parsed.data.text.slice(0, 80), thumbUrl: post.mediaUrl ?? undefined },
      });

      // Notify post author of the comment (unless commenting on own post).
      if (post.authorId !== userId) {
        void (async () => {
          try {
            // 2-minute debounce: suppress rapid-fire "X commented" pushes from
            // the same commenter on the same post author's content.
            if (!shouldSendNotification(userId, post.authorId, "feed_comment", 2 * 60 * 1000)) return;
            const commenter = await storage.getUser(userId);
            const commenterName = commenter?.firstName ?? "Someone";
            const tokens = await storage.getPushTokensForUsers([post.authorId], {
              requireNotifyFriendActivity: true,
            });
            if (tokens.length > 0) {
              await sendPushNotifications(
                tokens,
                {
                  title: `${commenterName} commented`,
                  body: parsed.data.text.length > 80 ? `${parsed.data.text.slice(0, 77)}...` : parsed.data.text,
                  data: { screen: "feed" },
                },
                { onStaleToken: (token) => storage.clearPushToken(token) },
              );
            }
          } catch (err) {
            logger.error({ err }, "Error notifying comment");
          }
        })();
      }
    } catch (err) {
      logger.error({ err }, "Error adding comment");
      res.status(500).json({ error: "Failed to add comment" });
    }
  },
);

export default router;
