export type LegacySquadLinkAction = "wait" | "login" | "join-public" | "member";

/**
 * `/squad/:id` is both a legacy public share URL and the member detail route.
 * Decide before rendering which experience owns an installed-app deep link.
 */
export function legacySquadLinkAction(input: {
  id?: string;
  isLoggedIn: boolean;
  isAuthRestoring: boolean;
  squadsLoading: boolean;
  squadsAuthPending: boolean;
  squadsAuthError: boolean;
  memberSquadIds: readonly string[];
}): LegacySquadLinkAction {
  if (!input.id || input.isAuthRestoring) return "wait";
  if (!input.isLoggedIn) return "login";
  if (input.squadsLoading || input.squadsAuthPending || input.squadsAuthError) return "wait";
  return input.memberSquadIds.includes(input.id) ? "member" : "join-public";
}