import type { eventsTable } from '@workspace/db/schema';

type DbEvent = typeof eventsTable.$inferSelect;

/** The only fields the visibility rule reads. */
export type EventVisibilityFields = Pick<
  DbEvent,
  'hostId' | 'invitedUserIds' | 'squadId' | 'type' | 'rsvps'
>;

/**
 * Resolves a squad's CURRENT member ids. Injected rather than imported so this
 * module stays free of storage/db imports — the events router and the storage
 * layer each pass their own reader, and both get the identical rule.
 */
export type SquadMemberReader = (squadId: string) => Promise<string[]>;

/**
 * Single source of truth for "can this user see/touch this plan?".
 *
 * Trips are CURRENT-squad-membership based and deliberately IGNORE the rsvps
 * map — a stale RSVP key (left over from before a member was removed from the
 * squad) must NOT keep granting access. Plain events additionally allow access
 * via an existing RSVP key, so an invited outsider who responded keeps access.
 * An explicit personal invite grants access to both, additively.
 *
 * This lives in its own module because plan CHAT has to evaluate exactly the
 * same visibility as the plan itself; a second copy of the rule would drift and
 * leave the thread readable after the plan stopped being.
 */
export async function canUserAccessEventRecord(
  event: EventVisibilityFields,
  userId: string,
  readSquadMembers: SquadMemberReader,
): Promise<boolean> {
  if (event.hostId === userId) return true;
  if (((event.invitedUserIds ?? []) as string[]).includes(userId)) return true;
  if (event.squadId && (await readSquadMembers(event.squadId)).includes(userId)) return true;
  // Trips deliberately stop here (see above).
  if (event.type === 'trip') return false;
  const rsvps = (event.rsvps ?? {}) as Record<string, string>;
  return userId in rsvps;
}

/**
 * Everyone who can currently see the plan, and therefore belongs in its chat
 * thread: host + explicit invitees + CURRENT squad members (+ RSVP responders
 * for plain events). Re-derived on every open/send so a squadmate added after
 * the thread was created still lands in it without an explicit join.
 */
export async function eventChatAudience(
  event: EventVisibilityFields,
  readSquadMembers: SquadMemberReader,
): Promise<string[]> {
  const ids = new Set<string>();
  if (event.hostId) ids.add(event.hostId);
  for (const uid of (event.invitedUserIds ?? []) as string[]) ids.add(uid);
  if (event.squadId) {
    for (const uid of await readSquadMembers(event.squadId)) ids.add(uid);
  }
  if (event.type !== 'trip') {
    for (const uid of Object.keys((event.rsvps ?? {}) as Record<string, string>)) ids.add(uid);
  }
  return [...ids];
}
