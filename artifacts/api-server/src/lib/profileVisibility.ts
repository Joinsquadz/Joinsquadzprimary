/**
 * The profile-summary visibility rule shared by the full profile endpoint and
 * caller-scoped summary lookups. Keep this deliberately free of database access:
 * callers can gather the relationships appropriate to their query in batches,
 * while the actual policy remains one rule.
 *
 * Blocks always win, including over a friendship or a shared squad. A private
 * profile is otherwise visible to its owner, an accepted friend, or a current
 * member of a shared squad. Moderation-hidden profiles are handled by the
 * route's status-specific gate, but are included here so summary callers cannot
 * accidentally forget that restriction.
 */
export function canViewProfileSummary({
  requesterId,
  targetId,
  privateProfile,
  moderationHidden = false,
  blocked = false,
  isFriend = false,
  sharesCurrentSquad = false,
}: {
  requesterId: string;
  targetId: string;
  privateProfile: boolean | null | undefined;
  moderationHidden?: boolean | null;
  blocked?: boolean;
  isFriend?: boolean;
  sharesCurrentSquad?: boolean;
}): boolean {
  if (requesterId === targetId) return true;
  if (blocked || moderationHidden) return false;
  if (!privateProfile) return true;
  return isFriend || sharesCurrentSquad;
}