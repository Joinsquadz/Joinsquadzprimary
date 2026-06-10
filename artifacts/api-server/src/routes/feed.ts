import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, isNull, lt, sql, desc } from "drizzle-orm";
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
import { emitFeedUpdate, onFeedUpdate } from "../lib/feedEvents";

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

    const [friendIds, squadIds] = await Promise.all([getFriendIds(userId), getSquadIds(userId)]);
    const friendsAudienceAuthors = Array.from(new Set([userId, ...friendIds]));

    // A post is visible if it's a friends-post by the viewer or a friend, OR a
    // squad-post in one of the viewer's squads, OR authored by the viewer.
    const visibility = sql`(
      (${feedPostsTable.audience} = 'friends' AND ${feedPostsTable.authorId} IN (${sql.join(
        friendsAudienceAuthors.map((id) => sql`${id}`),
        sql`, `,
      )}))
      ${
        squadIds.length > 0
          ? sql`OR (${feedPostsTable.audience} IN (${sql.join(
              squadIds.map((id) => sql`${id}`),
              sql`, `,
            )}))`
          : sql``
      }
      OR ${feedPostsTable.authorId} = ${userId}
    )`;

    const conditions = [isNull(feedPostsTable.deletedAt), visibility];
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

const CreatePostBody = z.object({
  text: z.string().trim().min(1).max(1000),
  audience: z.string().min(1), // "friends" | squadId
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
    const { text, audience } = parsed.data;

    // Validate audience: "friends" is always allowed; a squad audience requires
    // the author to be a member of that squad.
    if (audience !== "friends") {
      const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, audience));
      if (!squad || !((squad.memberIds ?? []) as string[]).includes(userId)) {
        res.status(403).json({ error: "You can only post to squads you belong to." });
        return;
      }
    }

    const [post] = await db
      .insert(feedPostsTable)
      .values({ authorId: userId, text, audience })
      .returning();

    res.status(201).json({ id: post.id });

    // Fire-and-forget: fan out SSE updates + push to the audience.
    void (async () => {
      try {
        const recipientIds = await notifyFeedAudience(userId, audience, text);
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
                body: text.length > 80 ? `${text.slice(0, 77)}...` : text,
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
      const recipientIds = await notifyFeedAudience(userId, post.audience, "");
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
      if (post) emitFeedUpdate(post.authorId);
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

      // Notify post author of the comment (unless commenting on own post).
      if (post.authorId !== userId) {
        void (async () => {
          try {
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
