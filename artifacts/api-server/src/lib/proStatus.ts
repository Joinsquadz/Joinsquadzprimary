import { storage } from "../storage";

type StorableUser = NonNullable<Awaited<ReturnType<typeof storage.getUser>>>;

/**
 * Resolve whether a user has an active Squadz+ (Pro) subscription.
 * Primary check is the stripeSubscriptionId stored on the user; falls back to
 * looking up an active subscription by their Stripe customer id. Returns false
 * for users with no Stripe linkage. Shared across all Pro-gated routes so the
 * definition of "Pro" stays consistent.
 */
export async function resolveProStatus(user: StorableUser): Promise<boolean> {
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
 * Resolve Pro status for many users at once, keyed by user id. Used by surfaces
 * that render gold rings for multiple people (member lists, feed, chat).
 */
export async function resolveProStatusForIds(ids: string[]): Promise<Record<string, boolean>> {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  const result: Record<string, boolean> = {};
  await Promise.all(
    unique.map(async (id) => {
      const user = await storage.getUser(id);
      result[id] = user ? await resolveProStatus(user) : false;
    }),
  );
  return result;
}
