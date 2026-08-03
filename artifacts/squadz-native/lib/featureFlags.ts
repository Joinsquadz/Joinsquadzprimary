/**
 * Feature flags — zero external dependencies so they can be imported in any
 * context including the Vitest node environment.
 */

/**
 * STOP_VOTING_ENABLED — gates all proposed-stop voting affordances in the UI.
 * The server route (POST /events/:id/itinerary/:stopId/vote) remains live and
 * untouched. Flip to true to re-enable. Soft-deprecated 2026-08-03; the Ideas
 * feature is the replacement suggest-and-vote surface on trips.
 */
export const STOP_VOTING_ENABLED = false;
