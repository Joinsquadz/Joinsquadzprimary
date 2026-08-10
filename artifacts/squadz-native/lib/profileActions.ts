/**
 * Friend-CTA state for the user profile screen.
 *
 * Blocking severs the friendship server-side, so once a block exists the
 * screen must stop offering friend actions entirely. Deriving that here (a)
 * keeps the rule testable without mounting the screen, and (b) stops the two
 * pieces of state — "blocked" and the cached friends list — from disagreeing
 * on screen ("Blocked" next to "Remove friend").
 */
export type FriendCta = "add" | "pending" | "remove" | "none";

export interface ProfileActionInput {
  /** A block exists in EITHER direction between the viewer and this profile. */
  blocked: boolean;
  /** Viewer's cached friend list contains this profile. */
  isFriend: boolean;
  /** Viewer has a pending outgoing request to this profile. */
  isPending: boolean;
  /** The profile is the viewer's own. */
  isSelf?: boolean;
}

export function friendCtaFor({
  blocked,
  isFriend,
  isPending,
  isSelf = false,
}: ProfileActionInput): FriendCta {
  if (isSelf) return "none";
  // A block outranks stale friend/pending state: the server has already
  // dropped the friendship and refuses new requests, so showing "Remove
  // friend" would be a button that lies about the relationship.
  if (blocked) return "none";
  if (isFriend) return "remove";
  if (isPending) return "pending";
  return "add";
}
