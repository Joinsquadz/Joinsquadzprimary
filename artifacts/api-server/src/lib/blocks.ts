import { eq } from "drizzle-orm";
import { db, userBlocksTable } from "@workspace/db";

/**
 * Every user id in a block relationship with `userId`, in BOTH directions
 * (people they blocked, and people who blocked them).
 *
 * Lives in lib/ rather than in the moderation router so that discovery
 * surfaces (search, friend-code lookup, discover) can filter on blocks
 * without importing the moderation router's email/storage dependency graph.
 */
export async function getBlockedAndBlockerIds(userId: string): Promise<string[]> {
  const [blockedByUser, blockersOfUser] = await Promise.all([
    db
      .select({ id: userBlocksTable.blockedId })
      .from(userBlocksTable)
      .where(eq(userBlocksTable.blockerId, userId)),
    db
      .select({ id: userBlocksTable.blockerId })
      .from(userBlocksTable)
      .where(eq(userBlocksTable.blockedId, userId)),
  ]);
  const ids = new Set<string>();
  for (const r of blockedByUser) ids.add(r.id);
  for (const r of blockersOfUser) ids.add(r.id);
  return [...ids];
}

/** True when `a` and `b` are in a block relationship in either direction. */
export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const ids = await getBlockedAndBlockerIds(a);
  return ids.includes(b);
}
