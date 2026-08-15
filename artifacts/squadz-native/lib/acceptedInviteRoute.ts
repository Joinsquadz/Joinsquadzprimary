export type InvitedPlanType = "event" | "trip" | undefined;

/**
 * Activity invitations identify their event id separately from their invitation
 * id. Trips are stored in the same events table but need their own detail route.
 * Older activity rows have no plan type, so retain the established event route
 * as their safe fallback.
 */
export function acceptedInviteRoute(eventId?: string, planType?: InvitedPlanType) {
  if (!eventId) return null;
  return {
    pathname: planType === "trip" ? "/trip/[id]" : "/event/[id]",
    params: { id: eventId },
  };
}