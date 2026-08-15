import type { ActivePollScope } from "@/components/ActivePollList";

/**
 * Returns the stable request identity for a scope's active-poll list.
 *
 * Screens commonly create their `scope` prop inline on every render. Consumers
 * must depend on this primitive key rather than the object itself, otherwise a
 * wholly unrelated parent render turns into another list fetch.
 */
export function activePollScopeQuery(scope: ActivePollScope): string {
  return scope.type === "squad"
    ? `squadId=${encodeURIComponent(scope.squadId)}`
    : `eventId=${encodeURIComponent(scope.eventId)}`;
}