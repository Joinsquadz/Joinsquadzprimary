/**
 * Canonical public invite URLs.
 *
 * Keep these builders in one place so native share sheets, clipboard recovery,
 * and the web fallback all agree on the same HTTPS destinations.
 */
export const INVITE_ORIGIN = "https://joinsquadz.com";

export function squadInviteUrl(code: string): string {
  return `${INVITE_ORIGIN}/squad/join?code=${encodeURIComponent(code.trim().toUpperCase())}`;
}

export function publicSquadUrl(id: string): string {
  return `${INVITE_ORIGIN}/squad/join-public?id=${encodeURIComponent(id)}`;
}

export function planInviteUrl(code: string): string {
  return `${INVITE_ORIGIN}/join/${encodeURIComponent(code.trim().toUpperCase())}`;
}